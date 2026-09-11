"use client";

import type { ReactNode } from "react";
import { Badge, SalaryRecordStatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { QueryMessage } from "@/components/query-message";
import { useSalaryStatusLogs } from "@/lib/api/hooks";
import type { SalaryRecord } from "@/lib/api/data";
import type { PayrollAdjustment } from "@/lib/domain/payroll/adjustment";
import { formatBpsAsPercent, formatCentsToYuan, formatDate, formatDateTime, formatMonth } from "@/lib/format";

const STATUS_LABELS: Record<string, string> = {
  pending_review: "待审核",
  pending_confirm: "待确认",
  confirmed: "已确认",
  completed: "已完成",
};

/** 周期标签：优先展示保存周期，缺失时回退到月份。 */
export function periodLabel(item: SalaryRecord): string {
  return item.period_start && item.period_end
    ? `${formatDate(item.period_start)} ~ ${formatDate(item.period_end)}`
    : formatMonth(item.month.slice(0, 7));
}

/**
 * 读取结算时保存的调整项快照；格式非法的条目直接忽略，
 * 保证成员端展示不会因单条脏数据整页失败。
 */
export function readAdjustments(value: SalaryRecord["adjustments"]): PayrollAdjustment[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    if (typeof entry.name !== "string" || typeof entry.amountCents !== "number" || !Number.isSafeInteger(entry.amountCents)) return [];
    return [{ name: entry.name, amountCents: entry.amountCents }];
  });
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

function Row({ label, value, tone, hint }: { label: string; value: string; tone?: "muted" | "strong" | "danger" | "success"; hint?: string }) {
  const toneClass =
    tone === "muted" ? "text-muted"
      : tone === "danger" ? "text-danger"
      : tone === "success" ? "text-emerald-600"
      : tone === "strong" ? "font-semibold text-foreground"
      : "text-foreground";
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-xs text-muted" title={hint}>{label}</dt>
      <dd className={`tabular-nums ${toneClass}`}>{value}</dd>
    </div>
  );
}

