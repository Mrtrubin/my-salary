"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { QueryMessage } from "@/components/query-message";
import { FormField, Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/stat-card";
import { useCreateScheme, useMembers, usePositions, useSchemes } from "@/lib/api/hooks";
import { formatBpsAsPercent, formatCentsToYuan } from "@/lib/format";

type FormValues = { name: string; profileId: string; positionId: string; baseSalary: string; guaranteedSalary: string; commissionRate: string; effectiveFrom: string };
export default function SchemesPage() {
  const schemes = useSchemes(); const members = useMembers(); const positions = usePositions(); const create = useCreateScheme(); const [show, setShow] = useState(false); const { register, handleSubmit, reset } = useForm<FormValues>();
  async function submit(value: FormValues) { const version = Math.max(0, ...(schemes.data?.filter((item) => item.name === value.name).map((item) => item.version) ?? [])) + 1; await create.mutateAsync({ name: value.name, profile_id: value.profileId || null, position_id: value.positionId ? Number(value.positionId) : null, version, base_salary_cents: Math.round(Number(value.baseSalary) * 100), guaranteed_salary_cents: Math.round(Number(value.guaranteedSalary) * 100), commission_rate_bps: Math.round(Number(value.commissionRate) * 100), effective_from: value.effectiveFrom }); reset(); setShow(false); }
  return <><PageHeader title="工资方案" description="按成员与职位分配，版本数据持久化保存" action={<Button onClick={() => setShow(!show)}>{show ? "收起" : "+ 新建方案"}</Button>} />{show ? <Card className="mb-6"><CardContent><form onSubmit={handleSubmit(submit)} className="grid gap-4 sm:grid-cols-2"><FormField label="方案名称"><Input required {...register("name")} /></FormField><FormField label="成员"><select required className="w-full rounded-lg border p-2" {...register("profileId")}><option value="">请选择</option>{members.data?.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></FormField><FormField label="职位"><select required className="w-full rounded-lg border p-2" {...register("positionId")}><option value="">请选择</option>{positions.data?.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></FormField><FormField label="基本工资（元）"><Input required type="number" {...register("baseSalary")} /></FormField><FormField label="保底工资（元）"><Input required type="number" {...register("guaranteedSalary")} /></FormField><FormField label="绩效费率（%）"><Input required type="number" {...register("commissionRate")} /></FormField><FormField label="生效日期"><Input required type="date" {...register("effectiveFrom")} /></FormField><Button type="submit" disabled={create.isPending}>保存</Button></form></CardContent></Card> : null}<QueryMessage loading={schemes.isLoading} error={schemes.error} empty={!schemes.data?.length} /><div className="space-y-4">{schemes.data?.map((item) => <Card key={item.id}><CardHeader title={<span>{item.name} <Badge>v{item.version}</Badge></span>} description={`${item.profile?.name ?? "未分配"} · ${item.position?.name ?? "未分配"} · ${item.effective_from}`} /><CardContent><p className="text-sm">基本 {formatCentsToYuan(item.base_salary_cents)} · 保底 {formatCentsToYuan(item.guaranteed_salary_cents)} · 绩效 {formatBpsAsPercent(item.commission_rate_bps)}</p></CardContent></Card>)}</div></>;
}
