"use client";

import { Alert, Button, Card, Form, InputNumber, Select, Typography } from "antd";
import { useState } from "react";
import { FormField } from "@/components/admin/form-field";
import { PageHeader } from "@/components/admin/page-header";
import { QueryMessage } from "@/components/admin/query-message";
import { useSystemSettlementSettings, useUpdateSystemSettlementSettings } from "@/lib/api/hooks";
import { resolveSystemPeriod, type SystemSettlementSettings } from "@/lib/api/data";
import type { SettlementType } from "@/lib/domain/settlement/cycle";
import { formatDate } from "@/lib/format";

function SettlementForm({
  settings,
  pending,
  onSubmit,
  onEdit,
}: {
  settings: SystemSettlementSettings;
  pending: boolean;
  onSubmit: (input: { settlementType: SettlementType; settlementStartDay: number }) => void;
  onEdit: () => void;
}) {
  const [type, setType] = useState<SettlementType>(settings.settlement_type);
  const [startDay, setStartDay] = useState<number | null>(settings.settlement_start_day);
  const valid =
    type === "monthly" ||
    (Number.isInteger(startDay) && (startDay ?? 0) >= 1 && (startDay ?? 0) <= 28);
  const period = resolveSystemPeriod(settings);

  function submit() {
    if (!valid || pending) return;
    onSubmit({
      settlementType: type,
      settlementStartDay: type === "monthly" ? 1 : (startDay as number),
    });
  }

  return (
    <Form layout="vertical" style={{ maxWidth: 560 }} onFinish={submit}>
      <fieldset disabled={pending} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <FormField label="结算模式">
          <Select
            value={type}
            onChange={(value: SettlementType) => {
              setType(value);
              onEdit();
            }}
            options={[
              { value: "monthly", label: "自然月（每月 1 日至月末）" },
              { value: "custom", label: "自定义周期（起始日至次月起始日前一天）" },
            ]}
          />
        </FormField>

        {type === "custom" ? (
          <FormField label="周期起始日" hint="取值 1～28，例如 21 表示每月 21 日至次月 20 日。">
            <InputNumber
              min={1}
              max={28}
              step={1}
              precision={0}
              value={startDay}
              onChange={(value) => {
                setStartDay(value);
                onEdit();
              }}
              style={{ width: 160 }}
            />
          </FormField>
        ) : null}

        <Typography.Paragraph type="secondary">
          已保存设置的当前周期：{formatDate(period.start)} ~ {formatDate(period.end)}
          <br />
          所有工资均由管理员在主播流水页手动结算，不再自动生成。
          <br />
          全系统使用统一周期；团队只筛选人员，流水金额跨团队汇总。修改配置不会重写历史工资的周期和金额快照。
        </Typography.Paragraph>

        <Button type="primary" htmlType="submit" loading={pending} disabled={!valid}>
          保存系统周期
        </Button>
      </fieldset>
    </Form>
  );
}

export default function SystemSettlementPage() {
  const settings = useSystemSettlementSettings();
  const update = useUpdateSystemSettlementSettings();

  return (
    <>
      <PageHeader title="系统结算周期" description="统一配置全系统工资结算周期，不再按团队分别设置。" />
      <Card
        title="周期设置"
        extra={
          <Typography.Text type="secondary">管理员手动结算与主播流水试算均使用此设置。</Typography.Text>
        }
      >
        <QueryMessage loading={settings.isLoading} error={settings.error} />
        {settings.data && !settings.isError ? (
          <SettlementForm
            key={`${settings.data.settlement_type}:${settings.data.settlement_start_day}:${settings.data.updated_at}`}
            settings={settings.data}
            pending={update.isPending || settings.isFetching}
            onSubmit={(input) => update.mutate(input)}
            onEdit={() => update.reset()}
          />
        ) : null}

        {update.isSuccess ? (
          <Alert
            type="success"
            showIcon
            title="系统周期已保存，相关试算数据已刷新。"
            style={{ marginTop: 12 }}
          />
        ) : null}
        {update.isError ? (
          <Alert
            type="error"
            showIcon
            title={update.error.message || "保存失败，请重试"}
            style={{ marginTop: 12 }}
          />
        ) : null}
        {settings.isError ? (
          <Button
            style={{ marginTop: 12 }}
            onClick={() => {
              void settings.refetch();
            }}
          >
            重试加载
          </Button>
        ) : null}
      </Card>
    </>
  );
}
