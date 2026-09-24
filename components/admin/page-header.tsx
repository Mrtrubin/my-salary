"use client";

import { Flex, Typography } from "antd";
import type { ReactNode } from "react";

const { Title, Paragraph } = Typography;

/** 页面标题区：标题 + 说明 + 右侧操作。 */
export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <Flex align="flex-start" justify="space-between" gap={16} wrap style={{ marginBottom: 24 }}>
      <div style={{ minWidth: 0 }}>
        <Title level={4} style={{ margin: 0 }}>
          {title}
        </Title>
        {description ? (
          <Paragraph type="secondary" style={{ margin: "4px 0 0", maxWidth: 960 }}>
            {description}
          </Paragraph>
        ) : null}
      </div>
      {action ? <div style={{ flexShrink: 0 }}>{action}</div> : null}
    </Flex>
  );
}
