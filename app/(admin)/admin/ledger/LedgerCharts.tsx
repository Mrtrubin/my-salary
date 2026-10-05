"use client";

import { Card, Col, Empty, Row } from "antd";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { LedgerSummary } from "@/lib/api/data";

const PIE_COLORS = ["#1677ff", "#52c41a", "#faad14", "#eb2f96", "#722ed1", "#13c2c2", "#f5222d", "#a0d911"];

/** 收支可视化：月度趋势（收入/支出）+ 按标签占比。 */
export function LedgerCharts({ summary }: { summary: LedgerSummary }) {
  const trend = summary.byMonth.map((m) => ({
    month: m.month,
    income: Number((m.incomeCents / 100).toFixed(2)),
    expense: Number((m.expenseCents / 100).toFixed(2)),
  }));
  const tagData = summary.byTag
    .filter((t) => t.amountCents !== 0)
    .map((t) => ({ name: t.tagName, value: Number((Math.abs(t.amountCents) / 100).toFixed(2)) }));

  return (
    <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
      <Col xs={24} lg={14}>
        <Card title="月度收支趋势" size="small">
          {trend.length === 0 ? (
            <Empty description="暂无数据" />
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={trend} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip formatter={(value) => `¥${Number(value ?? 0).toLocaleString("zh-CN")}`} />
                <Legend />
                <Bar dataKey="income" name="收入" fill="#52c41a" radius={[3, 3, 0, 0]} />
                <Bar dataKey="expense" name="支出" fill="#ff4d4f" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>
      </Col>
      <Col xs={24} lg={10}>
        <Card title="标签占比（绝对值）" size="small">
          {tagData.length === 0 ? (
            <Empty description="暂无数据" />
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie data={tagData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} label>
                  {tagData.map((entry, index) => (
                    <Cell key={entry.name} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => `¥${Number(value ?? 0).toLocaleString("zh-CN")}`} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          )}
        </Card>
      </Col>
    </Row>
  );
}
