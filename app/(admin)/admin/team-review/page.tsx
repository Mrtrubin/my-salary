"use client";

import { App, Button, Card, Flex, Input, Modal, Select, Typography } from "antd";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/admin/page-header";
import { QueryMessage } from "@/components/admin/query-message";
import { ResizableTable } from "@/components/admin/resizable-table";
import { zebraRowClassName } from "@/components/admin/table-zebra";
import { TimeRangeFilter } from "@/components/admin/time-range-filter";
import { useDeleteTeamPerformanceRecord, useMembers, useTeamPerformance, useTeams } from "@/lib/api/hooks";
import type { Member, TeamPerformanceRow } from "@/lib/api/data";
import type { PeriodRange } from "@/lib/domain/settlement/cycle";
import { buildRevenueRecordFields, formatAdjustmentItems } from "@/lib/domain/performance/recordView";
import { formatCentsToYuan, formatDate } from "@/lib/format";

function toHours(minutes: number): string {
  if (!minutes) return "0";
  const h = minutes / 60;
  return Number.isInteger(h) ? String(h) : h.toFixed(1);
}

function signedCents(cents: number): string {
  return `${cents > 0 ? "+" : ""}${formatCentsToYuan(cents)}`;
}

function hasRole(member: Member, code: string): boolean {
  return member.user_roles.some(({ role }) => role?.code === code);
}

