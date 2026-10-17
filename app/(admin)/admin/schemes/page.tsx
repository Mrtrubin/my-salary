"use client";

import {
  Button,
  Card,
  Col,
  Empty,
  Flex,
  Form,
  Input,
  InputNumber,
  Radio,
  Row,
  Select,
  Space,
  Tag,
  Typography,
} from "antd";
import dayjs from "dayjs";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { FormField } from "@/components/admin/form-field";
import { PageHeader } from "@/components/admin/page-header";
import { QueryMessage } from "@/components/admin/query-message";
import { useCreateScheme, useMembers, useRoles, useSchemes } from "@/lib/api/hooks";
import { formatCentsToYuan } from "@/lib/format";

type FormValues = {
  name: string;
  profileId: string;
  roleId: string;
  /** 工资结算方式：guarantee = 保底结算（现口径）；fixed_percent = 总流水 × 固定百分比。 */
  settlementMode: "guarantee" | "fixed_percent";
  /** 固定百分比（%），settlementMode = fixed_percent 时参与保存。 */
  fixedPercent: number | null;
  baseSalary: number | null;
  guaranteedSalary: number | null;
};

const DEFAULTS: FormValues = {
  name: "",
  profileId: "",
  roleId: "",
  settlementMode: "guarantee",
  fixedPercent: 20,
  baseSalary: null,
  guaranteedSalary: null,
};

const formDefaults = (): FormValues => ({ ...DEFAULTS });

