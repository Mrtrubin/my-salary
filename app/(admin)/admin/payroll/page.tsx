"use client";

import { App, Button, Card, Col, Flex, Row, Select, Tabs, Typography } from "antd";
import { DownloadOutlined } from "@ant-design/icons";
import { useMemo, useState, type Key } from "react";
import { PageHeader } from "@/components/admin/page-header";
import { QueryMessage } from "@/components/admin/query-message";
import { ResizableTable, type ResizableColumnType } from "@/components/admin/resizable-table";
import { SalaryRecordStatusBadge } from "@/components/admin/status-tag";
import { zebraRowClassName } from "@/components/admin/table-zebra";
import { useConfirm } from "@/components/admin/use-confirm";
import { getAdjustmentPresets, type PayrollAdjustment } from "@/lib/domain/payroll/adjustment";
import {
  useCurrentProfile,
  useMembers,
  useRoles,
  useDeleteSalaryRecord,
  useRejectAndRecompute,
  useSalaryRecords,
  useSalaryStatusLogs,
  useTransitionSalaryStatus,
} from "@/lib/api/hooks";
import type { SalaryRecord } from "@/lib/api/data";
import { formatBpsAsPercent, formatCentsToYuan, formatDateTime, formatDurationSeconds } from "@/lib/format";
import { bpsToRatio, centsToYuanNumber, downloadExcel, fileStamp, type ExcelColumn } from "@/lib/excel";
import { HostPayrollPanel } from "./HostPayrollPanel";
import { StaffPayrollPanel } from "./StaffPayrollPanel";

