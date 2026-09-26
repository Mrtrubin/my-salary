/**
 * 主播当日业绩的三种「情况」。
 *
 * 1. normal  正常流水：录入绩效点/业绩。
 * 2. rest    休息：无流水但不扣薪水（可附休息备注）。
 * 3. offair  停播：无流水，结算时按「初始保底 ÷ 26」生成「停播」扣款调整项。
 *
 * 落库沿用 anchor_revenue_records 的 (no_perf, no_perf_note) 两字段表达：
 * 停播以固定备注 OFF_AIR_NOTE 识别，其余无绩效记录视为休息。
 */

export type MemberPerfStatus = "normal" | "rest" | "offair";

/** 休息：无流水但不扣薪水（备注缺省值）。 */
export const REST_NOTE = "休息";
/** 停播：无流水，结算按「初始保底 ÷ 26」扣款；同时作为停播调整项的固定名称。 */
export const OFF_AIR_NOTE = "停播";

/** 由落库字段还原三种情况。 */
export function statusFromRecord(noPerf: boolean, note: string | null | undefined): MemberPerfStatus {
  if (!noPerf) return "normal";
  return (note ?? "").trim() === OFF_AIR_NOTE ? "offair" : "rest";
}

/** 提交时把三种情况映射为落库的 no_perf / no_perf_note。 */
export function recordFromStatus(
  status: MemberPerfStatus,
  restNote?: string,
): { noPerf: boolean; noPerfNote: string | null } {
  if (status === "normal") return { noPerf: false, noPerfNote: null };
  if (status === "offair") return { noPerf: true, noPerfNote: OFF_AIR_NOTE };
  return { noPerf: true, noPerfNote: (restNote ?? "").trim().slice(0, 20) || REST_NOTE };
}
