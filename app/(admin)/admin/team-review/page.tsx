"use client";

import { useMemo, useState } from "react";
import { PerformanceStatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { QueryMessage } from "@/components/query-message";
import { PageHeader } from "@/components/ui/stat-card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useTeamPerformance, useUpdateTeamPerformanceStatus } from "@/lib/api/hooks";
import type { PerformanceStatus } from "@/lib/api/data";
import { formatDate } from "@/lib/format";

const STATUS_OPTIONS: { value: "all" | PerformanceStatus; label: string }[] = [
  { value: "all", label: "全部状态" },
  { value: "approved", label: "已通过" },
  { value: "rejected", label: "已驳回" },
  { value: "pending", label: "待审核" },
  { value: "voided", label: "已作废" },
];

function toHours(minutes: number): string {
  if (!minutes) return "0";
  const h = minutes / 60;
  return Number.isInteger(h) ? String(h) : h.toFixed(1);
}

export default function TeamReviewPage() {
  const query = useTeamPerformance();
  const mutation = useUpdateTeamPerformanceStatus();
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [keyword, setKeyword] = useState("");
  const [status, setStatus] = useState<"all" | PerformanceStatus>("all");

  const filtered = useMemo(() => {
    const records = query.data ?? [];
    const kw = keyword.trim().toLowerCase();
    return records.filter((item) => {
      if (status !== "all" && item.status !== status) return false;
      if (!kw) return true;
      const names = `${item.profile?.name ?? ""} ${item.team?.name ?? ""}`.toLowerCase();
      return names.includes(kw);
    });
  }, [query.data, keyword, status]);

  async function reject() {
    if (!rejectingId || !reason.trim()) return;
    await mutation.mutateAsync({ id: rejectingId, status: "rejected", reason: reason.trim() });
    setRejectingId(null);
    setReason("");
  }

  return (
    <>
      <PageHeader title="团队绩效审核" description="团队每日绩效默认自动通过；管理员如有异议可驳回并填写原因" />
      <Card>
        <CardHeader title="团队绩效记录" />
        <CardContent className="p-0">
          <div className="flex flex-wrap gap-3 p-4">
            <Input
              className="max-w-xs"
              placeholder="搜索成员 / 团队名称"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
            />
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value as "all" | PerformanceStatus)}
              className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100"
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            {keyword || status !== "all" ? (
              <Button variant="ghost" onClick={() => { setKeyword(""); setStatus("all"); }}>
                重置
              </Button>
            ) : null}
          </div>
          <QueryMessage loading={query.isLoading} error={query.error} empty={!filtered.length} />
          <Table>
            <THead>
              <TH isRowHeader>绩效日期</TH>
              <TH>团队</TH>
              <TH>成员</TH>
              <TH>绩效点</TH>
              <TH className="text-right">开播时长</TH>
              <TH className="text-right">业绩</TH>
              <TH>状态</TH>
              <TH className="text-right">操作</TH>
            </THead>
            <TBody>
              {filtered.map((item) => {
                const voided = item.status === "voided";
                return (
                <TR key={item.id}>
                  <TD className={voided ? "line-through text-slate-400" : undefined}>{formatDate(item.perf_date)}</TD>
                  <TD className={voided ? "line-through text-slate-400" : undefined}>{item.team?.name ?? "—"}</TD>
                  <TD className={voided ? "line-through text-slate-400" : undefined}>{item.profile?.name ?? "—"}</TD>
                  <TD className={voided ? "line-through text-slate-400" : undefined}>{item.no_perf ? (item.no_perf_note || "停播") : (item.point?.name ?? "—")}</TD>
                  <TD className={`text-right${voided ? " line-through text-slate-400" : ""}`}>{toHours(item.broadcast_minutes)}</TD>
                  <TD className={`text-right${voided ? " line-through text-slate-400" : ""}`}>{item.no_perf ? "—" : item.points_amount.toLocaleString()}</TD>
                  <TD>
                    <PerformanceStatusBadge status={item.status} />
                    {item.reject_reason ? <p className="text-xs text-red-600">{item.reject_reason}</p> : null}
                  </TD>
                  <TD className="text-right">
                    {item.status === "rejected" ? (
                      <Button variant="secondary" onClick={() => mutation.mutate({ id: item.id, status: "approved" })}>
                        恢复通过
                      </Button>
                    ) : item.status === "voided" ? (
                      "—"
                    ) : (
                      <Button variant="danger" onClick={() => setRejectingId(item.id)}>
                        驳回
                      </Button>
                    )}
                  </TD>
                </TR>
                );
              })}
            </TBody>
          </Table>
        </CardContent>
      </Card>
      {rejectingId ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <Card className="w-full max-w-md px-4 py-4">
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={3}
              className="w-full rounded-lg border p-2"
              placeholder="请输入驳回原因"
            />
            <div className="mt-3 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setRejectingId(null)}>取消</Button>
              <Button variant="danger" disabled={!reason.trim() || mutation.isPending} onClick={reject}>
                确认驳回
              </Button>
            </div>
          </Card>
        </div>
      ) : null}
    </>
  );
}