/** 状态变更历史时间轴（展开某条工资条时按需加载，精确到秒）。 */
function StatusTimeline({ recordId }: { recordId: string }) {
  const logs = useSalaryStatusLogs(recordId);
  const labels: Record<string, string> = {
    pending_review: "待审核",
    pending_confirm: "待确认",
    confirmed: "已确认",
    completed: "已完成",
  };
  return (
    <div style={{ background: "#fafafa", padding: 12, fontSize: 12 }}>
      <QueryMessage loading={logs.isLoading} error={logs.error} empty={!logs.data?.length} />
      <ol style={{ margin: 0, paddingInlineStart: 18 }}>
        {logs.data?.map((log) => (
          <li key={log.id}>
            <Typography.Text type="secondary">{formatDateTime(log.created_at)}</Typography.Text>{" "}
            <span>
              {log.from_status ? `${labels[log.from_status] ?? log.from_status} → ` : ""}
              {labels[log.to_status] ?? log.to_status}
            </span>
            {log.operator?.name ? (
              <Typography.Text type="secondary"> · {log.operator.name}</Typography.Text>
            ) : null}
            {log.note ? (
              <Typography.Text type="secondary">（{log.note}）</Typography.Text>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}

/** 周期标签：优先用 period_start ~ period_end，否则回退 month。 */
function periodLabel(item: SalaryRecord): string {
  if (item.period_start && item.period_end) {
    return `${item.period_start} ~ ${item.period_end}`;
  }
  return item.month.slice(0, 7);
}

const DEFAULT_ROLE_TABS = [
  { code: "anchor", name: "主播" },
  { code: "host", name: "主持" },
  { code: "dance", name: "舞蹈老师" },
  { code: "makeup", name: "化妆师" },
  { code: "executive", name: "行政" },
  { code: "camera", name: "运镜" },
  { code: "hr", name: "人事" },
];

/** 读取结算时保存的调整项，不读取流水页尚未结算的临时输入。 */
function readAdjustments(value: SalaryRecord["adjustments"]): PayrollAdjustment[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    if (
      typeof entry.name !== "string" ||
      typeof entry.amountCents !== "number" ||
      !Number.isSafeInteger(entry.amountCents)
    ) {
      return [];
    }
    return [
      {
        name: entry.name,
        amountCents: entry.amountCents,
        sourceDate: typeof entry.sourceDate === "string" ? entry.sourceDate : undefined,
        sourceOperator: typeof entry.sourceOperator === "string" ? entry.sourceOperator : undefined,
      },
    ];
  });
}

function signedAmount(cents: number): string {
  return `${cents > 0 ? "+" : ""}${formatCentsToYuan(cents)}`;
}

/** 调整项合计（分）。 */
function adjustmentTotal(record: SalaryRecord): number {
  return readAdjustments(record.adjustments).reduce(
    (sum, adjustment) => sum + adjustment.amountCents,
    0,
  );
}

/** 主播阶梯提点（bps）：最终提成率减去基础提成率与考勤/dy 加点；未计提成时为 0。 */
function tierBonusBps(record: SalaryRecord): number {
  if (record.commission_rate_bps <= 0) return 0;
  return Math.max(
    record.commission_rate_bps
      - (record.base_commission_rate_bps ?? 0)
      - (record.attendance_bonus_bps ?? 0)
      - (record.dy_task_bonus_bps ?? 0),
    0,
  );
}

/** 工资表格列：在 antd 列基础上附带 Excel 导出取值与拖拽列宽能力。 */
type AnchorColumn = ResizableColumnType<SalaryRecord> & ExcelColumn<SalaryRecord>;

export default function PayrollPage() {
  const { message } = App.useApp();
  const confirm = useConfirm();
  const salary = useSalaryRecords();
  const members = useMembers();
  const roles = useRoles();
  const me = useCurrentProfile();
  const transition = useTransitionSalaryStatus();
  const reject = useRejectAndRecompute();
  const removeSalary = useDeleteSalaryRecord();
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  // 勾选的行：用于「下载选中部分」；为空时下载当前筛选的全部行。
  const [selectedRowKeys, setSelectedRowKeys] = useState<Key[]>([]);
  // 驳回重算的行内反馈：记录每行最近一次操作结果提示。
  const [recomputeFeedback, setRecomputeFeedback] = useState<{
    id: string;
    ok: boolean;
    message: string;
  } | null>(null);

  // 筛选状态
  const [memberId, setMemberId] = useState("");
  const [period, setPeriod] = useState("");
  const [status, setStatus] = useState("");
  const [activeRole, setActiveRole] = useState("anchor");

  const operatorProfileId = me.data?.id;

  /**
   * 「正在重算」从 mutation 自身派生，而不是另存一个单槽 state：
   * 两行先后驳回时单槽会被后一次覆盖，先完成者的 onSettled 会提前解锁另一行。
   */
  const recomputingId = reject.isPending ? (reject.variables?.id ?? null) : null;

  async function handleReject(id: string) {
    const ok = await confirm({
      title: "确认驳回并重算",
      content: "驳回后会按当前流水重新计算该工资条，已结算金额将被覆盖。确认继续？",
      okText: "确认驳回",
      okButtonProps: { danger: true },
    });
    if (!ok) return;
    setRecomputeFeedback(null);
    reject.mutate(
      { id, operatorProfileId },
      {
        onSuccess: () =>
          setRecomputeFeedback({ id, ok: true, message: "驳回重算成功，已按当前流水重新计算" }),
        onError: (err) =>
          setRecomputeFeedback({
            id,
            ok: false,
            message: err instanceof Error ? err.message : "驳回重算失败",
          }),
      },
    );
  }

  async function handleDeleteSalary(record: SalaryRecord) {
    const ok = await confirm({
      title: "确认删除工资条",
      content: `确认删除「${record.profile?.name ?? "该成员"}」的工资条（实发 ${formatCentsToYuan(record.net_cents)}）？删除后对应收支记录会一并移除，已完成工资条不可删除。`,
      okText: "确认删除",
      okButtonProps: { danger: true },
    });
    if (!ok) return;
    removeSalary.mutate(
      { id: record.id, kind: "anchor" },
      {
        onSuccess: () => message.success("工资条已删除"),
        onError: (err) => message.error(err instanceof Error ? err.message : "删除失败，请稍后重试"),
      },
    );
  }

  function transitionTo(record: SalaryRecord, next: "pending_confirm" | "completed") {
    transition.mutate(
      {
        id: record.id,
        status: next,
        operatorProfileId,
        note: next === "pending_confirm" ? "管理员审核通过" : "管理员确认到账",
      },
      {
        onError: (err) =>
          message.error(err instanceof Error ? err.message : "状态变更失败，请稍后重试"),
      },
    );
  }

  // 角色标签独立于工资记录，未结算或筛选为空时也不会消失。
  const roleTabs = useMemo(() => {
    const map = new Map(DEFAULT_ROLE_TABS.map((role) => [role.code, role]));
    for (const role of roles.data ?? []) map.set(role.code, role);
    return Array.from(map.values());
  }, [roles.data]);

  const anchorRecords = useMemo(
    () => (salary.data ?? []).filter((item) => item.role?.code === "anchor"),
    [salary.data],
  );

  const adjustmentColumns = useMemo(() => {
    const presets = getAdjustmentPresets(0).map((item) => item.name);
    const names = new Set(
      anchorRecords.flatMap((item) =>
        readAdjustments(item.adjustments)
          .map((adjustment) => adjustment.name.trim())
          .filter(Boolean),
      ),
    );
    return [
      ...presets,
      ...Array.from(names)
        .filter((name) => !presets.includes(name))
        .sort((a, b) => a.localeCompare(b, "zh-CN")),
    ];
  }, [anchorRecords]);

  const anchorMembers = useMemo(() => {
    const profileIds = new Set(anchorRecords.map((item) => item.profile_id));
    return (members.data ?? []).filter((member) => profileIds.has(member.id));
  }, [anchorRecords, members.data]);

  const periods = useMemo(
    () => Array.from(new Set(anchorRecords.map(periodLabel))).sort((a, b) => b.localeCompare(a)),
    [anchorRecords],
  );

  const filtered = useMemo(
    () =>
      anchorRecords.filter((item) => {
        if (memberId && item.profile_id !== memberId) return false;
        if (period && periodLabel(item) !== period) return false;
        if (status && item.status !== status) return false;
        return true;
      }),
    [anchorRecords, memberId, period, status],
  );

  const toggleExpand = (id: string) => {
    setExpandedKeys((prev) => (prev.includes(id) ? [] : [id]));
  };

  // 只认当前筛选结果里的勾选行，避免筛选后残留不可见的选中项。
  const selectedRecords = useMemo(
    () => filtered.filter((item) => selectedRowKeys.includes(item.id)),
    [filtered, selectedRowKeys],
  );
  const exportRecords = selectedRecords.length ? selectedRecords : filtered;

  const anchorColumns: AnchorColumn[] = [
    {
      title: "主播姓名",
      fixed: "left",
      width: 140,
      exportValue: (record) => record.profile?.name ?? "未关联",
      render: (_, record) => (
        <Button type="link" size="small" onClick={() => toggleExpand(record.id)}>
          {record.profile?.name ?? "未关联"}
        </Button>
      ),
    },
    {
      title: "结算周期",
      width: 190,
      exportValue: (record) => periodLabel(record),
      render: (_, record) => (
        <span style={{ whiteSpace: "nowrap", fontSize: 12 }}>{periodLabel(record)}</span>
      ),
    },
    {
      title: "无责期状态",
      width: 110,
      exportValue: (record) => (record.is_grace_period ? "无责期" : "非无责期"),
      render: (_, record) => (record.is_grace_period ? "无责期" : "非无责期"),
    },
    {
      title: "保底金额",
      width: 110,
      align: "right",
      exportValue: (record) => centsToYuanNumber(record.base_guarantee_cents),
      render: (_, record) => formatCentsToYuan(record.base_guarantee_cents),
    },
    {
      title: "总音浪",
      width: 110,
      align: "right",
      exportValue: (record) => Number((record.revenue_cents / 10).toFixed(1)),
      render: (_, record) => (
        <span title="按总流水 × 10 折算，非原始录入音浪">
          {(record.revenue_cents / 10).toLocaleString("zh-CN", { maximumFractionDigits: 1 })}
        </span>
      ),
    },
    {
      title: "总流水",
      width: 110,
      align: "right",
      exportValue: (record) => centsToYuanNumber(record.revenue_cents),
      render: (_, record) => formatCentsToYuan(record.revenue_cents),
    },
    {
      title: "直播时长",
      width: 110,
      align: "right",
      exportValue: (record) =>
        record.broadcast_minutes > 0 ? formatDurationSeconds(record.broadcast_minutes * 60) : "",
      render: (_, record) =>
        record.broadcast_minutes > 0 ? formatDurationSeconds(record.broadcast_minutes * 60) : "—",
    },
    {
      title: "拿提点门槛",
      width: 120,
      align: "right",
      exportValue: (record) => centsToYuanNumber(record.commission_start_cents),
      render: (_, record) => formatCentsToYuan(record.commission_start_cents),
    },
    {
      title: "拿保底门槛",
      width: 120,
      align: "right",
      exportValue: (record) => centsToYuanNumber(record.threshold_cents),
      render: (_, record) => formatCentsToYuan(record.threshold_cents),
    },
    {
      title: "是否达标",
      width: 100,
      exportValue: (record) => (record.is_qualified ? "达标" : "未达标"),
      render: (_, record) => (record.is_qualified ? "达标" : "未达标"),
    },
    {
      title: "基础提成率",
      width: 120,
      align: "right",
      exportValue: (record) => bpsToRatio(record.base_commission_rate_bps ?? 0),
      render: (_, record) => (
        <span title="结算时该主播的基础提成率快照">
          {formatBpsAsPercent(record.base_commission_rate_bps ?? 0)}
        </span>
      ),
    },
    {
      title: "阶梯提点",
      width: 110,
      align: "right",
      exportValue: (record) => bpsToRatio(tierBonusBps(record)),
      render: (_, record) => (
        <span
          title={
            record.commission_rate_bps === 0
              ? "未达提成起征线，本次未计提"
              : "每满 1 万流水 +1%，最高 +5%"
          }
        >
          {formatBpsAsPercent(tierBonusBps(record))}
        </span>
      ),
    },
    {
      title: "考勤加点",
      width: 110,
      align: "right",
      exportValue: (record) => bpsToRatio(record.attendance_bonus_bps ?? 0),
      render: (_, record) => (
        <span title="结算保存的考勤加点，仅达到提成起征线后生效">
          {(record.attendance_bonus_bps ?? 0) / 100}
        </span>
      ),
    },
    {
      title: "dy任务加点",
      width: 120,
      align: "right",
      exportValue: (record) => bpsToRatio(record.dy_task_bonus_bps ?? 0),
      render: (_, record) => (
        <span title="结算保存的dy任务加点，仅达到提成起征线后生效">
          {(record.dy_task_bonus_bps ?? 0) / 100}
        </span>
      ),
    },
    {
      title: "最终提成率",
      width: 120,
      align: "right",
      exportValue: (record) => bpsToRatio(record.commission_rate_bps),
      render: (_, record) => (
        <span
          title={
            record.commission_rate_bps === 0 ? "本次结算未计提成" : "本次结算实际采用的提成率"
          }
        >
          {formatBpsAsPercent(record.commission_rate_bps)}
        </span>
      ),
    },
    {
      title: "基础收益",
      width: 110,
      align: "right",
      exportValue: (record) => centsToYuanNumber(record.gross_cents - adjustmentTotal(record)),
      render: (_, record) => (
        <span title="已结算实发收益扣除调整项合计">
          {formatCentsToYuan(record.gross_cents - adjustmentTotal(record))}
        </span>
      ),
    },
    ...adjustmentColumns.map((name) => ({
      title: name,
      key: `adj-${name}`,
      width: 120,
      align: "right" as const,
      exportValue: (record: SalaryRecord) => {
        const items = readAdjustments(record.adjustments).filter(
          (adjustment) => adjustment.name.trim() === name,
        );
        if (!items.length) return null;
        return centsToYuanNumber(items.reduce((sum, adjustment) => sum + adjustment.amountCents, 0));
      },
      render: (_: unknown, record: SalaryRecord) => {
        const items = readAdjustments(record.adjustments).filter(
          (adjustment) => adjustment.name.trim() === name,
        );
        const total = items.reduce((sum, adjustment) => sum + adjustment.amountCents, 0);
        return (
          <span
            title={items.length > 1 ? `${items.length} 项合计，可展开查看明细` : undefined}
            style={{
              color: total < 0 ? "#cf1322" : total > 0 ? "#389e0d" : "#8c8c8c",
            }}
          >
            {items.length ? signedAmount(total) : "—"}
          </span>
        );
      },
    })),
    {
      title: "调整合计",
      width: 110,
      align: "right",
      exportValue: (record) =>
        readAdjustments(record.adjustments).length ? centsToYuanNumber(adjustmentTotal(record)) : null,
      render: (_, record) => {
        const adjustments = readAdjustments(record.adjustments);
        const total = adjustments.reduce((sum, adjustment) => sum + adjustment.amountCents, 0);
        return adjustments.length ? signedAmount(total) : "—";
      },
    },
    {
      title: "实发收益",
      width: 110,
      align: "right",
      exportValue: (record) => centsToYuanNumber(record.gross_cents),
      render: (_, record) => formatCentsToYuan(record.gross_cents),
    },
    {
      title: "服务率",
      width: 90,
      align: "right",
      exportValue: (record) => bpsToRatio(record.service_fee_rate_bps),
      render: (_, record) => formatBpsAsPercent(record.service_fee_rate_bps),
    },
    {
      title: "服务费",
      width: 110,
      align: "right",
      exportValue: (record) => centsToYuanNumber(record.service_fee_cents),
      render: (_, record) => formatCentsToYuan(record.service_fee_cents),
    },
    {
      title: "到手工资",
      width: 120,
      align: "right",
      exportValue: (record) => centsToYuanNumber(record.net_cents),
      render: (_, record) => (
        <Typography.Text strong>{formatCentsToYuan(record.net_cents)}</Typography.Text>
      ),
    },
    {
      title: "备注",
      width: 160,
      exportValue: (record) => record.note ?? "",
      render: (_, record) =>
        record.note ? (
          <span style={{ whiteSpace: "pre-wrap" }} title={record.note}>
            {record.note}
          </span>
        ) : (
          <span style={{ color: "#8c8c8c" }}>—</span>
        ),
    },
    {
      title: "状态",
      key: "status",
      width: 110,
      sortValue: (record) => record.status,
      render: (_, record) => <SalaryRecordStatusBadge status={record.status} />,
    },
    {
      title: "操作",
      key: "action",
      fixed: "right",
      width: 200,
      render: (_, record) => (
        <div>
          <Flex gap={4} wrap>
            {record.status === "pending_review" ? (
              <>
                <Button
                  size="small"
                  loading={transition.isPending && transition.variables?.id === record.id}
                  onClick={() => transitionTo(record, "pending_confirm")}
                >
                  通过
                </Button>
                <Button
                  size="small"
                  disabled={recomputingId === record.id}
                  onClick={() => handleReject(record.id)}
                >
                  {recomputingId === record.id ? "重算中…" : "驳回重算"}
                </Button>
              </>
            ) : null}
            {record.status === "confirmed" ? (
              <Button
                size="small"
                loading={transition.isPending && transition.variables?.id === record.id}
                onClick={() => transitionTo(record, "completed")}
              >
                确认到账
              </Button>
            ) : null}
            {record.status !== "completed" ? (
              <Button
                size="small"
                danger
                loading={removeSalary.isPending && removeSalary.variables?.id === record.id}
                onClick={() => handleDeleteSalary(record)}
              >
                删除
              </Button>
            ) : null}
          </Flex>
          {recomputeFeedback?.id === record.id ? (
            <Typography.Text
              type={recomputeFeedback.ok ? "success" : "danger"}
              style={{ fontSize: 12 }}
            >
              {recomputeFeedback.message}
            </Typography.Text>
          ) : null}
        </div>
      ),
    },
  ];

  // 每列都以 Excel 导出取值作为排序依据，避免为大量列重复声明 sortValue。
  const anchorTableColumns = anchorColumns.map((column) => {
    const exportValue = column.exportValue;
    const sortValue =
      column.sortValue ??
      (exportValue ? (record: SalaryRecord) => exportValue(record) : undefined);
    return { ...column, sortValue };
  });

  function handleDownloadAnchor() {
    downloadExcel({
      fileName: `主播工资条_${fileStamp()}.xlsx`,
      sheetName: "主播工资条",
      columns: anchorColumns,
      records: exportRecords,
    });
  }

  return (
    <>
      <PageHeader
        title="工资核算"
        description="按角色查看工资条；展开行可查看状态变更历史与结算参数明细"
      />

      <Tabs
        activeKey={activeRole}
        onChange={(key) => {
          setActiveRole(key);
          setExpandedKeys([]);
          setSelectedRowKeys([]);
        }}
        items={roleTabs.map((role) => ({
          key: role.code,
          label: role.name,
          children:
            role.code === "anchor" ? (
              <>
                <Card style={{ marginBottom: 16 }}>
                  <Row gutter={[16, 16]}>
                    <Col xs={24} md={8}>
                      <Select
                        style={{ width: "100%" }}
                        value={memberId}
                        onChange={(value) => {
                          setMemberId(value);
                          setSelectedRowKeys([]);
                        }}
                        options={[
                          { value: "", label: "全部主播" },
                          ...anchorMembers.map((m) => ({ value: m.id, label: m.name })),
                        ]}
                      />
                    </Col>
                    <Col xs={24} md={8}>
                      <Select
                        style={{ width: "100%" }}
                        value={period}
                        onChange={(value) => {
                          setPeriod(value);
                          setSelectedRowKeys([]);
                        }}
                        options={[
                          { value: "", label: "全部周期" },
                          ...periods.map((p) => ({ value: p, label: p })),
                        ]}
                      />
                    </Col>
                    <Col xs={24} md={8}>
                      <Select
                        style={{ width: "100%" }}
                        value={status}
                        onChange={(value) => {
                          setStatus(value);
                          setSelectedRowKeys([]);
                        }}
                        options={[
                          { value: "", label: "全部状态" },
                          { value: "pending_review", label: "待审核" },
                          { value: "pending_confirm", label: "待确认" },
                          { value: "confirmed", label: "已确认" },
                          { value: "completed", label: "已完成" },
                        ]}
                      />
                    </Col>
                  </Row>
                </Card>

                <Card
                  title="主播工资条"
                  extra={
                    <Flex align="center" gap={12}>
                      <Typography.Text type="secondary">
                        共 {filtered.length} 条记录 · 金额单位：元 · 左右滑动查看全部字段
                      </Typography.Text>
                      <Button
                        icon={<DownloadOutlined />}
                        disabled={!exportRecords.length}
                        onClick={handleDownloadAnchor}
                      >
                        {selectedRecords.length
                          ? `下载选中(${selectedRecords.length})`
                          : "下载表格"}
                      </Button>
                    </Flex>
                  }
                >
                {salary.error ? (
                  <QueryMessage loading={false} error={salary.error} />
                ) : (
                  <ResizableTable<SalaryRecord>
                    rowClassName={zebraRowClassName}
                    rowKey="id"
                    loading={salary.isLoading}
                    dataSource={filtered}
                    locale={{ emptyText: "暂无工资条" }}
                    rowSelection={{
                      selectedRowKeys,
                      onChange: (keys) => setSelectedRowKeys(keys),
                      preserveSelectedRowKeys: true,
                    }}
                    expandable={{
                      expandedRowKeys: expandedKeys,
                      // 用 onExpand 而不是 onExpandedRowsChange + slice(-1)：
                      // 后者依赖「新 key 追加在数组末尾」这一 antd 内部实现细节
                      onExpand: (expanded, record) =>
                        setExpandedKeys(expanded ? [record.id] : []),
                      expandedRowRender: (record) => {
                        const adjustments = readAdjustments(record.adjustments);
                        const attendanceBonusBps = record.attendance_bonus_bps ?? 0;
                        const dyTaskBonusBps = record.dy_task_bonus_bps ?? 0;
                        return (
                          <Flex vertical gap={8}>
                            <StatusTimeline recordId={record.id} />
                            <div
                              style={{
                                background: "#fafafa",
                                padding: 12,
                                fontSize: 12,
                                color: "rgba(0,0,0,0.65)",
                              }}
                            >
                              <div>在职月序：{record.tenure_month} 月</div>
                              <div>保底基准：{formatCentsToYuan(record.base_guarantee_cents)}</div>
                              <div>达标门槛：{formatCentsToYuan(record.threshold_cents)}</div>
                              <div>提成起征：{formatCentsToYuan(record.commission_start_cents)}</div>
                              <div>
                                考勤加点：{formatBpsAsPercent(attendanceBonusBps)}；dy任务加点：
                                {formatBpsAsPercent(dyTaskBonusBps)}（未起征时不计入提成）
                              </div>
                            </div>
                            {adjustments.length ? (
                              <div
                                style={{
                                  background: "#fafafa",
                                  padding: 12,
                                  fontSize: 12,
                                  color: "rgba(0,0,0,0.65)",
                                }}
                              >
                                <Typography.Text strong>结算调整明细</Typography.Text>
                                {adjustments.map((adjustment, index) => (
                                  <Flex key={index} gap={12}>
                                    <span style={{ maxWidth: 220, wordBreak: "break-word" }}>
                                      {adjustment.name || "未命名调整"}
                                      {adjustment.sourceDate || adjustment.sourceOperator ? (
                                        <Typography.Text type="secondary" style={{ display: "block", fontSize: 12 }}>
                                          来源：{adjustment.sourceDate ?? "—"}
                                          {adjustment.sourceOperator ? ` · 登记 ${adjustment.sourceOperator}` : ""}
                                        </Typography.Text>
                                      ) : null}
                                    </span>
                                    <span
                                      style={{
                                        fontVariantNumeric: "tabular-nums",
                                        color: adjustment.amountCents < 0 ? "#cf1322" : "#389e0d",
                                      }}
                                    >
                                      {signedAmount(adjustment.amountCents)}
                                    </span>
                                  </Flex>
                                ))}
                              </div>
                            ) : null}
                          </Flex>
                        );
                      },
                    }}
                    columns={anchorTableColumns}
                  />
                )}
                </Card>
              </>
            ) : role.code === "host" ? (
              <HostPayrollPanel operatorProfileId={operatorProfileId} />
            ) : (
              <StaffPayrollPanel
                roleCode={role.code}
                roleName={role.name}
                operatorProfileId={operatorProfileId}
              />
            ),
        }))}
      />
    </>
  );
}
