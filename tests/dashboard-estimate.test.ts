import { describe, expect, it } from "vitest";
import { calculateAnchorPayroll } from "@/lib/domain/payroll";
import type { AnchorSalaryScheme } from "@/lib/domain/payroll/types";
import {
  buildRecentDailySeries,
  estimateAnchorPayroll,
  summarizeAnchorRevenue,
  type AnchorRevenueLike,
} from "@/app/(user)/user/dashboard/estimate";

/** 示例方案：初始保底 8000 元、降级保底 5000 元、门槛系数 2.65(26500bps)。 */
const scheme: AnchorSalaryScheme = {
  baseSalaryInCents: 800000,
  guaranteedSalaryInCents: 500000,
  thresholdMultiplierBps: 26500,
};

// 门槛 = 800000 × 2.65 = 2120000 分（21200 元）；拿提点门槛 = 800000 × 5 = 4000000 分（40000 元）。
const THRESHOLD = 2120000;
const COMMISSION_START = 4000000;
const STEP = 1_000_000;

function estimate(revenue: number, tenureMonth = 4) {
  return estimateAnchorPayroll({
    scheme,
    monthlyRevenueInCents: revenue,
    tenureMonth,
  });
}

describe("主播首页预估 - 目标进度四个边界", () => {
  it("未达标：还差门槛差额，走降级保底", () => {
    const revenue = 1_000_000;
    const { payroll, goal } = estimate(revenue);

    expect(payroll.thresholdInCents).toBe(THRESHOLD);
    expect(payroll.isQualified).toBe(false);
    expect(payroll.guaranteedComponentInCents).toBe(500000);
    expect(payroll.performanceComponentInCents).toBe(0);
    // 服务费 = ceil(500000 × 3%) = 15000
    expect(payroll.netSalaryInCents).toBe(485000);

    expect(goal.stage).toBe("belowThreshold");
    expect(goal.remainingInCents).toBe(THRESHOLD - revenue);
    expect(goal.nextRateBps).toBeNull();
    expect(goal.progressRatio).toBeCloseTo(revenue / THRESHOLD, 10);
  });

  it("已达标但未拿提点：还差进入提成模式的差额，走初始保底", () => {
    const revenue = 2_500_000;
    const { payroll, goal } = estimate(revenue);

    expect(payroll.isQualified).toBe(true);
    expect(payroll.commissionRateBps).toBe(0);
    expect(payroll.guaranteedComponentInCents).toBe(800000);
    // 服务费 = ceil(800000 × 3%) = 24000
    expect(payroll.netSalaryInCents).toBe(776000);

    expect(goal.stage).toBe("belowCommission");
    expect(goal.remainingInCents).toBe(COMMISSION_START - revenue);
    expect(goal.nextRateBps).toBeNull();
    expect(goal.progressRatio).toBeCloseTo(
      (revenue - THRESHOLD) / (COMMISSION_START - THRESHOLD),
      10,
    );
  });

  it("提成中未满档：显示距下一档流水与下一档提成率", () => {
    const revenue = COMMISSION_START + 500_000; // 超拿提点门槛 5000 元 → 0 档
    const { payroll, goal } = estimate(revenue);

    expect(payroll.commissionRateBps).toBe(2000);
    expect(payroll.performanceComponentInCents).toBe(900000); // floor(4500000 × 20%)

    expect(goal.stage).toBe("inCommission");
    expect(goal.remainingInCents).toBe(STEP - 500_000);
    expect(goal.nextRateBps).toBe(2100);
    expect(goal.progressRatio).toBeCloseTo(0.5, 10);
  });

  it("正好跨过一档：下一档提成率再 +1%，区间进度归零", () => {
    const { goal } = estimate(COMMISSION_START + STEP);
    expect(goal.stage).toBe("inCommission");
    expect(goal.remainingInCents).toBe(STEP);
    expect(goal.nextRateBps).toBe(2200);
    expect(goal.progressRatio).toBeCloseTo(0, 10);
  });

  it("满 5 档：不再提示升档，提成率封顶 25%", () => {
    const revenue = COMMISSION_START + 5 * STEP;
    const { payroll, goal } = estimate(revenue);

    expect(payroll.commissionRateBps).toBe(2500);
    expect(payroll.performanceComponentInCents).toBe(2250000); // floor(9000000 × 25%)

    expect(goal.stage).toBe("maxStep");
    expect(goal.remainingInCents).toBe(0);
    expect(goal.nextRateBps).toBeNull();
    expect(goal.progressRatio).toBe(1);
  });

  it("远超 5 档：仍然封顶在最高阶梯", () => {
    const { payroll, goal } = estimate(COMMISSION_START + 20 * STEP);
    expect(payroll.commissionRateBps).toBe(2500);
    expect(goal.stage).toBe("maxStep");
  });
});

