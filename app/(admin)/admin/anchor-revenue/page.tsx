"use client";

import { Fragment, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { QueryMessage } from "@/components/query-message";
import { PageHeader } from "@/components/ui/stat-card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useTeams, useAnchorRevenuePerf, useAnchorSettlementContexts, useSettleAnchorRevenue, useTeamEarliestPerfDate, useSystemSettlementSettings } from "@/lib/api/hooks";
import { resolveSystemPeriod, settlementMemberKey } from "@/lib/api/data";
import type { AnchorSettleMember, AnchorRevenuePerfRow, SystemSettlementSettings } from "@/lib/api/data";
import { getPeriodRange, getPreviousPeriodRange } from "@/lib/domain/settlement/cycle";
import type { PeriodRange } from "@/lib/domain/settlement/cycle";
import { aggregateSettlement } from "@/lib/domain/settlement/aggregate";
import { applyAdjustments, getAdjustmentPresets, parseAdjustmentAmountYuan } from "@/lib/domain/payroll/adjustment";
import type { PayrollAdjustment } from "@/lib/domain/payroll/adjustment";
import { calculateAnchorPayroll, parseCommissionBonusPoints } from "@/lib/domain/payroll/anchor";
import { formatCentsToYuan, formatDate } from "@/lib/format";

/** 周期下拉可选的历史周期数量（含当前周期）。 */
const PERIOD_OPTION_COUNT = 12;

/** 编辑草稿与结算数据分离，允许清空名称、金额及连续输入小数。 */
interface AdjustmentDraft {
  id: string;
  name: string;
  direction: "deduction" | "reward";
  amountYuan: string;
}

function toPayrollAdjustment(draft: AdjustmentDraft): PayrollAdjustment | null {
  const amount = parseAdjustmentAmountYuan(draft.amountYuan);
  if (!draft.name.trim() || amount === null) return null;
  return { name: draft.name.trim(), amountCents: draft.direction === "deduction" ? -amount : amount };
}

function validAdjustments(drafts: AdjustmentDraft[]): PayrollAdjustment[] {
  return drafts.map(toPayrollAdjustment).filter((item): item is PayrollAdjustment => item !== null);
}

function signedAmount(cents: number): string {
  return `${cents > 0 ? "+" : ""}${formatCentsToYuan(cents)}`;
}

interface CommissionBonusDraft {
  attendance: string;
  dyTask: string;
}

const BONUS_FIELDS = [
  { key: "attendance", label: "考勤加点" },
  { key: "dyTask", label: "dy任务加点" },
] as const;

/** 单主播的实时试算结果（聚合 + 调整项叠加后）。 */
interface AnchorRow {
  profileId: string;
  positionId: number;
  memberKey: string;
  profileName: string;
  revenueCents: number;
  commissionRateBps: number;
  performanceComponentCents: number;
  guaranteedComponentCents: number;
  adjustmentTotalCents: number;
  grossCents: number;
  netCents: number;
  hasScheme: boolean;
  bonusError: string | null;
}

export default function AnchorRevenuePage() {
  const settings = useSystemSettlementSettings();
  return (
    <>
      <QueryMessage loading={settings.isLoading} error={settings.error} />
      {settings.data && !settings.isError ? (
        <AnchorRevenueWorkspace
          key={`${settings.data.settlement_type}:${settings.data.settlement_start_day}:${settings.data.updated_at}`}
          settings={settings.data}
          settingsRefreshing={settings.isFetching}
        />
      ) : null}
      {settings.isError ? <Button onClick={() => { void settings.refetch(); }}>重试加载系统周期</Button> : null}
    </>
  );
}

function AnchorRevenueWorkspace({ settings, settingsRefreshing }: { settings: SystemSettlementSettings; settingsRefreshing: boolean }) {
  const teamsQuery = useTeams();
  const [teamId, setSelectedTeamId] = useState<string | null>(null);
  // 配置版本变化时整个工作区重新挂载，避免提交旧周期草稿。
  const [anchorDate, setAnchorDate] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bonuses, setBonuses] = useState<Record<string, CommissionBonusDraft>>({});
  const [adjustments, setAdjustments] = useState<Record<string, AdjustmentDraft[]>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [keyword, setKeyword] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  const period = useMemo(() => anchorDate
    ? getPeriodRange(settings.settlement_type, settings.settlement_start_day, anchorDate)
    : resolveSystemPeriod(settings), [settings, anchorDate]);

  // 团队仅筛名单，最早日期与金额均按名单成员的跨团队流水计算。
  const earliestPerfQuery = useTeamEarliestPerfDate(teamId);
  const periodOptions: PeriodRange[] = useMemo(() => {
    const earliestPerfDate = earliestPerfQuery.data ?? null;
    const list: PeriodRange[] = [];
    let cursor = resolveSystemPeriod(settings);
    for (let i = 0; i < PERIOD_OPTION_COUNT; i += 1) {
      list.push(cursor);
      const prev = getPreviousPeriodRange(settings.settlement_type, settings.settlement_start_day, cursor.start);
      if (!earliestPerfDate || prev.end < earliestPerfDate) break;
      cursor = prev;
    }
    return list;
  }, [settings, earliestPerfQuery.data]);

  const perfQuery = useAnchorRevenuePerf(teamId, period);
  const contextsQuery = useAnchorSettlementContexts(teamId, period);
  const settleMutation = useSettleAnchorRevenue();

  // 实时聚合 + 调整项叠加（不落库）。
  const rows: AnchorRow[] = useMemo(() => {
    if (!period || !contextsQuery.data) return [];
    const { members, profileNames } = contextsQuery.data;
    const perfRows = (perfQuery.data ?? [])
      .filter((r) => !r.noPerf)
      .map((r) => ({ profileId: r.profileId, perfDate: r.perfDate, revenueCents: r.revenueCents, createdAt: r.createdAt }));
    const drafts = aggregateSettlement(period, members, perfRows);
    return drafts.map((draft) => {
      const memberKey = settlementMemberKey(draft);
      const ctx = members.find((m) => settlementMemberKey(m) === memberKey)!;
      // 无生效方案：仅展示流水，不计算工资，工资相关列置 0，行标记 hasScheme=false。
      if (!ctx.scheme) {
        return {
          profileId: draft.profileId,
          positionId: draft.positionId,
          memberKey,
          profileName: profileNames[draft.profileId] ?? "—",
          revenueCents: draft.revenueCents,
          commissionRateBps: 0,
          performanceComponentCents: 0,
          guaranteedComponentCents: 0,
          adjustmentTotalCents: 0,
          grossCents: 0,
          netCents: 0,
          hasScheme: false,
          bonusError: null,
        };
      }
      const input = {
        scheme: ctx.scheme,
        monthlyRevenueInCents: draft.revenueCents,
        tenureMonth: draft.tenureMonth,
        lastMonthQualified: ctx.lastMonthQualified,
      };
      const attendanceBonusBps = parseCommissionBonusPoints(bonuses[memberKey]?.attendance ?? "");
      const dyTaskBonusBps = parseCommissionBonusPoints(bonuses[memberKey]?.dyTask ?? "");
      let bonusError: string | null = null;
      let base = calculateAnchorPayroll(input);
      if (attendanceBonusBps === null || dyTaskBonusBps === null) {
        bonusError = "加点须为非负数，最多两位小数，且不能超过存储范围";
      } else {
        try {
          base = calculateAnchorPayroll({ ...input, attendanceBonusBps, dyTaskBonusBps });
        } catch (error) {
          bonusError = error instanceof Error ? error.message : "加点试算失败";
        }
      }
      const adjusted = applyAdjustments(base, validAdjustments(adjustments[memberKey] ?? []));
      return {
        profileId: draft.profileId,
        positionId: draft.positionId,
        memberKey,
        profileName: profileNames[draft.profileId] ?? "—",
        revenueCents: draft.revenueCents,
        commissionRateBps: adjusted.commissionRateBps,
        performanceComponentCents: adjusted.performanceComponentInCents,
        guaranteedComponentCents: adjusted.guaranteedComponentInCents,
        adjustmentTotalCents: adjusted.adjustmentTotalInCents,
        grossCents: adjusted.grossSalaryInCents,
        netCents: adjusted.netSalaryInCents,
        hasScheme: true,
        bonusError,
      };
    });
  }, [period, contextsQuery.data, perfQuery.data, adjustments, bonuses]);

  // 预设常驻，自定义项按名称排序；搜索主播不改变列顺序。
  const adjustmentColumns = useMemo(() => {
    const presets = getAdjustmentPresets(0).map((item) => item.name);
    const names = new Set(Object.values(adjustments).flatMap((items) => items.map((item) => item.name.trim()).filter(Boolean)));
    return [...presets, ...Array.from(names).filter((name) => !presets.includes(name)).sort((a, b) => a.localeCompare(b, "zh-CN"))];
  }, [adjustments]);
  const columnCount = 12 + adjustmentColumns.length;

  const filteredRows = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return rows;
    return rows.filter((r) => r.profileName.toLowerCase().includes(kw));
  }, [rows, keyword]);

  // 可结算行：仅含已配置生效工资方案的主播（无方案行不可勾选、不参与结算）。
  const settleableRows = useMemo(() => filteredRows.filter((r) => r.hasScheme), [filteredRows]);

  // 同一人员的跨团队流水供各岗位查看，交互状态仍按人员与岗位隔离。
  const dailyByProfile = useMemo(() => {
    const map: Record<string, AnchorRevenuePerfRow[]> = {};
    for (const row of perfQuery.data ?? []) {
      if (!row.noPerf) (map[row.profileId] ??= []).push(row);
    }
    return map;
  }, [perfQuery.data]);

  const dataUnavailable = settingsRefreshing || perfQuery.isFetching || contextsQuery.isFetching
    || !perfQuery.isSuccess || !contextsQuery.isSuccess;
  const selectedRows = rows.filter((row) => selectedIds.has(row.memberKey));
  const selectionValid = selectedRows.length === selectedIds.size && selectedRows.every((row) => row.hasScheme);
  const allVisibleSelected = settleableRows.length > 0 && settleableRows.every((row) => selectedIds.has(row.memberKey));

  function clearFeedback() {
    setValidationError(null);
    settleMutation.reset();
  }

  function resetDraft() {
    setSelectedIds(new Set());
    setAdjustments({});
    setBonuses({});
    setExpandedId(null);
    clearFeedback();
  }

  function toggleSelect(memberKey: string) {
    if (!rows.find((row) => row.memberKey === memberKey)?.hasScheme) return;
    clearFeedback();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(memberKey)) next.delete(memberKey);
      else next.add(memberKey);
      return next;
    });
  }

  function toggleSelectAll() {
    clearFeedback();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const row of settleableRows) {
        if (allVisibleSelected) next.delete(row.memberKey);
        else next.add(row.memberKey);
      }
      return next;
    });
  }

  function addAdjustment(memberKey: string, preset: PayrollAdjustment) {
    clearFeedback();
    const draft: AdjustmentDraft = {
      id: crypto.randomUUID(),
      name: preset.name,
      direction: preset.name === "奖励" ? "reward" : "deduction",
      amountYuan: preset.name === "奖励" ? "" : (Math.abs(preset.amountCents) / 100).toFixed(2),
    };
    setAdjustments((prev) => ({ ...prev, [memberKey]: [...(prev[memberKey] ?? []), draft] }));
  }

  function updateAdjustment(memberKey: string, id: string, patch: Partial<AdjustmentDraft>) {
    clearFeedback();
    setAdjustments((prev) => ({
      ...prev,
      [memberKey]: (prev[memberKey] ?? []).map((item) => item.id === id ? { ...item, ...patch } : item),
    }));
  }

  function removeAdjustment(memberKey: string, id: string) {
    clearFeedback();
    setAdjustments((prev) => ({ ...prev, [memberKey]: (prev[memberKey] ?? []).filter((item) => item.id !== id) }));
  }

  function settle() {
    if (settleMutation.isPending) return;
    clearFeedback();
    if (dataUnavailable || !selectedIds.size || !selectionValid) {
      setValidationError("请等待数据加载完成，并重新选择具有生效工资方案的主播。");
      return;
    }
    const invalidBonusRow = selectedRows.find((row) => row.bonusError);
    if (invalidBonusRow) {
      setValidationError(`请检查「${invalidBonusRow.profileName}」的加点：${invalidBonusRow.bonusError}。`);
      return;
    }
    const invalidRow = selectedRows.find((row) => (adjustments[row.memberKey] ?? []).some((item) => !toPayrollAdjustment(item)));
    if (invalidRow) {
      setExpandedId(invalidRow.memberKey);
      setValidationError(`请完善「${invalidRow.profileName}」的调整项：名称不能为空，金额须为非负数且最多两位小数。`);
      return;
    }
    const members: AnchorSettleMember[] = selectedRows.map((row) => ({
      profileId: row.profileId,
      positionId: row.positionId,
      attendanceBonusBps: parseCommissionBonusPoints(bonuses[row.memberKey]?.attendance ?? "")!,
      dyTaskBonusBps: parseCommissionBonusPoints(bonuses[row.memberKey]?.dyTask ?? "")!,
      adjustments: validAdjustments(adjustments[row.memberKey] ?? []),
    }));
    settleMutation.mutate({ teamId, period, members }, {
      onSuccess: () => {
        setSelectedIds(new Set());
        setAdjustments({});
        setBonuses({});
        setExpandedId(null);
      },
    });
  }

  return (
    <>
      <PageHeader title="主播流水" description="按结算周期实时聚合每位主播的流水与工资，支持添加调整项后勾选结算进入工资待审核" />
      <Card>
        <CardHeader title="流水结算" />
        <CardContent className="p-0">
          <div className="flex flex-wrap items-center gap-3 p-4">
            <select
              value={teamId ?? ""}
              onChange={(event) => { setSelectedTeamId(event.target.value || null); setAnchorDate(null); resetDraft(); }}
              disabled={settleMutation.isPending}
              aria-label="团队名单筛选"
              className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100"
            >
              <option value="">全部主播</option>
              {(teamsQuery.data ?? []).map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
            {period ? (
              <select
                value={period.start}
                onChange={(event) => {
                  setAnchorDate(event.target.value);
                  resetDraft();
                }}
                disabled={settleMutation.isPending || earliestPerfQuery.isFetching}
                aria-label="系统结算周期"
                className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100"
              >
                {periodOptions.map((p, index) => (
                  <option key={p.start} value={p.start}>
                    {formatDate(p.start)} ~ {formatDate(p.end)}{index === 0 ? "（当前）" : ""}
                  </option>
                ))}
              </select>
            ) : null}
          </div>

          <p className="px-4 pb-3 text-sm text-slate-500">统一使用系统周期；团队仅筛选主播名单，流水跨团队汇总。工资全部由管理员勾选后手动结算。</p>
          <QueryMessage loading={teamsQuery.isLoading || earliestPerfQuery.isLoading} error={teamsQuery.error || earliestPerfQuery.error} />
          {validationError || settleMutation.isError ? (
            <p role="alert" className="px-4 pb-3 text-sm text-red-600">{validationError ?? settleMutation.error?.message}</p>
          ) : null}
          {settleMutation.isSuccess ? <p role="status" className="px-4 pb-3 text-sm text-emerald-600">结算成功，工资已进入待审核。</p> : null}
          {!selectionValid ? (
            <div role="alert" className="flex items-center gap-3 px-4 pb-3 text-sm text-amber-700">
              部分已选主播或工资方案已变更，请清空选择后重新勾选。
              <Button variant="secondary" disabled={settleMutation.isPending} onClick={resetDraft}>清空选择与调整</Button>
            </div>
          ) : null}
          <fieldset disabled={settleMutation.isPending || dataUnavailable} className="min-w-0">
              <div className="flex flex-wrap items-center justify-between gap-3 px-4 pb-3">
                <Input
                  className="max-w-xs"
                  placeholder="搜索主播姓名"
                  value={keyword}
                  onChange={(event) => setKeyword(event.target.value)}
                />
                <Button
                  variant="primary"
                  disabled={!selectedIds.size || !selectionValid || dataUnavailable || settleMutation.isPending}
                  onClick={settle}
                >
                  结算所选（{selectedIds.size}）
                </Button>
              </div>
              <QueryMessage
                loading={perfQuery.isLoading || contextsQuery.isLoading}
                error={perfQuery.error || contextsQuery.error}
                empty={!filteredRows.length}
              />
              <p className="px-4 py-2 text-xs text-slate-500">加点单位为百分点，填 1 表示增加 1 个百分点，空值按 0；达到原提成起征线后生效。同名调整项合并显示，明细中可逐条编辑。</p>
              <Table>
                <THead>
                  <TH isRowHeader>
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      disabled={!settleableRows.length}
                      aria-label="全选当前可结算主播"
                      onChange={toggleSelectAll}
                    />
                  </TH>
                  <TH sticky="left">主播</TH>
                  <TH className="text-left">总流水</TH>
                  <TH className="text-left">考勤加点</TH>
                  <TH className="text-left">dy任务加点</TH>
                  <TH className="text-left">最终提成率</TH>
                  <TH className="text-left">提成</TH>
                  <TH className="text-left">保底</TH>
                  {adjustmentColumns.map((name) => <TH key={name} className="text-left">{name}</TH>)}
                  <TH className="text-left">调整项</TH>
                  <TH className="text-left">总工资</TH>
                  <TH className="text-left">实发</TH>
                  <TH className="text-left">明细</TH>
                </THead>
                <TBody>
                  {filteredRows.map((row) => (
                    <Fragment key={row.memberKey}>
                      <TR>
                        <TD>
                          <input
                            type="checkbox"
                            checked={selectedIds.has(row.memberKey)}
                            onChange={() => toggleSelect(row.memberKey)}
                            disabled={!row.hasScheme}
                            title={row.hasScheme ? undefined : "该主播未配置生效工资方案，无法结算"}
                          />
                        </TD>
                        <TD sticky="left">{row.profileName}</TD>
                        <TD className="text-left whitespace-nowrap">{formatCentsToYuan(row.revenueCents)}</TD>
                        {row.hasScheme ? (
                          <>
                            {BONUS_FIELDS.map(({ key, label }) => (
                              <TD key={key} className="min-w-40 align-top">
                                <Input
                                  inputMode="decimal"
                                  aria-label={`${row.profileName}的${label}（百分点）`}
                                  aria-invalid={parseCommissionBonusPoints(bonuses[row.memberKey]?.[key] ?? "") === null}
                                  aria-describedby={row.bonusError ? `${row.memberKey}-bonus-error` : undefined}
                                  value={bonuses[row.memberKey]?.[key] ?? ""}
                                  placeholder="0"
                                  disabled={dataUnavailable || settleMutation.isPending}
                                  onChange={(event) => {
                                    const value = event.target.value;
                                    clearFeedback();
                                    setBonuses((prev) => ({
                                      ...prev,
                                      [row.memberKey]: { ...(prev[row.memberKey] ?? { attendance: "", dyTask: "" }), [key]: value },
                                    }));
                                  }}
                                />
                              </TD>
                            ))}
                            <TD className="text-left whitespace-nowrap">
                              {row.bonusError ? <span id={`${row.memberKey}-bonus-error`} role="status" className="block max-w-52 whitespace-normal text-xs text-red-600">{row.bonusError}，试算暂不可用</span> : `${row.commissionRateBps / 100}%`}
                            </TD>
                            <TD className="text-left whitespace-nowrap">{row.bonusError ? "—" : formatCentsToYuan(row.performanceComponentCents)}</TD>
                            <TD className="text-left whitespace-nowrap">{formatCentsToYuan(row.guaranteedComponentCents)}</TD>
                            {adjustmentColumns.map((name) => {
                              const items = (adjustments[row.memberKey] ?? []).filter((item) => item.name.trim() === name);
                              const total = validAdjustments(items).reduce((sum, item) => sum + item.amountCents, 0);
                              return (
                                <TD key={name} className="text-left whitespace-nowrap">
                                  <span className={total < 0 ? "text-red-600" : total > 0 ? "text-emerald-600" : "text-slate-500"}>{items.length ? signedAmount(total) : "—"}</span>
                                  {items.some((item) => !toPayrollAdjustment(item)) ? <span className="ml-1 text-xs text-amber-600">待完善</span> : null}
                                </TD>
                              );
                            })}
                            <TD className="text-left">
                              <button
                                type="button"
                                aria-label={`${row.profileName}的调整项`}
                                aria-expanded={expandedId === row.memberKey}
                                onClick={() => setExpandedId(expandedId === row.memberKey ? null : row.memberKey)}
                                className="rounded-lg px-2 py-1 text-left transition hover:bg-indigo-50 focus-visible:outline-2 focus-visible:outline-indigo-500 disabled:opacity-50"
                              >
                                {(adjustments[row.memberKey] ?? []).length ? (
                                  <>
                                    <span className={`block font-medium tabular-nums ${row.adjustmentTotalCents < 0 ? "text-red-600" : row.adjustmentTotalCents > 0 ? "text-emerald-600" : "text-slate-700"}`}>
                                      {signedAmount(row.adjustmentTotalCents)}
                                    </span>
                                    <span className="block text-xs text-slate-500">
                                      {adjustments[row.memberKey].length} 项 · 编辑
                                      {adjustments[row.memberKey].some((item) => !toPayrollAdjustment(item)) ? " · 待完善" : ""}
                                    </span>
                                  </>
                                ) : <span className="text-sm text-indigo-600">+ 添加调整</span>}
                              </button>
                            </TD>
                            <TD className="text-left font-medium whitespace-nowrap">{row.bonusError ? "—" : formatCentsToYuan(row.grossCents)}</TD>
                            <TD className={`text-left font-medium whitespace-nowrap${row.netCents < 0 ? " text-red-600" : ""}`}>{row.bonusError ? "—" : formatCentsToYuan(row.netCents)}</TD>
                          </>
                        ) : (
                          <TD className="text-center text-sm text-amber-600" colSpan={columnCount - 4}>
                            未配置生效工资方案
                          </TD>
                        )}
                        <TD className="text-left">
                          <Button variant="ghost" onClick={() => setExpandedId(expandedId === row.memberKey ? null : row.memberKey)}>
                            {expandedId === row.memberKey ? "收起" : "查看"}
                          </Button>
                        </TD>
                      </TR>
                      {expandedId === row.memberKey ? (
                        <TR>
                          <TD className="bg-slate-50" />
                          <TD className="bg-slate-50 px-4 py-4" colSpan={columnCount - 1}>
                            <div className="grid gap-5 whitespace-normal xl:grid-cols-[minmax(16rem,1fr)_minmax(30rem,1.5fr)]">
                              <div>
                                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">周期内流水</p>
                                {(dailyByProfile[row.profileId] ?? []).length ? (
                                  <ul className="space-y-1 text-sm text-slate-700">
                                    {(dailyByProfile[row.profileId] ?? []).map((d) => (
                                      <li key={d.id} className="flex justify-between gap-4">
                                        <span>{`${formatDate(d.perfDate)} · ${d.teamName ?? "未知团队"} · ${d.pointName ?? "—"}`}</span>
                                        <span className="tabular-nums">{formatCentsToYuan(d.revenueCents)}</span>
                                      </li>
                                    ))}
                                  </ul>
                                ) : (
                                  <p className="text-sm text-slate-400">该周期暂无有效流水。</p>
                                )}
                              </div>
                              <fieldset disabled={!row.hasScheme || dataUnavailable || settleMutation.isPending} className="min-w-0 rounded-xl border border-slate-200 bg-white p-4">
                                <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                                  <div>
                                    <h3 className="text-sm font-semibold text-slate-900">工资调整 <span className="ml-1 font-normal text-slate-400">{(adjustments[row.memberKey] ?? []).length} 项</span></h3>
                                    <p className="mt-1 text-xs text-slate-500">{row.hasScheme ? "点击预设添加，名称、增减方向和金额均可修改。" : "无生效工资方案，暂不可调整。"}</p>
                                  </div>
                                  <span className="rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-600">本期保底 {formatCentsToYuan(row.guaranteedComponentCents)}</span>
                                </div>
                                <div className="mb-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                                  {getAdjustmentPresets(row.guaranteedComponentCents).map((preset) => (
                                    <button
                                      key={preset.name}
                                      type="button"
                                      onClick={() => addAdjustment(row.memberKey, preset)}
                                      className={`rounded-lg border p-3 text-left transition focus-visible:outline-2 focus-visible:outline-indigo-500 disabled:cursor-not-allowed disabled:opacity-50 ${preset.name === "奖励" ? "border-emerald-100 bg-emerald-50/50 hover:border-emerald-300" : "border-red-100 bg-red-50/40 hover:border-red-300"}`}
                                    >
                                      <span className="flex items-center justify-between text-sm font-medium text-slate-800"><span>{preset.name}</span><span aria-hidden="true">+</span></span>
                                      <span className="mt-1 block text-xs text-slate-500">{preset.name === "迟到" ? "保底 ÷ 26 × 0.1" : preset.name === "缺勤" ? "保底 ÷ 26" : "自定义奖励金额"}</span>
                                      <span className={`mt-2 block text-sm font-semibold tabular-nums ${preset.name === "奖励" ? "text-emerald-700" : "text-red-600"}`}>
                                        {preset.name === "奖励" ? "+ 输入金额" : `扣除 ${formatCentsToYuan(Math.abs(preset.amountCents))}`}
                                      </span>
                                    </button>
                                  ))}
                                </div>
                                <p className="mb-4 text-xs text-slate-400">扣款按添加时的保底计算，四舍五入到分；添加后可单独修改。</p>
                                <div className="space-y-3">
                                  {(adjustments[row.memberKey] ?? []).map((adj, index) => {
                                    const amount = parseAdjustmentAmountYuan(adj.amountYuan);
                                    const isDeduction = adj.direction === "deduction";
                                    return (
                                      <div key={adj.id} className={`rounded-lg border border-slate-200 border-l-4 p-3 ${isDeduction ? "border-l-red-300" : "border-l-emerald-300"}`}>
                                        <div className="mb-3 flex items-center justify-between gap-3">
                                          <span className="text-xs font-medium text-slate-500">调整 {index + 1} · {isDeduction ? "扣除工资" : "增加工资"}</span>
                                          <button type="button" onClick={() => removeAdjustment(row.memberKey, adj.id)} aria-label={`删除调整 ${index + 1} ${adj.name}`} className="rounded px-2 py-1 text-xs text-slate-500 hover:bg-red-50 hover:text-red-600 focus-visible:outline-2 focus-visible:outline-indigo-500">删除</button>
                                        </div>
                                        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_6rem_minmax(0,1fr)]">
                                          <label className="min-w-0">
                                            <span className="mb-1 block text-xs text-slate-500">调整名称</span>
                                            <Input value={adj.name} placeholder="如：迟到" aria-invalid={!adj.name.trim()} aria-describedby={!adj.name.trim() ? `${adj.id}-name-error` : undefined} onChange={(event) => updateAdjustment(row.memberKey, adj.id, { name: event.target.value })} />
                                            {!adj.name.trim() ? <span id={`${adj.id}-name-error`} className="mt-1 block text-xs text-red-600">请填写名称</span> : null}
                                          </label>
                                          <label>
                                            <span className="mb-1 block text-xs text-slate-500">增减方向</span>
                                            <select value={adj.direction} onChange={(event) => updateAdjustment(row.memberKey, adj.id, { direction: event.target.value as AdjustmentDraft["direction"] })} className={`h-10 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100 ${isDeduction ? "text-red-600" : "text-emerald-700"}`}>
                                              <option value="deduction">− 扣除</option>
                                              <option value="reward">+ 增加</option>
                                            </select>
                                          </label>
                                          <label className="min-w-0">
                                            <span className="mb-1 block text-xs text-slate-500">金额（元）</span>
                                            <Input inputMode="decimal" value={adj.amountYuan} placeholder="请输入金额" autoFocus={adj.name === "奖励" && adj.amountYuan === ""} aria-invalid={amount === null} aria-describedby={amount === null ? `${adj.id}-amount-error` : undefined} onChange={(event) => updateAdjustment(row.memberKey, adj.id, { amountYuan: event.target.value })} onBlur={() => { if (amount !== null) updateAdjustment(row.memberKey, adj.id, { amountYuan: (amount / 100).toFixed(2) }); }} />
                                            {amount === null ? <span id={`${adj.id}-amount-error`} className="mt-1 block text-xs text-red-600">{adj.amountYuan.trim() ? "请输入非负金额，最多两位小数" : "请填写金额"}</span> : null}
                                          </label>
                                        </div>
                                      </div>
                                    );
                                  })}
                                  {!(adjustments[row.memberKey] ?? []).length ? (
                                    <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-5 text-center">
                                      <p className="text-sm text-slate-500">暂无调整项</p>
                                      <p className="mt-1 text-xs text-slate-400">点击上方「迟到」「缺勤」或「奖励」添加</p>
                                    </div>
                                  ) : null}
                                </div>
                                <div className="mt-4 border-t border-slate-100 pt-3">
                                  <div className="flex items-center justify-between gap-3 text-sm">
                                    <span className="text-slate-600">调整合计</span>
                                    <span className={`font-semibold tabular-nums ${row.adjustmentTotalCents < 0 ? "text-red-600" : row.adjustmentTotalCents > 0 ? "text-emerald-700" : "text-slate-900"}`}>{signedAmount(row.adjustmentTotalCents)} 元</span>
                                  </div>
                                  <div className="mt-2 flex items-center justify-between gap-3 text-sm">
                                    <span className="text-slate-600">调整后实发 <span className="text-xs text-slate-400">（已扣服务费）</span></span>
                                    <span className="font-semibold tabular-nums text-slate-900">{row.bonusError ? "—" : formatCentsToYuan(row.netCents)} 元</span>
                                  </div>
                                  {(adjustments[row.memberKey] ?? []).some((item) => !toPayrollAdjustment(item)) ? <p role="status" className="mt-2 text-xs text-amber-700">存在未完善的调整项，暂不计入试算；请填写完整后再结算。</p> : null}
                                  <p className="mt-2 text-xs text-slate-400">仅本次结算草稿，点击「结算所选」后生效。</p>
                                </div>
                              </fieldset>
                            </div>
                          </TD>
                        </TR>
                      ) : null}
                    </Fragment>
                  ))}
                </TBody>
              </Table>
          </fieldset>
        </CardContent>
      </Card>
    </>
  );
}