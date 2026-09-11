import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getAnchorSettlementContexts, listAnchorRevenuePerf, parseSalaryAdjustments,
  rejectAndRecompute, settleAnchorRevenue, settlementMemberKey,
} from "@/lib/api/data";

const client = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ getBrowserSupabase: () => client }));

type Row = Record<string, unknown>;
type Operation = { method: string; args: unknown[] };
type Query = { table: string; operations: Operation[] };
const period = { start: "2026-04-01", end: "2026-04-30" };
let tables: Record<string, Row[]>;
let queries: Query[];
const valueAt = (row: Row, path: string): unknown => path.split(".").reduce<unknown>(
  (value, key) => value && typeof value === "object" ? (value as Row)[key] : undefined, row,
);

// 只模拟本测试用到的 PostgREST 查询语义；不替代真实数据库、RLS 或事务验收。
function makeQuery(table: string) {
  const operations: Operation[] = [];
  queries.push({ table, operations });
  const builder = {
    select: (columns: string) => add("select", columns),
    eq: (key: string, value: unknown) => add("eq", key, value),
    in: (key: string, values: unknown[]) => add("in", key, values),
    lt: (key: string, value: string) => add("lt", key, value),
    lte: (key: string, value: string) => add("lte", key, value),
    gte: (key: string, value: string) => add("gte", key, value),
    or: (filter: string) => add("or", filter),
    order: (key: string, options?: { ascending?: boolean }) => add("order", key, options),
    range: (from: number, to: number) => add("range", from, to),
    single: () => Promise.resolve({ data: execute()[0] ?? null, error: null }),
    maybeSingle: () => Promise.resolve({ data: execute()[0] ?? null, error: null }),
    then: (resolve: (result: { data: Row[]; error: null }) => unknown) =>
      Promise.resolve({ data: execute(), error: null }).then(resolve),
  };
  function add(method: string, ...args: unknown[]) {
    operations.push({ method, args });
    return builder;
  }
  function execute() {
    if (!(table in tables)) throw new Error(`Unexpected table: ${table}`);
    let rows = [...tables[table]];
    for (const { method, args } of operations) {
      const [key, value] = args;
      const column = String(key);
      if (method === "eq") rows = rows.filter((r) => valueAt(r, column) === value);
      if (method === "in") rows = rows.filter((r) => (value as unknown[]).includes(valueAt(r, column)));
      if (method === "lt") rows = rows.filter((r) => String(valueAt(r, column)) < String(value));
      if (method === "lte") rows = rows.filter((r) => String(valueAt(r, column)) <= String(value));
      if (method === "gte") rows = rows.filter((r) => String(valueAt(r, column)) >= String(value));
      if (method === "or") {
        if (column.startsWith("left_at.is.null,left_at.gte.")) {
          const start = column.slice("left_at.is.null,left_at.gte.".length);
          rows = rows.filter((r) => r.left_at === null || String(r.left_at) >= start);
        } else if (column.startsWith("profile_id.is.null,profile_id.in.(")) {
          const ids = column.slice("profile_id.is.null,profile_id.in.(".length, -1).split(",");
          rows = rows.filter((r) => r.profile_id === null || ids.includes(String(r.profile_id)));
        } else throw new Error(`Unexpected OR filter: ${column}`);
      }
    }
    const orders = operations.filter((op) => op.method === "order");
    rows.sort((a, b) => {
      for (const { args: [key, options] } of orders) {
        const av = valueAt(a, String(key)) as string | number;
        const bv = valueAt(b, String(key)) as string | number;
        const comparison = av === bv ? 0 : av < bv ? -1 : 1;
        if (comparison) return (options as { ascending?: boolean })?.ascending === false ? -comparison : comparison;
      }
      return 0;
    });
    const range = operations.find((op) => op.method === "range");
    if (range) rows = rows.slice(Number(range.args[0]), Number(range.args[1]) + 1);
    return rows;
  }
  return builder;
}

