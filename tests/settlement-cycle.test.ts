import { describe, it, expect } from "vitest";
import {
  getPeriodRange,
  isPeriodFirstDay,
  getPreviousPeriodRange,
  isDateInPeriod,
  daysInMonth,
  listPeriodRangesFrom,
  nextDay,
} from "@/lib/domain/settlement/cycle";
import {
  aggregateSettlement,
  calcTenureMonth,
  type SettlementMemberContext,
  type SettlementPerfRow,
} from "@/lib/domain/settlement/aggregate";
import type { AnchorSalaryScheme } from "@/lib/domain/payroll/types";

describe("cycle.getPeriodRange - monthly", () => {
  it("大月：31 天月份", () => {
    expect(getPeriodRange("monthly", 1, "2026-01-15")).toEqual({
      start: "2026-01-01",
      end: "2026-01-31",
    });
  });
  it("小月：30 天月份", () => {
    expect(getPeriodRange("monthly", 1, "2026-04-10")).toEqual({
      start: "2026-04-01",
      end: "2026-04-30",
    });
  });
  it("平年 2 月为 28 天", () => {
    expect(getPeriodRange("monthly", 1, "2026-02-20")).toEqual({
      start: "2026-02-01",
      end: "2026-02-28",
    });
  });
  it("闰年 2 月为 29 天", () => {
    expect(getPeriodRange("monthly", 1, "2028-02-10")).toEqual({
      start: "2028-02-01",
      end: "2028-02-29",
    });
  });
});

describe("cycle.getPeriodRange - custom", () => {
  it("startDay=21，date 在起始日之后：本月 21 → 次月 20", () => {
    expect(getPeriodRange("custom", 21, "2026-01-25")).toEqual({
      start: "2026-01-21",
      end: "2026-02-20",
    });
  });
  it("startDay=21，date 在起始日之前：上月 21 → 本月 20", () => {
    expect(getPeriodRange("custom", 21, "2026-01-10")).toEqual({
      start: "2025-12-21",
      end: "2026-01-20",
    });
  });
  it("startDay=21，date 恰为起始日：从当日起", () => {
    expect(getPeriodRange("custom", 21, "2026-01-21")).toEqual({
      start: "2026-01-21",
      end: "2026-02-20",
    });
  });
  it("startDay=28，跨月截止到次月 27", () => {
    expect(getPeriodRange("custom", 28, "2026-03-28")).toEqual({
      start: "2026-03-28",
      end: "2026-04-27",
    });
  });
  it("跨年边界：12 月起始，次年 1 月结束", () => {
    expect(getPeriodRange("custom", 21, "2026-12-25")).toEqual({
      start: "2026-12-21",
      end: "2027-01-20",
    });
  });
  it("非法起始日抛错", () => {
    expect(() => getPeriodRange("custom", 30, "2026-01-01")).toThrow();
  });
});

describe("cycle.isPeriodFirstDay", () => {
  it("monthly：1 号为周期第一天", () => {
    expect(isPeriodFirstDay("monthly", 1, "2026-05-01")).toBe(true);
    expect(isPeriodFirstDay("monthly", 1, "2026-05-02")).toBe(false);
  });
  it("custom：日等于 startDay 为周期第一天", () => {
    expect(isPeriodFirstDay("custom", 21, "2026-05-21")).toBe(true);
    expect(isPeriodFirstDay("custom", 21, "2026-05-20")).toBe(false);
  });
});

describe("cycle.getPreviousPeriodRange", () => {
  it("monthly：次月 1 号 → 上一自然月", () => {
    expect(getPreviousPeriodRange("monthly", 1, "2026-03-01")).toEqual({
      start: "2026-02-01",
      end: "2026-02-28",
    });
  });
  it("monthly：跨年 1 月 1 号 → 上年 12 月", () => {
    expect(getPreviousPeriodRange("monthly", 1, "2027-01-01")).toEqual({
      start: "2026-12-01",
      end: "2026-12-31",
    });
  });
  it("custom：本月 21 号 → 上月 21 至本月 20", () => {
    expect(getPreviousPeriodRange("custom", 21, "2026-03-21")).toEqual({
      start: "2026-02-21",
      end: "2026-03-20",
    });
  });
});

