"use client";

import { useState, type ReactNode } from "react";
import { Badge, SalaryRecordStatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { QueryMessage } from "@/components/query-message";
import { useHostSalaryStatusLogs } from "@/lib/api/hooks";
import type { HostSalaryRecord } from "@/lib/api/data";
import { formatBpsAsPercent, formatCentsToYuan, formatDateTime, formatDurationSeconds } from "@/lib/format";

const STATUS_LABELS: Record<string, string> = {
  pending_review: "待审核",
  pending_confirm: "待确认",
  confirmed: "已确认",
  completed: "已完成",
};

interface HostAdjustment {
  name: string;
  amountCents: number;
}

interface BreakdownItem {
  teamId?: string;
  teamName?: string | null;
  revenueCents?: number;
  broadcastMinutes?: number;
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

function readBreakdown(value: HostSalaryRecord["team_breakdown"]): BreakdownItem[] {
  if (!Array.isArray(value)) return [];
  return value as unknown as BreakdownItem[];
}

function signedAmount(cents: number): string {
  return `${cents > 0 ? "+" : ""}${formatCentsToYuan(cents)}`;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl bg-white px-4 py-3 shadow-sm shadow-slate-200/60">
      <h3 className="mb-2.5 text-xs font-semibold text-slate-500">{title}</h3>
      <dl className="space-y-2.5 text-sm">{children}</dl>
    </section>
  );
}

function Row({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone?: "muted" | "strong" | "danger" | "success";
  hint?: string;
}) {
  const toneClass =
    tone === "muted"
      ? "text-muted"
      : tone === "danger"
        ? "text-danger"
        : tone === "success"
          ? "text-emerald-600"
          : tone === "strong"
            ? "font-semibold text-foreground"
            : "text-foreground";
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-xs text-muted" title={hint}>
        {label}
      </dt>
      <dd className={`tabular-nums ${toneClass}`}>{value}</dd>
    </div>
  );
}

/**
 * 「调整合计」行：有调整项时点击可展开各条明细，否则为普通静态行。
 * 与主播工资条口径一致：列表只展示合计，明细按需展开。
 */