export default function TeamReviewPage() {
  const { message } = App.useApp();
  const [range, setRange] = useState<PeriodRange | null>(null);
  const [keyword, setKeyword] = useState("");
  const [teamIds, setTeamIds] = useState<string[]>([]);
  const [hostIds, setHostIds] = useState<string[]>([]);
  const [anchorIds, setAnchorIds] = useState<string[]>([]);
  const [detail, setDetail] = useState<TeamPerformanceRow | null>(null);
  const [deleting, setDeleting] = useState<TeamPerformanceRow | null>(null);
  const [confirmName, setConfirmName] = useState("");

  const query = useTeamPerformance({
    start: range?.start,
    end: range?.end,
  });
  const teamsQuery = useTeams();
  const membersQuery = useMembers();
  const removeMutation = useDeleteTeamPerformanceRecord();

  const teamOptions = useMemo(
    () => (teamsQuery.data ?? [])
      .filter((team) => team.status === "active")
      .map((team) => ({ value: team.id, label: team.name })),
    [teamsQuery.data],
  );
  const hostOptions = useMemo(
    () => (membersQuery.data ?? [])
      .filter((member) => member.status === "active" && hasRole(member, "host"))
      .map((member) => ({ value: member.id, label: member.name })),
    [membersQuery.data],
  );
  const anchorOptions = useMemo(
    () => (membersQuery.data ?? [])
      .filter((member) => member.status === "active" && hasRole(member, "anchor"))
      .map((member) => ({ value: member.id, label: member.name })),
    [membersQuery.data],
  );

  const filtered = useMemo(() => {
    const records = query.data ?? [];
    const kw = keyword.trim().toLowerCase();
    return records.filter((item) => {
      if (teamIds.length && !teamIds.includes(item.team_id)) return false;
      if (hostIds.length && !hostIds.includes(item.host_profile_id ?? "")) return false;
      if (anchorIds.length && !anchorIds.includes(item.profile_id)) return false;
      if (!kw) return true;
      const names = `${item.profile?.name ?? ""} ${item.team?.name ?? ""} ${item.host?.name ?? ""}`.toLowerCase();
      return names.includes(kw);
    });
  }, [query.data, keyword, teamIds, hostIds, anchorIds]);

  const hasFilter = Boolean(keyword || range || teamIds.length || hostIds.length || anchorIds.length);

  function resetFilters() {
    setKeyword("");
    setRange(null);
    setTeamIds([]);
    setHostIds([]);
    setAnchorIds([]);
  }

  function openDelete(record: TeamPerformanceRow) {
    setConfirmName("");
    setDeleting(record);
  }

  const requiredName = deleting?.profile?.name ?? "";
  const canDelete = requiredName.length > 0 && confirmName.trim() === requiredName;

  async function confirmDelete() {
    if (!deleting || !canDelete) return;
    try {
      await removeMutation.mutateAsync(deleting.id);
      message.success("已删除该流水记录，并通知上传主持");
      setDeleting(null);
      setConfirmName("");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "删除失败，请稍后重试");
    }
  }

  return (
    <>
      <PageHeader
        title="流水记录"
        description="团队每日流水明细，重复提交同一（日期 + 成员 + 团队）将直接更新原记录"
      />
      <Card
        title="流水记录"
        extra={
          <Flex align="center" gap={12} wrap>
            <TimeRangeFilter allowAll value={range} onChange={setRange} />
            <Select
              allowClear
              showSearch
              mode="multiple"
              optionFilterProp="label"
              maxTagCount="responsive"
              style={{ width: 240 }}
              placeholder="团队"
              value={teamIds}
              onChange={setTeamIds}
              options={teamOptions}
            />
            <Select
              allowClear
              showSearch
              mode="multiple"
              optionFilterProp="label"
              maxTagCount="responsive"
              style={{ width: 240 }}
              placeholder="主持"
              value={hostIds}
              onChange={setHostIds}
              options={hostOptions}
            />
            <Select
              allowClear
              showSearch
              mode="multiple"
              optionFilterProp="label"
              maxTagCount="responsive"
              style={{ width: 240 }}
              placeholder="主播"
              value={anchorIds}
              onChange={setAnchorIds}
              options={anchorOptions}
            />
            <Input.Search
              allowClear
              style={{ width: 220 }}
              placeholder="搜索团队 / 主持 / 主播"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
            />
            {hasFilter ? (
              <Button onClick={resetFilters}>重置</Button>
            ) : null}
          </Flex>
        }
      >
        {query.error ? (
          <QueryMessage loading={false} error={query.error} />
        ) : (
          <ResizableTable<TeamPerformanceRow>
            rowClassName={zebraRowClassName}
            rowKey="id"
            loading={query.isLoading}
            dataSource={filtered}
            locale={{ emptyText: "暂无流水记录" }}
            onRow={(record) => ({
              onClick: () => setDetail(record),
              style: { cursor: "pointer" },
            })}
            columns={[
              {
                title: "绩效日期",
                dataIndex: "perf_date",
                fixed: "left",
                width: 120,
                render: (value: string) => formatDate(value),
              },
              {
                title: "团队",
                key: "team",
                width: 150,
                sortValue: (record) => record.team?.name,
                render: (_, record) => record.team?.name ?? "—",
              },
              {
                title: "成员",
                key: "profile",
                width: 130,
                sortValue: (record) => record.profile?.name,
                render: (_, record) => record.profile?.name ?? "—",
              },
              {
                title: "主持",
                key: "host",
                width: 130,
                sortValue: (record) => record.host?.name,
                render: (_, record) => record.host?.name ?? "—",
              },
              {
                title: "绩效点",
                key: "point",
                width: 150,
                sortValue: (record) => (record.no_perf ? record.no_perf_note || "休息" : record.point?.name),
                render: (_, record) =>
                  record.no_perf ? (
                    <Typography.Text type="warning">{record.no_perf_note || "休息"}</Typography.Text>
                  ) : (
                    (record.point?.name ?? "—")
                  ),
              },
              {
                title: "开播时长",
                key: "broadcast_minutes",
                align: "right",
                width: 110,
                sortValue: (record) => record.broadcast_minutes,
                render: (_, record) => toHours(record.broadcast_minutes),
              },
              {
                title: "业绩",
                key: "points_amount",
                align: "right",
                width: 130,
                sortValue: (record) => record.points_amount,
                render: (_, record) =>
                  record.no_perf ? "—" : record.points_amount.toLocaleString(),
              },
              {
                title: "当日流水",
                key: "revenue",
                width: 130,
                align: "right",
                sortValue: (record) => record.revenue_cents - record.adjustment_cents,
                render: (_, record) => formatCentsToYuan(record.revenue_cents - record.adjustment_cents),
              },
              {
                title: "总调整项",
                key: "adjustment",
                width: 130,
                align: "right",
                sortValue: (record) => record.adjustment_cents,
                render: (_, record) =>
                  record.adjustment_cents === 0 ? (
                    "—"
                  ) : (
                    <span style={{ color: record.adjustment_cents < 0 ? "#cf1322" : "#389e0d" }}>
                      {signedCents(record.adjustment_cents)}
                    </span>
                  ),
              },
              {
                title: "调整项明细",
                key: "adjustment_items",
                width: 200,
                sortValue: (record) => formatAdjustmentItems(record.adjustments),
                render: (_, record) => formatAdjustmentItems(record.adjustments) || "—",
              },
              {
                title: "当日最终流水",
                key: "final_revenue",
                width: 140,
                align: "right",
                sortValue: (record) => record.revenue_cents,
                render: (_, record) => formatCentsToYuan(record.revenue_cents),
              },
              {
                title: "操作",
                key: "action",
                width: 90,
                fixed: "right",
                render: (_, record) => (
                  <Button
                    danger
                    type="link"
                    size="small"
                    onClick={(event) => {
                      event.stopPropagation();
                      openDelete(record);
                    }}
                  >
                    删除
                  </Button>
                ),
              },
            ]}
          />
        )}
      </Card>

      <Modal
        open={!!detail}
        title="流水详情"
        footer={null}
        onCancel={() => setDetail(null)}
        destroyOnHidden
      >
        {detail ? (
          <div style={{ display: "grid", gap: 8 }}>
            {buildRevenueRecordFields(detail).map((field) => (
              <Flex key={field.label} justify="space-between" gap={16}>
                <Typography.Text type="secondary">{field.label}</Typography.Text>
                <Typography.Text style={{ fontVariantNumeric: "tabular-nums" }}>
                  {field.value}
                </Typography.Text>
              </Flex>
            ))}
          </div>
        ) : null}
      </Modal>

      <Modal
        open={!!deleting}
        title="删除流水记录"
        okText="确认删除"
        okButtonProps={{ danger: true, disabled: !canDelete }}
        confirmLoading={removeMutation.isPending}
        onOk={confirmDelete}
        onCancel={() => {
          setDeleting(null);
          setConfirmName("");
        }}
        destroyOnHidden
      >
        {deleting ? (
          <div style={{ display: "grid", gap: 12 }}>
            <Typography.Text>
              即将删除以下流水记录，删除后不可恢复，并会通知上传主持：
            </Typography.Text>
            <div style={{ display: "grid", gap: 4 }}>
              <Flex justify="space-between" gap={16}>
                <Typography.Text type="secondary">团队</Typography.Text>
                <Typography.Text>{deleting.team?.name ?? "—"}</Typography.Text>
              </Flex>
              <Flex justify="space-between" gap={16}>
                <Typography.Text type="secondary">日期</Typography.Text>
                <Typography.Text>{formatDate(deleting.perf_date)}</Typography.Text>
              </Flex>
              <Flex justify="space-between" gap={16}>
                <Typography.Text type="secondary">成员</Typography.Text>
                <Typography.Text>{deleting.profile?.name ?? "—"}</Typography.Text>
              </Flex>
            </div>
            <div>
              <Typography.Text type="secondary">
                请输入成员姓名「{requiredName}」以确认删除
              </Typography.Text>
              <Input
                style={{ marginTop: 8 }}
                placeholder="输入成员姓名"
                value={confirmName}
                onChange={(event) => setConfirmName(event.target.value)}
                status={confirmName && !canDelete ? "error" : undefined}
              />
              {confirmName && !canDelete ? (
                <Typography.Text type="danger" style={{ fontSize: 12 }}>
                  姓名不一致，无法删除
                </Typography.Text>
              ) : null}
            </div>
          </div>
        ) : null}
      </Modal>
    </>
  );
}
