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
import { formatCentsToYuan } from "@/lib/format";

type FormValues = { name: string; profileId: string; positionId: string; baseSalary: string; guaranteedSalary: string; effectiveFrom: string };
export default function SchemesPage() {
  const schemes = useSchemes(); const members = useMembers(); const positions = usePositions(); const create = useCreateScheme(); const [show, setShow] = useState(false); const { register, handleSubmit, reset } = useForm<FormValues>();
  async function submit(value: FormValues) { const version = Math.max(0, ...(schemes.data?.filter((item) => item.name === value.name).map((item) => item.version) ?? [])) + 1; await create.mutateAsync({ name: value.name, profile_id: value.profileId || null, position_id: value.positionId ? Number(value.positionId) : null, version, base_salary_cents: Math.round(Number(value.baseSalary) * 100), guaranteed_salary_cents: Math.round(Number(value.guaranteedSalary) * 100), effective_from: value.effectiveFrom }); reset(); setShow(false); }
  return <><PageHeader title="工资方案" description="个人方案优先；成员无个人方案时，按岗位回退使用「岗位模板」（不指定成员的方案）。基础提成率 20%；超过拿提点门槛的流水每满 1 万元，阶梯提点 +1 个百分点，阶梯提点最高 5%；最终提成率不封顶。" action={<Button onClick={() => setShow(!show)}>{show ? "收起" : "+ 新建方案"}</Button>} />{show ? <Card className="mb-6"><CardContent><form onSubmit={handleSubmit(submit)} className="grid gap-4 sm:grid-cols-2"><FormField label="方案名称"><Input required {...register("name")} /></FormField><FormField label="成员" hint="留空则作为「岗位模板」：该岗位下未配置个人方案的成员自动回退使用此模板。"><select className="w-full rounded-lg border p-2" {...register("profileId")}><option value="">（模板，不指定成员）</option>{members.data?.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></FormField><FormField label="职位"><select required className="w-full rounded-lg border p-2" {...register("positionId")}><option value="">请选择</option>{positions.data?.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></FormField><FormField label="初始保底（元）" hint="无责期及上月达标时的保底基准，示例 8000"><Input required type="number" {...register("baseSalary")} /></FormField><FormField label="降级保底（元）" hint="第 4 月起上月不达标时的保底基准，示例 5000"><Input required type="number" {...register("guaranteedSalary")} /></FormField><FormField label="生效日期"><Input required type="date" {...register("effectiveFrom")} /></FormField><Button type="submit" disabled={create.isPending}>保存</Button></form></CardContent></Card> : null}<QueryMessage loading={schemes.isLoading} error={schemes.error} empty={!schemes.data?.length} /><div className="space-y-4">{schemes.data?.map((item) => <Card key={item.id}><CardHeader title={<span>{item.name} <Badge>v{item.version}</Badge></span>} description={`${item.profile?.name ?? "岗位模板"} · ${item.position?.name ?? "未分配"} · ${item.effective_from}`} /><CardContent><p className="text-sm">初始保底 {formatCentsToYuan(item.base_salary_cents)} · 降级保底 {formatCentsToYuan(item.guaranteed_salary_cents)} · 基础提成 20% · 阶梯提点 0%~5% · 最终提成率不封顶</p></CardContent></Card>)}</div></>;
}