/** 状态变更时间轴（精确到秒）。 */
function StatusTimeline({ recordId }: { recordId: string }) {
  const logs = useSalaryStatusLogs(recordId);
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

/**
 * 完整工资条详情（成员端全屏面板）。
 * 展示结算时保存的历史快照，不在前端按当前公式重算已结算工资。
 */
export function PayslipDetail({
  item,
  onClose,
  onConfirm,
  confirming,
}: {
  item: SalaryRecord;
  onClose: () => void;
  onConfirm?: () => void;
  confirming?: boolean;
}) {
  const adjustments = readAdjustments(item.adjustments);
  const adjustmentTotal = adjustments.reduce((sum, adjustment) => sum + adjustment.amountCents, 0);
  // 基础收益 = 已结算实发收益扣除调整项合计（历史快照口径）。
  const baseIncome = item.gross_cents - adjustmentTotal;
  const attendanceBonusBps = item.attendance_bonus_bps ?? 0;
  const dyTaskBonusBps = item.dy_task_bonus_bps ?? 0;
  // 基础提成率取结算快照；阶梯提点 = 最终提成率 − 基础 − 考勤 − dy，未计提时为 0。
  const baseCommissionRateBps = item.base_commission_rate_bps ?? 0;
  const tierBonusBps = item.commission_rate_bps > 0
    ? Math.max(item.commission_rate_bps - baseCommissionRateBps - attendanceBonusBps - dyTaskBonusBps, 0)
    : 0;
  const isAnchor = item.position?.code === "anchor";
  // 系统只保存折算后流水，音浪按流水 × 10 反推展示。
  const soundWaves = (item.revenue_cents / 10).toLocaleString("zh-CN", { maximumFractionDigits: 1 });

  return (
    <div className="fixed inset-0 z-30 flex justify-center bg-slate-900/40">
      <div className="flex h-full w-full max-w-[430px] flex-col bg-slate-50">
        <header className="flex items-start justify-between gap-3 border-b border-slate-200/70 bg-white px-4 pt-[calc(14px+env(safe-area-inset-top))] pb-3">
          <div className="min-w-0 space-y-1">
            <p className="truncate text-sm font-semibold">完整工资条</p>
            <p className="truncate text-xs text-muted">{periodLabel(item)}</p>
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
                <p className="truncate text-sm font-semibold">{item.profile?.name ?? "我"}</p>
                <p className="truncate text-xs text-muted">
                  {item.position?.name ?? "岗位信息缺失"} · {item.team_id === null ? "系统结算" : item.team?.name ?? "团队信息缺失"}
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                <Badge tone={item.is_qualified ? "green" : "amber"}>{item.is_qualified ? "达标" : "未达标"}</Badge>
                <SalaryRecordStatusBadge status={item.status} />
              </div>
            </div>
            <div className="mt-3 rounded-xl bg-slate-50 px-4 py-3">
              <p className="text-xs text-muted">到手工资</p>
              <p className={`mt-1 text-2xl font-semibold tabular-nums tracking-tight ${item.net_cents < 0 ? "text-danger" : ""}`}>
                {formatCentsToYuan(item.net_cents)}
              </p>
            </div>
          </div>

          <Section title="流水与门槛">
            {isAnchor ? <Row label="总音浪" value={soundWaves} hint="按总流水 × 10 折算，非原始录入音浪" /> : null}
            <Row label="周期流水" value={formatCentsToYuan(item.revenue_cents)} />
            <Row label="拿提点门槛" value={formatCentsToYuan(item.commission_start_cents)} hint="达到该流水才开始计提成" />
            <Row label="拿保底门槛" value={formatCentsToYuan(item.threshold_cents)} />
            <Row label="是否达标" value={item.is_qualified ? "达标" : "未达标"} tone={item.is_qualified ? "success" : "danger"} />
            <Row label="无责期状态" value={item.is_grace_period ? "无责期" : "非无责期"} />
            <Row label="在职月序" value={`${item.tenure_month} 月`} />
          </Section>

          <Section title="提成明细">
            <Row label="保底金额" value={formatCentsToYuan(item.base_guarantee_cents)} />
            <Row
              label="基础提成率"
              value={formatBpsAsPercent(baseCommissionRateBps)}
              hint="结算时采用的基础提成率快照"
            />
            <Row
              label="阶梯提点"
              value={formatBpsAsPercent(tierBonusBps)}
              hint={item.commission_rate_bps === 0 ? "未达提成起征线，本次未计提" : "每满 1 万流水 +1%，最高 +5%"}
            />
            <Row
              label="考勤加点"
              value={`${attendanceBonusBps / 100} 个百分点`}
              hint="结算保存的考勤加点，未达提成起征线时不计入提成"
            />
            <Row
              label="dy任务加点"
              value={`${dyTaskBonusBps / 100} 个百分点`}
              hint="结算保存的 dy 任务加点，未达提成起征线时不计入提成"
            />
            <Row
              label="最终提成率"
              value={formatBpsAsPercent(item.commission_rate_bps)}
              hint={item.commission_rate_bps === 0 ? "本次结算未计提成" : "本次结算实际采用的提成率"}
            />
          </Section>

          <Section title="收益构成">
            <Row label="保障性部分" value={formatCentsToYuan(item.guaranteed_component_cents)} />
            <Row label={`绩效工资（${formatBpsAsPercent(item.commission_rate_bps)}）`} value={formatCentsToYuan(item.performance_component_cents)} />
            <Row label="基础收益" value={formatCentsToYuan(baseIncome)} hint="实发收益扣除调整项合计" />
            <Row
              label="调整合计"
              value={adjustments.length ? signedAmount(adjustmentTotal) : "—"}
              tone={adjustmentTotal < 0 ? "danger" : adjustmentTotal > 0 ? "success" : "muted"}
            />
            <Row label="实发收益" value={formatCentsToYuan(item.gross_cents)} />
            <Row label="服务费" value={`−${formatCentsToYuan(item.service_fee_cents)}`} tone="muted" />
            <Row label="到手工资" value={formatCentsToYuan(item.net_cents)} tone={item.net_cents < 0 ? "danger" : "strong"} />
          </Section>

          {adjustments.length ? (
            <Section title="奖励与扣款明细">
              {adjustments.map((adjustment, index) => (
                <Row
                  key={`${adjustment.name}-${index}`}
                  label={adjustment.name || "未命名调整"}
                  value={signedAmount(adjustment.amountCents)}
                  tone={adjustment.amountCents < 0 ? "danger" : "success"}
                />
              ))}
            </Section>
          ) : null}

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