import type { ReactNode } from "react";
import { Card } from "./card";

/** 指标卡：标题 + 主数值 + 辅助说明。 */
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
  const valueClass =
    accent === "negative"
      ? "text-danger"
      : accent === "positive"
        ? "text-success"
        : "text-foreground";
  return (
    <Card className="px-5 py-4">
      <p className="text-xs text-muted">{label}</p>
      <p className={`mt-1.5 text-2xl font-semibold tabular-nums ${valueClass}`}>
        {value}
      </p>
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </Card>
  );
}

/** 页面标题区。 */
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
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold">{title}</h1>
        {description ? (
          <p className="mt-1 text-sm text-muted">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}