import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/contracts/errors";
import { delayDeductionCents, DELAY_ADJUSTMENT_NAME } from "@/lib/domain/payroll/adjustment";
import { calculateFixedSalaryPayroll } from "@/lib/domain/payroll/fixed";

describe("固定薪资收益计算", () => {
  it("调整合计 = 总违约 + 总奖励；实发 = 基础薪资 + 调整合计；到手 = 实发 − 个税", () => {
    expect(
      calculateFixedSalaryPayroll({
        baseIncomeInCents: 500000,
        penaltyInCents: -5000,
        rewardInCents: 2000,
        taxInCents: 0,
      }),
    ).toEqual({
      adjustmentInCents: -3000,
      grossIncomeInCents: 497000,
      taxInCents: 0,
      netIncomeInCents: 497000,
    });
  });

  it("个税由工资核算手动输入传入", () => {
    const result = calculateFixedSalaryPayroll({ baseIncomeInCents: 1_000_000, taxInCents: 29_000 });
    expect(result.grossIncomeInCents).toBe(1_000_000);
    expect(result.taxInCents).toBe(29_000);
    expect(result.netIncomeInCents).toBe(971_000);
  });

  it("缺省违约/奖励/个税按 0 处理", () => {
    expect(calculateFixedSalaryPayroll({ baseIncomeInCents: 300000 })).toEqual({
      adjustmentInCents: 0,
      grossIncomeInCents: 300000,
      taxInCents: 0,
      netIncomeInCents: 300000,
    });
  });

  it("允许实发为负，不归零", () => {
    const result = calculateFixedSalaryPayroll({ baseIncomeInCents: 1000, penaltyInCents: -5000 });
    expect(result.grossIncomeInCents).toBe(-4000);
    expect(result.netIncomeInCents).toBe(-4000);
  });

  it("拒绝非法输入：负基础收益 / 正违约 / 负奖励 / 负个税 / 非整数", () => {
    expect(() => calculateFixedSalaryPayroll({ baseIncomeInCents: -1 })).toThrow(ApiError);
    expect(() => calculateFixedSalaryPayroll({ baseIncomeInCents: 100, penaltyInCents: 1 })).toThrow(ApiError);
    expect(() => calculateFixedSalaryPayroll({ baseIncomeInCents: 100, rewardInCents: -1 })).toThrow(ApiError);
    expect(() => calculateFixedSalaryPayroll({ baseIncomeInCents: 100, taxInCents: -1 })).toThrow(ApiError);
    expect(() => calculateFixedSalaryPayroll({ baseIncomeInCents: 100.5 })).toThrow(ApiError);
  });
});

describe("延误折算", () => {
  it("单条延误扣款 = round(保底 / 260)", () => {
    expect(delayDeductionCents(260000)).toBe(1000);
    expect(delayDeductionCents(800000)).toBe(3077);
    expect(delayDeductionCents(3900)).toBe(15);
    expect(delayDeductionCents(0)).toBe(0);
  });

  it("名称常量与主播「延误」预设一致", () => {
    expect(DELAY_ADJUSTMENT_NAME).toBe("延误");
  });

  it("拒绝非法保底", () => {
    expect(() => delayDeductionCents(-1)).toThrow(ApiError);
    expect(() => delayDeductionCents(1.5)).toThrow(ApiError);
  });
});
