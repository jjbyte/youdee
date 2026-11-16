import { describe, it, expect } from 'vitest';
import { ATTACH_MAX_BYTES, checkInvoiceAttach, OCR_MAX_BYTES, pdfTooBigForOcr } from '../src/lib/invoice-file-limits';

/**
 * 「补原件」的准入判定。
 *
 * 钉两件事：
 *   1. 20MB 这个数（和批量上传的 7.5MB 不同——那条要 base64 进 OCR 请求体）；
 *   2. 边界是「等于 20MB 能过、超一个字节不能过」，不是"大约"。
 * 写成测试是因为这个数字一旦被谁"统一"掉，大扫描件会在最后一步被服务端拒收，
 * 而用户已经在抽屉里等了半天。
 */
describe('checkInvoiceAttach — 补原件只收 pdf/jpg/png，上限 20MB', () => {
  it('三种允许的类型都能过（大小写不敏感）', () => {
    expect(checkInvoiceAttach('发票.pdf', 1024).ok).toBe(true);
    expect(checkInvoiceAttach('scan.JPG', 1024).ok).toBe(true);
    expect(checkInvoiceAttach('scan.jpeg', 1024).ok).toBe(true);
    expect(checkInvoiceAttach('scan.PNG', 1024).ok).toBe(true);
  });

  it('OFD / docx 被拒，并告诉用户怎么办（另存为 PDF）', () => {
    const r = checkInvoiceAttach('发票.ofd', 1024);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('另存为 PDF');
  });

  it('正好 20MB 能过，多一个字节不能过', () => {
    expect(checkInvoiceAttach('a.pdf', ATTACH_MAX_BYTES).ok).toBe(true);
    const over = checkInvoiceAttach('a.pdf', ATTACH_MAX_BYTES + 1);
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.reason).toContain('20MB');
  });

  it('空文件先拦下：0 字节传上去只会得到一张打不开的"原件"', () => {
    const r = checkInvoiceAttach('a.pdf', 0);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('0 字节');
  });
});

/**
 * 两个上限必须不同。这条测试就是那道闸：谁想"统一一下"，先看到这里的理由。
 */
describe('pdfTooBigForOcr — 批量上传的 PDF 上限 7.5MB', () => {
  it('7.5MB 正好能过，多一字节不能过', () => {
    expect(pdfTooBigForOcr({ name: 'a.pdf', size: OCR_MAX_BYTES })).toBe(false);
    expect(pdfTooBigForOcr({ name: 'a.pdf', size: OCR_MAX_BYTES + 1 })).toBe(true);
  });

  it('只拦 PDF：同样体积的 JPG 不在这里拦（服务端会先压）', () => {
    expect(pdfTooBigForOcr({ name: 'a.jpg', size: OCR_MAX_BYTES * 3 })).toBe(false);
  });

  it('补原件的上限比批量上传宽松：20MB 的 PDF 走补原件能过、走批量上传不能过', () => {
    const size = 15 * 1024 * 1024;
    expect(checkInvoiceAttach('a.pdf', size).ok).toBe(true);
    expect(pdfTooBigForOcr({ name: 'a.pdf', size })).toBe(true);
  });
});
