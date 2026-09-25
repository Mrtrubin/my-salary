"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useCreateTeamPerformanceRecords, useReplaceTeamPerformanceRecords, useTeams } from "@/lib/api/hooks";
import { SummaryCard, today, yuan } from "./_shared";
import { fetchDailyIncome, matchIncomeToMembers, type DailyIncomeResult } from "./dailyIncome";

type Team = NonNullable<ReturnType<typeof useTeams>["data"]>[number];

/** 单条业绩调整项：自定义名称 + 数值（允许正负）。 */
export type PerfAdjustment = {
  id: string;
  name: string;
  amount: string;
};

/** 团队版单成员行：绩效点 + 业绩 + 调整项 + 无绩效勾选 + 停播文本。 */
export type TeamMemberRow = {
  profileId: string;
  name: string;
  douyinId: string;
  pointId: string;
  pointsAmount: string;
  adjustments: PerfAdjustment[];
  noPerf: boolean;
  noPerfNote: string;
};

/** 生成调整项唯一 id。 */
function makeAdjId() {
  return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
}

/** 累加一行的有效调整项数值（空/非法按 0）。 */
function sumAdjustments(list: PerfAdjustment[]): number {
  return (list ?? []).reduce((sum, a) => {
    const v = Number(a.amount);
    return sum + (Number.isFinite(v) ? v : 0);
  }, 0);
}

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
  // 当前展开调整项面板的成员（null 表示全部收起）。
  const [expandedAdjId, setExpandedAdjId] = useState<string | null>(null);

  // —— 接口流水拉取（daily-income） ——
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [incomeResult, setIncomeResult] = useState<DailyIncomeResult | null>(null);
  /** incomeResult 对应的请求日期：与表单日期不一致即视为过期，禁止填充。 */
  const [incomeDate, setIncomeDate] = useState<string | null>(null);
  /** 请求序号：只认最后一次请求的结果，避免并发响应乱序覆盖。 */
  const fetchSeqRef = useRef(0);

  // 表单日期必须合法且不能晚于今天（未来日期不可能有流水）。
  const teamDateValid = /^\d{4}-\d{2}-\d{2}$/.test(teamDate) && teamDate <= today();
  // 拉取后用户又改了日期：旧数据不能填，也不能冒充新日期的数据。
  const incomeStale = !!incomeResult && incomeDate !== teamDate;

  const teamMembers = useMemo(() => {
    const list = (selectedTeam?.members ?? []).filter((m) => m.profile).map((m) => m.profile!);
    return list.map((m) => {
      const existing = memberRows[m.id];
      return existing
        ? { ...existing, name: m.name, douyinId: m.douyin_id ?? existing.douyinId ?? "" }
        : {
            profileId: m.id,
            name: m.name,
            douyinId: m.douyin_id ?? "",
            pointId: teamDefaultPointId,
            pointsAmount: "",
            adjustments: [],
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

  // —— 调整项操作 ——
  const addAdjustment = (profileId: string, preset?: { name: string; amount: string }) => {
    const base = teamMembers.find((m) => m.profileId === profileId);
    if (!base) return;
    const current = (memberRows[profileId]?.adjustments ?? base.adjustments) ?? [];
    const next: PerfAdjustment = { id: makeAdjId(), name: preset?.name ?? "", amount: preset?.amount ?? "" };
    updateMember(profileId, { adjustments: [...current, next] });
    setExpandedAdjId(profileId);
  };
  const updateAdjustment = (profileId: string, id: string, patch: Partial<PerfAdjustment>) => {
    const base = teamMembers.find((m) => m.profileId === profileId);
    if (!base) return;
    const current = (memberRows[profileId]?.adjustments ?? base.adjustments) ?? [];
    updateMember(profileId, { adjustments: current.map((a) => (a.id === id ? { ...a, ...patch } : a)) });
  };
  const removeAdjustment = (profileId: string, id: string) => {
    const base = teamMembers.find((m) => m.profileId === profileId);
    if (!base) return;
    const current = (memberRows[profileId]?.adjustments ?? base.adjustments) ?? [];
    updateMember(profileId, { adjustments: current.filter((a) => a.id !== id) });
  };

  // 总业绩 = 业绩 + 调整项累加（无绩效行为 0）。
  const totalPointsOf = (m: TeamMemberRow): number => {
    if (m.noPerf) return 0;
    return (Number(m.pointsAmount) || 0) + sumAdjustments(m.adjustments);
  };

  const teamRateOf = (pointId: string) => teamPoints.find((p) => p.id === pointId)?.rate ?? 0;
  const teamRevenueYuanOf = (m: TeamMemberRow): number => {
    if (m.noPerf) return 0;
    const rate = teamRateOf(m.pointId || teamDefaultPointId);
    const amount = totalPointsOf(m);
    return rate > 0 ? amount / rate : 0;
  };
  const teamValidMembers = teamMembers.filter((m) => m.noPerf || Number(m.pointsAmount) > 0 || m.adjustments.length > 0);
  // 开播时长必须在 (0, 24] 区间内。
  const broadcastHoursValue = Number(broadcastHours);
  const broadcastHoursValid = broadcastHours !== "" && broadcastHoursValue > 0 && broadcastHoursValue <= 24;
  const canSubmitTeam =
    !!hostProfileId && !!selectedTeamId && !!teamDate && broadcastHoursValid && teamValidMembers.length > 0 && !(createTeam.isPending || replaceTeam.isPending);

  // —— 拉取接口流水（按日期表单的日期取数） ——
  const handleFetchIncome = async () => {
    if (!selectedTeam || fetching) return;
    if (!teamDateValid) {
      setIncomeResult(null);
      setIncomeDate(null);
      setFetchError("请先选择有效日期（不能晚于今天）");
      return;
    }
    const requestDate = teamDate;
    const seq = ++fetchSeqRef.current;
    setFetching(true);
    setFetchError(null);
    setIncomeResult(null);
    setIncomeDate(null);
    try {
      const result = await fetchDailyIncome(selectedTeam.team_key, requestDate);
      if (seq !== fetchSeqRef.current) return; // 期间又发起了新请求，丢弃本次结果
      setIncomeResult(result);
      setIncomeDate(requestDate);
    } catch (err) {
      if (seq !== fetchSeqRef.current) return;
      setFetchError((err as Error).message || "拉取失败，请稍后再试");
    } finally {
      if (seq === fetchSeqRef.current) setFetching(false);
    }
  };

  // 接口结果与成员按抖音号匹配的预览：已匹配（可填充）+ 未匹配。
  const incomeMatch = useMemo(() => {
    if (!incomeResult) return null;
    const { matched, unmatched } = matchIncomeToMembers(incomeResult.anchors, teamMembers);
    return {
      matched: matched.map(({ member, anchor }) => ({
        profileId: member.profileId,
        name: member.name,
        douyinId: member.douyinId,
        nickname: anchor.nickname,
        income: anchor.income,
      })),
      unmatched,
    };
  }, [incomeResult, teamMembers]);

  // —— 一键填充：把匹配到的流水填入对应主播的“业绩”栏（不换算） ——
  const handleApplyIncome = () => {
    // 日期已被改动时结果作废，避免把旧日期的流水填进新日期。
    if (incomeStale || !incomeMatch?.matched.length) return;
    setMemberRows((prev) => {
      const next = { ...prev };
      incomeMatch.matched.forEach((row) => {
        const base = teamMembers.find((m) => m.profileId === row.profileId);
        if (!base) return;
        next[row.profileId] = {
          ...base,
          ...prev[row.profileId],
          pointsAmount: String(Math.round(row.income)),
          noPerf: false,
        };
      });
      return next;
    });
    // 若接口带回开播时长且当前未填，则自动带出（分钟 → 小时）。
    if (incomeResult && incomeResult.liveDuration > 0 && broadcastHours === "") {
      setBroadcastHours((incomeResult.liveDuration / 60).toFixed(1));
    }
  };


  const handleSubmitTeam = () => {
    if (!hostProfileId || !selectedTeamId) return;
    if (!broadcastHoursValid) return;
    const items = teamValidMembers.map((m) => {
      const pointId = m.pointId || teamDefaultPointId;
      return {
        profileId: m.profileId,
        pointId,
        pointsAmount: m.noPerf ? 0 : totalPointsOf(m),
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
      // 汇总口径为「总业绩 = 业绩 + 调整项」。
      const amount = totalPointsOf(m);
      if (amount === 0 && !(Number(m.pointsAmount) > 0) && !m.adjustments.length) return;
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
                  onChange={(e) => { setTeamId(e.target.value); setMemberRows({}); setIncomeResult(null); setIncomeDate(null); setFetchError(null); }}
                  className={controlClass}
                  disabled={isEditMode}
                >
                  {myTeams.map((t) => <option key={t.id} value={t.id}>{t.name}（ID：{t.team_key}）</option>)}
                </select>
              </label>
            ) : null}
            {selectedTeam ? (
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-lg bg-slate-50 px-3 py-2">
                <span className="text-sm font-medium text-slate-900">{selectedTeam.name}</span>
                <span className="text-xs text-slate-400">ID：{selectedTeam.team_key}</span>
              </div>
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
                {teamDate && !teamDateValid ? (
                  <span className="mt-1 block text-xs text-danger">日期不能晚于今天</span>
                ) : null}
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

      {/* 接口流水：按日期表单的日期拉取、按抖音号匹配、一键填充 */}
      {!isEditMode ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <span className="text-sm font-semibold text-slate-900">主播流水（接口获取）</span>
            <Button
              variant="secondary"
              size="sm"
              disabled={!selectedTeam || !teamDateValid || fetching}
              onClick={handleFetchIncome}
            >
              {fetching ? "获取中…" : incomeResult ? "重新获取" : "获取接口数据"}
            </Button>
          </div>
          <Card>
            <CardContent className="space-y-2 !px-3 !py-2.5">
              {fetchError ? (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-danger">{fetchError}</p>
              ) : null}

              {incomeStale ? (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
                  日期已改为 {teamDate || "（空）"}，已获取的是 {incomeDate} 的流水，请重新获取后再填充。
                </p>
              ) : null}

              {!incomeResult && !fetchError ? (
                <p className="text-xs text-slate-400">
                  点击「获取接口数据」，按团队 ID（{selectedTeam?.team_key ?? "-"}）拉取
                  {teamDate ? ` ${teamDate} ` : "所选日期"}各房间流水，系统会按抖音号匹配到团队成员。
                </p>
              ) : null}

              {incomeResult && !incomeStale && !incomeResult.hasLive ? (
                <p className="text-sm text-slate-500">接口返回 {incomeResult.date} 无直播记录。</p>
              ) : null}

              {incomeResult && !incomeStale && incomeResult.hasLive ? (
                <div className="space-y-2">
                  <div className="text-xs text-slate-500">
                    日期 {incomeResult.date} · 开播 {(incomeResult.liveDuration / 60).toFixed(1)} 小时 · 识别 {incomeResult.anchors.length} 位主播
                  </div>

                  {/* 已匹配 */}
                  {incomeMatch?.matched.length ? (
                    <div className="space-y-1 rounded-lg bg-slate-50 p-2">
                      <div className="text-xs font-medium text-slate-600">可填充（{incomeMatch.matched.length}）</div>
                      {incomeMatch.matched.map((r) => (
                        <div key={r.profileId} className="flex items-center justify-between gap-2 text-sm">
                          <span className="min-w-0 truncate text-slate-800">
                            {r.name}
                            <span className="ml-1 text-xs text-slate-400">抖音号 {r.douyinId}</span>
                          </span>
                          <span className="shrink-0 tabular-nums font-medium text-indigo-700">{yuan(r.income)}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-amber-600">未匹配到任何团队成员（请到「主播管理」为成员填写接口返回的抖音号 / user_id）。</p>
                  )}

                  {/* 未匹配（接口有但团队无对应抖音号） */}
                  {incomeMatch?.unmatched.length ? (
                    <div className="space-y-1 rounded-lg bg-amber-50 p-2">
                      <div className="text-xs font-medium text-amber-700">未匹配（{incomeMatch.unmatched.length}，接口有数据但无对应成员）</div>
                      {incomeMatch.unmatched.map((a, i) => (
                        <div key={a.douyinId || a.userId || i} className="flex items-center justify-between gap-2 text-xs text-amber-800">
                          <span className="min-w-0 truncate">{a.nickname || "未知"}{a.douyinId || a.userId ? `（${a.douyinId || a.userId}）` : ""}</span>
                          <span className="shrink-0 tabular-nums">{yuan(a.income)}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  <Button
                    className="w-full"
                    size="sm"
                    disabled={!incomeMatch?.matched.length}
                    onClick={handleApplyIncome}
                  >
                    确认无误，一键填充到主播业绩（{incomeMatch?.matched.length ?? 0} 人）
                  </Button>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>
      ) : null}

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
          <div className="space-y-2">
            {teamMembers.map((m) => {
              const adjTotal = sumAdjustments(m.adjustments);
              const total = totalPointsOf(m);
              const expanded = expandedAdjId === m.profileId;
              return (
                <Card key={m.profileId} className={m.noPerf ? "bg-amber-50/60" : ""}>
                  <CardContent className="space-y-2 !px-3 !py-2.5">
                    {/* 头部：姓名 + 停播开关 */}
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900">{m.name}</span>
                      <label className="flex shrink-0 items-center gap-1 text-xs text-slate-500">
                        <input
                          type="checkbox"
                          checked={m.noPerf}
                          onChange={(e) => updateMember(m.profileId, { noPerf: e.target.checked })}
                          className="size-4 accent-amber-500"
                          aria-label={`${m.name} 停播`}
                        />
                        停播
                      </label>
                    </div>

                    {m.noPerf ? (
                      <Input
                        size="sm"
                        maxLength={20}
                        placeholder="停播备注"
                        value={m.noPerfNote}
                        onChange={(e) => updateMember(m.profileId, { noPerfNote: e.target.value.slice(0, 20) })}
                      />
                    ) : (
                     <>
                        {/* 种类 / 业绩 / 总业绩 一行紧凑排布 */}
                        <div className="grid grid-cols-2 items-end gap-2">
                          <label className="min-w-0 block">
                            <span className="mb-1 block text-xs text-slate-400">种类</span>
                            <SelectMenu
                              value={m.pointId || teamDefaultPointId}
                              options={teamPoints}
                              onChange={(id) => updateMember(m.profileId, { pointId: id })}
                            />
                          </label>
                          <label className="block">
                            <span className="mb-1 block text-xs text-slate-400">业绩</span>
                            <Input
                              size="sm"
                              type="number"
                              min={0}
                              step="1"
                              placeholder="业绩"
                              value={m.pointsAmount}
                              onChange={(e) => updateMember(m.profileId, { pointsAmount: e.target.value })}
                            />
                          </label>
                        </div>

                        {/* 调整项 + 总业绩 */}
                        <div className="flex items-center justify-between gap-2">
                          <button
                            type="button"
                            aria-expanded={expanded}
                            onClick={() => setExpandedAdjId(expanded ? null : m.profileId)}
                            className="flex items-center gap-1 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 transition hover:border-indigo-300 hover:bg-indigo-50"
                          >
                            <span className="text-slate-400">调整项</span>
                            {m.adjustments.length ? (
                              <span className={`tabular-nums ${adjTotal < 0 ? "text-red-600" : adjTotal > 0 ? "text-emerald-600" : "text-slate-500"}`}>
                                {adjTotal > 0 ? "+" : ""}{adjTotal}（{m.adjustments.length}项）
                              </span>
                            ) : (
                              <span className="text-indigo-600">+ 添加</span>
                            )}
                            <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={`size-3.5 text-slate-400 transition-transform ${expanded ? "rotate-180" : ""}`}>
                              <path d="M6 8l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          </button>
                          <span className="whitespace-nowrap text-sm">
                            <span className="text-xs text-slate-400">总业绩 </span>
                            <span className="font-semibold tabular-nums text-slate-900">{total}</span>
                          </span>
                        </div>

                        {expanded ? (
                          <div className="space-y-2 rounded-lg bg-slate-50 p-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                onClick={() => addAdjustment(m.profileId, { name: "运营票", amount: "" })}
                                className="rounded-md border border-indigo-200 bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-700 transition hover:bg-indigo-100"
                              >
                                + 运营票
                              </button>
                              <button
                                type="button"
                                onClick={() => addAdjustment(m.profileId)}
                                className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-100"
                              >
                                + 自定义
                              </button>
                            </div>
                            {m.adjustments.length ? (
                              <div className="space-y-2">
                                {m.adjustments.map((a) => (
                                  <div key={a.id} className="flex items-center gap-2">
                                    <Input
                                      size="sm"
                                      className="min-w-0 flex-1"
                                      placeholder="名称，如：运营票"
                                      value={a.name}
                                      onChange={(e) => updateAdjustment(m.profileId, a.id, { name: e.target.value })}
                                    />
                                    <Input
                                      size="sm"
                                      type="number"
                                      step="1"
                                      className="w-20 shrink-0"
                                      placeholder="数值"
                                      value={a.amount}
                                      onChange={(e) => updateAdjustment(m.profileId, a.id, { amount: e.target.value })}
                                    />
                                    <button
                                      type="button"
                                      onClick={() => removeAdjustment(m.profileId, a.id)}
                                      aria-label={`删除调整项 ${a.name || ""}`}
                                      className="shrink-0 rounded px-2 py-1 text-xs text-slate-400 transition hover:bg-red-50 hover:text-red-600"
                                    >
                                      删除
                                    </button>
                                  </div>
                                ))}
                                <div className="flex justify-between border-t border-slate-200 pt-2 text-xs">
                                  <span className="text-slate-500">调整合计</span>
                                  <span className={`tabular-nums font-medium ${adjTotal < 0 ? "text-red-600" : adjTotal > 0 ? "text-emerald-600" : "text-slate-700"}`}>{adjTotal > 0 ? "+" : ""}{adjTotal}</span>
                                </div>
                              </div>
                            ) : (
                              <p className="text-xs text-slate-400">点击「运营票」或「自定义」新增调整项，数值可正可负。</p>
                            )}
                          </div>
                        ) : null}
                      </>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
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