"use client";

import { Suspense, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { QueryMessage } from "@/components/query-message";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useAddTeamMembers, useMembers, useRemoveTeamMember, useTeams } from "@/lib/api/hooks";

function hasPosition(emp: { user_positions: { position: { code: string } | null }[] }, code: string) {
  return emp.user_positions.some(({ position }) => position?.code === code);
}

function TeamMembersInner() {
  const searchParams = useSearchParams();
  const teamId = searchParams.get("teamId") ?? "";
  const teams = useTeams();
  const members = useMembers();
  const addMembers = useAddTeamMembers();
  const removeMember = useRemoveTeamMember();

  const team = teams.data?.find((t) => t.id === teamId);
  const anchors = useMemo(() => members.data?.filter((e) => hasPosition(e, "anchor")) ?? [], [members.data]);
  const availableAnchors = useMemo(
    () => anchors.filter((a) => !team?.members.some((m) => m.profile?.id === a.id)),
    [anchors, team?.members],
  );

  return (
    <Card>
      <CardHeader title="成员管理" description="展示团队主播成员，可添加或移除成员" />
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
              <THead><TH isRowHeader>成员姓名</TH><TH>职位</TH><TH className="text-right">操作</TH></THead>
              <TBody>
                {team.members.map(({ profile }) => profile ? (
                  <TR key={profile.id}>
                    <TD>{profile.name}</TD>
                    <TD>主播</TD>
                    <TD className="text-right">
                      <Button variant="ghost" onClick={() => removeMember.mutate({ teamId, profileId: profile.id })}>移除</Button>
                    </TD>
                  </TR>
                ) : null)}
             {!team.members.length ? (
                <TR><TD className="text-sm text-muted">暂无成员，请从上方添加主播</TD><TD /><TD /></TR>
                ) : null}
              </TBody>
            </Table>
          </>
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