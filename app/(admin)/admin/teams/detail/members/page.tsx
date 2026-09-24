"use client";

import { Alert, Button, Card, Divider, Flex, Select, Table, Typography } from "antd";
import { useSearchParams } from "next/navigation";
import { Suspense, useMemo } from "react";
import { QueryMessage } from "@/components/admin/query-message";
import { zebraRowClassName } from "@/components/admin/table-zebra";
import { useConfirm } from "@/components/admin/use-confirm";
import {
  useAddTeamMembers,
  useMembers,
  useRemoveTeamMember,
  useTeams,
  useUpdateTeam,
} from "@/lib/api/hooks";

function hasAnchorPosition(member: { user_positions: { position: { code: string } | null }[] }) {
  return member.user_positions.some(({ position }) => position?.code === "anchor");
}

function hasHostPosition(member: { user_positions: { position: { code: string } | null }[] }) {
  return member.user_positions.some(({ position }) => position?.code === "host");
}

function TeamMembersInner() {
  const confirm = useConfirm();
  const searchParams = useSearchParams();
  const teamId = searchParams.get("teamId") ?? "";
  const teams = useTeams();
  const members = useMembers();
  const addMembers = useAddTeamMembers();
  const removeMember = useRemoveTeamMember();
  const updateTeam = useUpdateTeam();

  const team = teams.data?.find((item) => item.id === teamId);
  const anchors = useMemo(() => members.data?.filter(hasAnchorPosition) ?? [], [members.data]);
  const hosts = useMemo(() => members.data?.filter(hasHostPosition) ?? [], [members.data]);
  const availableAnchors = useMemo(
    () => anchors.filter((anchor) => !team?.members.some((member) => member.profile?.id === anchor.id)),
    [anchors, team?.members],
  );
  // 成员关联可能因外键失效而拿到空 profile，过滤掉并给出行级稳定 key。
  const rows = useMemo(
    () =>
      (team?.members ?? []).flatMap(({ profile }) =>
        profile ? [{ key: profile.id, id: profile.id, name: profile.name }] : [],
      ),
    [team?.members],
  );

  /** 移除成员会立即写库，加一道确认，与其它页面的破坏性操作口径一致。 */
  async function removeMemberFromTeam(profileId: string, name: string) {
    const ok = await confirm({
      title: "确认移除成员",
      content: `确认将「${name}」移出该团队？移除后需重新添加。`,
      okText: "确认移除",
      okButtonProps: { danger: true },
    });
    if (!ok) return;
    removeMember.mutate({ teamId, profileId });
  }

  return (
    <Card
      title="成员管理"
      extra={<Typography.Text type="secondary">工资配置请前往主播管理</Typography.Text>}
      loading={teams.isLoading}
    >
      {/* 查询失败与「团队不存在」是两回事，不能都显示成「未找到该团队」 */}
      {teams.error ? (
        <QueryMessage loading={false} error={teams.error} />
      ) : !teams.isLoading && !team ? (
        <Typography.Text type="secondary">未找到该团队，请从团队列表重新进入。</Typography.Text>
      ) : null}

      {members.error ? (
        <Alert
          type="warning"
          showIcon
          title="成员列表加载失败，下方下拉选项可能不完整"
          style={{ marginBottom: 16 }}
        />
      ) : null}

      {team && !teams.error ? (
        <>
          <Flex align="center" gap={12} wrap>
            <Select
              style={{ minWidth: 240 }}
              placeholder="+ 添加主播成员"
              value={null}
              loading={addMembers.isPending}
              onChange={(profileId: string) =>
                addMembers.mutate({ teamId, anchorProfileIds: [profileId] })
              }
              options={availableAnchors.map((anchor) => ({
                value: anchor.id,
                label: anchor.name,
              }))}
            />
            <Typography.Text type="secondary">当前成员 {rows.length} 人</Typography.Text>
          </Flex>

          <Divider />

          <Flex align="center" gap={12} wrap style={{ marginBottom: 16 }}>
            <Typography.Text strong>主持人</Typography.Text>
            <Select
              style={{ minWidth: 200 }}
              value={team.host_profile_id}
              loading={updateTeam.isPending}
              onChange={(hostProfileId: string) => {
                if (!hostProfileId || hostProfileId === team.host_profile_id) return;
                updateTeam.mutate({ id: teamId, hostProfileId });
              }}
              options={hosts.map((host) => ({ value: host.id, label: host.name }))}
            />
            {updateTeam.isPending ? <Typography.Text type="secondary">保存中…</Typography.Text> : null}
            {updateTeam.error ? (
              <Typography.Text type="danger">
                修改失败：
                {updateTeam.error instanceof Error ? updateTeam.error.message : "请稍后重试"}
              </Typography.Text>
            ) : null}
          </Flex>

          <Table
            rowClassName={zebraRowClassName}
            rowKey="key"
            dataSource={rows}
            pagination={false}
            locale={{ emptyText: "暂无成员，请从上方添加主播" }}
            columns={[
              { title: "成员姓名", dataIndex: "name" },
              { title: "职位", width: 120, render: () => "主播" },
              {
                title: "操作",
                width: 120,
                render: (_, record) => (
                  <Button
                    type="link"
                    danger
                    size="small"
                    loading={
                      removeMember.isPending && removeMember.variables?.profileId === record.id
                    }
                    onClick={() => removeMemberFromTeam(record.id, record.name)}
                  >
                    移除
                  </Button>
                ),
              },
            ]}
          />
        </>
      ) : null}
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
