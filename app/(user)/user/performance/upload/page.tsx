"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { QueryMessage } from "@/components/query-message";
import { useCurrentProfile, useTeamPerformance, useTeams } from "@/lib/api/hooks";
import { PersonalUpload } from "./PersonalUpload";
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

  const [mode, setMode] = useState<"team" | "personal">("team");

  // 当前主持人所带团队（host.id === 自己）
  const myTeams = useMemo(
    () => teams.data?.filter((t) => t.host?.id === profile.data?.id) ?? [],
    [teams.data, profile.data?.id],
  );
  // 合并旗下所有团队的成员与绩效点（个人版用，去重）
  const anchors = useMemo(() => {
    const map = new Map<string, string>();
    myTeams.forEach((t) => t.members.forEach((m) => { if (m.profile) map.set(m.profile.id, m.profile.name); }));
    return Array.from(map, ([id, name]) => ({ id, name }));
  }, [myTeams]);
  const points = useMemo(() => {
    const map = new Map<string, { name: string; rate: number }>();
    myTeams.forEach((t) => t.points.forEach((p) => { if (p.point) map.set(p.point.id, { name: p.point.name, rate: p.point.points_per_yuan }); }));
    return Array.from(map, ([id, v]) => ({ id, ...v }));
  }, [myTeams]);

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
        <h1 className="text-lg font-semibold">{isEditMode ? "编辑绩效" : "上传绩效"}</h1>
        <Link href="/user/performance" className="text-sm text-indigo-600">返回</Link>
      </div>

      <QueryMessage loading={loading} error={profile.error ?? teams.error} />

      {!loading && !isHost ? (
        <Card><CardContent className="text-sm text-muted">你当前不是任何团队的主持人，暂无法上传绩效。</CardContent></Card>
      ) : null}

      {isHost ? (
        <>
          {/* 编辑模式下不显示模式切换，始终使用团队版 */}
          {!isEditMode ? (
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setMode("team")}
                className={`rounded border px-3 py-2 text-sm font-medium ${mode === "team" ? "border-indigo-600 bg-indigo-50 text-indigo-700" : "text-muted"}`}
              >
                团队
              </button>
              <button
                type="button"
                onClick={() => setMode("personal")}
                className={`rounded border px-3 py-2 text-sm font-medium ${mode === "personal" ? "border-indigo-600 bg-indigo-50 text-indigo-700" : "text-muted"}`}
              >
                个人
              </button>
            </div>
          ) : null}

          {mode === "team" ? (
            <TeamUpload hostProfileId={hostProfileId} myTeams={myTeams} initialData={editInitialData} isEditMode={isEditMode} />
          ) : (
            <PersonalUpload hostProfileId={hostProfileId} anchors={anchors} points={points} />
          )}
        </>
      ) : null}
    </div>
  );
}