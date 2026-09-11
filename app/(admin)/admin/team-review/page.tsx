"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { QueryMessage } from "@/components/query-message";
import { PageHeader } from "@/components/ui/stat-card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useTeamPerformance } from "@/lib/api/hooks";
import { formatDate } from "@/lib/format";

function toHours(minutes: number): string {
  if (!minutes) return "0";
  const h = minutes / 60;
  return Number.isInteger(h) ? String(h) : h.toFixed(1);
}

export default function TeamReviewPage() {
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const query = useTeamPerformance({
    start: startDate || undefined,
    end: endDate || undefined,
  });
  const [keyword, setKeyword] = useState("");

  const filtered = useMemo(() => {
    const records = query.data ?? [];
    const kw = keyword.trim().toLowerCase();
    if (!kw) return records;
    return records.filter((item) => {
      const names = `${item.profile?.name ?? ""} ${item.team?.name ?? ""}`.toLowerCase();
      return names.includes(kw);
    });
  }, [query.data, keyword]);

  return (
    <>
      <PageHeader title="团队绩效记录" description="团队每日绩效明细，重复提交同一（日期 + 成员 + 团队）将直接更新原记录" />
      <Card>
        <CardHeader title="团队绩效记录" />
        <CardContent className="p-0">
          <div className="flex flex-wrap items-end gap-3 p-4">
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">开始日期</span>
              <Input
                className="max-w-xs"
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">结束日期</span>
              <Input
                className="max-w-xs"
                type="date"
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
              />
            </div>
            <Input
              className="max-w-xs"
              placeholder="搜索成员 / 团队名称"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
            />
            {keyword || startDate || endDate ? (
              <Button
                variant="ghost"
                onClick={() => {
                  setKeyword("");
                  setStartDate("");
                  setEndDate("");
                }}
              >
                重置
              </Button>
            ) : null}
          </div>
          <QueryMessage loading={query.isLoading} error={query.error} empty={!filtered.length} />
          <Table>
            <THead>
              <TH isRowHeader sticky="left">绩效日期</TH>
              <TH>团队</TH>
              <TH>成员</TH>
              <TH>绩效点</TH>
              <TH className="text-left">开播时长</TH>
              <TH className="text-left">业绩</TH>
            </THead>
            <TBody>
              {filtered.map((item) => (
                <TR key={item.id}>
                  <TD sticky="left">{formatDate(item.perf_date)}</TD>
                  <TD>{item.team?.name ?? "—"}</TD>
                  <TD>{item.profile?.name ?? "—"}</TD>
                  <TD>{item.no_perf ? (item.no_perf_note || "停播") : (item.point?.name ?? "—")}</TD>
                  <TD className="text-left">{toHours(item.broadcast_minutes)}</TD>
                  <TD className="text-left">{item.no_perf ? "—" : item.points_amount.toLocaleString()}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}