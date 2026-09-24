"use client";

import { Card, Typography } from "antd";
import type { ReactNode } from "react";

const { Text } = Typography;

/**
 * 指标卡：标题 + 主数值 + 辅助说明。
 *
 * value 用 ReactNode 而非 Statistic，因为业务里存在「3/12」这类非数值展示。
 */
export function StatCard({
  label,
  value,
  hint,
  accent = "default",
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  accent?: "default" | "negative" | "positive";
}) {
  const color =
    accent === "negative" ? "#cf1322" : accent === "positive" ? "#389e0d" : "rgba(0, 0, 0, 0.88)";

  return (
    <Card size="small">
      <Text type="secondary" style={{ fontSize: 13 }}>
        {label}
      </Text>
      <div
        style={{
          marginTop: 6,
          fontSize: 24,
          fontWeight: 500,
          lineHeight: 1.3,
          fontVariantNumeric: "tabular-nums",
          color,
        }}
      >
        {value}
      </div>
      {hint ? (
        <div style={{ marginTop: 4 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {hint}
          </Text>
        </div>
      ) : null}
    </Card>
  );
}
