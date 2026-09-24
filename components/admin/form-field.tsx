"use client";

import { Form } from "antd";
import type { ReactNode } from "react";

/**
 * 表单字段包装：把「标签 + 控件 + 提示/错误」统一到 antd 的视觉规范。
 *
 * 只做布局与文案，不接管取值——取值仍由 react-hook-form 负责，
 * 因此不要传 `name`，否则 antd 会尝试自己收集该字段。
 */
export function FormField({
  label,
  hint,
  error,
  required,
  children,
}: {
  label: string;
  /** 辅助说明，展示在控件下方 */
  hint?: string;
  /** 错误文案，传入后控件进入错误态 */
  error?: string | null;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <Form.Item
      label={label}
      required={required}
      extra={error ? undefined : hint}
      help={error ?? undefined}
      validateStatus={error ? "error" : undefined}
      style={{ marginBottom: 16 }}
    >
      {children}
    </Form.Item>
  );
}
