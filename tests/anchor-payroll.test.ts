import { describe, expect, it } from "vitest";
import { ApiError, ApiErrorCode } from "@/lib/api/contracts/errors";
import { computePayroll } from "../supabase/functions/settle-team-payroll/payroll";
import {
  applyRateCeil,
  applyRateFloor,
  calculateAnchorPayroll,
  type AnchorSalaryScheme,
} from "@/lib/domain/payroll";

/** 示例方案：初始保底 8000 元、降级保底 5000 元、门槛系数 2.65(26500bps)。 */
const scheme: AnchorSalaryScheme = {
  baseSalaryInCents: 800000,
  guaranteedSalaryInCents: 500000,
  thresholdMultiplierBps: 26500,
};

// 无责期/上月达标时，保底基准 8000 元 → 门槛 = 800000 × 2.65 = 2120000 分（21200 元）。
const THRESHOLD = 2120000;
// 提成起征 = 800000 × 5 = 4000000 分（40000 元）。
const COMMISSION_START = 4000000;

describe("金额工具函数", () => {
  it("applyRateCeil 向上取整：8300×3% = 249 → 249", () => {
    expect(applyRateCeil(830000, 300)).toBe(24900);
  });

  it("applyRateFloor 向下取整：2120000×20% = 424000", () => {
    expect(applyRateFloor(THRESHOLD, 2000)).toBe(424000);
  });

  it("非整数输入抛错", () => {
    expect(() => applyRateCeil(1.5, 300)).toThrow();
  });
});

describe("主播工资计算器 - 保底基准与门槛边界", () => {
  it("流水正好等于门槛：达标，保底基准为初始保底 8000", () => {
    const r = calculateAnchorPayroll({ scheme, monthlyRevenueInCents: THRESHOLD, tenureMonth: 4 });
    expect(r.baseGuaranteeInCents).toBe(800000);
    expect(r.thresholdInCents).toBe(THRESHOLD);
    expect(r.isQualified).toBe(true);
  });

  it("流水低门槛 1 分：不达标，仍拿保底工资全额", () => {
    const r = calculateAnchorPayroll({ scheme, monthlyRevenueInCents: THRESHOLD - 1, tenureMonth: 4 });
    expect(r.isQualified).toBe(false);
    expect(r.guaranteedComponentInCents).toBe(800000);
    expect(r.performanceComponentInCents).toBe(0);
    expect(r.grossSalaryInCents).toBe(800000);
  });
});

describe("主播工资计算器 - 前3个月无责期", () => {
  it("第1月不达标：按初始保底 8000 全额发放，无提成", () => {
    const r = calculateAnchorPayroll({ scheme, monthlyRevenueInCents: 0, tenureMonth: 1 });
    expect(r.isGracefulPeriod).toBe(true);
    expect(r.baseGuaranteeInCents).toBe(800000);
    expect(r.guaranteedComponentInCents).toBe(800000);
    expect(r.performanceComponentInCents).toBe(0);
    expect(r.grossSalaryInCents).toBe(800000);
    expect(r.serviceFeeInCents).toBe(24000);
    expect(r.netSalaryInCents).toBe(776000);
  });

  it("无责期忽略上月达标标记：即使上月不达标仍按初始保底", () => {
    const r = calculateAnchorPayroll({ scheme, monthlyRevenueInCents: 0, tenureMonth: 2, lastMonthQualified: false });
    expect(r.baseGuaranteeInCents).toBe(800000);
  });
});

describe("主播工资计算器 - 第4月起保底基准动态取值", () => {
  it("上月达标 → 保底基准 8000，降级亦不触发", () => {
    const r = calculateAnchorPayroll({ scheme, monthlyRevenueInCents: THRESHOLD - 1, tenureMonth: 4, lastMonthQualified: true });
    expect(r.isGracefulPeriod).toBe(false);
    expect(r.baseGuaranteeInCents).toBe(800000);
    expect(r.guaranteedComponentInCents).toBe(800000);
  });

  it("上月不达标 → 保底基准降级为 5000", () => {
    const r = calculateAnchorPayroll({ scheme, monthlyRevenueInCents: 0, tenureMonth: 4, lastMonthQualified: false });
    expect(r.baseGuaranteeInCents).toBe(500000);
    expect(r.guaranteedComponentInCents).toBe(500000);
    // 门槛 = ceil(500000 × 2.65) = 1325000
    expect(r.thresholdInCents).toBe(1325000);
    // 服务费 = ceil(500000 × 3%) = 15000
    expect(r.serviceFeeInCents).toBe(15000);
    expect(r.netSalaryInCents).toBe(485000);
  });
});

