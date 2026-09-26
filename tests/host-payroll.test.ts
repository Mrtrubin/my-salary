import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/contracts/errors";
import {
  calculateHostPayroll,
  resolveHostTierSteps,
  HOST_MAX_TIER_STEPS,
  type HostSalaryScheme,
} from "@/lib/domain/payroll/host";

/** 示例方案：基础收益 5000 元、拿提点门槛 10 万元、基础提成率 20%、服务率 3%。 */
const scheme: HostSalaryScheme = {
  baseIncomeInCents: 500_000,
  commissionStartInCents: 10_000_000,
  baseCommissionRateBps: 2000,
  serviceFeeRateBps: 300,
};

describe("主持阶梯式提点", () => {
  it("未达门槛：0 档", () => {
    expect(resolveHostTierSteps(9_999_999, 10_000_000)).toBe(0);
  });

  it("正好等于门槛：0 档", () => {
    expect(resolveHostTierSteps(10_000_000, 10_000_000)).toBe(0);
  });

  it("超出门槛 10 万：1 档", () => {
    expect(resolveHostTierSteps(20_000_000, 10_000_000)).toBe(1);
  });

  it("超出门槛 25 万（不满 30 万）：2 档", () => {
    expect(resolveHostTierSteps(35_000_000, 10_000_000)).toBe(2);
  });

  it("超出门槛 35 万：3 档", () => {
    expect(resolveHostTierSteps(45_000_000, 10_000_000)).toBe(3);
  });

  it("超出门槛 40 万：封顶 3 档", () => {
    expect(resolveHostTierSteps(50_000_000, 10_000_000)).toBe(HOST_MAX_TIER_STEPS);
  });
});

describe("主持工资计算器 - 未达标", () => {
  it("未达门槛：只发基础收益，阶梯为 0，最终提成率 = 基础提成率", () => {
    const r = calculateHostPayroll({ scheme, teamRevenueInCents: 5_000_000 });
    expect(r.isQualified).toBe(false);
    expect(r.tierSteps).toBe(0);
    expect(r.tierBonusBps).toBe(0);
    expect(r.commissionRateBps).toBe(2000);
    expect(r.performanceComponentInCents).toBe(0);
    expect(r.baseIncomeComponentInCents).toBe(500_000);
    expect(r.baseIncomeInCents).toBe(500_000);
    expect(r.grossIncomeInCents).toBe(500_000);
    expect(r.serviceFeeInCents).toBe(15_000);
    expect(r.netIncomeInCents).toBe(485_000);
  });

  it("未达标叠加调整：实发收益 = 基础收益 + 调整合计", () => {
    const r = calculateHostPayroll({
      scheme,
      teamRevenueInCents: 5_000_000,
      adjustmentTotalInCents: -10_000,
    });
    expect(r.grossIncomeInCents).toBe(490_000);
    expect(r.serviceFeeInCents).toBe(14_700);
    expect(r.netIncomeInCents).toBe(475_300);
  });
});

describe("主持工资计算器 - 达标", () => {
  it("正好等于门槛：达标，基础收益不计入，提成 = 团总流水 × 20%", () => {
    const r = calculateHostPayroll({ scheme, teamRevenueInCents: 10_000_000 });
    expect(r.isQualified).toBe(true);
    expect(r.tierSteps).toBe(0);
    expect(r.commissionRateBps).toBe(2000);
    expect(r.baseIncomeComponentInCents).toBe(0);
    expect(r.baseIncomeInCents).toBe(500_000);
    expect(r.performanceComponentInCents).toBe(2_000_000);
    expect(r.grossIncomeInCents).toBe(2_000_000);
    expect(r.serviceFeeInCents).toBe(60_000);
    expect(r.netIncomeInCents).toBe(1_940_000);
  });

  it("超门槛 10 万：阶梯 +1 点，最终提成率 21%", () => {
    const r = calculateHostPayroll({ scheme, teamRevenueInCents: 20_000_000 });
    expect(r.tierBonusBps).toBe(100);
    expect(r.commissionRateBps).toBe(2100);
    expect(r.performanceComponentInCents).toBe(4_200_000);
  });

  it("超门槛 25 万：阶梯 +2 点，最终提成率 22%", () => {
    const r = calculateHostPayroll({ scheme, teamRevenueInCents: 35_000_000 });
    expect(r.tierBonusBps).toBe(200);
    expect(r.commissionRateBps).toBe(2200);
  });

  it("超门槛 40 万：阶梯封顶 +3 点，最终提成率 23%", () => {
    const r = calculateHostPayroll({ scheme, teamRevenueInCents: 50_000_000 });
    expect(r.tierBonusBps).toBe(300);
    expect(r.commissionRateBps).toBe(2300);
  });

  it("达标叠加调整：实发收益 = 提成 + 调整合计", () => {
    const r = calculateHostPayroll({
      scheme,
      teamRevenueInCents: 10_000_000,
      adjustmentTotalInCents: 10_000,
    });
    expect(r.grossIncomeInCents).toBe(2_010_000);
    expect(r.serviceFeeInCents).toBe(60_300);
    expect(r.netIncomeInCents).toBe(1_949_700);
  });
});

describe("主持工资计算器 - 入参校验", () => {
  it("基础提成率非法抛错", () => {
    expect(() =>
      calculateHostPayroll({
        scheme: { ...scheme, baseCommissionRateBps: 0 },
        teamRevenueInCents: 1,
      }),
    ).toThrow(ApiError);
  });

  it("团总流水为负抛错", () => {
    expect(() => calculateHostPayroll({ scheme, teamRevenueInCents: -1 })).toThrow(ApiError);
  });

  it("服务率非法抛错", () => {
    expect(() =>
      calculateHostPayroll({
        scheme: { ...scheme, serviceFeeRateBps: 10001 },
        teamRevenueInCents: 1,
      }),
    ).toThrow(ApiError);
  });
});
