"use client";

import { Fragment, useMemo, useState } from "react";
import { SalaryRecordStatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { QueryMessage } from "@/components/query-message";
import { PageHeader } from "@/components/ui/stat-card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import {
  useCurrentProfile,
  useMembers,
  useRejectAndRecompute,
  useSalaryRecords,
  useSalaryStatusLogs,
  useSchemes,
  useSettleTeamPayroll,
  useTransitionSalaryStatus,
} from "@/lib/api/hooks";
import type { SalaryRecord } from "@/lib/api/data";
import { calculateAnchorPayroll } from "@/lib/domain/payroll/anchor";
import { formatCentsToYuan, formatDateTime } from "@/lib/format";

/** 状态变更历史时间轴（展开某条工资条时按需加载，精确到秒）。 */
function StatusTimeline({ recordId }: { recordId: string }) {
  const logs = useSalaryStatusLogs(recordId);
  const labels: Record<string, string> = {
    pending_review: "待审核",
    pending_confirm: "待确认",
    confirmed: "已确认",
    completed: "已完成",
  };
  return (
    <div className="bg-slate-50 p-3 text-xs">
      <QueryMessage loading={logs.isLoading} error={logs.error} empty={!logs.data?.length} />
      <ol className="space-y-1">
        {logs.data?.map((log) => (
          <li key={log.id} className="flex items-center gap-2">
            <span className="text-slate-400">{formatDateTime(log.created_at)}</span>
            <span>
              {log.from_status ? `${labels[log.from_status] ?? log.from_status} → ` : ""}
              {labels[log.to_status] ?? log.to_status}
            </span>
            {log.operator?.name ? <span className="text-slate-400">· {log.operator.name}</span> : null}
            {log.note ? <span className="text-slate-500">（{log.note}）</span> : null}
          </li>
        ))}
      </ol>
    </div>
  );
}

/** 周期分组键：团队 + 周期起止。 */
function periodKey(item: SalaryRecord): string {
  return `${item.team_id ?? "none"}__${item.period_start ?? item.month}__${item.period_end ?? ""}`;
}

