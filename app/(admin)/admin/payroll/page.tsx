"use client";

import { Fragment, useMemo, useState } from "react";
import { SalaryRecordStatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { QueryMessage } from "@/components/query-message";
import { PageHeader } from "@/components/ui/stat-card";
import { Select } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import {
  useCurrentProfile,
  useMembers,
  useRejectAndRecompute,
  useSalaryRecords,
  useSalaryStatusLogs,
  useTeams,
  useTransitionSalaryStatus,
} from "@/lib/api/hooks";
import type { SalaryRecord } from "@/lib/api/data";
import { formatBpsAsPercent, formatCentsToYuan, formatDateTime } from "@/lib/format";

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

/** 周期标签：优先用 period_start ~ period_end，否则回退 month。 */
function periodLabel(item: SalaryRecord): string {
  if (item.period_start && item.period_end) {
    return `${item.period_start} ~ ${item.period_end}`;
  }
  return item.month.slice(0, 7);
}



export default function PayrollPage() {
  const salary = useSalaryRecords();
  const members = useMembers();
  const teams = useTeams();
  const me = useCurrentProfile();
  const transition = useTransitionSalaryStatus();
  const reject = useRejectAndRecompute();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // 筛选状态
  const [teamId, setTeamId] = useState("");
  const [memberId, setMemberId] = useState("");
  const [period, setPeriod] = useState("");
  const [status, setStatus] = useState("");

  const operatorProfileId = me.data?.id;

  // 可用的周期列表（去重、倒序）。
  const periods = useMemo(() => {
    const set = new Set<string>();
    for (const item of salary.data ?? []) set.add(periodLabel(item));
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [salary.data]);

  // 多维度筛选。
  const filtered = useMemo(() => {
    return (salary.data ?? []).filter((item) => {
      if (teamId && item.team_id !== teamId) return false;
      if (memberId && item.profile_id !== memberId) return false;
      if (period && periodLabel(item) !== period) return false;
      if (status && item.status !== status) return false;
      return true;
    });
  }, [salary.data, teamId, memberId, period, status]);

  // 按「团队 + 周期」分组。
  const groups = useMemo(() => {
    const map = new Map<string, { team: string; period: string; records: SalaryRecord[] }>();
    for (const item of filtered) {
      const key = `${item.team_id ?? "none"}__${item.period_start ?? item.month}__${item.period_end ?? ""}`;
      if (!map.has(key)) {
        map.set(key, { team: item.team?.name ?? "未关联团队", period: periodLabel(item), records: [] });
      }
      map.get(key)!.records.push(item);
    }
    return Array.from(map.values());
  }, [filtered]);

  return (
    <>
      <PageHeader title="薪水管理" description="按成员展示每个周期的绩效与薪水明细" />

      {/* 多维度筛选 */}
      <Card className="mb-6">
        <CardHeader title="筛选" />
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Select
            value={teamId}
            placeholder="全部团队"
            options={[{ id: "", name: "全部团队" }, ...(teams.data ?? []).map((t) => ({ id: t.id, name: t.name }))]}
            onChange={setTeamId}
          />
          <Select
            value={memberId}
            placeholder="全部成员"
            options={[{ id: "", name: "全部成员" }, ...(members.data ?? []).map((m) => ({ id: m.id, name: m.name }))]}
            onChange={setMemberId}
          />
          <Select
            value={period}
            placeholder="全部周期"
            options={[{ id: "", name: "全部周期" }, ...periods.map((p) => ({ id: p, name: p }))]}
            onChange={setPeriod}
          />
          <Select
            value={status}
            placeholder="全部状态"
            options={[
              { id: "", name: "全部状态" },
              { id: "pending_review", name: "待审核" },
              { id: "pending_confirm", name: "待确认" },
              { id: "confirmed", name: "已确认" },
              { id: "completed", name: "已完成" },
            ]}
            onChange={setStatus}
          />
        </CardContent>
      </Card>

      <div>
        <Card>
          <CardHeader title="薪水明细" description="成员 · 绩效 · 薪水" />
          <CardContent className="p-0">
            <QueryMessage loading={salary.isLoading} error={salary.error} empty={!groups.length} />
            <Table>
              <THead>
                <TH isRowHeader>成员</TH>
                <TH className="text-right">流水(绩效)</TH>
                <TH className="text-right">保底</TH>
                <TH className="text-right">提成率</TH>
                <TH className="text-right">绩效提成</TH>
                <TH className="text-right">总工资</TH>
                <TH className="text-right">服务费</TH>
                <TH className="text-right">实发</TH>
                <TH>达标</TH>
                <TH>状态</TH>
                <TH className="text-right">操作</TH>
              </THead>
              <TBody>
                {groups.map((group) => (
                  <Fragment key={`${group.team}-${group.period}`}>
                    <TR>
                      <TD className="bg-slate-100 text-xs font-semibold text-slate-600" colSpan={11}>
                        {`${group.team} · ${group.period}`}
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
                          <TD className="text-right tabular-nums">{formatCentsToYuan(item.revenue_cents)}</TD>
                          <TD className="text-right tabular-nums">{formatCentsToYuan(item.guaranteed_component_cents)}</TD>
                          <TD className="text-right tabular-nums">{item.commission_rate_bps > 0 ? formatBpsAsPercent(item.commission_rate_bps) : "—"}</TD>
                          <TD className="text-right tabular-nums">{formatCentsToYuan(item.performance_component_cents)}</TD>
                          <TD className="text-right tabular-nums">{formatCentsToYuan(item.gross_cents)}</TD>
                          <TD className="text-right tabular-nums">{formatCentsToYuan(item.service_fee_cents)}</TD>
                          <TD className="text-right font-semibold tabular-nums">{formatCentsToYuan(item.net_cents)}</TD>
                          <TD>{item.is_qualified ? "达标" : "未达标"}{item.is_grace_period ? "（无责期）" : ""}</TD>
                          <TD><SalaryRecordStatusBadge status={item.status} /></TD>
                          <TD className="text-right">
                            <span className="flex justify-end gap-1">
                              {item.status === "pending_review" ? (
                                <>
                                  <Button variant="secondary" size="sm" onClick={() => transition.mutate({ id: item.id, status: "pending_confirm", operatorProfileId, note: "管理员审核通过" })}>通过</Button>
                                  <Button variant="ghost" size="sm" onClick={() => reject.mutate({ id: item.id, operatorProfileId })}>驳回重算</Button>
                                </>
                              ) : null}
                              {item.status === "confirmed" ? (
                                <Button variant="secondary" size="sm" onClick={() => transition.mutate({ id: item.id, status: "completed", operatorProfileId, note: "管理员确认到账" })}>确认到账</Button>
                              ) : null}
                            </span>
                          </TD>
                        </TR>
                        {expandedId === item.id ? (
                          <TR>
                            <TD colSpan={11}>
                              <div className="space-y-2">
                                <StatusTimeline recordId={item.id} />
                                {/* 该条记录的计算参数明细 */}
                                <div className="bg-slate-50 p-3 text-xs text-slate-600">
                                  <p>在职月序：{item.tenure_month} 月</p>
                                  <p>保底基准：{formatCentsToYuan(item.base_guarantee_cents)}</p>
                                  <p>达标门槛：{formatCentsToYuan(item.threshold_cents)}</p>
                                  <p>提成起征：{formatCentsToYuan(item.commission_start_cents)}</p>
                                </div>
                              </div>
                            </TD>
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
      </div>
    </>
  );
}