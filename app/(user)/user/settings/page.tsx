"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, FormField } from "@/components/ui/input";
import { signOut, PASSWORD_MIN_LENGTH } from "@/lib/api/auth";
import { useMyChangeRequests, useSubmitPasswordChange } from "@/lib/api/hooks";
import { clearCachedProfile } from "@/lib/api/profile-cache";

export default function UserSettingsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const submitPassword = useSubmitPasswordChange();
  const { data: requests } = useMyChangeRequests();

  // 最近一条改密申请（用于展示审核状态）。
  const latestPasswordRequest = requests?.find((r) => r.field === "password") ?? null;
  const hasPending = latestPasswordRequest?.status === "pending";

  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function logout() {
    await signOut();
    queryClient.clear();
    clearCachedProfile();
    router.replace("/login");
  }

  function reset() {
    setCurrent("");
    setNext("");
    setConfirm("");
    setError(null);
  }

  async function submit() {
    setError(null);
    setDone(null);
    if (!current || !next || !confirm) {
      setError("请填写完整");
      return;
    }
    if (next !== confirm) {
      setError("两次输入的新密码不一致");
      return;
    }
    setPending(true);
    try {
      await submitPassword.mutateAsync({ currentPassword: current, newPassword: next });
      setDone("已提交，等待管理员审核通过后生效");
      reset();
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "提交失败，请稍后再试");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Link
          href="/user/profile"
          aria-label="返回"
          className="flex h-8 w-8 items-center justify-center rounded-full text-slate-500 transition-colors active:bg-slate-100"
       >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </Link>
        <h1 className="text-lg font-semibold tracking-tight">设置</h1>
      </div>

      {done ? <p className="rounded-lg bg-green-50 px-3 py-2 text-xs text-green-700">{done}</p> : null}

      <Card className="overflow-hidden">
        <button
          type="button"
          onClick={() => { reset(); setDone(null); setOpen((v) => !v); }}
          className="flex w-full items-center justify-between px-5 py-4 text-sm font-medium transition-colors active:bg-slate-50"
        >
          修改密码
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d={open ? "M6 15l6-6 6 6" : "M9 6l6 6-6 6"} />
          </svg>
        </button>
        {open ? (
          <div className="space-y-3 border-t px-5 py-4">
            {hasPending ? (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">已有一条修改密码申请正在审核中，再次提交将覆盖上一条。</p>
            ) : latestPasswordRequest?.status === "rejected" ? (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">上次修改密码申请被驳回{latestPasswordRequest.reject_reason ? `：${latestPasswordRequest.reject_reason}` : ""}</p>
            ) : null}
            <FormField label="当前密码">
              <Input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
            </FormField>
            <FormField label="新密码" hint={`至少 ${PASSWORD_MIN_LENGTH} 位`}>
              <Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
            </FormField>
            <FormField label="确认新密码">
              <Input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </FormField>
            {error ? <p className="text-xs text-red-600">{error}</p> : null}
            <div className="flex gap-2">
              <Button size="sm" onClick={submit} disabled={pending}>{pending ? "提交中…" : "提交审核"}</Button>
              <Button size="sm" variant="ghost" onClick={() => { reset(); setOpen(false); }} disabled={pending}>取消</Button>
            </div>
          </div>
        ) : null}
      </Card>

      <Card className="overflow-hidden">
        <button
          type="button"
          onClick={logout}
          className="flex w-full items-center justify-between px-5 py-4 text-sm font-medium text-danger transition-colors active:bg-slate-50"
        >
          退出登录
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 6l6 6-6 6" />
          </svg>
        </button>
      </Card>
    </div>
  );
}