function AdjustmentSummary({ adjustments, total }: { adjustments: HostAdjustment[]; total: number }) {
  const [expanded, setExpanded] = useState(false);
  const hasAdjustments = adjustments.length > 0;
  const toneClass = total < 0 ? "text-danger" : total > 0 ? "text-emerald-600" : "text-muted";
  const toggle = () => setExpanded((value) => !value);

  return (
    <div className="space-y-2.5">
      <div
        role={hasAdjustments ? "button" : undefined}
        tabIndex={hasAdjustments ? 0 : undefined}
        aria-expanded={hasAdjustments ? expanded : undefined}
        onClick={hasAdjustments ? toggle : undefined}
        onKeyDown={
          hasAdjustments
            ? (event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  toggle();
                }
              }
            : undefined
        }
        className={`flex items-start justify-between gap-3 ${hasAdjustments ? "cursor-pointer select-none" : ""}`}
      >
        <dt className="flex items-center gap-1 text-xs text-muted">
          调整合计
          {hasAdjustments ? (
            <span aria-hidden="true" className={`text-[10px] transition-transform ${expanded ? "rotate-90" : ""}`}>
              ▶
            </span>
          ) : null}
        </dt>
        <dd className={`tabular-nums ${toneClass}`}>{hasAdjustments ? signedAmount(total) : "—"}</dd>
      </div>
      {hasAdjustments && expanded ? (
        <div className="space-y-2 rounded-xl bg-slate-50 px-3 py-2">
          {adjustments.map((adjustment, index) => (
            <div key={`${adjustment.name}-${index}`} className="flex items-start justify-between gap-3">
              <span className="text-xs text-muted">{adjustment.name || "未命名调整"}</span>
              <span className={`tabular-nums text-xs ${adjustment.amountCents < 0 ? "text-danger" : "text-emerald-600"}`}>
                {signedAmount(adjustment.amountCents)}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function StatusTimeline({ recordId }: { recordId: string }) {
  const logs = useHostSalaryStatusLogs(recordId);
  return (
    <>
      <QueryMessage loading={logs.isLoading} error={logs.error} empty={!logs.data?.length} />
      <ol className="space-y-1.5 text-xs">
        {logs.data?.map((log) => (
          <li key={log.id} className="flex flex-wrap items-center gap-2">
            <span className="text-slate-400">{formatDateTime(log.created_at)}</span>
            <span>
              {log.from_status ? `${STATUS_LABELS[log.from_status] ?? log.from_status} → ` : ""}
              {STATUS_LABELS[log.to_status] ?? log.to_status}
            </span>
            {log.operator?.name ? <span className="text-slate-400">· {log.operator.name}</span> : null}
            {log.note ? <span className="text-slate-500">（{log.note}）</span> : null}
          </li>
        ))}
      </ol>
    </>
  );
}

/** 完整主持工资条详情（成员端全屏面板，展示 17 个字段的结算快照）。 */
export function HostPayslipDetail({
  item,
  onClose,
  onConfirm,
  confirming,
}: {
  item: HostSalaryRecord;
  onClose: () => void;
  onConfirm?: () => void;
  confirming?: boolean;
}) {
  const adjustments = readAdjustments(item.adjustments);
  const adjustmentTotal = adjustments.reduce((sum, adjustment) => sum + adjustment.amountCents, 0);
  const penaltyTotal = adjustments.filter((a) => a.amountCents < 0).reduce((sum, a) => sum + a.amountCents, 0);
  const rewardTotal = adjustments.filter((a) => a.amountCents > 0).reduce((sum, a) => sum + a.amountCents, 0);
  const breakdown = readBreakdown(item.team_breakdown);
  const teamNames = breakdown.map((entry) => entry.teamName ?? "未知团队");

  return (
    <div className="fixed inset-0 z-30 flex justify-center bg-slate-900/40">
      <div className="flex h-full w-full max-w-[430px] flex-col bg-slate-50">
        <header className="flex items-start justify-between gap-3 border-b border-slate-200/70 bg-white px-4 pt-[calc(14px+env(safe-area-inset-top))] pb-3">
          <div className="min-w-0 space-y-1">
            <p className="truncate text-sm font-semibold">完整主持工资条</p>
            <p className="truncate text-xs text-muted">
              {item.period_start} ~ {item.period_end}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="shrink-0 rounded-full px-3 py-1 text-xs text-slate-500 hover:bg-slate-100"
          >
            关闭
          </button>
        </header>

        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4 pb-[calc(24px+env(safe-area-inset-bottom))]">
          <div className="rounded-2xl bg-white px-4 py-4 shadow-sm shadow-slate-200/60">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 space-y-1">
                <p className="truncate text-sm font-semibold">{item.host?.name ?? "我"}</p>
                <p className="truncate text-xs text-muted">主持 · {teamNames.length ? teamNames.join("、") : "暂无团队"}</p>
              </div>
              <div className="flex shrink-0 gap-1">
                <Badge tone={item.is_qualified ? "green" : "amber"}>
                  {item.is_qualified ? "达标" : "未达标"}
                </Badge>
                <SalaryRecordStatusBadge status={item.status} />
              </div>
            </div>
            <div className="mt-3 rounded-xl bg-slate-50 px-4 py-3">
              <p className="text-xs text-muted">到手收益</p>
              <p className={`mt-1 text-2xl font-semibold tabular-nums tracking-tight ${item.net_cents < 0 ? "text-danger" : ""}`}>
                {formatCentsToYuan(item.net_cents)}
              </p>
            </div>
          </div>

          <Section title="流水与提成">
            <Row label="主持姓名" value={item.host?.name ?? "我"} />
            <Row label="团队名称" value={teamNames.length ? teamNames.join("、") : "—"} />
            <Row label="团总流水" value={formatCentsToYuan(item.revenue_cents)} />
            <Row
              label="直播时长"
              value={item.broadcast_minutes > 0 ? formatDurationSeconds(item.broadcast_minutes * 60) : "—"}
              hint="各团队每日直播时长汇总"
            />
            <Row label="拿提点门槛" value={formatCentsToYuan(item.threshold_cents)} hint="团总流水达到该值才达标" />
            <Row label="是否达标" value={item.is_qualified ? "是" : "否"} tone={item.is_qualified ? "success" : "danger"} />
            <Row label="基础提成率" value={formatBpsAsPercent(item.base_commission_rate_bps)} />
            <Row
              label="阶梯式提点"
              value={formatBpsAsPercent(item.tier_bonus_bps)}
              hint="超拿提点门槛每满 10 万元 +1 个点，最高 +3 个点"
            />
            <Row
              label="最终提成率"
              value={formatBpsAsPercent(item.commission_rate_bps)}
              hint="最终提成率 = 基础提成率 + 阶梯式提点"
            />
          </Section>

          <Section title="收益构成">
            <Row label="基础收益" value={formatCentsToYuan(item.base_income_cents)} hint="未达标时计发的固定保底" />
            <Row label="总违约" value={penaltyTotal ? signedAmount(penaltyTotal) : "—"} tone={penaltyTotal ? "danger" : "muted"} />
            <Row label="总奖励" value={rewardTotal ? signedAmount(rewardTotal) : "—"} tone={rewardTotal ? "success" : "muted"} />
            <AdjustmentSummary adjustments={adjustments} total={adjustmentTotal} />
            <Row label="实发收益" value={formatCentsToYuan(item.gross_cents)} />
            <Row label="服务率" value={formatBpsAsPercent(item.service_fee_rate_bps)} />
            <Row label="服务费" value={`−${formatCentsToYuan(item.service_fee_cents)}`} tone="muted" />
            <Row label="到手收益" value={formatCentsToYuan(item.net_cents)} tone={item.net_cents < 0 ? "danger" : "strong"} />
          </Section>

          <section className="rounded-2xl bg-white px-4 py-3 shadow-sm shadow-slate-200/60">
            <h3 className="mb-2.5 text-xs font-semibold text-slate-500">团队明细</h3>
            {breakdown.length ? (
              <ul className="space-y-2 text-sm">
                {breakdown.map((entry, index) => (
                  <li key={entry.teamId ?? index} className="flex items-start justify-between gap-3">
                    <span className="text-xs text-muted">{entry.teamName ?? "未知团队"}</span>
                    <span className="text-right tabular-nums">
                      {formatCentsToYuan(entry.revenueCents ?? 0)}
                      {entry.broadcastMinutes
                        ? <span className="text-muted"> · {formatDurationSeconds(entry.broadcastMinutes * 60)}</span>
                        : null}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted">该周期暂无团队流水。</p>
            )}
          </section>

          <section className="rounded-2xl bg-white px-4 py-3 shadow-sm shadow-slate-200/60">
            <h3 className="mb-2.5 text-xs font-semibold text-slate-500">状态变更记录</h3>
            <StatusTimeline recordId={item.id} />
          </section>

          {item.status === "pending_confirm" && onConfirm ? (
            <Button className="w-full" disabled={confirming} onClick={onConfirm}>
              {confirming ? "确认中…" : "确认收款"}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
