"use client";

import { useState } from "react";
import {
  useCurrentProfile,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
} from "@/lib/api/hooks";
import { formatDateTime } from "@/lib/format";

/** 站内通知铃铛：未读红点 + 下拉列表，点击单条或“全部已读”标记已读。 */
export function NotificationBell() {
  const profile = useCurrentProfile();
  const profileId = profile.data?.id ?? null;
  const notifications = useNotifications(profileId);
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();
  const [open, setOpen] = useState(false);

  const list = notifications.data ?? [];
  const unread = list.filter((n) => !n.read_at).length;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="relative flex h-9 w-9 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100"
        aria-label="通知"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {unread > 0 ? (
          <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-medium text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 z-30 mt-2 w-72 rounded-xl border border-slate-200 bg-white shadow-lg">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <span className="text-sm font-medium">通知</span>
            {unread > 0 && profileId ? (
              <button type="button" className="text-xs text-indigo-600" onClick={() => markAll.mutate(profileId)}>
                全部已读
              </button>
            ) : null}
          </div>
          <ul className="max-h-80 overflow-auto">
            {list.length === 0 ? (
              <li className="px-3 py-6 text-center text-xs text-slate-400">暂无通知</li>
            ) : (
              list.map((n) => (
                <li
                  key={n.id}
                  onClick={() => { if (!n.read_at) markRead.mutate(n.id); }}
                  className={`cursor-pointer border-b px-3 py-2.5 text-sm last:border-0 ${n.read_at ? "text-slate-500" : "bg-indigo-50/50 font-medium"}`}
                >
                  <div className="flex items-center gap-2">
                    {!n.read_at ? <span className="h-1.5 w-1.5 rounded-full bg-red-500" /> : null}
                    <span>{n.title}</span>
                  </div>
                  {n.body ? <p className="mt-0.5 text-xs text-slate-400">{n.body}</p> : null}
                  <p className="mt-0.5 text-[10px] text-slate-300">{formatDateTime(n.created_at)}</p>
                </li>
              ))
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}