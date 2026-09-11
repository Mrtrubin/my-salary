"use client";

import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { QueryMessage } from "@/components/query-message";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { FormField, Input } from "@/components/ui/input";
import { useAddTeamMembers, useCreateScheme, useMembers, usePositions, useRemoveTeamMember, useSchemes, useTeams } from "@/lib/api/hooks";
import { formatCentsToYuan } from "@/lib/format";
import type { SalaryScheme } from "@/lib/api/data";

function hasPosition(emp: { user_positions: { position: { code: string } | null }[] }, code: string) {
  return emp.user_positions.some(({ position }) => position?.code === code);
}

/** 取某主播当前生效的个人方案（profile_id 指向该主播的最新版本）。 */
function latestPersonalScheme(schemes: SalaryScheme[] | undefined, profileId: string): SalaryScheme | undefined {
  return schemes?.filter((s) => s.profile_id === profileId).sort((a, b) => b.version - a.version)[0];
}

/** 取「主播」岗位模板（profile_id 为空、position 为 anchor 的方案）。 */
function anchorTemplateScheme(schemes: SalaryScheme[] | undefined, anchorPositionId: number | undefined): SalaryScheme | undefined {
  if (!anchorPositionId) return undefined;
  return schemes?.filter((s) => s.profile_id == null && s.position_id === anchorPositionId).sort((a, b) => b.version - a.version)[0];
}

function TeamMembersInner() {
  const searchParams = useSearchParams();
  const teamId = searchParams.get("teamId") ?? "";
  const teams = useTeams();
  const members = useMembers();
  const positions = usePositions();
  const schemes = useSchemes();
  const addMembers = useAddTeamMembers();
  const removeMember = useRemoveTeamMember();
  const createScheme = useCreateScheme();

  const [editing, setEditing] = useState<{ profileId: string; name: string } | null>(null);
  const [baseSalary, setBaseSalary] = useState("");
  const [guaranteedSalary, setGuaranteedSalary] = useState("");

  const team = teams.data?.find((t) => t.id === teamId);
  const anchors = useMemo(() => members.data?.filter((e) => hasPosition(e, "anchor")) ?? [], [members.data]);
  const availableAnchors = useMemo(
    () => anchors.filter((a) => !team?.members.some((m) => m.profile?.id === a.id)),
    [anchors, team?.members],
  );

  const anchorPositionId = positions.data?.find((p) => p.code === "anchor")?.id;
  const template = anchorTemplateScheme(schemes.data, anchorPositionId);

  function openEditor(profileId: string, name: string) {
    const personal = latestPersonalScheme(schemes.data, profileId);
    const fallback = personal ?? template;
    setEditing({ profileId, name });
    setBaseSalary(fallback ? String(Math.round(fallback.base_salary_cents / 100)) : "");
    setGuaranteedSalary(fallback ? String(Math.round(fallback.guaranteed_salary_cents / 100)) : "");
  }

  async function submit() {
    if (!editing || !anchorPositionId) return;
    const base = Number(baseSalary);
    const guaranteed = Number(guaranteedSalary);
    if (!Number.isFinite(base) || !Number.isFinite(guaranteed) || base <= 0 || guaranteed <= 0) return;
    const existing = schemes.data?.filter((s) => s.profile_id === editing.profileId) ?? [];
    const version = Math.max(0, ...existing.map((s) => s.version)) + 1;
    await createScheme.mutateAsync({
      name: `${editing.name}个人方案`,
      profile_id: editing.profileId,
      position_id: anchorPositionId,
      version,
      base_salary_cents: Math.round(base * 100),
      guaranteed_salary_cents: Math.round(guaranteed * 100),
      effective_from: new Date().toISOString().slice(0, 10),
    });
    setEditing(null);
    setBaseSalary("");
    setGuaranteedSalary("");
  }

  return (
    <Card>
      <CardHeader title="成员管理" description="展示团队主播成员，可添加或移除成员，并为每个主播单独设置初始保底" />
      <CardContent>
        <QueryMessage loading={teams.isLoading} error={teams.error} empty={!teams.isLoading && !team} />
        {team ? (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-3 border-b pb-4">
              <select
                defaultValue=""
                onChange={(e) => { if (e.target.value) { addMembers.mutate({ teamId, anchorProfileIds: [e.target.value] }); e.target.value = ""; } }}
                className="rounded border px-3 py-2 text-sm"
              >
                <option value="">+ 添加主播成员</option>
                {availableAnchors.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
              <span className="text-xs text-muted">当前成员 {team.members.length} 人</span>
            </div>
            <Table>
              <THead><TH isRowHeader>成员姓名</TH><TH>职位</TH><TH>初始保底</TH><TH className="text-left">操作</TH></THead>
              <TBody>
                {team.members.map(({ profile }) => {
                  if (!profile) return null;
                  const personal = latestPersonalScheme(schemes.data, profile.id);
                  const effective = personal ?? template;
                  return (
                    <TR key={profile.id}>
                      <TD>{profile.name}</TD>
                      <TD>主播</TD>
                      <TD>
                        {effective ? formatCentsToYuan(effective.base_salary_cents) : "—"}
                        {personal ? "" : <span className="ml-1 text-xs text-muted">（岗位模板）</span>}
                      </TD>
                      <TD className="text-left">
                        <Button variant="ghost" onClick={() => openEditor(profile.id, profile.name)}>设置保底</Button>
                        <Button variant="ghost" onClick={() => removeMember.mutate({ teamId, profileId: profile.id })}>移除</Button>
                      </TD>
                    </TR>
                  );
                })}
                {!team.members.length ? (
                  <TR><TD className="text-sm text-muted">暂无成员，请从上方添加主播</TD><TD /><TD /><TD /></TR>
                ) : null}
              </TBody>
            </Table>
          </>
        ) : null}

        {editing ? (
          <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40" onClick={() => setEditing(null)}>
            <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
              <h3 className="mb-4 text-base font-semibold">设置初始保底 · {editing.name}</h3>
              <div className="grid gap-4">
                <FormField label="初始保底（元）" hint="无责期及上月达标时的保底基准，示例 8000">
                  <Input required type="number" value={baseSalary} onChange={(e) => setBaseSalary(e.target.value)} />
                </FormField>
                <FormField label="降级保底（元）" hint="第 4 月起上月不达标时的保底基准，示例 5000">
                  <Input required type="number" value={guaranteedSalary} onChange={(e) => setGuaranteedSalary(e.target.value)} />
                </FormField>
              </div>
              <div className="mt-6 flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setEditing(null)}>取消</Button>
                <Button onClick={submit} disabled={createScheme.isPending}>保存</Button>
              </div>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default function TeamMembersPage() {
  return (
    <Suspense fallback={null}>
      <TeamMembersInner />
    </Suspense>
  );
}