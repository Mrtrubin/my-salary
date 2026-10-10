"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
} from "recharts";
import { SalaryRecordStatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { QueryMessage } from "@/components/query-message";
import {
  useHostSalaryRecords,
  useMyHostMonthlyOverviews,
  useTeams,
  useTransitionHostSalaryStatus,
} from "@/lib/api/hooks";
import type { HostSalaryRecord, Member, MyHostCycleDaily, MyHostMonthlyOverview } from "@/lib/api/data";
import { getPresetRange } from "@/lib/domain/settlement/cycle";
import { formatCentsToYuan, formatDurationSeconds, formatMonth } from "@/lib/format";

interface HostAdjustment {
  name: string;
  amountCents: number;
}

function readAdjustments(value: HostSalaryRecord["adjustments"]): HostAdjustment[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    if (typeof entry.name !== "string" || typeof entry.amountCents !== "number" || !Number.isSafeInteger(entry.amountCents)) {
      return [];
    }
    return [{ name: entry.name, amountCents: entry.amountCents }];
  });
}

function signedAmount(cents: number): string {
  return `${cents > 0 ? "+" : ""}${formatCentsToYuan(cents)}`;
}

export function HostDashboard({ profile }: { profile: Member }) {
  const currentMonth = useMemo(() => getPresetRange("thisMonth").start.slice(0, 7), []);
  const recordsQuery = useHostSalaryRecords();
  const teamsQuery = useTeams();
  const monthlyQuery = useMyHostMonthlyOverviews(profile.id);
  const transition = useTransitionHostSalaryStatus();

  const records = useMemo(
    () =>
      (recordsQuery.data ?? [])
        .filter((record) => record.host_profile_id === profile.id)
        .sort((a, b) => b.period_end.localeCompare(a.period_end)),
    [recordsQuery.data, profile.id],
  );
  const latest = records[0];
  const previous = records[1];

  const monthly = useMemo(() => monthlyQuery.data ?? [], [monthlyQuery.data]);
  const myTeams = useMemo(
    () => (teamsQuery.data ?? []).filter((team) => team.host?.id === profile.id),
    [teamsQuery.data, profile.id],
  );

  const year = Number(currentMonth.slice(0, 4));
  const ytdNetCents = records
    .filter((record) => record.period_start.startsWith(String(year)))
    .reduce((sum, record) => sum + record.net_cents, 0);

  const momDiff = latest && previous ? latest.net_cents - previous.net_cents : null;
  const momPct =
    latest && previous && previous.net_cents !== 0
      ? ((latest.net_cents - previous.net_cents) / Math.abs(previous.net_cents)) * 100
      : null;

  const loading = recordsQuery.isLoading || monthlyQuery.isLoading;
  const error = recordsQuery.error || monthlyQuery.error;
  const hasAnyData = records.length > 0 || monthly.length > 0 || myTeams.length > 0;

  return (
    <div className="space-y-4">
      <QueryMessage loading={loading} error={error} empty={!hasAnyData} />

      {latest ? (
        <div className="rounded-2xl bg-gradient-to-br from-indigo-500 to-indigo-600 px-5 py-6 text-white shadow-lg shadow-indigo-500/20">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-white/70">{formatMonth(latest.month.slice(0, 7))} 到手收益</span>
            <SalaryRecordStatusBadge status={latest.status} />
          </div>
          <p className="mt-2 text-3xl font-semibold tabular-nums tracking-tight">
            {formatCentsToYuan(latest.net_cents)}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-white/80">
            {momDiff !== null ? (
              <span className="tabular-nums">
                环比 {momDiff >= 0 ? "↑" : "↓"} {formatCentsToYuan(Math.abs(momDiff))}
                {momPct !== null ? `（${momPct >= 0 ? "+" : ""}${momPct.toFixed(1)}%）` : ""}
              </span>
            ) : null}
            <span className="tabular-nums">{year} 年累计 {formatCentsToYuan(ytdNetCents)}</span>
          </div>
          {latest.status === "pending_confirm" ? (
            <Button
              className="mt-4 w-full"
              variant="secondary"
              disabled={transition.isPending}
              onClick={() => transition.mutate({ id: latest.id, status: "confirmed", note: "成员确认收款" })}
            >
              {transition.isPending ? "确认中…" : "待你确认收款"}
            </Button>
          ) : null}
        </div>
      ) : null}

      <section className="space-y-3">
        <h2 className="px-1 text-sm font-semibold">月度流水</h2>
        {monthly.length ? (
          monthly.map((item, index) => (
            <HostMonthCard
              key={item.month}
              item={item}
              previous={monthly[index + 1] ?? null}
              defaultExpanded={index === 0}
            />
          ))
        ) : (
          <p className="px-1 text-xs text-muted">暂无流水记录。</p>
        )}
      </section>

      {latest && readAdjustments(latest.adjustments).length > 0 ? (
        <section className="rounded-2xl bg-white px-4 py-4 shadow-sm shadow-slate-200/60">
          <h2 className="mb-3 text-sm font-semibold">最近工资条调整项</h2>
          <ul className="space-y-2 text-sm">
            {readAdjustments(latest.adjustments).map((adjustment, index) => (
              <li key={`${adjustment.name}-${index}`} className="flex items-start justify-between gap-3">
                <span className="text-xs text-muted">{adjustment.name || "未命名调整"}</span>
                <span className={`tabular-nums ${adjustment.amountCents < 0 ? "text-danger" : "text-emerald-600"}`}>
                  {signedAmount(adjustment.amountCents)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

/** 单月流水折叠卡片：展开/折叠与对比上月均由 header 上的图标按钮控制。 */
function HostMonthCard({
  item,
  previous,
  defaultExpanded = false,
}: {
  item: MyHostMonthlyOverview;
  previous: MyHostMonthlyOverview | null;
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [compare, setCompare] = useState(false);
  const teamCount = item.teamBreakdown.length;

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold">{formatMonth(item.month)}</p>
          <p className="mt-0.5 text-xs text-muted">
            团总流水 {formatCentsToYuan(item.revenueCents)}
            {compare ? <GrowthBadge current={item.revenueCents} previous={previous?.revenueCents ?? null} /> : null}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <IconButton label="对比上月" active={compare} onClick={() => setCompare((value) => !value)}>
            <IconCompare />
          </IconButton>
          <IconButton
            label={expanded ? "收起" : "展开"}
            active={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            <IconChevron up={expanded} />
          </IconButton>
        </div>
      </div>

      {expanded ? (
        <div className="border-t border-slate-100 px-4 py-4">
          <div className="grid grid-cols-3 gap-2 text-center">
            <Stat
              label="团总流水"
              value={formatCentsToYuan(item.revenueCents)}
              growth={compare ? <GrowthBadge current={item.revenueCents} previous={previous?.revenueCents ?? null} /> : null}
            />
            <Stat
              label="直播时长"
              value={item.broadcastMinutes > 0 ? formatDurationSeconds(item.broadcastMinutes * 60) : "—"}
              growth={
                compare ? <GrowthBadge current={item.broadcastMinutes} previous={previous?.broadcastMinutes ?? null} /> : null
              }
            />
            <Stat
              label="团队数"
              value={String(teamCount)}
              growth={
                compare
                  ? <GrowthBadge current={teamCount} previous={previous ? previous.teamBreakdown.length : null} />
                  : null
              }
            />
          </div>

          {item.daily.length > 0 ? (
            <div className="mt-4">
              <p className="mb-1 text-xs text-muted">每日流水</p>
              <div className="h-32 w-full">
                <HostCycleTrend daily={item.daily} />
              </div>
            </div>
          ) : null}

          {teamCount > 0 ? (
            <ul className="mt-4 space-y-2 text-sm">
              {item.teamBreakdown.map((team) => (
                <li key={team.teamId} className="flex items-start justify-between gap-3">
                  <span className="text-xs text-muted">{team.teamName ?? "未知团队"}</span>
                  <span className="text-right tabular-nums">
                    {formatCentsToYuan(team.revenueCents)}
                    {team.broadcastMinutes > 0
                      ? <span className="text-muted"> · {formatDurationSeconds(team.broadcastMinutes * 60)}</span>
                      : null}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 text-xs text-muted">该月暂无团队流水。</p>
          )}
        </div>
      ) : null}
    </Card>
  );
}

/** 增长率：与上个月对比；无上月（最早卡片）或上月为 0 时不展示。 */
function GrowthBadge({ current, previous }: { current: number; previous: number | null }) {
  if (previous === null || previous === 0) return null;
  const rate = ((current - previous) / Math.abs(previous)) * 100;
  const positive = rate >= 0;
  return (
    <span className={`ml-1 text-[11px] tabular-nums ${positive ? "text-emerald-600" : "text-danger"}`}>
      {positive ? "↑" : "↓"}
      {Math.abs(rate).toFixed(1)}%
    </span>
  );
}

function IconButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      onClick={onClick}
      className={`flex h-8 w-8 items-center justify-center rounded-full border transition-colors ${
        active
          ? "border-indigo-500 bg-indigo-50 text-indigo-600"
          : "border-slate-200 text-slate-500 hover:bg-slate-50"
      }`}
    >
      {children}
    </button>
  );
}

function IconBase({ children }: { children: ReactNode }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

function IconCompare() {
  return (
    <IconBase>
      <path d="M7 4v16" />
      <path d="M7 4 4 7" />
      <path d="M7 4l3 3" />
      <path d="M17 20V4" />
      <path d="M17 20l-3-3" />
      <path d="M17 20l3-3" />
    </IconBase>
  );
}

function IconChevron({ up }: { up?: boolean }) {
  return (
    <span className={`flex transition-transform ${up ? "rotate-180" : ""}`}>
      <IconBase>
        <path d="M6 9l6 6 6-6" />
      </IconBase>
    </span>
  );
}

function Stat({ label, value, growth }: { label: string; value: string; growth?: ReactNode }) {
  return (
    <div className="rounded-xl bg-slate-50 px-2 py-3">
      <p className="text-[11px] text-muted">{label}</p>
      <p className="mt-1 text-sm font-semibold tabular-nums">{value}</p>
      {growth ? <p className="mt-0.5">{growth}</p> : null}
    </div>
  );
}

function HostCycleTrend({ daily }: { daily: MyHostCycleDaily[] }) {
  const data = daily.map((item) => ({
    date: item.date.slice(5),
    revenue: Number((item.revenueCents / 100).toFixed(2)),
  }));
  const max = Math.max(...data.map((item) => item.revenue), 0);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
        <XAxis dataKey="date" tick={{ fontSize: 10 }} interval="preserveStartEnd" axisLine={false} tickLine={false} />
        <Tooltip
          formatter={(value) => `¥${Number(value ?? 0).toLocaleString("zh-CN")}`}
          labelFormatter={(label) => `${label} 流水`}
        />
        <Bar dataKey="revenue" radius={[3, 3, 0, 0]}>
          {data.map((item) => (
            <Cell key={item.date} fill={item.revenue >= max && max > 0 ? "#4f46e5" : "#a5b4fc"} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
