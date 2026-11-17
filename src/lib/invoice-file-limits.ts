import { fileSize } from './format';

/**
 * 发票文件的准入规则——**两条链路、两个上限，故意不同**。
 *
 * | 链路 | 上限 | 为什么 |
 * |---|---|---|
 * | 批量上传（要跑 OCR） | 原始 ≈**7.5MB** | 图片得 base64 塞进请求体，编码膨胀 1/3，腾讯云那条接口的 body 上限是 10MB |
 * | 补原件（只存文件） | **20MB** | 纯字节流，按服务端真实容量给 |
 *
 * 写成测试是为了挡"统一一下"这种好心的改动：把补原件压到 7.5MB，用户的高清扫描件
 * 会在最后一步被拒；把批量上传放到 20MB，请求体会超限、错误信息还来自云厂商。
 */
export const ATTACH_MAX_BYTES = 20 * 1024 * 1024;

/** OCR 那条链路的原始字节上限（base64 后 ≤10MB 折算回来） */
export const OCR_MAX_BYTES = 7.5 * 1024 * 1024;

/** 与服务端 `INVOICE_ACCEPT_EXTS` 同一份名单：docx/xlsx 不是发票原件，ofd 是（数电票） */
const INVOICE_EXT_RE = /\.(pdf|ofd|jpe?g|png)$/i;

export type AttachCheck = { ok: true } | { ok: false; reason: string };

/** 补原件的准入：类型 + 上限 + 空文件 */
export function checkInvoiceAttach(name: string, size: number): AttachCheck {
  if (!INVOICE_EXT_RE.test(name)) {
    return {
      ok: false,
      reason: `「${name}」不是 PDF / OFD / JPG / PNG。Word / Excel 不是发票原件，GIF / WEBP 请转成 JPG。`,
    };
  }
  if (size <= 0) {
    return { ok: false, reason: '这份是 0 字节，文件可能是空的——重新扫一次再传。' };
  }
  if (size > ATTACH_MAX_BYTES) {
    return {
      ok: false,
      reason: `这份有 ${fileSize(size)}，超过 20MB。压一下再传，或者拆成两页分别传。`,
    };
  }
  return { ok: true };
}

export function mb(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1);
}

/**
 * PDF 超 OCR 上限：物理限制（没有可靠的 Node 端 PDF 瘦身库），提前拦下来，省一次往返。
 * 只拦 PDF —— 图片在服务端会先压缩，7.5MB 的 JPG 多半还能过。
 *
 * 参数收 `{ name, size }` 而不是 `File`：这样这条规则在 node 里能直接测，
 * 不用为了造一个 8MB 的假 File 去 `Object.defineProperty`。
 */
export function pdfTooBigForOcr(f: { name: string; size: number }): boolean {
  return /\.pdf$/i.test(f.name) && f.size > OCR_MAX_BYTES;
}
