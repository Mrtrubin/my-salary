"use client";

import { Tag } from "antd";
import type { ReactNode } from "react";
import type { ChangeRequestStatus, SalaryRecordStatus } from "@/lib/api/data";

/** 语义色调，与 antd Tag 的预设色解耦，便于以后统一改色。 */
export type TagTone = "slate" | "indigo" | "green" | "amber" | "red";

const toneColor: Record<TagTone, string> = {
  slate: "default",
  indigo: "blue",
  green: "green",
  amber: "orange",
  red: "red",
};

/** 通用状态标签。 */
export function Badge({ tone = "slate", children }: { tone?: TagTone; children: ReactNode }) {
  return (
    <Tag color={toneColor[tone]} style={{ marginInlineEnd: 0 }}>
      {children}
    </Tag>
  );
}

/** 资料修改申请状态徽章（字段级独立审核）。 */
export function ChangeRequestStatusBadge({ status }: { status: ChangeRequestStatus }) {
  const map: Record<ChangeRequestStatus, { tone: TagTone; label: string }> = {
    pending: { tone: "amber", label: "待审核" },
    approved: { tone: "green", label: "已通过" },
    rejected: { tone: "red", label: "已驳回" },
    superseded: { tone: "slate", label: "已作废" },
  };
  const { tone, label } = map[status];
  return <Badge tone={tone}>{label}</Badge>;
}

/** 工资记录状态徽章。 */
export function SalaryRecordStatusBadge({ status }: { status: SalaryRecordStatus }) {
  const map: Record<SalaryRecordStatus, { tone: TagTone; label: string }> = {
    pending_review: { tone: "slate", label: "待审核" },
    pending_confirm: { tone: "amber", label: "待确认" },
    confirmed: { tone: "indigo", label: "已确认" },
    completed: { tone: "green", label: "已完成" },
  };
  const { tone, label } = map[status];
  return <Badge tone={tone}>{label}</Badge>;
}
