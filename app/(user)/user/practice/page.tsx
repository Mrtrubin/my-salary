"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { QueryMessage } from "@/components/query-message";
import {
  useAnchorAdjustments,
  useAnchorMembers,
  useSetDanceAdjustments,
} from "@/lib/api/hooks";
import type { AnchorAdjustmentRow, AnchorMember, DanceAdjustmentItemInput } from "@/lib/api/data";
import { delayDeductionCents, parseAdjustmentAmountYuan } from "@/lib/domain/payroll/adjustment";
import { localToday } from "@/lib/domain/settlement/cycle";
import { formatCentsToYuan, formatDate, formatDateTime } from "@/lib/format";

const SUBSIDY_NAME = "补助";
const DELAY_NAME = "延误";

/** 编辑弹窗中单条调整项草稿。 */
type DraftItem = { key: string; name: string; amount: string };
type AnchorDraft = { items: DraftItem[] };

/** 一张卡片 = 一位提交人的某一天记录。 */
type SubmitGroup = {
  key: string;
  registeredBy: string | null;
  registeredName: string | null;
  adjustDate: string;
  anchors: { anchorId: string; anchorName: string; items: AnchorAdjustmentRow[] }[];
  updatedAt: string;
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

/**
 * 舞蹈老师「练舞」页：
 *  - 主体：按「提交人 + 日期」聚合为一张卡片；点击卡片可查看/编辑当天记录。
 *  - 右上角「新增」：打开弹窗为某天逐条设置调整项（任意命名，含快捷「补助」「延误」，
 *    参考主持上传的调整项）。补助默认 100 元，延误默认 保底/260。
 */
export default function UserPracticePage() {
  const adjustments = useAnchorAdjustments("dance");
  const anchors = useAnchorMembers();
  const setAdjustments = useSetDanceAdjustments();

  const [sheetOpen, setSheetOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [draftDate, setDraftDate] = useState<string>(() => localToday());
  const [draftRegisteredBy, setDraftRegisteredBy] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, AnchorDraft>>({});
  const [keyword, setKeyword] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);

  const records = useMemo(() => adjustments.data ?? [], [adjustments.data]);
  const memberById = useMemo(() => {
    const map = new Map<string, AnchorMember>();
    for (const a of anchors.data ?? []) map.set(a.id, a);
    return map;
  }, [anchors.data]);

  // 按「提交人 + 日期」聚合为卡片。
  const groups = useMemo<SubmitGroup[]>(() => {
    const map = new Map<string, SubmitGroup>();
    for (const row of records) {
      const key = `${row.registeredBy ?? "none"}:${row.adjustDate}`;
      let group = map.get(key);
      if (!group) {
        group = {
          key,
          registeredBy: row.registeredBy,
          registeredName: row.registeredName,
          adjustDate: row.adjustDate,
          anchors: [],
          updatedAt: row.updatedAt,
        };
        map.set(key, group);
      }
      if (row.updatedAt > group.updatedAt) group.updatedAt = row.updatedAt;
      let anchor = group.anchors.find((a) => a.anchorId === row.anchorProfileId);
      if (!anchor) {
        anchor = { anchorId: row.anchorProfileId, anchorName: row.anchorName, items: [] };
        group.anchors.push(anchor);
      }
      anchor.items.push(row);
    }
    return [...map.values()].sort(
      (a, b) =>
        b.adjustDate.localeCompare(a.adjustDate) ||
        (a.registeredName ?? "").localeCompare(b.registeredName ?? "", "zh-CN"),
    );
  }, [records]);

  const pickableAnchors = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return (anchors.data ?? [])
      .filter((a) => !drafts[a.id])
      .filter((a) => (kw ? a.name.toLowerCase().includes(kw) : true));
  }, [anchors.data, drafts, keyword]);

  function defaultDelayYuan(anchorId: string): string {
    const base = memberById.get(anchorId)?.baseSalaryCents ?? 0;
    return (delayDeductionCents(base) / 100).toFixed(2);
  }

  /** 打开弹窗：编辑某张卡片（registeredBy + date），或新增。 */
  function openSheet(group?: SubmitGroup) {
    const seeded: Record<string, AnchorDraft> = {};
    if (group) {
      for (const row of records.filter(
        (r) => r.adjustDate === group.adjustDate && (r.registeredBy ?? null) === group.registeredBy,
      )) {
        const draft = (seeded[row.anchorProfileId] ??= { items: [] });
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

  function addAnchor(anchor: AnchorMember) {
    setDrafts((prev) => ({ ...prev, [anchor.id]: { items: [] } }));
    setPickerOpen(false);
    setKeyword("");
  }

  function removeAnchor(anchorId: string) {
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[anchorId];
      return next;
    });
  }

  function addItem(anchorId: string, item: Omit<DraftItem, "key">) {
    setDrafts((prev) => ({
      ...prev,
      [anchorId]: { items: [...prev[anchorId].items, { key: makeKey(), ...item }] },
    }));
  }

  function patchItem(anchorId: string, key: string, patch: Partial<Omit<DraftItem, "key">>) {
    setDrafts((prev) => ({
      ...prev,
      [anchorId]: {
        items: prev[anchorId].items.map((it) => (it.key === key ? { ...it, ...patch } : it)),
      },
    }));
  }

  function removeItem(anchorId: string, key: string) {
    setDrafts((prev) => ({
      ...prev,
      [anchorId]: { items: prev[anchorId].items.filter((it) => it.key !== key) },
    }));
  }

  function submit() {
    const entries: { anchorId: string; items: DanceAdjustmentItemInput[] }[] = [];
    for (const [anchorId, draft] of Object.entries(drafts)) {
      const items: DanceAdjustmentItemInput[] = [];
      for (const item of draft.items) {
        const name = item.name.trim();
        const amount = item.amount.trim();
        if (!name && !amount) continue;
        if (!name) {
          setFeedback({ ok: false, message: "请填写调整项名称" });
          return;
        }
        const cents = parseSignedYuan(amount);
        if (cents === null) {
          setFeedback({ ok: false, message: `「${name}」金额不合法（最多两位小数，且不能为 0）` });
          return;
        }
        items.push({ name, amountCents: cents });
      }
      entries.push({ anchorId, items });
    }
    setAdjustments.mutate(
      { date: draftDate, entries, registeredBy: draftRegisteredBy ?? undefined },
      {
        onSuccess: () => {
          setFeedback({ ok: true, message: "已保存" });
          setSheetOpen(false);
        },
        onError: (err) =>
          setFeedback({ ok: false, message: err instanceof Error ? err.message : "保存失败，请稍后重试" }),
      },
    );
  }

  const draftList = Object.entries(drafts);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">练舞</h1>
        <Button onClick={() => openSheet()} disabled={anchors.isLoading}>
          + 新增
        </Button>
      </div>

      {feedback && !feedback.ok ? <p className="text-xs text-red-600">{feedback.message}</p> : null}

      <QueryMessage loading={adjustments.isLoading} error={adjustments.error} empty={!groups.length} />

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
                    {group.anchors.length} 位主播 · 更新 {formatDateTime(group.updatedAt)}
                  </p>
                </div>
                <span className="shrink-0 text-xs text-indigo-600">查看 / 编辑</span>
              </div>

              <div className="mt-2 space-y-1">
                {group.anchors.map((anchor) => (
                  <div key={anchor.anchorId} className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-xs text-slate-600">{anchor.anchorName}</span>
                    {anchor.items.map((item) => (
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
              <p className="text-sm font-semibold">{isEditing ? "编辑练舞" : "新增练舞"}</p>
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
              {isEditing ? (
                <p className="-mt-2 text-xs text-slate-400">
                  提交人：{groupName(records, draftRegisteredBy)}（编辑不改变提交人）
                </p>
              ) : null}

              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400">已选 {draftList.length} 位主播</span>
                <button
                  type="button"
                  onClick={() => setPickerOpen((v) => !v)}
                  className="rounded border border-indigo-200 bg-white px-3 py-1 text-xs text-indigo-600"
                >
                  {pickerOpen ? "收起" : "+ 新增主播"}
                </button>
              </div>

              {pickerOpen ? (
                <div className="space-y-2 rounded border border-slate-200 bg-white p-2">
                  <input
                    type="search"
                    value={keyword}
                    placeholder="搜索主播姓名"
                    onChange={(event) => setKeyword(event.target.value)}
                    className="w-full rounded border px-2 py-1.5 text-sm"
                  />
                  <ul className="max-h-52 space-y-1 overflow-y-auto">
                    {pickableAnchors.map((anchor) => (
                      <li key={anchor.id}>
                        <button
                          type="button"
                          onClick={() => addAnchor(anchor)}
                          className="w-full rounded px-3 py-2 text-left text-sm hover:bg-indigo-50"
                        >
                          {anchor.name}
                        </button>
                      </li>
                    ))}
                    {!pickableAnchors.length ? (
                      <li className="py-4 text-center text-xs text-slate-400">没有可添加的主播</li>
                    ) : null}
                  </ul>
                </div>
              ) : null}

              <ul className="space-y-2">
                {draftList.map(([anchorId, draft]) => {
                  const name = memberById.get(anchorId)?.name ?? "主播";
                  return (
                    <li key={anchorId} className="rounded border border-slate-200 bg-white p-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium">{name}</span>
                        <button
                          type="button"
                          onClick={() => removeAnchor(anchorId)}
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
                              onChange={(event) => patchItem(anchorId, item.key, { name: event.target.value })}
                              className="min-w-0 flex-1 rounded border px-2 py-1 text-xs"
                            />
                            <input
                              type="text"
                              inputMode="decimal"
                              value={item.amount}
                              placeholder="金额（元）"
                              onChange={(event) => patchItem(anchorId, item.key, { amount: event.target.value })}
                              className="w-24 shrink-0 rounded border px-2 py-1 text-xs"
                            />
                            <button
                              type="button"
                              onClick={() => removeItem(anchorId, item.key)}
                              className="shrink-0 text-xs text-slate-400"
                            >
                              ×
                            </button>
                          </div>
                        ))}

                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => addItem(anchorId, { name: SUBSIDY_NAME, amount: "100" })}
                            className="rounded border border-dashed border-slate-300 px-2 py-1 text-xs text-slate-500"
                          >
                            + 补助（100）
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              addItem(anchorId, { name: DELAY_NAME, amount: `-${defaultDelayYuan(anchorId)}` })
                            }
                            className="rounded border border-dashed border-slate-300 px-2 py-1 text-xs text-slate-500"
                          >
                            + 延误（{defaultDelayYuan(anchorId)}）
                          </button>
                          <button
                            type="button"
                            onClick={() => addItem(anchorId, { name: "", amount: "" })}
                            className="rounded border border-dashed border-slate-300 px-3 py-1 text-xs text-slate-500"
                          >
                            + 自定义
                          </button>
                        </div>
                      </div>
                    </li>
                  );
                })}
                {!draftList.length ? (
                  <li className="py-6 text-center text-xs text-slate-400">
                    点击「+ 新增主播」选择主播后添加调整项
                  </li>
                ) : null}
              </ul>
            </div>

            <div className="border-t border-slate-200/70 bg-white px-4 py-3 pb-[calc(12px+env(safe-area-inset-bottom))]">
              {feedback && !feedback.ok ? (
                <p className="mb-2 text-xs text-red-600">{feedback.message}</p>
              ) : null}
              <Button className="w-full" disabled={setAdjustments.isPending} onClick={submit}>
                {setAdjustments.isPending ? "提交中…" : "保存"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function groupName(records: AnchorAdjustmentRow[], registeredBy: string | null): string {
  const found = records.find((r) => (r.registeredBy ?? null) === registeredBy);
  return found?.registeredName ?? "未知";
}
