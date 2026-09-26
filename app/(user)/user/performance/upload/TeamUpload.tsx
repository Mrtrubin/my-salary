"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useCreateTeamPerformanceRecords, useReplaceTeamPerformanceRecords, useTeams } from "@/lib/api/hooks";
import { today, yuan } from "./_shared";
import { formatDurationSeconds } from "@/lib/format";
import { OFF_AIR_NOTE, REST_NOTE, recordFromStatus, type MemberPerfStatus } from "@/lib/domain/performance/status";
import { buildPerformanceCopyText, type PerfCopyMember } from "../performanceCopy";
import { fetchDailyIncome, matchIncomeToMembers, type DailyIncomeResult } from "./dailyIncome";

type Team = NonNullable<ReturnType<typeof useTeams>["data"]>[number];

/** 单条业绩调整项：自定义名称 + 数值（允许正负）。 */
export type PerfAdjustment = {
  id: string;
  name: string;
  amount: string;
};

/** 团队版单成员行：绩效点 + 业绩 + 调整项 + 三种情况（正常 / 休息 / 停播）。 */
export type TeamMemberRow = {
  profileId: string;
  name: string;
  douyinId: string;
  pointId: string;
  pointsAmount: string;
  adjustments: PerfAdjustment[];
  /** 当日情况：正常流水 / 休息（不扣薪）/ 停播（结算按 初始保底/26 扣款）。 */
  status: MemberPerfStatus;
  /** 休息备注（仅休息情况使用）。 */
  restNote: string;
  /** 该主播当日直播时长（小时，字符串便于输入）。 */
  broadcastHours: string;
};

/** 非正常流水（休息 / 停播）均不录入业绩。 */
const isNoPerf = (status: MemberPerfStatus) => status !== "normal";

/** 直播时长合法性：0 不含，且不超过 24 小时。 */
function isBroadcastHoursValid(value: string): boolean {
  if (value.trim() === "") return false;
  const hours = Number(value);
  return Number.isFinite(hours) && hours > 0 && hours <= 24;
}

