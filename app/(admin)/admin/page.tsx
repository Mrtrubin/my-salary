"use client";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { QueryMessage } from "@/components/query-message";
import { PageHeader, StatCard } from "@/components/ui/stat-card";
import { useMembers, useSalaryRecords } from "@/lib/api/hooks";
import { formatCentsToYuan } from "@/lib/format";

export default function AdminHomePage() {
  const members = useMembers();
  const salary = useSalaryRecords();
  const loading = members.isLoading || salary.isLoading;
  const error = members.error || salary.error;
  const payroll = salary.data ?? [];
  const currentMonth = new Date().toISOString().slice(0, 7);
  const monthNet = payroll.filter((item) => item.month.slice(0, 7) === currentMonth && item.status === "completed").reduce((sum, item) => sum + item.net_cents, 0);
  const pendingReview = payroll.filter((item) => item.status === "pending_review").length;
  return <>
    <PageHeader title="控制台" description={`${currentMonth} 核算周期 · Supabase 实时数据`} />
    <QueryMessage loading={loading} error={error} />
    {!loading && !error ? <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard label="本月实发工资" value={formatCentsToYuan(monthNet)} />
        <StatCard label="工资核算进度" value={`${payroll.length - pendingReview}/${payroll.length}`} />
        <StatCard label="待审核工资" value={`${pendingReview} 条`} />
      </div>
      <Card className="mt-6"><CardHeader title="团队概览" /><CardContent className="text-sm text-slate-500">在职成员 {members.data?.filter((item) => item.status === "active").length ?? 0} / {members.data?.length ?? 0}</CardContent></Card>
    </> : null}
  </>;
}