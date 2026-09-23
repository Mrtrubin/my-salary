/**
 * 主播流水接口（daily-income）调用与聚合。
 *
 * 数据源为外部服务（参考 github.com/linbeinb66/jiulu 的 /api/daily-income）：
 *   GET {base}/api/daily-income?anchor_id={团队 team_key}
 * 返回体结构：
 *   { success, data: { anchor_id, date, hasLive, liveDuration,
 *       totalIncome, ..., rooms: [{ roomId, liveDuration,
 *         series: [{ aweme_display_id, nickname, avatar, income, ... }] }] } }
 *
 * 识别主播：以 series[].aweme_display_id（抖音号）匹配成员的 douyin_id；
 * 同一主播在多个 room 的 income 直接累加。
 */

/** 接口基址，可用环境变量覆盖，默认指向已部署的服务。 */
const DAILY_INCOME_BASE =
  process.env.NEXT_PUBLIC_DAILY_INCOME_BASE?.replace(/\/$/, "") || "http://47.121.31.8:3000";

/** 接口返回的单条主播明细。 */
type IncomeSeries = {
  aweme_display_id?: string;
  nickname?: string;
  avatar?: string;
  income?: number | string;
  star_guard_income?: number | string;
  other_income?: number | string;
  increase_fans?: number | string;
};

type DailyIncomeResponse = {
  success: boolean;
  message?: string;
  data?: {
    anchor_id: string;
    date: string;
    hasLive: boolean;
    liveDuration?: number;
    totalIncome?: number;
    rooms?: { roomId: string; liveDuration?: number; series?: IncomeSeries[] }[];
  };
};

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
  /** 按抖音号聚合的主播流水列表。 */
  anchors: AggregatedIncome[];
};

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * 拉取并聚合某团队（anchorId = 团队 team_key）当日的主播流水。
 * @throws 请求失败或接口返回 success=false 时抛出错误。
 */
export async function fetchDailyIncome(anchorId: string): Promise<DailyIncomeResult> {
  const url = `${DAILY_INCOME_BASE}/api/daily-income?anchor_id=${encodeURIComponent(anchorId)}`;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`接口请求失败（HTTP ${res.status}）`);
  const body = (await res.json()) as DailyIncomeResponse;
  if (!body.success || !body.data) {
    throw new Error(body.message || "接口返回失败");
  }

  const data = body.data;
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