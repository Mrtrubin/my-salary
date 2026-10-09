"use client";

import { DeleteOutlined, EditOutlined, PlusOutlined } from "@ant-design/icons";
import {
  App, Button, Card, Col, DatePicker, Flex, Input, InputNumber, Modal, Row, Select, Tag, Typography,
} from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { useMemo, useState } from "react";
import { FormField } from "@/components/admin/form-field";
import { PageHeader } from "@/components/admin/page-header";
import { QueryMessage } from "@/components/admin/query-message";
import { ResizableTable } from "@/components/admin/resizable-table";
import { StatCard } from "@/components/admin/stat-card";
import { zebraRowClassName } from "@/components/admin/table-zebra";
import { TimeRangeFilter } from "@/components/admin/time-range-filter";
import { useConfirm } from "@/components/admin/use-confirm";
import type { LedgerEntry } from "@/lib/api/data";
import {
  useCreateLedgerEntry,
  useDeleteLedgerEntry,
  useLedgerEntries,
  useLedgerSummary,
  useLedgerTags,
  useUpdateLedgerEntry,
} from "@/lib/api/hooks";
import { toSignedCents, type LedgerDirection } from "@/lib/domain/ledger";
import { getPresetRange, type PeriodRange } from "@/lib/domain/settlement/cycle";
import { formatCentsToYuan, formatDateTime } from "@/lib/format";
import { LedgerCharts } from "./LedgerCharts";

const SOURCE_LABELS: Record<string, string> = {
  manual: "手动录入",
  anchor_salary: "主播工资",
  host_salary: "主持工资",
  staff_salary: "员工工资",
};

type Direction = LedgerDirection;