export default function PayrollPage() {
  const salary = useSalaryRecords();
  const members = useMembers();
  const schemes = useSchemes();
  const me = useCurrentProfile();
  const transition = useTransitionSalaryStatus();
  const reject = useRejectAndRecompute();
  const settle = useSettleTeamPayroll();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [memberId, setMemberId] = useState("");
  const [revenue, setRevenue] = useState(0);

  const operatorProfileId = me.data?.id;

  // 按「团队 + 周期」分组。
  const groups = useMemo(() => {
    const map = new Map<string, { team: string; period: string; records: SalaryRecord[] }>();
    for (const item of salary.data ?? []) {
      const key = periodKey(item);
      const period = item.period_start && item.period_end ? `${item.period_start} ~ ${item.period_end}` : item.month.slice(0, 7);
      if (!map.has(key)) map.set(key, { team: item.team?.name ?? "未关联团队", period, records: [] });
      map.get(key)!.records.push(item);
    }
    return Array.from(map.values());
  }, [salary.data]);

  const member = members.data?.find((item) => item.id === memberId) ?? members.data?.[0];
  const scheme = schemes.data?.find((item) => item.profile_id === member?.id && item.status === "active");
  const tenure = member ? Math.max(1, (new Date().getFullYear() - Number(member.hire_date.slice(0, 4))) * 12 + new Date().getMonth() - Number(member.hire_date.slice(5, 7)) + 2) : 1;
  const preview = useMemo(() => scheme ? calculateAnchorPayroll({ scheme: { baseSalaryInCents: scheme.base_salary_cents, guaranteedSalaryInCents: scheme.guaranteed_salary_cents, thresholdMultiplierBps: scheme.threshold_multiplier_bps }, monthlyRevenueInCents: Math.round(revenue * 100), tenureMonth: tenure }) : null, [scheme, revenue, tenure]);

  return (
    <>
      <PageHeader title="工资核算" description="系统在下一结算周期首日自动生成待审核工资条，按团队 + 周期分组" />
      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <Card>
          <CardHeader title="核算记录" />
          <CardContent className="p-0">
            <QueryMessage loading={salary.isLoading} error={salary.error} empty={!groups.length} />
            <Table>
              <THead>
                <TH isRowHeader>成员</TH>
                <TH className="text-right">总工资</TH>
                <TH className="text-right">实发</TH>
                <TH>状态</TH>
                <TH className="text-right">操作</TH>
              </THead>
              <TBody>
                {groups.map((group) => (
                  <Fragment key={`${group.team}-${group.period}`}>
                    <TR>
                      <TD className="bg-slate-100 text-xs font-semibold text-slate-600" colSpan={5}>
                        {group.team} · {group.period}
                      </TD>
                    </TR>
                    {group.records.map((item) => (
                      <Fragment key={item.id}>
                        <TR>
                          <TD>
                            <button className="text-indigo-600 hover:underline" onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}>
                              {item.profile?.name ?? "未关联"}
                            </button>
                          </TD>
                          <TD className="text-right">{formatCentsToYuan(item.gross_cents)}</TD>
                          <TD className="text-right">{formatCentsToYuan(item.net_cents)}</TD>
                          <TD><SalaryRecordStatusBadge status={item.status} /></TD>
                          <TD className="text-right">
                            <span className="flex justify-end gap-1">
                              {item.status === "pending_review" ? (
                                <>
                                  <Button variant="secondary" onClick={() => transition.mutate({ id: item.id, status: "pending_confirm", operatorProfileId, note: "管理员审核通过" })}>通过</Button>
                                  <Button variant="ghost" onClick={() => reject.mutate({ id: item.id, operatorProfileId })}>驳回重算</Button>
                                </>
                              ) : null}
                              {item.status === "confirmed" ? (
                                <Button variant="secondary" onClick={() => transition.mutate({ id: item.id, status: "completed", operatorProfileId, note: "管理员确认到账" })}>确认到账</Button>
                              ) : null}
                            </span>
                          </TD>
                        </TR>
                        {expandedId === item.id ? (
                          <TR>
                            <TD colSpan={5}><StatusTimeline recordId={item.id} /></TD>
                          </TR>
                        ) : null}
                      </Fragment>
                    ))}
                  </Fragment>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader title="手动核算" description="重新核算所有成员的未结算及业绩有变更的待审周期" />
          <CardContent className="space-y-3">
            <Button
              disabled={settle.isPending}
              onClick={() => settle.mutate({})}
            >
              {settle.isPending ? "核算中…" : "重新核算全部"}
            </Button>
            {settle.isSuccess ? (
              <p className="text-sm text-emerald-600">
                核算完成：生成/更新 {settle.data?.settledRecords ?? 0} 条工资记录
                {settle.data?.failedTeams?.length ? `（${settle.data.failedTeams.length} 个团队失败）` : ""}
              </p>
            ) : null}
            {settle.isError ? <p className="text-sm text-red-600">核算失败，请重试</p> : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader title="工资试算" description="试算不写入正式工资记录" />
          <CardContent className="space-y-3">
            <select value={member?.id ?? ""} onChange={(event) => setMemberId(event.target.value)} className="w-full rounded-lg border p-2">
              {members.data?.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
            <input type="number" value={revenue} onChange={(event) => setRevenue(Number(event.target.value) || 0)} className="w-full rounded-lg border p-2" placeholder="当月流水（元）" />
            {preview ? (
              <div className="rounded-lg bg-slate-50 p-3 text-sm">
                <p>总工资：{formatCentsToYuan(preview.grossSalaryInCents)}</p>
                <p>服务费：{formatCentsToYuan(preview.serviceFeeInCents)}</p>
                <p className="font-semibold">实发：{formatCentsToYuan(preview.netSalaryInCents)}</p>
              </div>
            ) : <p className="text-xs text-amber-700">该成员暂无生效方案</p>}
          </CardContent>
        </Card>
      </div>
    </>
  );
}