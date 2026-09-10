"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useCreateTeamPerformanceRecords, useReplaceTeamPerformanceRecords, useTeams } from "@/lib/api/hooks";
import { SummaryCard, today } from "./_shared";

type Team = NonNullable<ReturnType<typeof useTeams>["data"]>[number];

/** 团队版单成员行：绩效点 + 业绩 + 无绩效勾选 + 停播文本。 */
export type TeamMemberRow = {
  profileId: string;
  name: string;
  pointId: string;
  pointsAmount: string;
  noPerf: boolean;
  noPerfNote: string;
};

/** 原生下拉/日期输入统一样式，与 UI 组件视觉对齐。 */
const controlClass =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100";



/** 字段标签。 */
function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <span className="mb-1.5 block text-xs font-medium text-slate-500">
      {children}
    </span>
  );
}

type SelectOption = { id: string; name: string };

/**
 * 自定义下拉选择器：显示当前选中文字 + 下拉箭头图标，
 * 点击文字/图标展开选项列表，选择后回调；点击外部自动关闭。
 */
function SelectMenu({
  value,
  options,
  onChange,
  placeholder = "请选择",
}: {
  value: string;
  options: SelectOption[];
  onChange: (id: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.id === value);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-left text-sm text-slate-900 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
      >
        <span className={selected ? "truncate" : "truncate text-slate-400"}>
          {selected ? selected.name : placeholder}
        </span>
        <svg
          viewBox="0 0 20 20"
          fill="none"
          aria-hidden="true"
          className={`size-4 shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}
        >
          <path
            d="M6 8l4 4 4-4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {open ? (
        <ul className="absolute z-20 mt-1 max-h-52 w-max min-w-full max-w-[16rem] overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
          {options.map((o) => (
            <li key={o.id}>
              <button
                type="button"
                onClick={() => {
                  onChange(o.id);
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-sm transition hover:bg-slate-50 ${
                  o.id === value ? "font-medium text-indigo-600" : "text-slate-700"
                }`}
              >
                <span className="whitespace-nowrap">{o.name}</span>
                {o.id === value ? (
                  <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="size-4 shrink-0">
                    <path
                      d="M5 10l3 3 7-7"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function TeamUpload({
  hostProfileId,
  myTeams,
  initialData,
  isEditMode,
}: {
  hostProfileId: string;
  myTeams: Team[];
  initialData?: {
    teamId: string;
    perfDate: string;
    broadcastMinutes: number;
    memberRows: Record<string, TeamMemberRow>;
  } | null;
  isEditMode?: boolean;
}) {
  const createTeam = useCreateTeamPerformanceRecords();
  const replaceTeam = useReplaceTeamPerformanceRecords();
  const router = useRouter();

  const [teamId, setTeamId] = useState(initialData?.teamId ?? "");
  const selectedTeamId = teamId || myTeams[0]?.id || "";
  const selectedTeam = myTeams.find((t) => t.id === selectedTeamId);
  const teamPoints = useMemo(() => {
    return (selectedTeam?.points ?? [])
      .filter((p) => p.point)
      .map((p) => ({ id: p.point!.id, name: p.point!.name, rate: p.point!.points_per_yuan }));
  }, [selectedTeam]);
  const teamDefaultPointId = teamPoints[0]?.id ?? "";
  const [teamDate, setTeamDate] = useState(initialData?.perfDate ?? today());
  const [broadcastHours, setBroadcastHours] = useState(
    initialData ? String((initialData.broadcastMinutes / 60).toFixed(1)) : "",
  );
  const [memberRows, setMemberRows] = useState<Record<string, TeamMemberRow>>(initialData?.memberRows ?? {});

  const teamMembers = useMemo(() => {
    const list = (selectedTeam?.members ?? []).filter((m) => m.profile).map((m) => m.profile!);
    return list.map((m) => {
      const existing = memberRows[m.id];
      return existing ?? {
        profileId: m.id,
        name: m.name,
        pointId: teamDefaultPointId,
        pointsAmount: "",
        noPerf: false,
        noPerfNote: "停播",
      };
    });
  }, [selectedTeam, memberRows, teamDefaultPointId]);

  const updateMember = (profileId: string, patch: Partial<TeamMemberRow>) =>
    setMemberRows((prev) => {
      const base = teamMembers.find((m) => m.profileId === profileId);
      if (!base) return prev;
      return { ...prev, [profileId]: { ...base, ...prev[profileId], ...patch } };
    });

  const teamRateOf = (pointId: string) => teamPoints.find((p) => p.id === pointId)?.rate ?? 0;
  const teamRevenueYuanOf = (m: TeamMemberRow): number => {
    if (m.noPerf) return 0;
    const rate = teamRateOf(m.pointId || teamDefaultPointId);
    const amount = Number(m.pointsAmount) || 0;
    return rate > 0 ? amount / rate : 0;
  };
  const teamValidMembers = teamMembers.filter((m) => m.noPerf || Number(m.pointsAmount) > 0);
  // 开播时长必须在 (0, 24] 区间内。
  const broadcastHoursValue = Number(broadcastHours);
  const broadcastHoursValid = broadcastHours !== "" && broadcastHoursValue > 0 && broadcastHoursValue <= 24;
  const canSubmitTeam =
    !!hostProfileId && !!selectedTeamId && !!teamDate && broadcastHoursValid && teamValidMembers.length > 0 && !(createTeam.isPending || replaceTeam.isPending);

  const handleSubmitTeam = () => {
    if (!hostProfileId || !selectedTeamId) return;
    if (!broadcastHoursValid) return;
    const items = teamValidMembers.map((m) => {
      const pointId = m.pointId || teamDefaultPointId;
      return {
        profileId: m.profileId,
        pointId,
        pointsAmount: m.noPerf ? 0 : Number(m.pointsAmount) || 0,
        revenueCents: Math.round(teamRevenueYuanOf(m) * 100),
        noPerf: m.noPerf,
      noPerfNote: m.noPerf ? m.noPerfNote : undefined,
      };
    });
    const input = {
      teamId: selectedTeamId,
      hostProfileId,
      perfDate: teamDate,
      broadcastMinutes: Math.round((Number(broadcastHours) || 0) * 60),
      items,
    };
    const onSuccess = () => {
        router.push("/user/performance");
    };
    if (isEditMode) {
      replaceTeam.mutate(input, { onSuccess });
    } else {
      createTeam.mutate(input, { onSuccess });
    }
  };

  const summary = useMemo(() => {
    const byPoint = new Map<string, { name: string; amount: number; revenue: number }>();
    let totalRevenue = 0;
    teamMembers.forEach((m) => {
      if (m.noPerf) return;
      const amount = Number(m.pointsAmount) || 0;
      if (amount <= 0) return;
      const pid = m.pointId || teamDefaultPointId;
      const p = teamPoints.find((x) => x.id === pid);
      if (!p) return;
      const rev = teamRevenueYuanOf(m);
      const cur = byPoint.get(pid) ?? { name: p.name, amount: 0, revenue: 0 };
      cur.amount += amount;
      cur.revenue += rev;
      byPoint.set(pid, cur);
      totalRevenue += rev;
    });
    return { rows: Array.from(byPoint.values()), totalRevenue };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamMembers, teamPoints, teamDefaultPointId]);

  return (
    <div className="space-y-4">
      {/* 基础配置：团队 / 日期 / 开播时长 */}
      <div className="space-y-2">
        <div className="px-1 text-sm font-semibold text-slate-900">团队信息</div>
        <Card>
          <CardContent className="space-y-3 !px-3 !py-2.5">
            {myTeams.length > 1 ? (
              <label className="block">
                <FieldLabel>选择团队</FieldLabel>
                <select
                  value={selectedTeamId}
                  onChange={(e) => { setTeamId(e.target.value); setMemberRows({}); }}
                  className={controlClass}
                  disabled={isEditMode}
                >
                  {myTeams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </label>
            ) : null}
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <FieldLabel>日期</FieldLabel>
                <input
                  type="date"
                  value={teamDate}
                  onChange={(e) => setTeamDate(e.target.value)}
                  className={controlClass}
                  disabled={isEditMode}
                />
              </label>
              <label className="block">
                <FieldLabel>开播时长（小时）</FieldLabel>
                <Input
                  type="number"
                  min={0.1}
                  max={24}
                  step="0.5"
                  placeholder="0~24"
                  value={broadcastHours}
                  onChange={(e) => setBroadcastHours(e.target.value)}
                />
                {broadcastHours !== "" && !broadcastHoursValid ? (
                  <span className="mt-1 block text-xs text-danger">开播时长需大于 0 且不超过 24 小时</span>
                ) : null}
              </label>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 成员业绩录入 */}
      <div className="space-y-2">
        <div className="flex items-center justify-between px-1">
          <span className="text-sm font-semibold text-slate-900">成员业绩</span>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
            共 {teamMembers.length} 人 · 已填 {teamValidMembers.length} 人
          </span>
        </div>

        {teamMembers.length === 0 ? (
          <Card>
            <CardContent className="px-4 py-8 text-center text-sm text-slate-400">
              该团队暂无成员
            </CardContent>
          </Card>
        ) : (
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs font-medium text-slate-500">
                    <th className="px-3 py-2.5 text-center font-medium">停播</th>
                    <th className="px-3 py-2.5 font-medium">成员</th>
                    <th className="px-3 py-2.5 font-medium">种类</th>
                    <th className="px-3 py-2.5 font-medium">业绩</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {teamMembers.map((m) => (
                    <tr key={m.profileId} className={m.noPerf ? "bg-amber-50/60" : ""}>
                      <td className="px-3 py-2.5 text-center">
                        <input
                          type="checkbox"
                          checked={m.noPerf}
                          onChange={(e) => updateMember(m.profileId, { noPerf: e.target.checked })}
                          className="size-4 accent-amber-500"
                          aria-label={`${m.name} 停播`}
                        />
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="whitespace-nowrap font-medium text-slate-900">{m.name}</span>
                      </td>
                      {m.noPerf ? (
                        <td className="px-3 py-2.5" colSpan={2}>
                          <Input
                            size="sm"
                            maxLength={20}
                            placeholder="停播备注"
                            value={m.noPerfNote}
                            onChange={(e) => updateMember(m.profileId, { noPerfNote: e.target.value.slice(0, 20) })}
                          />
                        </td>
                      ) : (
                        <>
                          <td className="px-3 py-2.5">
                            <SelectMenu
                              value={m.pointId || teamDefaultPointId}
                              options={teamPoints}
                              onChange={(id) => updateMember(m.profileId, { pointId: id })}
                            />
                          </td>
                          <td className="px-3 py-2.5">
                            <Input
                              size="sm"
                              type="number"
                              min={0}
                              step="1"
                              placeholder="业绩"
                              value={m.pointsAmount}
                              onChange={(e) => updateMember(m.profileId, { pointsAmount: e.target.value })}
                            />
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>

      <SummaryCard rows={summary.rows} totalRevenue={summary.totalRevenue} />

      {(createTeam.error || replaceTeam.error) ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-danger">
          提交失败：{(createTeam.error ?? replaceTeam.error as Error).message}
        </p>
      ) : null}

      <Button className="w-full" disabled={!canSubmitTeam} onClick={handleSubmitTeam}>
        {createTeam.isPending || replaceTeam.isPending ? "提交中…" : `${isEditMode ? "重新提交" : "提交主播流水"}${teamValidMembers.length ? `（${teamValidMembers.length} 人）` : ""}`}
      </Button>
    </div>
  );
}