describe("主播首页预估 - 与结算口径同源", () => {
  it("预估 net 与直接调用 calculateAnchorPayroll 完全一致", () => {
    for (const revenue of [0, 1_000_000, THRESHOLD, 2_500_000, COMMISSION_START, 7_654_321]) {
      const { payroll } = estimate(revenue);
      const expected = calculateAnchorPayroll({
        scheme,
        monthlyRevenueInCents: revenue,
        tenureMonth: 4,
      });
      expect(payroll).toEqual(expected);
    }
  });

  it("无责期（第 2 月）零流水仍有保底保护", () => {
    const { payroll } = estimate(0, 2);
    expect(payroll.isGracefulPeriod).toBe(true);
    expect(payroll.guaranteedComponentInCents).toBe(800000);
  });
});

describe("区间流水汇总", () => {
  const rows: AnchorRevenueLike[] = [
    { perfDate: "2026-10-01", revenueCents: 120000, broadcastMinutes: 300, noPerf: false },
    { perfDate: "2026-10-01", revenueCents: 80000, broadcastMinutes: 120, noPerf: false },
    { perfDate: "2026-10-02", revenueCents: 0, broadcastMinutes: 0, noPerf: false },
    { perfDate: "2026-10-03", revenueCents: 999999, broadcastMinutes: 600, noPerf: true },
  ];

  it("跳过无绩效记录，同日多条累加，天数按有业绩日统计", () => {
    expect(summarizeAnchorRevenue(rows)).toEqual({
      revenueInCents: 200000,
      broadcastMinutes: 420,
      activeDays: 1,
    });
  });

  it("空数组返回全 0", () => {
    expect(summarizeAnchorRevenue([])).toEqual({
      revenueInCents: 0,
      broadcastMinutes: 0,
      activeDays: 0,
    });
  });
});

describe("近 N 天序列", () => {
  it("缺失日期补 0，跨月边界正确", () => {
    const rows: AnchorRevenueLike[] = [
      { perfDate: "2026-02-28", revenueCents: 100, broadcastMinutes: 10, noPerf: false },
      { perfDate: "2026-03-02", revenueCents: 300, broadcastMinutes: 30, noPerf: false },
    ];
    expect(buildRecentDailySeries(rows, "2026-03-02", 3)).toEqual([
      { date: "2026-02-28", revenueInCents: 100, broadcastMinutes: 10 },
      { date: "2026-03-01", revenueInCents: 0, broadcastMinutes: 0 },
      { date: "2026-03-02", revenueInCents: 300, broadcastMinutes: 30 },
    ]);
  });

  it("同日多条累加，无绩效记录不计入", () => {
    const rows: AnchorRevenueLike[] = [
      { perfDate: "2026-10-11", revenueCents: 100, broadcastMinutes: 5, noPerf: false },
      { perfDate: "2026-10-11", revenueCents: 250, broadcastMinutes: 7, noPerf: false },
      { perfDate: "2026-10-11", revenueCents: 999, broadcastMinutes: 99, noPerf: true },
    ];
    const series = buildRecentDailySeries(rows, "2026-10-11", 1);
    expect(series).toEqual([
      { date: "2026-10-11", revenueInCents: 350, broadcastMinutes: 12 },
    ]);
  });
});

describe("主播首页预估 - 固定百分比结算", () => {
  const fixedScheme: AnchorSalaryScheme = {
    ...scheme,
    settlementMode: "fixed_percent",
    fixedPercentBps: 2000,
  };

  function fixedEstimate(revenue: number, tenureMonth = 4) {
    return estimateAnchorPayroll({
      scheme: fixedScheme,
      monthlyRevenueInCents: revenue,
      tenureMonth,
    });
  }

  it("工资走了固定百分比口径：总工资 = 总流水 × 20%", () => {
    const { payroll } = fixedEstimate(3_000_000);
    expect(payroll.settlementMode).toBe("fixed_percent");
    expect(payroll.commissionRateBps).toBe(2000);
    expect(payroll.grossSalaryInCents).toBe(600000);
    expect(payroll.guaranteedComponentInCents).toBe(0);
  });

  it("目标进度恒满（无门槛/阶梯），下一里程碑为固定费率本身", () => {
    const { goal } = fixedEstimate(3_000_000);
    expect(goal.stage).toBe("fixedPercent");
    expect(goal.remainingInCents).toBe(0);
    expect(goal.nextRateBps).toBe(2000);
    expect(goal.progressRatio).toBe(1);
  });

  it("预估 net 与直接调用 calculateAnchorPayroll 完全一致", () => {
    const { payroll } = fixedEstimate(1_234_567);
    const expected = calculateAnchorPayroll({
      scheme: fixedScheme,
      monthlyRevenueInCents: 1_234_567,
      tenureMonth: 4,
    });
    expect(payroll.netSalaryInCents).toBe(expected.netSalaryInCents);
    expect(payroll).toEqual(expected);
  });
});
