"use client";

import { useMemo, useState } from "react";
import { SalaryRecordStatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { QueryMessage } from "@/components/query-message";
import { PageHeader } from "@/components/ui/stat-card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useEmployees, useSalaryRecords, useSchemes, useUpdateSalaryStatus } from "@/lib/api/hooks";
import type { SalaryRecordStatus } from "@/lib/api/data";
import { calculateAnchorPayroll } from "@/lib/domain/payroll/anchor";
import { formatCentsToYuan, formatMonth } from "@/lib/format";

const next: Partial<Record<SalaryRecordStatus, SalaryRecordStatus>> = { draft: "confirmed", confirmed: "published" };
export default function PayrollPage() {
  const salary = useSalaryRecords(); const employees = useEmployees(); const schemes = useSchemes(); const update = useUpdateSalaryStatus();
  const [employeeId, setEmployeeId] = useState(""); const [revenue, setRevenue] = useState(0);
  const employee = employees.data?.find((item) => item.id === employeeId) ?? employees.data?.[0];
  const scheme = schemes.data?.find((item) => item.profile_id === employee?.id && item.status === "active");
  const tenure = employee ? Math.max(1, (new Date().getFullYear() - Number(employee.hire_date.slice(0, 4))) * 12 + new Date().getMonth() - Number(employee.hire_date.slice(5, 7)) + 2) : 1;
  const preview = useMemo(() => scheme ? calculateAnchorPayroll({ scheme: { baseSalaryInCents: scheme.base_salary_cents, guaranteedSalaryInCents: scheme.guaranteed_salary_cents, thresholdMultiplierBps: scheme.threshold_multiplier_bps, commissionRateBps: scheme.commission_rate_bps }, monthlyRevenueInCents: Math.round(revenue * 100), tenureMonth: tenure }) : null, [scheme, revenue, tenure]);
  return <><PageHeader title="工资核算" description="正式记录来自 Supabase，已发布工资条展示持久化快照" /><div className="grid gap-6 xl:grid-cols-[1fr_360px]"><Card><CardHeader title="核算记录" /><CardContent className="p-0"><QueryMessage loading={salary.isLoading} error={salary.error} empty={!salary.data?.length} /><Table><THead><TH isRowHeader>员工</TH><TH>月份</TH><TH className="text-right">总工资</TH><TH className="text-right">实发</TH><TH>状态</TH><TH className="text-right">操作</TH></THead><TBody>{salary.data?.map((item) => <TR key={item.id}><TD>{item.profile?.name ?? "未关联"}</TD><TD>{formatMonth(item.month.slice(0, 7))}</TD><TD className="text-right">{formatCentsToYuan(item.gross_cents)}</TD><TD className="text-right">{formatCentsToYuan(item.net_cents)}</TD><TD><SalaryRecordStatusBadge status={item.status} /></TD><TD className="text-right"><span className="flex justify-end gap-1">{next[item.status] ? <Button variant="secondary" onClick={() => { const status = next[item.status]; if (status && status !== "draft") update.mutate({ id: item.id, status }); }}>{item.status === "draft" ? "确认" : "发布"}</Button> : null}{(item.status === "confirmed" || item.status === "published") ? <Button variant="ghost" onClick={() => update.mutate({ id: item.id, status: "voided" })}>冲正</Button> : null}</span></TD></TR>)}</TBody></Table></CardContent></Card><Card><CardHeader title="工资试算" description="试算不写入正式工资记录" /><CardContent className="space-y-3"><select value={employee?.id ?? ""} onChange={(event) => setEmployeeId(event.target.value)} className="w-full rounded-lg border p-2">{employees.data?.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><input type="number" value={revenue} onChange={(event) => setRevenue(Number(event.target.value) || 0)} className="w-full rounded-lg border p-2" placeholder="当月流水（元）" />{preview ? <div className="rounded-lg bg-slate-50 p-3 text-sm"><p>总工资：{formatCentsToYuan(preview.grossSalaryInCents)}</p><p>服务费：{formatCentsToYuan(preview.serviceFeeInCents)}</p><p className="font-semibold">实发：{formatCentsToYuan(preview.netSalaryInCents)}</p></div> : <p className="text-xs text-amber-700">该员工暂无生效方案</p>}</CardContent></Card></div></>;
}