/** 单成员「情况」切换项。 */
const STATUS_OPTIONS: { value: MemberPerfStatus; label: string; activeClass: string }[] = [
  { value: "normal", label: "正常", activeClass: "bg-indigo-600 text-white" },
  { value: "rest", label: "休息", activeClass: "bg-amber-500 text-white" },
  { value: "offair", label: "停播", activeClass: "bg-red-600 text-white" },
];

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
    return list.map((m): TeamMemberRow => {
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
            status: "normal",
            restNote: REST_NOTE,
            broadcastHours: "",
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

  // 总业绩 = 业绩 + 调整项累加（休息/停播行为 0）。
  const totalPointsOf = (m: TeamMemberRow): number => {
    if (isNoPerf(m.status)) return 0;
    return (Number(m.pointsAmount) || 0) + sumAdjustments(m.adjustments);
  };

  const teamRateOf = (pointId: string) => teamPoints.find((p) => p.id === pointId)?.rate ?? 0;
  const teamRevenueYuanOf = (m: TeamMemberRow): number => {
    if (isNoPerf(m.status)) return 0;
    const rate = teamRateOf(m.pointId || teamDefaultPointId);
    const amount = totalPointsOf(m);
    return rate > 0 ? amount / rate : 0;
  };
  // 只有「信息填全」的主播才会被上传：休息/停播一定记录；正常流水需填合法直播时长且有业绩或调整项。
  // 没填全的视为「本次不需要上传」——提交时跳过、不更新其记录，也不阻塞其他人的提交。
  const membersToSubmit = teamMembers.filter((m) =>
    isNoPerf(m.status)
      ? true
      : isBroadcastHoursValid(m.broadcastHours) && (Number(m.pointsAmount) > 0 || m.adjustments.length > 0),
  );
  const canSubmitTeam =
    !!hostProfileId && !!selectedTeamId && !!teamDate && membersToSubmit.length > 0 && !(createTeam.isPending || replaceTeam.isPending);

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
      const result = await fetchDailyIncome(
        { teamId: selectedTeam.id, teamCode: selectedTeam.team_code },
        requestDate,
      );
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

  // —— 一键填充：把匹配到的流水填入对应主播的“业绩”栏（不换算），
  //    并把匹配到的主播直播时长统一改为接口返回的当日时长（秒 → 小时，正数）。
  //    接口流水为 0 的主播视为停播（无流水、按初始保底/26 扣款）。 ——
  const handleApplyIncome = () => {
    // 日期已被改动时结果作废，避免把旧日期的流水填进新日期。
    if (incomeStale || !incomeMatch?.matched.length) return;
    const liveSeconds = incomeResult?.liveDurationSeconds ?? 0;
    const liveHoursText = liveSeconds > 0 ? (liveSeconds / 3600).toFixed(2) : null;
    setMemberRows((prev) => {
      const next = { ...prev };
      incomeMatch.matched.forEach((row) => {
        const base = teamMembers.find((m) => m.profileId === row.profileId);
        if (!base) return;
        const offAir = !(row.income > 0);
        next[row.profileId] = {
          ...base,
          ...prev[row.profileId],
          pointsAmount: offAir ? "" : String(Math.round(row.income)),
          status: offAir ? "offair" : "normal",
          broadcastHours: offAir ? "" : (liveHoursText ?? base.broadcastHours),
        };
      });
      return next;
    });
  };


  const handleSubmitTeam = () => {
    if (!hostProfileId || !selectedTeamId) return;
    const items = membersToSubmit.map((m) => {
      const pointId = m.pointId || teamDefaultPointId;
      const record = recordFromStatus(m.status, m.restNote);
      const rate = teamRateOf(pointId);
      // 调整项折算金额（分）：调整点数 ÷ 换算率 × 100。
      const adjustmentCents = record.noPerf || rate <= 0 ? 0 : Math.round((sumAdjustments(m.adjustments) / rate) * 100);
      return {
        profileId: m.profileId,
        pointId,
        pointsAmount: record.noPerf ? 0 : totalPointsOf(m),
        revenueCents: Math.round(teamRevenueYuanOf(m) * 100),
        broadcastMinutes: record.noPerf ? 0 : Math.round((Number(m.broadcastHours) || 0) * 60),
        adjustmentCents,
        noPerf: record.noPerf,
        noPerfNote: record.noPerfNote ?? undefined,
      };
    });
    const input = {
      teamId: selectedTeamId,
      hostProfileId,
      perfDate: teamDate,
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

  // —— 提交汇总（与业绩卡片复制格式一致，可复制） ——
  const [summaryCopied, setSummaryCopied] = useState(false);
  const summaryText = useMemo(() => {
    const members: PerfCopyMember[] = membersToSubmit.map((m) => {
      const pointId = m.pointId || teamDefaultPointId;
      return {
        name: m.name,
        noPerf: isNoPerf(m.status),
        note:
          m.status === "offair"
            ? OFF_AIR_NOTE
            : m.status === "rest"
              ? (m.restNote.trim() || REST_NOTE)
              : null,
        pointsAmount: totalPointsOf(m),
        pointId,
        pointName: teamPoints.find((p) => p.id === pointId)?.name ?? null,
      };
    });
    // 卡片口径：当日「总开播时」取各主播时长的最大值。
    const broadcastMinutes = membersToSubmit.reduce(
      (max, m) => (isNoPerf(m.status) ? max : Math.max(max, Math.round((Number(m.broadcastHours) || 0) * 60))),
      0,
    );
    return buildPerformanceCopyText({
      perfDate: teamDate,
      teamName: selectedTeam?.name ?? "",
      broadcastMinutes,
      members,
    });
  }, [membersToSubmit, teamDate, selectedTeam, teamPoints, teamDefaultPointId]);

  const handleCopySummary = async () => {
    try {
      await navigator.clipboard.writeText(summaryText);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = summaryText;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setSummaryCopied(true);
    setTimeout(() => setSummaryCopied(false), 1500);
  };

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
                  {myTeams.map((t) => <option key={t.id} value={t.id}>{t.name}（ID：{t.team_code}）</option>)}
                </select>
              </label>
            ) : null}
            {selectedTeam ? (
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-lg bg-slate-50 px-3 py-2">
                <span className="text-sm font-medium text-slate-900">{selectedTeam.name}</span>
                <span className="text-xs text-slate-400">ID：{selectedTeam.team_code}</span>
              </div>
            ) : null}
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
          </CardContent>
        </Card>
      </div>

      {/* 当日信息：按日期拉取主播流水 + 当日总直播时长（所有直播间），按抖音号匹配、一键填充（新增/编辑均可用） */}
      <div className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <span className="text-sm font-semibold text-slate-900">当日信息（接口获取）</span>
            <Button
              variant="secondary"
              size="sm"
              disabled={!selectedTeam || !teamDateValid || fetching}
              onClick={handleFetchIncome}
            >
              {fetching ? "获取中…" : incomeResult ? "重新获取" : "获取当日信息"}
            </Button>
          </div>
          <Card>
            <CardContent className="space-y-2 !px-3 !py-2.5">
              {fetchError ? (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-danger">{fetchError}</p>
              ) : null}

              {incomeStale ? (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
                  日期已改为 {teamDate || "（空）"}，已获取的是 {incomeDate} 的当日信息，请重新获取后再填充。
                </p>
              ) : null}

              {!incomeResult && !fetchError ? (
                <p className="text-xs text-slate-400">
                  点击「获取当日信息」，按团队 ID（{selectedTeam?.team_code ?? "-"}）拉取
                  {teamDate ? ` ${teamDate} ` : "所选日期"}的主播流水与当日总直播时长（所有直播间），
                  系统会按抖音号匹配到团队成员。
                </p>
              ) : null}

              {incomeResult && !incomeStale && !incomeResult.hasLive ? (
                <p className="text-sm text-slate-500">接口返回 {incomeResult.date} 无直播记录。</p>
              ) : null}

              {incomeResult && !incomeStale && incomeResult.hasLive ? (
                <div className="space-y-2">
                  <div className="text-xs text-slate-500">
                    日期 {incomeResult.date} · 当日总直播时长{" "}
                    {formatDurationSeconds(incomeResult.liveDurationSeconds)}（所有直播间） · 识别{" "}
                    {incomeResult.anchors.length} 位主播
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

      {/* 成员业绩录入 */}
      <div className="space-y-2">
        <div className="flex items-center justify-between px-1">
          <span className="text-sm font-semibold text-slate-900">成员业绩</span>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
            共 {teamMembers.length} 人 · 已填 {membersToSubmit.length} 人
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
                <Card key={m.profileId} className={m.status === "offair" ? "bg-red-50/60" : m.status === "rest" ? "bg-amber-50/60" : ""}>
                  <CardContent className="space-y-2 !px-3 !py-2.5">
                    {/* 头部：姓名 + 三种情况切换 */}
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900">{m.name}</span>
                      <div
                        role="group"
                        aria-label={`${m.name} 情况`}
                        className="flex shrink-0 overflow-hidden rounded-lg border border-slate-200"
                      >
                        {STATUS_OPTIONS.map((option) => (
                          <button
                            key={option.value}
                            type="button"
                            aria-pressed={m.status === option.value}
                            onClick={() => updateMember(m.profileId, { status: option.value })}
                            className={`px-2.5 py-1 text-xs transition ${
                              m.status === option.value
                                ? option.activeClass
                                : "bg-white text-slate-500 hover:bg-slate-50"
                            }`}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {m.status === "rest" ? (
                      <Input
                        size="sm"
                        maxLength={20}
                        placeholder="休息备注"
                        value={m.restNote}
                        onChange={(e) => updateMember(m.profileId, { restNote: e.target.value.slice(0, 20) })}
                      />
                    ) : m.status === "offair" ? (
                      <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">
                        无流水，结算时按初始保底 ÷ 26 自动生成「停播」扣款。
                      </p>
                    ) : (
                     <>
                        {/* 种类 / 业绩 一行紧凑排布 */}
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

                        {/* 直播时长（每主播单独） */}
                        <label className="block">
                          <span className="mb-1 block text-xs text-slate-400">直播时长（小时）</span>
                          <Input
                            size="sm"
                            type="number"
                            min={0.1}
                            max={24}
                            step="0.5"
                            placeholder="0~24"
                            value={m.broadcastHours}
                            onChange={(e) => updateMember(m.profileId, { broadcastHours: e.target.value })}
                          />
                          {m.broadcastHours !== "" && !isBroadcastHoursValid(m.broadcastHours) ? (
                            <span className="mt-1 block text-xs text-danger">需大于 0 且不超过 24 小时</span>
                          ) : null}
                        </label>

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

      {/* 提交汇总：与业绩卡片复制格式一致，提交前可复制核对 */}
      <div className="space-y-2">
        <div className="flex items-center justify-between px-1">
          <span className="text-sm font-semibold text-slate-900">提交汇总</span>
          <Button size="sm" variant="secondary" onClick={handleCopySummary} disabled={!membersToSubmit.length}>
            {summaryCopied ? "已复制" : "复制"}
          </Button>
        </div>
        <Card>
          <CardContent className="space-y-2 !px-3 !py-3">
            {membersToSubmit.length ? (
              <pre className="whitespace-pre-wrap break-words rounded-lg bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-700">
                {summaryText}
              </pre>
            ) : (
              <p className="text-xs text-slate-400">
                暂无可提交内容：请填写业绩与直播时长，或标记为休息 / 停播。
              </p>
            )}
            <p className="text-xs text-slate-400">
              未填全信息的主播视为「本次不需要上传」，提交时会被跳过、不更新其记录。
            </p>
          </CardContent>
        </Card>
      </div>

      {(createTeam.error || replaceTeam.error) ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-danger">
          提交失败：{(createTeam.error ?? replaceTeam.error as Error).message}
        </p>
      ) : null}

      <Button className="w-full" disabled={!canSubmitTeam} onClick={handleSubmitTeam}>
        {createTeam.isPending || replaceTeam.isPending ? "提交中…" : `${isEditMode ? "重新提交" : "提交主播流水"}${membersToSubmit.length ? `（${membersToSubmit.length} 人）` : ""}`}
      </Button>
    </div>
  );
}