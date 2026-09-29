"use client";

import {
  Alert,
  Button,
  Card,
  Col,
  Divider,
  Flex,
  Input,
  Modal,
  Row,
  Select,
  Tag,
  Typography,
} from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import { PageHeader } from "@/components/admin/page-header";
import { QueryMessage } from "@/components/admin/query-message";
import {
  ResizableTable,
  type ResizableColumnsType,
} from "@/components/admin/resizable-table";
import { zebraRowClassName } from "@/components/admin/table-zebra";
import { useConfirm } from "@/components/admin/use-confirm";
import {
  useHostSettlementContexts,
  useSettleHostPayroll,
  useHostSalaryRecords,
} from "@/lib/api/hooks";
import type { HostSalaryRecord, HostSettleMember, HostSettlementContext } from "@/lib/api/data";
import { SalaryRecordStatusBadge } from "@/components/admin/status-tag";
import { PeriodRangeFilter } from "@/components/admin/period-range-filter";
import { getPresetRange } from "@/lib/domain/settlement/cycle";
import type { PeriodRange } from "@/lib/domain/settlement/cycle";
import { parseAdjustmentAmountYuan } from "@/lib/domain/payroll/adjustment";
import {
  calculateHostPayroll,
  getHostAdjustmentPresets,
  HOST_PENALTY_NAME,
  HOST_REWARD_NAME,
} from "@/lib/domain/payroll/host";
import { formatBpsAsPercent, formatCentsToYuan, formatDurationSeconds } from "@/lib/format";

interface AdjustmentDraft {
  id: string;
  name: string;
  direction: "deduction" | "reward";
  amountYuan: string;
}

function toAdjustment(draft: AdjustmentDraft): { name: string; amountCents: number } | null {
  const amount = parseAdjustmentAmountYuan(draft.amountYuan);
  if (!draft.name.trim() || amount === null) return null;
  return { name: draft.name.trim(), amountCents: draft.direction === "deduction" ? -amount : amount };
}

function validAdjustments(drafts: AdjustmentDraft[]): { name: string; amountCents: number }[] {
  return drafts.map(toAdjustment).filter((item): item is { name: string; amountCents: number } => item !== null);
}

function signedAmount(cents: number): string {
  return `${cents > 0 ? "+" : ""}${formatCentsToYuan(cents)}`;
}

interface HostRow {
  context: HostSettlementContext;
  hasScheme: boolean;
  adjustmentTotalCents: number;
  penaltyCents: number;
  rewardCents: number;
  result: ReturnType<typeof calculateHostPayroll> | null;
}

export default function HostRevenuePage() {
  return (
    <>
      <PageHeader
        title="主持流水"
        description="按自定义起止日期汇总每位主持的团总流水与直播时长，支持违约/奖励调整后勾选结算进入工资核算"
      />
      <HostRevenueWorkspace />
    </>
  );
}

