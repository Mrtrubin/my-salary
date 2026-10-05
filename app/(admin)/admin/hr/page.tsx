"use client";

import { Button, Card, Form, InputNumber, Modal, Typography } from "antd";
import { useMemo, useState } from "react";
import { FormField } from "@/components/admin/form-field";
import { PageHeader } from "@/components/admin/page-header";
import { QueryMessage } from "@/components/admin/query-message";
import { ResizableTable } from "@/components/admin/resizable-table";
import { zebraRowClassName } from "@/components/admin/table-zebra";
import { useMembers, useRoles, useSetStaffBaseIncome } from "@/lib/api/hooks";
import type { Member } from "@/lib/api/data";
import { staffBaseIncomeOf } from "@/lib/api/data";
import { formatCentsToYuan } from "@/lib/format";

interface Editing {
  id: string;
  name: string;
  /** 基础薪资（元）。 */
  baseIncome: number;
}

/** 管理端「人事管理」：设置人事角色的基础薪资。 */
export default function HrManagementPage() {
  const members = useMembers();
  const roles = useRoles();
  const update = useSetStaffBaseIncome();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [error, setError] = useState("");

  const hrRole = useMemo(() => (roles.data ?? []).find((item) => item.code === "hr"), [roles.data]);
  const roleId = hrRole?.id;

  const list = useMemo(
    () =>
      (members.data ?? []).filter(
        (m) => m.status === "active" && m.user_roles.some((up) => up.role?.code === "hr"),
      ),
    [members.data],
  );

  function openEditor(member: Member) {
    setError("");
    setEditing({
      id: member.id,
      name: member.name,
      baseIncome: staffBaseIncomeOf(member, roleId) / 100,
    });
  }

  async function save() {
    if (!editing) return;
    const baseIncome = Number(editing.baseIncome);
    if (!Number.isFinite(baseIncome) || baseIncome < 0) {
      setError("基础薪资必须为不小于 0 的金额");
      return;
    }
    try {
      await update.mutateAsync({
        profileId: editing.id,
        roleCode: "hr",
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
        title="人事管理"
        description="设置人事角色的基础薪资；生成工资条时会快照该值"
      />

      <Card>
        {roles.error || members.error ? (
          <QueryMessage loading={false} error={roles.error ?? members.error} />
        ) : (
          <ResizableTable<Member>
            rowClassName={zebraRowClassName}
            rowKey="id"
            loading={members.isLoading || roles.isLoading}
            dataSource={list}
            locale={{ emptyText: "暂无人事成员" }}
            columns={[
              { title: "人事", dataIndex: "name", fixed: "left", width: 200 },
              {
                title: "基础薪资",
                key: "base_income",
                align: "right",
                width: 160,
                sortValue: (record) => staffBaseIncomeOf(record, roleId),
                render: (_, record) => formatCentsToYuan(staffBaseIncomeOf(record, roleId)),
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
        title={editing ? `编辑基础薪资 · ${editing.name}` : "编辑基础薪资"}
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
            <FormField label="基础薪资（元）" hint="该人事成员的固定基础薪资。">
              <InputNumber
                min={0}
                step={0.01}
                value={editing.baseIncome}
                onChange={(value) => setEditing({ ...editing, baseIncome: Number(value ?? 0) })}
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
