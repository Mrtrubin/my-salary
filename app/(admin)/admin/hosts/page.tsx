"use client";

import { Button, Card, Col, Form, InputNumber, Modal, Row, Table, Typography } from "antd";
import dayjs from "dayjs";
import { useMemo, useState } from "react";
import { FormField } from "@/components/admin/form-field";
import { PageHeader } from "@/components/admin/page-header";
import { QueryMessage } from "@/components/admin/query-message";
import { zebraRowClassName } from "@/components/admin/table-zebra";
import { useCreateHostScheme, useHostSchemes, useMembers, usePositions } from "@/lib/api/hooks";
import type { HostSalarySchemeRow, Member } from "@/lib/api/data";
import { formatCentsToYuan } from "@/lib/format";

function isHost(member: Member) {
  return member.user_positions.some(({ position }) => position?.code === "host");
}

function latestPersonalScheme(schemes: HostSalarySchemeRow[] | undefined, profileId: string) {
  return schemes
    ?.filter((scheme) => scheme.profile_id === profileId)
    .sort((a, b) => b.version - a.version)[0];
}

function latestTemplateScheme(schemes: HostSalarySchemeRow[] | undefined, positionId?: number) {
  return schemes
    ?.filter((scheme) => scheme.profile_id == null && scheme.position_id === positionId)
    .sort((a, b) => b.version - a.version)[0];
}

interface Editing {
  id: string;
  name: string;
  /** 基础收益（元）。 */
  baseIncome: number | null;
  /** 拿提点门槛（元）。 */
  commissionStart: number | null;
  /** 基础提成率（%）。 */
  commissionPercent: number | null;
  /** 服务率（%）。 */
  servicePercent: number | null;
}

