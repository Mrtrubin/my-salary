"use client";

import { App, Button, Card, Col, Flex, Row, Select, Typography } from "antd";
import { DownloadOutlined } from "@ant-design/icons";
import { useMemo, useState, type Key } from "react";
import { QueryMessage } from "@/components/admin/query-message";
import { ResizableTable, type ResizableColumnType } from "@/components/admin/resizable-table";
import { SalaryRecordStatusBadge } from "@/components/admin/status-tag";
import { zebraRowClassName } from "@/components/admin/table-zebra";
import { useConfirm } from "@/components/admin/use-confirm";
import {
  useDeleteSalaryRecord,
  useHostSalaryRecords,
  useHostSalaryStatusLogs,
  useRejectAndRecomputeHostSalary,
  useTransitionHostSalaryStatus,
} from "@/lib/api/hooks";
import type { HostSalaryRecord } from "@/lib/api/data";
import { formatBpsAsPercent, formatCentsToYuan, formatDateTime, formatDurationSeconds } from "@/lib/format";
import { bpsToRatio, centsToYuanNumber, downloadExcel, fileStamp, type ExcelColumn } from "@/lib/excel";

const STATUS_LABELS: Record<string, string> = {
  pending_review: "待审核",
  pending_confirm: "待确认",
  confirmed: "已确认",
  completed: "已完成",
};

function periodLabel(item: HostSalaryRecord): string {
  return `${item.period_start} ~ ${item.period_end}`;
}

function signedAmount(cents: number): string {
  return `${cents > 0 ? "+" : ""}${formatCentsToYuan(cents)}`;
}

interface HostAdjustment {
  name: string;
  amountCents: number;
}

function readAdjustments(value: HostSalaryRecord["adjustments"]): HostAdjustment[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    if (typeof entry.name !== "string" || typeof entry.amountCents !== "number" || !Number.isSafeInteger(entry.amountCents)) {
      return [];
    }
    return [{ name: entry.name, amountCents: entry.amountCents }];
  });
}

interface BreakdownItem {
  teamId?: string;
  teamName?: string | null;
  revenueCents?: number;
  broadcastMinutes?: number;
}

function readBreakdown(value: HostSalaryRecord["team_breakdown"]): BreakdownItem[] {
  if (!Array.isArray(value)) return [];
  return value as unknown as BreakdownItem[];
}

/** 主持工资表格列：在 antd 列基础上附带 Excel 导出取值与拖拽列宽能力。 */
type HostColumn = ResizableColumnType<HostSalaryRecord> & ExcelColumn<HostSalaryRecord>;

function HostStatusTimeline({ recordId }: { recordId: string }) {
  const logs = useHostSalaryStatusLogs(recordId);
  return (
    <div style={{ background: "#fafafa", padding: 12, fontSize: 12 }}>
      <QueryMessage loading={logs.isLoading} error={logs.error} empty={!logs.data?.length} />
      <ol style={{ margin: 0, paddingInlineStart: 18 }}>
        {logs.data?.map((log) => (
          <li key={log.id}>
            <Typography.Text type="secondary">{formatDateTime(log.created_at)}</Typography.Text>{" "}
            <span>
              {log.from_status ? `${STATUS_LABELS[log.from_status] ?? log.from_status} → ` : ""}
              {STATUS_LABELS[log.to_status] ?? log.to_status}
            </span>
            {log.operator?.name ? <Typography.Text type="secondary"> · {log.operator.name}</Typography.Text> : null}
            {log.note ? <Typography.Text type="secondary">（{log.note}）</Typography.Text> : null}
          </li>
        ))}
      </ol>
    </div>
  );
}

