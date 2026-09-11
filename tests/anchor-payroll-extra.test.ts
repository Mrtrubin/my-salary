import { describe, expect, it } from "vitest";
import { ApiError, ApiErrorCode } from "@/lib/api/contracts/errors";
import { calculateAnchorPayroll, type AnchorSalaryScheme } from "@/lib/domain/payroll";

const scheme: AnchorSalaryScheme = {
  baseSalaryInCents: 800000,
  guaranteedSalaryInCents: 500000,
  thresholdMultiplierBps: 26500,
};

const THRESHOLD = 2120000; // 800000 × 2.65

describe("主播工资计算器 - 服务费费率", () => {
  it("自定义服务费费率 5%：对总工资按 500 bps 计提", () => {
    const r = calculateAnchorPayroll({ scheme, monthlyRevenueInCents: 0, tenureMonth: 1, serviceFeeRateBps: 500 });
    // 流水 0 不达标 → 基础收益 = 降级保底 500000，服务费 = ceil(500000 × 5%) = 25000
    expect(r.serviceFeeInCents).toBe(25000);
    expect(r.netSalaryInCents).toBe(475000);
  });

  it("零服务费：实发等于总工资", () => {
    const r = calculateAnchorPayroll({ scheme, monthlyRevenueInCents: THRESHOLD, tenureMonth: 6, serviceFeeRateBps: 0 });
    expect(r.serviceFeeInCents).toBe(0);
    expect(r.netSalaryInCents).toBe(r.grossSalaryInCents);
  });
});

describe("主播工资计算器 - 高额流水阶梯提成（提成模式，不叠加保底）", () => {
  it("流水 30 万：阶梯加点封顶 5%，加基础 20% 后按 25% 计提，总工资=总流水×提成率", () => {
    const revenue = 30000000; // 300,000 元
    const r = calculateAnchorPayroll({ scheme, monthlyRevenueInCents: revenue, tenureMonth: 8 });
    expect(r.commissionRateBps).toBe(2500);
    const perf = 7500000; // floor(30000000 × 25%)
    expect(r.performanceComponentInCents).toBe(perf);
    // 提成模式：保障性部分为 0，总工资 = 提成
    expect(r.guaranteedComponentInCents).toBe(0);
    expect(r.grossSalaryInCents).toBe(perf);
    // 服务费 = ceil(7500000 × 3%) = 225000
    expect(r.serviceFeeInCents).toBe(225000);
    expect(r.netSalaryInCents).toBe(perf - 225000);
  });

  it("非整除流水向下取整：8123456 分 → 24% 提成取整", () => {
    const r = calculateAnchorPayroll({ scheme, monthlyRevenueInCents: 8123456, tenureMonth: 8 });
    // 8万档（8123456 分 ≈ 81234 元）→ 24%
    expect(r.commissionRateBps).toBe(2400);
    expect(r.performanceComponentInCents).toBe(Math.floor((8123456 * 2400) / 10000));
  });
});

describe("主播工资计算器 - 缺方案抛错", () => {
  it("scheme 为 undefined 抛 SALARY_SCHEME_MISSING", () => {
    let caught: unknown;
    try {
      calculateAnchorPayroll({ scheme: undefined as unknown as AnchorSalaryScheme, monthlyRevenueInCents: 0, tenureMonth: 1 });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).code).toBe(ApiErrorCode.SALARY_SCHEME_MISSING);
  });
});