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
  useCreateStaffSalaryRecords,
  useDeleteSalaryRecord,
  useMembers,
  useRejectAndRecomputeStaffSalary,
  useStaffSalaryRecords,
  useStaffSalaryStatusLogs,
  useTransitionStaffSalaryStatus,
} from "@/lib/api/hooks";
import type { Member, StaffSalaryRecord } from "@/lib/api/data";
import { staffBaseIncomeOf } from "@/lib/api/data";
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

function periodLabel(item: StaffSalaryRecord): string {
  return `${item.period_start} ~ ${item.period_end}`;
}

function signedAmount(cents: number): string {
  return `${cents > 0 ? "+" : ""}${formatCentsToYuan(cents)}`;
}

/** 空串视为 0；非法（含负数或超过两位小数）返回 null。 */
function parseOptionalYuan(value: string): number | null {
  if (!value.trim()) return 0;
  return parseAdjustmentAmountYuan(value);
}

function baseIncomeOf(member: Member | undefined, roleId: number | undefined): number {
  return staffBaseIncomeOf(member, roleId);
}

type StaffColumn = ResizableColumnType<StaffSalaryRecord> & ExcelColumn<StaffSalaryRecord>;

function StaffStatusTimeline({ recordId }: { recordId: string }) {
  const logs = useStaffSalaryStatusLogs(recordId);
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
  tax: string;
  note: string;
}

