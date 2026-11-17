/**
 * 腾讯云《通用票据识别（高级版）》客户端（`RecognizeGeneralInvoice` / 2018-11-19）。
 *
 * 五条已核实的事实（Spec §5.1，不是记忆）：
 *   - 引入方式是 `import { ocr } from 'tencentcloud-sdk-nodejs-ocr'`，
 *     再 `new ocr.v20181119.Client({...})`（产品包只有命名导出 `ocr`）。
 *   - 必须把该包加进 `next.config.ts` 的 `serverExternalPackages`：
 *     它按需拼 Node http 请求，被打包后会出现"开发能调、生产 502"。
 *   - 入参只用 `ImageBase64`，不传 `ImageUrl`：本地部署没有公网可达地址，
 *     桶是私有读，预签名链路过长且会把票据暴露给第三方抓取。
 *   - base64 后 ≤10MB（≈原始 7.5MB），像素单边 20–10000px。
 *     格式：PNG / JPG / JPEG / PDF，以及 **OFD 的第一页**（官方 2026-10 文档明确支持
 *     增值税电子发票与电子发票（铁路电子客票）等数电票的 OFD）。OFD 走同一个
 *     `ImageBase64` 入参，不需要另调 OFD 接口；只认第一页，多页 OFD 会被截断。
 *   - 响应**没有红票标记**（`RedLetterInvoiceMark` 只在 `VatInvoiceVerify` 里），
 *     所以红票只能启发式判定 + 人工兜底，见 `domain/invoice-record.ts`。
 *
 * 超时写死 20s：SDK 默认 60s，一个卡住的上传能把整批（并发 3）拖到浏览器超时，
 * 而用户看到的只是"转圈"。20s 之后我们还有机会告诉他"这次超时了，重传一次"。
 */
import { createHash } from 'node:crypto';
import { ocr } from 'tencentcloud-sdk-nodejs-ocr';
import { AppError } from '../http';
import { mapRecognizeResult, type MapResult } from '@/domain/invoice-ocr';
import { requireOcrConfig, type OcrRuntimeConfig } from './ocr-settings.service';

/** 请求超时（秒）。SDK 默认 60，见文件头 */
const REQ_TIMEOUT_SECONDS = 20;
/** base64 之后的上限（腾讯云硬限制 10M） */
const MAX_BASE64_BYTES = 10 * 1024 * 1024;
/** 预留一点余量：base64 恰好 10M 时腾讯云可能按"超过"处理 */
const BASE64_TARGET_BYTES = 9.5 * 1024 * 1024;

type OcrClient = InstanceType<typeof ocr.v20181119.Client>;

/* ── 客户端单例（按密钥指纹缓存）──────────────────────────────── */

interface ClientCache {
  fp: string;
  client: OcrClient;
}

let cache: ClientCache | null = null;

/**
 * 按「密钥 + 地域」的指纹缓存客户端。
 *
 * 为什么不只缓存一个实例：管理员在设置页换了密钥，旧实例仍然把旧密钥吃在内存里，
 * 于是"我已经改了密钥，怎么还是报欠费"。指纹变了就重建，指纹没变就复用
 * （每张票都 new 一个客户端会白白多一轮 TLS 握手）。
 */
function clientFor(cfg: OcrRuntimeConfig): OcrClient {
  const fp = createHash('sha1').update(`${cfg.secretId}|${cfg.secretKey}|${cfg.region}`).digest('hex');
  if (cache && cache.fp === fp) return cache.client;
  const client = new ocr.v20181119.Client({
    credential: { secretId: cfg.secretId, secretKey: cfg.secretKey },
    region: cfg.region,
    profile: {
      httpProfile: { reqTimeout: REQ_TIMEOUT_SECONDS, endpoint: 'ocr.tencentcloudapi.com' },
      // 中文票面，让它按 zh-CN 打日志，排查时看得懂
      language: 'zh-CN',
    },
  });
  cache = { fp, client };
  return client;
}

/** 设置页保存后调用：下次请求必然重建（换密钥的场景） */
export function invalidateOcrClient(): void {
  cache = null;
}

/* ── 错误码翻译（只映射两类，其余统一 50203）────────────────── */

/** 腾讯云 code → 我们的 code。见 Spec §4.3 的映射表 */
const IMAGE_UNREADABLE = new Set([
  'FailedOperation.ImageBlur',
  'FailedOperation.ImageDecodeFailed',
  'FailedOperation.OcrFailed',
  'FailedOperation.UnsupportedInvoice',
  'FailedOperation.UnsupportedInvioce', // 官方文档里的历史拼写错误，线上真的会返回
]);

const SERVICE_NOT_AVAILABLE = new Set([
  'ResourceUnavailable.InArrears',
  'ResourceUnavailable.ResourcePackageRunOut',
  'FailedOperation.UnOpenError',
  'AuthFailure.SecretIdNotFound',
  'AuthFailure.SignatureFailure',
]);

const FILE_TOO_LARGE = new Set(['LimitExceeded.TooLargeFileError']);

interface OcrSdkError {
  code?: string;
  message?: string;
  requestId?: string;
  traceId?: string;
  httpCode?: number;
}

