import { describe, expect, it } from "vitest";
import {
  adjustmentItemTexts,
  buildRevenueRecordFields,
  formatAdjustmentItems,
  revenueBreakdown,
  sumRevenueBreakdown,
} from "@/lib/domain/performance/recordView";

describe("revenueBreakdown：当日流水 / 调整项 / 最终流水", () => {
  it("最终流水 = 流水，调整项为负时当日流水高于最终流水", () => {
    expect(revenueBreakdown({ revenue_cents: 10000, adjustment_cents: -2000 })).toEqual({
      baseCents: 12000,
      adjustmentCents: -2000,
      finalCents: 10000,
    });
  });

  it("无调整项时三者一致", () => {
    expect(revenueBreakdown({ revenue_cents: 5000, adjustment_cents: 0 })).toEqual({
      baseCents: 5000,
      adjustmentCents: 0,
      finalCents: 5000,
    });
  });
});

describe("sumRevenueBreakdown：多条记录汇总", () => {
  it("分别汇总调整项与最终流水，当日流水为差额", () => {
    expect(
      sumRevenueBreakdown([
        { revenue_cents: 10000, adjustment_cents: -2000 },
        { revenue_cents: 3000, adjustment_cents: 500 },
      ]),
    ).toEqual({ baseCents: 14500, adjustmentCents: -1500, finalCents: 13000 });
  });
});

describe("调整项明细文案", () => {
  it("格式化单项/单行，丢弃零值与非法值", () => {
    expect(
      adjustmentItemTexts([
        { name: "运营票", amount: 100 },
        { name: "罚款", amount: -50 },
        { name: "无效", amount: 0 },
      ]),
    ).toEqual(["运营票 +100", "罚款 -50"]);
    expect(formatAdjustmentItems([{ name: "奖励", amount: 30 }])).toBe("奖励 +30");
    expect(formatAdjustmentItems([])).toBe("");
    expect(formatAdjustmentItems(null)).toBe("");
  });
});

describe("buildRevenueRecordFields：完整字段", () => {
  it("包含关键字段与三项口径", () => {
    const fields = buildRevenueRecordFields({
      perf_date: "2026-09-06",
      points_amount: 111,
      revenue_cents: 10000,
      adjustment_cents: -2000,
      broadcast_minutes: 360,
      no_perf: false,
      no_perf_note: null,
      created_at: "2026-09-06T12:00:00Z",
      team: { name: "水晶之恋", team_code: "T-001" },
      point: { name: "音浪" },
      profile: { name: "甲" },
      host: { name: "主持甲" },
    });
    const labels = fields.map((f) => f.label);
    expect(labels).toContain("当日流水");
    expect(labels).toContain("当日调整项");
    expect(labels).toContain("当日最终流水");
    expect(labels).toContain("直播时长");
    expect(fields.find((f) => f.label === "绩效点")?.value).toBe("音浪");
  });

  it("有逐条调整项时展示明细，无则省略", () => {
    const withItems = buildRevenueRecordFields({
      perf_date: "2026-09-06",
      points_amount: 111,
      revenue_cents: 10000,
      adjustment_cents: 0,
      broadcast_minutes: 0,
      no_perf: false,
      no_perf_note: null,
      adjustments: [
        { name: "运营票", amount: 100 },
        { name: "罚款", amount: -50 },
      ],
    });
    expect(withItems.find((f) => f.label === "调整项明细")?.value).toBe("运营票 +100、罚款 -50");

    const withoutItems = buildRevenueRecordFields({
      perf_date: "2026-09-06",
      points_amount: 111,
      revenue_cents: 10000,
      adjustment_cents: 0,
      broadcast_minutes: 0,
      no_perf: false,
      no_perf_note: null,
      adjustments: [],
    });
    expect(withoutItems.some((f) => f.label === "调整项明细")).toBe(false);
  });

  it("休息/停播记录绩效点显示备注", () => {
    const fields = buildRevenueRecordFields({
      perf_date: "2026-09-06",
      points_amount: 0,
      revenue_cents: 0,
      adjustment_cents: 0,
      broadcast_minutes: 0,
      no_perf: true,
      no_perf_note: "停播",
    });
    expect(fields.find((f) => f.label === "绩效点")?.value).toBe("停播");
    expect(fields.find((f) => f.label === "业绩")?.value).toBe("—");
  });
});
