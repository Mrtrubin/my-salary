"use client";

import {
  Button,
  Card,
  Col,
  Form,
  Input,
  InputNumber,
  Modal,
  Radio,
  Row,
  Select,
  Typography,
} from "antd";
import dayjs from "dayjs";
import { useMemo, useState } from "react";
import { FormField } from "@/components/admin/form-field";
import { PageHeader } from "@/components/admin/page-header";
import { QueryMessage } from "@/components/admin/query-message";
import { ResizableTable } from "@/components/admin/resizable-table";
import { zebraRowClassName } from "@/components/admin/table-zebra";
import {
  useCreateScheme,
  useMembers,
  useRoles,
  useSchemes,
  useUpdateAnchorSettings,
} from "@/lib/api/hooks";
import type { Member, SalaryScheme } from "@/lib/api/data";
import { formatCentsToYuan } from "@/lib/format";

/**
 * 主播工资结算方式（salary_schemes.settlement_mode 二选一）：
 *  - guarantee：基础保底 + 降级保底的既有结算方式；
 *  - fixed_percent：总工资 = 总流水 × 固定百分比（fixed_percent_bps，默认 20%）。
 * 两种方式共用初始保底配置与服务率；降级保底仅在保底结算下参与计算。
 */
type SettlementMode = "guarantee" | "fixed_percent";

function isAnchor(member: Member) {
  return member.user_roles.some(({ role }) => role?.code === "anchor");
}

function latestPersonalScheme(schemes: SalaryScheme[] | undefined, profileId: string) {
  return schemes
    ?.filter((scheme) => scheme.profile_id === profileId)
    .sort((a, b) => b.version - a.version)[0];
}

function latestTemplateScheme(schemes: SalaryScheme[] | undefined, roleId?: number) {
  return schemes
    ?.filter((scheme) => scheme.profile_id == null && scheme.role_id === roleId)
    .sort((a, b) => b.version - a.version)[0];
}

type Editing = {
  id: string;
  name: string;
  /** 抖音号：接口返回的 user_id（数字 uid）或 aweme_display_id 都能填。 */
  douyinId: string;
  anchorType: "new" | "experienced";
  commissionPercent: number | null;
  /** 工资结算方式，默认保底结算。 */
  settlementMode: SettlementMode;
  /** 固定百分比（%），固定百分比结算下参与保存。 */
  fixedPercent: number | null;
  baseSalary: number | null;
  guaranteedSalary: number | null;
  /** 服务率（%）。 */
  servicePercent: number | null;
};

