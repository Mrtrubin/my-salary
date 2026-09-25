"use client";

import { Button, Card, Col, Form, Input, InputNumber, Modal, Row, Select, Table, Typography } from "antd";
import dayjs from "dayjs";
import { useMemo, useState } from "react";
import { FormField } from "@/components/admin/form-field";
import { PageHeader } from "@/components/admin/page-header";
import { QueryMessage } from "@/components/admin/query-message";
import { zebraRowClassName } from "@/components/admin/table-zebra";
import {
  useCreateScheme,
  useMembers,
  usePositions,
  useSchemes,
  useUpdateAnchorSettings,
} from "@/lib/api/hooks";
import type { Member, SalaryScheme } from "@/lib/api/data";
import { formatCentsToYuan } from "@/lib/format";

function isAnchor(member: Member) {
  return member.user_positions.some(({ position }) => position?.code === "anchor");
}

function latestPersonalScheme(schemes: SalaryScheme[] | undefined, profileId: string) {
  return schemes
    ?.filter((scheme) => scheme.profile_id === profileId)
    .sort((a, b) => b.version - a.version)[0];
}

function latestTemplateScheme(schemes: SalaryScheme[] | undefined, positionId?: number) {
  return schemes
    ?.filter((scheme) => scheme.profile_id == null && scheme.position_id === positionId)
    .sort((a, b) => b.version - a.version)[0];
}

type Editing = {
  id: string;
  name: string;
  /** 抖音号：接口返回的 user_id（数字 uid）或 aweme_display_id 都能填。 */
  douyinId: string;
  anchorType: "new" | "experienced";
  commissionPercent: number | null;
  baseSalary: number | null;
  guaranteedSalary: number | null;
};

