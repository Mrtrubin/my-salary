"use client";

import { useMemo, useState } from "react";
import { ChangeRequestStatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { QueryMessage } from "@/components/query-message";
import { PageHeader } from "@/components/ui/stat-card";
import { usePendingChangeRequests, useReviewProfileChanges } from "@/lib/api/hooks";
import { EDITABLE_PROFILE_FIELDS, type ProfileChangeRequest } from "@/lib/api/data";
import { formatDateTime } from "@/lib/format";

const FIELD_LABEL: Record<string, string> = {
  ...EDITABLE_PROFILE_FIELDS.reduce(
    (acc, item) => ({ ...acc, [item.field]: item.label }),
    {} as Record<string, string>,
  ),
  password: "登录密码",
};

type Group = { profileId: string; name: string; items: ProfileChangeRequest[] };

export default function ChangeRequestsPage() {
  const query = usePendingChangeRequests();
  const review = useReviewProfileChanges();
  const [keyword, setKeyword] = useState("");
  const [rejecting, setRejecting] = useState<{ ids: string[]; title: string } | null>(null);
  const [reason, setReason] = useState("");

  const groups = useMemo<Group[]>(() => {
    const kw = keyword.trim().toLowerCase();
    const map = new Map<string, Group>();
    for (const item of query.data ?? []) {
      const name = item.profile?.name ?? "未知成员";
      if (kw && !name.toLowerCase().includes(kw)) continue;
      const g = map.get(item.profile_id) ?? { profileId: item.profile_id, name, items: [] };
      g.items.push(item);
      map.set(item.profile_id, g);
    }
    return [...map.values()];
  }, [query.data, keyword]);

  async function approve(ids: string[]) {
    await review.mutateAsync({ ids, action: "approve" });
  }

  async function confirmReject() {
    if (!rejecting || !reason.trim()) return;
    await review.mutateAsync({ ids: rejecting.ids, action: "reject", reason: reason.trim() });
    setRejecting(null);
    setReason("");
  }

  return (
    <>
      <PageHeader title="资料审核" description="成员提交的资料修改申请，逐字段审核；通过后写入成员资料" />
      <Card>
        <CardHeader title="待审核申请" />
        <CardContent className="p-0">
          <div className="flex flex-wrap gap-3 p-4">
            <Input
              className="max-w-xs"
              placeholder="搜索成员姓名"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
            {keyword ? <Button variant="ghost" onClick={() => setKeyword("")}>重置</Button> : null}
          </div>

          <QueryMessage loading={query.isLoading} error={query.error} empty={!groups.length} />

          <div className="space-y-4 p-4 pt-0">
            {groups.map((group) => {
              const allIds = group.items.map((i) => i.id);
              return (
                <Card key={group.profileId} className="px-4 py-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold">{group.name}</p>
                      <p className="text-xs text-muted">{group.items.length} 项待审核</p>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={() => approve(allIds)}
                        disabled={review.isPending}
                      >
                        一键同意
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => setRejecting({ ids: allIds, title: `驳回 ${group.name} 的全部 ${allIds.length} 项申请` })}
                        disabled={review.isPending}
                      >
                        全部驳回
                      </Button>
                   </div>
                  </div>

                  <ul className="mt-3 space-y-2">
                    {group.items.map((item) => (
                      <li
                        key={item.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-100 px-3 py-2 text-sm"
                      >
                        <div className="min-w-0">
                          <span className="font-medium">{FIELD_LABEL[item.field] ?? item.field}</span>
                          <span className="mx-2 text-muted">
                            {item.field === "password" ? (
                              <span className="text-foreground">重置为新密码（已加密，管理员不可见）</span>
                            ) : (
                              <>
                                {item.old_value || "（空）"} → <span className="text-foreground">{item.new_value || "（清空）"}</span>
                              </>
                            )}
                          </span>
                          <span className="text-xs text-muted">{formatDateTime(item.created_at)}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <ChangeRequestStatusBadge status={item.status} />
                          <Button size="sm" variant="secondary" onClick={() => approve([item.id])} disabled={review.isPending}>通过</Button>
                          <Button
                            size="sm"
                            variant="danger"
                            onClick={() => setRejecting({ ids: [item.id], title: `驳回「${FIELD_LABEL[item.field] ?? item.field}」修改申请` })}
                            disabled={review.isPending}
                          >
                            驳回
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </Card>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {rejecting ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <Card className="w-full max-w-md px-4 py-4">
            <h3 className="text-sm font-semibold">{rejecting.title}</h3>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              className="mt-3 w-full rounded-lg border p-2 text-sm"
              placeholder="请输入驳回原因（将展示给成员）"
            />
            <div className="mt-3 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => { setRejecting(null); setReason(""); }}>取消</Button>
              <Button variant="danger" disabled={!reason.trim() || review.isPending} onClick={confirmReject}>确认驳回</Button>
            </div>
          </Card>
        </div>
      ) : null}
    </>
  );
}