"use client";

import { useMemo } from "react";
import { QueryMessage } from "@/components/query-message";
import {
  useCurrentProfile,
  useMyAnchorRevenue,
  useSalaryRecords,
  useSchemes,
} from "@/lib/api/hooks";
import type { AnchorSalaryScheme } from "@/lib/domain/payroll/types";
import { calcTenureMonth } from "@/lib/domain/settlement/aggregate";
import { getPresetRange, localToday } from "@/lib/domain/settlement/cycle";
import { DailyAdjustments } from "./DailyAdjustments";
import { EarningsHero } from "./EarningsHero";
import { GoalProgress } from "./GoalProgress";
import { RecentTrend } from "./RecentTrend";
import {
  buildRecentDailySeries,
  estimateAnchorPayroll,
  summarizeAnchorRevenue,
} from "./estimate";

/**
 * 首页空态/引导卡片：改造前这里是白屏（bug 而非设计），
 * 故所有「拿不到数据」的分支都必须给可读引导。
 */
function InfoCard({ text }: { text: string }) {
  return (
    <p className="rounded-2xl bg-white px-4 py-6 text-center text-xs leading-relaxed text-muted shadow-sm shadow-slate-200/60">
      {text}
    </p>
  );
}

/**
 * 主播概览（保底/提成互斥模式）：只组合 ①~④，不写角色判定、不重写任何金额公式。
 *
 * 自取数据、自渲染；与主持概览（HostDashboard）互不依赖，两者不共享任何组件或查询。
 * 金额口径全部走 `estimate.ts` / `adjustments.ts`（前者复用结算同源公式）。
 */
export function AnchorDashboard() {
  const profile = useCurrentProfile();
  const profileId = profile.data?.id ?? null;
  const hireDate = profile.data?.hire_date ?? null;

  // 本期 = 自然月（与「当月流水」达标判定一致）。
  const monthRange = useMemo(() => getPresetRange("thisMonth"), []);
  const month = monthRange.start.slice(0, 7);
  const today = useMemo(() => localToday(), []);

  const revenueQuery = useMyAnchorRevenue(profileId, monthRange);
  const schemesQuery = useSchemes();
  const salaryQuery = useSalaryRecords();

  const revenueRows = useMemo(() => revenueQuery.data ?? [], [revenueQuery.data]);
  const summary = useMemo(() => summarizeAnchorRevenue(revenueRows), [revenueRows]);
  const recentPoints = useMemo(
    () => buildRecentDailySeries(revenueRows, today, 7),
    [revenueRows, today],
  );

  // 本人生效方案（RLS 已限制本人可读；仍按 profile_id 兜底，避免管理员视角串号）。
  const activeScheme = useMemo(() => {
    if (!profileId) return null;
    const own = (schemesQuery.data ?? []).filter(
      (item) => item.profile_id === profileId && item.status === "active",
    );
    return (
      [...own].sort(
        (a, b) => b.effective_from.localeCompare(a.effective_from) || b.version - a.version,
      )[0] ?? null
    );
  }, [schemesQuery.data, profileId]);

  const schemeInput = useMemo<AnchorSalaryScheme | null>(
    () =>
      activeScheme
        ? {
            baseSalaryInCents: activeScheme.base_salary_cents,
            guaranteedSalaryInCents: activeScheme.guaranteed_salary_cents,
            thresholdMultiplierBps: activeScheme.threshold_multiplier_bps,
            serviceFeeRateBps: activeScheme.service_fee_rate_bps,
            settlementMode: (activeScheme.settlement_mode ?? "guarantee") as
              | "guarantee"
              | "fixed_percent",
            fixedPercentBps: activeScheme.fixed_percent_bps,
          }
        : null,
    [activeScheme],
  );

  const tenureMonth = useMemo(
    () => (hireDate ? calcTenureMonth(hireDate, monthRange.end) : 1),
    [hireDate, monthRange.end],
  );

  const estimate = useMemo(() => {
    if (!schemeInput) return null;
    try {
      return estimateAnchorPayroll({
        scheme: schemeInput,
        monthlyRevenueInCents: summary.revenueInCents,
        tenureMonth,
      });
    } catch {
      // 方案/月序脏数据不应让整页崩掉，退化为「暂无法预估」。
      return null;
    }
  }, [schemeInput, summary.revenueInCents, tenureMonth]);

  const salaryRecords = useMemo(() => salaryQuery.data ?? [], [salaryQuery.data]);
  // 最近一张本人工资条，仅用于 ① 收益卡的环比基准（上月已发到手）。
  const latestSalary = salaryRecords[0] ?? null;

  const loading =
    profile.isLoading ||
    revenueQuery.isLoading ||
    schemesQuery.isLoading ||
    salaryQuery.isLoading;
  const error = profile.error || revenueQuery.error || schemesQuery.error || salaryQuery.error;
  const hasRecentActivity = recentPoints.some(
    (point) => point.revenueInCents > 0 || point.broadcastMinutes > 0,
  );

  return (
    <div className="space-y-4">
      <QueryMessage loading={loading} error={error} />

      {!loading && !error && !schemeInput ? (
        <InfoCard text="尚未配置工资方案。配置后这里会显示本期预估到手、目标进度与近 7 天流水。" />
      ) : null}

      {estimate ? (
        <EarningsHero
          month={month}
          estimate={estimate}
          revenueInCents={summary.revenueInCents}
          broadcastMinutes={summary.broadcastMinutes}
          activeDays={summary.activeDays}
          previousNetInCents={latestSalary?.net_cents ?? null}
        />
      ) : null}

      {estimate ? <GoalProgress estimate={estimate} /> : null}

      {!loading && !error && schemeInput && !latestSalary ? (
        <InfoCard text="还没有已发布的工资条，暂无上月环比基准。" />
      ) : null}

      {hasRecentActivity ? <RecentTrend points={recentPoints} /> : null}

      <DailyAdjustments range={monthRange} />
    </div>
  );
}
