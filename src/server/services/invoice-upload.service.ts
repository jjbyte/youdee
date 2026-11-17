/**
 * 上传识别之后的落库（Spec §5.2 的 PERSIST 阶段）。
 *
 * 一个文件可能识别出**多张**票（多页 PDF、混贴票据），所以这里的单位是
 * "一次上传 = N 行发票 + N 行原件"，而 N 张票**共用同一份物理原件**
 * （`storage_key` 相同）——存 N 份既浪费，也让"原件哪份是真的"没人能回答。
 *
 * 事务边界（顺序不能反）：
 *   1. 先把物理文件落到位（本地 rename / COS 上传）
 *   2. 再在一个事务里 `INSERT invoices` + `INSERT invoice_files`
 *   3. 最后清临时文件
 * 少了第 1 步，事务里就会出现"库里有行、盘上没文件"的记录；少了第 3 步，
 * 临时目录会堆满（而临时目录堆满磁盘这件事，往往等发现就晚了）。
 *
 * 去重（DEDUP）：命中已有票号时**不改那一行**，只在它还没有原件时把这份原件补挂上
 * （`attached_file=true`）。不去更新状态与金额，是因为"重传一次"不该悄悄改掉
 * 上一次人工核对过的数——要改就点开那张改。
 */
import type { PoolClient } from 'pg';
import { AppError } from '../http';
import { one, tx } from '../db';
import type { CurrentUser } from '../auth/session';
import type { MappedInvoice } from '@/domain/invoice-ocr';
import { isSameInvoice } from '@/domain/invoice-record';
import type { RecognizeOutcome } from './invoice-ocr.service';
import type { StagedUpload } from './upload-stream.service';
import {
  INVOICE_FILE_HARD_MAX_BYTES,
  cleanupStaged,
  discardStoredFile,
  insertInvoiceFileRow,
  persistInvoiceFile,
  type StoredFile,
} from './invoice-file.service';
import { getInvoice } from './invoice.service';
import type { InvoiceDetailDTO } from './invoice-dto';

export interface UploadExtraItem {
  invoice_no: string;
  total_amount: string | null;
  page: number;
  /** 这份文件里额外识别出的票有没有落库 */
  saved: boolean;
  /** 没落库的原因（人话，直接上界面） */
  reason?: string;
}

/**
 * 这次上传识别出一张**红冲票**，而系统里已经有同号的发票（在用、且当前是「正常」）。
 *
 * 为什么不在服务端直接把那张改成冲红：改状态会把三项金额翻成负数，是**会改合计**的动作。
 * 识别又不保证对（红票只有启发式线索：负号、票面/备注里的「红字」字样），
 * 所以让人看见这条判断、由他点一下，比替他改账安全。没点的话什么都不变。
 */
export interface UploadRedHint {
  invoice_id: string;
  invoice_no: string;
  /** 库里那张的价税合计，用来确认「说的是不是同一张票」 */
  total_amount: string | null;
  current_status: 'normal' | 'red';
  /** 判定依据（人话），让用户自己判断这个红票结论可信不可信 */
  basis: string;
}

export interface UploadResult {
  /** 落库的那张（或本来就存在的那张） */
  item: InvoiceDetailDTO;
  /** true = 票号已存在，本次未新建 */
  duplicated: boolean;
  /** true = 命中去重但该票原先没原件，已把这份原件补上 */
  attached_file: boolean;
  /** 同一文件里还识别出的其它票 */
  extra_items: UploadExtraItem[];
  /** 需要人确认「要不要把已有那张标成冲红」的候选，通常为空 */
  red_hints: UploadRedHint[];
  warnings: string[];
}

/** 红票判定依据 → 人话。枚举值是我们的（`title_red` / `amount_negative`），不来自腾讯云 */
function redBasisText(reason: string): string {
  return reason === 'amount_negative'
    ? '票面金额是负数'
    : '票面上有「红字 / 红冲 / 冲红」字样';
}

