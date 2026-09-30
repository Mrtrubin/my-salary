"use client";

import { Button, Card, Flex, Form, InputNumber, Modal, Select, Typography } from "antd";
import { useMemo, useState } from "react";
import { FormField } from "@/components/admin/form-field";
import { PageHeader } from "@/components/admin/page-header";
import { QueryMessage } from "@/components/admin/query-message";
import { ResizableTable } from "@/components/admin/resizable-table";
import { zebraRowClassName } from "@/components/admin/table-zebra";
import { useMembers, useSetStaffBaseIncome } from "@/lib/api/hooks";
import type { Member } from "@/lib/api/data";
import { STAFF_BASE_INCOME_COLUMN } from "@/lib/api/data";
import { formatCentsToYuan } from "@/lib/format";

/** 支持「固定薪资 + 调整项」工资条的职位。 */
const STAFF_POSITIONS = [
  { code: "makeup", name: "化妆师" },
  { code: "dance", name: "舞蹈老师" },
  { code: "executive", name: "行政" },
  { code: "camera", name: "运镜" },
  { code: "hr", name: "人事" },
];

function baseIncomeOf(member: Member, positionCode: string): number {
  const column = STAFF_BASE_INCOME_COLUMN[positionCode];
  return column ? member[column] ?? 0 : 0;
}

interface Editing {
  id: string;
  name: string;
  positionCode: string;
  /** 基础薪资（元）。 */
  baseIncome: number;
}

export default function BaseSalaryPage() {
  const members = useMembers();
  const update = useSetStaffBaseIncome();
  const [positionCode, setPositionCode] = useState("makeup");
  const [editing, setEditing] = useState<Editing | null>(null);
  const [error, setError] = useState("");

  const positionName = STAFF_POSITIONS.find((p) => p.code === positionCode)?.name ?? "成员";

  const list = useMemo(
    () =>
      (members.data ?? []).filter(
        (m) => m.status === "active" && m.user_positions.some((up) => up.position?.code === positionCode),
      ),
    [members.data, positionCode],
  );

  function openEditor(member: Member) {
    setError("");
    setEditing({
      id: member.id,
      name: member.name,
      positionCode,
      baseIncome: baseIncomeOf(member, positionCode) / 100,
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
        positionCode: editing.positionCode,
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
        title="基础薪资管理"
        description="按职位设置每位成员的基础薪资；生成工资条时会快照该值，实发收益 = 基础薪资 + 调整合计（总违约 + 总奖励），到手 = 实发 − 个税"
      />

      <Card>
        <Flex align="center" gap={12} style={{ marginBottom: 16 }}>
          <Typography.Text>职位</Typography.Text>
          <Select
            style={{ minWidth: 180 }}
            value={positionCode}
            onChange={setPositionCode}
            options={STAFF_POSITIONS.map((p) => ({ value: p.code, label: p.name }))}
          />
        </Flex>

        {members.error ? (
          <QueryMessage loading={false} error={members.error} />
        ) : (
          <ResizableTable<Member>
            rowClassName={zebraRowClassName}
            rowKey="id"
            loading={members.isLoading}
            dataSource={list}
            locale={{ emptyText: `暂无${positionName}` }}
            columns={[
              { title: positionName, dataIndex: "name", fixed: "left", width: 180 },
              {
                title: "基础薪资",
                key: "base_income",
                align: "right",
                width: 160,
                sortValue: (record) => baseIncomeOf(record, positionCode),
                render: (_, record) => formatCentsToYuan(baseIncomeOf(record, positionCode)),
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
            <FormField
              label={`基础薪资（元）· ${STAFF_POSITIONS.find((p) => p.code === editing.positionCode)?.name ?? ""}`}
              hint="该成员固定基础薪资，来源：基础薪资管理-设置。"
            >
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
