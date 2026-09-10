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

describe("主播工资计算器 - 高额流水阶梯提成", () => {
  it("流水 30 万：25% 封顶计提", () => {
    const revenue = 30000000; // 300,000 元
    const r = calculateAnchorPayroll({ scheme, monthlyRevenueInCents: revenue, tenureMonth: 8 });
    expect(r.commissionRateBps).toBe(2500);
    const perf = 7500000; // floor(30000000 × 25%)
    expect(r.performanceComponentInCents).toBe(perf);
    expect(r.grossSalaryInCents).toBe(800000 + perf);
    // 服务费 = ceil(8300000 × 3%) = 249000
    expect(r.serviceFeeInCents).toBe(249000);
    expect(r.netSalaryInCents).toBe(8300000 - 249000);
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