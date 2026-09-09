"use client";

import { Suspense, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { QueryMessage } from "@/components/query-message";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import {
  useAddTeamPerformancePoint,
  usePerformancePoints,
  useRemoveTeamPerformancePoint,
  useTeams,
} from "@/lib/api/hooks";

function TeamPointsInner() {
  const searchParams = useSearchParams();
  const teamId = searchParams.get("teamId") ?? "";
  const teams = useTeams();
  const perfPoints = usePerformancePoints();
  const addPoint = useAddTeamPerformancePoint();
  const removePoint = useRemoveTeamPerformancePoint();

  const team = teams.data?.find((t) => t.id === teamId);
  const availablePoints = useMemo(
    () => perfPoints.data?.filter((p) => p.status === "active" && !team?.points.some((tp) => tp.point?.id === p.id)) ?? [],
    [perfPoints.data, team?.points],
  );

  return (
    <Card>
      <CardHeader title="绩效管理" description="展示团队已启用的绩效点，可设置（关联）或移除绩效点。换算率含义：N 绩效点 = 1 元。" />
      <CardContent>
        <QueryMessage loading={teams.isLoading} error={teams.error} empty={!teams.isLoading && !team} />
        {team ? (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-3 border-b pb-4">
              <select
                defaultValue=""
                onChange={(e) => { if (e.target.value) { addPoint.mutate({ teamId, pointId: e.target.value }); e.target.value = ""; } }}
                className="rounded border px-3 py-2 text-sm"
              >
                <option value="">+ 设置绩效点</option>
                {availablePoints.map((p) => <option key={p.id} value={p.id}>{p.name}（{p.points_per_yuan} 绩效点 = 1 元）</option>)}
              </select>
              <span className="text-xs text-muted">已关联 {team.points.length} 项</span>
            </div>
            <Table>
              <THead><TH isRowHeader>绩效点名称</TH><TH>换算率</TH><TH className="text-right">操作</TH></THead>
              <TBody>
                {team.points.map(({ point }) => point ? (
                  <TR key={point.id}>
                    <TD>{point.name}</TD>
                    <TD>{point.points_per_yuan} 绩效点 = 1 元</TD>
                    <TD className="text-right">
                      <Button variant="ghost" onClick={() => removePoint.mutate({ teamId, pointId: point.id })}>移除</Button>
                    </TD>
                  </TR>
                ) : null)}
                {!team.points.length ? (
                  <TR><TD className="text-sm text-muted">暂无绩效点，请从上方设置</TD><TD /><TD /></TR>
                ) : null}
              </TBody>
            </Table>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default function TeamPointsPage() {
  return (
    <Suspense fallback={null}>
      <TeamPointsInner />
    </Suspense>
  );
}