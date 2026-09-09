"use client";

import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { QueryMessage } from "@/components/query-message";
import { FormField, Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/stat-card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import {
  useAddTeamMembers,
  useCreateTeam,
  useDeleteTeam,
  useMembers,
  useRemoveTeamMember,
  useTeams,
} from "@/lib/api/hooks";

type FormValues = { name: string; hostProfileId: string };

function hasPosition(emp: { user_positions: { position: { code: string } | null }[] }, code: string) {
  return emp.user_positions.some(({ position }) => position?.code === code);
}

export default function TeamsPage() {
  const teams = useTeams();
  const members = useMembers();
  const create = useCreateTeam();
  const remove = useDeleteTeam();
  const addMembers = useAddTeamMembers();
  const removeMember = useRemoveTeamMember();
  const [show, setShow] = useState(false);
  const [selectedAnchors, setSelectedAnchors] = useState<string[]>([]);
  const { register, handleSubmit, reset } = useForm<FormValues>();

  const hosts = useMemo(() => members.data?.filter((e) => hasPosition(e, "host")) ?? [], [members.data]);
  const anchors = useMemo(() => members.data?.filter((e) => hasPosition(e, "anchor")) ?? [], [members.data]);
  const anchorName = (id: string) => members.data?.find((e) => e.id === id)?.name ?? id;

  async function submit(values: FormValues) {
    await create.mutateAsync({ name: values.name, hostProfileId: values.hostProfileId, anchorProfileIds: selectedAnchors });
    reset(); setSelectedAnchors([]); setShow(false);
  }

  return <><PageHeader title="团队管理" description="每个团队含 1 名主持人与若干主播；主持人可为本团队主播录入流水" action={<Button onClick={() => setShow(!show)}>{show ? "收起" : "+ 新建团队"}</Button>} />
    {show ? <Card className="mb-6"><CardHeader title="新建团队" /><CardContent><form onSubmit={handleSubmit(submit)} className="grid gap-4 sm:grid-cols-2">
      <FormField label="团队名称"><Input required {...register("name")} /></FormField>
      <FormField label="主持人"><select required {...register("hostProfileId")} className="w-full rounded border px-3 py-2 text-sm"><option value="">请选择主持人</option>{hosts.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}</select></FormField>
      <FormField label="主播成员"><div className="flex flex-wrap gap-2">{anchors.map((a) => <button type="button" key={a.id} onClick={() => setSelectedAnchors((old) => old.includes(a.id) ? old.filter((id) => id !== a.id) : [...old, a.id])} className={`rounded border px-3 py-1 text-xs ${selectedAnchors.includes(a.id) ? "border-indigo-600 text-indigo-700" : ""}`}>{a.name}</button>)}</div></FormField>
      <Button type="submit" disabled={create.isPending}>保存</Button>
    </form></CardContent></Card> : null}
    <Card><CardContent className="p-0"><QueryMessage loading={teams.isLoading} error={teams.error} empty={!teams.data?.length} />
      <Table><THead><TH isRowHeader>团队</TH><TH>主持人</TH><TH>主播成员</TH><TH>状态</TH><TH className="text-right">操作</TH></THead><TBody>{teams.data?.map((t) => <TR key={t.id}>
        <TD>{t.name}</TD>
        <TD>{t.host?.name ?? "-"}</TD>
        <TD><div className="flex flex-wrap gap-1">{t.members.map(({ profile }) => profile ? <Badge key={profile.id}><span className="mr-1">{profile.name}</span><button type="button" onClick={() => removeMember.mutate({ teamId: t.id, profileId: profile.id })} className="text-muted hover:text-foreground">×</button></Badge> : null)}{!t.members.length ? <span className="text-xs text-muted">暂无</span> : null}</div></TD>
        <TD>{t.status === "active" ? "启用" : "停用"}</TD>
        <TD className="text-right"><div className="flex justify-end gap-2">
          <select defaultValue="" onChange={(e) => { if (e.target.value) { addMembers.mutate({ teamId: t.id, anchorProfileIds: [e.target.value] }); e.target.value = ""; } }} className="rounded border px-2 py-1 text-xs"><option value="">+ 添加主播</option>{anchors.filter((a) => !t.members.some((m) => m.profile?.id === a.id)).map((a) => <option key={a.id} value={a.id}>{anchorName(a.id)}</option>)}</select>
          <Button variant="ghost" onClick={() => remove.mutate(t.id)}>删除</Button>
        </div></TD>
      </TR>)}</TBody></Table>
    </CardContent></Card></>;
}