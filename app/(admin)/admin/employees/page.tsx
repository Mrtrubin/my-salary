"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { QueryMessage } from "@/components/query-message";
import { FormField, Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/stat-card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useCreateEmployee, useEmployees, usePositions, useSetEmployeeStatus } from "@/lib/api/hooks";

type FormValues = { name: string; phone: string; hireDate: string };
export default function EmployeesPage() {
  const employees = useEmployees(); const positions = usePositions(); const create = useCreateEmployee(); const setStatus = useSetEmployeeStatus();
  const [show, setShow] = useState(false); const [selected, setSelected] = useState<number[]>([]); const { register, handleSubmit, reset } = useForm<FormValues>();
  async function submit(values: FormValues) { await create.mutateAsync({ ...values, positionIds: selected }); reset(); setSelected([]); setShow(false); }
  return <><PageHeader title="员工管理" description="员工资料存储于 Supabase；登录账号需在 Auth 中创建后关联 auth_user_id" action={<Button onClick={() => setShow(!show)}>{show ? "收起" : "+ 新增员工"}</Button>} />{show ? <Card className="mb-6"><CardHeader title="新增员工资料" /><CardContent><form onSubmit={handleSubmit(submit)} className="grid gap-4 sm:grid-cols-2"><FormField label="姓名"><Input required {...register("name")} /></FormField><FormField label="手机号"><Input required {...register("phone")} /></FormField><FormField label="入职日期"><Input type="date" required {...register("hireDate")} /></FormField><FormField label="职位"><div className="flex flex-wrap gap-2">{positions.data?.map((item) => <button type="button" key={item.id} onClick={() => setSelected((old) => old.includes(item.id) ? old.filter((id) => id !== item.id) : [...old, item.id])} className={`rounded border px-3 py-1 text-xs ${selected.includes(item.id) ? "border-indigo-600 text-indigo-700" : ""}`}>{item.name}</button>)}</div></FormField><Button type="submit" disabled={create.isPending}>保存</Button></form></CardContent></Card> : null}<Card><CardContent className="p-0"><QueryMessage loading={employees.isLoading} error={employees.error} empty={!employees.data?.length} /><Table><THead><TH isRowHeader>姓名</TH><TH>手机号</TH><TH>职位</TH><TH>入职日期</TH><TH>状态</TH><TH className="text-right">操作</TH></THead><TBody>{employees.data?.map((item) => <TR key={item.id}><TD>{item.name}</TD><TD>{item.phone}</TD><TD><div className="flex gap-1">{item.user_positions.map(({ position }) => position ? <Badge key={position.id}>{position.name}</Badge> : null)}</div></TD><TD>{item.hire_date}</TD><TD>{item.status === "active" ? "在职" : "已停用"}</TD><TD className="text-right"><Button variant="ghost" onClick={() => setStatus.mutate({ id: item.id, status: item.status === "active" ? "disabled" : "active" })}>{item.status === "active" ? "停用" : "启用"}</Button></TD></TR>)}</TBody></Table></CardContent></Card></>;
}
