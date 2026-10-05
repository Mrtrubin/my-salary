import { describe, expect, it, vi } from "vitest";

const client = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ getBrowserSupabase: () => client }));

import {
  anchorAdjustmentsByProfile,
  listAnchorAdjustments,
  listAnchorMembers,
  setDanceAdjustments,
  type AnchorAdjustmentRow,
} from "@/lib/api/data";

function row(overrides: Partial<AnchorAdjustmentRow> = {}): AnchorAdjustmentRow {
  return {
    id: "r1",
    anchorProfileId: "a1",
    anchorName: "主播甲",
    adjustDate: "2026-10-05",
    name: "补助",
    amountCents: 10000,
    source: "dance",
    registeredBy: "t1",
    registeredName: "舞蹈老师",
    note: null,
    updatedAt: "2026-10-05T10:00:00Z",
    ...overrides,
  };
}

describe("anchorAdjustmentsByProfile 统一调整项聚合", () => {
  it("按主播聚合、保留金额正负，并携带来源日期与登记人", () => {
    const map = anchorAdjustmentsByProfile([
      row({ id: "1", name: "补助", amountCents: 10000 }),
      row({ id: "2", name: "延误", amountCents: -3500 }),
      row({ id: "3", anchorProfileId: "a2", registeredName: null, amountCents: 2000 }),
    ]);
    expect(map.a1).toEqual([
      { name: "补助", amountCents: 10000, sourceDate: "2026-10-05", sourceOperator: "舞蹈老师" },
      { name: "延误", amountCents: -3500, sourceDate: "2026-10-05", sourceOperator: "舞蹈老师" },
    ]);
    expect(map.a2).toEqual([
      { name: "补助", amountCents: 2000, sourceDate: "2026-10-05", sourceOperator: undefined },
    ]);
  });

  it("无记录返回空对象", () => {
    expect(anchorAdjustmentsByProfile([])).toEqual({});
  });
});

describe("listAnchorAdjustments 查询映射", () => {
  it("按 source 过滤并以 snake→camel 映射", async () => {
    client.rpc.mockReset();
    client.rpc.mockResolvedValue({
      data: [
        {
          id: "x",
          anchor_profile_id: "a1",
          anchor_name: "主播甲",
          adjust_date: "2026-10-05",
          name: "延误",
          amount_cents: -3500,
          source: "dance",
          registered_by: "t1",
          registered_name: "舞蹈老师",
          note: "迟到",
          updated_at: "2026-10-05T10:00:00Z",
        },
      ],
      error: null,
    });
    const rows = await listAnchorAdjustments({ source: "dance", range: { start: "2026-10-01", end: "2026-10-31" } });
    expect(client.rpc).toHaveBeenCalledWith("list_anchor_adjustments", {
      p_source: "dance",
      p_start: "2026-10-01",
      p_end: "2026-10-31",
    });
    expect(rows[0]).toEqual({
      id: "x",
      anchorProfileId: "a1",
      anchorName: "主播甲",
      adjustDate: "2026-10-05",
      name: "延误",
      amountCents: -3500,
      source: "dance",
      registeredBy: "t1",
      registeredName: "舞蹈老师",
      note: "迟到",
      updatedAt: "2026-10-05T10:00:00Z",
    });
  });
});

describe("setDanceAdjustments 传参与错误映射", () => {
  it("以日期 + entries 调用 RPC", async () => {
    client.rpc.mockReset();
    client.rpc.mockResolvedValue({ data: 2, error: null });
    const count = await setDanceAdjustments({
      date: "2026-10-05",
      entries: [{ anchorId: "a1", items: [{ name: "补助", amountCents: 10000 }] }],
    });
    expect(client.rpc).toHaveBeenCalledWith("set_dance_adjustments", {
      p_date: "2026-10-05",
      p_entries: [{ anchorId: "a1", items: [{ name: "补助", amountCents: 10000 }] }],
      p_registered_by: undefined,
    });
    expect(count).toBe(2);
  });

  it("FORBIDDEN → 无权设置练舞调整项", async () => {
    client.rpc.mockReset();
    client.rpc.mockResolvedValue({ data: null, error: { message: "FORBIDDEN" } });
    await expect(setDanceAdjustments({ date: "2026-10-05", entries: [] })).rejects.toThrow(
      "无权设置练舞调整项",
    );
  });

  it("INVALID_ADJUSTMENT_AMOUNT → 金额不合法", async () => {
    client.rpc.mockReset();
    client.rpc.mockResolvedValue({ data: null, error: { message: "INVALID_ADJUSTMENT_AMOUNT" } });
    await expect(
      setDanceAdjustments({ date: "2026-10-05", entries: [{ anchorId: "a1", items: [] }] }),
    ).rejects.toThrow("金额不合法");
  });
});

describe("listAnchorMembers 查询映射", () => {
  it("映射 base_salary_cents", async () => {
    client.rpc.mockReset();
    client.rpc.mockResolvedValue({
      data: [{ id: "a1", name: "主播甲", base_salary_cents: 26000 }],
      error: null,
    });
    const rows = await listAnchorMembers();
    expect(client.rpc).toHaveBeenCalledWith("list_anchor_members");
    expect(rows).toEqual([{ id: "a1", name: "主播甲", baseSalaryCents: 26000 }]);
  });
});
