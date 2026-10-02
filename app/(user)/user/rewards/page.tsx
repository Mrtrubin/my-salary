"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { QueryMessage } from "@/components/query-message";
import {
  useAnchorMembers,
  useAnchorRewards,
  useDeleteAnchorReward,
  useSetAnchorRewards,
  useUpdateAnchorReward,
} from "@/lib/api/hooks";
import type { AnchorRewardRow } from "@/lib/api/data";
import { parseAdjustmentAmountYuan } from "@/lib/domain/payroll/adjustment";
import { localToday } from "@/lib/domain/settlement/cycle";
import { formatCentsToYuan, formatDateTime } from "@/lib/format";

/**
 * 舞蹈老师「奖励」页：
 *  - 顶部「设置奖励」：日期 + 搜索多选主播 + 奖励名称 + 金额（元）+ 备注 → 批量登记（登记人为当前舞蹈老师）。
 *  - 主体默认展示「最近一次奖励登记日期」的记录；可改名称/金额/备注或删除。
 */
export default function UserRewardsPage() {
  const rewards = useAnchorRewards();
  const anchors = useAnchorMembers();
  const setRewards = useSetAnchorRewards();
  const updateReward = useUpdateAnchorReward();
  const deleteReward = useDeleteAnchorReward();

  const [pickedDate, setPickedDate] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [draftDate, setDraftDate] = useState<string>(() => localToday());
  const [keyword, setKeyword] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [draftName, setDraftName] = useState("奖励");
  const [draftAmount, setDraftAmount] = useState("");
  const [draftNote, setDraftNote] = useState("");
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editAmount, setEditAmount] = useState("");
  const [editNote, setEditNote] = useState("");

  const records = useMemo(() => rewards.data ?? [], [rewards.data]);

  // 默认日期：最近一次奖励登记日期；无记录则今天。
  const latestDate = useMemo(() => {
    const dates = records.map((r) => r.rewardDate).sort();
    return dates[dates.length - 1] ?? localToday();
  }, [records]);

  const viewDate = pickedDate ?? latestDate;
  const dayRecords = useMemo(
    () =>
      records
        .filter((r) => r.rewardDate === viewDate)
        .sort(
          (a, b) =>
            a.anchorName.localeCompare(b.anchorName, "zh-CN") ||
            a.name.localeCompare(b.name, "zh-CN"),
        ),
    [records, viewDate],
  );

  const filteredAnchors = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    const list = anchors.data ?? [];
    if (!kw) return list;
    return list.filter((a) => a.name.toLowerCase().includes(kw));
  }, [anchors.data, keyword]);

  const parsedDraftAmount = parseAdjustmentAmountYuan(draftAmount);
  const draftAmountValid = parsedDraftAmount !== null && parsedDraftAmount > 0;

  function openSheet() {
    setDraftDate(viewDate);
    setKeyword("");
    setSelectedIds(new Set());
    setDraftName("奖励");
    setDraftAmount("");
    setDraftNote("");
    setFeedback(null);
    setSheetOpen(true);
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function submitSetRewards() {
    if (!selectedIds.size) {
      setFeedback({ ok: false, message: "请至少选择一位主播" });
      return;
    }
    if (!draftName.trim()) {
      setFeedback({ ok: false, message: "请填写奖励名称" });
      return;
    }
    if (parsedDraftAmount === null || parsedDraftAmount <= 0) {
      setFeedback({ ok: false, message: "奖励金额必须大于 0，最多两位小数" });
      return;
    }
    setRewards.mutate(
      {
        date: draftDate,
        anchorIds: [...selectedIds],
        name: draftName.trim(),
        amountCents: parsedDraftAmount,
        note: draftNote,
      },
      {
        onSuccess: () => {
          setFeedback({ ok: true, message: `已登记 ${selectedIds.size} 位主播奖励` });
          setSheetOpen(false);
          setPickedDate(draftDate);
        },
        onError: (err) =>
          setFeedback({ ok: false, message: err instanceof Error ? err.message : "登记失败，请稍后重试" }),
      },
    );
  }

  function startEdit(record: AnchorRewardRow) {
    setEditingId(record.id);
    setEditName(record.name);
    setEditAmount((record.amountCents / 100).toFixed(2));
    setEditNote(record.note ?? "");
  }

  function saveEdit(record: AnchorRewardRow) {
    const amount = parseAdjustmentAmountYuan(editAmount);
    if (!editName.trim()) {
      setFeedback({ ok: false, message: "请填写奖励名称" });
      return;
    }
    if (amount === null || amount <= 0) {
      setFeedback({ ok: false, message: "奖励金额必须大于 0，最多两位小数" });
      return;
    }
    setFeedback(null);
    updateReward.mutate(
      { id: record.id, name: editName.trim(), amountCents: amount, note: editNote },
      {
        onSuccess: () => setEditingId(null),
        onError: (err) =>
          setFeedback({ ok: false, message: err instanceof Error ? err.message : "保存失败，请稍后重试" }),
      },
    );
  }

  function removeReward(record: AnchorRewardRow) {
    setFeedback(null);
    deleteReward.mutate(record.id, {
      onError: (err) =>
        setFeedback({ ok: false, message: err instanceof Error ? err.message : "删除失败，请稍后重试" }),
    });
  }

  const busy = setRewards.isPending || updateReward.isPending || deleteReward.isPending;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">奖励</h1>
        <Button onClick={openSheet} disabled={anchors.isLoading}>
          + 设置奖励
        </Button>
      </div>

      <div className="flex items-center gap-3">
        <label className="shrink-0 text-xs text-slate-500" htmlFor="reward-view-date">
          查看日期
        </label>
        <input
          id="reward-view-date"
          type="date"
          value={viewDate}
          onChange={(event) => setPickedDate(event.target.value || null)}
          className="rounded border px-2 py-1 text-sm"
        />
      </div>

      {feedback && !feedback.ok ? <p className="text-xs text-red-600">{feedback.message}</p> : null}

      <QueryMessage loading={rewards.isLoading} error={rewards.error} empty={!dayRecords.length} />

      <ul className="space-y-2">
        {dayRecords.map((record) => (
          <li key={record.id}>
            <Card className="px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <p className="truncate text-sm font-medium">{record.anchorName}</p>
                  <p className="truncate text-xs text-slate-400">
                    登记：{record.registeredName ?? "未知"}
                    <span className="ml-2">{formatDateTime(record.updatedAt)}</span>
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge tone="green">+{formatCentsToYuan(record.amountCents)}</Badge>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => startEdit(record)}
                    className="text-xs text-indigo-600 disabled:opacity-50"
                  >
                    编辑
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => removeReward(record)}
                    className="text-xs text-red-500 disabled:opacity-50"
                  >
                    删除
                  </button>
                </div>
              </div>

              {editingId === record.id ? (
                <div className="mt-2 space-y-2">
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      maxLength={50}
                      value={editName}
                      placeholder="奖励名称"
                      onChange={(event) => setEditName(event.target.value)}
                      className="min-w-0 flex-1 rounded border px-2 py-1 text-xs"
                    />
                    <input
                      type="text"
                      inputMode="decimal"
                      value={editAmount}
                      placeholder="金额（元）"
                      onChange={(event) => setEditAmount(event.target.value)}
                      className="w-24 shrink-0 rounded border px-2 py-1 text-xs"
                    />
                  </div>
                  <input
                    type="text"
                    maxLength={200}
                    value={editNote}
                    placeholder="备注（可空）"
                    onChange={(event) => setEditNote(event.target.value)}
                    className="w-full rounded border px-2 py-1 text-xs"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => saveEdit(record)}
                      className="text-xs text-indigo-600 disabled:opacity-50"
                    >
                      保存
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      className="text-xs text-slate-400"
                    >
                      取消
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-2 flex items-center justify-between gap-2 text-xs text-slate-500">
                  <span className="min-w-0 truncate">
                    {record.name}
                    {record.note ? ` · 备注：${record.note}` : ""}
                  </span>
                </div>
              )}
            </Card>
          </li>
        ))}
      </ul>

      {sheetOpen ? (
        <div className="fixed inset-0 z-30 flex justify-center bg-slate-900/40">
          <div className="flex h-full w-full max-w-[430px] flex-col bg-slate-50">
            <header className="flex items-center justify-between border-b border-slate-200/70 bg-white px-4 pt-[calc(14px+env(safe-area-inset-top))] pb-3">
              <p className="text-sm font-semibold">设置奖励</p>
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
                  onChange={(event) => setDraftDate(event.target.value)}
                  className="mt-1 w-full rounded border px-2 py-1.5 text-sm"
                />
              </label>

              <div className="flex gap-3">
                <label className="block flex-1 text-xs text-slate-500">
                  奖励名称
                  <input
                    type="text"
                    maxLength={50}
                    value={draftName}
                    placeholder="如：奖励"
                    onChange={(event) => setDraftName(event.target.value)}
                    className="mt-1 w-full rounded border px-2 py-1.5 text-sm"
                  />
                </label>
                <label className="block w-28 shrink-0 text-xs text-slate-500">
                  金额（元）
                  <input
                    type="text"
                    inputMode="decimal"
                    value={draftAmount}
                    placeholder="0.00"
                    onChange={(event) => setDraftAmount(event.target.value)}
                    className="mt-1 w-full rounded border px-2 py-1.5 text-sm"
                  />
                </label>
              </div>

              <label className="block text-xs text-slate-500">
                搜索主播
                <input
                  type="search"
                  value={keyword}
                  placeholder="输入主播姓名"
                  onChange={(event) => setKeyword(event.target.value)}
                  className="mt-1 w-full rounded border px-2 py-1.5 text-sm"
                />
              </label>

              <label className="block text-xs text-slate-500">
                备注（可空，应用到本次所选主播）
                <input
                  type="text"
                  maxLength={200}
                  value={draftNote}
                  placeholder="选填"
                  onChange={(event) => setDraftNote(event.target.value)}
                  className="mt-1 w-full rounded border px-2 py-1.5 text-sm"
                />
              </label>

              <p className="text-xs text-slate-400">已选 {selectedIds.size} 位 · 勾选后点击「登记奖励」</p>

              <ul className="space-y-1">
                {filteredAnchors.map((anchor) => {
                  const active = selectedIds.has(anchor.id);
                  return (
                    <li key={anchor.id}>
                      <button
                        type="button"
                        onClick={() => toggleSelect(anchor.id)}
                        className={`flex w-full items-center justify-between rounded border px-3 py-2 text-left text-sm ${
                          active ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "bg-white"
                        }`}
                      >
                        <span className="truncate">{anchor.name}</span>
                        <span aria-hidden="true">{active ? "✓" : ""}</span>
                      </button>
                    </li>
                  );
                })}
                {!filteredAnchors.length ? (
                  <li className="py-6 text-center text-xs text-slate-400">没有匹配的主播</li>
                ) : null}
              </ul>
            </div>

            <div className="border-t border-slate-200/70 bg-white px-4 py-3 pb-[calc(12px+env(safe-area-inset-bottom))]">
              {feedback && !feedback.ok ? (
                <p className="mb-2 text-xs text-red-600">{feedback.message}</p>
              ) : null}
              <Button
                className="w-full"
                disabled={busy || !selectedIds.size || !draftAmountValid}
                onClick={submitSetRewards}
              >
                {setRewards.isPending ? "提交中…" : `登记奖励（${selectedIds.size}）`}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
