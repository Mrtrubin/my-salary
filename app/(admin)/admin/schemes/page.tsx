"use client";

import {
  Button,
  Card,
  Col,
  DatePicker,
  Empty,
  Flex,
  Form,
  Input,
  InputNumber,
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
import { useCreateScheme, useMembers, usePositions, useSchemes } from "@/lib/api/hooks";
import { formatCentsToYuan } from "@/lib/format";

type FormValues = {
  name: string;
  profileId: string;
  positionId: string;
  baseSalary: number | null;
  guaranteedSalary: number | null;
  effectiveFrom: string;
};

/**
 * effectiveFrom 刻意留空：模块作用域求值会在服务端与浏览器各跑一次，
 * 两边时区不同时 SSR/CSR 会拿到不同日期。改为打开表单时现算，见 formDefaults。
 */
const DEFAULTS: FormValues = {
  name: "",
  profileId: "",
  positionId: "",
  baseSalary: null,
  guaranteedSalary: null,
  effectiveFrom: "",
};

const formDefaults = (): FormValues => ({
  ...DEFAULTS,
  effectiveFrom: dayjs().format("YYYY-MM-DD"),
});

export default function SchemesPage() {
  const schemes = useSchemes();
  const members = useMembers();
  const positions = usePositions();
  const create = useCreateScheme();
  const [show, setShow] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const {
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({ defaultValues: formDefaults() });

  async function submit(value: FormValues) {
    setErrorMsg(null);
    const version =
      Math.max(
        0,
        ...(schemes.data?.filter((item) => item.name === value.name).map((item) => item.version) ??
          []),
      ) + 1;
    try {
      await create.mutateAsync({
        name: value.name,
        profile_id: value.profileId || null,
        position_id: value.positionId ? Number(value.positionId) : null,
        version,
        base_salary_cents: Math.round(Number(value.baseSalary) * 100),
        guaranteed_salary_cents: Math.round(Number(value.guaranteedSalary) * 100),
        effective_from: value.effectiveFrom,
      });
      reset(formDefaults());
      setShow(false);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "新建方案失败，请稍后再试");
    }
  }

  return (
    <>
      <PageHeader
        title="工资方案"
        description="个人方案优先；成员无个人方案时，按岗位回退使用「岗位模板」（不指定成员的方案）。基础提成率 20%；超过拿提点门槛的流水每满 1 万元，阶梯提点 +1 个百分点，阶梯提点最高 5%；最终提成率不封顶。"
        action={
          <Button
            type="primary"
            onClick={() => {
              setErrorMsg(null);
              if (!show) reset(formDefaults());
              setShow(!show);
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
                  hint="留空则作为「岗位模板」：该岗位下未配置个人方案的成员自动回退使用此模板。"
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
                <FormField label="职位" error={errors.positionId ? "请选择职位" : undefined} required>
                  <Controller
                    control={control}
                    name="positionId"
                    rules={{ required: true }}
                    render={({ field }) => (
                      <Select
                        {...field}
                        placeholder="请选择"
                        loading={positions.isLoading}
                        options={(positions.data ?? []).map((item) => ({
                          value: String(item.id),
                          label: item.name,
                        }))}
                      />
                    )}
                  />
                </FormField>
              </Col>
              <Col xs={24} md={12}>
                <FormField
                  label="生效日期"
                  error={errors.effectiveFrom ? "请选择生效日期" : undefined}
                  required
                >
                  <Controller
                    control={control}
                    name="effectiveFrom"
                    rules={{ required: true }}
                    render={({ field }) => (
                      <DatePicker
                        style={{ width: "100%" }}
                        value={field.value ? dayjs(field.value) : null}
                        onChange={(date) => field.onChange(date ? date.format("YYYY-MM-DD") : "")}
                      />
                    )}
                  />
                </FormField>
              </Col>
              <Col xs={24} md={12}>
                <FormField
                  label="初始保底（元）"
                  hint="无责期及上月达标时的保底基准，示例 8000"
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
                  {item.profile?.name ?? "岗位模板"} · {item.position?.name ?? "未分配"} ·{" "}
                  {item.effective_from}
                </Typography.Paragraph>
                <Typography.Text>
                  初始保底 {formatCentsToYuan(item.base_salary_cents)} · 降级保底{" "}
                  {formatCentsToYuan(item.guaranteed_salary_cents)} · 基础提成 20% · 阶梯提点 0%~5% ·
                  最终提成率不封顶
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
