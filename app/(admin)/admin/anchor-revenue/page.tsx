"use client";

import {
  Alert,
  Button,
  Card,
  Col,
  Divider,
  Flex,
  Input,
  Row,
  Select,
  Table,
  Tag,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/admin/page-header";
import { QueryMessage } from "@/components/admin/query-message";
import { zebraRowClassName } from "@/components/admin/table-zebra";
import { useConfirm } from "@/components/admin/use-confirm";
import {
  useAnchorRevenuePerf,
  useAnchorSettlementContexts,
  useSettleAnchorRevenue,
  useSystemSettlementSettings,
  useTeamEarliestPerfDate,
  useTeams,
} from "@/lib/api/hooks";
import { resolveSystemPeriod, settlementMemberKey } from "@/lib/api/data";
import type {
  AnchorRevenuePerfRow,
  AnchorSettleMember,
  SystemSettlementSettings,
} from "@/lib/api/data";
import { getPeriodRange, getPreviousPeriodRange } from "@/lib/domain/settlement/cycle";
import type { PeriodRange } from "@/lib/domain/settlement/cycle";
import { aggregateSettlement } from "@/lib/domain/settlement/aggregate";
import {
  applyAdjustments,
  getAdjustmentPresets,
  parseAdjustmentAmountYuan,
} from "@/lib/domain/payroll/adjustment";
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
      <PageHeader
        title="主播流水"
        description="按结算周期实时聚合每位主播的流水与工资，支持添加调整项后勾选结算进入工资待审核"
      />
      <QueryMessage loading={settings.isLoading} error={settings.error} />
      {settings.data && !settings.isError ? (
        <AnchorRevenueWorkspace
          key={`${settings.data.settlement_type}:${settings.data.settlement_start_day}:${settings.data.updated_at}`}
          settings={settings.data}
          settingsRefreshing={settings.isFetching}
        />
      ) : null}
      {settings.isError ? (
        <Button
          onClick={() => {
            void settings.refetch();
          }}
        >
          重试加载系统周期
        </Button>
      ) : null}
    </>
  );
}

