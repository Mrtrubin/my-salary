"use client";

import { useMemo, useState } from "react";
import { PerformanceStatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { QueryMessage } from "@/components/query-message";
import { PageHeader } from "@/components/ui/stat-card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { usePerformance, useUpdatePerformanceStatus } from "@/lib/api/hooks";
import type { PerformanceStatus } from "@/lib/api/data";
import { formatCentsToYuan, formatDate, formatDateTime } from "@/lib/format";

const STATUS_OPTIONS: { value: "all" | PerformanceStatus; label: string }[] = [
  { value: "all", label: "全部状态" },
  { value: "pending", label: "待审核" },
  { value: "approved", label: "已通过" },
  { value: "rejected", label: "已驳回" },
  { value: "draft", label: "草稿" },
];

export default function ReviewPage() {
  const query = usePerformance();
  const mutation = useUpdatePerformanceStatus();
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [keyword, setKeyword] = useState("");
  const [status, setStatus] = useState<"all" | PerformanceStatus>("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const filtered = useMemo(() => {
    const records = query.data ?? [];
    const kw = keyword.trim().toLowerCase();
    const fromTs = startDate ? new Date(`${startDate}T00:00:00`).getTime() : null;
    const toTs = endDate ? new Date(`${endDate}T23:59:59.999`).getTime() : null;
    return records.filter((item) => {
      if (status !== "all" && item.status !== status) return false;
      if (fromTs !== null || toTs !== null) {
        const ts = item.created_at ? new Date(item.created_at).getTime() : NaN;
        if (Number.isNaN(ts)) return false;
        if (fromTs !== null && ts < fromTs) return false;
        if (toTs !== null && ts > toTs) return false;
      }
      if (!kw) return true;
      const names = `${item.profile?.name ?? ""} ${item.host?.name ?? ""}`.toLowerCase();
      return names.includes(kw);
    });
  }, [query.data, keyword, status, startDate, endDate]);
  async function reject() { if (!rejectingId || !reason.trim()) return; await mutation.mutateAsync({ id: rejectingId, status: "rejected", reason: reason.trim() }); setRejectingId(null); setReason(""); }
  return <><PageHeader title="业绩审核" description="通过的流水计入工资；驳回必须填写原因" /><Card><CardHeader title="业绩记录" /><CardContent className="p-0"><div className="flex flex-wrap gap-3 p-4"><Input className="max-w-xs" placeholder="搜索主播 / 主持姓名" value={keyword} onChange={(event) => setKeyword(event.target.value)} /><select value={status} onChange={(event) => setStatus(event.target.value as "all" | PerformanceStatus)} className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100">{STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><div className="flex items-center gap-2 text-sm text-slate-600"><input type="date" value={startDate} max={endDate || undefined} onChange={(event) => setStartDate(event.target.value)} className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100" /><span>至</span><input type="date" value={endDate} min={startDate || undefined} onChange={(event) => setEndDate(event.target.value)} className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100" /></div>{keyword || status !== "all" || startDate || endDate ? <Button variant="ghost" onClick={() => { setKeyword(""); setStatus("all"); setStartDate(""); setEndDate(""); }}>重置</Button> : null}</div><QueryMessage loading={query.isLoading} error={query.error} empty={!filtered.length} /><Table><THead><TH isRowHeader>上传时间</TH><TH>绩效日期</TH><TH>主播</TH><TH>主持</TH><TH className="text-right">流水</TH><TH>状态</TH><TH className="text-right">操作</TH></THead><TBody>{filtered.map((item) => <TR key={item.id}><TD>{formatDateTime(item.created_at)}</TD><TD>{formatDate(item.month)}</TD><TD>{item.profile?.name ?? "未关联"}</TD><TD>{item.host?.name ?? "—"}</TD><TD className="text-right">{formatCentsToYuan(item.revenue_cents)}</TD><TD><PerformanceStatusBadge status={item.status} />{item.reject_reason ? <p className="text-xs text-red-600">{item.reject_reason}</p> : null}</TD><TD className="text-right">{item.status === "pending" ? <span className="flex justify-end gap-1"><Button variant="secondary" onClick={() => mutation.mutate({ id: item.id, status: "approved" })}>通过</Button><Button variant="danger" onClick={() => setRejectingId(item.id)}>驳回</Button></span> : "—"}</TD></TR>)}</TBody></Table></CardContent></Card>{rejectingId ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"><Card className="w-full max-w-md px-4 py-4"><textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={3} className="w-full rounded-lg border p-2" placeholder="请输入驳回原因" /><div className="mt-3 flex justify-end gap-2"><Button variant="ghost" onClick={() => setRejectingId(null)}>取消</Button><Button variant="danger" disabled={!reason.trim() || mutation.isPending} onClick={reject}>确认驳回</Button></div></Card></div> : null}</>;
}