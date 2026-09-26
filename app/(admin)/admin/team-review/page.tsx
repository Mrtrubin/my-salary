"use client";

import { Button, Card, DatePicker, Flex, Input, Modal, Table, Typography } from "antd";
import type { Dayjs } from "dayjs";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/admin/page-header";
import { QueryMessage } from "@/components/admin/query-message";
import { zebraRowClassName } from "@/components/admin/table-zebra";
import { useTeamPerformance } from "@/lib/api/hooks";
import type { TeamPerformanceRow } from "@/lib/api/data";
import { buildRevenueRecordFields } from "@/lib/domain/performance/recordView";
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
  const [range, setRange] = useState<[Dayjs | null, Dayjs | null] | null>(null);
  const [keyword, setKeyword] = useState("");
  const [detail, setDetail] = useState<TeamPerformanceRow | null>(null);

  const query = useTeamPerformance({
    start: range?.[0] ? range[0].format("YYYY-MM-DD") : undefined,
    end: range?.[1] ? range[1].format("YYYY-MM-DD") : undefined,
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
            <DatePicker.RangePicker
              value={range}
              onChange={(value) => setRange(value)}
              allowEmpty={[true, true]}
            />
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
          <Table
            rowClassName={zebraRowClassName}
            rowKey="id"
            loading={query.isLoading}
            dataSource={filtered}
            pagination={{ showSizeChanger: true, showTotal: (total) => `共 ${total} 条` }}
            locale={{ emptyText: "暂无流水记录" }}
            scroll={{ x: "max-content" }}
            onRow={(record) => ({
              onClick: () => setDetail(record),
              style: { cursor: "pointer" },
            })}
            columns={[
              {
                title: "绩效日期",
                dataIndex: "perf_date",
                fixed: "left",
                width: 140,
                render: (value: string) => formatDate(value),
              },
              { title: "团队", width: 160, render: (_, record) => record.team?.name ?? "—" },
              { title: "成员", width: 140, render: (_, record) => record.profile?.name ?? "—" },
              { title: "主持", width: 140, render: (_, record) => record.host?.name ?? "—" },
              {
                title: "绩效点",
                width: 160,
                render: (_, record) =>
                  record.no_perf ? (
                    <Typography.Text type="warning">{record.no_perf_note || "休息"}</Typography.Text>
                  ) : (
                    (record.point?.name ?? "—")
                  ),
              },
              {
                title: "开播时长",
                width: 120,
                render: (_, record) => toHours(record.broadcast_minutes),
              },
              {
                title: "业绩",
                width: 140,
                render: (_, record) =>
                  record.no_perf ? "—" : record.points_amount.toLocaleString(),
              },
              {
                title: "当日流水",
                width: 130,
                align: "right",
                render: (_, record) => formatCentsToYuan(record.revenue_cents - record.adjustment_cents),
              },
              {
                title: "总调整项",
                width: 120,
                align: "right",
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
                title: "当日最终流水",
                width: 140,
                align: "right",
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
