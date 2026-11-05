/**
 * 电话号码的清洗与判据（**唯一一份**）。
 *
 * 为什么单独成文件：税号那一套（invoice-info）和账号手机号是两件事，
 * 但"怎么把一段从微信里复制来的号码变成能存的样子"必须是同一套——
 * 两处各写一遍正则，最后一定出现"编辑供应商放行、编辑账号报错"这种
 * 同一个号码两种说法的情况。
 *
 * 刻意不做的事：**不猜运营商、不校验号段、不去掉 +86**。
 * 座机、分机、境外号都要能存进去；这个系统不该假装知道电话公司怎么编号。
 */

/** 全角字符 → 半角。从微信/Word 里复制来的号码常常是全角的 */
export function toHalfWidth(s: string): string {
  return s
    .replace(/[\uFF01-\uFF5E]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, ' ');
}

/**
 * 清理一个电话号码：全角转半角、折叠连续空白、去首尾空格。
 * 保留 `+ - ( ) 空格`——它们是号码的一部分（区号、分机、国际码）。
 */
export function cleanPhone(raw: unknown): string {
  return toHalfWidth(String(raw ?? ''))
    .replace(/\s+/g, ' ')
    .trim();
}

/** 只数数字，用来判"太短了"；不判号段 */
export function phoneDigitCount(s: string): number {
  return s.replace(/\D/g, '').length;
}

/**
 * 7 位是下限：座机最短 8 位（含区号）、手机 11 位，分机号 3–4 位但要跟主号一起写。
 * 少于 7 位存进去的基本都是手误，不是特殊号码。
 */
export const PHONE_MIN_DIGITS = 7;
