"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { QueryMessage } from "@/components/query-message";
import {
  useCreateStaffSalaryRecords,
  useRoles,
  useSetStaffBaseIncome,
  useSetStaffPerformance,
  useStaffMembers,
  useStaffPerformance,
  useStaffSalaryRecords,
} from "@/lib/api/hooks";
import type { StaffMember, StaffPerformanceRow } from "@/lib/api/data";
import { parseAdjustmentAmountYuan } from "@/lib/domain/payroll/adjustment";
import { getPresetRange, localToday } from "@/lib/domain/settlement/cycle";
import type { PeriodRange } from "@/lib/domain/settlement/cycle";
import { formatCentsToYuan, formatDate, formatDateTime } from "@/lib/format";

const ROLE_CODE = "hr";

const STATUS_LABELS: Record<string, { label: string; tone: "slate" | "indigo" | "green" | "amber" | "red" }> = {
  pending_review: { label: "待审核", tone: "amber" },
  pending_confirm: { label: "待确认", tone: "indigo" },
  confirmed: { label: "已确认", tone: "green" },
  completed: { label: "已完成", tone: "slate" },
};

function makeKey() {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
}

/** 有符号元金额 → 整数分；空/非法/零返回 null。 */
function parseSignedYuan(value: string): number | null {
  const text = value.trim();
  if (!/^[+-]?(\d+(\.\d{0,2})?|\.\d{1,2})$/.test(text)) return null;
  const negative = text.startsWith("-");
  const magnitude = parseAdjustmentAmountYuan(text.replace(/^[+-]/, ""));
  if (magnitude === null) return null;
  const cents = negative ? -magnitude : magnitude;
  return cents === 0 ? null : cents;
}