const membership = (profileId: string, extra: Row = {}): Row => ({
  id: `m-${profileId}`, profile_id: profileId, team_id: "t1",
  joined_at: "2026-01-01", left_at: null, ...extra,
});
const profile = (id: string): Row => ({ id, name: id, hire_date: "2026-01-01" });
const scheme = (id: string, profileId: string | null, extra: Row = {}): Row => ({
  id, profile_id: profileId, position_id: 7, status: "active", effective_from: "2026-01-01",
  version: 1, base_salary_cents: 800000, guaranteed_salary_cents: 500000,
  threshold_multiplier_bps: 26500, ...extra,
});
const revenue = (id: string, extra: Row = {}): Row => ({
  id, profile_id: "p1", team_id: "t1", perf_date: "2026-04-10", revenue_cents: 2500000,
  broadcast_minutes: 60, no_perf: false, no_perf_note: null, created_at: "2026-04-10T12:00:00Z",
  team: { name: "团队" }, point: { name: "绩效点" }, profile: { name: "主播" }, ...extra,
});
const input = () => ({ teamId: null, period, members: [{ profileId: "p1", positionId: 7 }] });
const queried = (table: string, method: string) => queries.filter((q) => q.table === table)
  .flatMap((q) => q.operations.filter((op) => op.method === method).map((op) => op.args));

beforeEach(() => {
  vi.resetAllMocks();
  queries = [];
  tables = {
    team_members: [membership("p1")], anchor_revenue_records: [revenue("a"), revenue("b", { team_id: "t2" })],
    user_positions: [], profiles: [profile("p1")], positions: [{ id: 7, code: "anchor" }],
    salary_schemes: [scheme("template", null)], salary_records: [],
  };
  client.from.mockImplementation(makeQuery);
  client.rpc.mockResolvedValue({ data: 1, error: null });
});
afterEach(() => vi.useRealTimers());

describe("结算名单与跨团读取", () => {
  it("团队只筛名单，同人同日的其他团队流水保留，排除其他人员与周期外记录", async () => {
    tables.anchor_revenue_records.push(revenue("other", { profile_id: "p2", team_id: "t2" }),
      revenue("outside", { perf_date: "2026-05-01" }));
    const rows = await listAnchorRevenuePerf("t1", period.start, period.end);
    expect(rows.map((r) => r.id)).toEqual(["a", "b"]);
    expect(rows.reduce((sum, r) => sum + r.revenueCents, 0)).toBe(5000000);
    const reads = queries.filter((q) => q.operations.some((op) => op.method === "in"));
    expect(reads).toHaveLength(1);
    expect(reads[0].operations).not.toContainEqual({ method: "eq", args: ["team_id", "t1"] });
  });

  it("覆盖周期内历史成员、流水发现的离组人员和无团队主播", async () => {
    tables.team_members = [membership("historical", { left_at: period.start }),
      membership("expired", { left_at: "2026-03-31" }), membership("future", { joined_at: "2026-05-01" })];
    tables.anchor_revenue_records = [revenue("departed", { profile_id: "departed" })];
    tables.user_positions = [
      { profile_id: "solo", position_id: 7, position: { code: "anchor" }, profile: { hire_date: period.end } },
      { profile_id: "host", position_id: 2, position: { code: "host" }, profile: { hire_date: period.start } },
      { profile_id: "new", position_id: 7, position: { code: "anchor" }, profile: { hire_date: "2026-05-01" } },
    ];
    tables.profiles = ["historical", "departed", "solo", "expired", "future", "host", "new"].map(profile);
    const { members } = await getAnchorSettlementContexts(null, period);
    expect(members.map((m) => m.profileId).sort()).toEqual(["departed", "historical", "solo"]);
    expect(members.every((m) => m.positionId === 7)).toBe(true);
  });

  it("完整读取超过 500 条流水，超过 100 人分批且稳定合并", async () => {
    tables.team_members = Array.from({ length: 101 }, (_, i) => membership(`p${String(i).padStart(3, "0")}`));
    tables.anchor_revenue_records = Array.from({ length: 501 }, (_, i) => revenue(`r${String(i).padStart(3, "0")}`, { profile_id: "p000" }));
    tables.anchor_revenue_records.push(revenue("latest", { profile_id: "p100", perf_date: period.end }));
    const rows = await listAnchorRevenuePerf("t1", period.start, period.end);
    expect(rows).toHaveLength(502);
    expect(new Set(rows.map((r) => r.id)).size).toBe(502);
    expect(rows[0].id).toBe("latest");
    expect(queried("anchor_revenue_records", "in").map((args) => (args[1] as string[]).length)).toEqual([100, 100, 1]);
    expect(queried("anchor_revenue_records", "range")).toContainEqual([500, 999]);
  });
});

