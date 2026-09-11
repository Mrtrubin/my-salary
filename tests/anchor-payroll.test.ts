import { describe, expect, it } from "vitest";
import { ApiError, ApiErrorCode } from "@/lib/api/contracts/errors";
import { parseCommissionBonusPoints } from "@/lib/domain/payroll/anchor";
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
  it("流水正好等于门槛：达标，基础收益为初始保底 8000", () => {
    const r = calculateAnchorPayroll({ scheme, monthlyRevenueInCents: THRESHOLD, tenureMonth: 4 });
    expect(r.baseGuaranteeInCents).toBe(800000);
    expect(r.thresholdInCents).toBe(THRESHOLD);
    expect(r.isQualified).toBe(true);
    expect(r.guaranteedComponentInCents).toBe(800000);
  });

  it("流水低门槛 1 分：不达标，基础收益降级为降级保底 5000", () => {
    const r = calculateAnchorPayroll({ scheme, monthlyRevenueInCents: THRESHOLD - 1, tenureMonth: 4 });
    expect(r.isQualified).toBe(false);
    expect(r.baseGuaranteeInCents).toBe(500000);
    expect(r.guaranteedComponentInCents).toBe(500000);
    expect(r.performanceComponentInCents).toBe(0);
    expect(r.grossSalaryInCents).toBe(500000);
  });
});

describe("主播工资计算器 - 前3个月无责期", () => {
  it("第1月不达标：基础收益降级为降级保底 5000，无提成", () => {
    const r = calculateAnchorPayroll({ scheme, monthlyRevenueInCents: 0, tenureMonth: 1 });
    expect(r.isGracefulPeriod).toBe(true);
    expect(r.isQualified).toBe(false);
    expect(r.baseGuaranteeInCents).toBe(500000);
    expect(r.guaranteedComponentInCents).toBe(500000);
    expect(r.performanceComponentInCents).toBe(0);
    expect(r.grossSalaryInCents).toBe(500000);
    expect(r.serviceFeeInCents).toBe(15000);
    expect(r.netSalaryInCents).toBe(485000);
  });

  it("无责期当月达标：基础收益为初始保底 8000", () => {
    const r = calculateAnchorPayroll({ scheme, monthlyRevenueInCents: THRESHOLD, tenureMonth: 2 });
    expect(r.isGracefulPeriod).toBe(true);
    expect(r.baseGuaranteeInCents).toBe(800000);
  });
});

