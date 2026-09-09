import { describe, expect, it } from "vitest";
import { ApiError, ApiErrorCode } from "@/lib/api/contracts/errors";
import {
  applyRateCeil,
  applyRateFloor,
  calculateAnchorPayroll,
  type AnchorSalaryScheme,
} from "@/lib/domain/payroll";

/** 示例方案：基本 8000 元、保底 5000 元、门槛系数 2.65(26500bps)、提成 20%(2000bps)。 */
const scheme: AnchorSalaryScheme = {
  baseSalaryInCents: 800000,
  guaranteedSalaryInCents: 500000,
  thresholdMultiplierBps: 26500,
  commissionRateBps: 2000,
};

// 门槛 = 800000 × 2.65 = 2120000 分（21200 元）。
const THRESHOLD = 2120000;

describe("金额工具函数", () => {
  it("applyRateCeil 向上取整：8300×3% = 249 → 249", () => {
    expect(applyRateCeil(830000, 300)).toBe(24900);
  });

  it("applyRateCeil 非整除向上取整：100 分 × 3% = 3 分（3.0→3）", () => {
    // 776000 × 3% = 23280 分整除
    expect(applyRateCeil(776000, 300)).toBe(23280);
    // 777 分 × 3% = 23.31 → 24
    expect(applyRateCeil(77700, 300)).toBe(2331);
    expect(applyRateCeil(101, 300)).toBe(4); // 3.03 → 4
  });

  it("applyRateFloor 向下取整：2120000×20% = 424000", () => {
    expect(applyRateFloor(THRESHOLD, 2000)).toBe(424000);
  });

  it("非整数输入抛错", () => {
    expect(() => applyRateCeil(1.5, 300)).toThrow();
  });
});

describe("主播工资计算器 - 达标门槛边界", () => {
  it("流水正好等于门槛：达标", () => {
    const r = calculateAnchorPayroll({ scheme, monthlyRevenueInCents: THRESHOLD, tenureMonth: 4 });
    expect(r.thresholdInCents).toBe(THRESHOLD);
    expect(r.isQualified).toBe(true);
  });

  it("流水低门槛 1 分：不达标", () => {
    const r = calculateAnchorPayroll({ scheme, monthlyRevenueInCents: THRESHOLD - 1, tenureMonth: 4 });
    expect(r.isQualified).toBe(false);
  });
});

describe("主播工资计算器 - 前3个月无责期", () => {
  it("第1月不达标：拿基本工资，无绩效", () => {
    const r = calculateAnchorPayroll({ scheme, monthlyRevenueInCents: 0, tenureMonth: 1 });
    expect(r.isGracefulPeriod).toBe(true);
    expect(r.guaranteedComponentInCents).toBe(800000);
    expect(r.performanceComponentInCents).toBe(0);
    expect(r.grossSalaryInCents).toBe(800000);
    // 服务费 = ceil(800000 × 3%) = 24000
    expect(r.serviceFeeInCents).toBe(24000);
    expect(r.netSalaryInCents).toBe(776000);
  });

  it("第3月达标：基本 + 绩效", () => {
    const revenue = 2500000; // 25000 元
    const r = calculateAnchorPayroll({ scheme, monthlyRevenueInCents: revenue, tenureMonth: 3 });
    expect(r.isQualified).toBe(true);
    const perf = Math.floor((revenue * 2000) / 10000); // 500000
    expect(r.performanceComponentInCents).toBe(perf);
    expect(r.grossSalaryInCents).toBe(800000 + perf);
  });
});

describe("主播工资计算器 - 第4月起", () => {
  it("第4月不达标：降为保底工资", () => {
    const r = calculateAnchorPayroll({ scheme, monthlyRevenueInCents: THRESHOLD - 1, tenureMonth: 4 });
    expect(r.isGracefulPeriod).toBe(false);
    expect(r.guaranteedComponentInCents).toBe(500000);
    expect(r.performanceComponentInCents).toBe(0);
    expect(r.grossSalaryInCents).toBe(500000);
    // 服务费 = ceil(500000 × 3%) = 15000
    expect(r.serviceFeeInCents).toBe(15000);
    expect(r.netSalaryInCents).toBe(485000);
  });

  it("第4月达标：基本 + 绩效，服务费向上取整", () => {
    const revenue = THRESHOLD; // 2120000
    const r = calculateAnchorPayroll({ scheme, monthlyRevenueInCents: revenue, tenureMonth: 12 });
    const perf = 424000; // 2120000 × 20%
    const gross = 800000 + perf; // 1224000
    expect(r.grossSalaryInCents).toBe(gross);
    // 服务费 = ceil(1224000 × 3%) = ceil(36720) = 36720
    expect(r.serviceFeeInCents).toBe(36720);
    expect(r.netSalaryInCents).toBe(gross - 36720);
  });
});

describe("主播工资计算器 - 校验与规则4", () => {
  it("月序 < 1 抛 INVALID_INPUT", () => {
    let caught: unknown;
    try {
      calculateAnchorPayroll({ scheme, monthlyRevenueInCents: 0, tenureMonth: 0 });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).code).toBe(ApiErrorCode.INVALID_INPUT);
  });

  it("负数不归零：保留实际结果", () => {
    const tiny: AnchorSalaryScheme = { ...scheme, guaranteedSalaryInCents: 0 };
    const r = calculateAnchorPayroll({ scheme: tiny, monthlyRevenueInCents: 0, tenureMonth: 5 });
    // gross = 0, 服务费 ceil(0)=0, net=0（此处验证不抛错、不异常归零逻辑）
    expect(r.grossSalaryInCents).toBe(0);
    expect(r.netSalaryInCents).toBe(0);
  });
});