describe("方案与人岗位上下文", () => {
  it("有效个人方案优先，同日按版本与 ID 稳定选择；其他成员回退模板", async () => {
    tables.team_members.push(membership("p2"));
    tables.profiles.push(profile("p2"));
    tables.salary_schemes = [
      scheme("template", null, { effective_from: period.end }),
      scheme("older", "p1", { version: 1 }), scheme("b", "p1", { version: 2 }),
      scheme("a", "p1", { version: 2 }),
      scheme("future", "p1", { effective_from: "2026-05-01" }),
      scheme("inactive", "p1", { status: "inactive", effective_from: period.end }),
      scheme("wrong-position", "p1", { position_id: 2, effective_from: period.end }),
    ];
    tables.salary_records = [
      { id: "old", profile_id: "p1", position_id: 7, period_end: "2026-02-28", is_qualified: true },
      { id: "latest", profile_id: "p1", position_id: 7, period_end: "2026-03-31", is_qualified: false, team_id: "t2" },
      { id: "current", profile_id: "p1", position_id: 7, period_end: period.end, is_qualified: true },
      { id: "wrong", profile_id: "p1", position_id: 2, period_end: "2026-03-31", is_qualified: true },
    ];
    const { members } = await getAnchorSettlementContexts("t1", period);
    expect(members.map((m) => [m.profileId, m.schemeId, m.lastMonthQualified]))
      .toEqual([["p1", "a", false], ["p2", "template", true]]);
    expect(queried("salary_records", "eq")).toEqual([]);
  });

  it("无方案仍显示成员及真实岗位，但拒绝结算", async () => {
    tables.salary_schemes = [];
    const { members } = await getAnchorSettlementContexts(null, period);
    expect(members).toMatchObject([{ profileId: "p1", positionId: 7, schemeId: null, scheme: null }]);
    await expect(settleAnchorRevenue(input())).rejects.toThrow("缺少生效工资方案");
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("人岗位键区分岗位，重复身份、空名单及岗位不匹配均拒绝写入", async () => {
    expect(settlementMemberKey({ profileId: "p1", positionId: 7 })).not.toBe(settlementMemberKey({ profileId: "p1", positionId: 2 }));
    await expect(settleAnchorRevenue({ ...input(), members: [] })).rejects.toThrow("至少勾选");
    await expect(settleAnchorRevenue({ ...input(), members: [...input().members, ...input().members] })).rejects.toThrow("不能重复");
    expect(client.from).not.toHaveBeenCalled();
    await expect(settleAnchorRevenue({ ...input(), members: [{ profileId: "p1", positionId: 2 }] })).rejects.toThrow("岗位不匹配");
    await expect(settleAnchorRevenue({ ...input(), members: [{ profileId: "outsider", positionId: 7 }] })).rejects.toThrow("不在当前名单");
    expect(client.rpc).not.toHaveBeenCalled();
  });
});

describe("手动结算", () => {
  it("空团队结算本人跨团收入，排除无绩效并写入调整后的工资金额", async () => {
    tables.anchor_revenue_records.push(revenue("no-perf", { no_perf: true, revenue_cents: 9000000 }));
    const result = await settleAnchorRevenue({ ...input(), members: [{ profileId: "p1", positionId: 7,
      adjustments: [{ name: " 奖金 ", amountCents: 10001 }, { name: "扣款", amountCents: -5000 }] }] });
    expect(result).toEqual({ settledRecords: 1 });
    expect(client.rpc).toHaveBeenCalledExactlyOnceWith("settle_anchor_revenue", {
      p_team_id: null, p_period_start: period.start, p_period_end: period.end,
      p_members: [expect.objectContaining({ profileId: "p1", positionId: 7, schemeId: "template",
        revenueCents: 5000000, grossCents: 1855001, serviceFeeCents: 55651, netCents: 1799350,
        adjustments: [{ name: "奖金", amountCents: 10001 }, { name: "扣款", amountCents: -5000 }] })],
    });
    expect(queries.some((q) => q.table === "system_settlement_settings")).toBe(false);
  });
});

describe("保存周期重算", () => {
  beforeEach(() => {
    tables.salary_records = [{ id: "saved", status: "pending_review", profile_id: "p1", position_id: 9,
      scheme_id: "original", period_start: "2026-03-21", period_end: "2026-04-20",
      adjustments: [{ name: "奖金", amountCents: 10001 }, { name: "扣款", amountCents: -5000 }] },
    { id: "previous", profile_id: "p1", position_id: 9, period_end: "2026-03-20", is_qualified: false, team_id: "t2" }];
    tables.salary_schemes.push(scheme("saved-position", "p1", { position_id: 9 }));
    tables.anchor_revenue_records.push(
      revenue("no-perf", { no_perf: true, revenue_cents: 9000000 }),
      revenue("outside", { perf_date: "2026-04-21", revenue_cents: 9000000 }),
    );
  });

  it("使用保存岗位、周期和原调整项；跨团上期未达标影响第四月保底", async () => {
    await rejectAndRecompute("saved");
    expect(client.rpc).toHaveBeenCalledExactlyOnceWith("recompute_salary_record", expect.objectContaining({
      p_id: "saved", p_revenue_cents: 5000000, p_tenure_month: 4, p_base_guarantee_cents: 500000,
      p_gross_cents: 1605001, p_service_fee_cents: 48151, p_net_cents: 1556850,
      p_note: expect.stringContaining("saved-position（原方案关联 original 保持不变）"),
    }));
    const args = client.rpc.mock.calls[0][1];
    for (const key of ["p_team_id", "p_scheme_id", "p_period_start", "p_period_end", "p_adjustments"]) {
      expect(args).not.toHaveProperty(key);
    }
    expect(queried("salary_schemes", "in")).toContainEqual(["position_id", [9]]);
    expect(queried("anchor_revenue_records", "gte")).toContainEqual(["perf_date", "2026-03-21"]);
    expect(queried("anchor_revenue_records", "lte")).toContainEqual(["perf_date", "2026-04-20"]);
    expect(queries.some((q) => ["system_settlement_settings", "team_members", "user_positions", "positions"].includes(q.table))).toBe(false);
  });

  it.each([
    [{ status: "confirmed" }, "仅待审核"],
    [{ period_start: null }, "缺少周期"],
    [{ adjustments: {} }, "调整项格式错误"],
    [{ adjustments: [{ name: "奖金", amountCents: 0.5 }] }, "调整项格式错误"],
    [{ adjustments: [{ name: " ", amountCents: 100 }] }, "名称不能为空"],
  ])("无效保存数据不得写入：%j", async (change, message) => {
    Object.assign(tables.salary_records[0], change);
    await expect(rejectAndRecompute("saved")).rejects.toThrow(message);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it.each([null, {}, [{ name: "奖金", amountCents: Number.MAX_SAFE_INTEGER + 1 }],
    [{ name: 1, amountCents: 100 }]])("拒绝非数组或非法保存调整项 %j", (value) => {
    expect(() => parseSalaryAdjustments(value)).toThrow("调整项格式错误");
  });
});

describe("事务冲突有限重试", () => {
  it.each(["40001", "40P01"])("%s 回滚后等待 100/200ms，最多调用三次", async (code) => {
    vi.useFakeTimers();
    client.rpc.mockResolvedValueOnce({ data: null, error: { code, message: "conflict" } })
      .mockResolvedValueOnce({ data: null, error: { code, message: "conflict" } });
    const result = settleAnchorRevenue(input());
    const assertion = expect(result).resolves.toEqual({ settledRecords: 1 });
    await vi.advanceTimersByTimeAsync(0);
    expect(client.rpc).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(99);
    expect(client.rpc).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(client.rpc).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(199);
    expect(client.rpc).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    await assertion;
    expect(client.rpc).toHaveBeenCalledTimes(3);
    expect(client.rpc.mock.calls[0]).toEqual(client.rpc.mock.calls[2]);
  });

  it("持续事务冲突达到三次后停止", async () => {
    vi.useFakeTimers();
    client.rpc.mockResolvedValue({ data: null, error: { code: "40001", message: "conflict" } });
    const assertion = expect(settleAnchorRevenue(input())).rejects.toThrow("并发冲突");
    await vi.runAllTimersAsync();
    await assertion;
    expect(client.rpc).toHaveBeenCalledTimes(3);
  });

  it.each(["23P01", "42501", "23505"])("业务或权限错误 %s 不重试", async (code) => {
    client.rpc.mockResolvedValue({ data: null, error: { code, message: "SALARY_PERIOD_OVERLAP" } });
    await expect(settleAnchorRevenue(input())).rejects.toThrow("重叠周期");
    expect(client.rpc).toHaveBeenCalledTimes(1);
  });

  it("未知网络结果直接抛出，不盲目重复写入", async () => {
    const error = new Error("network response lost");
    client.rpc.mockRejectedValue(error);
    await expect(settleAnchorRevenue(input())).rejects.toBe(error);
    expect(client.rpc).toHaveBeenCalledTimes(1);
  });
});
