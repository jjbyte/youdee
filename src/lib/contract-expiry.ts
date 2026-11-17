/**
 * 合同终止日期的人话与色相（列表、抽屉、工作台三处共用）。
 *
 * 单独一个文件是因为这句文案要在三个地方说，而**三处说法不一致**是最容易出的错：
 * 列表写「剩 3 天」、工作台写「即将到期」、抽屉写「快过期了」，用户会以为是三件事。
 * 判定阈值也只有一处（domain/contract 的窗口天数），这里只负责措辞与颜色。
 *
 * 日期比较全走 `daysUntilDate`（UTC 零点相减）：本地时区参与进来，
 * 「明天到期」在 UTC+8 的机器上会算成 0 天，而差一天的错误没人会去查。
 */
import { CONTRACT_EXPIRING_WINDOW_DAYS, daysUntilDate } from '@/domain/contract';
import { todayISO } from './format';

export type ExpiryTone = 'expired' | 'soon' | 'normal';

export interface ExpiryInfo {
  /** 负数 = 已经过期 */
  daysLeft: number;
  tone: ExpiryTone;
  /** 一句话：已过期 5 天 / 今天到期 / 还剩 12 天 / 还有 8 个月 */
  text: string;
}

/**
 * @param endOn yyyy-mm-dd；null / 格式不对返回 null（没有终止日期 = 非周期性合同）
 * @param today 只在单测里传；界面上永远是真实的今天（默认值就地算）
 */
export function contractExpiry(endOn: string | null | undefined, today: string = todayISO()): ExpiryInfo | null {
  if (!endOn) return null;
  const daysLeft = daysUntilDate(endOn, today);
  if (daysLeft === null) return null;

  if (daysLeft < 0) {
    return { daysLeft, tone: 'expired', text: `已过期 ${Math.abs(daysLeft)} 天` };
  }
  if (daysLeft === 0) return { daysLeft, tone: 'expired', text: '今天到期' };
  if (daysLeft <= CONTRACT_EXPIRING_WINDOW_DAYS) {
    return { daysLeft, tone: 'soon', text: `还剩 ${daysLeft} 天` };
  }
  // 一个月以上没必要精确到天：写「还有 214 天」反而看不出远近
  const months = Math.round(daysLeft / 30);
  return { daysLeft, tone: 'normal', text: `还有约 ${months} 个月` };
}
