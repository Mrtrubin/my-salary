import { describe, expect, it, vi } from "vitest";

const client = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ getBrowserSupabase: () => client }));

import { listStaffMembers, listStaffPerformance, setStaffPerformance } from "@/lib/api/data";

describe("listStaffMembers 查询映射", () => {
  it("按角色查询并映射基础薪资", async () => {
    client.rpc.mockReset();
    client.rpc.mockResolvedValue({ data: [{ id: "h1", name: "人事甲", base_income_cents: 500000 }], error: null });
    const rows = await listStaffMembers("hr");
    expect(client.rpc).toHaveBeenCalledWith("list_staff_members", { p_role_code: "hr" });
    expect(rows).toEqual([{ id: "h1", name: "人事甲", baseIncomeCents: 500000 }]);
  });
});

describe("listStaffPerformance 查询映射", () => {
  it("snake→camel，默认角色 hr 并透传区间", async () => {
    client.rpc.mockReset();
    client.rpc.mockResolvedValue({
      data: [
        {
          id: "x",
          profile_id: "h1",
          profile_name: "人事甲",
          role_code: "hr",
          adjust_date: "2026-10-05",
          name: "补贴",
          amount_cents: 20000,
          registered_by: "m1",
          registered_name: "人事主管",
          note: "加班",
          updated_at: "2026-10-05T10:00:00Z",
        },
      ],
      error: null,
    });
    const rows = await listStaffPerformance({ range: { start: "2026-10-01", end: "2026-10-31" } });
    expect(client.rpc).toHaveBeenCalledWith("list_staff_performance", {
      p_role_code: "hr",
      p_start: "2026-10-01",
      p_end: "2026-10-31",
    });
    expect(rows[0]).toEqual({
      id: "x",
      profileId: "h1",
      profileName: "人事甲",
      roleCode: "hr",
      adjustDate: "2026-10-05",
      name: "补贴",
      amountCents: 20000,
      registeredBy: "m1",
      registeredName: "人事主管",
      note: "加班",
      updatedAt: "2026-10-05T10:00:00Z",
    });
  });
});

describe("setStaffPerformance 传参与错误映射", () => {
  it("以角色+日期+entries 调用 RPC", async () => {
    client.rpc.mockReset();
    client.rpc.mockResolvedValue({ data: 1, error: null });
    const count = await setStaffPerformance({
      roleCode: "hr",
      date: "2026-10-05",
      entries: [{ profileId: "h1", items: [{ name: "补贴", amountCents: 20000 }] }],
    });
    expect(client.rpc).toHaveBeenCalledWith("set_staff_performance", {
      p_role_code: "hr",
      p_date: "2026-10-05",
      p_entries: [{ profileId: "h1", items: [{ name: "补贴", amountCents: 20000 }] }],
      p_registered_by: undefined,
    });
    expect(count).toBe(1);
  });

  it("FORBIDDEN → 无权设置人事绩效", async () => {
    client.rpc.mockReset();
    client.rpc.mockResolvedValue({ data: null, error: { message: "FORBIDDEN" } });
    await expect(
      setStaffPerformance({ roleCode: "hr", date: "2026-10-05", entries: [] }),
    ).rejects.toThrow("无权设置人事绩效");
  });
});
