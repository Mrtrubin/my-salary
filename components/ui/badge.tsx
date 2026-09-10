import { Chip } from "@heroui/react";
import type { ReactNode } from "react";
import type { ChangeRequestStatus, SalaryRecordStatus } from "@/lib/api/data";

type Tone = "slate" | "indigo" | "green" | "amber" | "red";

/** 旧 tone → HeroUI Chip color 映射。 */
const toneColor = {
  slate: "default",
  indigo: "accent",
  green: "success",
  amber: "warning",
  red: "danger",
} as const;

export function Badge({
  tone = "slate",
  children,
}: {
  tone?: Tone;
  children: ReactNode;
}) {
  return (
    <Chip color={toneColor[tone]} variant="soft" size="sm">
      {children}
    </Chip>
  );
}

/** 资料修改申请状态徽章（字段级独立审核）。 */
export function ChangeRequestStatusBadge({ status }: { status: ChangeRequestStatus }) {
  const map: Record<ChangeRequestStatus, { tone: Tone; label: string }> = {
    pending: { tone: "amber", label: "待审核" },
    approved: { tone: "green", label: "已通过" },
    rejected: { tone: "red", label: "已驳回" },
    superseded: { tone: "slate", label: "已作废" },
  };
  const { tone, label } = map[status];
  return <Badge tone={tone}>{label}</Badge>;
}
export function SalaryRecordStatusBadge({ status }: { status: SalaryRecordStatus }) {
  const map: Record<SalaryRecordStatus, { tone: Tone; label: string }> = {
    pending_review: { tone: "slate", label: "待审核" },
    pending_confirm: { tone: "amber", label: "待确认" },
    confirmed: { tone: "indigo", label: "已确认" },
    completed: { tone: "green", label: "已完成" },
  };
  const { tone, label } = map[status];
  return <Badge tone={tone}>{label}</Badge>;
}