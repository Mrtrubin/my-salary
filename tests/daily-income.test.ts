import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DailyIncomePayload } from "@/lib/api/data";
import { fetchDailyIncome } from "@/app/(user)/user/performance/upload/dailyIncome";

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
    expect(result.liveDuration).toBe(120);
    expect(result.anchors).toEqual([
      { douyinId: "dy-1", nickname: "甲", income: 130 },
      { douyinId: "dy-2", nickname: "乙", income: 250 },
      { douyinId: "dy-3", nickname: "丙", income: 0 },
    ]);
  });

  it("没有抖音号时按昵称聚合，空数据返回空列表", async () => {
    dataApi.fetchDailyIncomePayload.mockResolvedValue(
      payload({ hasLive: false, rooms: [{ roomId: "r1", series: [{ nickname: "无号", income: 5 }] }] }),
    );

    const result = await fetchDailyIncome("T-001", "2026-04-10");

    expect(result.hasLive).toBe(false);
    expect(result.anchors).toEqual([{ douyinId: "", nickname: "无号", income: 5 }]);
  });

  it("rooms 缺失时按空列表处理", async () => {
    dataApi.fetchDailyIncomePayload.mockResolvedValue(payload({ rooms: undefined }));

    await expect(fetchDailyIncome("T-001", "2026-04-10")).resolves.toMatchObject({ anchors: [] });
  });
});
