"use client";

import { Button, Card, DatePicker, Flex, Input, Table, Typography } from "antd";
import type { Dayjs } from "dayjs";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/admin/page-header";
import { QueryMessage } from "@/components/admin/query-message";
import { zebraRowClassName } from "@/components/admin/table-zebra";
import { useTeamPerformance } from "@/lib/api/hooks";
import { formatDate } from "@/lib/format";

function toHours(minutes: number): string {
  if (!minutes) return "0";
  const h = minutes / 60;
  return Number.isInteger(h) ? String(h) : h.toFixed(1);
}

export default function TeamReviewPage() {
  const [range, setRange] = useState<[Dayjs | null, Dayjs | null] | null>(null);
  const [keyword, setKeyword] = useState("");

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
                    <Typography.Text type="warning">{record.no_perf_note || "停播"}</Typography.Text>
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
            ]}
          />
        )}
      </Card>
    </>
  );
}