export default function SchemesPage() {
  const schemes = useSchemes();
  const members = useMembers();
  const roles = useRoles();
  const create = useCreateScheme();
  const [show, setShow] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // 结算方式的受控镜像：决定渲染固定百分比还是保底字段（避免使用不可安全记忆化的 watch()）。
  const [settlementMode, setSettlementMode] = useState<FormValues["settlementMode"]>("guarantee");
  const {
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({ defaultValues: formDefaults() });

  /** 打开/收起新建表单：重置表单时同步结算方式的受控镜像。 */
  function toggleForm(next: boolean) {
    if (next) {
      reset(formDefaults());
      setSettlementMode("guarantee");
    }
    setShow(next);
  }

  async function submit(value: FormValues) {
    setErrorMsg(null);
    const version =
      Math.max(
        0,
        ...(schemes.data?.filter((item) => item.name === value.name).map((item) => item.version) ??
          []),
      ) + 1;
    const baseSalary = Number(value.baseSalary);
    const guaranteedSalary = Number(value.guaranteedSalary);
    const fixedPercentBps = Math.round(Number(value.fixedPercent) * 100);
    if (value.settlementMode === "fixed_percent") {
      if (!Number.isInteger(fixedPercentBps) || fixedPercentBps < 1 || fixedPercentBps > 10000) {
        setErrorMsg("固定百分比必须在 0.01%～100% 之间，最多两位小数");
        return;
      }
      if (!Number.isFinite(baseSalary) || baseSalary <= 0) {
        setErrorMsg("初始保底必须大于 0（用于停播/延误调整项预设）");
        return;
      }
    } else if (!Number.isFinite(baseSalary) || baseSalary <= 0 || guaranteedSalary <= 0) {
      setErrorMsg("初始保底和降级保底必须大于 0");
      return;
    }
    try {
      await create.mutateAsync({
        name: value.name,
        profile_id: value.profileId || null,
        role_id: value.roleId ? Number(value.roleId) : null,
        version,
        base_salary_cents: Math.round(baseSalary * 100),
        // 固定百分比结算下降级保底不参与计算：存 0 占位，保持方案列非空即可。
        guaranteed_salary_cents: Math.round(
          (value.settlementMode === "fixed_percent"
            ? (guaranteedSalary > 0 ? guaranteedSalary : 0)
            : guaranteedSalary) * 100,
        ),
        service_fee_rate_bps: 300,
        settlement_mode: value.settlementMode,
        fixed_percent_bps: fixedPercentBps,
        // 方案不再按生效日期筛选，仅保留该列做创建时间记录。
        effective_from: dayjs().format("YYYY-MM-DD"),
      });
      reset(formDefaults());
      setSettlementMode("guarantee");
      setShow(false);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "新建方案失败，请稍后再试");
    }
  }

  return (
    <>
      <PageHeader
        title="工资方案"
        description="个人方案优先；成员无个人方案时，按角色回退使用「角色模板」（不指定成员的方案）。基础提成率 20%；超过拿提点门槛的流水每满 1 万元，阶梯提点 +1 个百分点，阶梯提点最高 5%；最终提成率不封顶。"
        action={
          <Button
            type="primary"
            onClick={() => {
              setErrorMsg(null);
              toggleForm(!show);
            }}
          >
            {show ? "收起" : "+ 新建方案"}
          </Button>
        }
      />

      {show ? (
        <Card title="新建方案" style={{ marginBottom: 16 }}>
          <Form layout="vertical" onFinish={handleSubmit(submit)}>
            <Row gutter={16}>
              <Col xs={24} md={12}>
                <FormField
                  label="方案名称"
                  error={errors.name ? "请填写方案名称" : undefined}
                  required
                >
                  <Controller
                    control={control}
                    name="name"
                    rules={{ required: true }}
                    render={({ field }) => <Input {...field} placeholder="如：主播个人方案" />}
                  />
                </FormField>
              </Col>
              <Col xs={24} md={12}>
                <FormField
                  label="成员"
                  hint="留空则作为「角色模板」：该角色下未配置个人方案的成员自动回退使用此模板。"
                >
                  <Controller
                    control={control}
                    name="profileId"
                    render={({ field }) => (
                      <Select
                        {...field}
                        allowClear
                        placeholder="（模板，不指定成员）"
                        loading={members.isLoading}
                        options={(members.data ?? []).map((item) => ({
                          value: item.id,
                          label: item.name,
                        }))}
                      />
                    )}
                  />
                </FormField>
              </Col>
              <Col xs={24} md={12}>
                <FormField label="角色" error={errors.roleId ? "请选择角色" : undefined} required>
                  <Controller
                    control={control}
                    name="roleId"
                    rules={{ required: true }}
                    render={({ field }) => (
                      <Select
                        {...field}
                        placeholder="请选择"
                        loading={roles.isLoading}
                        options={(roles.data ?? []).map((item) => ({
                          value: String(item.id),
                          label: item.name,
                        }))}
                      />
                    )}
                  />
                </FormField>
              </Col>
              <Col xs={24} md={12}>
                <FormField label="工资结算方式">
                  <Controller
                    control={control}
                    name="settlementMode"
                    render={({ field }) => (
                      <Radio.Group
                        value={settlementMode}
                        optionType="button"
                        buttonStyle="solid"
                        options={[
                          { value: "guarantee", label: "保底结算" },
                          { value: "fixed_percent", label: "固定百分比" },
                        ]}
                        onChange={(e) => {
                          setSettlementMode(e.target.value);
                          field.onChange(e.target.value);
                        }}
                      />
                    )}
                  />
                </FormField>
              </Col>
              {settlementMode === "fixed_percent" ? (
                <Col xs={24} md={12}>
                  <FormField
                    label="固定百分比（%）"
                    hint="总工资 = 总流水 × 固定百分比；不叠加阶梯提成与考勤/dy 加点。"
                  >
                    <Controller
                      control={control}
                      name="fixedPercent"
                      render={({ field }) => (
                        <InputNumber
                          {...field}
                          min={0.01}
                          max={100}
                          step={0.01}
                          style={{ width: "100%" }}
                          placeholder="20"
                        />
                      )}
                    />
                  </FormField>
                </Col>
              ) : null}
              <Col xs={24} md={12}>
                <FormField
                  label="初始保底（元）"
                  hint={
                    settlementMode === "fixed_percent"
                      ? "不作为工资下限，用于停播（÷26）、延误（÷260）调整项预设。"
                      : "无责期及上月达标时的保底基准，示例 8000"
                  }
                  error={errors.baseSalary ? "请填写初始保底" : undefined}
                  required
                >
                  <Controller
                    control={control}
                    name="baseSalary"
                    rules={{ required: true }}
                    render={({ field }) => (
                      <InputNumber
                        {...field}
                        min={0}
                        style={{ width: "100%" }}
                        placeholder="8000"
                      />
                    )}
                  />
                </FormField>
              </Col>
              {settlementMode === "guarantee" ? (
                <Col xs={24} md={12}>
                  <FormField
                    label="降级保底（元）"
                    hint="第 4 月起上月不达标时的保底基准，示例 5000"
                    error={errors.guaranteedSalary ? "请填写降级保底" : undefined}
                    required
                  >
                    <Controller
                      control={control}
                      name="guaranteedSalary"
                      rules={{ required: true }}
                      render={({ field }) => (
                        <InputNumber
                          {...field}
                          min={0}
                          style={{ width: "100%" }}
                          placeholder="5000"
                        />
                      )}
                    />
                  </FormField>
                </Col>
              ) : null}
            </Row>
            <Space>
              <Button type="primary" htmlType="submit" loading={create.isPending}>
                保存
              </Button>
              <Button onClick={() => setShow(false)}>取消</Button>
            </Space>
            {errorMsg ? (
              <Typography.Paragraph type="danger" style={{ marginTop: 12, marginBottom: 0 }}>
                保存失败：{errorMsg}
              </Typography.Paragraph>
            ) : null}
          </Form>
        </Card>
      ) : null}

      <QueryMessage loading={schemes.isLoading} error={schemes.error} />

      {!schemes.isLoading && !schemes.error ? (
        schemes.data?.length ? (
          <Flex vertical gap={16}>
            {schemes.data.map((item) => (
              <Card
                key={item.id}
                title={
                  <Space>
                    <span>{item.name}</span>
                    <Tag color="blue">v{item.version}</Tag>
                  </Space>
                }
              >
                <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
                  {item.profile?.name ?? "角色模板"} · {item.role?.name ?? "未分配"}
                </Typography.Paragraph>
                <Typography.Text>
                  {item.settlement_mode === "fixed_percent"
                    ? `固定百分比 ${item.fixed_percent_bps / 100}% · 总工资 = 总流水 × 固定百分比 · 初始保底 ${formatCentsToYuan(item.base_salary_cents)}（用于停播/延误预设）`
                    : `初始保底 ${formatCentsToYuan(item.base_salary_cents)} · 降级保底 ${formatCentsToYuan(item.guaranteed_salary_cents)} · 基础提成 20% · 阶梯提点 0%~5% · 最终提成率不封顶`}
                </Typography.Text>
              </Card>
            ))}
          </Flex>
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无方案" />
        )
      ) : null}
    </>
  );
}
