"use client";

import { Alert, Empty, Flex, Spin, Typography } from "antd";

const { Text } = Typography;

/**
 * 查询状态占位：加载中 / 失败 / 空。
 *
 * 表格类页面优先用 antd Table 自带的 loading 与空态，
 * 这个组件用于表单、工作区等非表格场景。
 */
export function QueryMessage({
  loading,
  error,
  empty,
}: {
  loading: boolean;
  error: unknown;
  empty?: boolean;
}) {
  if (loading) {
    return (
      <Flex vertical align="center" justify="center" gap={8} style={{ padding: "32px 0" }}>
        <Spin />
        <Text type="secondary">加载中…</Text>
      </Flex>
    );
  }
  if (error) {
    return <Alert type="error" showIcon title="数据加载失败，请稍后重试" />;
  }
  if (empty) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无数据" />;
  }
  return null;
}
