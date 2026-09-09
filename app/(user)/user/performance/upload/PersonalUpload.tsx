"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { useCreatePerformanceRecords } from "@/lib/api/hooks";
import { SummaryCard, makeKey, today } from "./_shared";

/** 个人版单行：绩效点 + 成员 + 日期 + 业绩。 */
type Row = { key: string; pointId: string; profileId: string; date: string; pointsAmount: string };

type Anchor = { id: string; name: string };
type Point = { id: string; name: string; rate: number };

export function PersonalUpload({
  hostProfileId,
  anchors,
  points,
}: {
  hostProfileId: string;
  anchors: Anchor[];
  points: Point[];
}) {
  const router = useRouter();
  const create = useCreatePerformanceRecords();

  const rateOf = (pointId: string) => points.find((p) => p.id === pointId)?.rate ?? 0;
  const defaultPointId = points[0]?.id ?? "";
  const defaultProfileId = anchors[0]?.id ?? "";

  const [rows, setRows] = useState<Row[]>([{ key: makeKey(), pointId: "", profileId: "", date: today(), pointsAmount: "" }]);
  const rowsWithDefault = rows.map((r) => ({
    ...r,
    pointId: r.pointId || defaultPointId,
    profileId: r.profileId || defaultProfileId,
  }));
  const updateRow = (key: string, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const removeRow = (key: string) => setRows((prev) => (prev.length > 1 ? prev.filter((r) => r.key !== key) : prev));
  const addRow = () => {
    setRows((prev) => {
      const last = prev[prev.length - 1];
      const lastProfileId = last?.profileId || defaultProfileId;
      const curIdx = anchors.findIndex((a) => a.id === lastProfileId);
      const nextProfileId = anchors.length ? anchors[(curIdx + 1) % anchors.length].id : "";
      return [...prev, { key: makeKey(), pointId: last?.pointId || defaultPointId, profileId: nextProfileId, date: last?.date || today(), pointsAmount: "" }];
    });
  };
  const revenueYuanOf = (pointId: string, pointsAmount: string): number => {
    const rate = rateOf(pointId);
    const amount = Number(pointsAmount) || 0;
    return rate > 0 ? amount / rate : 0;
  };
  const validRows = rowsWithDefault.filter((r) => r.pointId && r.profileId && r.date && Number(r.pointsAmount) > 0);
  const canSubmit = !!hostProfileId && validRows.length > 0 && !create.isPending;
  const handleSubmit = () => {
    if (!hostProfileId) return;
    const items = validRows.map((r) => ({
      profileId: r.profileId,
      month: r.date,
      revenueCents: Math.round(revenueYuanOf(r.pointId, r.pointsAmount) * 100),
    }));
    create.mutate(
      { hostProfileId, items },
      { onSuccess: () => { router.push("/user/performance"); } },
    );
  };

  const summary = useMemo(() => {
    const byPoint = new Map<string, { name: string; amount: number; revenue: number }>();
    let totalRevenue = 0;
    validRows.forEach((r) => {
      const p = points.find((x) => x.id === r.pointId);
      if (!p) return;
      const amount = Number(r.pointsAmount) || 0;
      const rev = revenueYuanOf(r.pointId, r.pointsAmount);
      const cur = byPoint.get(r.pointId) ?? { name: p.name, amount: 0, revenue: 0 };
      cur.amount += amount;
      cur.revenue += rev;
      byPoint.set(r.pointId, cur);
      totalRevenue += rev;
    });
    return { rows: Array.from(byPoint.values()), totalRevenue };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [validRows, points]);

  return (
    <>
      <ul className="space-y-2">
        {rowsWithDefault.map((row) => {
          return (
            <li key={row.key}>
              <Card>
                <CardContent className="space-y-2 px-3 py-3">
                  <div className="grid grid-cols-2 gap-2">
                    <Select
                      value={row.pointId}
                      options={points}
                      onChange={(id) => updateRow(row.key, { pointId: id })}
                      placeholder="种类"
                    />
                    <Select
                      value={row.profileId}
                      options={anchors}
                      onChange={(id) => updateRow(row.key, { profileId: id })}
                      placeholder="成员"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="date"
                      value={row.date}
                      onChange={(e) => updateRow(row.key, { date: e.target.value })}
                      className="w-full rounded border px-2 py-1.5 text-sm"
                    />
                    <Input
                      type="number"
                      min={0}
                      step="1"
                      placeholder="业绩"
                      value={row.pointsAmount}
                      onChange={(e) => updateRow(row.key, { pointsAmount: e.target.value })}
                    />
                  </div>
                  {rows.length > 1 ? (
                    <div className="flex justify-end">
                      <button type="button" onClick={() => removeRow(row.key)} className="text-xs text-danger">删除</button>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ul>

      <Button variant="secondary" className="w-full" onClick={addRow}>+ 添加业绩</Button>

      <SummaryCard rows={summary.rows} totalRevenue={summary.totalRevenue} />

      {create.error ? <p className="text-sm text-danger">提交失败：{(create.error as Error).message}</p> : null}

      <Button className="w-full" disabled={!canSubmit} onClick={handleSubmit}>
        {create.isPending ? "提交中…" : `提交个人业绩${validRows.length ? `（${validRows.length} 人）` : ""}`}
      </Button>
    </>
  );
}