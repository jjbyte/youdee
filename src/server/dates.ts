/**
 * 日期工具（只处理 yyyy-mm-dd 字符串，不引入时区）。
 *
 * 为什么不用 new Date().setDate()：服务端时区一变，10-01 可能变成 09-30，
 * 而价格生效日差一天就会让"今天有没有价"变成不确定的答案。
 */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function diffDays(from: string, to: string): number {
  const a = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10));
  const b = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}
