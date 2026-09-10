/**
 * 主播工资「调整项」领域纯函数（PLAN-001 阶段1）。
 *
 * 调整项是结算时叠加在总工资之上的不固定明细：迟到 -100、缺勤 -200、评优 +200 等。
 * 金额一律以「分」为单位的整数存储，可正可负。名称由管理员自定义。
 *
 * 计算口径（已与用户确认）：
 *  - 总工资 = 保底工资 + 阶梯提成 + 调整项合计
 *  - 服务费按「含调整项的总工资」重新计算
 *  - 实发 = 总工资 − 服务费（允许为负，不归零）
 *
 * 本层不触库、无副作用；仅在既有 [`calculateAnchorPayroll()`](lib/domain/payroll/anchor.ts:64)
 * 结果之上做外层组合，不改动核心工资引擎。
 */
import { ApiError, ApiErrorCode } from "@/lib/api/contracts/errors";
import { applyRateCeil } from "./money";
import type { AmountInCents } from "@/lib/api/contracts/common";
import {
  DEFAULT_SERVICE_FEE_RATE_BPS,
  type AnchorPayrollResult,
} from "./types";

/** 单条工资调整项（结算时落库为 salary_records.adjustments JSONB 数组元素）。 */
export interface PayrollAdjustment {
  /** 调整项名称，如「迟到」「缺勤」「评优」。 */
  name: string;
  /** 调整金额（分），正为增、负为减。 */
  amountCents: AmountInCents;
}

/** 叠加调整项后的工资结果（在 AnchorPayrollResult 基础上扩展）。 */
export interface AdjustedPayrollResult extends AnchorPayrollResult {
  /** 调整项明细（原样透传，用于落库与展示）。 */
  adjustments: PayrollAdjustment[];
  /** 调整项合计（分，可正可负）。 */
  adjustmentTotalInCents: AmountInCents;
  /** 调整前的总工资（= 保底 + 阶梯提成）。 */
  grossBeforeAdjustmentInCents: AmountInCents;
}

/** 校验单条调整项合法：名称非空、金额为整数分。 */
function assertAdjustment(item: PayrollAdjustment, index: number): void {
  if (!item || typeof item.name !== "string" || !item.name.trim()) {
    throw new ApiError(
      ApiErrorCode.INVALID_INPUT,
      `第 ${index + 1} 条调整项名称不能为空`,
    );
  }
  if (!Number.isInteger(item.amountCents)) {
    throw new ApiError(
      ApiErrorCode.INVALID_INPUT,
      `第 ${index + 1} 条调整项「${item.name}」金额须为整数分`,
    );
  }
}

/**
 * 合计调整项金额（分）。空数组返回 0。逐条校验合法性。
 */
export function sumAdjustments(
  adjustments: readonly PayrollAdjustment[] = [],
): AmountInCents {
  return adjustments.reduce((total, item, index) => {
    assertAdjustment(item, index);
    return total + item.amountCents;
  }, 0);
}

/**
 * 在既有工资计算结果上叠加调整项，得到最终结算金额。
 *
 * @param base 主播工资计算器产出的原始结果（保底 + 阶梯提成）
 * @param adjustments 调整项明细（可正可负，可空）
 * @param serviceFeeRateBps 服务费率（基点），默认 300 bps = 3%
 * @returns 叠加调整项并重算服务费/实发后的完整结果
 */
export function applyAdjustments(
  base: AnchorPayrollResult,
  adjustments: readonly PayrollAdjustment[] = [],
  serviceFeeRateBps: number = DEFAULT_SERVICE_FEE_RATE_BPS,
): AdjustedPayrollResult {
  const adjustmentTotalInCents = sumAdjustments(adjustments);
  const grossBeforeAdjustmentInCents = base.grossSalaryInCents;

  // 总工资 = 原总工资 + 调整项合计（可为负）。
  const grossSalaryInCents = grossBeforeAdjustmentInCents + adjustmentTotalInCents;

  // 服务费按「含调整项的总工资」重新计算。负总工资时 ceil 语义仍成立（服务费随之为负/0）。
  const serviceFeeInCents = applyRateCeil(grossSalaryInCents, serviceFeeRateBps);

  // 实发 = 总工资 − 服务费，允许为负。
  const netSalaryInCents = grossSalaryInCents - serviceFeeInCents;

  return {
    ...base,
    grossSalaryInCents,
    serviceFeeInCents,
    netSalaryInCents,
    adjustments: adjustments.map((item) => ({
      name: item.name.trim(),
      amountCents: item.amountCents,
    })),
    adjustmentTotalInCents,
    grossBeforeAdjustmentInCents,
  };
}