describe("主播工资计算器 - 阶梯提成（基础20%，超过门槛每满1万加1个百分点，阶梯加点封顶5%）", () => {
  it("流水 4 万：20% 提成", () => {
    const revenue = 4000000;
    const r = calculateAnchorPayroll({ scheme, monthlyRevenueInCents: revenue, tenureMonth: 8 });
    expect(r.commissionRateBps).toBe(2000);
    expect(r.performanceComponentInCents).toBe(800000); // 4000000 × 20%
  });

  it("流水 5 万：21% 提成", () => {
    const r = calculateAnchorPayroll({ scheme, monthlyRevenueInCents: 5000000, tenureMonth: 8 });
    expect(r.commissionRateBps).toBe(2100);
    expect(r.performanceComponentInCents).toBe(1050000);
  });

  it("流水 6 万：22% 提成", () => {
    const r = calculateAnchorPayroll({ scheme, monthlyRevenueInCents: 6000000, tenureMonth: 8 });
    expect(r.commissionRateBps).toBe(2200);
    expect(r.performanceComponentInCents).toBe(1320000);
  });

  it("流水 9 万：阶梯加点达到 5%，与基础 20% 相加为 25%", () => {
    const r = calculateAnchorPayroll({ scheme, monthlyRevenueInCents: 9000000, tenureMonth: 8 });
    expect(r.commissionRateBps).toBe(2500);
    expect(r.performanceComponentInCents).toBe(2250000);
  });

  it("流水 12 万：阶梯加点保持 5%，当前无其他加点时合计 25%", () => {
    const r = calculateAnchorPayroll({ scheme, monthlyRevenueInCents: 12000000, tenureMonth: 8 });
    expect(r.commissionRateBps).toBe(2500);
    expect(r.performanceComponentInCents).toBe(3000000);
  });

  it("流水低于提成起征（<4万）：不提成", () => {
    const r = calculateAnchorPayroll({ scheme, monthlyRevenueInCents: COMMISSION_START - 1, tenureMonth: 8 });
    expect(r.commissionRateBps).toBe(0);
    expect(r.performanceComponentInCents).toBe(0);
  });
});

describe("阶梯提点 - 按实际拿提点门槛分档，两端口径一致", () => {
  const scenarios = [
    { name: "初始保底8000", baseSalaryInCents: 800000, tenureMonth: 4, lastMonthQualified: true, start: 4000000 },
    { name: "降级保底5000", baseSalaryInCents: 800000, tenureMonth: 4, lastMonthQualified: false, start: 2500000 },
    { name: "初始保底10000", baseSalaryInCents: 1000000, tenureMonth: 4, lastMonthQualified: true, start: 5000000 },
    { name: "非整万元门槛", baseSalaryInCents: 650001, tenureMonth: 4, lastMonthQualified: true, start: 3250005 },
    { name: "无责期忽略降级", baseSalaryInCents: 800000, tenureMonth: 2, lastMonthQualified: false, start: 4000000 },
  ];
  const boundaries = [
    { offset: -1, stepBps: 0 },
    { offset: 0, stepBps: 0 },
    { offset: 999999, stepBps: 0 },
    { offset: 1000000, stepBps: 100 },
    { offset: 1000001, stepBps: 100 },
    { offset: 1999999, stepBps: 100 },
    { offset: 2000000, stepBps: 200 },
    { offset: 3000000, stepBps: 300 },
    { offset: 4000000, stepBps: 400 },
    { offset: 4999999, stepBps: 400 },
    { offset: 5000000, stepBps: 500 },
    { offset: 5000001, stepBps: 500 },
    { offset: 9000000, stepBps: 500 },
  ];

  describe.each(scenarios)("$name", (scenario) => {
    it.each(boundaries)("超出门槛 $offset 分时，阶梯加点 $stepBps bps", ({ offset, stepBps }) => {
      const input = {
        scheme: { ...scheme, baseSalaryInCents: scenario.baseSalaryInCents },
        monthlyRevenueInCents: scenario.start + offset,
        tenureMonth: scenario.tenureMonth,
        lastMonthQualified: scenario.lastMonthQualified,
      };
      const result = calculateAnchorPayroll(input);
      const expectedRate = offset < 0 ? 0 : 2000 + stepBps;
      expect(result.commissionStartInCents).toBe(scenario.start);
      expect(Math.max(result.commissionRateBps - 2000, 0)).toBe(stepBps);
      expect(result.commissionRateBps).toBe(expectedRate);
      expect(result.performanceComponentInCents).toBe(
        Math.floor(input.monthlyRevenueInCents * expectedRate / 10000),
      );
      expect(computePayroll(input)).toEqual(result);
    });
  });
});

describe("主播工资计算器 - 服务费与实发", () => {
  it("4 万流水达标：总工资 = 保底 8000 + 提成 8000 = 16000", () => {
    const r = calculateAnchorPayroll({ scheme, monthlyRevenueInCents: 4000000, tenureMonth: 5 });
    expect(r.grossSalaryInCents).toBe(1600000);
    // 服务费 = ceil(1600000 × 3%) = 48000
    expect(r.serviceFeeInCents).toBe(48000);
    expect(r.netSalaryInCents).toBe(1552000);
  });
});

describe("主播工资计算器 - 校验", () => {
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
});