import { describe, expect, it } from "vitest";
import {
  adjustmentSourceLabel,
  summarizeAnchorAdjustments,
  type AdjustmentLike,
} from "@/app/(user)/user/dashboard/adjustments";

function row(over: Partial<AdjustmentLike> = {}): AdjustmentLike {
  return {
    adjustDate: "2026-10-05",
    name: "奖励",
    amountCents: 30000,
    source: "dance",
    note: null,
    registeredName: "李舞蹈",
    ...over,
  };
}

describe("每日调整项 - 清洗", () => {
  it("丢弃零值与非法金额（避免 -¥0.00 噪音）", () => {
    const { items, totalCents } = summarizeAnchorAdjustments([
      row({ amountCents: 0 }),
      row({ amountCents: Number.NaN }),
      row({ amountCents: Number.POSITIVE_INFINITY }),
      row({ amountCents: 30000 }),
    ]);

    expect(items).toHaveLength(1);
    expect(totalCents).toBe(30000);
  });

  it("丢弃空名称与空日期", () => {
    const { items } = summarizeAnchorAdjustments([
      row({ name: "   " }),
      row({ adjustDate: "" }),
      row({ name: " 补助 ", adjustDate: "2026-10-06" }),
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ name: "补助", date: "2026-10-06" });
  });

  it("空输入返回空结果（组件据此整块不渲染）", () => {
    expect(summarizeAnchorAdjustments([])).toEqual({ items: [], totalCents: 0 });
  });
});

describe("每日调整项 - 排序与合计", () => {
  it("按日期倒序排列", () => {
    const { items } = summarizeAnchorAdjustments([
      row({ adjustDate: "2026-10-03", name: "延误", amountCents: -20000, source: "makeup" }),
      row({ adjustDate: "2026-10-07", name: "停播", amountCents: -30000, source: "host" }),
      row({ adjustDate: "2026-10-05", name: "奖励", amountCents: 30000, source: "dance" }),
      row({ adjustDate: "2026-10-05", name: "补助", amountCents: 10000, source: "dance" }),
    ]);

    expect(items.map((item) => item.date)).toEqual([
      "2026-10-07",
      "2026-10-05",
      "2026-10-05",
      "2026-10-03",
    ]);
    // 同日两条都保留（同日内顺序由名称决定，不在此断言）
    expect(items.filter((item) => item.date === "2026-10-05")).toHaveLength(2);
  });

  it("本期合计为正负相抵后的净额", () => {
    const { totalCents } = summarizeAnchorAdjustments([
      row({ amountCents: 30000 }),
      row({ amountCents: -20000 }),
      row({ amountCents: -30000 }),
    ]);

    expect(totalCents).toBe(-20000);
  });
});

describe("每日调整项 - 来源文案", () => {
  it("四个来源映射为「谁记的」", () => {
    expect(adjustmentSourceLabel("host")).toBe("主持");
    expect(adjustmentSourceLabel("dance")).toBe("舞蹈老师");
    expect(adjustmentSourceLabel("makeup")).toBe("化妆师");
  });

  it("未知来源原样透出，便于暴露新增来源", () => {
    expect(adjustmentSourceLabel("hr")).toBe("hr");
  });

  it("条目携带来源文案，未知来源不崩", () => {
    const { items } = summarizeAnchorAdjustments([
      row({ source: "host", name: "停播", amountCents: -30000 }),
      row({ source: "hr", name: "自定义", amountCents: 500 }),
    ]);

    const labels = items.map((item) => item.sourceLabel);
    expect(labels).toContain("主持");
    expect(labels).toContain("hr");
  });
});