describe("主播工资计算器 - 达标判定按当月流水动态取保底", () => {
  it("当月达标 → 基础收益初始保底 8000", () => {
    const r = calculateAnchorPayroll({ scheme, monthlyRevenueInCents: THRESHOLD, tenureMonth: 4 });
    expect(r.isGracefulPeriod).toBe(false);
    expect(r.baseGuaranteeInCents).toBe(800000);
    expect(r.guaranteedComponentInCents).toBe(800000);
  });

  it("当月不达标 → 基础收益降级为 5000", () => {
    const r = calculateAnchorPayroll({ scheme, monthlyRevenueInCents: 0, tenureMonth: 4 });
    expect(r.baseGuaranteeInCents).toBe(500000);
    expect(r.guaranteedComponentInCents).toBe(500000);
    // 门槛固定用初始保底：800000 × 2.65 = 2120000
    expect(r.thresholdInCents).toBe(THRESHOLD);
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

describe("阶梯提点 - 拿提点门槛固定用初始保底×5，两端口径一致", () => {
  const scenarios = [
    { name: "初始保底8000", baseSalaryInCents: 800000, tenureMonth: 4, start: 4000000 },
    { name: "初始保底10000", baseSalaryInCents: 1000000, tenureMonth: 4, start: 5000000 },
    { name: "非整万元门槛", baseSalaryInCents: 650001, tenureMonth: 4, start: 3250005 },
    { name: "无责期同样适用", baseSalaryInCents: 800000, tenureMonth: 2, start: 4000000 },
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

  it("自定义基础提成率同时作用于前端与 Deno 算法", () => {
    const input = {
      scheme,
      monthlyRevenueInCents: COMMISSION_START + 1000000,
      tenureMonth: 4,
      baseCommissionRateBps: 2350,
    };
    const expectedRate = 2450;
    expect(calculateAnchorPayroll(input).commissionRateBps).toBe(expectedRate);
    expect(computePayroll(input).commissionRateBps).toBe(expectedRate);
  });

  it.each([0, 10001, 1.5, NaN])("拒绝非法基础提成率：%s", (baseCommissionRateBps) => {
    const input = { scheme, monthlyRevenueInCents: COMMISSION_START, tenureMonth: 4, baseCommissionRateBps };
    expect(() => calculateAnchorPayroll(input)).toThrow();
    expect(() => computePayroll(input)).toThrow();
  });
});

describe("主播工资计算器 - 服务费与实发", () => {
  it("4 万流水达提成门槛：提成模式，总工资 = 4万 × 20% = 8000（不叠加保底）", () => {
    const r = calculateAnchorPayroll({ scheme, monthlyRevenueInCents: 4000000, tenureMonth: 5 });
    expect(r.guaranteedComponentInCents).toBe(0);
    expect(r.performanceComponentInCents).toBe(800000);
    expect(r.grossSalaryInCents).toBe(800000);
    // 服务费 = ceil(800000 × 3%) = 24000
    expect(r.serviceFeeInCents).toBe(24000);
    expect(r.netSalaryInCents).toBe(776000);
  });
});

describe("主播考勤与 dy 任务加点", () => {
  const input = { scheme, monthlyRevenueInCents: COMMISSION_START, tenureMonth: 4 };

  it.each([COMMISSION_START - 1, COMMISSION_START, 12000000])("省略及显式零加点兼容旧结果：%i", (revenue) => {
    const zero = calculateAnchorPayroll({ ...input, monthlyRevenueInCents: revenue,
      attendanceBonusBps: 0, dyTaskBonusBps: 0 });
    expect(zero).toEqual(calculateAnchorPayroll({ ...input, monthlyRevenueInCents: revenue }));
    expect(zero).toEqual(computePayroll({ ...input, monthlyRevenueInCents: revenue }));
  });

  it.each([
    [COMMISSION_START - 1, 0], [COMMISSION_START, 2375],
    [4999999, 2375], [5000000, 2475], [9000000, 2875], [12000000, 2875],
  ])("流水 %i 时仅阶梯封顶，实际费率 %i", (revenue, rate) => {
    const result = calculateAnchorPayroll({ ...input, monthlyRevenueInCents: revenue,
      attendanceBonusBps: 125, dyTaskBonusBps: 250 });
    expect(result.commissionRateBps).toBe(rate);
    // 达提成门槛 → 提成模式，保底部分为 0；未达 → 保底模式，达标为初始保底
    if (rate > 0) {
      expect(result.performanceComponentInCents).toBe(Math.floor(revenue * rate / 10000));
      expect(result.guaranteedComponentInCents).toBe(0);
      expect(result.grossSalaryInCents).toBe(result.performanceComponentInCents);
    } else {
      expect(result.performanceComponentInCents).toBe(0);
      expect(result.guaranteedComponentInCents).toBe(800000);
      expect(result.grossSalaryInCents).toBe(800000);
    }
    expect(result.commissionStartInCents).toBe(COMMISSION_START);
    expect(result.thresholdInCents).toBe(THRESHOLD);
    expect(result.serviceFeeInCents).toBe(Math.ceil(result.grossSalaryInCents * 300 / 10000));
    expect(result.netSalaryInCents).toBe(result.grossSalaryInCents - result.serviceFeeInCents);
  });

  it("流水低于拿提点门槛：走保底模式，加点不生效（起征固定初始保底×5）", () => {
    for (const bonus of [{ attendanceBonusBps: 125 }, { dyTaskBonusBps: 125 }]) {
      const result = calculateAnchorPayroll({ ...input, ...bonus,
        monthlyRevenueInCents: 2500000 });
      // 起征固定 = 800000 × 5 = 4000000，2500000 未达
      expect(result.commissionStartInCents).toBe(COMMISSION_START);
      expect(result.commissionRateBps).toBe(0);
      expect(result.performanceComponentInCents).toBe(0);
      // 2500000 >= 门槛 2120000 → 达标，基础收益为初始保底
      expect(result.guaranteedComponentInCents).toBe(800000);
      expect(result.grossSalaryInCents).toBe(800000);
    }
  });

  it.each(["attendanceBonusBps", "dyTaskBonusBps"] as const)("%s 拒绝非法输入，包括未起征时", (field) => {
    for (const value of [-1, 0.5, NaN, Infinity, -Infinity, 2147483648, null, "100"]) {
      expect(() => calculateAnchorPayroll({ ...input, monthlyRevenueInCents: 0, [field]: value }))
        .toThrow(expect.objectContaining({ code: ApiErrorCode.INVALID_INPUT }));
    }
  });

  it("费率只受整数技术上限限制，超过 100% 仍可计算", () => {
    expect(calculateAnchorPayroll({ ...input, attendanceBonusBps: 10000 }).commissionRateBps).toBe(12000);
    expect(calculateAnchorPayroll({ ...input, attendanceBonusBps: 2147481646, dyTaskBonusBps: 1 })
      .commissionRateBps).toBe(2147483647);
    expect(() => calculateAnchorPayroll({ ...input, attendanceBonusBps: 2147481646, dyTaskBonusBps: 2 }))
      .toThrow(expect.objectContaining({ code: ApiErrorCode.INVALID_INPUT }));
    expect(() => calculateAnchorPayroll({ ...input, monthlyRevenueInCents: 9000000,
      attendanceBonusBps: 2147481647 })).toThrow();
    expect(calculateAnchorPayroll({ ...input, monthlyRevenueInCents: COMMISSION_START - 1,
      attendanceBonusBps: 2147483647, dyTaskBonusBps: 2147483647 }).commissionRateBps).toBe(0);
  });

  it.each([
    ["", 0], ["  ", 0], ["0", 0], ["1", 100], [" 1.25 ", 125], [".5", 50],
    ["1.", 100], ["0.01", 1], ["21474836.47", 2147483647],
    ["21474836.48", null], ["1.001", null], ["-1", null], ["1e2", null],
    ["NaN", null], ["Infinity", null], ["abc", null], ["1,000", null],
  ])("百分点解析 %j 得到 %j 基点", (text, expected) => {
    expect(parseCommissionBonusPoints(text)).toBe(expected);
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