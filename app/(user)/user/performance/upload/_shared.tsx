import { Card, CardContent } from "@/components/ui/card";

/** 当前日期（YYYY-MM-DD）。 */
export function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function makeKey() {
  return Math.random().toString(36).slice(2);
}

/** 金额格式化：元 → ¥x.xx。 */
export function yuan(n: number): string {
  return `¥${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** 业绩汇总卡片：按绩效点分别汇总总业绩，并给出总流水。 */
// 注：amount 即用户填写的"业绩"数量，按绩效点维度汇总。
export function SummaryCard({
  rows,
  totalRevenue,
}: {
  rows: { name: string; amount: number; revenue: number }[];
  totalRevenue: number;
}) {
  return (
    <div className="space-y-2">
      <div className="px-1 text-sm font-semibold text-slate-900">业绩汇总</div>
      <Card>
        <CardContent className="space-y-1 px-3 py-3">
          {rows.length ? (
            rows.map((r) => (
              <div key={r.name} className="flex flex-wrap items-center justify-between gap-x-2 text-sm">
                <span className="text-muted">总{r.name} {r.amount.toLocaleString()}</span>
                <span className="ml-auto shrink-0 tabular-nums">{yuan(r.revenue)}</span>
              </div>
            ))
          ) : (
            <div className="text-sm text-muted">暂无业绩数据</div>
          )}
          <div className="flex items-center justify-between border-t pt-1 text-sm font-semibold">
            <span>总业绩</span>
            <span className="tabular-nums text-slate-900">{rows.reduce((s, r) => s + r.amount, 0).toLocaleString()}</span>
          </div>
          <div className="flex items-center justify-between text-sm font-semibold">
            <span>总流水</span>
            <span className="tabular-nums text-indigo-700">{yuan(totalRevenue)}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}