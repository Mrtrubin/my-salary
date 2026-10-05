/**
 * 收支明细领域工具（纯函数，便于单测）。
 *
 * 记账口径：不使用单独字段，金额 amount_cents >= 0 表示收入，< 0 表示支出。
 */
import dayjs from "dayjs";

export type LedgerDirection = "income" | "expense";

/** 金额（元）+ 方向 → 带符号分。金额须 > 0，非法返回 null。 */
export function toSignedCents(amountYuan: number | null, direction: LedgerDirection): number | null {
  if (amountYuan === null || !Number.isFinite(amountYuan) || amountYuan <= 0) return null;
  const cents = Math.round(amountYuan * 100);
  return direction === "expense" ? -cents : cents;
}

/** 带符号分 → 方向（>= 0 收入，< 0 支出）。 */
export function directionOf(amountCents: number): LedgerDirection {
  return amountCents >= 0 ? "income" : "expense";
}

/** 当月起止日（YYYY-MM-DD）。 */
export function currentMonthRange(now = dayjs()): { start: string; end: string } {
  return {
    start: now.startOf("month").format("YYYY-MM-DD"),
    end: now.endOf("month").format("YYYY-MM-DD"),
  };
}

/** 本年起止日（YYYY-MM-DD）。 */
export function currentYearRange(now = dayjs()): { start: string; end: string } {
  return {
    start: now.startOf("year").format("YYYY-MM-DD"),
    end: now.endOf("year").format("YYYY-MM-DD"),
  };
}
