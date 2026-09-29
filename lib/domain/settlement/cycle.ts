/**
 * 结算区间领域纯函数。
 *
 * 系统不再维护「结算周期配置」：主播流水 / 主持流水 / 工资核算统一使用
 * 管理员选择的任意 [start, end] 日历日区间（含端点）。本模块提供区间类型、
 * 日期运算与常用快捷区间（当日 / 昨日 / 本周 / 本月）。
 *
 * 所有日期以 `YYYY-MM-DD` 字符串表示，全程按「日历日」纯整数运算，避免时区/浮点误差。
 */
import { ApiError, ApiErrorCode } from "@/lib/api/contracts/errors";

/** 结算/查询区间（含端点），日期为 `YYYY-MM-DD`。 */
export interface PeriodRange {
  /** 区间起始日（含）。 */
  start: string;
  /** 区间截止日（含）。 */
  end: string;
}

/** 常用快捷区间。 */
export type DateRangePreset = "today" | "yesterday" | "thisWeek" | "thisMonth";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function assertDate(date: string): void {
  if (!DATE_RE.test(date)) {
    throw new ApiError(ApiErrorCode.INVALID_INPUT, `日期须为 YYYY-MM-DD：${date}`);
  }
}

/** 拆分 `YYYY-MM-DD` 为 [year, month(1~12), day]。 */
function parts(date: string): [number, number, number] {
  const [y, m, d] = date.split("-").map((s) => Number(s));
  return [y, m, d];
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function toDate(y: number, m: number, d: number): string {
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** 某年某月的天数（1~12）。 */
export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/** 月份加减：给定 (year, month1~12) 偏移 delta 个月，返回规范化的 [year, month]。 */
function addMonths(year: number, month: number, delta: number): [number, number] {
  const zeroBased = year * 12 + (month - 1) + delta;
  const ny = Math.floor(zeroBased / 12);
  const nm = (zeroBased % 12) + 1;
  return [ny, nm];
}

/** 前一天（跨月/跨年安全）。 */
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

/** 日历日加减（跨月/跨年安全），`delta` 可为负。 */
export function addDays(date: string, delta: number): string {
  assertDate(date);
  let cursor = date;
  if (delta >= 0) {
    for (let i = 0; i < delta; i += 1) cursor = nextDay(cursor);
  } else {
    for (let i = 0; i < -delta; i += 1) cursor = prevDay(cursor);
  }
  return cursor;
}

/** 判断某日期是否落在区间内（含端点）。 */
export function isDateInPeriod(date: string, period: PeriodRange): boolean {
  assertDate(date);
  return date >= period.start && date <= period.end;
}

/** 本地日历当日 `YYYY-MM-DD`。 */
export function localToday(asOf: Date = new Date()): string {
  return toDate(asOf.getFullYear(), asOf.getMonth() + 1, asOf.getDate());
}

/** 以「周一」为一周起点，返回该日期所在自然周的 [周一, 周日]。 */
function weekRange(date: string): PeriodRange {
  const [y, m, d] = parts(date);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=周日
  const start = addDays(date, -((weekday + 6) % 7));
  return { start, end: addDays(start, 6) };
}

/** 解析常用快捷区间；`asOf` 缺省取本地当日（`YYYY-MM-DD`）。 */
export function getPresetRange(preset: DateRangePreset, asOf?: string): PeriodRange {
  const today = asOf ?? localToday();
  assertDate(today);
  const [y, m] = parts(today);
  switch (preset) {
    case "today":
      return { start: today, end: today };
    case "yesterday": {
      const day = prevDay(today);
      return { start: day, end: day };
    }
    case "thisWeek":
      return weekRange(today);
    case "thisMonth":
      return { start: toDate(y, m, 1), end: toDate(y, m, daysInMonth(y, m)) };
  }
}
