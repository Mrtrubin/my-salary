"use client";

import { Suspense, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { QueryMessage } from "@/components/query-message";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import {
  useAddTeamMembers,
  useMembers,
  useRemoveTeamMember,
  useTeams,
} from "@/lib/api/hooks";

function hasAnchorPosition(member: { user_positions: { position: { code: string } | null }[] }) {
  return member.user_positions.some(({ position }) => position?.code === "anchor");
}

function TeamMembersInner() {
  const searchParams = useSearchParams();
  const teamId = searchParams.get("teamId") ?? "";
  const teams = useTeams();
  const members = useMembers();
  const addMembers = useAddTeamMembers();
  const removeMember = useRemoveTeamMember();

  const team = teams.data?.find((item) => item.id === teamId);
  const anchors = useMemo(
    () => members.data?.filter(hasAnchorPosition) ?? [],
    [members.data],
  );
  const availableAnchors = useMemo(
    () => anchors.filter((anchor) => !team?.members.some((member) => member.profile?.id === anchor.id)),
    [anchors, team?.members],
  );

  return (
    <Card>
      <CardHeader title="成员管理" description="管理团队主播关系；工资配置请前往主播管理" />
      <CardContent>
        <QueryMessage loading={teams.isLoading} error={teams.error} empty={!teams.isLoading && !team} />
        {team ? (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-3 border-b pb-4">
              <select
                defaultValue=""
                onChange={(event) => {
                  if (!event.target.value) return;
                  addMembers.mutate({ teamId, anchorProfileIds: [event.target.value] });
                  event.target.value = "";
                }}
                className="rounded border px-3 py-2 text-sm"
              >
                <option value="">+ 添加主播成员</option>
                {availableAnchors.map((anchor) => <option key={anchor.id} value={anchor.id}>{anchor.name}</option>)}
              </select>
              <span className="text-xs text-muted">当前成员 {team.members.length} 人</span>
            </div>
            <Table>
              <THead><TH isRowHeader>成员姓名</TH><TH>职位</TH><TH>操作</TH></THead>
              <TBody>
                {team.members.map(({ profile }) => profile ? (
                  <TR key={profile.id}>
                    <TD>{profile.name}</TD>
                    <TD>主播</TD>
                    <TD><Button variant="ghost" onClick={() => removeMember.mutate({ teamId, profileId: profile.id })}>移除</Button></TD>
                  </TR>
                ) : null)}
                {!team.members.length ? <TR><TD colSpan={3}>暂无成员，请从上方添加主播</TD></TR> : null}
              </TBody>
            </Table>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default function TeamMembersPage() {
  return <Suspense fallback={null}><TeamMembersInner /></Suspense>;
}