function AnchorRevenueWorkspace({
  settings,
  settingsRefreshing,
}: {
  settings: SystemSettlementSettings;
  settingsRefreshing: boolean;
}) {
  const teamsQuery = useTeams();
  const confirm = useConfirm();
  const [teamId, setSelectedTeamId] = useState<string | null>(null);
  // 配置版本变化时整个工作区重新挂载，避免提交旧周期草稿。
  const [anchorDate, setAnchorDate] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bonuses, setBonuses] = useState<Record<string, CommissionBonusDraft>>({});
  const [adjustments, setAdjustments] = useState<Record<string, AdjustmentDraft[]>>({});
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  const [keyword, setKeyword] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  const period = useMemo(
    () =>
      anchorDate
        ? getPeriodRange(settings.settlement_type, settings.settlement_start_day, anchorDate)
        : resolveSystemPeriod(settings),
    [settings, anchorDate],
  );

  // 团队仅筛名单，最早日期与金额均按名单成员的跨团队流水计算。
  const earliestPerfQuery = useTeamEarliestPerfDate(teamId);
  const periodOptions: PeriodRange[] = useMemo(() => {
    const earliestPerfDate = earliestPerfQuery.data ?? null;
    const list: PeriodRange[] = [];
    let cursor = resolveSystemPeriod(settings);
    for (let i = 0; i < PERIOD_OPTION_COUNT; i += 1) {
      list.push(cursor);
      const prev = getPreviousPeriodRange(
        settings.settlement_type,
        settings.settlement_start_day,
        cursor.start,
      );
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
      .map((r) => ({
        profileId: r.profileId,
        perfDate: r.perfDate,
        revenueCents: r.revenueCents,
        createdAt: r.createdAt,
      }));
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
    const names = new Set(
      Object.values(adjustments).flatMap((items) =>
        items.map((item) => item.name.trim()).filter(Boolean),
      ),
    );
    return [
      ...presets,
      ...Array.from(names)
        .filter((name) => !presets.includes(name))
        .sort((a, b) => a.localeCompare(b, "zh-CN")),
    ];
  }, [adjustments]);

  const filteredRows = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return rows;
    return rows.filter((r) => r.profileName.toLowerCase().includes(kw));
  }, [rows, keyword]);

  // 同一人员的跨团队流水供各岗位查看，交互状态仍按人员与岗位隔离。
  const dailyByProfile = useMemo(() => {
    const map: Record<string, AnchorRevenuePerfRow[]> = {};
    for (const row of perfQuery.data ?? []) {
      if (!row.noPerf) (map[row.profileId] ??= []).push(row);
    }
    return map;
  }, [perfQuery.data]);

  const dataUnavailable =
    settingsRefreshing ||
    perfQuery.isFetching ||
    contextsQuery.isFetching ||
    !perfQuery.isSuccess ||
    !contextsQuery.isSuccess;
  const selectedRows = rows.filter((row) => selectedIds.has(row.memberKey));
  const selectionValid =
    selectedRows.length === selectedIds.size && selectedRows.every((row) => row.hasScheme);
  // 每次渲染都新建数组会让 antd Table 内部的 memo 失效（含列宽测量），这里固定引用
  const selectedRowKeys = useMemo(() => [...selectedIds], [selectedIds]);

  function clearFeedback() {
    setValidationError(null);
    settleMutation.reset();
  }

  function resetDraft() {
    setSelectedIds(new Set());
    setAdjustments({});
    setBonuses({});
    setExpandedKeys([]);
    clearFeedback();
  }

  /** 明细展开切换：表格行与「明细」列按钮共用，保证只有一处状态来源。 */
  function toggleExpand(memberKey: string) {
    setExpandedKeys((prev) => (prev.includes(memberKey) ? [] : [memberKey]));
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
      [memberKey]: (prev[memberKey] ?? []).map((item) =>
        item.id === id ? { ...item, ...patch } : item,
      ),
    }));
  }

  function removeAdjustment(memberKey: string, id: string) {
    clearFeedback();
    setAdjustments((prev) => ({
      ...prev,
      [memberKey]: (prev[memberKey] ?? []).filter((item) => item.id !== id),
    }));
  }

  async function settle() {
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
    const invalidRow = selectedRows.find((row) =>
      (adjustments[row.memberKey] ?? []).some((item) => !toPayrollAdjustment(item)),
    );
    if (invalidRow) {
      setExpandedKeys([invalidRow.memberKey]);
      setValidationError(
        `请完善「${invalidRow.profileName}」的调整项：名称不能为空，金额须为非负数且最多两位小数。`,
      );
      return;
    }
    // 结算会把工资写入待审核流且不可撤销，先让用户确认一次。
    const ok = await confirm({
      title: "确认结算所选主播",
      content: `将为 ${selectedRows.length} 位主播生成工资记录并进入待审核，确认继续？`,
      okText: "确认结算",
    });
    if (!ok) return;
    const members: AnchorSettleMember[] = selectedRows.map((row) => ({
      profileId: row.profileId,
      positionId: row.positionId,
      attendanceBonusBps: parseCommissionBonusPoints(bonuses[row.memberKey]?.attendance ?? "")!,
      dyTaskBonusBps: parseCommissionBonusPoints(bonuses[row.memberKey]?.dyTask ?? "")!,
      adjustments: validAdjustments(adjustments[row.memberKey] ?? []),
    }));
    settleMutation.mutate(
      { teamId, period, members },
      {
        onSuccess: () => {
          setSelectedIds(new Set());
          setAdjustments({});
          setBonuses({});
          setExpandedKeys([]);
        },
      },
    );
  }

  /** 无生效方案的行：工资相关列合并为一格提示。 */
  const noSchemeCell = (row: AnchorRow) => (row.hasScheme ? {} : { colSpan: 0 });

  const schemeColumns: ColumnsType<AnchorRow> = [
    ...BONUS_FIELDS.map(({ key, label }) => ({
      title: label,
      key,
      width: 170,
      render: (_: unknown, row: AnchorRow) =>
        row.hasScheme ? (
          <Input
            inputMode="decimal"
            aria-label={`${row.profileName}的${label}（百分点）`}
            aria-invalid={parseCommissionBonusPoints(bonuses[row.memberKey]?.[key] ?? "") === null}
            status={
              parseCommissionBonusPoints(bonuses[row.memberKey]?.[key] ?? "") === null
                ? "error"
                : undefined
            }
            value={bonuses[row.memberKey]?.[key] ?? ""}
            placeholder="0"
            disabled={dataUnavailable || settleMutation.isPending}
            onChange={(event) => {
              const value = event.target.value;
              clearFeedback();
              setBonuses((prev) => ({
                ...prev,
                [row.memberKey]: {
                  ...(prev[row.memberKey] ?? { attendance: "", dyTask: "" }),
                  [key]: value,
                },
              }));
            }}
          />
        ) : null,
      onCell: noSchemeCell,
    })),
    {
      title: "最终提成率",
      key: "commissionRate",
      width: 120,
      align: "right" as const,
      onCell: noSchemeCell,
      render: (_: unknown, row: AnchorRow) =>
        row.bonusError ? (
          <Typography.Text type="danger" style={{ fontSize: 12 }}>
            {row.bonusError}，试算暂不可用
          </Typography.Text>
        ) : (
          `${row.commissionRateBps / 100}%`
        ),
    },
    {
      title: "提成",
      key: "performance",
      width: 120,
      align: "right" as const,
      onCell: noSchemeCell,
      render: (_: unknown, row: AnchorRow) =>
        row.bonusError ? "—" : formatCentsToYuan(row.performanceComponentCents),
    },
    {
      title: "保底",
      key: "guaranteed",
      width: 120,
      align: "right" as const,
      onCell: noSchemeCell,
      render: (_: unknown, row: AnchorRow) => formatCentsToYuan(row.guaranteedComponentCents),
    },
    ...adjustmentColumns.map((name) => ({
      title: name,
      key: `adj-${name}`,
      width: 130,
      align: "right" as const,
      onCell: noSchemeCell,
      render: (_: unknown, row: AnchorRow) => {
        const items = (adjustments[row.memberKey] ?? []).filter(
          (item) => item.name.trim() === name,
        );
        const total = validAdjustments(items).reduce((sum, item) => sum + item.amountCents, 0);
        return (
          <>
            <span style={{ color: total < 0 ? "#cf1322" : total > 0 ? "#389e0d" : "#8c8c8c" }}>
              {items.length ? signedAmount(total) : "—"}
            </span>
            {items.some((item) => !toPayrollAdjustment(item)) ? (
              <Typography.Text type="warning" style={{ marginInlineStart: 4, fontSize: 12 }}>
                待完善
              </Typography.Text>
            ) : null}
          </>
        );
      },
    })),
    {
      title: "调整项",
      key: "adjustments",
      width: 160,
      onCell: noSchemeCell,
      render: (_: unknown, row: AnchorRow) => {
        const list = adjustments[row.memberKey] ?? [];
        return (
          <Button
            type="link"
            size="small"
            onClick={() => setExpandedKeys(expandedKeys.includes(row.memberKey) ? [] : [row.memberKey])}
          >
            {list.length ? (
              <>
                <span
                  style={{
                    color:
                      row.adjustmentTotalCents < 0
                        ? "#cf1322"
                        : row.adjustmentTotalCents > 0
                          ? "#389e0d"
                          : undefined,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {signedAmount(row.adjustmentTotalCents)}
                </span>
                <Typography.Text type="secondary" style={{ marginInlineStart: 6, fontSize: 12 }}>
                  {list.length} 项 · 编辑
                  {list.some((item) => !toPayrollAdjustment(item)) ? " · 待完善" : ""}
                </Typography.Text>
              </>
            ) : (
              "+ 添加调整"
            )}
          </Button>
        );
      },
    },
    {
      title: "总工资",
      key: "gross",
      width: 120,
      align: "right" as const,
      onCell: noSchemeCell,
      render: (_: unknown, row: AnchorRow) =>
        row.bonusError ? "—" : formatCentsToYuan(row.grossCents),
    },
    {
      title: "实发",
      key: "net",
      width: 120,
      align: "right" as const,
      onCell: noSchemeCell,
      render: (_: unknown, row: AnchorRow) =>
        row.bonusError ? (
          "—"
        ) : (
          <Typography.Text type={row.netCents < 0 ? "danger" : undefined} strong>
            {formatCentsToYuan(row.netCents)}
          </Typography.Text>
        ),
    },
  ];

  const columns: ColumnsType<AnchorRow> = [
    {
      title: "主播",
      key: "profileName",
      fixed: "left",
      width: 180,
      render: (_: unknown, row: AnchorRow) => (
        <Flex align="center" gap={6}>
          <span>{row.profileName}</span>
          {row.hasScheme ? null : <Tag color="orange">未配置方案</Tag>}
        </Flex>
      ),
    },
    {
      title: "总流水",
      key: "revenue",
      width: 130,
      align: "right" as const,
      onCell: (row: AnchorRow) =>
        row.hasScheme ? {} : { colSpan: schemeColumns.length },
      render: (_: unknown, row: AnchorRow) =>
        row.hasScheme ? (
          formatCentsToYuan(row.revenueCents)
        ) : (
          <Typography.Text type="warning">
            未配置生效工资方案，该行不参与结算
          </Typography.Text>
        ),
    },
    ...schemeColumns,
    {
      title: "明细",
      key: "detail",
      width: 100,
      render: (_: unknown, row: AnchorRow) =>
        // 与 rowExpandable 保持一致：无生效方案的行没有可展示的明细
        row.hasScheme ? (
          <Button type="link" size="small" onClick={() => toggleExpand(row.memberKey)}>
            {expandedKeys.includes(row.memberKey) ? "收起" : "查看"}
          </Button>
        ) : null,
    },
  ];

  return (
    <>
      <Card style={{ marginBottom: 16 }}>
        <Flex align="center" gap={12} wrap>
          <Select
            aria-label="团队名单筛选"
            style={{ minWidth: 200 }}
            value={teamId ?? ""}
            onChange={(value: string) => {
              setSelectedTeamId(value || null);
              setAnchorDate(null);
              resetDraft();
            }}
            disabled={settleMutation.isPending}
            options={[
              { value: "", label: "全部主播" },
              ...(teamsQuery.data ?? []).map((t) => ({ value: t.id, label: t.name })),
            ]}
          />
          {period ? (
            <Select
              aria-label="系统结算周期"
              style={{ minWidth: 320 }}
              value={period.start}
              onChange={(value: string) => {
                setAnchorDate(value);
                resetDraft();
              }}
              disabled={settleMutation.isPending || earliestPerfQuery.isFetching}
              options={periodOptions.map((p, index) => ({
                value: p.start,
                label: `${formatDate(p.start)} ~ ${formatDate(p.end)}${index === 0 ? "（当前）" : ""}`,
              }))}
            />
          ) : null}
        </Flex>
        <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
          统一使用系统周期；团队仅筛选主播名单，流水跨团队汇总。工资全部由管理员勾选后手动结算。
        </Typography.Paragraph>
      </Card>

      <Card title="流水结算">
        <QueryMessage
          loading={teamsQuery.isLoading || earliestPerfQuery.isLoading}
          error={teamsQuery.error || earliestPerfQuery.error}
        />

        {validationError || settleMutation.isError ? (
          <Alert
            type="error"
            showIcon
            title={validationError ?? settleMutation.error?.message}
            style={{ marginBottom: 12 }}
          />
        ) : null}
        {settleMutation.isSuccess ? (
          <Alert
            type="success"
            showIcon
            title="结算成功，工资已进入待审核。"
            style={{ marginBottom: 12 }}
          />
        ) : null}
        {!selectionValid ? (
          <Alert
            type="warning"
            showIcon
            title="部分已选主播或工资方案已变更，请清空选择后重新勾选。"
            action={
              <Button size="small" disabled={settleMutation.isPending} onClick={resetDraft}>
                清空选择与调整
              </Button>
            }
            style={{ marginBottom: 12 }}
          />
        ) : null}

        <fieldset
          disabled={settleMutation.isPending || dataUnavailable}
          style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
        >
          <Flex align="center" justify="space-between" gap={12} wrap style={{ marginBottom: 12 }}>
            <Input.Search
              allowClear
              style={{ width: 240 }}
              placeholder="搜索主播姓名"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
            />
            <Button
              type="primary"
              disabled={!selectedIds.size || !selectionValid || dataUnavailable}
              loading={settleMutation.isPending}
              onClick={settle}
            >
              结算所选（{selectedIds.size}）
            </Button>
          </Flex>

          <QueryMessage
            loading={perfQuery.isLoading || contextsQuery.isLoading}
            error={perfQuery.error || contextsQuery.error}
          />

          <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
            加点单位为百分点，填 1 表示增加 1 个百分点，空值按 0；达到原提成起征线后生效。同名调整项合并显示，明细中可逐条编辑。
          </Typography.Paragraph>

          <Table<AnchorRow>
            rowClassName={zebraRowClassName}
            rowKey="memberKey"
            dataSource={filteredRows}
            columns={columns}
            pagination={false}
            scroll={{ x: "max-content" }}
            locale={{ emptyText: "该周期暂无有效流水" }}
            rowSelection={{
              // 默认情况下 antd 会把「不在当前 dataSource 里的 key」从 onChange 中剔除，
              // 于是搜索筛掉的那些行会被静默取消勾选，导致结算漏人。
              preserveSelectedRowKeys: true,
              selectedRowKeys,
              onChange: (keys) => {
                clearFeedback();
                // 只把「当前可见行」的勾选状态同步进来，被筛掉的行保持原样；
                // 这样全选/反选/全不选都只作用于当前视图，不会误删不可见的选择。
                const visibleKeys = filteredRows.map((row) => row.memberKey);
                const visibleSet = new Set(visibleKeys);
                const selectedVisible = new Set(
                  (keys as string[]).filter((key) => visibleSet.has(key)),
                );
                setSelectedIds((prev) => {
                  const next = new Set(prev);
                  visibleKeys.forEach((key) => {
                    if (selectedVisible.has(key)) next.add(key);
                    else next.delete(key);
                  });
                  return next;
                });
              },
              getCheckboxProps: (row) => ({
                disabled: !row.hasScheme,
                title: row.hasScheme ? undefined : "该主播未配置生效工资方案，无法结算",
              }),
            }}
            expandable={{
              expandedRowKeys: expandedKeys,
              // 用 onExpand 而不是 onExpandedRowsChange + slice(-1)：
              // 后者依赖「新 key 追加在数组末尾」这一 antd 内部实现细节
              onExpand: (expanded, row) => setExpandedKeys(expanded ? [row.memberKey] : []),
              // 无生效方案的行展开后只有一块禁用面板，没有信息量
              rowExpandable: (row) => row.hasScheme,
              expandedRowRender: (row) => (
                <Row gutter={[20, 20]} style={{ whiteSpace: "normal" }}>
                  <Col xs={24} xl={9}>
                    <Typography.Text strong>周期内流水</Typography.Text>
                    {(dailyByProfile[row.profileId] ?? []).length ? (
                      <ul style={{ margin: "8px 0 0", paddingInlineStart: 18, fontSize: 13 }}>
                        {(dailyByProfile[row.profileId] ?? []).map((d) => (
                          <li key={d.id}>
                            <Flex justify="space-between" gap={16}>
                              <span>{`${formatDate(d.perfDate)} · ${d.teamName ?? "未知团队"} · ${d.pointName ?? "—"}`}</span>
                              <span style={{ fontVariantNumeric: "tabular-nums" }}>
                                {formatCentsToYuan(d.revenueCents)}
                              </span>
                            </Flex>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <Typography.Paragraph type="secondary" style={{ marginTop: 8 }}>
                        该周期暂无有效流水。
                      </Typography.Paragraph>
                    )}
                  </Col>

                  <Col xs={24} xl={15}>
                    <fieldset
                      disabled={!row.hasScheme || dataUnavailable || settleMutation.isPending}
                      style={{
                        border: "1px solid #f0f0f0",
                        borderRadius: 8,
                        background: "#fff",
                        padding: 16,
                        margin: 0,
                        minWidth: 0,
                      }}
                    >
                      <Flex align="flex-start" justify="space-between" gap={12} wrap>
                        <div>
                          <Typography.Text strong>工资调整</Typography.Text>
                          <Typography.Text type="secondary" style={{ marginInlineStart: 6 }}>
                            {(adjustments[row.memberKey] ?? []).length} 项
                          </Typography.Text>
                          <Typography.Paragraph type="secondary" style={{ fontSize: 12, margin: 0 }}>
                            {row.hasScheme
                              ? "点击预设添加，名称、增减方向和金额均可修改。"
                              : "无生效工资方案，暂不可调整。"}
                          </Typography.Paragraph>
                        </div>
                        <Tag>本期保底 {formatCentsToYuan(row.guaranteedComponentCents)}</Tag>
                      </Flex>

                      <Row gutter={[8, 8]} style={{ marginTop: 12 }}>
                        {getAdjustmentPresets(row.guaranteedComponentCents).map((preset) => (
                          <Col xs={24} sm={8} key={preset.name}>
                            <Button
                              block
                              onClick={() => addAdjustment(row.memberKey, preset)}
                              style={{ height: "auto", padding: 12, textAlign: "left" }}
                            >
                              <div>
                                <Flex justify="space-between">
                                  <span>{preset.name}</span>
                                  <span aria-hidden="true">+</span>
                                </Flex>
                                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                                  {preset.name === "延误"
                                    ? "保底 ÷ 26 × 0.1"
                                    : preset.name === "停播"
                                      ? "保底 ÷ 26"
                                      : "自定义奖励金额"}
                                </Typography.Text>
                                <div>
                                  <Typography.Text
                                    type={preset.name === "奖励" ? "success" : "danger"}
                                    strong
                                  >
                                    {preset.name === "奖励"
                                      ? "+ 输入金额"
                                      : `扣除 ${formatCentsToYuan(Math.abs(preset.amountCents))}`}
                                  </Typography.Text>
                                </div>
                              </div>
                            </Button>
                          </Col>
                        ))}
                      </Row>

                      <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 8 }}>
                        扣款按添加时的保底计算，四舍五入到分；添加后可单独修改。
                      </Typography.Paragraph>

                      <Flex vertical gap={12}>
                        {(adjustments[row.memberKey] ?? []).map((adj, index) => {
                          const amount = parseAdjustmentAmountYuan(adj.amountYuan);
                          const isDeduction = adj.direction === "deduction";
                          return (
                            <div
                              key={adj.id}
                              style={{
                                border: "1px solid #f0f0f0",
                                borderInlineStart: `4px solid ${isDeduction ? "#ffa39e" : "#b7eb8f"}`,
                                borderRadius: 8,
                                padding: 12,
                              }}
                            >
                              <Flex align="center" justify="space-between" gap={12}>
                                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                                  调整 {index + 1} · {isDeduction ? "扣除工资" : "增加工资"}
                                </Typography.Text>
                                <Button
                                  type="text"
                                  size="small"
                                  danger
                                  onClick={() => removeAdjustment(row.memberKey, adj.id)}
                                >
                                  删除
                                </Button>
                              </Flex>
                              <Row gutter={12} style={{ marginTop: 8 }}>
                                <Col xs={24} sm={10}>
                                  <Input
                                    aria-label={`调整 ${index + 1} 名称`}
                                    aria-invalid={!adj.name.trim()}
                                    value={adj.name}
                                    placeholder="如：延误"
                                    status={!adj.name.trim() ? "error" : undefined}
                                    onChange={(event) =>
                                      updateAdjustment(row.memberKey, adj.id, {
                                        name: event.target.value,
                                      })
                                    }
                                  />
                                  {!adj.name.trim() ? (
                                    <Typography.Text type="danger" style={{ fontSize: 12 }}>
                                      请填写名称
                                    </Typography.Text>
                                  ) : null}
                                </Col>
                                <Col xs={12} sm={5}>
                                  <Select
                                    aria-label={`调整 ${index + 1} 增减方向`}
                                    style={{ width: "100%" }}
                                    value={adj.direction}
                                    onChange={(value: AdjustmentDraft["direction"]) =>
                                      updateAdjustment(row.memberKey, adj.id, { direction: value })
                                    }
                                    options={[
                                      { value: "deduction", label: "− 扣除" },
                                      { value: "reward", label: "+ 增加" },
                                    ]}
                                  />
                                </Col>
                                <Col xs={12} sm={9}>
                                  <Input
                                    inputMode="decimal"
                                    aria-label={`调整 ${index + 1} 金额（元）`}
                                    aria-invalid={amount === null}
                                    value={adj.amountYuan}
                                    placeholder="请输入金额"
                                    status={amount === null ? "error" : undefined}
                                    onChange={(event) =>
                                      updateAdjustment(row.memberKey, adj.id, {
                                        amountYuan: event.target.value,
                                      })
                                    }
                                    onBlur={() => {
                                      if (amount !== null) {
                                        updateAdjustment(row.memberKey, adj.id, {
                                          amountYuan: (amount / 100).toFixed(2),
                                        });
                                      }
                                    }}
                                  />
                                  {amount === null ? (
                                    <Typography.Text type="danger" style={{ fontSize: 12 }}>
                                      {adj.amountYuan.trim()
                                        ? "请输入非负金额，最多两位小数"
                                        : "请填写金额"}
                                    </Typography.Text>
                                  ) : null}
                                </Col>
                              </Row>
                            </div>
                          );
                        })}
                        {!(adjustments[row.memberKey] ?? []).length ? (
                          <div
                            style={{
                              border: "1px dashed #d9d9d9",
                              borderRadius: 8,
                              background: "#fafafa",
                              padding: 20,
                              textAlign: "center",
                            }}
                          >
                            <Typography.Text type="secondary">暂无调整项</Typography.Text>
                            <Typography.Paragraph type="secondary" style={{ fontSize: 12, margin: 0 }}>
                              点击上方「延误」「停播」或「奖励」添加
                            </Typography.Paragraph>
                          </div>
                        ) : null}
                      </Flex>

                      <Divider style={{ margin: "16px 0 12px" }} />

                      <Flex justify="space-between" gap={12}>
                        <Typography.Text type="secondary">调整合计</Typography.Text>
                        <Typography.Text
                          strong
                          style={{
                            color:
                              row.adjustmentTotalCents < 0
                                ? "#cf1322"
                                : row.adjustmentTotalCents > 0
                                  ? "#389e0d"
                                  : undefined,
                          }}
                        >
                          {signedAmount(row.adjustmentTotalCents)} 元
                        </Typography.Text>
                      </Flex>
                      <Flex justify="space-between" gap={12} style={{ marginTop: 8 }}>
                        <Typography.Text type="secondary">
                          调整后实发 <Typography.Text type="secondary">（已扣服务费）</Typography.Text>
                        </Typography.Text>
                        <Typography.Text strong>
                          {row.bonusError ? "—" : formatCentsToYuan(row.netCents)} 元
                        </Typography.Text>
                      </Flex>
                      {(adjustments[row.memberKey] ?? []).some(
                        (item) => !toPayrollAdjustment(item),
                      ) ? (
                        <Typography.Text type="warning" style={{ fontSize: 12 }}>
                          存在未完善的调整项，暂不计入试算；请填写完整后再结算。
                        </Typography.Text>
                      ) : null}
                      <Typography.Paragraph type="secondary" style={{ fontSize: 12, margin: 0 }}>
                        仅本次结算草稿，点击「结算所选」后生效。
                      </Typography.Paragraph>
                    </fieldset>
                  </Col>
                </Row>
              ),
            }}
          />
        </fieldset>
      </Card>
    </>
  );
}