export function StaffPayrollPanel({
  roleCode,
  roleName,
  operatorProfileId,
}: {
  roleCode: string;
  roleName: string;
  operatorProfileId?: string;
}) {
  const { message } = App.useApp();
  const confirm = useConfirm();
  const salary = useStaffSalaryRecords();
  const members = useMembers();
  const create = useCreateStaffSalaryRecords();
  const transition = useTransitionStaffSalaryStatus();
  const reject = useRejectAndRecomputeStaffSalary();
  const removeSalary = useDeleteSalaryRecord();
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  const [selectedRowKeys, setSelectedRowKeys] = useState<Key[]>([]);
  const [period, setPeriod] = useState("");
  const [status, setStatus] = useState("");
  const [recomputeFeedback, setRecomputeFeedback] = useState<{ id: string; ok: boolean; message: string } | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [draftPeriod, setDraftPeriod] = useState<PeriodRange>(() => getPresetRange("thisMonth"));
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [draftRows, setDraftRows] = useState<Record<string, DraftRow>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const roleId = useMemo(
    () => members.data?.flatMap((m) => m.user_roles).find((up) => up.role?.code === roleCode)?.role?.id,
    [members.data, roleCode],
  );

  const candidates = useMemo(
    () =>
      (members.data ?? []).filter(
        (m) => m.status === "active" && m.user_roles.some((up) => up.role?.code === roleCode),
      ),
    [members.data, roleCode],
  );
  const memberById = useMemo(() => new Map(candidates.map((m) => [m.id, m])), [candidates]);

  const records = useMemo(
    () => (salary.data ?? []).filter((item) => item.role?.code === roleCode),
    [salary.data, roleCode],
  );
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
    setSelectedIds([]);
    setDraftRows({});
    setFormError(null);
    setCreateOpen(true);
  }

  function onSelectMembers(ids: string[]) {
    setSelectedIds(ids);
    setDraftRows((prev) => {
      const next = { ...prev };
      for (const id of ids) next[id] ??= { penalty: "", reward: "", tax: "", note: "" };
      return next;
    });
  }

  async function submitCreate() {
    setFormError(null);
    if (!selectedIds.length) {
      setFormError("请至少选择一位成员");
      return;
    }
    if (!roleId) {
      setFormError("未找到该角色，无法新增记录");
      return;
    }
    if (draftPeriod.start > draftPeriod.end) {
      setFormError("起止日期无效");
      return;
    }
    const recordsToCreate = [];
    for (const id of selectedIds) {
      const row = draftRows[id] ?? { penalty: "", reward: "", tax: "", note: "" };
      const penalty = parseOptionalYuan(row.penalty);
      const reward = parseOptionalYuan(row.reward);
      const tax = parseOptionalYuan(row.tax);
      if (penalty === null || reward === null || tax === null) {
        const name = memberById.get(id)?.name ?? "成员";
        setFormError(`「${name}」的总违约/总奖励/个税须为非负金额且最多两位小数`);
        return;
      }
      recordsToCreate.push({
        profileId: id,
        roleId,
        penaltyCents: -penalty,
        rewardCents: reward,
        taxCents: tax,
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
      content: "驳回后会重新计算该工资条的合计与个税并重置为待审核。确认继续？",
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

  function transitionTo(record: StaffSalaryRecord, next: "pending_confirm" | "completed") {
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

  const columns: StaffColumn[] = [
    {
      title: "姓名",
      fixed: "left",
      width: 140,
      exportValue: (record) => record.profile?.name ?? "未关联",
      render: (_, record) => (
        <Button
          type="link"
          size="small"
          onClick={() => setExpandedKeys(expandedKeys.includes(record.id) ? [] : [record.id])}
        >
          {record.profile?.name ?? "未关联"}
        </Button>
      ),
    },
    {
      title: "基础薪资",
      width: 120,
      align: "right",
      exportValue: (record) => centsToYuanNumber(record.base_income_cents),
      render: (_, record) => (
        <span title="来源：基础薪资管理-设置">{formatCentsToYuan(record.base_income_cents)}</span>
      ),
    },
    {
      title: "总违约",
      width: 120,
      align: "right",
      exportValue: (record) => (record.penalty_cents ? centsToYuanNumber(record.penalty_cents) : null),
      render: (_, record) =>
        record.penalty_cents ? (
          <span title="来源：工资核算-新增记录（管理员设置）" style={{ color: "#cf1322" }}>
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
          <span title="来源：工资核算-新增记录（管理员设置）" style={{ color: "#389e0d" }}>
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
        <span title="系统计算：基础薪资 + 调整合计">{formatCentsToYuan(record.gross_cents)}</span>
      ),
    },
    {
      title: "个税",
      width: 120,
      align: "right",
      exportValue: (record) => centsToYuanNumber(record.tax_cents),
      render: (_, record) => (
        <span title="来源：工资核算-新增记录（手动输入）">{formatCentsToYuan(record.tax_cents)}</span>
      ),
    },
    {
      title: "到手收益",
      width: 130,
      align: "right",
      exportValue: (record) => centsToYuanNumber(record.net_cents),
      render: (_, record) => (
        <Typography.Text
          title="系统计算：到手收益 = 实发收益 − 个税"
          type={record.net_cents < 0 ? "danger" : undefined}
          strong
        >
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
            {record.status !== "completed" ? (
              <Button
                size="small"
                danger
                loading={removeSalary.isPending && removeSalary.variables?.id === record.id}
                onClick={async () => {
                  const ok = await confirm({
                    title: "确认删除员工工资条",
                    content: `确认删除该工资条（实发 ${formatCentsToYuan(record.net_cents)}）？删除后对应收支记录会一并移除，已完成工资条不可删除。`,
                    okText: "确认删除",
                    okButtonProps: { danger: true },
                  });
                  if (!ok) return;
                  removeSalary.mutate(
                    { id: record.id, kind: "staff" },
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

  const tableColumns = columns.map((column) => {
    const exportValue = column.exportValue;
    const sortValue =
      column.sortValue ?? (exportValue ? (record: StaffSalaryRecord) => exportValue(record) : undefined);
    return { ...column, sortValue };
  });

  function handleDownload() {
    downloadExcel({
      fileName: `${roleName}工资条_${fileStamp()}.xlsx`,
      sheetName: `${roleName}工资条`,
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
        title={`${roleName}工资条`}
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
          <ResizableTable<StaffSalaryRecord>
            rowClassName={zebraRowClassName}
            rowKey="id"
            loading={salary.isLoading}
            dataSource={filtered}
            columns={tableColumns}
            locale={{ emptyText: `暂无${roleName}工资条` }}
            rowSelection={{
              selectedRowKeys,
              onChange: (keys) => setSelectedRowKeys(keys),
              preserveSelectedRowKeys: true,
            }}
            expandable={{
              expandedRowKeys: expandedKeys,
              onExpand: (expanded, record) => setExpandedKeys(expanded ? [record.id] : []),
              expandedRowRender: (record) => <StaffStatusTimeline recordId={record.id} />,
            }}
          />
        )}
      </Card>

      <Modal
        title={`新增${roleName}工资条`}
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
            <Typography.Text>选择成员</Typography.Text>
            <Select
              mode="multiple"
              showSearch
              optionFilterProp="label"
              style={{ width: "100%", marginTop: 8 }}
              placeholder="可搜索、多选"
              value={selectedIds}
              onChange={onSelectMembers}
              options={candidates.map((m) => ({ value: m.id, label: m.name }))}
            />
          </div>

          {selectedIds.length ? (
            <div style={{ maxHeight: 320, overflow: "auto" }}>
              {selectedIds.map((id) => {
                const member = memberById.get(id);
                const row = draftRows[id] ?? { penalty: "", reward: "", tax: "", note: "" };
                return (
                  <div key={id} style={{ border: "1px solid #f0f0f0", borderRadius: 8, padding: 12, marginBottom: 8 }}>
                    <Flex align="center" justify="space-between" gap={12}>
                      <Typography.Text strong>{member?.name ?? "成员"}</Typography.Text>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        基础薪资 {formatCentsToYuan(baseIncomeOf(member, roleId))}
                      </Typography.Text>
                    </Flex>
                    <Row gutter={12} style={{ marginTop: 8 }}>
                      <Col span={6}>
                        <Input
                          aria-label={`${member?.name ?? "成员"}总违约（元）`}
                          inputMode="decimal"
                          placeholder="总违约（扣款）"
                          value={row.penalty}
                          status={parseOptionalYuan(row.penalty) === null ? "error" : undefined}
                          onChange={(event) =>
                            setDraftRows((prev) => ({ ...prev, [id]: { ...row, penalty: event.target.value } }))
                          }
                        />
                      </Col>
                      <Col span={6}>
                        <Input
                          aria-label={`${member?.name ?? "成员"}总奖励（元）`}
                          inputMode="decimal"
                          placeholder="总奖励（增加）"
                          value={row.reward}
                          status={parseOptionalYuan(row.reward) === null ? "error" : undefined}
                          onChange={(event) =>
                            setDraftRows((prev) => ({ ...prev, [id]: { ...row, reward: event.target.value } }))
                          }
                        />
                      </Col>
                      <Col span={6}>
                        <Input
                          aria-label={`${member?.name ?? "成员"}个税（元）`}
                          inputMode="decimal"
                          placeholder="个税"
                          value={row.tax}
                          status={parseOptionalYuan(row.tax) === null ? "error" : undefined}
                          onChange={(event) =>
                            setDraftRows((prev) => ({ ...prev, [id]: { ...row, tax: event.target.value } }))
                          }
                        />
                      </Col>
                      <Col span={6}>
                        <Input
                          aria-label={`${member?.name ?? "成员"}备注`}
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
              选择成员后分别填写总违约、总奖励、个税；基础薪资自动带入，实发收益 = 基础薪资 + 调整合计，到手 = 实发 − 个税。
            </Typography.Text>
          )}

          {formError ? <Typography.Text type="danger">{formError}</Typography.Text> : null}
        </Flex>
      </Modal>
    </>
  );
}
