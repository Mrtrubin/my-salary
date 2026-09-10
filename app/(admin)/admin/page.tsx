"use client";

import Link from "next/link";
import { PerformanceStatusBadge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { QueryMessage } from "@/components/query-message";
import { PageHeader, StatCard } from "@/components/ui/stat-card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useMembers, usePerformance, useSalaryRecords } from "@/lib/api/hooks";
import { formatCentsToYuan, formatDate } from "@/lib/format";

export default function AdminHomePage() {
  const members = useMembers();
  const performance = usePerformance();
  const salary = useSalaryRecords();
  const loading = members.isLoading || performance.isLoading || salary.isLoading;
  const error = members.error || performance.error || salary.error;
  const records = performance.data ?? [];
  const payroll = salary.data ?? [];
  const currentMonth = new Date().toISOString().slice(0, 7);
  const pending = records.filter((item) => item.status === "pending");
  const monthRevenue = records.filter((item) => item.month.slice(0, 7) === currentMonth && item.status === "approved").reduce((sum, item) => sum + item.revenue_cents, 0);
  const monthNet = payroll.filter((item) => item.month.slice(0, 7) === currentMonth && item.status === "completed").reduce((sum, item) => sum + item.net_cents, 0);
  const pendingReview = payroll.filter((item) => item.status === "pending_review").length;
  return <>
    <PageHeader title="控制台" description={`${currentMonth} 核算周期 · Supabase 实时数据`} />
    <QueryMessage loading={loading} error={error} />
    {!loading && !error ? <>
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard label="本月已审流水" value={formatCentsToYuan(monthRevenue)} />
        <StatCard label="本月实发工资" value={formatCentsToYuan(monthNet)} />
        <StatCard label="待审核业绩" value={`${pending.length} 条`} />
        <StatCard label="工资核算进度" value={`${payroll.length - pendingReview}/${payroll.length}`} />
      </div>
      <Card className="mt-6"><CardHeader title="待审核业绩" action={<Link href="/admin/review" className="text-xs text-indigo-600">全部处理 →</Link>} /><CardContent className="p-0"><Table><THead><TH isRowHeader>主播</TH><TH>日期</TH><TH className="text-right">流水</TH><TH>状态</TH></THead><TBody>{pending.map((item) => <TR key={item.id}><TD>{item.profile?.name ?? "未关联"}</TD><TD>{formatDate(item.month)}</TD><TD className="text-right">{formatCentsToYuan(item.revenue_cents)}</TD><TD><PerformanceStatusBadge status={item.status} /></TD></TR>)}</TBody></Table><QueryMessage loading={false} error={null} empty={!pending.length} /></CardContent></Card>
      <p className="mt-4 text-sm text-slate-500">在职成员 {members.data?.filter((item) => item.status === "active").length ?? 0} / {members.data?.length ?? 0}</p>
    </> : null}
  </>;
}