export default function AnchorsPage() {
  const members = useMembers();
  const roles = useRoles();
  const schemes = useSchemes();
  const updateSettings = useUpdateAnchorSettings();
  const createScheme = useCreateScheme();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [error, setError] = useState("");

  const anchors = useMemo(() => members.data?.filter(isAnchor) ?? [], [members.data]);
  const anchorRoleId = roles.data?.find((role) => role.code === "anchor")?.id;
  const template = latestTemplateScheme(schemes.data, anchorRoleId);
  const listError = members.error ?? schemes.error;

  function effectiveScheme(member: Member) {
    return latestPersonalScheme(schemes.data, member.id) ?? template;
  }

  function openEditor(member: Member) {
    const effective = effectiveScheme(member);
    setError("");
    setEditing({
      id: member.id,
      name: member.name,
      douyinId: member.douyin_id ?? "",
      anchorType: member.anchor_type,
      commissionPercent: member.anchor_base_commission_bps / 100,
      settlementMode:
        effective?.settlement_mode === "fixed_percent" ? "fixed_percent" : "guarantee",
      // 固定百分比默认 20%；已有生效方案时沿用其配置。
      fixedPercent: effective ? effective.fixed_percent_bps / 100 : 20,
      baseSalary: effective ? effective.base_salary_cents / 100 : null,
      guaranteedSalary: effective ? effective.guaranteed_salary_cents / 100 : null,
      servicePercent: effective ? effective.service_fee_rate_bps / 100 : 3,
    });
  }

  async function save() {
    if (!editing) return;
    // 静默 return 会让「保存」看起来没反应，这里明确告诉用户原因。
    if (!anchorRoleId) {
      setError(
        roles.isLoading ? "角色数据仍在加载，请稍后重试" : "未找到「主播」角色，无法创建个人方案",
      );
      return;
    }
    const commissionBps = Math.round(Number(editing.commissionPercent) * 100);
    const serviceBps = Math.round(Number(editing.servicePercent) * 100);
    const baseSalary = Number(editing.baseSalary);
    const guaranteedSalary = Number(editing.guaranteedSalary);
    const fixedPercentBps = Math.round(Number(editing.fixedPercent) * 100);
    if (!Number.isInteger(commissionBps) || commissionBps < 1 || commissionBps > 10000) {
      setError("基础提成率必须在 0.01%～100% 之间，最多两位小数");
      return;
    }
    if (!Number.isInteger(serviceBps) || serviceBps < 0 || serviceBps > 10000) {
      setError("服务率必须在 0%～100% 之间，最多两位小数");
      return;
    }
    // 固定百分比结算：校验固定百分比与初始保底；降级保底不参与计算（沿用旧值或 0）。
    if (editing.settlementMode === "fixed_percent") {
      if (
        !Number.isInteger(fixedPercentBps) ||
        fixedPercentBps < 1 ||
        fixedPercentBps > 10000
      ) {
        setError("固定百分比必须在 0.01%～100% 之间，最多两位小数");
        return;
      }
      if (!Number.isFinite(baseSalary) || baseSalary <= 0) {
        setError("初始保底必须大于 0（用于停播/延误调整项预设）");
        return;
      }
    }
    if (
      editing.settlementMode === "guarantee" &&
      (!Number.isFinite(baseSalary) ||
        !Number.isFinite(guaranteedSalary) ||
        baseSalary <= 0 ||
        guaranteedSalary <= 0)
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
        role_id: anchorRoleId,
        version,
        base_salary_cents: Math.round(baseSalary * 100),
        // 固定百分比结算下降级保底不参与计算：沿用所填值（无则存 0），保持方案列非空即可。
        guaranteed_salary_cents: Math.round((Number(editing.guaranteedSalary) || 0) * 100),
        service_fee_rate_bps: serviceBps,
        settlement_mode: editing.settlementMode,
        fixed_percent_bps: fixedPercentBps,
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
        description="统一管理主播抖音号、主播类型、工资结算方式（保底结算/固定百分比）、初始保底、降级保底与服务率"
      />

      <Card>
        {listError ? (
          <QueryMessage loading={false} error={listError} />
        ) : (
          <ResizableTable<Member>
            rowClassName={zebraRowClassName}
            rowKey="id"
            loading={members.isLoading || schemes.isLoading}
            dataSource={anchors}
            locale={{ emptyText: "暂无主播" }}
            columns={[
              { title: "主播", dataIndex: "name", fixed: "left", width: 160 },
              {
                title: "抖音号",
                key: "douyin_id",
                width: 180,
                sortValue: (record) => record.douyin_id,
                render: (_, record) =>
                  record.douyin_id ? record.douyin_id : <Typography.Text type="secondary">未填写</Typography.Text>,
              },
              {
                title: "主播类型",
                key: "anchor_type",
                width: 120,
                sortValue: (record) => (record.anchor_type === "new" ? "新主播" : "老主播"),
                render: (_, record) => (record.anchor_type === "new" ? "新主播" : "老主播"),
              },
              {
                title: "基础提成率",
                key: "base_commission",
                align: "right",
                width: 130,
                sortValue: (record) => record.anchor_base_commission_bps,
                render: (_, record) => `${record.anchor_base_commission_bps / 100}%`,
              },
              {
                title: "结算方式",
                key: "settlement_mode",
                width: 110,
                sortValue: (record) => effectiveScheme(record)?.settlement_mode ?? null,
                render: (_, record) => {
                  const effective = effectiveScheme(record);
                  if (!effective) return "—";
                  return effective.settlement_mode === "fixed_percent"
                    ? `固定 ${effective.fixed_percent_bps / 100}%`
                    : "保底结算";
                },
              },
              {
                title: "初始保底",
                key: "base_salary",
                align: "right",
                width: 130,
                sortValue: (record) => effectiveScheme(record)?.base_salary_cents ?? null,
                render: (_, record) => {
                  const effective = effectiveScheme(record);
                  return effective ? formatCentsToYuan(effective.base_salary_cents) : "—";
                },
              },
              {
                title: "降级保底",
                key: "guaranteed_salary",
                align: "right",
                width: 130,
                sortValue: (record) => effectiveScheme(record)?.guaranteed_salary_cents ?? null,
                render: (_, record) => {
                  const effective = effectiveScheme(record);
                  return effective ? formatCentsToYuan(effective.guaranteed_salary_cents) : "—";
                },
              },
              {
                title: "服务率",
                key: "service_fee",
                align: "right",
                width: 110,
                sortValue: (record) => effectiveScheme(record)?.service_fee_rate_bps ?? null,
                render: (_, record) => {
                  const effective = effectiveScheme(record);
                  return effective ? `${effective.service_fee_rate_bps / 100}%` : "—";
                },
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
              <Col span={24}>
                <FormField
                  label="工资结算方式"
                  hint="保底结算：按初始/降级保底与阶梯提成计薪（现口径）；固定百分比：总工资 = 总流水 × 固定百分比。"
                >
                  <Radio.Group
                    value={editing.settlementMode}
                    optionType="button"
                    buttonStyle="solid"
                    options={[
                      { value: "guarantee", label: "保底结算" },
                      { value: "fixed_percent", label: "固定百分比" },
                    ]}
                    onChange={(e) =>
                      setEditing({ ...editing, settlementMode: e.target.value as SettlementMode })
                    }
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
              {editing.settlementMode === "fixed_percent" ? (
                <Col span={12}>
                  <FormField
                    label="固定百分比（%）"
                    hint="总工资 = 总流水 × 固定百分比；不叠加阶梯提成与考勤/dy 加点。"
                  >
                    <InputNumber
                      min={0.01}
                      max={100}
                      step={0.01}
                      value={editing.fixedPercent}
                      onChange={(value) => setEditing({ ...editing, fixedPercent: value })}
                      style={{ width: "100%" }}
                    />
                  </FormField>
                </Col>
              ) : null}
              <Col span={12}>
                <FormField
                  label="初始保底（元）"
                  hint={
                    editing.settlementMode === "fixed_percent"
                      ? "不作为工资下限，用于停播（÷26）、延误（÷260）调整项预设。"
                      : "无责期及达标时的保底基准。"
                  }
                >
                  <InputNumber
                    min={0.01}
                    step={0.01}
                    value={editing.baseSalary}
                    onChange={(value) => setEditing({ ...editing, baseSalary: value })}
                    style={{ width: "100%" }}
                  />
                </FormField>
              </Col>
              {editing.settlementMode === "guarantee" ? (
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
              ) : null}
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
