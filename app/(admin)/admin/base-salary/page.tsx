"use client";

import { Button, Card, Flex, Form, InputNumber, Modal, Select, Typography } from "antd";
import { useMemo, useState } from "react";
import { FormField } from "@/components/admin/form-field";
import { PageHeader } from "@/components/admin/page-header";
import { QueryMessage } from "@/components/admin/query-message";
import { ResizableTable } from "@/components/admin/resizable-table";
import { zebraRowClassName } from "@/components/admin/table-zebra";
import { useMembers, usePositions, useSetStaffBaseIncome } from "@/lib/api/hooks";
import type { Member } from "@/lib/api/data";
import { staffBaseIncomeOf } from "@/lib/api/data";
import { formatCentsToYuan } from "@/lib/format";

interface Editing {
  id: string;
  name: string;
  positionCode: string;
  positionId: number;
  /** 基础薪资（元）。 */
  baseIncome: number;
}

export default function BaseSalaryPage() {
  const members = useMembers();
  const positions = usePositions();
  const update = useSetStaffBaseIncome();
  const [positionCode, setPositionCode] = useState<string>();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [error, setError] = useState("");

  // 支持「固定薪资 + 调整项」工资条的职位：除主播/主持（各自独立结算）外的全部职位。
  const staffPositions = useMemo(
    () => (positions.data ?? []).filter((item) => item.code !== "anchor" && item.code !== "host"),
    [positions.data],
  );
  const effectiveCode = positionCode ?? staffPositions[0]?.code;
  const position = staffPositions.find((item) => item.code === effectiveCode);
  const positionId = position?.id;
  const positionName = position?.name ?? "成员";

  const list = useMemo(
    () =>
      (members.data ?? []).filter(
        (m) => m.status === "active" && m.user_positions.some((up) => up.position?.code === effectiveCode),
      ),
    [members.data, effectiveCode],
  );

  function openEditor(member: Member) {
    if (!position) return;
    setError("");
    setEditing({
      id: member.id,
      name: member.name,
      positionCode: position.code,
      positionId: position.id,
      baseIncome: staffBaseIncomeOf(member, position.id) / 100,
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
            value={effectiveCode}
            placeholder={positions.isLoading ? "加载中" : "暂无可用职位"}
            onChange={setPositionCode}
            options={staffPositions.map((p) => ({ value: p.code, label: p.name }))}
          />
        </Flex>

        {positions.error || members.error ? (
          <QueryMessage loading={false} error={positions.error ?? members.error} />
        ) : (
          <ResizableTable<Member>
            rowClassName={zebraRowClassName}
            rowKey="id"
            loading={members.isLoading || positions.isLoading}
            dataSource={list}
            locale={{ emptyText: `暂无${positionName}` }}
            columns={[
              { title: positionName, dataIndex: "name", fixed: "left", width: 180 },
              {
                title: "基础薪资",
                key: "base_income",
                align: "right",
                width: 160,
                sortValue: (record) => staffBaseIncomeOf(record, positionId),
                render: (_, record) => formatCentsToYuan(staffBaseIncomeOf(record, positionId)),
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
              label={`基础薪资（元）· ${staffPositions.find((p) => p.id === editing.positionId)?.name ?? ""}`}
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
