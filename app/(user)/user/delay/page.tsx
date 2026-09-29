"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { QueryMessage } from "@/components/query-message";
import { useAnchorDelays, useAnchorMembers, useSetAnchorDelays } from "@/lib/api/hooks";
import type { AnchorDelayRow } from "@/lib/api/data";
import { localToday } from "@/lib/domain/settlement/cycle";
import { formatDateTime } from "@/lib/format";

/**
 * 化妆师「延误」页：
 *  - 顶部「设置延误」：输入日期 + 搜索多选主播 → 批量标记为延误（登记人为当前化妆师）。
 *  - 主体默认展示「最新一次设置延误所选日期」的延误记录；可改状态（延误↔非延误）。
 */
export default function UserDelayPage() {
  const delays = useAnchorDelays();
  const anchors = useAnchorMembers();
  const setDelays = useSetAnchorDelays();

  const [pickedDate, setPickedDate] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [draftDate, setDraftDate] = useState<string>(() => localToday());
  const [keyword, setKeyword] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [draftNote, setDraftNote] = useState("");
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingNoteValue, setEditingNoteValue] = useState("");

  const records = useMemo(() => delays.data ?? [], [delays.data]);

  // 默认日期：最近一次「延误」记录的日期；无记录则今天。
  const latestDate = useMemo(() => {
    const delayed = records.filter((r) => r.isDelayed).map((r) => r.delayDate).sort();
    return delayed[delayed.length - 1] ?? localToday();
  }, [records]);

  const viewDate = pickedDate ?? latestDate;
  const dayRecords = useMemo(
    () =>
      records
        .filter((r) => r.delayDate === viewDate)
        .sort((a, b) => a.anchorName.localeCompare(b.anchorName, "zh-CN")),
    [records, viewDate],
  );

  const filteredAnchors = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    const list = anchors.data ?? [];
    if (!kw) return list;
    return list.filter((a) => a.name.toLowerCase().includes(kw));
  }, [anchors.data, keyword]);

  function openSheet() {
    setDraftDate(viewDate);
    setKeyword("");
    setSelectedIds(new Set());
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

  function submitSetDelays() {
    if (!selectedIds.size) {
      setFeedback({ ok: false, message: "请至少选择一位主播" });
      return;
    }
    setDelays.mutate(
      { date: draftDate, anchorIds: [...selectedIds], isDelayed: true, note: draftNote },
      {
        onSuccess: () => {
          setFeedback({ ok: true, message: `已标记 ${selectedIds.size} 位主播延误` });
          setSheetOpen(false);
          setPickedDate(draftDate);
        },
        onError: (err) =>
          setFeedback({ ok: false, message: err instanceof Error ? err.message : "设置失败，请稍后重试" }),
      },
    );
  }

  function toggleStatus(record: AnchorDelayRow) {
    setFeedback(null);
    setDelays.mutate(
      { date: record.delayDate, anchorIds: [record.anchorProfileId], isDelayed: !record.isDelayed, note: record.note ?? "" },
      {
        onError: (err) =>
          setFeedback({ ok: false, message: err instanceof Error ? err.message : "修改失败，请稍后重试" }),
      },
    );
  }

  function startEditNote(record: AnchorDelayRow) {
    setEditingNoteId(record.id);
    setEditingNoteValue(record.note ?? "");
  }

  function saveNote(record: AnchorDelayRow) {
    setFeedback(null);
    setDelays.mutate(
      { date: record.delayDate, anchorIds: [record.anchorProfileId], isDelayed: record.isDelayed, note: editingNoteValue },
      {
        onSuccess: () => setEditingNoteId(null),
        onError: (err) =>
          setFeedback({ ok: false, message: err instanceof Error ? err.message : "备注保存失败，请稍后重试" }),
      },
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">延误</h1>
        <Button onClick={openSheet} disabled={anchors.isLoading}>
          + 设置延误
        </Button>
      </div>

      <div className="flex items-center gap-3">
        <label className="shrink-0 text-xs text-slate-500" htmlFor="delay-view-date">
          查看日期
        </label>
        <input
          id="delay-view-date"
          type="date"
          value={viewDate}
          onChange={(event) => setPickedDate(event.target.value || null)}
          className="rounded border px-2 py-1 text-sm"
        />
      </div>

      {feedback && !feedback.ok ? (
        <p className="text-xs text-red-600">{feedback.message}</p>
      ) : null}

      <QueryMessage loading={delays.isLoading} error={delays.error} empty={!dayRecords.length} />

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
                  <Badge tone={record.isDelayed ? "red" : "slate"}>
                    {record.isDelayed ? "延误" : "非延误"}
                  </Badge>
                  <button
                    type="button"
                    disabled={setDelays.isPending}
                    onClick={() => toggleStatus(record)}
                    className="text-xs text-indigo-600 disabled:opacity-50"
                  >
                    {record.isDelayed ? "设为非延误" : "设为延误"}
                  </button>
                </div>
              </div>
              {editingNoteId === record.id ? (
                <div className="mt-2 flex items-center gap-2">
                  <input
                    type="text"
                    maxLength={200}
                    value={editingNoteValue}
                    placeholder="备注（可空）"
                    onChange={(event) => setEditingNoteValue(event.target.value)}
                    className="min-w-0 flex-1 rounded border px-2 py-1 text-xs"
                  />
                  <button
                    type="button"
                    disabled={setDelays.isPending}
                    onClick={() => saveNote(record)}
                    className="shrink-0 text-xs text-indigo-600 disabled:opacity-50"
                  >
                    保存
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingNoteId(null)}
                    className="shrink-0 text-xs text-slate-400"
                  >
                    取消
                  </button>
                </div>
              ) : (
                <div className="mt-2 flex items-center justify-between gap-2 text-xs text-slate-500">
                  <span className="min-w-0 truncate">{record.note ? `备注：${record.note}` : "无备注"}</span>
                  <button
                    type="button"
                    onClick={() => startEditNote(record)}
                    className="shrink-0 text-indigo-600"
                  >
                    编辑备注
                  </button>
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
              <p className="text-sm font-semibold">设置延误</p>
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

              <p className="text-xs text-slate-400">已选 {selectedIds.size} 位 · 勾选后点击「标记延误」</p>

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
                disabled={setDelays.isPending || !selectedIds.size}
                onClick={submitSetDelays}
              >
                {setDelays.isPending ? "提交中…" : `标记延误（${selectedIds.size}）`}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