describe("cycle.nextDay", () => {
  it("普通日 +1", () => {
    expect(nextDay("2026-01-15")).toBe("2026-01-16");
  });
  it("月末跨月", () => {
    expect(nextDay("2026-01-31")).toBe("2026-02-01");
  });
  it("年末跨年", () => {
    expect(nextDay("2026-12-31")).toBe("2027-01-01");
  });
  it("闰年 2 月末", () => {
    expect(nextDay("2028-02-29")).toBe("2028-03-01");
  });
});

describe("cycle.listPeriodRangesFrom", () => {
  it("monthly：从月中补齐到月末", () => {
    expect(listPeriodRangesFrom("monthly", 1, "2026-08-15", "2026-08-31")).toEqual([
      { start: "2026-08-01", end: "2026-08-31" },
    ]);
  });
  it("monthly：跨两个月连续枚举", () => {
    expect(listPeriodRangesFrom("monthly", 1, "2026-08-15", "2026-09-10")).toEqual([
      { start: "2026-08-01", end: "2026-08-31" },
      { start: "2026-09-01", end: "2026-09-30" },
    ]);
  });
  it("custom startDay=21：相邻周期间无空隙无重叠", () => {
    const ranges = listPeriodRangesFrom("custom", 21, "2026-08-21", "2026-09-21");
    expect(ranges).toEqual([
      { start: "2026-08-21", end: "2026-09-20" },
      { start: "2026-09-21", end: "2026-10-20" },
    ]);
  });
  it("seed 晚于 asOf 时返回空数组", () => {
    expect(listPeriodRangesFrom("monthly", 1, "2026-09-15", "2026-09-10")).toEqual([]);
  });
});

describe("cycle.isDateInPeriod / daysInMonth", () => {
  const period = { start: "2026-01-21", end: "2026-02-20" };
  it("端点含边界", () => {
    expect(isDateInPeriod("2026-01-21", period)).toBe(true);
    expect(isDateInPeriod("2026-02-20", period)).toBe(true);
  });
  it("区间外为 false", () => {
    expect(isDateInPeriod("2026-01-20", period)).toBe(false);
    expect(isDateInPeriod("2026-02-21", period)).toBe(false);
  });
  it("daysInMonth 闰月", () => {
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2026, 2)).toBe(28);
  });
});

describe("aggregate.calcTenureMonth", () => {
  it("同月入职为第 1 月", () => {
    expect(calcTenureMonth("2026-03-05", "2026-03-31")).toBe(1);
  });
  it("跨 2 个月为第 3 月（仍无责期）", () => {
    expect(calcTenureMonth("2026-01-10", "2026-03-20")).toBe(3);
  });
  it("跨年计算", () => {
    expect(calcTenureMonth("2025-11-01", "2026-02-28")).toBe(4);
  });
  it("周期止日早于入职日兜底为 1", () => {
    expect(calcTenureMonth("2026-05-01", "2026-03-31")).toBe(1);
  });
});

describe("aggregate.aggregateSettlement", () => {
  const scheme: AnchorSalaryScheme = {
    baseSalaryInCents: 800000,
    guaranteedSalaryInCents: 500000,
    thresholdMultiplierBps: 26500,
  };
  const members: SettlementMemberContext[] = [
    {
      profileId: "p1",
      positionId: 1,
      schemeId: "s1",
      scheme,
      hireDate: "2026-01-05",
    },
  ];
  const period = { start: "2026-01-01", end: "2026-01-31" };

  it("聚合周期内流水并调用计算器", () => {
    const perf: SettlementPerfRow[] = [
      { profileId: "p1", perfDate: "2026-01-10", revenueCents: 3000000 },
      { profileId: "p1", perfDate: "2026-01-20", revenueCents: 2000000 },
      { profileId: "p1", perfDate: "2026-02-01", revenueCents: 9999},
    ];
    const [draft] = aggregateSettlement(period, members, perf);
    expect(draft.revenueCents).toBe(5000000);
    expect(draft.tenureMonth).toBe(1);
    expect(draft.month).toBe("2026-01-01");
    expect(draft.periodStart).toBe("2026-01-01");
    expect(draft.periodEnd).toBe("2026-01-31");
    expect(draft.isGracePeriod).toBe(true);
    expect(draft.thresholdCents).toBe(2120000);
    expect(draft.isQualified).toBe(true);
  });

  it("无流水成员产出 0 流水草稿", () => {
    const [draft] = aggregateSettlement(period, members, []);
    expect(draft.revenueCents).toBe(0);
    expect(draft.isQualified).toBe(false);
  });
});