export default function AnchorsPage() {
  const members = useMembers();
  const positions = usePositions();
  const schemes = useSchemes();
  const updateSettings = useUpdateAnchorSettings();
  const createScheme = useCreateScheme();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [error, setError] = useState("");

  const anchors = useMemo(() => members.data?.filter(isAnchor) ?? [], [members.data]);
  const anchorPositionId = positions.data?.find((position) => position.code === "anchor")?.id;
  const template = latestTemplateScheme(schemes.data, anchorPositionId);
  const listError = members.error ?? schemes.error;

  function openEditor(member: Member) {
    const effective = latestPersonalScheme(schemes.data, member.id) ?? template;
    setError("");
    setEditing({
      id: member.id,
      name: member.name,
      douyinId: member.douyin_id ?? "",
      anchorType: member.anchor_type,
      commissionPercent: member.anchor_base_commission_bps / 100,
      baseSalary: effective ? effective.base_salary_cents / 100 : null,
      guaranteedSalary: effective ? effective.guaranteed_salary_cents / 100 : null,
    });
  }

  async function save() {
    if (!editing) return;
    // 静默 return 会让「保存」看起来没反应，这里明确告诉用户原因。
    if (!anchorPositionId) {
      setError(
        positions.isLoading ? "职位数据仍在加载，请稍后重试" : "未找到「主播」职位，无法创建个人方案",
      );
      return;
    }
    const commissionBps = Math.round(Number(editing.commissionPercent) * 100);
    const baseSalary = Number(editing.baseSalary);
    const guaranteedSalary = Number(editing.guaranteedSalary);
    if (!Number.isInteger(commissionBps) || commissionBps < 1 || commissionBps > 10000) {
      setError("基础提成率必须在 0.01%～100% 之间，最多两位小数");
      return;
    }
    if (
      !Number.isFinite(baseSalary) ||
      !Number.isFinite(guaranteedSalary) ||
      baseSalary <= 0 ||
      guaranteedSalary <= 0
    ) {
      setError("初始保底和降级保底必须大于 0");
      return;
    }
    const personal = schemes.data?.filter((scheme) => scheme.profile_id === editing.id) ?? [];
    const version = Math.max(0, ...personal.map((scheme) => scheme.version)) + 1;
    try {
      await updateSettings.mutateAsync({
        id: editing.id,
        anchorType: editing.anchorType,
        baseCommissionRateBps: commissionBps,
        douyinId: editing.douyinId,
      });
      await createScheme.mutateAsync({
        name: `${editing.name}个人方案`,
        profile_id: editing.id,
        position_id: anchorPositionId,
        version,
        base_salary_cents: Math.round(baseSalary * 100),
        guaranteed_salary_cents: Math.round(guaranteedSalary * 100),
        // 用本地日期而非 toISOString()（UTC）：CST 凌晨会写成前一天
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
        title="主播管理"
        description="统一管理主播抖音号、主播类型、基础提成率、初始保底和降级保底"
      />

      <Card>
        {listError ? (
          <QueryMessage loading={false} error={listError} />
        ) : (
          <Table
            rowClassName={zebraRowClassName}
            rowKey="id"
            loading={members.isLoading || schemes.isLoading}
            dataSource={anchors}
            pagination={false}
            locale={{ emptyText: "暂无主播" }}
            scroll={{ x: "max-content" }}
            columns={[
              { title: "主播", dataIndex: "name", fixed: "left", width: 180 },
              {
                title: "抖音号",
                width: 200,
                render: (_, record) =>
                  record.douyin_id ? record.douyin_id : <Typography.Text type="secondary">未填写</Typography.Text>,
              },
              {
                title: "主播类型",
                width: 140,
                render: (_, record) => (record.anchor_type === "new" ? "新主播" : "老主播"),
              },
              {
                title: "基础提成率",
                width: 140,
                render: (_, record) => `${record.anchor_base_commission_bps / 100}%`,
              },
              {
                title: "初始保底",
                width: 140,
                render: (_, record) => {
                  const effective = latestPersonalScheme(schemes.data, record.id) ?? template;
                  return effective ? formatCentsToYuan(effective.base_salary_cents) : "—";
                },
              },
              {
                title: "降级保底",
                width: 140,
                render: (_, record) => {
                  const effective = latestPersonalScheme(schemes.data, record.id) ?? template;
                  return effective ? formatCentsToYuan(effective.guaranteed_salary_cents) : "—";
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
        title={editing ? `编辑主播 · ${editing.name}` : "编辑主播"}
        open={Boolean(editing)}
        onCancel={() => setEditing(null)}
        onOk={save}
        okText="保存"
        cancelText="取消"
        confirmLoading={updateSettings.isPending || createScheme.isPending}
        destroyOnHidden
      >
        {editing ? (
          <Form layout="vertical">
            <Row gutter={16}>
              <Col span={24}>
                <FormField
                  label="抖音号"
                  hint="填接口返回的 user_id（如 2686827281788563）或抖音号（如 qkl1122334）；拉取流水后会按此自动识别该主播。留空表示不参与识别。"
                >
                  <Input
                    value={editing.douyinId}
                    maxLength={64}
                    allowClear
                    placeholder="user_id 或抖音号"
                    onChange={(e) => setEditing({ ...editing, douyinId: e.target.value })}
                  />
                </FormField>
              </Col>
            </Row>
            <Row gutter={16}>
              <Col span={12}>
                <FormField label="主播类型">
                  <Select
                    value={editing.anchorType}
                    onChange={(value: Editing["anchorType"]) =>
                      setEditing({ ...editing, anchorType: value })
                    }
                    options={[
                      { value: "new", label: "新主播" },
                      { value: "experienced", label: "老主播" },
                    ]}
                  />
                </FormField>
              </Col>
              <Col span={12}>
                <FormField label="基础提成率（%）">
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
                <FormField label="初始保底（元）">
                  <InputNumber
                    min={0.01}
                    step={0.01}
                    value={editing.baseSalary}
                    onChange={(value) => setEditing({ ...editing, baseSalary: value })}
                    style={{ width: "100%" }}
                  />
                </FormField>
              </Col>
              <Col span={12}>
                <FormField label="降级保底（元）">
                  <InputNumber
                    min={0.01}
                    step={0.01}
                    value={editing.guaranteedSalary}
                    onChange={(value) => setEditing({ ...editing, guaranteedSalary: value })}
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
