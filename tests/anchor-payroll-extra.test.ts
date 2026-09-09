import { describe, expect, it } from "vitest";
import { ApiError, ApiErrorCode } from "@/lib/api/contracts/errors";
import { calculateAnchorPayroll, type AnchorSalaryScheme } from "@/lib/domain/payroll";

const scheme: AnchorSalaryScheme = {
  baseSalaryInCents: 800000,
  guaranteedSalaryInCents: 500000,
  thresholdMultiplierBps: 26500,
  commissionRateBps: 2000,
};

const THRESHOLD = 2120000; // 800000 × 2.65

describe("主播工资计算器 - 服务费费率", () => {
  it("自定义服务费费率 5%：对总工资按 500 bps 计提", () => {
    const r = calculateAnchorPayroll({ scheme, monthlyRevenueInCents: 0, tenureMonth: 1, serviceFeeRateBps: 500 });
    // 总工资 800000，服务费 = ceil(800000 × 5%) = 40000
    expect(r.serviceFeeInCents).toBe(40000);
    expect(r.netSalaryInCents).toBe(760000);
  });

  it("零服务费：实发等于总工资", () => {
    const r = calculateAnchorPayroll({ scheme, monthlyRevenueInCents: THRESHOLD, tenureMonth: 6, serviceFeeRateBps: 0 });
    expect(r.serviceFeeInCents).toBe(0);
    expect(r.netSalaryInCents).toBe(r.grossSalaryInCents);
  });
});

describe("主播工资计算器 - 高额流水", () => {
  it("流水 30 万：绩效按全部流水 20% 计提", () => {
    const revenue = 30000000; // 300,000 元
    const r = calculateAnchorPayroll({ scheme, monthlyRevenueInCents: revenue, tenureMonth: 8 });
    const perf = 6000000; // floor(30000000 × 20%)
    expect(r.performanceComponentInCents).toBe(perf);
    expect(r.grossSalaryInCents).toBe(800000 + perf);
    // 服务费 = ceil(6800000 × 3%) = 204000
    expect(r.serviceFeeInCents).toBe(204000);
    expect(r.netSalaryInCents).toBe(6800000 - 204000);
  });

  it("非整除流水向下取整：3123456 分 × 20% = 624691.2 → 624691", () => {
    const r = calculateAnchorPayroll({ scheme, monthlyRevenueInCents: 3123456, tenureMonth: 8 });
    expect(r.performanceComponentInCents).toBe(624691);
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
