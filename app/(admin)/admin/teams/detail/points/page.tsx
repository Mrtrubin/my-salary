"use client";

import { Alert, Button, Card, Flex, Select, Table, Typography } from "antd";
import { useSearchParams } from "next/navigation";
import { Suspense, useMemo } from "react";
import { QueryMessage } from "@/components/admin/query-message";
import { zebraRowClassName } from "@/components/admin/table-zebra";
import { useConfirm } from "@/components/admin/use-confirm";
import {
  useAddTeamPerformancePoint,
  usePerformancePoints,
  useRemoveTeamPerformancePoint,
  useTeams,
} from "@/lib/api/hooks";

function TeamPointsInner() {
  const confirm = useConfirm();
  const searchParams = useSearchParams();
  const teamId = searchParams.get("teamId") ?? "";
  const teams = useTeams();
  const perfPoints = usePerformancePoints();
  const addPoint = useAddTeamPerformancePoint();
  const removePoint = useRemoveTeamPerformancePoint();

  const team = teams.data?.find((t) => t.id === teamId);
  const availablePoints = useMemo(
    () =>
      perfPoints.data?.filter(
        (p) => p.status === "active" && !team?.points.some((tp) => tp.point?.id === p.id),
      ) ?? [],
    [perfPoints.data, team?.points],
  );
  // 关联记录可能因外键失效而拿到空 point，这里过滤掉并给出行级稳定 key。
  const linkedPoints = useMemo(
    () =>
      (team?.points ?? []).flatMap(({ point }) =>
        point ? [{ key: point.id, id: point.id, name: point.name, pointsPerYuan: point.points_per_yuan }] : [],
      ),
    [team?.points],
  );

  /** 移除绩效点会立即写库，加一道确认。 */
  async function removeTeamPoint(pointId: string, name: string) {
    const ok = await confirm({
      title: "确认移除绩效点",
      content: `确认将「${name}」从该团队移除？移除后该团队无法再录入这个绩效点的流水。`,
      okText: "确认移除",
      okButtonProps: { danger: true },
    });
    if (!ok) return;
    removePoint.mutate({ teamId, pointId });
  }

  return (
    <Card
      title="绩效管理"
      extra={
        <Typography.Text type="secondary">
          换算率含义：N 绩效点 = 1 元
        </Typography.Text>
      }
      loading={teams.isLoading}
    >
      {/* 查询失败与「团队不存在」是两回事，不能都显示成「未找到该团队」 */}
      {teams.error ? (
        <QueryMessage loading={false} error={teams.error} />
      ) : !teams.isLoading && !team ? (
        <Typography.Text type="secondary">未找到该团队，请从团队列表重新进入。</Typography.Text>
      ) : null}

      {perfPoints.error ? (
        <Alert
          type="warning"
          showIcon
          title="绩效点字典加载失败，下方下拉选项可能不完整"
          style={{ marginBottom: 16 }}
        />
      ) : null}

      {team && !teams.error ? (
        <>
          <Flex align="center" gap={12} wrap style={{ marginBottom: 16 }}>
            <Select
              style={{ minWidth: 300 }}
              placeholder="+ 设置绩效点"
              value={null}
              loading={addPoint.isPending}
              onChange={(pointId: string) => addPoint.mutate({ teamId, pointId })}
              options={availablePoints.map((p) => ({
                value: p.id,
                label: `${p.name}（${p.points_per_yuan} 绩效点 = 1 元）`,
              }))}
            />
            <Typography.Text type="secondary">已关联 {linkedPoints.length} 项</Typography.Text>
          </Flex>

          <Table
            rowClassName={zebraRowClassName}
            rowKey="key"
            dataSource={linkedPoints}
            pagination={false}
            locale={{ emptyText: "暂无绩效点，请从上方设置" }}
            columns={[
              { title: "绩效点名称", dataIndex: "name" },
              {
                title: "换算率",
                dataIndex: "pointsPerYuan",
                render: (value: number) => `${value} 绩效点 = 1 元`,
              },
              {
                title: "操作",
                width: 120,
                render: (_, record) => (
                  <Button
                    type="link"
                    danger
                    size="small"
                    loading={removePoint.isPending && removePoint.variables?.pointId === record.id}
                    onClick={() => removeTeamPoint(record.id, record.name)}
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

export default function TeamPointsPage() {
  return (
    <Suspense fallback={null}>
      <TeamPointsInner />
    </Suspense>
  );
}