function looksLikeTimeout(err: OcrSdkError): boolean {
  const text = `${err.code ?? ''} ${err.message ?? ''}`;
  return (
    err.httpCode === 504 ||
    err.httpCode === 408 ||
    /timeout|timedout|timed out|ETIMEDOUT|ESOCKETTIMEDOUT|ECONNRESET/i.test(text)
  );
}

/**
 * SDK 异常 → 我们的错误码。
 *
 * 硬规矩（`http.ts` 的铁律）：响应体里**不得出现**腾讯云的内部 code
 * （`FailedOperation.ImageBlur` 这种词对用户毫无意义，还会被当成系统故障）。
 * 内部 code 只允许留在服务端日志与 `ocr_request_id` 里。
 */
function translateOcrError(e: unknown, opts: { ofd?: boolean } = {}): AppError {
  const err = (e ?? {}) as OcrSdkError;
  const code = typeof err.code === 'string' ? err.code : '';

  if (FILE_TOO_LARGE.has(code)) {
    return new AppError(
      41301,
      '这张图太大了，识别上限约 7.5MB（PDF 请先压缩或拆页，图片请先压缩再传）。',
      413,
      { field: 'file' },
    );
  }
  if (SERVICE_NOT_AVAILABLE.has(code)) {
    return new AppError(
      50202,
      '发票识别服务没开通或已欠费。到腾讯云控制台开通「文字识别 OCR」后重试。',
      502,
    );
  }
  if (IMAGE_UNREADABLE.has(code)) {
    return new AppError(
      42208,
      opts.ofd
        /* OFD 这条单独给话：通用票据识别只认数电票 OFD 的**第一页**，
           而且旧版式/加密签名的 OFD 会直接解码失败。说清"另存 PDF"这一条出路，
           比让用户反复重传同一份文件强。 */
        ? '这份 OFD 没识别出来。OFD 只支持数电票（增值税电子发票、铁路电子客票等）的第一页；换一份或先在电子税务局另存为 PDF 再传。'
        : '这张票没认出来（图片模糊或版式不支持）。换一张清晰的，或用「手工录入」先把票号记下来。',
      422,
      { field: 'file' },
    );
  }
  if (looksLikeTimeout(err)) {
    return new AppError(50204, '识别超时了。网络慢或图片太大，压缩后再传一次。', 504);
  }
  // 其余一律 50203，并把请求号带上 —— 用户找腾讯云对账时只能靠它
  const rid = err.requestId ? `（请求号 ${err.requestId}）` : '';
  return new AppError(
    50203,
    `识别服务这次没返回结果${rid}。稍后重试一次；连续失败把请求号告诉管理员。`,
    502,
  );
}

/* ── 入参准备：base64 与（必要时）压缩 ───────────────────────── */

export interface PreparedPayload {
  base64: string;
  /** 压缩过就在 warnings 里说一句：压过的图小字识别率会下降 */
  warning: string | null;
}

function isPdf(mime: string): boolean {
  return mime === 'application/pdf';
}

/**
 * OFD 与 PDF 一样是**版式文档**，不是位图：sharp 压不动它（它只会解出第一页的位图，
 * 反而丢掉文本层）。所以这条按"版式文档"处理——不做压缩，也不会因为超限去走图片分支。
 */
function isOfd(mime: string): boolean {
  return mime === 'application/ofd';
}

/** 版式文档（PDF / OFD）：体积超了只能让用户自己处理，这里没有可靠的瘦身手段 */
function isLayoutDoc(mime: string): boolean {
  return isPdf(mime) || isOfd(mime);
}

/** sharp 的调用签名（它的默认导出是函数，命名空间不是） */
type SharpFactory = (typeof import('sharp'))['default'];

/**
 * 按需加载 sharp。它已在依赖与 serverExternalPackages 里，但只有
 * "图片超限要压缩"和"测试连接造样例图"这两条冷路径需要它，
 * 不放在模块顶层：否则连纯文本发票的识别也要先付一次原生库加载。
 */
async function loadSharp(): Promise<SharpFactory | null> {
  try {
    const mod = await import('sharp');
    return (mod.default ?? mod) as unknown as SharpFactory;
  } catch {
    return null;
  }
}

/**
 * 图片超限时用 sharp 逐轮压缩（Spec §12-5）。
 *
 * 只在**超限时**才压：压缩会降低小字识别率，而发票上的税额、税号恰恰是小字。
 * 三轮都压不下去就老实报 41301 —— 拿一张糊图去识别，结果是"识别成功但金额错了"，
 * 那种错比"上传失败"难发现得多。
 */
async function compressImage(buf: Buffer): Promise<{ buf: Buffer; notes: string[] } | null> {
  const sharp = await loadSharp();
  if (!sharp) return null;
  const rounds: Array<{ maxEdge: number; quality: number }> = [
    { maxEdge: 4000, quality: 82 },
    { maxEdge: 4000, quality: 60 },
    { maxEdge: 2000, quality: 60 },
  ];
  for (const r of rounds) {
    try {
      const out = await sharp(buf)
        .rotate()
        .resize({ width: r.maxEdge, height: r.maxEdge, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: r.quality })
        .toBuffer();
      if (out.byteLength * 4 <= BASE64_TARGET_BYTES * 3) {
        return { buf: out, notes: [`原图 ${(buf.byteLength / 1024 / 1024).toFixed(1)}MB，已压缩后识别`] };
      }
    } catch {
      return null;
    }
  }
  return null;
}

