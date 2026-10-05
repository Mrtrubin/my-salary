import { describe, expect, it, vi } from "vitest";

const client = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ getBrowserSupabase: () => client }));

import {
  listAnchorRewards,
  rewardAdjustmentsByProfile,
  setAnchorRewards,
  type AnchorRewardRow,
} from "@/lib/api/data";

function row(overrides: Partial<AnchorRewardRow> = {}): AnchorRewardRow {
  return {
    id: "r1",
    anchorProfileId: "a1",
    anchorName: "主播甲",
    rewardDate: "2026-09-30",
    name: "奖励",
    amountCents: 5000,
    registeredBy: "t1",
    registeredName: "舞蹈老师",
    note: null,
    updatedAt: "2026-09-30T10:00:00Z",
    ...overrides,
  };
}

describe("rewardAdjustmentsByProfile 奖励聚合为调整项", () => {
  it("按主播聚合、金额为正，并携带登记日期与登记舞蹈老师", () => {
    const map = rewardAdjustmentsByProfile([
      row({ id: "1", amountCents: 5000, name: "奖励" }),
      row({ id: "2", amountCents: 2000, name: "加练奖", rewardDate: "2026-09-29" }),
      row({ id: "3", anchorProfileId: "a2", registeredName: null, amountCents: 1000 }),
    ]);
    expect(map.a1).toEqual([
      { name: "奖励", amountCents: 5000, sourceDate: "2026-09-30", sourceOperator: "舞蹈老师" },
      { name: "加练奖", amountCents: 2000, sourceDate: "2026-09-29", sourceOperator: "舞蹈老师" },
    ]);
    expect(map.a2).toEqual([
      { name: "奖励", amountCents: 1000, sourceDate: "2026-09-30", sourceOperator: undefined },
    ]);
  });

  it("无记录返回空对象", () => {
    expect(rewardAdjustmentsByProfile([])).toEqual({});
  });
});

describe("listAnchorRewards 查询映射", () => {
  it("snake→camel，未传区间时以 null 传参", async () => {
    client.rpc.mockReset();
    client.rpc.mockResolvedValue({
      data: [
        {
          id: "x",
          anchor_profile_id: "a1",
          anchor_name: "主播甲",
          reward_date: "2026-09-30",
          name: "奖励",
          amount_cents: 5000,
          registered_by: "t1",
          registered_name: "舞蹈老师",
          note: "好好跳",
          updated_at: "2026-09-30T10:00:00Z",
        },
      ],
      error: null,
    });
    const rows = await listAnchorRewards();
    expect(client.rpc).toHaveBeenCalledWith("list_anchor_rewards", { p_start: undefined, p_end: undefined });
    expect(rows[0]).toEqual({
      id: "x",
      anchorProfileId: "a1",
      anchorName: "主播甲",
      rewardDate: "2026-09-30",
      name: "奖励",
      amountCents: 5000,
      registeredBy: "t1",
      registeredName: "舞蹈老师",
      note: "好好跳",
      updatedAt: "2026-09-30T10:00:00Z",
    });
  });
});

describe("setAnchorRewards 错误映射", () => {
  it("FORBIDDEN → 无权设置奖励", async () => {
    client.rpc.mockReset();
    client.rpc.mockResolvedValue({ data: null, error: { message: "FORBIDDEN" } });
    await expect(
      setAnchorRewards({ date: "2026-09-30", anchorIds: ["a1"], name: "奖励", amountCents: 100 }),
    ).rejects.toThrow("无权设置奖励");
  });
});
