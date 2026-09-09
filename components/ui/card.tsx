import { Card as HeroCard } from "@heroui/react";
import type { HTMLAttributes, ReactNode } from "react";

const cx = (...parts: Array<string | undefined>) =>
  parts.filter(Boolean).join(" ");

/** HeroUI Card 容器（default 变体：surface 底色 + 描边 + 圆角阴影）。 */
export function Card({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return <HeroCard className={className} {...props} />;
}

export function CardHeader({
  title,
  description,
  action,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
      <div>
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        {description ? (
          <p className="mt-0.5 text-xs text-slate-500">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

export function CardContent({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx("px-5 py-4", className)} {...props} />;
}