/**
 * 化妆师收益领域纯函数。
 *
 * 与主播/主持工资不同，化妆品类没有流水提成、没有服务费：
 *  - 基础收益：来自「化妆师管理-设置」（每人一个当前值）。
 *  - 总违约（≤0）、总奖励（≥0）：管理员在「工资核算-化妆师-新增记录」时手工填写。
 *  - 调整合计 = 总违约 + 总奖励。
 *  - 实发收益 = 基础收益 + 调整合计。
 *  - 到手收益 = 实发收益。
 *
 * 金额一律以「分」为单位的整数；允许实发/到手为负，不归零。
 */
import { ApiError, ApiErrorCode } from "@/lib/api/contracts/errors";
import type { AmountInCents } from "@/lib/api/contracts/common";

/** 化妆师收益计算输入（分）。 */
export interface MakeupPayrollInput {
  /** 基础收益（分，≥0）。 */
  baseIncomeInCents: AmountInCents;
  /** 总违约（分，≤0）。 */
  penaltyInCents?: AmountInCents;
  /** 总奖励（分，≥0）。 */
  rewardInCents?: AmountInCents;
}

/** 化妆师收益计算结果（分）。 */
export interface MakeupPayrollResult {
  /** 调整合计 = 总违约 + 总奖励。 */
  adjustmentInCents: AmountInCents;
  /** 实发收益 = 基础收益 + 调整合计。 */
  grossIncomeInCents: AmountInCents;
  /** 到手收益 = 实发收益。 */
  netIncomeInCents: AmountInCents;
}

function assertInteger(value: number, name: string): void {
  if (!Number.isInteger(value)) {
    throw new ApiError(ApiErrorCode.INVALID_INPUT, `${name}须为整数分`);
  }
}

/** 计算化妆师收益明细。纯函数，无副作用，不做负数归零。 */
export function calculateMakeupPayroll(input: MakeupPayrollInput): MakeupPayrollResult {
  const { baseIncomeInCents, penaltyInCents = 0, rewardInCents = 0 } = input;
  assertInteger(baseIncomeInCents, "基础收益");
  assertInteger(penaltyInCents, "总违约");
  assertInteger(rewardInCents, "总奖励");
  if (baseIncomeInCents < 0) {
    throw new ApiError(ApiErrorCode.INVALID_INPUT, "基础收益须为不小于 0 的金额");
  }
  if (penaltyInCents > 0) {
    throw new ApiError(ApiErrorCode.INVALID_INPUT, "总违约须为不大于 0 的金额");
  }
  if (rewardInCents < 0) {
    throw new ApiError(ApiErrorCode.INVALID_INPUT, "总奖励须为不小于 0 的金额");
  }

  const adjustmentInCents = penaltyInCents + rewardInCents;
  const grossIncomeInCents = baseIncomeInCents + adjustmentInCents;
  return { adjustmentInCents, grossIncomeInCents, netIncomeInCents: grossIncomeInCents };
}