export default function LedgerPage() {
  const { message } = App.useApp();
  const confirm = useConfirm();
  const tags = useLedgerTags();
  const create = useCreateLedgerEntry();
  const update = useUpdateLedgerEntry();
  const remove = useDeleteLedgerEntry();

  const [range, setRange] = useState<PeriodRange>(() => getPresetRange("thisMonth"));
  const [direction, setDirection] = useState<"all" | Direction>("all");
  const [tagFilter, setTagFilter] = useState<string>("all");

  const entries = useLedgerEntries(range);
  const summary = useLedgerSummary(range);

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<LedgerEntry | null>(null);
  const [amount, setAmount] = useState<number | null>(null);
  const [formDirection, setFormDirection] = useState<Direction>("expense");
  const [formTag, setFormTag] = useState<string | null>(null);
  const [formNote, setFormNote] = useState("");
  const [occurred, setOccurred] = useState<Dayjs>(dayjs());

  const filtered = useMemo(() => {
    return (entries.data ?? []).filter((entry) => {
      if (direction === "income" && entry.amount_cents < 0) return false;
      if (direction === "expense" && entry.amount_cents >= 0) return false;
      if (tagFilter !== "all" && entry.tag_id !== tagFilter) return false;
      return true;
    });
  }, [entries.data, direction, tagFilter]);

  function openCreate() {
    setEditing(null);
    setAmount(null);
    setFormDirection("expense");
    setFormTag(null);
    setFormNote("");
    setOccurred(dayjs());
    setOpen(true);
  }

  function openEdit(entry: LedgerEntry) {
    setEditing(entry);
    setAmount(Math.abs(entry.amount_cents) / 100);
    setFormDirection(entry.amount_cents >= 0 ? "income" : "expense");
    setFormTag(entry.tag_id);
    setFormNote(entry.note ?? "");
    setOccurred(dayjs(entry.occurred_at));
    setOpen(true);
  }

  async function submit() {
    if (!occurred || !occurred.isValid()) {
      message.warning("请选择入账时间");
      return;
    }
    const isAuto = editing !== null && editing.source_type !== "manual";
    const signed = toSignedCents(amount, formDirection);
    if (!isAuto && signed === null) {
      message.warning("请输入大于 0 的金额");
      return;
    }
    const occurredAt = occurred.toISOString();
    try {
      if (editing) {
        if (isAuto) {
          await update.mutateAsync({ id: editing.id, occurredAt });
        } else {
          await update.mutateAsync({ id: editing.id, amountCents: signed ?? 0, tagId: formTag, occurredAt, note: formNote });
        }
        message.success("已保存");
      } else {
        await create.mutateAsync({ amountCents: signed ?? 0, tagId: formTag, occurredAt, note: formNote });
        message.success("已新增");
      }
      setOpen(false);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "保存失败，请稍后重试");
    }
  }

  async function removeEntry(entry: LedgerEntry) {
    const ok = await confirm({
      title: "确认删除收支记录",
      content: `确认删除该${entry.amount_cents >= 0 ? "收入" : "支出"}记录（${formatCentsToYuan(entry.amount_cents)}）？${
        entry.source_type === "manual" ? "" : "该记录由工资条自动生成，删除后待工资条下次变更时会重新生成。"
      }`,
      okText: "确认删除",
      okButtonProps: { danger: true },
    });
    if (!ok) return;
    remove.mutate(entry.id, {
      onError: (err) => message.error(err instanceof Error ? err.message : "删除失败，请稍后重试"),
    });
  }

  const tagOptions = [
    { value: "all", label: "全部标签" },
    ...(tags.data ?? []).map((t) => ({ value: t.id, label: t.name })),
  ];
  const formTagOptions = (tags.data ?? []).map((t) => ({ value: t.id, label: t.name }));
  const isAuto = editing !== null && editing.source_type !== "manual";

  return (
    <>
      <PageHeader
        title="收支明细"
        description="记录系统全部收入与支出。金额带符号：>= 0 为收入，< 0 为支出；工资条生成时自动记支出、删除时自动移除。"
        action={
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            新增收支
          </Button>
        }
      />

      <Row gutter={[16, 16]}>
        <Col xs={24} md={8}>
          <StatCard label="收入" value={formatCentsToYuan(summary.data?.incomeCents ?? 0)} accent="positive" />
        </Col>
        <Col xs={24} md={8}>
          <StatCard label="支出" value={formatCentsToYuan(summary.data?.expenseCents ?? 0)} accent="negative" />
        </Col>
        <Col xs={24} md={8}>
          <StatCard label="结余" value={formatCentsToYuan(summary.data?.netCents ?? 0)} />
        </Col>
      </Row>

      {summary.data ? <LedgerCharts summary={summary.data} /> : null}

      <Card title="收支流水" style={{ marginTop: 16 }}>
        <Flex gap={12} wrap align="center" style={{ marginBottom: 16 }}>
          <TimeRangeFilter value={range} onChange={(next) => next && setRange(next)} />
          <Select
            value={direction}
            onChange={setDirection}
            style={{ width: 120 }}
            options={[
              { value: "all", label: "全部类型" },
              { value: "income", label: "收入" },
              { value: "expense", label: "支出" },
            ]}
          />
          <Select value={tagFilter} onChange={setTagFilter} style={{ width: 160 }} options={tagOptions} />
        </Flex>

        {entries.error ? (
          <QueryMessage loading={false} error={entries.error} />
        ) : (
          <ResizableTable<LedgerEntry>
            rowClassName={zebraRowClassName}
            rowKey="id"
            loading={entries.isLoading}
            dataSource={filtered}
            locale={{ emptyText: "暂无收支记录" }}
            columns={[
              {
                title: "时间",
                dataIndex: "occurred_at",
                width: 180,
                render: (value: string) => formatDateTime(value),
              },
              {
                title: "类型",
                key: "direction",
                width: 90,
                render: (_, record) =>
                  record.amount_cents >= 0 ? <Tag color="green">收入</Tag> : <Tag color="red">支出</Tag>,
              },
              {
                title: "金额",
                dataIndex: "amount_cents",
                width: 140,
                align: "right",
                sortValue: (record) => Number(record.amount_cents),
                render: (value: number) => (
                  <span style={{ color: value >= 0 ? "#389e0d" : "#cf1322", fontVariantNumeric: "tabular-nums" }}>
                    {formatCentsToYuan(value)}
                  </span>
                ),
              },
              {
                title: "标签",
                key: "tag",
                width: 140,
                render: (_, record) => record.tag?.name ?? "—",
              },
              {
                title: "来源",
                dataIndex: "source_type",
                width: 120,
                render: (value: string) => SOURCE_LABELS[value] ?? value,
              },
              {
                title: "创建人",
                key: "creator",
                width: 120,
                render: (_, record) =>
                  record.created_by_type === "system" ? "系统生成" : (record.creator?.name ?? "—"),
              },
              {
                title: "备注",
                dataIndex: "note",
                minWidth: 160,
                render: (value: string | null) => value ?? "—",
              },
              {
                title: "操作",
                key: "action",
                width: 140,
                render: (_, record) => (
                  <Flex gap={4}>
                    <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEdit(record)}>
                      编辑
                    </Button>
                    <Button
                      type="link"
                      size="small"
                      danger
                      icon={<DeleteOutlined />}
                      loading={remove.isPending && remove.variables === record.id}
                      onClick={() => removeEntry(record)}
                    >
                      删除
                    </Button>
                  </Flex>
                ),
              },
            ]}
          />
        )}
      </Card>

      <Modal
        title={editing ? (isAuto ? "编辑入账时间" : "编辑收支") : "新增收支"}
        open={open}
        onCancel={() => setOpen(false)}
        onOk={submit}
        confirmLoading={create.isPending || update.isPending}
        okText="保存"
        cancelText="取消"
        destroyOnHidden
      >
        {isAuto ? (
          <Typography.Paragraph type="secondary">
            该记录由工资条自动生成，仅可修改入账时间，其他字段以工资条为准。
          </Typography.Paragraph>
        ) : null}
        <Row gutter={16}>
          {!isAuto ? (
            <>
              <Col span={12}>
                <FormField label="类型" required>
                  <Select
                    value={formDirection}
                    onChange={setFormDirection}
                    options={[
                      { value: "income", label: "收入" },
                      { value: "expense", label: "支出" },
                    ]}
                  />
                </FormField>
              </Col>
              <Col span={12}>
                <FormField label="金额（元）" required>
                  <InputNumber
                    style={{ width: "100%" }}
                    min={0}
                    step={0.01}
                    precision={2}
                    value={amount}
                    onChange={setAmount}
                    placeholder="0.00"
                  />
                </FormField>
              </Col>
              <Col span={24}>
                <FormField label="标签">
                  <Select
                    allowClear
                    value={formTag}
                    onChange={(value) => setFormTag(value ?? null)}
                    options={formTagOptions}
                    placeholder="选择标签（可空）"
                  />
                </FormField>
              </Col>
            </>
          ) : null}
          <Col span={24}>
            <FormField label="入账时间" required hint="精确到秒，数据库按 UTC 存储，界面按本地时间显示">
              <DatePicker
                style={{ width: "100%" }}
                showTime
                value={occurred}
                onChange={(value) => setOccurred(value ?? dayjs())}
                format="YYYY-MM-DD HH:mm:ss"
              />
            </FormField>
          </Col>
          {!isAuto ? (
            <Col span={24}>
              <FormField label="备注">
                <Input.TextArea value={formNote} onChange={(e) => setFormNote(e.target.value)} rows={3} maxLength={200} />
              </FormField>
            </Col>
          ) : null}
        </Row>
      </Modal>
    </>
  );
}