function insertInvoiceSql(): string {
  return `INSERT INTO invoices
       (invoice_no, invoice_code, status, status_source, invoice_type, invoice_type_label,
        issued_on, buyer_name, buyer_tax_no, seller_name, seller_tax_no,
        amount, tax_amount, total_amount, amount_check, ocr_raw, ocr_request_id, created_by)
     VALUES ($1,$2,$3,'ocr',$4,$5,$6::date,$7,$8,$9,$10,
             $11::numeric,$12::numeric,$13::numeric,$14,$15::jsonb,$16,$17)
     RETURNING id`;
}

function insertParams(m: MappedInvoice, requestId: string | null, actorId: string): unknown[] {
  return [
    m.invoiceNo,
    m.invoiceCode,
    m.status,
    m.invoiceType.slice(0, 40),
    m.invoiceTypeLabel.slice(0, 60),
    m.issuedOn,
    m.buyerName,
    m.buyerTaxNo,
    m.sellerName,
    m.sellerTaxNo,
    m.amount,
    m.taxAmount,
    m.totalAmount,
    m.amountCheck,
    JSON.stringify({ ...m.raw, statusReason: m.statusReason }),
    requestId,
    actorId,
  ];
}

/** 一张票已经挂了几份原件（在事务里查，避免与并发上传打架） */
async function fileCountInTx(client: PoolClient, invoiceId: string): Promise<number> {
  const r = await client.query<{ n: string }>(
    'SELECT count(*)::text AS n FROM invoice_files WHERE invoice_id = $1',
    [invoiceId],
  );
  return Number(r.rows[0]?.n ?? 0);
}

/**
 * 落库一次上传。
 *
 * 抛错语义：识别出 0 张票 → 42208（含"不是增值税发票"的细分文案）；
 * 其它异常原样上抛（`route` 层统一翻译）。**失败不留半行**：整个事务回滚 +
 * 物理文件尽量回收，宁可让人重传，也不要库里多一行没人负责的空数据。
 */
