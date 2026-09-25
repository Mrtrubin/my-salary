import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DailyIncomePayload } from "@/lib/api/data";
import { fetchDailyIncome, matchIncomeToMembers, type AggregatedIncome } from "@/app/(user)/user/performance/upload/dailyIncome";

const dataApi = vi.hoisted(() => ({ fetchDailyIncomePayload: vi.fn() }));
vi.mock("@/lib/api/data", () => dataApi);

const payload = (extra: Partial<DailyIncomePayload> = {}): DailyIncomePayload => ({
  anchor_id: "T-001",
  date: "2026-04-10",
  hasLive: true,
  liveDuration: 120,
  rooms: [],
  ...extra,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("接口流水：按日期表单的日期取数", () => {
  it("把表单日期原样透传给取数层", async () => {
    dataApi.fetchDailyIncomePayload.mockResolvedValue(payload());

    const result = await fetchDailyIncome("T-001", "2026-04-10");

    expect(dataApi.fetchDailyIncomePayload).toHaveBeenCalledWith("T-001", "2026-04-10");
    expect(result.date).toBe("2026-04-10");
  });

  it("日期非法时直接报错，不打接口", async () => {
    await expect(fetchDailyIncome("T-001", "")).rejects.toThrow("请先选择要拉取的日期");
    await expect(fetchDailyIncome("T-001", "2026/04/10")).rejects.toThrow("请先选择要拉取的日期");
    expect(dataApi.fetchDailyIncomePayload).not.toHaveBeenCalled();
  });

  it("接口返回的日期与所选日期不一致时抛错，避免填错日期的流水", async () => {
    dataApi.fetchDailyIncomePayload.mockResolvedValue(payload({ date: "2026-04-11" }));

    await expect(fetchDailyIncome("T-001", "2026-04-10")).rejects.toThrow(
      "接口返回的是 2026-04-11 的流水，与所选日期 2026-04-10 不一致，已停止填充；请核对日期后重试",
    );
  });

  it("接口日期写法不同但同一天时不算不一致（2026/04/10）", async () => {
    dataApi.fetchDailyIncomePayload.mockResolvedValue(payload({ date: "2026/04/10" }));

    await expect(fetchDailyIncome("T-001", "2026-04-10")).resolves.toMatchObject({ date: "2026-04-10" });
  });

  it("接口没给日期时不误判，回落到请求日期", async () => {
    dataApi.fetchDailyIncomePayload.mockResolvedValue(payload({ date: "" }));

    await expect(fetchDailyIncome("T-001", "2026-04-10")).resolves.toMatchObject({ date: "2026-04-10" });
  });
});

describe("接口流水：按抖音号聚合", () => {
  it("同一主播多房间流水累加，非法数值按 0", async () => {
    dataApi.fetchDailyIncomePayload.mockResolvedValue(
      payload({
        liveDuration: "120" as unknown as number,
        rooms: [
          {
            roomId: "r1",
            series: [
              { aweme_display_id: "dy-1", nickname: "甲", income: "100" },
              { aweme_display_id: "dy-2", nickname: "乙", income: 250 },
            ],
          },
          {
            roomId: "r2",
            series: [
              { aweme_display_id: "dy-1", nickname: "甲", income: 30 },
              { aweme_display_id: "dy-3", nickname: "丙", income: "not-a-number" },
            ],
          },
        ],
      }),
    );

    const result = await fetchDailyIncome("T-001", "2026-04-10");

    expect(result.hasLive).toBe(true);
    expect(result.liveDurationSeconds).toBe(120);
    expect(result.anchors).toEqual([
      { douyinId: "dy-1", userId: "", nickname: "甲", income: 130 },
      { douyinId: "dy-2", userId: "", nickname: "乙", income: 250 },
      { douyinId: "dy-3", userId: "", nickname: "丙", income: 0 },
    ]);
  });

  it("没有抖音号时按昵称聚合，空数据返回空列表", async () => {
    dataApi.fetchDailyIncomePayload.mockResolvedValue(
      payload({ hasLive: false, rooms: [{ roomId: "r1", series: [{ nickname: "无号", income: 5 }] }] }),
    );

    const result = await fetchDailyIncome("T-001", "2026-04-10");

    expect(result.hasLive).toBe(false);
    expect(result.anchors).toEqual([{ douyinId: "", userId: "", nickname: "无号", income: 5 }]);
  });

  it("rooms 缺失时按空列表处理", async () => {
    dataApi.fetchDailyIncomePayload.mockResolvedValue(payload({ rooms: undefined }));

    await expect(fetchDailyIncome("T-001", "2026-04-10")).resolves.toMatchObject({ anchors: [] });
  });

  it("同时带回 user_id 时两个标识都保留，只有 user_id 也能聚合同一主播", async () => {
    dataApi.fetchDailyIncomePayload.mockResolvedValue(
      payload({
        rooms: [
          {
            roomId: "r1",
            series: [
              { aweme_display_id: "qkl1122334", user_id: "2686827281788563", nickname: "奶茶", income: 100 },
            ],
          },
          {
            roomId: "r2",
            series: [{ user_id: "2686827281788563", nickname: "奶茶", income: 50 }],
          },
        ],
      }),
    );

    const result = await fetchDailyIncome("T-001", "2026-04-10");

    expect(result.anchors).toEqual([
      { douyinId: "qkl1122334", userId: "2686827281788563", nickname: "奶茶", income: 150 },
    ]);
  });
});

describe("当日信息：当日总直播时长（所有直播间）", () => {
  it("取顶层 liveDuration，不把重复下发到每个房间的值累加", async () => {
    dataApi.fetchDailyIncomePayload.mockResolvedValue(
      payload({
        liveDuration: 23786,
        rooms: [
          { roomId: "r1", liveDuration: "23786", series: [] },
          { roomId: "r2", liveDuration: "23786", series: [] },
          { roomId: "r3", liveDuration: "23786", series: [] },
          { roomId: "r4", liveDuration: "23786", series: [] },
        ],
      }),
    );

    const result = await fetchDailyIncome("T-001", "2026-04-10");

    // 累加会得到 95144（翻 4 倍），这是必须防住的错。
    expect(result.liveDurationSeconds).toBe(23786);
  });

  it("顶层缺失时取房间最大值兜底，仍不累加", async () => {
    dataApi.fetchDailyIncomePayload.mockResolvedValue(
      payload({
        liveDuration: undefined,
        rooms: [
          { roomId: "r1", liveDuration: "23972", series: [] },
          { roomId: "r2", liveDuration: "23972", series: [] },
        ],
      }),
    );

    await expect(fetchDailyIncome("T-001", "2026-04-10")).resolves.toMatchObject({
      liveDurationSeconds: 23972,
    });
  });

  it("没有任何时长字段时为 0", async () => {
    dataApi.fetchDailyIncomePayload.mockResolvedValue(payload({ liveDuration: undefined, rooms: [] }));

    await expect(fetchDailyIncome("T-001", "2026-04-10")).resolves.toMatchObject({
      liveDurationSeconds: 0,
    });
  });
});

describe("接口流水：按抖音号自动识别主播", () => {
  const anchor = (extra: Partial<AggregatedIncome> = {}): AggregatedIncome => ({
    douyinId: "",
    userId: "",
    nickname: "未知",
    income: 0,
    ...extra,
  });

  it("成员填抖音号（aweme_display_id）时可识别", () => {
    const result = matchIncomeToMembers(
      [anchor({ douyinId: "qkl1122334", userId: "2686827281788563", nickname: "奶茶", income: 20234 })],
      [{ profileId: "p1", name: "甲", douyinId: "qkl1122334" }],
    );

    expect(result.matched).toEqual([
      {
        member: { profileId: "p1", name: "甲", douyinId: "qkl1122334" },
        anchor: expect.objectContaining({ nickname: "奶茶", income: 20234 }),
      },
    ]);
    expect(result.unmatched).toEqual([]);
  });

  it("成员填数字 uid（user_id）时同样可识别", () => {
    const result = matchIncomeToMembers(
      [anchor({ douyinId: "qkl1122334", userId: "2686827281788563", nickname: "奶茶", income: 20234 })],
      [{ profileId: "p1", name: "甲", douyinId: "2686827281788563" }],
    );

    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].member.profileId).toBe("p1");
    expect(result.unmatched).toEqual([]);
  });

  it("成员抖音号两端有空格时仍能识别", () => {
    const result = matchIncomeToMembers(
      [anchor({ userId: "2686827281788563", income: 1 })],
      [{ profileId: "p1", name: "甲", douyinId: " 2686827281788563 " }],
    );

    expect(result.matched).toHaveLength(1);
  });

  it("没填抖音号的成员不参与识别，接口多出来的主播进未匹配", () => {
    const result = matchIncomeToMembers(
      [
        anchor({ userId: "111", nickname: "有主", income: 10 }),
        anchor({ userId: "222", nickname: "无主", income: 20 }),
      ],
      [
        { profileId: "p1", name: "甲", douyinId: "111" },
        { profileId: "p2", name: "乙", douyinId: "" },
      ],
    );

    expect(result.matched.map((row) => row.member.profileId)).toEqual(["p1"]);
    expect(result.unmatched.map((row) => row.nickname)).toEqual(["无主"]);
  });

  it("两个成员填了同一个号时只认领一次，避免同一笔流水填两次", () => {
    const result = matchIncomeToMembers(
      [anchor({ userId: "111", income: 10 })],
      [
        { profileId: "p1", name: "甲", douyinId: "111" },
        { profileId: "p2", name: "乙", douyinId: "111" },
      ],
    );

    expect(result.matched.map((row) => row.member.profileId)).toEqual(["p1"]);
    expect(result.unmatched).toEqual([]);
  });
});