function HostRevenueWorkspace() {
  const confirm = useConfirm();
  // 进入页面默认查询本月；快捷区间与日期选择需点击「查询」后才应用。
  const [period, setPeriod] = useState<PeriodRange>(() => getPresetRange("thisMonth"));
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [adjustments, setAdjustments] = useState<Record<string, AdjustmentDraft[]>>({});
  const [adjustingHost, setAdjustingHost] = useState<HostSettlementContext | null>(null);
  const [breakdownHost, setBreakdownHost] = useState<HostSettlementContext | null>(null);
  const [keyword, setKeyword] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const seededRef = useRef<Set<string>>(new Set());

  const contextsQuery = useHostSettlementContexts(period);
  const hostSalaryRecordsQuery = useHostSalaryRecords();

  // 同区间的工资记录（覆盖重算）与重叠但不同区间的记录（删除未完成记录后重算）。
  const { existingByHost, overlapByHost } = useMemo(() => {
    const existing = new Map<string, HostSalaryRecord>();
    const overlap = new Map<string, HostSalaryRecord[]>();
    for (const record of hostSalaryRecordsQuery.data ?? []) {
      if (record.period_start === period.start && record.period_end === period.end) {
        existing.set(record.host_profile_id, record);
        continue;
      }
      if (record.period_start > period.end || record.period_end < period.start) continue;
      const list = overlap.get(record.host_profile_id) ?? [];
      list.push(record);
      overlap.set(record.host_profile_id, list);
    }
    return { existingByHost: existing, overlapByHost: overlap };
  }, [hostSalaryRecordsQuery.data, period]);
  const settleMutation = useSettleHostPayroll();

  const rows: HostRow[] = useMemo(() => {
    if (!period || !contextsQuery.data) return [];
    return contextsQuery.data.map((context) => {
      const drafts = adjustments[context.hostProfileId] ?? [];
      const valid = validAdjustments(drafts);
      const adjustmentTotalCents = valid.reduce((sum, item) => sum + item.amountCents, 0);
      const penaltyCents = valid.filter((item) => item.amountCents < 0).reduce((sum, item) => sum + item.amountCents, 0);
      const rewardCents = valid.filter((item) => item.amountCents > 0).reduce((sum, item) => sum + item.amountCents, 0);
      const hasScheme = context.scheme !== null;
      const result = hasScheme
        ? calculateHostPayroll({
            scheme: context.scheme!,
            teamRevenueInCents: context.revenueCents,
            adjustmentTotalInCents: adjustmentTotalCents,
          })
        : null;
      return { context, hasScheme, adjustmentTotalCents, penaltyCents, rewardCents, result };
    });
  }, [period, contextsQuery.data, adjustments]);

  // 预置「违约 / 奖励」两个空调整项，每个主持每个周期只铺一次。
  useEffect(() => {
    const seeds: { hostId: string; seedKey: string; drafts: AdjustmentDraft[] }[] = [];
    for (const row of rows) {
      if (!row.hasScheme) continue;
      const seedKey = `${row.context.hostProfileId}:${period?.start ?? ""}:${period?.end ?? ""}`;
      if (seededRef.current.has(seedKey)) continue;
      seeds.push({
        hostId: row.context.hostProfileId,
        seedKey,
        drafts: getHostAdjustmentPresets().map((preset) => ({
          id: crypto.randomUUID(),
          name: preset.name,
          direction: preset.name === HOST_REWARD_NAME ? "reward" : "deduction",
          amountYuan: "",
        })),
      });
    }
    if (!seeds.length) return;
    seeds.forEach((seed) => seededRef.current.add(seed.seedKey));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 依据加载完成的结算数据同步预填调整项
    setAdjustments((prev) => {
      const next = { ...prev };
      for (const seed of seeds) {
        next[seed.hostId] = [...(next[seed.hostId] ?? []), ...seed.drafts];
      }
      return next;
    });
  }, [rows, period]);

  const filteredRows = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return rows;
    return rows.filter((row) => row.context.hostName.toLowerCase().includes(kw));
  }, [rows, keyword]);

  const dataUnavailable =
    contextsQuery.isFetching || !contextsQuery.isSuccess || !hostSalaryRecordsQuery.isSuccess;
  const selectedRows = rows.filter((row) => selectedIds.has(row.context.hostProfileId));
  const selectionValid = selectedRows.length === selectedIds.size && selectedRows.every((row) => row.hasScheme);
  const selectedRowKeys = useMemo(() => [...selectedIds], [selectedIds]);

  function clearFeedback() {
    setValidationError(null);
    settleMutation.reset();
  }

  function resetDraft() {
    setSelectedIds(new Set());
    setAdjustments({});
    seededRef.current.clear();
    clearFeedback();
  }

  function updateAdjustment(hostId: string, id: string, patch: Partial<AdjustmentDraft>) {
    clearFeedback();
    setAdjustments((prev) => ({
      ...prev,
      [hostId]: (prev[hostId] ?? []).map((item) => (item.id === id ? { ...item, ...patch } : item)),
    }));
  }

  function addAdjustment(hostId: string, presetName: string) {
    clearFeedback();
    setAdjustments((prev) => ({
      ...prev,
      [hostId]: [
        ...(prev[hostId] ?? []),
        {
          id: crypto.randomUUID(),
          name: presetName,
          direction: presetName === HOST_REWARD_NAME ? "reward" : "deduction",
          amountYuan: "",
        },
      ],
    }));
  }

  function removeAdjustment(hostId: string, id: string) {
    clearFeedback();
    setAdjustments((prev) => ({
      ...prev,
      [hostId]: (prev[hostId] ?? []).filter((item) => item.id !== id),
    }));
  }

  async function settle() {
    if (settleMutation.isPending) return;
    clearFeedback();
    if (dataUnavailable || !selectedIds.size || !selectionValid) {
      setValidationError("请等待数据加载完成，并重新选择具有生效工资方案的主持。");
      return;
    }
    const invalidRow = selectedRows.find((row) =>
      (adjustments[row.context.hostProfileId] ?? []).some((item) => item.amountYuan.trim() && !toAdjustment(item)),
    );
    if (invalidRow) {
      setValidationError(`请检查「${invalidRow.context.hostName}」的调整项金额：须为非负数且最多两位小数。`);
      return;
    }
    const completedRow = selectedRows.find((row) => {
      const exact = existingByHost.get(row.context.hostProfileId);
      // 精确记录仅「待审核」可覆盖；其余状态不可重算。
      if (exact && exact.status !== "pending_review") return true;
      return (overlapByHost.get(row.context.hostProfileId) ?? []).some(
        (record) => record.status === "completed",
      );
    });
    if (completedRow) {
      setValidationError(
        `「${completedRow.context.hostName}」存在不可覆盖的工资记录与所选区间重叠，请先核对工资核算。`,
      );
      return;
    }
    const affectedRows = selectedRows.filter(
      (row) =>
        existingByHost.has(row.context.hostProfileId) ||
        (overlapByHost.get(row.context.hostProfileId) ?? []).length > 0,
    );
    if (affectedRows.length) {
      const ok = await confirm({
        title: "所选区间已有主持工资记录，重新结算将覆盖",
        content: (
          <div>
            <p style={{ marginTop: 0 }}>
              以下 {affectedRows.length} 位主持在所选区间内已有工资记录，将覆盖同区间记录并删除未完成的重叠记录：
            </p>
            <Flex vertical gap={6} style={{ maxHeight: 260, overflow: "auto" }}>
              {affectedRows.map((row) => {
                const exact = existingByHost.get(row.context.hostProfileId);
                const overlaps = overlapByHost.get(row.context.hostProfileId) ?? [];
                return (
                  <div key={row.context.hostProfileId} style={{ fontSize: 13 }}>
                    <span style={{ fontWeight: 600 }}>{row.context.hostName}</span>{" "}
                    {exact ? (
                      <>
                        <SalaryRecordStatusBadge status={exact.status} /> 实发{" "}
                        {formatCentsToYuan(exact.gross_cents)}（同区间，覆盖）
                      </>
                    ) : null}
                    {exact && overlaps.length ? "；" : null}
                    {overlaps.length ? (
                      <>
                        重叠 {overlaps.map((r) => `${r.period_start}~${r.period_end}`).join("、")}{" "}
                        （未完成，删除）
                      </>
                    ) : null}
                  </div>
                );
              })}
            </Flex>
          </div>
        ),
        okText: "覆盖并重算",
        okButtonProps: { danger: true },
      });
      if (!ok) return;
    } else {
      const ok = await confirm({
        title: "确认结算所选主持",
        content: `将为 ${selectedRows.length} 位主持生成工资记录并进入待审核，确认继续？`,
        okText: "确认结算",
      });
      if (!ok) return;
    }
    const hosts: HostSettleMember[] = selectedRows.map((row) => ({
      hostProfileId: row.context.hostProfileId,
      adjustments: validAdjustments(adjustments[row.context.hostProfileId] ?? []),
    }));
    settleMutation.mutate(
      { period, hosts, replaceOverlapping: true },
      {
        onSuccess: () => {
          setSelectedIds(new Set());
          setAdjustments({});
        },
      },
    );
  }

  const noSchemeCell = (row: HostRow) => (row.hasScheme ? {} : { colSpan: 0 });

  // 方案相关列：无生效方案的行整段隐藏（colSpan 0），由「团总流水」列跨列提示。
  const schemeColumns: ResizableColumnsType<HostRow> = [
    {
      title: "拿提点门槛",
      key: "threshold",
      width: 130,
      align: "right",
      onCell: noSchemeCell,
      sortValue: (row) => row.result?.thresholdInCents ?? null,
      render: (_, row) => (row.result ? formatCentsToYuan(row.result.thresholdInCents) : "—"),
    },
    {
      title: "是否达标",
      key: "qualified",
      width: 100,
      onCell: noSchemeCell,
      sortValue: (row) => (row.result ? (row.result.isQualified ? 1 : 0) : null),
      render: (_, row) =>
        row.result ? (
          <Typography.Text type={row.result.isQualified ? undefined : "secondary"}>
            {row.result.isQualified ? "是" : "否"}
          </Typography.Text>
        ) : (
          "—"
        ),
    },
    {
      title: "基础提成率",
      key: "baseRate",
      width: 120,
      align: "right",
      onCell: noSchemeCell,
      sortValue: (row) => row.result?.baseCommissionRateBps ?? null,
      render: (_, row) => (row.result ? formatBpsAsPercent(row.result.baseCommissionRateBps) : "—"),
    },
    {
      title: "阶梯式提点",
      key: "tier",
      width: 120,
      align: "right",
      onCell: noSchemeCell,
      sortValue: (row) => row.result?.tierBonusBps ?? null,
      render: (_, row) => (row.result ? formatBpsAsPercent(row.result.tierBonusBps) : "—"),
    },
    {
      title: "最终提成率",
      key: "rate",
      width: 120,
      align: "right",
      onCell: noSchemeCell,
      sortValue: (row) => row.result?.commissionRateBps ?? null,
      render: (_, row) => (row.result ? formatBpsAsPercent(row.result.commissionRateBps) : "—"),
    },
    {
      title: "基础收益",
      key: "baseIncome",
      width: 120,
      align: "right",
      onCell: noSchemeCell,
      sortValue: (row) => row.result?.baseIncomeInCents ?? null,
      render: (_, row) => (row.result ? formatCentsToYuan(row.result.baseIncomeInCents) : "—"),
    },
    {
      title: "总违约",
      key: "penalty",
      width: 120,
      align: "right",
      onCell: noSchemeCell,
      sortValue: (row) => row.penaltyCents,
      render: (_, row) =>
        row.penaltyCents ? (
          <span style={{ color: "#cf1322" }}>{signedAmount(row.penaltyCents)}</span>
        ) : (
          "—"
        ),
    },
    {
      title: "总奖励",
      key: "reward",
      width: 120,
      align: "right",
      onCell: noSchemeCell,
      sortValue: (row) => row.rewardCents,
      render: (_, row) =>
        row.rewardCents ? (
          <span style={{ color: "#389e0d" }}>{signedAmount(row.rewardCents)}</span>
        ) : (
          "—"
        ),
    },
    {
      title: "调整合计",
      key: "adjustmentTotal",
      width: 120,
      align: "right",
      onCell: noSchemeCell,
      sortValue: (row) => row.adjustmentTotalCents,
      render: (_, row) =>
        row.adjustmentTotalCents ? (
          <span style={{ color: row.adjustmentTotalCents < 0 ? "#cf1322" : "#389e0d" }}>
            {signedAmount(row.adjustmentTotalCents)}
          </span>
        ) : (
          "—"
        ),
    },
    {
      title: "实发收益",
      key: "gross",
      width: 130,
      align: "right",
      onCell: noSchemeCell,
      sortValue: (row) => row.result?.grossIncomeInCents ?? null,
      render: (_, row) => (row.result ? formatCentsToYuan(row.result.grossIncomeInCents) : "—"),
    },
    {
      title: "服务率",
      key: "serviceRate",
      width: 100,
      align: "right",
      onCell: noSchemeCell,
      sortValue: (row) => row.result?.serviceFeeRateBps ?? null,
      render: (_, row) => (row.result ? formatBpsAsPercent(row.result.serviceFeeRateBps) : "—"),
    },
    {
      title: "服务费",
      key: "serviceFee",
      width: 120,
      align: "right",
      onCell: noSchemeCell,
      sortValue: (row) => row.result?.serviceFeeInCents ?? null,
      render: (_, row) => (row.result ? formatCentsToYuan(row.result.serviceFeeInCents) : "—"),
    },
    {
      title: "到手收益",
      key: "net",
      width: 130,
      align: "right",
      onCell: noSchemeCell,
      sortValue: (row) => row.result?.netIncomeInCents ?? null,
      render: (_, row) =>
        row.result ? (
          <Typography.Text type={row.result.netIncomeInCents < 0 ? "danger" : undefined} strong>
            {formatCentsToYuan(row.result.netIncomeInCents)}
          </Typography.Text>
        ) : (
          "—"
        ),
    },
    {
      title: "调整项",
      key: "adjustments",
      width: 110,
      onCell: noSchemeCell,
      sortValue: (row) => row.adjustmentTotalCents,
      render: (_, row) => (
        <Button type="link" size="small" onClick={() => setAdjustingHost(row.context)}>
          {row.adjustmentTotalCents ? signedAmount(row.adjustmentTotalCents) : "+ 录入"}
        </Button>
      ),
    },
  ];

  const columns: ResizableColumnsType<HostRow> = [
    {
      title: "主持姓名",
      key: "hostName",
      fixed: "left",
      width: 160,
      sortValue: (row) => row.context.hostName,
      render: (_, row) => {
        const exact = existingByHost.get(row.context.hostProfileId);
        const overlaps = overlapByHost.get(row.context.hostProfileId) ?? [];
        return (
          <Flex align="center" gap={6}>
            <span>{row.context.hostName}</span>
            {row.hasScheme ? null : <Tag color="orange">未配置方案</Tag>}
            {exact ? (
              <Tag color={exact.status === "completed" ? "red" : "blue"}>
                {exact.status === "completed" ? "已完成" : "已结算"}
              </Tag>
            ) : null}
            {overlaps.length ? <Tag color="gold">重叠</Tag> : null}
          </Flex>
        );
      },
    },
    {
      title: "团队名称",
      key: "teamName",
      width: 180,
      sortValue: (row) =>
        row.context.teamBreakdown.map((item) => item.teamName ?? "未知团队").join("、"),
      render: (_, row) => {
        const names = row.context.teamBreakdown.map((item) => item.teamName ?? "未知团队");
        if (!names.length) return "—";
        return (
          <Button type="link" size="small" style={{ padding: 0 }} onClick={() => setBreakdownHost(row.context)}>
            {names.length <= 2 ? names.join("、") : `${names.slice(0, 2).join("、")} 等 ${names.length} 个团`}
          </Button>
        );
      },
    },
    {
      title: "团总流水",
      key: "revenue",
      width: 150,
      align: "right",
      sortValue: (row) => row.context.revenueCents,
      // 无方案时跨「直播时长 + 全部方案列」（1 + 1 + schemeColumns.length）。
      onCell: (row) => (row.hasScheme ? {} : { colSpan: schemeColumns.length + 2 }),
      render: (_, row) =>
        row.hasScheme ? (
          formatCentsToYuan(row.context.revenueCents)
        ) : (
          <Typography.Text type="warning">未配置生效主持方案，该行不参与结算</Typography.Text>
        ),
    },
    {
      title: "直播时长",
      key: "broadcast",
      width: 120,
      align: "right",
      onCell: noSchemeCell,
      sortValue: (row) => row.context.broadcastMinutes,
      render: (_, row) =>
        row.context.broadcastMinutes > 0 ? formatDurationSeconds(row.context.broadcastMinutes * 60) : "—",
    },
    ...schemeColumns,
  ];

  return (
    <>
      <Card style={{ marginBottom: 16 }}>
        <PeriodRangeFilter
          value={period}
          onChange={(range) => {
            setPeriod(range);
            resetDraft();
          }}
          disabled={settleMutation.isPending}
        />
        <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
          默认为本月；可快捷切换当日/昨日/本周或自选起止日期，点击「查询」后应用。团总流水 = 该主持名下所有团队在该区间内的主播流水合计，团队明细可点击行内标签查看。工资由管理员勾选后手动结算。
        </Typography.Paragraph>
      </Card>

      <Card title="主持流水结算">
        {validationError || settleMutation.isError ? (
          <Alert
            type="error"
            showIcon
            title={validationError ?? settleMutation.error?.message}
            style={{ marginBottom: 12 }}
          />
        ) : null}
        {settleMutation.isSuccess ? (
          <Alert type="success" showIcon title="结算成功，主持工资已进入待审核。" style={{ marginBottom: 12 }} />
        ) : null}
        {!selectionValid ? (
          <Alert
            type="warning"
            showIcon
            title="部分已选主持或工资方案已变更，请清空选择后重新勾选。"
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
              placeholder="搜索主持姓名"
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

          <QueryMessage loading={contextsQuery.isLoading} error={contextsQuery.error} />

          <ResizableTable<HostRow>
            rowClassName={zebraRowClassName}
            rowKey={(row) => row.context.hostProfileId}
            dataSource={filteredRows}
            columns={columns}
            locale={{ emptyText: "该周期暂无主持流水" }}
            rowSelection={{
              preserveSelectedRowKeys: true,
              selectedRowKeys,
              onChange: (keys) => {
                clearFeedback();
                const visibleKeys = filteredRows.map((row) => row.context.hostProfileId);
                const visibleSet = new Set(visibleKeys);
                const selectedVisible = new Set((keys as string[]).filter((key) => visibleSet.has(key)));
                setSelectedIds((prev) => {
                  const next = new Set(prev);
                  visibleKeys.forEach((key) => {
                    if (selectedVisible.has(key)) next.add(key);
                    else next.delete(key);
                  });
                  return next;
                });
              },
              getCheckboxProps: (row) => {
                const exact = existingByHost.get(row.context.hostProfileId);
                const overlaps = overlapByHost.get(row.context.hostProfileId) ?? [];
                const blocked =
                  (exact !== undefined && exact.status !== "pending_review") ||
                  overlaps.some((record) => record.status === "completed");
                return {
                  disabled: !row.hasScheme || blocked,
                  title: !row.hasScheme
                    ? "该主持未配置生效工资方案，无法结算"
                    : blocked
                      ? "该主持存在不可覆盖的工资记录与所选区间重叠，无法重新结算"
                      : undefined,
                };
              },
            }}
          />
        </fieldset>
      </Card>

      <Modal
        title={adjustingHost ? `调整项 · ${adjustingHost.hostName}` : "调整项"}
        open={Boolean(adjustingHost)}
        onCancel={() => setAdjustingHost(null)}
        footer={<Button onClick={() => setAdjustingHost(null)}>完成</Button>}
        destroyOnHidden
        width={620}
      >
        {adjustingHost ? (
          <AdjustmentEditor
            drafts={adjustments[adjustingHost.hostProfileId] ?? []}
            onAdd={(name) => addAdjustment(adjustingHost.hostProfileId, name)}
            onChange={(id, patch) => updateAdjustment(adjustingHost.hostProfileId, id, patch)}
            onRemove={(id) => removeAdjustment(adjustingHost.hostProfileId, id)}
            total={rows.find((row) => row.context.hostProfileId === adjustingHost.hostProfileId)?.adjustmentTotalCents ?? 0}
          />
        ) : null}
      </Modal>

      <Modal
        title={breakdownHost ? `团队明细 · ${breakdownHost.hostName}` : "团队明细"}
        open={Boolean(breakdownHost)}
        onCancel={() => setBreakdownHost(null)}
        footer={<Button onClick={() => setBreakdownHost(null)}>关闭</Button>}
        destroyOnHidden
        width={600}
      >
        {breakdownHost ? (
          <ResizableTable
            rowKey="teamId"
            size="small"
            pagination={false}
            minColumnWidth={80}
            dataSource={breakdownHost.teamBreakdown}
            columns={[
              { title: "团队", dataIndex: "teamName", render: (value: string | null) => value ?? "未知团队" },
              {
                title: "团总流水",
                dataIndex: "revenueCents",
                align: "right",
                render: (value: number) => formatCentsToYuan(value),
              },
              {
                title: "直播时长",
                dataIndex: "broadcastMinutes",
                align: "right",
                render: (value: number) => (value > 0 ? formatDurationSeconds(value * 60) : "—"),
              },
            ]}
            locale={{ emptyText: "该周期暂无团队流水" }}
          />
        ) : null}
      </Modal>
    </>
  );
}

function AdjustmentEditor({
  drafts,
  onAdd,
  onChange,
  onRemove,
  total,
}: {
  drafts: AdjustmentDraft[];
  onAdd: (name: string) => void;
  onChange: (id: string, patch: Partial<AdjustmentDraft>) => void;
  onRemove: (id: string) => void;
  total: number;
}) {
  return (
    <Flex vertical gap={12}>
      <Flex gap={8}>
        <Button onClick={() => onAdd(HOST_PENALTY_NAME)}>+ 违约（扣除）</Button>
        <Button onClick={() => onAdd(HOST_REWARD_NAME)}>+ 奖励（增加）</Button>
      </Flex>
      {drafts.map((draft, index) => {
        const amount = parseAdjustmentAmountYuan(draft.amountYuan);
        return (
          <div
            key={draft.id}
            style={{
              border: "1px solid #f0f0f0",
              borderInlineStart: `4px solid ${draft.direction === "deduction" ? "#ffa39e" : "#b7eb8f"}`,
              borderRadius: 8,
              padding: 12,
            }}
          >
            <Flex align="center" justify="space-between" gap={12}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                调整 {index + 1} · {draft.direction === "deduction" ? "扣除" : "增加"}
              </Typography.Text>
              <Button type="text" size="small" danger onClick={() => onRemove(draft.id)}>
                删除
              </Button>
            </Flex>
            <Row gutter={12} style={{ marginTop: 8 }}>
              <Col span={10}>
                <Input
                  aria-label={`调整 ${index + 1} 名称`}
                  value={draft.name}
                  placeholder="如：违约"
                  onChange={(event) => onChange(draft.id, { name: event.target.value })}
                />
              </Col>
              <Col span={6}>
                <Select
                  style={{ width: "100%" }}
                  value={draft.direction}
                  onChange={(value: AdjustmentDraft["direction"]) => onChange(draft.id, { direction: value })}
                  options={[
                    { value: "deduction", label: "− 扣除" },
                    { value: "reward", label: "+ 增加" },
                  ]}
                />
              </Col>
              <Col span={8}>
                <Input
                  inputMode="decimal"
                  aria-label={`调整 ${index + 1} 金额（元）`}
                  value={draft.amountYuan}
                  placeholder="金额"
                  status={draft.amountYuan.trim() && amount === null ? "error" : undefined}
                  onChange={(event) => onChange(draft.id, { amountYuan: event.target.value })}
                  onBlur={() => {
                    if (amount !== null) onChange(draft.id, { amountYuan: (amount / 100).toFixed(2) });
                  }}
                />
                {draft.amountYuan.trim() && amount === null ? (
                  <Typography.Text type="danger" style={{ fontSize: 12 }}>
                    请输入非负金额，最多两位小数
                  </Typography.Text>
                ) : null}
              </Col>
            </Row>
          </div>
        );
      })}
      {!drafts.length ? (
        <Typography.Text type="secondary">暂无调整项，点击上方按钮添加。</Typography.Text>
      ) : null}
      <Divider style={{ margin: "4px 0" }} />
      <Flex justify="space-between">
        <Typography.Text type="secondary">调整合计</Typography.Text>
        <Typography.Text
          strong
          style={{ color: total < 0 ? "#cf1322" : total > 0 ? "#389e0d" : undefined }}
        >
          {signedAmount(total)} 元
        </Typography.Text>
      </Flex>
    </Flex>
  );
}
