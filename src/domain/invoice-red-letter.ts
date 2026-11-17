/**
 * 红字票（红冲票）→ 它冲的是哪一张蓝票。
 *
 * 为什么要单独一个文件：这段逻辑只有一件职责——**从票面文字里认出原发票号码**，
 * 而它是全流程里唯一"读错了会改到别人账上"的地方（认错号码 → 提示用户把另一张
 * 无辜的票标成已冲红）。所以它必须是纯函数、能被逐条单测，而不是埋在 OCR 映射里。
 *
 * 票面上的写法至少有四种，同一个意思：
 *   被红冲蓝字数电发票号码：25112000000012345678
 *   被红冲蓝字发票号码：044031900111-12345678     ← 纸质专票红字，前面是代码
 *   对应正数发票号码：25112000000012345678
 *   原发票号码：12345678
 *
 * 「对应正数发票号码」这个说法来自税控开票软件，纸质红字专票上就是这么印的；
 * 「被红冲蓝字数电发票号码」是全电红字发票的标准写法。三种标签都要认，
 * 因为用户手里的票是这十年里陆续开出来的，不是只有一种版式。
 */
import { normalizeInvoiceNo, toHalfWidth } from './invoice-common';

/**
 * 标签按**特异性**排序：越具体的越先匹配。
 *
 * 「原发票号码」放在最后：它是最短、最容易在别的句子里蹭到的词
 * （比如备注里写「原发票号码见附件」），而前面几个标签几乎只出现在红字票上。
 */
export const ORIGINAL_INVOICE_LABELS = [
  '被红冲蓝字数电发票号码',
  '被红冲蓝字发票号码',
  '被红冲蓝字发票',
  '对应正数发票号码',
  '对应的正数发票号码',
  '原蓝字发票号码',
  '原发票号码',
] as const;

/** 标签后面允许出现的分隔符：冒号（全角/半角）、等号、空格、井号 */
const SEP = '[\\s:：=#]*';

/**
 * 号码本体：6–32 位字母数字，中间可以用 `-` 连接（纸质票的「代码-号码」写法）。
 * 不用 `\d`：全电号码是纯数字，但规范化之后字母也合法，`\d` 会漏掉字母混排的脏识别。
 */
const NO_BODY = '[0-9A-Za-z][0-9A-Za-z\\-]{5,40}';

export interface OriginalRef {
  /** 规范化后的原发票号码；认不出为 null */
  invoiceNo: string | null;
  /** 命中的标签原文（给界面/日志看：这个结论是从哪句话读出来的） */
  label: string | null;
  /** 原始片段（含标签），一段话拿去做 tooltip */
  snippet: string | null;
}

/**
 * 从若干段文字里抽原发票号码。**按传入顺序找，第一个认出来的赢**。
 *
 * 传进来的一般是 `[结构化字段, 备注, 票面标题...]`：结构化字段（如果接口给了）
 * 一定比备注可靠，所以顺序由调用方决定，这里不做猜测。
 *
 * 为什么"第一个赢"而不是"全部收集"：一张红字票只冲一张蓝票，票面上出现两个
 * 合格号码只可能是识别噪声（比如把别的号码也按标签抓了）。取第一个是保守选择——
 * 认错一个号码的代价，比少提示一次「要不要标已冲红」大得多。
 */
export function extractOriginalInvoiceNo(texts: Array<string | null | undefined>): OriginalRef {
  const empty: OriginalRef = { invoiceNo: null, label: null, snippet: null };
  for (const raw of texts) {
    if (!raw || typeof raw !== 'string') continue;
    const text = toHalfWidth(raw).replace(/[\u0000-\u001f\u007f]/g, ' ');
    for (const label of ORIGINAL_INVOICE_LABELS) {
      // 标签本身也可能被识别成半角（"："→":"），toHalfWidth 已经处理；标签内部不留空格
      const re = new RegExp(`${label}${SEP}(${NO_BODY})`);
      const m = re.exec(text);
      if (!m) continue;
      const body = m[1] ?? '';
      // 纸质票写成「044031900111-12345678」：代码在左、号码在右，取右段
      const tail = body.includes('-') ? (body.split('-').filter(Boolean).pop() ?? body) : body;
      const no = normalizeInvoiceNo(tail);
      if (!no) continue;
      return { invoiceNo: no, label, snippet: m[0] };
    }
  }
  return empty;
}

/**
 * 结构化字段里可能放原号码的键名（腾讯云不同票种、不同版本各叫一个）。
 *
 * 这里只是"先试试这些键"，**认不出的最终都靠 `extractOriginalInvoiceNo` 读文本**：
 * 官方文档里 `VatElectronicInfo` 没有明确的"原发票号码"字段，
 * 把识别完全押在一个猜出来的键名上，等于让它悄悄永远返回 null。
 */
export const ORIGINAL_INVOICE_KEYS = [
  'OriginalInvoiceNumber',
  'OriginalInvoiceNo',
  'OriginalNumber',
  'BlueInvoiceNumber',
  'RelatedInvoiceNumber',
  'RelatedInvoiceNo',
] as const;
