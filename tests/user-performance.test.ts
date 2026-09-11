import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TeamPerformanceRow } from "@/lib/api/data";
import UserPerformancePage from "@/app/(user)/user/performance/page";

const hooks = vi.hoisted(() => ({
  useTeamPerformance: vi.fn(), useCurrentProfile: vi.fn(), useTeams: vi.fn(), push: vi.fn(),
}));
vi.mock("@/lib/api/hooks", () => hooks);
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: hooks.push }) }));
vi.mock("@/components/query-message", () => ({ QueryMessage: () => null }));
vi.mock("@/components/ui/button", () => ({
  Button: ({ children }: { children: ReactNode }) => createElement("button", null, children),
}));
vi.mock("@/components/ui/card", () => ({
  Card: ({ children }: { children: ReactNode }) => createElement("article", null, children),
}));

const row = (id: string, extra: Partial<TeamPerformanceRow> = {}): TeamPerformanceRow => ({
  id, team_id: "t1", profile_id: "p1", point_id: "point1", perf_date: "2026-04-10",
  broadcast_minutes: 60, points_amount: 111, revenue_cents: 10000,
  no_perf: false, no_perf_note: null, created_at: "2026-04-10T12:00:00Z",
  team: { name: "甲团" }, point: { name: "音浪" }, profile: { name: "主播甲" }, ...extra,
});

// 渲染真实页面及绩效卡片，只隔离数据、路由和基础 UI；不代替浏览器交互验收。
function renderCards(rows: TeamPerformanceRow[]) {
  hooks.useTeamPerformance.mockReturnValue({ data: rows, isLoading: false, error: null });
  const html = renderToStaticMarkup(createElement(UserPerformancePage));
  return Array.from(html.matchAll(/<article>([\s\S]*?)<\/article>/g), (match) => match[1]);
}

beforeEach(() => {
  vi.clearAllMocks();
  hooks.useCurrentProfile.mockReturnValue({ data: { id: "p1" } });
  hooks.useTeams.mockReturnValue({ data: [] });
});

describe("用户绩效页跨团队卡片回归", () => {
  it("同一主播同日的两个团队分别展示个人业绩与团队总量", () => {
    const cards = renderCards([
      row("a"),
      row("b", { team_id: "t2", team: { name: "乙团" }, points_amount: 222 }),
    ]);
    expect(cards).toHaveLength(2);
    expect(cards[0]).toContain("甲团");
    expect(cards[1]).toContain("乙团");
    for (const card of cards) expect(card).toContain("主播甲");
    expect(cards[0].match(/>111</g)).toHaveLength(2);
    expect(cards[1].match(/>222</g)).toHaveLength(2);
    expect(cards[0]).not.toContain(">222<");
    expect(cards[1]).not.toContain(">111<");
  });

  it("同团同人同日只保留查询返回的最新记录，不误删同日跨团记录", () => {
    const cards = renderCards([
      row("new"),
      row("other-team", { team_id: "t2", team: { name: "乙团" }, points_amount: 222 }),
      row("old", { points_amount: 999, created_at: "2026-04-10T11:00:00Z" }),
    ]);
    expect(cards).toHaveLength(2);
    expect(cards[0].match(/主播甲/g)).toHaveLength(1);
    expect(cards[0]).not.toContain("999");
    expect(cards[1]).toContain(">222<");
  });

  it("团队内保留不同成员，时长取最大值而非累加，跨日卡片倒序", () => {
    const cards = renderCards([
      row("older", { perf_date: "2026-04-09" }),
      row("a"),
      row("b", {
        profile_id: "p2", profile: { name: "主播乙" },
        broadcast_minutes: 120, points_amount: 222,
      }),
    ]);
    expect(cards).toHaveLength(2);
    expect(cards[0]).toContain("4月10日");
    expect(cards[1]).toContain("4月9日");
    expect(cards[0]).toContain("主播甲");
    expect(cards[0]).toContain("主播乙");
    expect(cards[0]).toContain(">333<");
    expect(cards[0]).toContain('class="tabular-nums">2</span>');
    expect(cards[1]).toContain('class="tabular-nums">1</span>');
  });

  it("空查询结果不渲染绩效卡片", () => {
    expect(renderCards([])).toEqual([]);
    hooks.useTeamPerformance.mockReturnValue({ data: undefined, isLoading: true, error: null });
    expect(renderToStaticMarkup(createElement(UserPerformancePage))).not.toContain("<article>");
  });
});