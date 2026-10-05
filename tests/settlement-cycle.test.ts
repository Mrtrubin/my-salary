import { describe, it, expect } from "vitest";
import {
  getPresetRange,
  addDays,
  nextDay,
  daysInMonth,
  isDateInPeriod,
} from "@/lib/domain/settlement/cycle";
import {
  aggregateSettlement,
  calcTenureMonth,
  type SettlementMemberContext,
  type SettlementPerfRow,
} from "@/lib/domain/settlement/aggregate";
import type { AnchorSalaryScheme } from "@/lib/domain/payroll/types";

describe("cycle.getPresetRange", () => {
  it("当日：起止同为参考日", () => {
    expect(getPresetRange("today", "2026-01-15")).toEqual({
      start: "2026-01-15",
      end: "2026-01-15",
    });
  });
  it("昨日：跨月安全", () => {
    expect(getPresetRange("yesterday", "2026-03-01")).toEqual({
      start: "2026-02-28",
      end: "2026-02-28",
    });
  });
  it("昨日：跨年安全", () => {
    expect(getPresetRange("yesterday", "2027-01-01")).toEqual({
      start: "2026-12-31",
      end: "2026-12-31",
    });
  });
  it("本周：以周一为一周起点（参考日为周四）", () => {
    expect(getPresetRange("thisWeek", "2026-01-15")).toEqual({
      start: "2026-01-12",
      end: "2026-01-18",
    });
  });
  it("本周：参考日为周一与周日同属一周", () => {
    expect(getPresetRange("thisWeek", "2026-01-12")).toEqual({
      start: "2026-01-12",
      end: "2026-01-18",
    });
    expect(getPresetRange("thisWeek", "2026-01-18")).toEqual({
      start: "2026-01-12",
      end: "2026-01-18",
    });
  });
  it("本月：平年 2 月为 28 天", () => {
    expect(getPresetRange("thisMonth", "2026-02-20")).toEqual({
      start: "2026-02-01",
      end: "2026-02-28",
    });
  });
  it("本月：闰年 2 月为 29 天", () => {
    expect(getPresetRange("thisMonth", "2028-02-10")).toEqual({
      start: "2028-02-01",
      end: "2028-02-29",
    });
  });
});

describe("cycle.addDays / nextDay", () => {
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
  it("addDays 负数跨月/跨年", () => {
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2027-01-01", -1)).toBe("2026-12-31");
    expect(addDays("2026-01-12", -4)).toBe("2026-01-08");
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
      roleId: 1,
      schemeId: "s1",
      scheme,
      hireDate: "2026-01-05",
      anchorType: "new",
      baseCommissionRateBps: 2000,
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

  it("聚合任意自定义区间", () => {
    const customPeriod = { start: "2026-01-15", end: "2026-01-16" };
    const perf: SettlementPerfRow[] = [
      { profileId: "p1", perfDate: "2026-01-14", revenueCents: 1000000 },
      { profileId: "p1", perfDate: "2026-01-15", revenueCents: 3000000 },
    ];
    const [draft] = aggregateSettlement(customPeriod, members, perf);
    expect(draft.revenueCents).toBe(3000000);
    expect(draft.periodStart).toBe("2026-01-15");
    expect(draft.periodEnd).toBe("2026-01-16");
  });

  it("无流水成员产出 0 流水草稿", () => {
    const [draft] = aggregateSettlement(period, members, []);
    expect(draft.revenueCents).toBe(0);
    expect(draft.isQualified).toBe(false);
  });

  it("服务率取方案手动配置：服务费 = ceil(实发收益 × 方案服务率)", () => {
    const member: SettlementMemberContext = {
      ...members[0],
      scheme: { ...scheme, serviceFeeRateBps: 500 },
    };
    const [draft] = aggregateSettlement(period, [member], []);
    expect(draft.grossCents).toBe(800000);
    expect(draft.serviceFeeCents).toBe(40000);
    expect(draft.netCents).toBe(760000);
  });

  it("多日流水按日累加（DB 唯一约束保证每日每主播仅一条）", () => {
    const perf: SettlementPerfRow[] = [
      { profileId: "p1", perfDate: "2026-01-10", revenueCents: 3500000, createdAt: "2026-01-10T12:00:00Z" },
      { profileId: "p1", perfDate: "2026-01-20", revenueCents: 500000, createdAt: "2026-01-20T10:00:00Z" },
    ];
    const [draft] = aggregateSettlement(period, members, perf);
    // 01-10 的 3500000 + 01-20 的 500000 = 4000000。
    expect(draft.revenueCents).toBe(4000000);
  });
});
