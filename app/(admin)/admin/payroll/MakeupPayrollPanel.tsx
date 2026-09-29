"use client";

import { App, Button, Card, Col, DatePicker, Flex, Input, Modal, Row, Select, Typography } from "antd";
import { DownloadOutlined, PlusOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { useMemo, useState, type Key } from "react";
import { QueryMessage } from "@/components/admin/query-message";
import { ResizableTable, type ResizableColumnType } from "@/components/admin/resizable-table";
import { SalaryRecordStatusBadge } from "@/components/admin/status-tag";
import { zebraRowClassName } from "@/components/admin/table-zebra";
import { useConfirm } from "@/components/admin/use-confirm";
import {
  useCreateMakeupSalaryRecords,
  useCurrentProfile,
  useMakeupSalaryRecords,
  useMakeupSalaryStatusLogs,
  useMembers,
  useRejectAndRecomputeMakeupSalary,
  useTransitionMakeupSalaryStatus,
} from "@/lib/api/hooks";
import type { MakeupSalaryRecord } from "@/lib/api/data";
import { getPresetRange } from "@/lib/domain/settlement/cycle";
import type { PeriodRange } from "@/lib/domain/settlement/cycle";
import { parseAdjustmentAmountYuan } from "@/lib/domain/payroll/adjustment";
import { formatCentsToYuan, formatDateTime } from "@/lib/format";
import { centsToYuanNumber, downloadExcel, fileStamp, type ExcelColumn } from "@/lib/excel";

const STATUS_LABELS: Record<string, string> = {
  pending_review: "待审核",
  pending_confirm: "待确认",
  confirmed: "已确认",
  completed: "已完成",
};

function periodLabel(item: MakeupSalaryRecord): string {
  return `${item.period_start} ~ ${item.period_end}`;
}

function signedAmount(cents: number): string {
  return `${cents > 0 ? "+" : ""}${formatCentsToYuan(cents)}`;
}

type MakeupColumn = ResizableColumnType<MakeupSalaryRecord> & ExcelColumn<MakeupSalaryRecord>;

function MakeupStatusTimeline({ recordId }: { recordId: string }) {
  const logs = useMakeupSalaryStatusLogs(recordId);
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

interface DraftRow {
  penalty: string;
  reward: string;
  note: string;
}

/** 空串视为 0；非法（含负数或超过两位小数）返回 null。 */
function parseOptionalYuan(value: string): number | null {
  if (!value.trim()) return 0;
  return parseAdjustmentAmountYuan(value);
}

export function MakeupPayrollPanel({ operatorProfileId }: { operatorProfileId?: string }) {
  const { message } = App.useApp();
  const confirm = useConfirm();
  const me = useCurrentProfile();
  const salary = useMakeupSalaryRecords();
  const members = useMembers();
  const create = useCreateMakeupSalaryRecords();
  const transition = useTransitionMakeupSalaryStatus();
  const reject = useRejectAndRecomputeMakeupSalary();
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  const [selectedRowKeys, setSelectedRowKeys] = useState<Key[]>([]);
  const [period, setPeriod] = useState("");
  const [status, setStatus] = useState("");
  const [recomputeFeedback, setRecomputeFeedback] = useState<{ id: string; ok: boolean; message: string } | null>(null);

  // 新增记录弹窗
  const [createOpen, setCreateOpen] = useState(false);
  const [draftPeriod, setDraftPeriod] = useState<PeriodRange>(() => getPresetRange("thisMonth"));
  const [selectedMakeupIds, setSelectedMakeupIds] = useState<string[]>([]);
  const [draftRows, setDraftRows] = useState<Record<string, DraftRow>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const operatorId = operatorProfileId ?? me.data?.id;

  const makeups = useMemo(
    () =>
      (members.data ?? []).filter(
        (m) => m.status === "active" && m.user_positions.some(({ position }) => position?.code === "makeup"),
      ),
    [members.data],
  );

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

  const selectedRecords = useMemo(
    () => filtered.filter((item) => selectedRowKeys.includes(item.id)),
    [filtered, selectedRowKeys],
  );
  const exportRecords = selectedRecords.length ? selectedRecords : filtered;

  const recomputingId = reject.isPending ? (reject.variables ?? null) : null;

  function openCreate() {
    setDraftPeriod(getPresetRange("thisMonth"));
    setSelectedMakeupIds([]);
    setDraftRows({});
    setFormError(null);
    setCreateOpen(true);
  }

  function onSelectMakeups(ids: string[]) {
    setSelectedMakeupIds(ids);
    setDraftRows((prev) => {
      const next = { ...prev };
      for (const id of ids) next[id] ??= { penalty: "", reward: "", note: "" };
      return next;
    });
  }

  async function submitCreate() {
    setFormError(null);
    if (!selectedMakeupIds.length) {
      setFormError("请至少选择一位化妆师");
      return;
    }
    if (draftPeriod.start > draftPeriod.end) {
      setFormError("起止日期无效");
      return;
    }
    const recordsToCreate = [];
    for (const id of selectedMakeupIds) {
      const row = draftRows[id] ?? { penalty: "", reward: "", note: "" };
      const penalty = parseOptionalYuan(row.penalty);
      const reward = parseOptionalYuan(row.reward);
      if (penalty === null || reward === null) {
        const name = makeups.find((m) => m.id === id)?.name ?? "化妆师";
        setFormError(`「${name}」的总违约/总奖励须为非负金额且最多两位小数`);
        return;
      }
      recordsToCreate.push({
        makeupProfileId: id,
        penaltyCents: -penalty,
        rewardCents: reward,
        note: row.note,
      });
    }
    try {
      await create.mutateAsync({ period: draftPeriod, records: recordsToCreate });
      setCreateOpen(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "新增记录失败，请稍后重试");
    }
  }

  async function handleReject(id: string) {
    const ok = await confirm({
      title: "确认驳回并重算",
      content: "驳回后会重新计算该化妆师收益条的合计并重置为待审核。确认继续？",
      okText: "确认驳回",
      okButtonProps: { danger: true },
    });
    if (!ok) return;
    setRecomputeFeedback(null);
    reject.mutate(id, {
      onSuccess: () => setRecomputeFeedback({ id, ok: true, message: "驳回重算成功" }),
      onError: (err) => setRecomputeFeedback({ id, ok: false, message: err instanceof Error ? err.message : "驳回重算失败" }),
    });
  }

  function transitionTo(record: MakeupSalaryRecord, next: "pending_confirm" | "completed") {
    transition.mutate(
      {
        id: record.id,
        status: next,
        operatorProfileId: operatorId,
        note: next === "pending_confirm" ? "管理员审核通过" : "管理员确认到账",
      },
      {
        onError: (err) => message.error(err instanceof Error ? err.message : "状态变更失败，请稍后重试"),
      },
    );
  }

  const columns: MakeupColumn[] = [
    {
      title: "化妆师姓名",
      fixed: "left",
      width: 140,
      exportValue: (record) => record.makeup?.name ?? "未关联",
      render: (_, record) => (
        <Button
          type="link"
          size="small"
          onClick={() => setExpandedKeys(expandedKeys.includes(record.id) ? [] : [record.id])}
        >
          {record.makeup?.name ?? "未关联"}
        </Button>
      ),
    },
    {
      title: "基础收益",
      width: 120,
      align: "right",
      exportValue: (record) => centsToYuanNumber(record.base_income_cents),
      render: (_, record) => (
        <span title="来源：化妆师管理-设置">{formatCentsToYuan(record.base_income_cents)}</span>
      ),
    },
    {
      title: "总违约",
      width: 120,
      align: "right",
      exportValue: (record) => (record.penalty_cents ? centsToYuanNumber(record.penalty_cents) : null),
      render: (_, record) =>
        record.penalty_cents ? (
          <span title="来源：工资核算-化妆师-新增记录（管理员设置）" style={{ color: "#cf1322" }}>
            {signedAmount(record.penalty_cents)}
          </span>
        ) : (
          "—"
        ),
    },
    {
      title: "总奖励",
      width: 120,
      align: "right",
      exportValue: (record) => (record.reward_cents ? centsToYuanNumber(record.reward_cents) : null),
      render: (_, record) =>
        record.reward_cents ? (
          <span title="来源：工资核算-化妆师-新增记录（管理员设置）" style={{ color: "#389e0d" }}>
            {signedAmount(record.reward_cents)}
          </span>
        ) : (
          "—"
        ),
    },
    {
      title: "调整合计",
      width: 120,
      align: "right",
      exportValue: (record) => (record.adjustment_cents ? centsToYuanNumber(record.adjustment_cents) : null),
      render: (_, record) =>
        record.adjustment_cents ? (
          <span
            title="系统计算：总违约 + 总奖励"
            style={{ color: record.adjustment_cents < 0 ? "#cf1322" : "#389e0d" }}
          >
            {signedAmount(record.adjustment_cents)}
          </span>
        ) : (
          "—"
        ),
    },
    {
      title: "实发收益",
      width: 120,
      align: "right",
      exportValue: (record) => centsToYuanNumber(record.gross_cents),
      render: (_, record) => (
        <span title="系统计算：基础收益 + 调整合计">{formatCentsToYuan(record.gross_cents)}</span>
      ),
    },
    {
      title: "到手收益",
      width: 130,
      align: "right",
      exportValue: (record) => centsToYuanNumber(record.net_cents),
      render: (_, record) => (
        <Typography.Text title="系统计算：到手收益 = 实发收益" type={record.net_cents < 0 ? "danger" : undefined} strong>
          {formatCentsToYuan(record.net_cents)}
        </Typography.Text>
      ),
    },
    {
      title: "结算周期",
      width: 190,
      exportValue: (record) => periodLabel(record),
      render: (_, record) => <span style={{ whiteSpace: "nowrap", fontSize: 12 }}>{periodLabel(record)}</span>,
    },
    {
      title: "备注",
      width: 160,
      exportValue: (record) => record.note ?? "",
      render: (_, record) =>
        record.note ? <span style={{ whiteSpace: "pre-wrap" }}>{record.note}</span> : <span style={{ color: "#8c8c8c" }}>—</span>,
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
                <Button size="small" disabled={recomputingId === record.id} onClick={() => handleReject(record.id)}>
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

  const tableColumns = columns.map((column) => {
    const exportValue = column.exportValue;
    const sortValue =
      column.sortValue ?? (exportValue ? (record: MakeupSalaryRecord) => exportValue(record) : undefined);
    return { ...column, sortValue };
  });

  function handleDownload() {
    downloadExcel({
      fileName: `化妆师收益管理_${fileStamp()}.xlsx`,
      sheetName: "化妆师收益管理",
      columns,
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
        title="化妆师收益管理"
        extra={
          <Flex align="center" gap={12}>
            <Typography.Text type="secondary">共 {filtered.length} 条记录 · 金额单位：元</Typography.Text>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              新增记录
            </Button>
            <Button icon={<DownloadOutlined />} disabled={!exportRecords.length} onClick={handleDownload}>
              {selectedRecords.length ? `下载选中(${selectedRecords.length})` : "下载表格"}
            </Button>
          </Flex>
        }
      >
        {salary.error ? (
          <QueryMessage loading={false} error={salary.error} />
        ) : (
          <ResizableTable<MakeupSalaryRecord>
            rowClassName={zebraRowClassName}
            rowKey="id"
            loading={salary.isLoading}
            dataSource={filtered}
            columns={tableColumns}
            locale={{ emptyText: "暂无化妆师收益记录" }}
            rowSelection={{
              selectedRowKeys,
              onChange: (keys) => setSelectedRowKeys(keys),
              preserveSelectedRowKeys: true,
            }}
            expandable={{
              expandedRowKeys: expandedKeys,
              onExpand: (expanded, record) => setExpandedKeys(expanded ? [record.id] : []),
              expandedRowRender: (record) => <MakeupStatusTimeline recordId={record.id} />,
            }}
          />
        )}
      </Card>

      <Modal
        title="新增化妆师收益记录"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={submitCreate}
        okText="保存"
        cancelText="取消"
        confirmLoading={create.isPending}
        width={760}
        destroyOnHidden
      >
        <Flex vertical gap={16}>
          <Flex align="center" gap={12} wrap>
            <Typography.Text>结算周期</Typography.Text>
            <DatePicker.RangePicker
              allowClear={false}
              value={[dayjs(draftPeriod.start), dayjs(draftPeriod.end)]}
              onChange={(dates) => {
                if (dates?.[0] && dates?.[1]) {
                  setDraftPeriod({
                    start: dates[0].format("YYYY-MM-DD"),
                    end: dates[1].format("YYYY-MM-DD"),
                  });
                }
              }}
            />
          </Flex>

          <div>
            <Typography.Text>选择化妆师</Typography.Text>
            <Select
              mode="multiple"
              showSearch
              optionFilterProp="label"
              style={{ width: "100%", marginTop: 8 }}
              placeholder="可搜索、多选"
              value={selectedMakeupIds}
              onChange={onSelectMakeups}
              options={makeups.map((m) => ({ value: m.id, label: m.name }))}
            />
          </div>

          {selectedMakeupIds.length ? (
            <div style={{ maxHeight: 320, overflow: "auto" }}>
              {selectedMakeupIds.map((id) => {
                const member = makeups.find((m) => m.id === id);
                const row = draftRows[id] ?? { penalty: "", reward: "", note: "" };
                return (
                  <div
                    key={id}
                    style={{ border: "1px solid #f0f0f0", borderRadius: 8, padding: 12, marginBottom: 8 }}
                  >
                    <Flex align="center" justify="space-between" gap={12}>
                      <Typography.Text strong>{member?.name ?? "化妆师"}</Typography.Text>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        基础收益 {formatCentsToYuan(member?.makeup_base_income_cents ?? 0)}
                      </Typography.Text>
                    </Flex>
                    <Row gutter={12} style={{ marginTop: 8 }}>
                      <Col span={8}>
                        <Input
                          aria-label={`${member?.name ?? "化妆师"}总违约（元）`}
                          inputMode="decimal"
                          placeholder="总违约（元，扣款）"
                          value={row.penalty}
                          status={parseOptionalYuan(row.penalty) === null ? "error" : undefined}
                          onChange={(event) =>
                            setDraftRows((prev) => ({ ...prev, [id]: { ...row, penalty: event.target.value } }))
                          }
                        />
                      </Col>
                      <Col span={8}>
                        <Input
                          aria-label={`${member?.name ?? "化妆师"}总奖励（元）`}
                          inputMode="decimal"
                          placeholder="总奖励（元，增加）"
                          value={row.reward}
                          status={parseOptionalYuan(row.reward) === null ? "error" : undefined}
                          onChange={(event) =>
                            setDraftRows((prev) => ({ ...prev, [id]: { ...row, reward: event.target.value } }))
                          }
                        />
                      </Col>
                      <Col span={8}>
                        <Input
                          aria-label={`${member?.name ?? "化妆师"}备注`}
                          placeholder="备注（选填）"
                          value={row.note}
                          maxLength={200}
                          onChange={(event) =>
                            setDraftRows((prev) => ({ ...prev, [id]: { ...row, note: event.target.value } }))
                          }
                        />
                      </Col>
                    </Row>
                  </div>
                );
              })}
            </div>
          ) : (
            <Typography.Text type="secondary">
              选择化妆师后可分别填写总违约、总奖励；基础收益自动带入，实发收益 = 基础收益 + 调整合计。
            </Typography.Text>
          )}

          {formError ? <Typography.Text type="danger">{formError}</Typography.Text> : null}
        </Flex>
      </Modal>
    </>
  );
}