export async function persistUpload(opts: {
  staged: StagedUpload;
  outcome: RecognizeOutcome;
  actor: CurrentUser;
}): Promise<UploadResult> {
  const { staged, outcome, actor } = opts;

  if (staged.sizeBytes > INVOICE_FILE_HARD_MAX_BYTES) {
    throw new AppError(
      41301,
      `这个文件有 ${(staged.sizeBytes / 1024 / 1024).toFixed(1)}MB，超过 20MB 上限。发票原件不会这么大，检查一下是不是传错了文件。`,
      413,
      { field: 'file' },
    );
  }
  if (outcome.items.length === 0) {
    const why = outcome.skipped.find((s) => s.reason === 'not_vat_invoice');
    if (why) {
      throw new AppError(
        42208,
        '这张不是发票（纸质火车票、机票行程单、定额发票、出租车票这些是报销凭证）。本台账收增值税专用/普通/全电发票，以及电子发票（铁路电子客票）。',
        422,
        { field: 'file' },
      );
    }
    const unsupported = outcome.skipped.find((s) => s.reason === 'unsupported_sub_type');
    if (unsupported) {
      throw new AppError(
        42208,
        '这张票能识别，但不是本台账收的票种（增值税卷票 / 销货清单 / 航空运输电子客票行程单之类）。换一张专票、普票或铁路电子客票，或用「手工录入」先把票号记下来。',
        422,
        { field: 'file' },
      );
    }
    throw new AppError(
      42208,
      '这张票没认出来（图片模糊或版式不支持）。换一张清晰的，或用「手工录入」先把票号记下来。',
      422,
      { field: 'file' },
    );
  }

  // ① 物理文件先到位。失败直接在 finally 里清临时文件，库里一行都不写
  let stored: StoredFile | null = null;
  try {
    stored = await persistInvoiceFile(staged);

    const outcomeTx = await tx(async (client) => {
      let firstId: string | null = null;
      let firstDuplicated = false;
      let firstAttached = false;
      const extra: UploadExtraItem[] = [];
      const redHints: UploadRedHint[] = [];
      /** 新插入的红票号码：入库后要提示人「这一张是按冲红记的」 */
      const insertedRed: string[] = [];
      let referenced = 0;

      for (let i = 0; i < outcome.items.length; i += 1) {
        const m = outcome.items[i]!;
        // 判重口径与手工录入**必须同一套**（Spec §12-7：代码为空时对号码放宽匹配）。
        // 原来这里是 `invoice_code = $1 AND invoice_no = $2` 全等：一次没认出代码存成 ''，
        // 重传时认出代码就会新建一行——同一张票两条记录，金额与税额全部虚增，且没有提示。
        // 只按号码取候选（走 invoices_invoice_no_idx），再用领域函数筛，两边就不会分叉。
        const existing = await client.query<{
          id: string;
          invoice_code: string;
          invoice_no: string;
          status: string;
          total_amount: string | null;
          deleted_at: Date | null;
        }>(
          /* `status` / `total_amount` / `deleted_at` 只为「红冲确认」而取：
             红票要不要提示人改状态，取决于库里那张现在是正常还是已冲红、有没有被删。
             多取三列不额外扫表，却省掉一次事务内二次查询。 */
          `SELECT id, invoice_code, invoice_no, status, total_amount, deleted_at
             FROM invoices
            WHERE invoice_no = $1
            ORDER BY (invoice_code = $2) DESC, created_at`,
          [m.invoiceNo, m.invoiceCode],
        );
        // 已软删的行也算命中：唯一键包含它们，放过去会让 INSERT 撞 23505
        const hit = existing.rows.find((r) =>
          isSameInvoice({ code: r.invoice_code, no: r.invoice_no }, { code: m.invoiceCode, no: m.invoiceNo }),
        );

        if (hit) {
          /*
           * 识别成红冲票、而同号发票已经在库且仍是「正常」→ 攒一条待确认提示。
           *
           * 不在这里直接把 hit 改成红冲：那会把三项金额翻成负数、改掉「合计」这个
           * 对账数字，而红票判定只是启发式（负号 / 票面文字）。让人看见并点一下，
           * 比替他改账安全；他不点，这里就什么都不变。
           * 已经删掉的、本来就是红票的都不问——前者不在台账里，后者已经是答案。
           */
          if (m.status === 'red' && hit.status === 'normal' && !hit.deleted_at) {
            redHints.push({
              invoice_id: hit.id,
              invoice_no: hit.invoice_no,
              total_amount: hit.total_amount,
              current_status: 'normal',
              basis: redBasisText(m.statusReason),
            });
          }
          // 命中去重：只在"这张票还没有原件"时补挂；否则丢弃这份原件
          const n = await fileCountInTx(client, hit.id);
          let attached = false;
          if (n === 0) {
            await insertInvoiceFileRow(client, hit.id, stored!);
            referenced += 1;
            attached = true;
          }
          if (i === 0) {
            firstId = hit.id;
            firstDuplicated = true;
            firstAttached = attached;
          } else {
            extra.push({
              invoice_no: m.invoiceNo,
              total_amount: m.totalAmount,
              page: m.page,
              saved: false,
              reason: attached ? '票号已存在，原件已补挂到那张票上' : '票号已存在，这张跳过',
            });
          }
          continue;
        }

        const inserted = await client.query<{ id: string }>(insertInvoiceSql(), insertParams(m, outcome.requestId, actor.id));
        const id = inserted.rows[0]!.id;
        // 库里没有同号票 → 按"这就是一张红冲票"直接入账（金额已经是负数）
        if (m.status === 'red') insertedRed.push(m.invoiceNo);
        await insertInvoiceFileRow(client, id, stored!);
        referenced += 1;
        if (i === 0) {
          firstId = id;
          firstDuplicated = false;
        } else {
          extra.push({ invoice_no: m.invoiceNo, total_amount: m.totalAmount, page: m.page, saved: true });
        }
      }

      if (!firstId) throw new AppError(42208, '这张票没认出来，请重传一次或用「手工录入」。', 422, { field: 'file' });
      return { firstId, firstDuplicated, firstAttached, extra, redHints, insertedRed, referenced };
    });

    // ② 这份物理文件一行都没被引用（命中的票本来就有原件）→ 立刻回收，别留孤儿
    if (outcomeTx.referenced === 0) await discardStoredFile(stored);

    const warnings = [...outcome.warnings];
    for (const m of outcome.items) {
      for (const w of m.warnings) warnings.push(`${m.invoiceNo}：${w}`);
    }
    if (outcomeTx.firstDuplicated) {
      warnings.push(
        outcomeTx.firstAttached
          ? '这张票之前就记过（没有原件），这次把原件补挂上去了。'
          : '这张票之前就记过了，本次没有重复录入。要改就打开原来那张改。',
      );
    }
    for (const no of outcomeTx.insertedRed) {
      warnings.push(`${no}：识别成红冲票，已按冲红入库（三项金额是负数）。`);
    }
    const skippedNote = outcome.skipped.length;
    if (skippedNote > 0) {
      warnings.push(`这份文件里还有 ${skippedNote} 处内容没认成发票，已忽略。`);
    }

    const item = await getInvoice(outcomeTx.firstId);
    return {
      item,
      duplicated: outcomeTx.firstDuplicated,
      attached_file: outcomeTx.firstAttached,
      extra_items: outcomeTx.extra,
      red_hints: outcomeTx.redHints,
      warnings,
    };
  } catch (e) {
    // 事务已回滚 → 物理文件没有任何库行引用，可以安全回收
    if (stored) await discardStoredFile(stored);
    throw e;
  } finally {
    // 临时文件无论如何都要清（本地模式下 rename 之后它已经不在，force 删除不报错）
    await cleanupStaged(staged);
  }
}