export default function UserHrPage() {
  const [view, setView] = useState<"performance" | "base" | "payroll">("performance");
  const options = [
    { key: "performance" as const, label: "绩效" },
    { key: "base" as const, label: "人事" },
    { key: "payroll" as const, label: "工资条" },
  ];
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h1 className="mr-auto text-lg font-semibold">人事</h1>
        <div className="flex rounded-full bg-slate-200/70 p-0.5 text-xs">
          {options.map((opt) => (
            <button
              key={opt.key}
              type="button"
              onClick={() => setView(opt.key)}
              className={`rounded-full px-3 py-1 transition ${
                view === opt.key ? "bg-white font-medium text-indigo-600 shadow-sm" : "text-slate-500"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
      {view === "performance" ? <PerformanceSection /> : null}
      {view === "base" ? <BaseSalarySection /> : null}
      {view === "payroll" ? <HrPayroll /> : null}
    </div>
  );
}

// ==================== 绩效 ====================

type DraftItem = { key: string; name: string; amount: string };
type MemberDraft = { items: DraftItem[] };

function PerformanceSection() {
  const performance = useStaffPerformance(ROLE_CODE);
  const members = useStaffMembers(ROLE_CODE);
  const setPerformance = useSetStaffPerformance();

  const [sheetOpen, setSheetOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [draftDate, setDraftDate] = useState<string>(() => localToday());
  const [draftRegisteredBy, setDraftRegisteredBy] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, MemberDraft>>({});
  const [keyword, setKeyword] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);

  const records = useMemo(() => performance.data ?? [], [performance.data]);
  const memberById = useMemo(() => {
    const map = new Map<string, StaffMember>();
    for (const m of members.data ?? []) map.set(m.id, m);
    return map;
  }, [members.data]);

  const groups = useMemo(() => {
    const map = new Map<
      string,
      {
        key: string;
        registeredBy: string | null;
        registeredName: string | null;
        adjustDate: string;
        updatedAt: string;
        members: { profileId: string; profileName: string; items: StaffPerformanceRow[] }[];
      }
    >();
    for (const row of records) {
      const key = `${row.registeredBy ?? "none"}:${row.adjustDate}`;
      let group = map.get(key);
      if (!group) {
        group = {
          key,
          registeredBy: row.registeredBy,
          registeredName: row.registeredName,
          adjustDate: row.adjustDate,
          updatedAt: row.updatedAt,
          members: [],
        };
        map.set(key, group);
      }
      if (row.updatedAt > group.updatedAt) group.updatedAt = row.updatedAt;
      let member = group.members.find((m) => m.profileId === row.profileId);
      if (!member) {
        member = { profileId: row.profileId, profileName: row.profileName, items: [] };
        group.members.push(member);
      }
      member.items.push(row);
    }
    return [...map.values()].sort(
      (a, b) =>
        b.adjustDate.localeCompare(a.adjustDate) ||
        (a.registeredName ?? "").localeCompare(b.registeredName ?? "", "zh-CN"),
    );
  }, [records]);

  const pickable = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return (members.data ?? [])
      .filter((m) => !drafts[m.id])
      .filter((m) => (kw ? m.name.toLowerCase().includes(kw) : true));
  }, [members.data, drafts, keyword]);

  function openSheet(group?: (typeof groups)[number]) {
    const seeded: Record<string, MemberDraft> = {};
    if (group) {
      for (const row of records.filter(
        (r) => r.adjustDate === group.adjustDate && (r.registeredBy ?? null) === group.registeredBy,
      )) {
        const draft = (seeded[row.profileId] ??= { items: [] });
        draft.items.push({ key: makeKey(), name: row.name, amount: (row.amountCents / 100).toFixed(2) });
      }
    }
    setIsEditing(Boolean(group));
    setDraftDate(group?.adjustDate ?? localToday());
    setDraftRegisteredBy(group?.registeredBy ?? null);
    setDrafts(seeded);
    setKeyword("");
    setPickerOpen(false);
    setFeedback(null);
    setSheetOpen(true);
  }

  function addMember(member: StaffMember) {
    setDrafts((prev) => ({ ...prev, [member.id]: { items: [] } }));
    setPickerOpen(false);
    setKeyword("");
  }

  function removeMember(profileId: string) {
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[profileId];
      return next;
    });
  }

  function addItem(profileId: string, item: Omit<DraftItem, "key">) {
    setDrafts((prev) => ({
      ...prev,
      [profileId]: { items: [...prev[profileId].items, { key: makeKey(), ...item }] },
    }));
  }

  function patchItem(profileId: string, key: string, patch: Partial<Omit<DraftItem, "key">>) {
    setDrafts((prev) => ({
      ...prev,
      [profileId]: {
        items: prev[profileId].items.map((it) => (it.key === key ? { ...it, ...patch } : it)),
      },
    }));
  }

  function removeItem(profileId: string, key: string) {
    setDrafts((prev) => ({
      ...prev,
      [profileId]: { items: prev[profileId].items.filter((it) => it.key !== key) },
    }));
  }

  function submit() {
    const entries: { profileId: string; items: { name: string; amountCents: number }[] }[] = [];
    for (const [profileId, draft] of Object.entries(drafts)) {
      const items: { name: string; amountCents: number }[] = [];
      for (const item of draft.items) {
        const name = item.name.trim();
        const amount = item.amount.trim();
        if (!name && !amount) continue;
        if (!name) {
          setFeedback({ ok: false, message: "请填写绩效名称" });
          return;
        }
        const cents = parseSignedYuan(amount);
        if (cents === null) {
          setFeedback({ ok: false, message: `「${name}」金额不合法（最多两位小数，且不能为 0）` });
          return;
        }
        items.push({ name, amountCents: cents });
      }
      entries.push({ profileId, items });
    }
    setPerformance.mutate(
      { roleCode: ROLE_CODE, date: draftDate, entries, registeredBy: draftRegisteredBy ?? undefined },
      {
        onSuccess: () => setSheetOpen(false),
        onError: (err) =>
          setFeedback({ ok: false, message: err instanceof Error ? err.message : "保存失败，请稍后重试" }),
      },
    );
  }

  const draftList = Object.entries(drafts);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-400">按「提交人 + 日期」查看；点击卡片查看/编辑</p>
        <Button onClick={() => openSheet()} disabled={members.isLoading}>
          + 新增
        </Button>
      </div>

      {feedback && !feedback.ok ? <p className="text-xs text-red-600">{feedback.message}</p> : null}

      <QueryMessage loading={performance.isLoading} error={performance.error} empty={!groups.length} />

      <ul className="space-y-2">
        {groups.map((group) => (
          <li key={group.key}>
            <Card
              className="cursor-pointer px-4 py-3 transition hover:border-indigo-300"
              onClick={() => openSheet(group)}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {group.registeredName ?? "未知"} · {formatDate(group.adjustDate)}
                  </p>
                  <p className="truncate text-xs text-slate-400">
                    {group.members.length} 位成员 · 更新 {formatDateTime(group.updatedAt)}
                  </p>
                </div>
                <span className="shrink-0 text-xs text-indigo-600">查看 / 编辑</span>
              </div>
              <div className="mt-2 space-y-1">
                {group.members.map((member) => (
                  <div key={member.profileId} className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-xs text-slate-600">{member.profileName}</span>
                    {member.items.map((item) => (
                      <Badge key={item.id} tone={item.amountCents >= 0 ? "green" : "red"}>
                        {item.name} {item.amountCents >= 0 ? "+" : "-"}
                        {formatCentsToYuan(Math.abs(item.amountCents))}
                      </Badge>
                    ))}
                  </div>
                ))}
              </div>
            </Card>
          </li>
        ))}
      </ul>

      {sheetOpen ? (
        <div className="fixed inset-0 z-30 flex justify-center bg-slate-900/40">
          <div className="flex h-full w-full max-w-[430px] flex-col bg-slate-50">
            <header className="flex items-center justify-between border-b border-slate-200/70 bg-white px-4 pt-[calc(14px+env(safe-area-inset-top))] pb-3">
              <p className="text-sm font-semibold">{isEditing ? "编辑绩效" : "新增绩效"}</p>
              <button
                type="button"
                onClick={() => setSheetOpen(false)}
                className="rounded-full px-3 py-1 text-xs text-slate-500 hover:bg-slate-100"
              >
                关闭
              </button>
            </header>

            <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
              <label className="block text-xs text-slate-500">
                日期
                <input
                  type="date"
                  value={draftDate}
                  disabled={isEditing}
                  onChange={(event) => setDraftDate(event.target.value)}
                  className="mt-1 w-full rounded border px-2 py-1.5 text-sm disabled:bg-slate-100 disabled:text-slate-500"
                />
              </label>

              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400">已选 {draftList.length} 位成员</span>
                <button
                  type="button"
                  onClick={() => setPickerOpen((v) => !v)}
                  className="rounded border border-indigo-200 bg-white px-3 py-1 text-xs text-indigo-600"
                >
                  {pickerOpen ? "收起" : "+ 新增成员"}
                </button>
              </div>

              {pickerOpen ? (
                <div className="space-y-2 rounded border border-slate-200 bg-white p-2">
                  <input
                    type="search"
                    value={keyword}
                    placeholder="搜索成员姓名"
                    onChange={(event) => setKeyword(event.target.value)}
                    className="w-full rounded border px-2 py-1.5 text-sm"
                  />
                  <ul className="max-h-52 space-y-1 overflow-y-auto">
                    {pickable.map((member) => (
                      <li key={member.id}>
                        <button
                          type="button"
                          onClick={() => addMember(member)}
                          className="w-full rounded px-3 py-2 text-left text-sm hover:bg-indigo-50"
                        >
                          {member.name}
                        </button>
                      </li>
                    ))}
                    {!pickable.length ? (
                      <li className="py-4 text-center text-xs text-slate-400">没有可添加的成员</li>
                    ) : null}
                  </ul>
                </div>
              ) : null}

              <ul className="space-y-2">
                {draftList.map(([profileId, draft]) => (
                  <li key={profileId} className="rounded border border-slate-200 bg-white p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium">
                        {memberById.get(profileId)?.name ?? "成员"}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeMember(profileId)}
                        className="shrink-0 text-xs text-red-500"
                      >
                        移除
                      </button>
                    </div>
                    <div className="space-y-2">
                      {draft.items.map((item) => (
                        <div key={item.key} className="flex items-center gap-2">
                          <input
                            type="text"
                            maxLength={50}
                            value={item.name}
                            placeholder="名称"
                            onChange={(event) => patchItem(profileId, item.key, { name: event.target.value })}
                            className="min-w-0 flex-1 rounded border px-2 py-1 text-xs"
                          />
                          <input
                            type="text"
                            inputMode="decimal"
                            value={item.amount}
                            placeholder="金额（元）"
                            onChange={(event) => patchItem(profileId, item.key, { amount: event.target.value })}
                            className="w-24 shrink-0 rounded border px-2 py-1 text-xs"
                          />
                          <button
                            type="button"
                            onClick={() => removeItem(profileId, item.key)}
                            className="shrink-0 text-xs text-slate-400"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={() => addItem(profileId, { name: "", amount: "" })}
                        className="rounded border border-dashed border-slate-300 px-3 py-1 text-xs text-slate-500"
                      >
                        + 添加绩效
                      </button>
                    </div>
                  </li>
                ))}
                {!draftList.length ? (
                  <li className="py-6 text-center text-xs text-slate-400">
                    点击「+ 新增成员」选择成员后添加绩效
                  </li>
                ) : null}
              </ul>
            </div>

            <div className="border-t border-slate-200/70 bg-white px-4 py-3 pb-[calc(12px+env(safe-area-inset-bottom))]">
              {feedback && !feedback.ok ? (
                <p className="mb-2 text-xs text-red-600">{feedback.message}</p>
              ) : null}
              <Button className="w-full" disabled={setPerformance.isPending} onClick={submit}>
                {setPerformance.isPending ? "提交中…" : "保存"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ==================== 人事（基础薪资） ====================

function BaseSalarySection() {
  const members = useStaffMembers(ROLE_CODE);
  const update = useSetStaffBaseIncome();
  const [editing, setEditing] = useState<{ id: string; name: string; value: string } | null>(null);
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);

  async function save() {
    if (!editing) return;
    const cents = parseAdjustmentAmountYuan(editing.value.trim() || "0");
    if (cents === null) {
      setFeedback({ ok: false, message: "基础薪资须为非负且最多两位小数" });
      return;
    }
    try {
      await update.mutateAsync({ profileId: editing.id, roleCode: ROLE_CODE, baseIncomeInCents: cents });
      setEditing(null);
      setFeedback({ ok: true, message: "已保存" });
    } catch (err) {
      setFeedback({ ok: false, message: err instanceof Error ? err.message : "保存失败，请稍后重试" });
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-400">设置各位人事成员的基础薪资；生成工资条时会快照该值。</p>
      {feedback ? (
        <p className={`text-xs ${feedback.ok ? "text-emerald-600" : "text-red-600"}`}>{feedback.message}</p>
      ) : null}
      <QueryMessage loading={members.isLoading} error={members.error} empty={!members.data?.length} />
      <ul className="space-y-2">
        {(members.data ?? []).map((member) => (
          <li key={member.id}>
            <Card className="flex items-center justify-between px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{member.name}</p>
                <p className="text-xs text-slate-400">基础薪资 {formatCentsToYuan(member.baseIncomeCents)}</p>
              </div>
              <button
                type="button"
                onClick={() =>
                  setEditing({ id: member.id, name: member.name, value: (member.baseIncomeCents / 100).toFixed(2) })
                }
                className="shrink-0 text-xs text-indigo-600"
              >
                编辑
              </button>
            </Card>
          </li>
        ))}
      </ul>

      {editing ? (
        <div className="fixed inset-0 z-30 flex items-end justify-center bg-slate-900/40">
          <div className="w-full max-w-[430px] rounded-t-2xl bg-white p-4 pb-[calc(16px+env(safe-area-inset-bottom))]">
            <p className="mb-3 text-sm font-semibold">设置基础薪资 · {editing.name}</p>
            <label className="block text-xs text-slate-500">
              基础薪资（元）
              <input
                type="text"
                inputMode="decimal"
                value={editing.value}
                onChange={(event) => setEditing({ ...editing, value: event.target.value })}
                className="mt-1 w-full rounded border px-2 py-1.5 text-sm"
              />
            </label>
            {feedback && !feedback.ok ? (
              <p className="mt-2 text-xs text-red-600">{feedback.message}</p>
            ) : null}
            <div className="mt-3 flex gap-2">
              <Button
                className="flex-1"
                disabled={update.isPending}
                onClick={() => {
                  setFeedback(null);
                  save();
                }}
              >
                {update.isPending ? "保存中…" : "保存"}
              </Button>
              <Button variant="ghost" className="flex-1" onClick={() => setEditing(null)}>
                取消
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ==================== 工资条 ====================

type DraftRow = { penalty: string; reward: string; tax: string; note: string };

function HrPayroll() {
  const roles = useRoles();
  const members = useStaffMembers(ROLE_CODE);
  const salary = useStaffSalaryRecords();
  const create = useCreateStaffSalaryRecords();

  const [period, setPeriod] = useState<PeriodRange>(() => getPresetRange("thisMonth"));
  const [drafts, setDrafts] = useState<Record<string, Partial<DraftRow>>>({});
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);

  const roleId = useMemo(() => (roles.data ?? []).find((r) => r.code === ROLE_CODE)?.id, [roles.data]);

  function changePeriod(field: "start" | "end", value: string) {
    setPeriod((p) => ({ ...p, [field]: value }));
    setDrafts({});
    setFeedback(null);
  }

  const performance = useStaffPerformance(ROLE_CODE, { start: period.start, end: period.end });

  const summary = useMemo(() => {
    const map = new Map<string, { penaltyCents: number; rewardCents: number }>();
    for (const row of performance.data ?? []) {
      const item = map.get(row.profileId) ?? { penaltyCents: 0, rewardCents: 0 };
      if (row.amountCents < 0) item.penaltyCents += -row.amountCents;
      else item.rewardCents += row.amountCents;
      map.set(row.profileId, item);
    }
    return map;
  }, [performance.data]);

  const memberById = useMemo(() => {
    const map = new Map<string, StaffMember>();
    for (const m of members.data ?? []) map.set(m.id, m);
    return map;
  }, [members.data]);

  function yuan(cents: number): string {
    return (cents / 100).toFixed(2);
  }

  function valueOf(profileId: string, field: keyof DraftRow): string {
    const draft = drafts[profileId];
    if (draft && draft[field] !== undefined) return draft[field]!;
    const item = summary.get(profileId);
    if (field === "penalty") return item ? yuan(item.penaltyCents) : "0.00";
    if (field === "reward") return item ? yuan(item.rewardCents) : "0.00";
    return "";
  }

  function setField(profileId: string, field: keyof DraftRow, value: string) {
    setDrafts((prev) => ({ ...prev, [profileId]: { ...prev[profileId], [field]: value } }));
  }

  async function submit() {
    setFeedback(null);
    if (!roleId) {
      setFeedback({ ok: false, message: "未找到「人事」角色" });
      return;
    }
    if (period.start > period.end) {
      setFeedback({ ok: false, message: "起止日期无效" });
      return;
    }
    const list = members.data ?? [];
    if (!list.length) {
      setFeedback({ ok: false, message: "没有在职的人事成员" });
      return;
    }
    const records = [];
    for (const member of list) {
      const penalty = parseAdjustmentAmountYuan(valueOf(member.id, "penalty").trim() || "0");
      const reward = parseAdjustmentAmountYuan(valueOf(member.id, "reward").trim() || "0");
      const tax = parseAdjustmentAmountYuan(valueOf(member.id, "tax").trim() || "0");
      if (penalty === null || reward === null || tax === null) {
        setFeedback({ ok: false, message: `「${member.name}」金额须为非负且最多两位小数` });
        return;
      }
      records.push({
        profileId: member.id,
        roleId,
        penaltyCents: -penalty,
        rewardCents: reward,
        taxCents: tax,
        note: valueOf(member.id, "note"),
      });
    }
    try {
      await create.mutateAsync({ period, records });
      setDrafts({});
      setFeedback({ ok: true, message: `已生成/覆盖 ${records.length} 条人事工资条（待审核）` });
    } catch (err) {
      setFeedback({ ok: false, message: err instanceof Error ? err.message : "生成失败，请稍后重试" });
    }
  }

  const hrRecords = useMemo(
    () => (salary.data ?? []).filter((item) => item.role?.code === ROLE_CODE),
    [salary.data],
  );

  return (
    <div className="space-y-3">
      {feedback ? (
        <p className={`text-xs ${feedback.ok ? "text-emerald-600" : "text-red-600"}`}>{feedback.message}</p>
      ) : null}

      <Card className="space-y-3 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">周期</span>
          <input
            type="date"
            value={period.start}
            onChange={(event) => changePeriod("start", event.target.value)}
            className="rounded border px-2 py-1 text-xs"
          />
          <span className="text-xs text-slate-400">~</span>
          <input
            type="date"
            value={period.end}
            onChange={(event) => changePeriod("end", event.target.value)}
            className="rounded border px-2 py-1 text-xs"
          />
        </div>
        <p className="text-xs text-slate-400">
          已按周期内「绩效」自动汇总总违约/总奖励，可手动修改后生成。
        </p>
      </Card>

      <QueryMessage
        loading={members.isLoading || performance.isLoading}
        error={members.error || performance.error}
        empty={!members.data?.length}
      />

      <ul className="space-y-2">
        {(members.data ?? []).map((member) => {
          const item = summary.get(member.id);
          return (
            <li key={member.id}>
              <Card className="space-y-2 px-4 py-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{member.name}</span>
                  <span className="text-xs text-slate-400">
                    基础薪资 {formatCentsToYuan(member.baseIncomeCents)}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-xs text-slate-500">
                    总违约（元）
                    <input
                      type="text"
                      inputMode="decimal"
                      value={valueOf(member.id, "penalty")}
                      onChange={(event) => setField(member.id, "penalty", event.target.value)}
                      className="mt-1 w-full rounded border px-2 py-1 text-xs"
                    />
                  </label>
                  <label className="text-xs text-slate-500">
                    总奖励（元）
                    <input
                      type="text"
                      inputMode="decimal"
                      value={valueOf(member.id, "reward")}
                      onChange={(event) => setField(member.id, "reward", event.target.value)}
                      className="mt-1 w-full rounded border px-2 py-1 text-xs"
                    />
                  </label>
                  <label className="text-xs text-slate-500">
                    个税（元）
                    <input
                      type="text"
                      inputMode="decimal"
                      value={valueOf(member.id, "tax")}
                      placeholder="0.00"
                      onChange={(event) => setField(member.id, "tax", event.target.value)}
                      className="mt-1 w-full rounded border px-2 py-1 text-xs"
                    />
                  </label>
                  <label className="text-xs text-slate-500">
                    备注
                    <input
                      type="text"
                      maxLength={200}
                      value={valueOf(member.id, "note")}
                      onChange={(event) => setField(member.id, "note", event.target.value)}
                      className="mt-1 w-full rounded border px-2 py-1 text-xs"
                    />
                  </label>
                </div>
                {item ? (
                  <p className="text-xs text-slate-400">
                    自动汇总：违约 {formatCentsToYuan(-item.penaltyCents)} · 奖励 {formatCentsToYuan(item.rewardCents)}
                  </p>
                ) : null}
              </Card>
            </li>
          );
        })}
      </ul>

      <Button className="w-full" disabled={create.isPending} onClick={submit}>
        {create.isPending ? "生成中…" : "生成人事工资条"}
      </Button>

      <div className="pt-1">
        <p className="mb-2 text-xs text-slate-500">已生成的人事工资条</p>
        <QueryMessage loading={salary.isLoading} error={salary.error} empty={!hrRecords.length} />
        <ul className="space-y-2">
          {hrRecords.map((record) => {
            const status = STATUS_LABELS[record.status] ?? { label: record.status, tone: "slate" as const };
            return (
              <li key={record.id}>
                <Card className="px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">
                      {record.profile?.name ?? memberById.get(record.profile_id)?.name ?? "成员"}
                    </span>
                    <Badge tone={status.tone}>{status.label}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-slate-400">
                    {record.period_start} ~ {record.period_end} · 到手 {formatCentsToYuan(record.net_cents)}
                  </p>
                </Card>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