async function preparePayload(buf: Buffer, mime: string): Promise<PreparedPayload> {
  const fits = (b: Buffer): boolean => Math.ceil(b.byteLength / 3) * 4 <= MAX_BASE64_BYTES;
  if (fits(buf)) return { base64: buf.toString('base64'), warning: null };

  if (!isLayoutDoc(mime)) {
    const compressed = await compressImage(buf);
    if (compressed && fits(compressed.buf)) {
      return { base64: compressed.buf.toString('base64'), warning: compressed.notes[0] ?? null };
    }
  }
  const mb = (buf.byteLength / 1024 / 1024).toFixed(1);
  throw new AppError(
    41301,
    isLayoutDoc(mime)
      ? `这个文件有 ${mb}MB，识别上限约 7.5MB，先压缩或拆页再传。`
      : `这张图有 ${mb}MB，识别上限约 7.5MB，压缩后再传。`,
    413,
    { field: 'file' },
  );
}

/* ── 识别 ─────────────────────────────────────────────────── */

export interface RecognizeOutcome extends MapResult {
  /** 压缩过时的提示，进 UploadResult.warnings */
  warnings: string[];
}

/**
 * 识别一张图 / 一份 PDF。
 *
 * 入参是**已经落盘后读出来的字节**：调用方（route）负责流式落盘与类型判定，
 * 这里只在需要时才把 ≤7.5MB 读进内存（10MB 是 base64 之后的上限）。
 *
 * 抛错一律是 `AppError`：未配置 409 / 图不清晰 42208 / 欠费 50202 / 超时 50204 / 其它 50203。
 */
export async function recognizeInvoice(buf: Buffer, mime: string): Promise<RecognizeOutcome> {
  const cfg = await requireOcrConfig();
  const client = clientFor(cfg);
  const prepared = await preparePayload(buf, mime);

  let res: Awaited<ReturnType<OcrClient['RecognizeGeneralInvoice']>>;
  try {
    res = await client.RecognizeGeneralInvoice({
      ImageBase64: prepared.base64,
      // Types 不传 = 识别全部类型（我们靠 Type 自己筛），传了反而会改变分票行为
      EnablePdf: true,
      EnableMultiplePage: true,
      EnableOther: true,
      // 这三个都不需要：省流量省时间（默认就近似关闭，仍显式写，避免服务端默认值变更）
      EnableCutImage: false,
      EnableItemPolygon: false,
      EnableSeal: false,
    });
  } catch (e) {
    if (e instanceof AppError) throw e;
    // 内部 code 只进日志，不上响应
    console.error('[ocr] RecognizeGeneralInvoice 失败', (e as OcrSdkError)?.code, (e as OcrSdkError)?.requestId);
    throw translateOcrError(e, { ofd: isOfd(mime) });
  }

  const mapped = mapRecognizeResult(res);
  const warnings = prepared.warning ? [prepared.warning] : [];
  return { ...mapped, warnings };
}

/**
 * 「测试连接」：真的用一张内置样例图调一次。
 *
 * 只做密钥校验（本地算签名）不够 —— 子账号经常没有 OCR 权限，
 * 签名能算出来但请求 403，而用户以为配好了，直到开票旺季才发现。
 *
 * 样例是一张**纯白图片**：它一定识别不出票据，所以：
 *   - 返回 42208（没认出来）= 服务通了，密钥也对 → 算成功
 *   - 返回 50202（欠费 / 没开通）= 失败，原样抛给用户
 * 这样既不消耗识别成功额度，又能证明"账号 + 权限 + 网络"三件事都通。
 */
export async function testOcrConnection(): Promise<{ ok: true; latency_ms: number; note: string }> {
  const cfg = await requireOcrConfig();
  const client = clientFor(cfg);

  let sample: Buffer;
  const sharp = await loadSharp();
  if (sharp) {
    sample = await sharp({ create: { width: 240, height: 140, channels: 3, background: { r: 255, g: 255, b: 255 } } })
      .png()
      .toBuffer();
  } else {
    sample = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/AH+iF0AAAAASUVORK5CYII=',
      'base64',
    );
  }

  const started = Date.now();
  try {
    await client.RecognizeGeneralInvoice({ ImageBase64: sample.toString('base64'), EnablePdf: true });
  } catch (e) {
    const translated = translateOcrError(e);
    // 42208 = 调用通了但白图没票据，这是预期结果，不算失败
    if (translated.code === 42208) {
      return { ok: true, latency_ms: Date.now() - started, note: '接口调通了（样例是空白图，没有识别出票据，正常）。' };
    }
    throw translated;
  }
  return {
    ok: true,
    latency_ms: Date.now() - started,
    note: '接口调通了，样例图也能识别。现在可以批量上传发票了。',
  };
}
