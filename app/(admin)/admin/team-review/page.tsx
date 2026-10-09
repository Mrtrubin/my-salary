"use client";

import { Button, Card, Flex, Input, Modal, Typography } from "antd";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/admin/page-header";
import { QueryMessage } from "@/components/admin/query-message";
import { ResizableTable } from "@/components/admin/resizable-table";
import { zebraRowClassName } from "@/components/admin/table-zebra";
import { TimeRangeFilter } from "@/components/admin/time-range-filter";
import { useTeamPerformance } from "@/lib/api/hooks";
import type { TeamPerformanceRow } from "@/lib/api/data";
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

export default function TeamReviewPage() {
  const [range, setRange] = useState<PeriodRange | null>(null);
  const [keyword, setKeyword] = useState("");
  const [detail, setDetail] = useState<TeamPerformanceRow | null>(null);

  const query = useTeamPerformance({
    start: range?.start,
    end: range?.end,
  });

  const filtered = useMemo(() => {
    const records = query.data ?? [];
    const kw = keyword.trim().toLowerCase();
    if (!kw) return records;
    return records.filter((item) => {
      const names = `${item.profile?.name ?? ""} ${item.team?.name ?? ""} ${item.host?.name ?? ""}`.toLowerCase();
      return names.includes(kw);
    });
  }, [query.data, keyword]);

  const hasFilter = Boolean(keyword || range);

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
            <Input.Search
              allowClear
              style={{ width: 220 }}
              placeholder="搜索成员 / 团队名称"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
            />
            {hasFilter ? (
              <Button
                onClick={() => {
                  setKeyword("");
                  setRange(null);
                }}
              >
                重置
              </Button>
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
    </>
  );
}
