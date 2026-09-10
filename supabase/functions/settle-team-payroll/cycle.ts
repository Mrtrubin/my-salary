/**
 * 结算周期计算（Deno 版，与 lib/domain/settlement/cycle.ts 同口径）。
 * Edge Function 运行于 Deno，无法走 `@/` 别名与依赖 lib 层 ApiError，故内联一份。
 * 全程 `YYYY-MM-DD` 字符串纯整数运算，避免时区问题。
 */
export type SettlementType = "monthly" | "custom";

export interface PeriodRange {
  start: string;
  end: string;
}

function parts(date: string): [number, number, number] {
  const [y, m, d] = date.split("-").map(Number);
  return [y, m, d];
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function toDate(y: number, m: number, d: number): string {
  return `${y}-${pad(m)}-${pad(d)}`;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function addMonths(year: number, month: number, delta: number): [number, number] {
  const zeroBased = year * 12 + (month - 1) + delta;
  const ny = Math.floor(zeroBased / 12);
  const nm = (zeroBased % 12) + 1;
  return [ny, nm];
}

function prevDay(date: string): string {
  const [y, m, d] = parts(date);
  if (d > 1) return toDate(y, m, d - 1);
  const [py, pm] = addMonths(y, m, -1);
  return toDate(py, pm, daysInMonth(py, pm));
}

/** 后一天（跨月/跨年安全）。 */
export function nextDay(date: string): string {
  const [y, m, d] = parts(date);
  const max = daysInMonth(y, m);
  if (d < max) return toDate(y, m, d + 1);
  const [ny, nm] = addMonths(y, m, 1);
  return toDate(ny, nm, 1);
}

function normalizeStartDay(type: SettlementType, startDay: number): number {
  if (type === "monthly") return 1;
  if (!Number.isInteger(startDay) || startDay < 1 || startDay > 28) {
    throw new Error(`自定义周期起始日须为 1~28：${startDay}`);
  }
  return startDay;
}

/** 计算包含指定日期的当前结算周期区间（含端点）。 */
export function getPeriodRange(
  type: SettlementType,
  startDay: number,
  date: string,
): PeriodRange {
  const day = normalizeStartDay(type, startDay);
  const [y, m, d] = parts(date);

  if (type === "monthly") {
    return { start: toDate(y, m, 1), end: toDate(y, m, daysInMonth(y, m)) };
  }

  let sy = y;
  let sm = m;
  if (d < day) {
    [sy, sm] = addMonths(y, m, -1);
  }
  const start = toDate(sy, sm, day);
  const [ny, nm] = addMonths(sy, sm, 1);
  const end = prevDay(toDate(ny, nm, day));
  return { start, end };
}

/** 是否为下一结算周期第一天（触发上一周期结算的日子）。 */
export function isPeriodFirstDay(
  type: SettlementType,
  startDay: number,
  date: string,
): boolean {
  const day = normalizeStartDay(type, startDay);
  const [, , d] = parts(date);
  return d === day;
}

/** 给定下一周期第一天，返回刚结束的上一周期区间。 */
export function getPreviousPeriodRange(
  type: SettlementType,
  startDay: number,
  date: string,
): PeriodRange {
  normalizeStartDay(type, startDay);
  return getPeriodRange(type, startDay, prevDay(date));
}