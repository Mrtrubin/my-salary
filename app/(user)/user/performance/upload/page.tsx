"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { QueryMessage } from "@/components/query-message";
import { useCurrentProfile, useTeamPerformance, useTeams } from "@/lib/api/hooks";
import { TeamUpload } from "./TeamUpload";
import type { TeamMemberRow } from "./TeamUpload";

export default function HostPerformanceUploadPage() {
  const searchParams = useSearchParams();
  const editTeamId = searchParams.get("editTeamId");
  const editDate = searchParams.get("editDate");
  const isEditMode = !!editTeamId && !!editDate;

  const profile = useCurrentProfile();
  const teams = useTeams();
  const teamQuery = useTeamPerformance();

  // 当前主持人所带团队（host.id === 自己）
  const myTeams = useMemo(
    () => teams.data?.filter((t) => t.host?.id === profile.data?.id) ?? [],
    [teams.data, profile.data?.id],
  );

  const loading = profile.isLoading || teams.isLoading;
  const isHost = !loading && myTeams.length > 0;
  const hostProfileId = profile.data?.id ?? "";

  const editInitialData = useMemo(() => {
    if (!isEditMode || !editTeamId || !editDate) return null;
    const rows = (teamQuery.data ?? []).filter(
      (r) => r.team_id === editTeamId && r.perf_date === editDate,
    );
    if (!rows.length) return null;
    const memberRows: Record<string, TeamMemberRow> = {};
    rows.forEach((r) => {
      memberRows[r.profile_id] = {
        profileId: r.profile_id,
        name: r.profile?.name ?? "",
        pointId: r.point_id ?? "",
        pointsAmount: r.no_perf ? "" : String(r.points_amount || ""),
        // 提交时已将「业绩 + 调整项」合并存入 points_amount，编辑回填不再拆分调整项。
        adjustments: [],
        noPerf: r.no_perf,
        noPerfNote: r.no_perf_note ?? "停播",
      };
    });
    return {
      teamId: editTeamId,
      perfDate: editDate,
      broadcastMinutes: rows[0]?.broadcast_minutes ?? 0,
      memberRows,
    };
  }, [isEditMode, editTeamId, editDate, teamQuery.data]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">{isEditMode ? "编辑主播流水" : "上传主播流水"}</h1>
        <Link href="/user/performance" className="text-sm text-indigo-600">返回</Link>
      </div>

      <QueryMessage loading={loading} error={profile.error ?? teams.error} />

      {!loading && !isHost ? (
        <Card><CardContent className="text-sm text-muted">你当前不是任何团队的主持人，暂无法上传主播流水。</CardContent></Card>
      ) : null}

      {isHost ? (
        <TeamUpload hostProfileId={hostProfileId} myTeams={myTeams} initialData={editInitialData} isEditMode={isEditMode} />
      ) : null}
    </div>
  );
}