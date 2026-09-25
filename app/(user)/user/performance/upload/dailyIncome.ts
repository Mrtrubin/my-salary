/**
 * 主播当日流水：取数与聚合。
 *
 * 取数改由 Edge Function `daily-income` 代取（适配层：lib/api/data.ts 的
 * fetchDailyIncomePayload）——外部服务是 http 明文且无 CORS 头，https 页面直连会被浏览器
 * 以混合内容拦掉，上游地址也不该下发到客户端。
 *
 * 本模块只负责聚合：
 *   识别主播：以 series[].aweme_display_id（抖音号）匹配成员的 douyin_id；
 *   同一主播在多个 room 的 income 直接累加。
 */

import { fetchDailyIncomePayload } from "@/lib/api/data";

/** 按抖音号聚合后的主播流水。 */
export type AggregatedIncome = {
  /** 抖音号（aweme_display_id）。 */
  douyinId: string;
  nickname: string;
  /** 各 room 累加后的总流水（元）。 */
  income: number;
};

export type DailyIncomeResult = {
  date: string;
  hasLive: boolean;
  /** 直播总时长（分钟）。 */
  liveDuration: number;
  /** 按抖音号聚合后的主播流水列表。 */
  anchors: AggregatedIncome[];
};

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * 拉取并聚合某团队（anchorId = 团队 team_key）当日的主播流水。
 * @throws 未登录/无权访问/上游失败时抛出 ApiError（message 可直接展示）。
 */
export async function fetchDailyIncome(anchorId: string): Promise<DailyIncomeResult> {
  const data = await fetchDailyIncomePayload(anchorId);

  // 按抖音号聚合，同一主播多个 room 的 income 累加。
  const map = new Map<string, AggregatedIncome>();
  for (const room of data.rooms ?? []) {
    for (const item of room.series ?? []) {
      const key = item.aweme_display_id || item.nickname || "_unknown";
      const cur = map.get(key) ?? {
        douyinId: item.aweme_display_id || "",
        nickname: item.nickname || "",
        income: 0,
      };
      cur.income += num(item.income);
      if (!cur.nickname && item.nickname) cur.nickname = item.nickname;
      map.set(key, cur);
    }
  }

  return {
    date: data.date,
    hasLive: !!data.hasLive,
    liveDuration: num(data.liveDuration),
    anchors: Array.from(map.values()),
  };
}
