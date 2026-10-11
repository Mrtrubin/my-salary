"use client";

import { formatBpsAsPercent, formatCentsToYuan } from "@/lib/format";
import type { AnchorEstimate, AnchorGoal } from "./estimate";

/** 把目标阶段翻译成一句人话。 */
export function goalText(goal: AnchorGoal): string {
  switch (goal.stage) {
    case "belowThreshold":
      return `还差 ${formatCentsToYuan(goal.remainingInCents)} 达到保底门槛`;
    case "belowCommission":
      return `还差 ${formatCentsToYuan(goal.remainingInCents)} 进入提成模式`;
    case "inCommission":
      return `再播 ${formatCentsToYuan(goal.remainingInCents)}，提成率升到 ${formatBpsAsPercent(goal.nextRateBps ?? 0)}`;
    case "maxStep":
      return "已达最高阶梯，提成率不再提升";
  }
}

function MilestoneRow({ label, done }: { label: string; done: boolean }) {
  return (
    <li className="flex items-center justify-between gap-3">
      <span className={done ? "text-slate-500" : "text-muted"}>{label}</span>
      <span className={done ? "font-medium text-emerald-600" : "text-muted"}>
        {done ? "✓ 已达成" : "未达成"}
      </span>
    </li>
  );
}

/**
 * ② 目标进度（本页差异化价值）：门槛 → 拿提点门槛 → 每满 1 万升 1 档。
 * 进度比例与门槛金额全部来自 `estimate`，组件自身不重算任何金额。
 */
export function GoalProgress({ estimate }: { estimate: AnchorEstimate }) {
  const { payroll, goal } = estimate;
  const percent = Math.round(goal.progressRatio * 100);

  return (
    <section className="rounded-2xl bg-white px-4 py-4 shadow-sm shadow-slate-200/60">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">目标进度</h2>
        <span className="text-xs text-muted">
          {payroll.commissionRateBps > 0
            ? `提成模式 · 当前提成率 ${formatBpsAsPercent(payroll.commissionRateBps)}`
            : "保底模式"}
        </span>
      </div>

      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full bg-indigo-500 transition-all"
          style={{ width: `${percent}%` }}
        />
      </div>

      <p className="mt-2 text-xs text-slate-600">{goalText(goal)}</p>

      <ul className="mt-3 space-y-2 border-t border-slate-100 pt-3 text-xs">
        <MilestoneRow
          label={`保底达标线 ${formatCentsToYuan(payroll.thresholdInCents)}`}
          done={payroll.isQualified}
        />
        <MilestoneRow
          label={`拿提点线 ${formatCentsToYuan(payroll.commissionStartInCents)}`}
          done={payroll.commissionRateBps > 0}
        />
      </ul>
    </section>
  );
}
