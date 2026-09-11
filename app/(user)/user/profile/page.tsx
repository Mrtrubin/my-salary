"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, FormField } from "@/components/ui/input";
import { ChangeRequestStatusBadge } from "@/components/ui/badge";
import { QueryMessage } from "@/components/query-message";
import {
  useCurrentProfile,
  useSchemes,
  useMyChangeRequests,
  useSubmitProfileChanges,
} from "@/lib/api/hooks";
import { EDITABLE_PROFILE_FIELDS, type ChangeableField } from "@/lib/api/data";
import { formatCentsToYuan } from "@/lib/format";

export default function UserProfilePage() {
  const profile = useCurrentProfile();
  const schemes = useSchemes();
  const requests = useMyChangeRequests();
  const submit = useSubmitProfileChanges();
  const scheme = schemes.data?.find((item) => item.status === "active");

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Record<ChangeableField, string>>({ name: "", phone: "", email: "", id_card: "" });
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  // 各字段当前的 pending 申请（同字段至多 1 条）。
  const pendingByField = useMemo(() => {
    const map = {} as Record<ChangeableField, { newValue: string } | undefined>;
    for (const r of requests.data ?? []) {
      if (r.status === "pending") map[r.field as ChangeableField] = { newValue: r.new_value ?? "" };
    }
    return map;
  }, [requests.data]);

  // 最近一条被驳回的申请（用于展示驳回文案）。
  const rejectedByField = useMemo(() => {
    const map = {} as Record<ChangeableField, { reason: string | null; newValue: string } | undefined>;
    for (const r of requests.data ?? []) {
      const f = r.field as ChangeableField;
      if (r.status === "rejected" && !map[f] && !pendingByField[f]) {
        map[f] = { reason: r.reject_reason, newValue: r.new_value ?? "" };
      }
    }
    return map;
  }, [requests.data, pendingByField]);

  if (!profile.data) return <QueryMessage loading={profile.isLoading} error={profile.error} />;

  const positions = profile.data.user_positions.flatMap((item) => (item.position ? [item.position] : []));

  function currentValue(field: ChangeableField): string {
    const p = profile.data!;
    return (p[field as keyof typeof p] as string | null) ?? "";
  }

  function openEditor() {
    setForm({
      name: currentValue("name"),
      phone: currentValue("phone"),
      email: currentValue("email"),
      id_card: currentValue("id_card"),
    });
    setError(null);
    setDone(null);
    setEditing(true);
  }

  async function handleSubmit() {
    setError(null);
    setDone(null);
    // 仅提交发生变化的字段。
    const changes = EDITABLE_PROFILE_FIELDS.flatMap(({ field }) => {
      const next = form[field].trim();
      if (next === (currentValue(field) ?? "").trim()) return [];
      return [{ field, newValue: next }];
    });
    if (changes.length === 0) {
      setError("未检测到任何修改");
      return;
    }
    try {
      const result = await submit.mutateAsync(changes);
      setDone(`已提交 ${result.count} 项修改申请，等待管理员审核`);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "提交失败，请稍后再试");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Link
          href="/user/settings"
          aria-label="设置"
          className="flex h-9 w-9 items-center justify-center rounded-full text-slate-500 transition-colors active:bg-slate-100"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </Link>
      </div>

      <Card className="px-5 py-5">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-indigo-100 text-lg font-semibold text-indigo-600">
            {profile.data.name.slice(0, 1)}
          </div>
          <div>
            <p className="text-base font-semibold">{profile.data.name}</p>
            <p className="text-xs text-muted">{profile.data.phone}</p>
          </div>
        </div>

        <dl className="mt-5 space-y-2.5 text-sm">
          <Row label="职位" value={positions.map((item) => item.name).join("、") || "未分配"} />
          <Row label="入职日期" value={profile.data.hire_date} />
        </dl>
      </Card>

      <Card className="px-5 py-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">个人资料</h2>
          {!editing ? (
            <Button size="sm" variant="secondary" onClick={openEditor}>修改资料</Button>
          ) : null}
        </div>

        {done ? <p className="mt-3 rounded-lg bg-green-50 px-3 py-2 text-xs text-green-700">{done}</p> : null}

        {editing ? (
          <div className="mt-4 space-y-3">
            {EDITABLE_PROFILE_FIELDS.map(({ field, label, type }) => (
              <FormField
                key={field}
                label={label}
                hint={pendingByField[field] ? "该字段有待审核申请，重新提交将覆盖旧申请" : undefined}
              >
                <Input
                  type={type}
                  value={form[field]}
                  onChange={(e) => setForm((prev) => ({ ...prev, [field]: e.target.value }))}
                />
              </FormField>
            ))}
            {error ? <p className="text-xs text-red-600">{error}</p> : null}
            <div className="flex gap-2">
              <Button size="sm" onClick={handleSubmit} disabled={submit.isPending}>
                {submit.isPending ? "提交中…" : "提交审核"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={submit.isPending}>取消</Button>
            </div>
          </div>
        ) : (
          <dl className="mt-3 space-y-3 text-sm">
            {EDITABLE_PROFILE_FIELDS.map(({ field, label }) => {
              const pending = pendingByField[field];
              const rejected = rejectedByField[field];
              return (
                <div key={field} className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <dt className="text-xs text-muted">{label}</dt>
                    <dd className="tabular-nums">{currentValue(field) || "—"}</dd>
                  </div>
                  {pending ? (
                    <div className="flex items-center justify-between gap-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs text-amber-700">
                      <span>审核中：{pending.newValue || "（清空）"}</span>
                      <ChangeRequestStatusBadge status="pending" />
                    </div>
                  ) : rejected ? (
                    <div className="rounded-lg bg-red-50 px-2.5 py-1.5 text-xs text-red-700">
                      <div className="flex items-center justify-between gap-2">
                        <span>申请「{rejected.newValue || "（清空）"}」被驳回</span>
                        <ChangeRequestStatusBadge status="rejected" />
                      </div>
                      {rejected.reason ? <p className="mt-1 text-red-600">原因：{rejected.reason}</p> : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </dl>
        )}
      </Card>

      <Card className="px-5 py-5">
        <h2 className="text-sm font-medium">当前工资方案</h2>
        {scheme ? (
          <dl className="mt-3 space-y-2.5 text-sm">
            <Row label="方案" value={`${scheme.name} v${scheme.version}`} />
            <Row label="基本工资" value={formatCentsToYuan(scheme.base_salary_cents)} />
            <Row label="保底工资" value={formatCentsToYuan(scheme.guaranteed_salary_cents)} />
            <Row label="提成" value="基础 20% + 阶梯提点 0%~5%，最终提成率不封顶" />
          </dl>
        ) : (
          <QueryMessage loading={schemes.isLoading} error={schemes.error} empty />
        )}
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}