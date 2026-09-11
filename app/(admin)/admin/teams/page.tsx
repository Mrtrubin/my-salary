"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { QueryMessage } from "@/components/query-message";
import { FormField, Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/stat-card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useCreateTeam, useDeleteTeam, useMembers, useTeams } from "@/lib/api/hooks";

type FormValues = { name: string; hostProfileId: string };

function hasPosition(emp: { user_positions: { position: { code: string } | null }[] }, code: string) {
  return emp.user_positions.some(({ position }) => position?.code === code);
}

export default function TeamsPage() {
  const teams = useTeams();
  const members = useMembers();
  const create = useCreateTeam();
  const remove = useDeleteTeam();
  const [show, setShow] = useState(false);
  const [selectedAnchors, setSelectedAnchors] = useState<string[]>([]);
  const { register, handleSubmit, reset } = useForm<FormValues>();

  const hosts = useMemo(() => members.data?.filter((e) => hasPosition(e, "host")) ?? [], [members.data]);
  const anchors = useMemo(() => members.data?.filter((e) => hasPosition(e, "anchor")) ?? [], [members.data]);

  async function submit(values: FormValues) {
    await create.mutateAsync({ name: values.name, hostProfileId: values.hostProfileId, anchorProfileIds: selectedAnchors });
    reset(); setSelectedAnchors([]); setShow(false);
  }

  return <><PageHeader title="团队管理" description="每个团队含 1 名主持人与若干主播；点击团队进入详情，可分别管理成员与绩效" action={<Button onClick={() => setShow(!show)}>{show ? "收起" : "+ 新建团队"}</Button>} />
    {show ? <Card className="mb-6"><CardHeader title="新建团队" /><CardContent><form onSubmit={handleSubmit(submit)} className="grid gap-4 sm:grid-cols-2">
      <FormField label="团队名称"><Input required {...register("name")} /></FormField>
      <FormField label="主持人"><select required {...register("hostProfileId")} className="w-full rounded border px-3 py-2 text-sm"><option value="">请选择主持人</option>{hosts.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}</select></FormField>
      <FormField label="主播成员"><div className="flex flex-wrap gap-2">{anchors.map((a) => <button type="button" key={a.id} onClick={() => setSelectedAnchors((old) => old.includes(a.id) ? old.filter((id) => id !== a.id) : [...old, a.id])} className={`rounded border px-3 py-1 text-xs ${selectedAnchors.includes(a.id) ? "border-indigo-600 text-indigo-700" : ""}`}>{a.name}</button>)}</div></FormField>
      <Button type="submit" disabled={create.isPending}>保存</Button>
    </form></CardContent></Card> : null}
    <Card><CardContent className="p-0"><QueryMessage loading={teams.isLoading} error={teams.error} empty={!teams.data?.length} />
      <Table><THead><TH isRowHeader>团队</TH><TH>主持人</TH><TH>主播成员数</TH><TH>绩效点数</TH><TH className="text-left">操作</TH></THead><TBody>{teams.data?.map((t) => <TR key={t.id}>
        <TD><Link href={`/admin/teams/detail/members?teamId=${t.id}`} className="font-medium text-accent hover:underline">{t.name}</Link></TD>
        <TD>{t.host?.name ?? "-"}</TD>
        <TD>{t.members.length}</TD>
        <TD>{t.points.length}</TD>
        <TD className="text-left"><div className="flex justify-start gap-2">
          <Link href={`/admin/teams/detail/members?teamId=${t.id}`} className="rounded px-3 py-1.5 text-sm text-accent hover:bg-accent-soft">成员管理</Link>
          <Link href={`/admin/teams/detail/points?teamId=${t.id}`} className="rounded px-3 py-1.5 text-sm text-accent hover:bg-accent-soft">绩效管理</Link>
          <Button variant="ghost" onClick={() => remove.mutate(t.id)}>删除</Button>
        </div></TD>
      </TR>)}</TBody></Table>
    </CardContent></Card></>;
}