"use client";

import { Fragment, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { QueryMessage } from "@/components/query-message";
import { PageHeader } from "@/components/ui/stat-card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useTeams, useAnchorRevenuePerf, useAnchorSettlementContexts, useSettleAnchorRevenue, useTeamEarliestPerfDate } from "@/lib/api/hooks";
import { resolveTeamPeriod } from "@/lib/api/data";
import type { AnchorSettleMember } from "@/lib/api/data";
import { getPeriodRange, getPreviousPeriodRange } from "@/lib/domain/settlement/cycle";
import type { PeriodRange, SettlementType } from "@/lib/domain/settlement/cycle";
import { aggregateSettlement } from "@/lib/domain/settlement/aggregate";
import { applyAdjustments } from "@/lib/domain/payroll/adjustment";
import type { PayrollAdjustment } from "@/lib/domain/payroll/adjustment";
import { calculateAnchorPayroll } from "@/lib/domain/payroll/anchor";
import { formatCentsToYuan, formatDate } from "@/lib/format";

/** 周期下拉可选的历史周期数量（含当前周期）。 */
const PERIOD_OPTION_COUNT = 12;

/** 快捷调整项预设（点击即添加，可再编辑金额）。金额单位：分。 */
const ADJUSTMENT_PRESETS: { name: string; amountCents: number }[] = [
  { name: "迟到", amountCents: -10000 },
  { name: "缺勤", amountCents: -20000 },
  { name: "评优", amountCents: 20000 },
];

/** 单主播的实时试算结果（聚合 + 调整项叠加后）。 */
interface AnchorRow {
  profileId: string;
  profileName: string;
  revenueCents: number;
  commissionRateBps: number;
  performanceComponentCents: number;
  guaranteedComponentCents: number;
  adjustmentTotalCents: number;
  grossCents: number;
  netCents: number;
  hasScheme: boolean;
}

export default function AnchorRevenuePage(){
  const teamsQuery = useTeams();
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  // 周期锚点：以某日期计算所属周期。null=用当前团队默认（今天）。
  const [anchorDate, setAnchorDate] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [adjustments, setAdjustments] = useState<Record<string, PayrollAdjustment[]>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [keyword, setKeyword] = useState("");

  // 有效团队 id：未手动选择时默认取第一个团队（派生 state，避免 effect 里 setState）。
  const teamId = selectedTeamId ?? teamsQuery.data?.[0]?.id ?? null;

  const team = useMemo(
    () => (teamsQuery.data ?? []).find((t) => t.id === teamId) ?? null,
    [teamsQuery.data, teamId],
  );

  const period: PeriodRange | null = useMemo(() => {
    if (!team) return null;
    const type = (team.settlement_type ?? "monthly") as SettlementType;
    const startDay = team.settlement_start_day ?? 1;
    if (anchorDate) return getPeriodRange(type, startDay, anchorDate);
    return resolveTeamPeriod(team);
  }, [team, anchorDate]);

  // 团队最早一条 approved 流水日期，作为周期下拉的下界。
  const earliestPerfQuery = useTeamEarliestPerfDate(teamId);

  // 周期下拉选项：从「当前周期」往回枚举，最新的排最上面。
  // 下界：最早的周期不早于「最早流水所在周期」（prev.end < 最早流水日期则整段都在其之前，停止）。
  const periodOptions: PeriodRange[] = useMemo(() => {
    if (!team) return [];
    const type = (team.settlement_type ?? "monthly") as SettlementType;
    const startDay = team.settlement_start_day ?? 1;
    const earliestPerfDate = earliestPerfQuery.data ?? null; // YYYY-MM-DD 或 null（无流水）
    const list: PeriodRange[] = [];
    let cursor = resolveTeamPeriod(team); // 当前周期（今天所属）。
    for (let i = 0; i < PERIOD_OPTION_COUNT; i += 1) {
      list.push(cursor);
      const prev = getPreviousPeriodRange(type, startDay, cursor.start); // 往回推一个周期。
      // 无流水：仅保留当前周期；有流水：上一周期整体早于最早流水日期则停止（保留含最早流水的那个周期）。
      if (!earliestPerfDate || prev.end < earliestPerfDate) break;
      cursor = prev;
    }
    return list; // 已是最新→最旧顺序。
  }, [team, earliestPerfQuery.data]);

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
      const ctx = members.find((m) => m.profileId === draft.profileId)!;
      // 无生效方案：仅展示流水，不计算工资，工资相关列置 0，行标记 hasScheme=false。
      if (!ctx.scheme) {
        return {
          profileId: draft.profileId,
          profileName: profileNames[draft.profileId] ?? "—",
          revenueCents: draft.revenueCents,
          commissionRateBps: 0,
          performanceComponentCents: 0,
          guaranteedComponentCents: 0,
          adjustmentTotalCents: 0,
          grossCents: 0,
          netCents: 0,
          hasScheme: false,
        };
      }
      const base = calculateAnchorPayroll({
        scheme: ctx.scheme,
        monthlyRevenueInCents: draft.revenueCents,
        tenureMonth: draft.tenureMonth,
        lastMonthQualified: ctx.lastMonthQualified,
      });
      const adjusted = applyAdjustments(base, adjustments[draft.profileId] ?? []);
      return {
        profileId: draft.profileId,
        profileName: profileNames[draft.profileId] ?? "—",
        revenueCents: draft.revenueCents,
        commissionRateBps: draft.commissionRateBps,
        performanceComponentCents: draft.performanceComponentCents,
        guaranteedComponentCents: draft.guaranteedComponentCents,
        adjustmentTotalCents: adjusted.adjustmentTotalInCents,
        grossCents: adjusted.grossSalaryInCents,
        netCents: adjusted.netSalaryInCents,
        hasScheme: true,
      };
    });
  }, [period, contextsQuery.data, perfQuery.data, adjustments]);

  const filteredRows = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return rows;
    return rows.filter((r) => r.profileName.toLowerCase().includes(kw));
  }, [rows, keyword]);

  // 可结算行：仅含已配置生效工资方案的主播（无方案行不可勾选、不参与结算）。
  const settleableRows = useMemo(() => filteredRows.filter((r) => r.hasScheme), [filteredRows]);

  // 每位主播的周期内流水明细（DB 唯一约束保证同一团队每日每主播仅一条）。
  const dailyByProfile = useMemo(() => {
    const map: Record<string, { perfDate: string; revenueCents: number; pointName: string | null; createdAt: string }[]> = {};
    for (const r of perfQuery.data ?? []) {
      if (r.noPerf) continue;
      const list = (map[r.profileId] ??= []);
      list.push({ perfDate: r.perfDate, revenueCents: r.revenueCents, pointName: r.pointName, createdAt: r.createdAt });
    }
    return map;
  }, [perfQuery.data]);

  function toggleSelect(profileId: string) {
    // 无生效方案的主播不可结算，禁止勾选。
    if (!rows.find((r) => r.profileId === profileId)?.hasScheme) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(profileId)) next.delete(profileId);
      else next.add(profileId);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedIds((prev) =>
      prev.size === settleableRows.length ? new Set() : new Set(settleableRows.map((r) => r.profileId)),
    );
  }

  function addAdjustment(profileId: string, preset: { name: string; amountCents: number }) {
    setAdjustments((prev) => ({ ...prev, [profileId]: [...(prev[profileId] ?? []), { ...preset }] }));
  }

  function updateAdjustment(profileId: string, index: number, patch: Partial<PayrollAdjustment>) {
    setAdjustments((prev) => {
      const list = [...(prev[profileId] ?? [])];
      list[index] = { ...list[index], ...patch };
      return { ...prev, [profileId]: list };
    });
  }

  function removeAdjustment(profileId: string, index: number) {
    setAdjustments((prev) => {
      const list = [...(prev[profileId] ?? [])];
      list.splice(index, 1);
      return { ...prev, [profileId]: list };
    });
  }

  async function settle() {
    if (!teamId || !period || !selectedIds.size) return;
    const members: AnchorSettleMember[] = [...selectedIds].map((profileId) => ({
      profileId,
      adjustments: adjustments[profileId] ?? [],
    }));
    await settleMutation.mutateAsync({ teamId, period, members });
    setSelectedIds(new Set());
    setAdjustments({});
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
              onChange={(event) => { setSelectedTeamId(event.target.value || null); setAnchorDate(null); setSelectedIds(new Set()); setAdjustments({}); }}
              className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100"
            >
              <option value="">选择团队</option>
              {(teamsQuery.data ?? []).map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
            {team && period ? (
              <select
                value={period.start}
                onChange={(event) => {
                  setAnchorDate(event.target.value);
                  setSelectedIds(new Set());
                  setAdjustments({});
                  setExpandedId(null);
                }}
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

          {team ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 px-4 pb-3">
                <Input
                  className="max-w-xs"
                  placeholder="搜索主播姓名"
                  value={keyword}
                  onChange={(event) => setKeyword(event.target.value)}
                />
                <Button
                  variant="primary"
                  disabled={!selectedIds.size || settleMutation.isPending}
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
              <Table>
                <THead>
                  <TH isRowHeader>
                    <input
                      type="checkbox"
                      checked={settleableRows.length > 0 && selectedIds.size === settleableRows.length}
                      onChange={toggleSelectAll}
                    />
                  </TH>
                  <TH>主播</TH>
                  <TH className="text-right">总流水</TH>
                  <TH className="text-right">提成</TH>
             <TH className="text-right">保底</TH>
                  <TH className="text-right">调整项</TH>
                  <TH className="text-right">总工资</TH>
                  <TH className="text-right">实发</TH>
                  <TH className="text-right">明细</TH>
                </THead>
                <TBody>
                  {filteredRows.map((row) => (
                    <Fragment key={row.profileId}>
                      <TR>
                        <TD>
                          <input
                            type="checkbox"
                            checked={selectedIds.has(row.profileId)}
                            onChange={() => toggleSelect(row.profileId)}
                            disabled={!row.hasScheme}
                            title={row.hasScheme ? undefined : "该主播未配置生效工资方案，无法结算"}
                          />
                        </TD>
                        <TD>{row.profileName}</TD>
                        <TD className="text-right whitespace-nowrap">{formatCentsToYuan(row.revenueCents)}</TD>
                        {row.hasScheme ? (
                          <>
                            <TD className="text-right whitespace-nowrap">{formatCentsToYuan(row.performanceComponentCents)}</TD>
                            <TD className="text-right whitespace-nowrap">{formatCentsToYuan(row.guaranteedComponentCents)}</TD>
                            <TD className={`text-right whitespace-nowrap${row.adjustmentTotalCents < 0 ? " text-red-600" : row.adjustmentTotalCents > 0 ? " text-emerald-600" : ""}`}>
                              {row.adjustmentTotalCents ? formatCentsToYuan(row.adjustmentTotalCents) : "—"}
                            </TD>
                            <TD className="text-right font-medium whitespace-nowrap">{formatCentsToYuan(row.grossCents)}</TD>
                            <TD className={`text-right font-medium whitespace-nowrap${row.netCents < 0 ? " text-red-600" : ""}`}>{formatCentsToYuan(row.netCents)}</TD>
                          </>
                        ) : (
                          <TD className="text-center text-sm text-amber-600" colSpan={5}>
                            未配置生效工资方案
                          </TD>
                        )}
                        <TD className="text-right">
                          <Button variant="ghost" onClick={() => setExpandedId(expandedId=== row.profileId ? null : row.profileId)}>
                            {expandedId === row.profileId ? "收起" : "查看"}
                          </Button>
                        </TD>
                      </TR>
                      {expandedId === row.profileId ? (
                  <TR>
                          <TD className="bg-slate-50" />
                          <TD className="bg-slate-50 px-4 py-4" colSpan={8}>
                            <div className="grid gap-6 md:grid-cols-2">
                              <div>
                                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">周期内流水</p>
                                {(dailyByProfile[row.profileId] ?? []).length ? (
                                  <ul className="space-y-1 text-sm text-slate-700">
                                    {(dailyByProfile[row.profileId] ?? []).map((d) => (
                                      <li key={`${d.perfDate}-${d.createdAt}`} className="flex justify-between gap-4">
                                        <span>{`${formatDate(d.perfDate)} · ${d.pointName ?? "—"}`}</span>
                                        <span className="tabular-nums">{formatCentsToYuan(d.revenueCents)}</span>
                                      </li>
                                    ))}
                                  </ul>
                                ) : (
                                  <p className="text-sm text-slate-400">该周期暂无有效流水。</p>
                                )}
                              </div>
                              <div>
                                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">调整项</p>
                                <div className="mb-3 flex flex-wrap gap-2">
                                  {ADJUSTMENT_PRESETS.map((preset) => (
                                    <Button
                                      key={preset.name}
                                      variant="secondary"
                                      onClick={() => addAdjustment(row.profileId, preset)}
                                    >
                                      + {preset.name}（{formatCentsToYuan(preset.amountCents)}）
                                    </Button>
                                  ))}
                                </div>
                                <div className="space-y-2">
                                  {(adjustments[row.profileId] ?? []).map((adj, index) => (
                                    <div key={index} className="flex items-center gap-2">
                                      <Input
                                        className="flex-1"
                                        value={adj.name}
                                        onChange={(event) => updateAdjustment(row.profileId, index, { name: event.target.value })}
                                      />
                                      <Input
                                        className="w-28"
                                        value={String(adj.amountCents / 100)}
                                        onChange={(event) => {
                                          const yuan = Number(event.target.value);
                                          updateAdjustment(row.profileId, index, {
                                            amountCents: Number.isFinite(yuan) ? Math.round(yuan * 100) : 0,
                                          });
                                        }}
                                      />
                                      <span className="text-xs text-slate-400">元</span>
                                      <Button variant="danger" onClick={() => removeAdjustment(row.profileId, index)}>删除</Button>
                                    </div>
                                  ))}
                                  {!(adjustments[row.profileId] ?? []).length ? (
                                    <p className="text-sm text-slate-400">暂无调整项，点击上方预设添加。</p>
                                  ) : null}
                                </div>
                              </div>
                            </div>
                          </TD>
                        </TR>
                      ) : null}
                    </Fragment>
                  ))}
                </TBody>
              </Table>
            </>
          ) : (
            <p className="p-6 text-sm text-slate-500">请先选择团队以查看该周期主播流水。</p>
          )}
        </CardContent>
      </Card>
    </>
  );
}