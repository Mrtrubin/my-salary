"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { FormField } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/stat-card";
import { QueryMessage } from "@/components/query-message";
import { useSystemSettlementSettings, useUpdateSystemSettlementSettings } from "@/lib/api/hooks";
import { resolveSystemPeriod, type SystemSettlementSettings } from "@/lib/api/data";
import type { SettlementType } from "@/lib/domain/settlement/cycle";
import { formatDate } from "@/lib/format";

function SettlementForm({ settings, pending, onSubmit, onEdit }: {
  settings: SystemSettlementSettings;
  pending: boolean;
  onSubmit: (input: { settlementType: SettlementType; settlementStartDay: number }) => void;
  onEdit: () => void;
}) {
  const [type, setType] = useState<SettlementType>(settings.settlement_type);
  const [startDay, setStartDay] = useState(String(settings.settlement_start_day));
  const valid = type === "monthly" || (Number.isInteger(Number(startDay)) && Number(startDay) >= 1 && Number(startDay) <= 28);
  const period = resolveSystemPeriod(settings);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid || pending) return;
    onSubmit({ settlementType: type, settlementStartDay: type === "monthly" ? 1 : Number(startDay) });
  }

  return (
    <form onSubmit={submit} className="grid max-w-lg gap-4">
      <fieldset disabled={pending} className="grid gap-4">
        <FormField label="结算模式">
          <select value={type} onChange={(event) => { setType(event.target.value as SettlementType); onEdit(); }} className="rounded border px-3 py-2 text-sm">
            <option value="monthly">自然月（每月 1 日至月末）</option>
            <option value="custom">自定义周期（起始日至次月起始日前一天）</option>
          </select>
        </FormField>
        {type === "custom" ? (
          <FormField label="周期起始日" hint="取值 1～28，例如 21 表示每月 21 日至次月 20 日。">
            <input type="number" min={1} max={28} step={1} required value={startDay}
              onChange={(event) => { setStartDay(event.target.value); onEdit(); }}
              className="w-32 rounded border px-3 py-2 text-sm" />
          </FormField>
        ) : null}
        <div className="space-y-1 text-sm text-muted">
          <p>已保存设置的当前周期：{formatDate(period.start)} ~ {formatDate(period.end)}</p>
          <p>所有工资均由管理员在主播流水页手动结算，不再自动生成。</p>
          <p>全系统使用统一周期；团队只筛选人员，流水金额跨团队汇总。修改配置不会重写历史工资的周期和金额快照。</p>
        </div>
        <div><Button type="submit" disabled={!valid || pending}>{pending ? "保存中…" : "保存系统周期"}</Button></div>
      </fieldset>
    </form>
  );
}

export default function SystemSettlementPage() {
  const settings = useSystemSettlementSettings();
  const update = useUpdateSystemSettlementSettings();

  return (
    <>
      <PageHeader title="系统结算周期" description="统一配置全系统工资结算周期，不再按团队分别设置。" />
      <Card>
        <CardHeader title="周期设置" description="管理员手动结算与主播流水试算均使用此设置。" />
        <CardContent>
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
          {update.isSuccess ? <p role="status" className="mt-3 text-sm text-emerald-600">系统周期已保存，相关试算数据已刷新。</p> : null}
          {update.isError ? <p role="alert" className="mt-3 text-sm text-red-600">{update.error.message || "保存失败，请重试"}</p> : null}
          {settings.isError ? <Button onClick={() => { void settings.refetch(); }}>重试加载</Button> : null}
        </CardContent>
      </Card>
    </>
  );
}