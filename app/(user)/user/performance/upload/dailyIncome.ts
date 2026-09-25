/**
 * 主播流水（按日期）：取数与聚合。
 *
 * 取数改由 Edge Function `daily-income` 代取（适配层：lib/api/data.ts 的
 * fetchDailyIncomePayload）——外部服务是 http 明文且无 CORS 头，https 页面直连会被浏览器
 * 以混合内容拦掉，上游地址也不该下发到客户端。
 *
 * 本模块只负责聚合：
 *   识别主播：以 series[].aweme_display_id（抖音号）或 series[].user_id（数字 uid）
 *   匹配成员的 douyin_id —— 管理员填哪一个都能认出来；
 *   同一主播在多个 room 的 income 直接累加。
 */

import { ApiError, ApiErrorCode } from "@/lib/api/contracts/errors";
import { fetchDailyIncomePayload } from "@/lib/api/data";

/** 按抖音号聚合后的主播流水。 */
export type AggregatedIncome = {
  /** 抖音号（aweme_display_id）；接口未返回时为空串。 */
  douyinId: string;
  /** 抖音数字 uid（user_id）；接口未返回时为空串。 */
  userId: string;
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
  // 同一主播可能在不同房间分别只带 aweme_display_id 或只带 user_id，
  // 因此两个标识都要能命中同一个聚合项，否则同一笔流水会被拆成两条。
  const byIdentifier = new Map<string, AggregatedIncome>();
  const byNickname = new Map<string, AggregatedIncome>();
  const anchors: AggregatedIncome[] = [];

  const ensure = (douyinId: string, userId: string, nickname: string, fallbackKey: string) => {
    const existing =
      (douyinId ? byIdentifier.get(douyinId) : undefined) ??
      (userId ? byIdentifier.get(userId) : undefined) ??
      (fallbackKey ? byNickname.get(fallbackKey) : undefined);
    if (existing) return existing;
    const created: AggregatedIncome = { douyinId, userId, nickname, income: 0 };
    anchors.push(created);
    if (fallbackKey) byNickname.set(fallbackKey, created);
    return created;
  };

  for (const room of data.rooms ?? []) {
    for (const item of room.series ?? []) {
      const douyinId = item.aweme_display_id || "";
      const userId = item.user_id || "";
      const nickname = item.nickname || "";
      // 两个标识都没有时只能按昵称兜底合并。
      const fallbackKey = douyinId || userId ? "" : nickname || "_unknown";
      const cur = ensure(douyinId, userId, nickname, fallbackKey);
      cur.income += num(item.income);
      if (!cur.nickname && nickname) cur.nickname = nickname;
      if (!cur.douyinId && douyinId) cur.douyinId = douyinId;
      if (!cur.userId && userId) cur.userId = userId;
      if (douyinId) byIdentifier.set(douyinId, cur);
      if (userId) byIdentifier.set(userId, cur);
    }
  }

  return {
    date: returned || target,
    hasLive: !!data.hasLive,
    liveDuration: num(data.liveDuration),
    anchors,
  };
}

/** 参与匹配的成员：只要有 douyin_id 就能被认出来。 */
export type MatchableMember = { douyinId: string };

export type IncomeMatch<T extends MatchableMember> = {
  matched: { member: T; anchor: AggregatedIncome }[];
  /** 接口返回了、但团队里没有对应抖音号的主播。 */
  unmatched: AggregatedIncome[];
};

/**
 * 按抖音号把接口流水对应到团队成员。
 *
 * 接口的 `aweme_display_id`（抖音号）和 `user_id`（数字 uid）都算「抖音号」，
 * 成员资料里填哪一个都能匹配上；一个接口主播只会被一个成员认领（先到先得，
 * 避免两个成员填了同一个号时把同一笔流水填两次）。
 */
export function matchIncomeToMembers<T extends MatchableMember>(
  anchors: AggregatedIncome[],
  members: T[],
): IncomeMatch<T> {
  const index = new Map<string, AggregatedIncome>();
  for (const anchor of anchors) {
    if (anchor.douyinId) index.set(anchor.douyinId, anchor);
    if (anchor.userId) index.set(anchor.userId, anchor);
  }

  const matched: { member: T; anchor: AggregatedIncome }[] = [];
  const used = new Set<AggregatedIncome>();
  for (const member of members) {
    const key = (member.douyinId ?? "").trim();
    if (!key) continue;
    const anchor = index.get(key);
    if (!anchor || used.has(anchor)) continue;
    used.add(anchor);
    matched.push({ member, anchor });
  }

  return { matched, unmatched: anchors.filter((anchor) => !used.has(anchor)) };
}
