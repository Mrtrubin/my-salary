import { Chip } from "@heroui/react";
import type { ReactNode } from "react";
import type { PerformanceStatus, SalaryRecordStatus } from "@/lib/api/data";

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

/** 业绩状态徽章（draft → pending → approved / rejected）。 */
export function PerformanceStatusBadge({ status }: { status: PerformanceStatus }) {
  const map: Record<PerformanceStatus, { tone: Tone; label: string }> = {
    draft: { tone: "slate", label: "草稿" },
    pending: { tone: "amber", label: "待审核" },
    approved: { tone: "green", label: "已通过" },
    rejected: { tone: "red", label: "已驳回" },
  };
  const { tone, label } = map[status];
  return <Badge tone={tone}>{label}</Badge>;
}

/** 工资记录状态徽章（已确认/已发布只冲正不覆盖）。 */
export function SalaryRecordStatusBadge({ status }: { status: SalaryRecordStatus }) {
  const map: Record<SalaryRecordStatus, { tone: Tone; label: string }> = {
    draft: { tone: "slate", label: "草稿" },
    confirmed: { tone: "indigo", label: "已确认" },
    published: { tone: "green", label: "已发布" },
    voided: { tone: "red", label: "已冲正" },
  };
  const { tone, label } = map[status];
  return <Badge tone={tone}>{label}</Badge>;
}