export function HostPayrollPanel({ operatorProfileId }: { operatorProfileId?: string }) {
  const { message } = App.useApp();
  const confirm = useConfirm();
  const salary = useHostSalaryRecords();
  const transition = useTransitionHostSalaryStatus();
  const reject = useRejectAndRecomputeHostSalary();
  const removeSalary = useDeleteSalaryRecord();
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  // 勾选的行：用于「下载选中部分」；为空时下载当前筛选的全部行。
  const [selectedRowKeys, setSelectedRowKeys] = useState<Key[]>([]);
  const [period, setPeriod] = useState("");
  const [status, setStatus] = useState("");
  const [recomputeFeedback, setRecomputeFeedback] = useState<{ id: string; ok: boolean; message: string } | null>(null);

  const records = useMemo(() => salary.data ?? [], [salary.data]);
  const periods = useMemo(
    () => Array.from(new Set(records.map(periodLabel))).sort((a, b) => b.localeCompare(a)),
    [records],
  );
  const filtered = useMemo(
    () =>
      records.filter((item) => {
        if (period && periodLabel(item) !== period) return false;
        if (status && item.status !== status) return false;
        return true;
      }),
    [records, period, status],
  );

  // 只认当前筛选结果里的勾选行，避免筛选后残留不可见的选中项。
  const selectedRecords = useMemo(
    () => filtered.filter((item) => selectedRowKeys.includes(item.id)),
    [filtered, selectedRowKeys],
  );
  const exportRecords = selectedRecords.length ? selectedRecords : filtered;

  const recomputingId = reject.isPending ? (reject.variables ?? null) : null;

  async function handleReject(id: string) {
    const ok = await confirm({
      title: "确认驳回并重算",
      content: "驳回后会按当前流水重新计算该主持工资条，已结算金额将被覆盖。确认继续？",
      okText: "确认驳回",
      okButtonProps: { danger: true },
    });
    if (!ok) return;
    setRecomputeFeedback(null);
    reject.mutate(id, {
      onSuccess: () => setRecomputeFeedback({ id, ok: true, message: "驳回重算成功，已按当前流水重新计算" }),
      onError: (err) =>
        setRecomputeFeedback({ id, ok: false, message: err instanceof Error ? err.message : "驳回重算失败" }),
    });
  }

  function transitionTo(record: HostSalaryRecord, next: "pending_confirm" | "completed") {
    transition.mutate(
      {
        id: record.id,
        status: next,
        operatorProfileId,
        note: next === "pending_confirm" ? "管理员审核通过" : "管理员确认到账",
      },
      {
        onError: (err) => message.error(err instanceof Error ? err.message : "状态变更失败，请稍后重试"),
      },
    );
  }

  const hostColumns: HostColumn[] = [
    {
      title: "主持姓名",
      fixed: "left",
      width: 130,
      exportValue: (record) => record.host?.name ?? "未关联",
      render: (_, record) => (
        <Button
          type="link"
          size="small"
          onClick={() => setExpandedKeys(expandedKeys.includes(record.id) ? [] : [record.id])}
        >
          {record.host?.name ?? "未关联"}
        </Button>
      ),
    },
    {
      title: "团队名称",
      width: 170,
      exportValue: (record) => {
        const names = readBreakdown(record.team_breakdown).map((item) => item.teamName ?? "未知团队");
        return names.length ? names.join("、") : "—";
      },
      render: (_, record) => {
        const names = readBreakdown(record.team_breakdown).map((item) => item.teamName ?? "未知团队");
        return names.length ? names.join("、") : "—";
      },
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
      title: "团总流水",
      width: 120,
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
      exportValue: (record) => centsToYuanNumber(record.threshold_cents),
      render: (_, record) => formatCentsToYuan(record.threshold_cents),
    },
    {
      title: "是否达标",
      width: 100,
      exportValue: (record) => (record.is_qualified ? "是" : "否"),
      render: (_, record) => (record.is_qualified ? "是" : "否"),
    },
    {
      title: "基础提成率",
      width: 120,
      align: "right",
      exportValue: (record) => bpsToRatio(record.base_commission_rate_bps),
      render: (_, record) => formatBpsAsPercent(record.base_commission_rate_bps),
    },
    {
      title: "阶梯式提点",
      width: 120,
      align: "right",
      exportValue: (record) => bpsToRatio(record.tier_bonus_bps),
      render: (_, record) => (
        <span title="超拿提点门槛每满 10 万 +1 个点，最高 +3 个点">
          {formatBpsAsPercent(record.tier_bonus_bps)}
        </span>
      ),
    },
    {
      title: "最终提成率",
      width: 120,
      align: "right",
      exportValue: (record) => bpsToRatio(record.commission_rate_bps),
      render: (_, record) => (
        <span title="最终提成率 = 基础提成率 + 阶梯式提点">
          {formatBpsAsPercent(record.commission_rate_bps)}
        </span>
      ),
    },
    {
      title: "基础收益",
      width: 110,
      align: "right",
      exportValue: (record) => centsToYuanNumber(record.base_income_cents),
      render: (_, record) => formatCentsToYuan(record.base_income_cents),
    },
    {
      title: "总违约",
      width: 110,
      align: "right",
      exportValue: (record) => {
        const total = readAdjustments(record.adjustments)
          .filter((item) => item.amountCents < 0)
          .reduce((sum, item) => sum + item.amountCents, 0);
        return total ? centsToYuanNumber(total) : null;
      },
      render: (_, record) => {
        const total = readAdjustments(record.adjustments)
          .filter((item) => item.amountCents < 0)
          .reduce((sum, item) => sum + item.amountCents, 0);
        return total ? <span style={{ color: "#cf1322" }}>{signedAmount(total)}</span> : "—";
      },
    },
    {
      title: "总奖励",
      width: 110,
      align: "right",
      exportValue: (record) => {
        const total = readAdjustments(record.adjustments)
          .filter((item) => item.amountCents > 0)
          .reduce((sum, item) => sum + item.amountCents, 0);
        return total ? centsToYuanNumber(total) : null;
      },
      render: (_, record) => {
        const total = readAdjustments(record.adjustments)
          .filter((item) => item.amountCents > 0)
          .reduce((sum, item) => sum + item.amountCents, 0);
        return total ? <span style={{ color: "#389e0d" }}>{signedAmount(total)}</span> : "—";
      },
    },
    {
      title: "调整合计",
      width: 110,
      align: "right",
      exportValue: (record) => {
        const adjustments = readAdjustments(record.adjustments);
        if (!adjustments.length) return null;
        return centsToYuanNumber(adjustments.reduce((sum, item) => sum + item.amountCents, 0));
      },
      render: (_, record) => {
        const adjustments = readAdjustments(record.adjustments);
        const total = adjustments.reduce((sum, item) => sum + item.amountCents, 0);
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
      width: 100,
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
      title: "到手收益",
      width: 120,
      align: "right",
      exportValue: (record) => centsToYuanNumber(record.net_cents),
      render: (_, record) => (
        <Typography.Text strong>{formatCentsToYuan(record.net_cents)}</Typography.Text>
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
                onClick={async () => {
                  const ok = await confirm({
                    title: "确认删除主持工资条",
                    content: `确认删除该工资条（实发 ${formatCentsToYuan(record.net_cents)}）？删除后对应收支记录会一并移除，已完成工资条不可删除。`,
                    okText: "确认删除",
                    okButtonProps: { danger: true },
                  });
                  if (!ok) return;
                  removeSalary.mutate(
                    { id: record.id, kind: "host" },
                    {
                      onSuccess: () => message.success("工资条已删除"),
                      onError: (err) => message.error(err instanceof Error ? err.message : "删除失败，请稍后重试"),
                    },
                  );
                }}
              >
                删除
              </Button>
            ) : null}
          </Flex>
          {recomputeFeedback?.id === record.id ? (
            <Typography.Text type={recomputeFeedback.ok ? "success" : "danger"} style={{ fontSize: 12 }}>
              {recomputeFeedback.message}
            </Typography.Text>
          ) : null}
        </div>
      ),
    },
  ];

  // 每列都以 Excel 导出取值作为排序依据，避免为大量列重复声明 sortValue。
  const tableColumns = hostColumns.map((column) => {
    const exportValue = column.exportValue;
    const sortValue =
      column.sortValue ??
      (exportValue ? (record: HostSalaryRecord) => exportValue(record) : undefined);
    return { ...column, sortValue };
  });

  function handleDownloadHost() {
    downloadExcel({
      fileName: `主持工资条_${fileStamp()}.xlsx`,
      sheetName: "主持工资条",
      columns: hostColumns,
      records: exportRecords,
    });
  }

  return (
    <>
      <Card style={{ marginBottom: 16 }}>
        <Row gutter={[16, 16]}>
          <Col xs={24} md={12}>
            <Select
              style={{ width: "100%" }}
              value={period}
              onChange={(value) => {
                setPeriod(value);
                setSelectedRowKeys([]);
              }}
              options={[{ value: "", label: "全部周期" }, ...periods.map((p) => ({ value: p, label: p }))]}
            />
          </Col>
          <Col xs={24} md={12}>
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
        title="主持工资条"
        extra={
          <Flex align="center" gap={12}>
            <Typography.Text type="secondary">
              共 {filtered.length} 条记录 · 金额单位：元 · 左右滑动查看全部字段
            </Typography.Text>
            <Button
              icon={<DownloadOutlined />}
              disabled={!exportRecords.length}
              onClick={handleDownloadHost}
            >
              {selectedRecords.length ? `下载选中(${selectedRecords.length})` : "下载表格"}
            </Button>
          </Flex>
        }
      >
        {salary.error ? (
          <QueryMessage loading={false} error={salary.error} />
        ) : (
          <ResizableTable<HostSalaryRecord>
            rowClassName={zebraRowClassName}
            rowKey="id"
            loading={salary.isLoading}
            dataSource={filtered}
            columns={tableColumns}
            locale={{ emptyText: "暂无主持工资条" }}
            rowSelection={{
              selectedRowKeys,
              onChange: (keys) => setSelectedRowKeys(keys),
              preserveSelectedRowKeys: true,
            }}
            expandable={{
              expandedRowKeys: expandedKeys,
              onExpand: (expanded, record) => setExpandedKeys(expanded ? [record.id] : []),
              expandedRowRender: (record) => {
                const adjustments = readAdjustments(record.adjustments);
                const breakdown = readBreakdown(record.team_breakdown);
                return (
                  <Flex vertical gap={8}>
                    <HostStatusTimeline recordId={record.id} />
                    <div style={{ background: "#fafafa", padding: 12, fontSize: 12, color: "rgba(0,0,0,0.65)" }}>
                      <Typography.Text strong>团队流水明细</Typography.Text>
                      {breakdown.length ? (
                        <ul style={{ margin: "8px 0 0", paddingInlineStart: 18 }}>
                          {breakdown.map((item, index) => (
                            <li key={item.teamId ?? index}>
                              <Flex justify="space-between" gap={16}>
                                <span>{item.teamName ?? "未知团队"}</span>
                                <span style={{ fontVariantNumeric: "tabular-nums" }}>
                                  {formatCentsToYuan(item.revenueCents ?? 0)}
                                  {item.broadcastMinutes
                                    ? ` · ${formatDurationSeconds(item.broadcastMinutes * 60)}`
                                    : ""}
                                </span>
                              </Flex>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <Typography.Paragraph type="secondary" style={{ margin: "8px 0 0" }}>
                          该周期暂无团队流水。
                        </Typography.Paragraph>
                      )}
                    </div>
                    {adjustments.length ? (
                      <div style={{ background: "#fafafa", padding: 12, fontSize: 12, color: "rgba(0,0,0,0.65)" }}>
                        <Typography.Text strong>结算调整明细</Typography.Text>
                        {adjustments.map((adjustment, index) => (
                          <Flex key={index} gap={12}>
                            <span style={{ maxWidth: 220, wordBreak: "break-word" }}>{adjustment.name || "未命名调整"}</span>
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
          />
        )}
      </Card>
    </>
  );
}
