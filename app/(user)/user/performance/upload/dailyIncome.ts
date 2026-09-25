/**
 * 主播流水（按日期）：取数与聚合。
 *
 * 取数改由 Edge Function `daily-income` 代取（适配层：lib/api/data.ts 的
 * fetchDailyIncomePayload）——外部服务是 http 明文且无 CORS 头，https 页面直连会被浏览器
 * 以混合内容拦掉，上游地址也不该下发到客户端。
 *
 * 本模块只负责聚合：
 *   识别主播：以 series[].aweme_display_id（抖音号）匹配成员的 douyin_id；
 *   同一主播在多个 room 的 income 直接累加。
 */

import { ApiError, ApiErrorCode } from "@/lib/api/contracts/errors";
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
  /** 本次请求的日期（接口返回日期与请求日期一致时两者相同）。 */
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

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 归一化接口返回的日期：容忍 2026/09/25、2026.09.25 等写法；无法识别时返回空串。 */
function normalizeDate(value: unknown): string {
  if (typeof value !== "string") return "";
  const matched = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(value.trim());
  if (!matched) return "";
  return `${matched[1]}-${matched[2].padStart(2, "0")}-${matched[3].padStart(2, "0")}`;
}

/**
 * 拉取并聚合某团队（anchorId = 团队 team_key）指定日期的主播流水。
 *
 * @param date 目标日期 `YYYY-MM-DD`，由日期表单决定。
 * @throws ApiError 日期非法、未登录/无权访问、上游失败，或上游返回的日期与请求日期不一致
 *         （说明接口没有按日期取数）时抛出，message 可直接展示。
 */
export async function fetchDailyIncome(anchorId: string, date: string): Promise<DailyIncomeResult> {
  const target = (date ?? "").trim();
  if (!DATE_RE.test(target)) {
    throw new ApiError(ApiErrorCode.INVALID_INPUT, "请先选择要拉取的日期");
  }
  const data = await fetchDailyIncomePayload(anchorId, target);

  // 上游若忽略日期参数，会把别的日期（历史上恒为当天）的数据当成结果返回；
  // 流水直接换算成钱，宁可报错也不能把错误日期的数据填进业绩。
  const returned = normalizeDate(data.date);
  if (returned && returned !== target) {
    throw new ApiError(
      ApiErrorCode.UNKNOWN,
      `接口返回的是 ${returned} 的流水，与所选日期 ${target} 不一致，已停止填充；请核对日期后重试`,
    );
  }

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
    date: returned || target,
    hasLive: !!data.hasLive,
    liveDuration: num(data.liveDuration),
    anchors: Array.from(map.values()),
  };
}