/**
 * 补原件：**跳过识别**，只把一份扫描件挂到一张已有的发票上
 * （`POST /api/v1/invoices/:id/files`）。
 *
 * 为什么需要这条路：识别要腾讯云密钥，而"录票"不能等采购走完流程。
 * 于是留两个出口——先「手工录入」把票面数字记下来，等扫描件到手再补挂原件。
 * 早期版本让上传接口在未配置时直接 409，那样这类用户就一张原件都存不进来；
 * 但**不能反过来**放宽识别接口去存"没有票面数据的原件"：台账里会出现
 * 一行"金额空、号码空"的记录，合计上就是一个没人负责的空洞。
 *
 * 与识别链路的区别只有一点：这里不需要 `outcome`（没有识别结果），
 * 所以也不存在"识别出 N 张票"的多行写入，只挂 1 行。
 *
 * 顺序同 `persistUpload`：先落物理文件 → 再在事务里插行 + 摸 updated_at → 最后清临时。
 * 事务里那句 `UPDATE ... WHERE deleted_at IS NULL` 既是"票还在不在"的权威判定，
 * 也顺手把 `updated_at` 推一下（详情页按它显示"最近改动"）。
 * 判定放在事务里而不是查一次就算，是为了挡住"查完之后被人删掉"这个窗口。
 */
export async function attachInvoiceFile(invoiceId: string, staged: StagedUpload): Promise<void> {
  if (staged.sizeBytes > INVOICE_FILE_HARD_MAX_BYTES) {
    throw new AppError(
      41301,
      `这个文件有 ${(staged.sizeBytes / 1024 / 1024).toFixed(1)}MB，超过 20MB 上限。发票原件不会这么大，检查一下是不是传错了文件。`,
      413,
      { field: 'file' },
    );
  }

  // 落盘之前先确认票还在：否则会先写一份物理文件、再发现没有行可挂，白留孤儿
  const alive = await one<{ id: string }>('SELECT id FROM invoices WHERE id = $1 AND deleted_at IS NULL', [invoiceId]);
  if (!alive) throw new AppError(40401, '这张发票不存在，可能已经被删掉了。要补原件请先打开它确认一下。', 404);

  let stored: StoredFile | null = null;
  try {
    stored = await persistInvoiceFile(staged);
    const file = stored;
    await tx(async (client) => {
      const touched = await client.query<{ id: string }>(
        'UPDATE invoices SET updated_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING id',
        [invoiceId],
      );
      if (!touched.rows[0]) throw new AppError(40401, '这张发票刚刚被删掉了，原件没有挂上。', 404);
      await insertInvoiceFileRow(client, invoiceId, file);
    });
  } catch (e) {
    // 事务回滚 → 这一份没有任何行引用，立刻回收（COS 的孤儿对象交给周任务）
    if (stored) await discardStoredFile(stored);
    throw e;
  } finally {
    await cleanupStaged(staged);
  }
}
