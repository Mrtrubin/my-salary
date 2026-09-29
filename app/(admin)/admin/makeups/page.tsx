"use client";

import { Button, Card, Form, InputNumber, Modal, Typography } from "antd";
import { useMemo, useState } from "react";
import { FormField } from "@/components/admin/form-field";
import { PageHeader } from "@/components/admin/page-header";
import { QueryMessage } from "@/components/admin/query-message";
import { ResizableTable } from "@/components/admin/resizable-table";
import { zebraRowClassName } from "@/components/admin/table-zebra";
import { useMembers, useUpdateMakeupBaseIncome } from "@/lib/api/hooks";
import type { Member } from "@/lib/api/data";
import { formatCentsToYuan } from "@/lib/format";

function isMakeup(member: Member) {
  return member.status === "active" && member.user_positions.some(({ position }) => position?.code === "makeup");
}

interface Editing {
  id: string;
  name: string;
  /** 基础收益（元）。 */
  baseIncome: number;
}

export default function MakeupsPage() {
  const members = useMembers();
  const update = useUpdateMakeupBaseIncome();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [error, setError] = useState("");

  const makeups = useMemo(() => members.data?.filter(isMakeup) ?? [], [members.data]);

  function openEditor(member: Member) {
    setError("");
    setEditing({
      id: member.id,
      name: member.name,
      baseIncome: member.makeup_base_income_cents / 100,
    });
  }

  async function save() {
    if (!editing) return;
    const baseIncome = Number(editing.baseIncome);
    if (!Number.isFinite(baseIncome) || baseIncome < 0) {
      setError("基础收益必须为不小于 0 的金额");
      return;
    }
    try {
      await update.mutateAsync({
        id: editing.id,
        baseIncomeInCents: Math.round(baseIncome * 100),
      });
      setEditing(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败，请稍后重试");
    }
  }

  return (
    <>
      <PageHeader
        title="化妆师管理"
        description="设置每位化妆师的基础收益；该值在「工资核算-化妆师-新增记录」生成收益记录时快照使用"
      />

      <Card>
        {members.error ? (
          <QueryMessage loading={false} error={members.error} />
        ) : (
          <ResizableTable<Member>
            rowClassName={zebraRowClassName}
            rowKey="id"
            loading={members.isLoading}
            dataSource={makeups}
            locale={{ emptyText: "暂无化妆师" }}
            columns={[
              { title: "化妆师", dataIndex: "name", fixed: "left", width: 180 },
              {
                title: "基础收益",
                key: "base_income",
                align: "right",
                width: 160,
                sortValue: (record) => record.makeup_base_income_cents,
                render: (_, record) => formatCentsToYuan(record.makeup_base_income_cents),
              },
              {
                title: "操作",
                key: "action",
                fixed: "right",
                width: 100,
                render: (_, record) => (
                  <Button type="link" size="small" onClick={() => openEditor(record)}>
                    编辑
                  </Button>
                ),
              },
            ]}
          />
        )}
      </Card>

      <Modal
        title={editing ? `编辑化妆师 · ${editing.name}` : "编辑化妆师"}
        open={Boolean(editing)}
        onCancel={() => setEditing(null)}
        onOk={save}
        okText="保存"
        cancelText="取消"
        confirmLoading={update.isPending}
        destroyOnHidden
      >
        {editing ? (
          <Form layout="vertical">
            <FormField label="基础收益（元）" hint="化妆师固定收益，来源：化妆师管理-设置。">
              <InputNumber
                min={0}
                step={0.01}
                value={editing.baseIncome}
                onChange={(value) =>
                  setEditing({ ...editing, baseIncome: Number(value ?? 0) })
                }
                style={{ width: "100%" }}
              />
            </FormField>
            {error ? <Typography.Text type="danger">{error}</Typography.Text> : null}
          </Form>
        ) : null}
      </Modal>
    </>
  );
}
