/**
 * 固定薪资工资条领域纯函数（化妆师 / 舞蹈老师 / 行政 / 运镜 / 人事共用）。
 *
 * 与主播/主持工资不同，固定薪资类没有流水提成、没有服务费：
 *  - 基础薪资：来自「基础薪资管理-设置」（按角色，每人一个当前值）。
 *  - 总违约（≤0）、总奖励（≥0）：管理员在「工资核算-新增记录」时手工填写。
 *  - 调整合计 = 总违约 + 总奖励。
 *  - 实发收益 = 基础薪资 + 调整合计。
 *  - 个税：在工资核算「新增记录」时由管理员手动输入。
 *  - 到手收益 = 实发收益 − 个税。
 *
 * 金额一律以「分」为单位的整数；允许实发/到手为负，不归零。
 */
import { ApiError, ApiErrorCode } from "@/lib/api/contracts/errors";
import type { AmountInCents } from "@/lib/api/contracts/common";

/** 固定薪资计算输入（分）。 */
export interface FixedSalaryPayrollInput {
  /** 基础薪资（分，≥0）。 */
  baseIncomeInCents: AmountInCents;
  /** 总违约（分，≤0）。 */
  penaltyInCents?: AmountInCents;
  /** 总奖励（分，≥0）。 */
  rewardInCents?: AmountInCents;
  /** 本月个税（分，≥0）：工资核算「新增记录」时管理员手动输入，默认 0。 */
  taxInCents?: AmountInCents;
}

/** 固定薪资计算结果（分）。 */
export interface FixedSalaryPayrollResult {
  /** 调整合计 = 总违约 + 总奖励。 */
  adjustmentInCents: AmountInCents;
  /** 实发收益 = 基础薪资 + 调整合计。 */
  grossIncomeInCents: AmountInCents;
  /** 个税（分）。 */
  taxInCents: AmountInCents;
  /** 到手收益 = 实发收益 − 个税。 */
  netIncomeInCents: AmountInCents;
}

function assertInteger(value: number, name: string): void {
  if (!Number.isInteger(value)) {
    throw new ApiError(ApiErrorCode.INVALID_INPUT, `${name}须为整数分`);
  }
}

/** 计算固定薪资明细。纯函数，无副作用，不做负数归零。 */
export function calculateFixedSalaryPayroll(input: FixedSalaryPayrollInput): FixedSalaryPayrollResult {
  const { baseIncomeInCents, penaltyInCents = 0, rewardInCents = 0, taxInCents = 0 } = input;
  assertInteger(baseIncomeInCents, "基础薪资");
  assertInteger(penaltyInCents, "总违约");
  assertInteger(rewardInCents, "总奖励");
  assertInteger(taxInCents, "个税");
  if (baseIncomeInCents < 0) {
    throw new ApiError(ApiErrorCode.INVALID_INPUT, "基础薪资须为不小于 0 的金额");
  }
  if (penaltyInCents > 0) {
    throw new ApiError(ApiErrorCode.INVALID_INPUT, "总违约须为不大于 0 的金额");
  }
  if (rewardInCents < 0) {
    throw new ApiError(ApiErrorCode.INVALID_INPUT, "总奖励须为不小于 0 的金额");
  }
  if (taxInCents < 0) {
    throw new ApiError(ApiErrorCode.INVALID_INPUT, "个税须为不小于 0 的金额");
  }

  const adjustmentInCents = penaltyInCents + rewardInCents;
  const grossIncomeInCents = baseIncomeInCents + adjustmentInCents;
  return {
    adjustmentInCents,
    grossIncomeInCents,
    taxInCents,
    netIncomeInCents: grossIncomeInCents - taxInCents,
  };
}
