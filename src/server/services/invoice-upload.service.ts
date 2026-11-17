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
 * 这次上传识别出一张**红字票**，而它冲的那张原票就在系统里（在用、仍是「正常」）。
 *
 * 两件事要分清：
 *   1. 红字票本身**已经入账**（金额为负、状态正常）——它不是"待处理"，是台账里的一行；
 *   2. 这里问的只是：要不要顺手把**原票**标成「已冲红」。
 *
 * 标记**不改金额**，所以标不标都不影响合计（负数是红字票那一行带来的）。
 * 之所以还要问一句：这一步会改别人的票，而"谁冲了谁"是从票面文字读出来的，
 * 读错就把一张无辜的票标脏了——让人看一眼比替他改安全。
 */
export interface UploadRedHint {
  /** 待标记的那张原票 */
  invoice_id: string;
  invoice_no: string;
  /** 库里那张原票的价税合计，用来确认「说的是不是同一张票」 */
  total_amount: string | null;
  current_status: 'normal' | 'red';
  /** 冲它的那张红字票（这次上传的） */
  red_invoice_no: string;
  red_total_amount: string | null;
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

/**
 * 插一行票。
 *
 * `status` 恒为 `'normal'`：红字票也是一张正常凭证，它的「红」由 `is_red_letter`
 * 表达（那一列决定三项金额的符号）。被它冲掉的原票才是 `status='red'`（已冲红），
 * 而那条状态由人在上传后的提示里点，或事后在抽屉里改。
 */
function insertInvoiceSql(): string {
  return `INSERT INTO invoices
       (invoice_no, invoice_code, status, status_source, is_red_letter, original_invoice_no,
        invoice_type, invoice_type_label,
        issued_on, buyer_name, buyer_tax_no, seller_name, seller_tax_no,
        amount, tax_amount, total_amount, amount_check, ocr_raw, ocr_request_id, created_by)
     VALUES ($1,$2,'normal','ocr',$3,$4,$5,$6,$7::date,$8,$9,$10,$11,
             $12::numeric,$13::numeric,$14::numeric,$15,$16::jsonb,$17,$18)
     RETURNING id`;
}

function insertParams(m: MappedInvoice, requestId: string | null, actorId: string): unknown[] {
  return [
    m.invoiceNo,
    m.invoiceCode,
    m.redLetter,
    m.originalInvoiceNo,
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
    JSON.stringify({ ...m.raw, statusReason: m.statusReason, redLetter: m.redLetter }),
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

interface OriginalRow {
  id: string;
  invoice_no: string;
  status: string;
  total_amount: string | null;
  deleted_at: Date | null;
}

/**
 * 红字票 → 「要不要把原票标成已冲红」。
 *
 * 三种情形都要说清楚，因为它们的后果不同：
 *   1. 原票在台账里、仍是「正常」→ 攒一条提示，让人点一下（这是主路径）；
 *   2. 原票在台账里但已经是「已冲红」→ 什么都不用做，静默（重复上传同一张红字票时就是这样）；
 *   3. 原票不在台账里 → 给一句 warning：这张红字票已经记上了，但它冲的那张票我们没有，
 *      补录之后别忘了标。**不能因为找不到原票就不记红字票**——那笔负数是真的发生了。
 *
 * 查不到 / 已删除 / 自己冲自己都不提示：前两种点不了，第三种是识别噪声。
 */
async function collectOriginalHint(
  client: PoolClient,
  m: MappedInvoice,
  hints: UploadRedHint[],
  warnings: string[],
): Promise<void> {
  const target = m.originalInvoiceNo;
  if (!target) return; // 映射阶段已经提示过「没读出原票号码」
  if (target === m.invoiceNo) return;

  const found = await client.query<OriginalRow>(
    `SELECT id, invoice_no, status, total_amount, deleted_at
       FROM invoices
      WHERE invoice_no = $1
      ORDER BY (deleted_at IS NULL) DESC, created_at
      LIMIT 1`,
    [target],
  );
  const o = found.rows[0];
  if (!o) {
    warnings.push(
      `${m.invoiceNo}：这张红字票冲的原票 ${target} 还没在台账里，红字票已按负数记上；补录原票后记得把它标成「已冲红」。`,
    );
    return;
  }
  if (o.deleted_at) {
    warnings.push(`${m.invoiceNo}：原票 ${target} 在「已删除」里，没有替你改它。恢复之后再标「已冲红」。`);
    return;
  }
  if (o.status === 'red') return; // 已经是答案，不再问第二次
  if (hints.some((h) => h.invoice_id === o.id)) return;

  hints.push({
    invoice_id: o.id,
    invoice_no: o.invoice_no,
    total_amount: o.total_amount,
    current_status: 'normal',
    red_invoice_no: m.invoiceNo,
    red_total_amount: m.totalAmount,
    basis: redBasisText(m.statusReason),
  });
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
      /** 新插入的红票号码：入库后要提示人「这一张是按红字票记的」 */
      const insertedRed: string[] = [];
      /** 事务内产生的提示（原票找不到之类），出事务后并进 warnings */
      const redWarnings: string[] = [];
      let referenced = 0;

      for (let i = 0; i < outcome.items.length; i += 1) {
        const m = outcome.items[i]!;

        /*
         * 红字票：先把它冲的那张原票找出来，攒一条「要不要标已冲红」的提示。
         * 放在这里而不是判重之后，是因为**红字票自己的号码是新的**（每张红字票
         * 都有自己的号），走不到判重分支——0.1.38 就是这么漏掉整件事的。
         */
        if (m.redLetter) await collectOriginalHint(client, m, redHints, redWarnings);

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
          /* `status` / `total_amount` / `deleted_at` 顺手取回来（同一次扫描）：
             重传一张已冲红的票时，界面上要能说清"那张已经标过了"，而不是又让人点一次。 */
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
        // 红字票照记：金额是负数（映射阶段已经取负），状态仍是「正常」
        if (m.redLetter) insertedRed.push(m.invoiceNo);
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
      return { firstId, firstDuplicated, firstAttached, extra, redHints, insertedRed, redWarnings, referenced };
    });

    // ② 这份物理文件一行都没被引用（命中的票本来就有原件）→ 立刻回收，别留孤儿
    if (outcomeTx.referenced === 0) await discardStoredFile(stored);

    const warnings = [...outcome.warnings, ...outcomeTx.redWarnings];
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
      warnings.push(`${no}：这是红字票，已按负数入账（状态显示「正常」——它本身就是一张正常凭证）。`);
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
