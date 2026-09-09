"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { QueryMessage } from "@/components/query-message";
import { useCurrentProfile, useTeamPerformance, useTeams } from "@/lib/api/hooks";
import { TeamPerformanceCard, type DailyGroup } from "./TeamPerformanceCard";

export default function UserPerformancePage() {
  const router = useRouter();
  const teamQuery = useTeamPerformance();
  const profile = useCurrentProfile();
  const teams = useTeams();

  // 是否为某团队主持人：决定「上传绩效」入口与团队每日绩效视图是否显示
  const isHost = useMemo(
    () => !!profile.data?.id && (teams.data?.some((t) => t.host?.id === profile.data?.id) ?? false),
    [teams.data, profile.data?.id],
  );

  // 按「团队 + 日期」聚合团队绩效记录，倒序排列成每日卡片。
  // 同一成员同一绩效点同一天可能有多条记录，仅保留最新一条（不同绩效点各自保留）。
  const dailyGroups = useMemo<DailyGroup[]>(() => {
    const rows = teamQuery.data ?? [];
    const map = new Map<string, DailyGroup>();
    const seen = new Set<string>();
    rows.forEach((r) => {
      // 成员 + 绩效点 + 日期 维度去重：查询已按 created_at 倒序，首次遇到即最新。
      const memberPointKey = `${r.profile_id}__${r.point_id ?? "none"}__${r.perf_date}`;
      if (seen.has(memberPointKey)) return;
      seen.add(memberPointKey);

      const key = `${r.team_id}__${r.perf_date}`;
      const g =
        map.get(key) ??
        {
          key,
          teamName: r.team?.name ?? "团队",
          perfDate: r.perf_date,
          broadcastMinutes: r.broadcast_minutes,
          rows: [],
        };
      g.broadcastMinutes = Math.max(g.broadcastMinutes, r.broadcast_minutes);
      g.rows.push(r);
      map.set(key, g);
    });
    return Array.from(map.values()).sort((a, b) => b.perfDate.localeCompare(a.perfDate));
  }, [teamQuery.data]);

  return (
    <div className="space-y-4">
      {isHost ? (
        <Link href="/user/performance/upload" className="block">
          <Button className="w-full">上传绩效</Button>
        </Link>
      ) : null}

      <QueryMessage
        loading={teamQuery.isLoading}
        error={teamQuery.error}
        empty={!dailyGroups.length}
      />
      <ul className="space-y-3">
        {dailyGroups.map((g) => (
          <li key={g.key}>
            <TeamPerformanceCard
              group={g}
              onEdit={
                isHost
                  ? () => router.push(`/user/performance/upload?editTeamId=${g.rows[0]?.team_id}&editDate=${g.perfDate}`)
                  : undefined
              }
            />
          </li>
        ))}
      </ul>
    </div>
  );
}