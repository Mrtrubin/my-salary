/**
 * 结算周期领域纯函数（PLAN-001 阶段2）。
 *
 * 双模式：
 *  - monthly（自然月）：周期 = 当月 1 号 → 当月最后一天；次月 1 号为下一周期第一天。
 *  - custom（锚点式）：起始日 startDay(1~28)，周期 = 本月起始日 → 次月起始日前一天；
 *    次月起始日为下一周期第一天。例：startDay=21 → 每月 21 日至次月 20 日。
 *
 * 统一抽象：monthly 等价于 custom + startDay=1，故内部按 settlementType 分派。
 * 所有日期以 `YYYY-MM-DD` 字符串表示，全程按「日历日」纯整数运算，避免时区/浮点误差。
 */
import { ApiError, ApiErrorCode } from "@/lib/api/contracts/errors";

export type SettlementType = "monthly" | "custom";

/** 结算周期区间（含端点），日期为 `YYYY-MM-DD`。 */
export interface PeriodRange {
  /** 周期起始日（含）。 */
  start: string;
  /** 周期截止日（含）。 */
  end: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function assertDate(date: string): void {
  if (!DATE_RE.test(date)) {
    throw new ApiError(ApiErrorCode.INVALID_INPUT, `日期须为 YYYY-MM-DD：${date}`);
  }
}

function normalizeStartDay(type: SettlementType, startDay: number): number {
  if (type === "monthly") return 1;
  if (!Number.isInteger(startDay) || startDay < 1 || startDay > 28) {
    throw new ApiError(ApiErrorCode.INVALID_INPUT, `自定义周期起始日须为 1~28：${startDay}`);
  }
  return startDay;
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
  const zeroBased = (year * 12 + (month - 1)) + delta;
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

/**
 * 从 `seedDate`（含）起，按团队结算周期依次枚举连续周期区间，直到覆盖 `asOfDate`（含）。
 * 返回的周期按时间正序排列，相邻周期间无空隙、无重叠。用于「全量 recheck」补齐历史未结算周期。
 * 例：monthly 且 seed=2026-08-15, asOf=2026-09-10 → [08-01..08-31, 09-01..09-30]。
 */
export function listPeriodRangesFrom(
  type: SettlementType,
  startDay: number,
  seedDate: string,
  asOfDate: string,
): PeriodRange[] {
  assertDate(seedDate);
  assertDate(asOfDate);
  const ranges: PeriodRange[] = [];
  let cursor: string = seedDate;
  // 防御：极端异常日期最多迭代 1200 个周期（约 100 年），避免死循环。
  for (let i = 0; i < 1200; i += 1) {
    if (cursor > asOfDate) break;
    const range = getPeriodRange(type, startDay, cursor);
    ranges.push(range);
    cursor = nextDay(range.end);
  }
  return ranges;
}

/**
 * 计算包含指定日期 `date` 的当前结算周期区间。
 * monthly：当月 1 号 → 当月最后一天。
 * custom：以 startDay 为锚点，date >= 当月 startDay 则周期从当月 startDay 起；
 *         否则周期从上月 startDay 起。截止日为下一周期起始日的前一天。
 */
export function getPeriodRange(type: SettlementType, startDay: number, date: string): PeriodRange {
  assertDate(date);
  const day = normalizeStartDay(type, startDay);
  const [y, m, d] = parts(date);

  if (type === "monthly") {
    return { start: toDate(y, m, 1), end: toDate(y, m, daysInMonth(y, m)) };
  }

  // custom：确定周期起始月。
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

/**
 * 是否为「下一结算周期的第一天」（即触发上一周期结算的日子）。
 * monthly：date 是某月 1 号。
 * custom：date 的「日」等于 startDay。
 */
export function isPeriodFirstDay(type: SettlementType, startDay: number, date: string): boolean {
  assertDate(date);
  const day = normalizeStartDay(type, startDay);
  const [, , d] = parts(date);
  return d === day;
}

/**
 * 给定「下一周期第一天」`date`，返回刚结束的上一周期区间 [起, 止]。
 * 若 date 并非周期第一天，仍按语义返回：上一周期 = date 前一天所在周期。
 * monthly：上一自然月。custom：上月 startDay → 本月 startDay 前一天。
 */
export function getPreviousPeriodRange(type: SettlementType, startDay: number, date: string): PeriodRange {
  assertDate(date);
  normalizeStartDay(type, startDay);
  // 上一周期一定包含 date 的前一天。
  return getPeriodRange(type, startDay, prevDay(date));
}

/** 判断某日期是否落在周期区间内（含端点）。 */
export function isDateInPeriod(date: string, period: PeriodRange): boolean {
  assertDate(date);
  return date >= period.start && date <= period.end;
}