export default function HostsPage() {
  const members = useMembers();
  const positions = usePositions();
  const schemes = useHostSchemes();
  const createScheme = useCreateHostScheme();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [error, setError] = useState("");

  const hosts = useMemo(() => members.data?.filter(isHost) ?? [], [members.data]);
  const hostPositionId = positions.data?.find((position) => position.code === "host")?.id;
  const template = latestTemplateScheme(schemes.data, hostPositionId);
  const listError = members.error ?? schemes.error;

  function openEditor(member: Member) {
    const effective = latestPersonalScheme(schemes.data, member.id) ?? template;
    setError("");
    setEditing({
      id: member.id,
      name: member.name,
      baseIncome: effective ? effective.base_income_cents / 100 : 0,
      commissionStart: effective ? effective.commission_start_cents / 100 : 0,
      commissionPercent: effective ? effective.base_commission_rate_bps / 100 : 20,
      servicePercent: effective ? effective.service_fee_rate_bps / 100 : 3,
    });
  }

  async function save() {
    if (!editing) return;
    if (!hostPositionId) {
      setError(positions.isLoading ? "职位数据仍在加载，请稍后重试" : "未找到「主持」职位，无法创建个人方案");
      return;
    }
    const baseIncome = Number(editing.baseIncome);
    const commissionStart = Number(editing.commissionStart);
    const commissionBps = Math.round(Number(editing.commissionPercent) * 100);
    const serviceBps = Math.round(Number(editing.servicePercent) * 100);
    if (!Number.isFinite(baseIncome) || baseIncome < 0) {
      setError("基础收益必须为不小于 0 的金额");
      return;
    }
    if (!Number.isFinite(commissionStart) || commissionStart < 0) {
      setError("拿提点门槛必须为不小于 0 的金额");
      return;
    }
    if (!Number.isInteger(commissionBps) || commissionBps < 1 || commissionBps > 10000) {
      setError("基础提成率必须在 0.01%～100% 之间，最多两位小数");
      return;
    }
    if (!Number.isInteger(serviceBps) || serviceBps < 0 || serviceBps > 10000) {
      setError("服务率必须在 0%～100% 之间，最多两位小数");
      return;
    }
    // 版本号取全局最大值：表唯一键是 (name, version)，同名主持的个人方案会撞车，
    // 全局自增可保证即使主持重名也不会冲突。
    const version = Math.max(0, ...(schemes.data ?? []).map((scheme) => scheme.version)) + 1;
    try {
      await createScheme.mutateAsync({
        name: `${editing.name}主持方案`,
        profile_id: editing.id,
        position_id: hostPositionId,
        version,
        base_income_cents: Math.round(baseIncome * 100),
        commission_start_cents: Math.round(commissionStart * 100),
        base_commission_rate_bps: commissionBps,
        service_fee_rate_bps: serviceBps,
        effective_from: dayjs().format("YYYY-MM-DD"),
      });
      setEditing(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败，请稍后重试");
    }
  }

  return (
    <>
      <PageHeader
        title="主持管理"
        description="统一管理主持的基础收益、拿提点门槛、基础提成率与服务率；主持工资按团总流水在「主持流水」页结算"
      />

      <Card>
        {listError ? (
          <QueryMessage loading={false} error={listError} />
        ) : (
          <Table
            rowClassName={zebraRowClassName}
            rowKey="id"
            loading={members.isLoading || schemes.isLoading}
            dataSource={hosts}
            pagination={false}
            locale={{ emptyText: "暂无主持" }}
            scroll={{ x: "max-content" }}
            columns={[
              { title: "主持", dataIndex: "name", fixed: "left", width: 180 },
              {
                title: "基础收益",
                width: 140,
                render: (_, record) => {
                  const effective = latestPersonalScheme(schemes.data, record.id) ?? template;
                  return effective ? formatCentsToYuan(effective.base_income_cents) : "—";
                },
              },
              {
                title: "拿提点门槛",
                width: 140,
                render: (_, record) => {
                  const effective = latestPersonalScheme(schemes.data, record.id) ?? template;
                  return effective ? formatCentsToYuan(effective.commission_start_cents) : "—";
                },
              },
              {
                title: "基础提成率",
                width: 130,
                render: (_, record) => {
                  const effective = latestPersonalScheme(schemes.data, record.id) ?? template;
                  return effective ? `${effective.base_commission_rate_bps / 100}%` : "—";
                },
              },
              {
                title: "服务率",
                width: 110,
                render: (_, record) => {
                  const effective = latestPersonalScheme(schemes.data, record.id) ?? template;
                  return effective ? `${effective.service_fee_rate_bps / 100}%` : "—";
                },
              },
              {
                title: "操作",
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
        title={editing ? `编辑主持 · ${editing.name}` : "编辑主持"}
        open={Boolean(editing)}
        onCancel={() => setEditing(null)}
        onOk={save}
        okText="保存"
        cancelText="取消"
        confirmLoading={createScheme.isPending}
        destroyOnHidden
      >
        {editing ? (
          <Form layout="vertical">
            <Row gutter={16}>
              <Col span={12}>
                <FormField
                  label="基础收益（元）"
                  hint="未达拿提点门槛时的固定保底收益。"
                >
                  <InputNumber
                    min={0}
                    step={0.01}
                    value={editing.baseIncome}
                    onChange={(value) => setEditing({ ...editing, baseIncome: value })}
                    style={{ width: "100%" }}
                  />
                </FormField>
              </Col>
              <Col span={12}>
                <FormField
                  label="拿提点门槛（元）"
                  hint="团总流水达到该值视为达标并开始计提成。"
                >
                  <InputNumber
                    min={0}
                    step={0.01}
                    value={editing.commissionStart}
                    onChange={(value) => setEditing({ ...editing, commissionStart: value })}
                    style={{ width: "100%" }}
                  />
                </FormField>
              </Col>
              <Col span={12}>
                <FormField
                  label="基础提成率（%）"
                  hint="达标后按该费率计提；超出拿提点门槛每满 10 万元额外 +1 个点，最高 +3 个点。"
                >
                  <InputNumber
                    min={0.01}
                    max={100}
                    step={0.01}
                    value={editing.commissionPercent}
                    onChange={(value) => setEditing({ ...editing, commissionPercent: value })}
                    style={{ width: "100%" }}
                  />
                </FormField>
              </Col>
              <Col span={12}>
                <FormField label="服务率（%）" hint="服务费 = 实发收益 × 服务率。">
                  <InputNumber
                    min={0}
                    max={100}
                    step={0.01}
                    value={editing.servicePercent}
                    onChange={(value) => setEditing({ ...editing, servicePercent: value })}
                    style={{ width: "100%" }}
                  />
                </FormField>
              </Col>
            </Row>
            {error ? <Typography.Text type="danger">{error}</Typography.Text> : null}
          </Form>
        ) : null}
      </Modal>
    </>
  );
}
