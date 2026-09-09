/**
 * 工资引擎金额/比例纯工具函数。
 * 所有金额均为「分」的整数；比例为「基点」(bps)，10000 bps = 100%。
 * 计算全程使用整数运算避免浮点误差。
 */
import type { AmountInCents, RateInBps } from "@/lib/api/contracts/common";

const BPS_DENOMINATOR = 10000;

/** 校验输入为有限整数，否则抛错（避免脏数据进入计算）。 */
function assertInteger(value: number, name: string): void {
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new Error(`${name} 必须为整数，收到：${value}`);
  }
}

/**
 * 按基点比例计算金额并「向上取整到分」（规则3 服务费用）。
 * 使用整数运算：ceil(amount × bps / 10000)。
 */
export function applyRateCeil(
  amountInCents: AmountInCents,
  rateBps: RateInBps,
): AmountInCents {
  assertInteger(amountInCents, "amountInCents");
  assertInteger(rateBps, "rateBps");
  if (rateBps < 0) {
    throw new Error(`rateBps 不可为负：${rateBps}`);
  }
  const numerator = amountInCents * rateBps;
  // 对负数金额同样按数学向上取整（Math.ceil 语义）。
  return Math.ceil(numerator / BPS_DENOMINATOR);
}

/**
 * 按基点比例计算金额并「向下取整到分」（提成等场景）。
 * 使用整数运算：floor(amount × bps / 10000)。
 */
export function applyRateFloor(
  amountInCents: AmountInCents,
  rateBps: RateInBps,
): AmountInCents {
  assertInteger(amountInCents, "amountInCents");
  assertInteger(rateBps, "rateBps");
  if (rateBps < 0) {
    throw new Error(`rateBps 不可为负：${rateBps}`);
  }
  return Math.floor((amountInCents * rateBps) / BPS_DENOMINATOR);
}

/** 判断在职月序是否处于无责期（前 graceMonths 个月）。 */
export function isWithinGracePeriod(tenureMonth: number, graceMonths: number): boolean {
  assertInteger(tenureMonth, "tenureMonth");
  return tenureMonth >= 1 && tenureMonth <= graceMonths;
}