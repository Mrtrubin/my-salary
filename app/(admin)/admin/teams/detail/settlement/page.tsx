"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { FormField } from "@/components/ui/input";
import { QueryMessage } from "@/components/query-message";
import { useTeams, useUpdateTeam } from "@/lib/api/hooks";

function TeamSettlementInner() {
  const searchParams = useSearchParams();
  const teamId = searchParams.get("teamId") ?? "";
  const teams = useTeams();
  const update = useUpdateTeam();

  const team = teams.data?.find((t) => t.id === teamId);

  const [type, setType] = useState<"monthly" | "custom">("monthly");
  const [startDay, setStartDay] = useState(1);

  // 「渲染期同步」模式（React 官方推荐）：用 state 记录上次同步的 teamId，
  // 团队切换时在渲染阶段直接 setState 重置表单初值，避免在 effect 内同步 setState 的告警。
  const [syncedTeamId, setSyncedTeamId] = useState<string | null>(null);
  if (team && syncedTeamId !== team.id) {
    setSyncedTeamId(team.id);
    setType((team.settlement_type as "monthly" | "custom") ?? "monthly");
    setStartDay(team.settlement_start_day ?? 1);
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!teamId) return;
    update.mutate({
      id: teamId,
      settlementType: type,
      settlementStartDay: type === "custom" ? startDay : 1,
    });
  };

  return (
    <Card>
      <CardHeader
        title="结算周期"
        description="设置团队的薪资结算周期。系统将在下一结算周期首日自动生成待审核工资条。"
      />
      <CardContent>
        <QueryMessage loading={teams.isLoading} error={teams.error} empty={!teams.isLoading && !team} />
        {team ? (
          <form onSubmit={submit} className="grid max-w-lg gap-4">
            <FormField label="结算模式">
              <select
                value={type}
                onChange={(e) => setType(e.target.value as "monthly" | "custom")}
                className="rounded border px-3 py-2 text-sm"
              >
                <option value="monthly">自然月（每月 1 日 ~ 月末）</option>
                <option value="custom">自定义锚点（起始日 ~ 次月起始日前一天）</option>
              </select>
            </FormField>
            {type === "custom" ? (
              <FormField label="周期起始日" hint="取值 1~28，例如 21 表示每月 21 日至次月 20 日为一个周期。">
                <input
                  type="number"
                  min={1}
                  max={28}
                  required
                  value={startDay}
                  onChange={(e) => setStartDay(Math.min(28, Math.max(1, Number(e.target.value) || 1)))}
                  className="w-32 rounded border px-3 py-2 text-sm"
                />
              </FormField>
            ) : null}
            <div className="text-xs text-muted">
              当前周期上次结算截止：{team.last_settled_period_end ?? "尚未结算"}
            </div>
            <div>
              <Button type="submit" disabled={update.isPending}>
                {update.isPending ? "保存中…" : "保存周期设置"}
              </Button>
            </div>
            {update.isSuccess ? <p className="text-sm text-emerald-600">已保存</p> : null}
            {update.isError ? <p className="text-sm text-red-600">保存失败，请重试</p> : null}
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default function TeamSettlementPage() {
  return (
    <Suspense fallback={null}>
      <TeamSettlementInner />
    </Suspense>
  );
}