"use client";

import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { QueryMessage } from "@/components/query-message";
import { FormField, Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/stat-card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import type { Member, Position } from "@/lib/api/data";
import { useCreateMember, useMembers, usePositions, useSetMemberStatus, useUpdateMember } from "@/lib/api/hooks";

type FormValues = {
  username: string;
  password: string;
  hireDate: string;
  name: string;
  phone: string;
  email: string;
  idCard: string;
};

const todayStr = () => {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
};

const DEFAULTS: FormValues = { username: "", password: "123456", hireDate: todayStr(), name: "", phone: "", email: "", idCard: "" };

export default function MembersPage() {
  const members = useMembers();
  const positions = usePositions();
  const create = useCreateMember();
  const setStatus = useSetMemberStatus();
  const [show, setShow] = useState(false);
  const [selected, setSelected] = useState<number[]>([]);
  // 默认开启「用户名作为姓名」：勾选时姓名跟随用户名，不单独提交 name（仅前端行为）
  const [useUsernameAsName, setUseUsernameAsName] = useState(true);
  const [username, setUsername] = useState("");
  const [showPassword, setShowPassword] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const { register, handleSubmit, reset } = useForm<FormValues>({ defaultValues: DEFAULTS });

  const { onChange: onUsernameChange, ...usernameField } = register("username");

  // 编辑态：为 null 表示未打开编辑弹窗
  const [editing, setEditing] = useState<Member | null>(null);
  // 重置密码态：为 null 表示未打开重置密码弹窗
  const [resetting, setResetting] = useState<Member | null>(null);

  // 详情弹窗：为 null 表示未打开详情弹窗
  const [detailing, setDetailing] = useState<Member | null>(null);

  // 筛选条件
  const [keyword, setKeyword] = useState("");
  const [positionFilter, setPositionFilter] = useState<number | "all">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "disabled">("all");

  const filtered = useMemo(() => {
    const list = members.data ?? [];
    const kw = keyword.trim().toLowerCase();
    return list.filter((item) => {
      if (statusFilter !== "all" && item.status !== statusFilter) return false;
      if (positionFilter !== "all" && !item.user_positions.some(({ position }) => position?.id === positionFilter)) {
        return false;
      }
      if (kw) {
        const hay = [item.name, item.username, item.phone, item.email, item.id_card]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(kw)) return false;
      }
      return true;
    });
  }, [members.data, keyword, positionFilter, statusFilter]);

  const resetFilters = () => {
    setKeyword("");
    setPositionFilter("all");
    setStatusFilter("all");
  };

  function close() {
    setShow(false);
    reset({ ...DEFAULTS, hireDate: todayStr() });
    setSelected([]);
    setUseUsernameAsName(true);
    setUsername("");
    setShowPassword(true);
    setErrorMsg(null);
  }

  async function submit(values: FormValues) {
    setErrorMsg(null);
    try {
      await create.mutateAsync({
        username: values.username,
        password: values.password,
        hireDate: values.hireDate,
        // 勾选「用户名作为姓名」时不传 name（后端缺省用用户名兜底）
        name: useUsernameAsName ? undefined : values.name || undefined,
        phone: values.phone || undefined,
        email: values.email || undefined,
        idCard: values.idCard || undefined,
        positionIds: selected,
      });
      close();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "新增成员失败，请稍后再试");
    }
  }

  return (
    <>
      <PageHeader
        title="成员管理"
        description="新增成员将同时创建登录账号（用户名 + 密码），并写入 Supabase 成员资料；点击「编辑」可修改全部资料，「重置密码」可单独重置登录密码"
        action={<Button onClick={() => setShow(true)}>+ 新增成员</Button>}
    />

      {show ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={close}>
          <Card className="w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <h3 className="text-sm font-semibold text-slate-900">新增成员</h3>
              <button type="button" onClick={close} className="text-muted hover:text-foreground">×</button>
            </div>
            <CardContent>
              <form onSubmit={handleSubmit(submit)} className="grid gap-4 sm:grid-cols-2">
                <FormField label="用户名 *" hint="登录账号，允许中文，唯一">
                  <Input
                    required
                    maxLength={32}
                    {...usernameField}
                    onChange={(e) => {
                      onUsernameChange(e);
                      setUsername(e.target.value);
                    }}
                  />
                </FormField>
                <FormField label="密码 *" hint="6-64 位，默认 123456">
                  <div className="flex items-center gap-2">
                    <Input
                      required
                      type={showPassword ? "text" : "password"}
                      minLength={6}
                      maxLength={64}
                      {...register("password")}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="shrink-0 text-xs text-muted hover:text-foreground"
                    >
                     {showPassword ? "隐藏" : "显示"}
                    </button>
                  </div>
                </FormField>
                <FormField label="入职日期 *">
                  <Input required type="date" {...register("hireDate")} />
                </FormField>
                <FormField label="手机号">
                  <Input {...register("phone")} />
                </FormField>
                <div className="sm:col-span-2">
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={useUsernameAsName}
                      onChange={(e) => setUseUsernameAsName(e.target.checked)}
                    />
                    将用户名作为姓名
                  </label>
                </div>
                {!useUsernameAsName ? (
                  <FormField label="姓名">
                    <Input {...register("name")} />
                  </FormField>
                ) : (
                  <FormField label="姓名">
                    <Input value={username} disabled readOnly />
                  </FormField>
                )}
                <FormField label="联系邮箱">
                  <Input type="email" {...register("email")} />
                </FormField>
                <FormField label="身份证号">
                  <Input maxLength={32} {...register("idCard")} />
                </FormField>
                <div className="sm:col-span-2">
                  <FormField label="职位">
                    <div className="flex flex-wrap gap-2">
                      {positions.data?.map((item) => (
                        <button
                          type="button"
                        key={item.id}
                          onClick={() =>
                            setSelected((old) =>
                              old.includes(item.id) ? old.filter((id) => id !== item.id) : [...old, item.id],
                            )
                          }
                          className={`rounded border px-3 py-1 text-xs ${selected.includes(item.id) ? "border-indigo-600 text-indigo-700" : ""}`}
                        >
                          {item.name}
                        </button>
                      ))}
                    </div>
                  </FormField>
                </div>
                {errorMsg ? <p className="sm:col-span-2 text-xs text-danger">{errorMsg}</p> : null}
                <div className="sm:col-span-2 flex justify-end gap-2">
                  <Button type="button" variant="ghost" onClick={close}>取消</Button>
                  <Button type="submit" disabled={create.isPending}>{create.isPending ? "保存中…" : "保存"}</Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {editing ? (
        <EditMemberModal
          member={editing}
          positions={positions.data ?? []}
          onClose={() => setEditing(null)}
        />
      ) : null}

      {resetting ? (
        <ResetPasswordModal member={resetting} onClose={() => setResetting(null)} />
      ) : null}

      {detailing ? (
        <MemberDetailModal member={detailing} onClose={() => setDetailing(null)} />
      ) : null}

      <Card className="mb-4">
        <CardContent>
          <div className="flex flex-wrap items-end gap-3">
            <FormField label="搜索" hint="姓名 / 用户名 / 手机号 / 邮箱 / 身份证">
              <Input
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="输入关键词"
                className="w-56"
              />
            </FormField>
            <FormField label="职位">
              <select
                className="h-9 w-40 rounded-md border border-slate-200 bg-white px-3 text-sm"
                value={positionFilter === "all" ? "all" : String(positionFilter)}
                onChange={(e) => setPositionFilter(e.target.value === "all" ? "all" : Number(e.target.value))}
              >
                <option value="all">全部职位</option>
                {positions.data?.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </FormField>
            <FormField label="状态">
              <select
                className="h-9 w-32 rounded-md border border-slate-200 bg-white px-3 text-sm"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as "all" | "active" | "disabled")}
              >
                <option value="all">全部状态</option>
                <option value="active">在职</option>
                <option value="disabled">已停用</option>
              </select>
            </FormField>
            <Button type="button" variant="ghost" onClick={resetFilters}>重置筛选</Button>
            <span className="ml-auto text-xs text-muted">共 {filtered.length} / {members.data?.length ?? 0} 人</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <QueryMessage
            loading={members.isLoading}
            error={members.error}
            empty={!members.isLoading && !filtered.length}
          />
          <Table>
            <THead>
              <TH isRowHeader>姓名</TH>
              <TH>用户名</TH>
              <TH>手机号</TH>
              <TH>邮箱</TH>
              <TH>身份证号</TH>
            <TH>职位</TH>
              <TH>入职日期</TH>
              <TH>系统角色</TH>
              <TH>状态</TH>
              <TH className="text-right">操作</TH>
            </THead>
            <TBody>
              {filtered.map((item) => (
                <TR key={item.id}>
                  <TD>{item.name}</TD>
                  <TD>{item.username ?? "-"}</TD>
                  <TD>{item.phone || "-"}</TD>
                  <TD>{item.email || "-"}</TD>
                  <TD>{item.id_card || "-"}</TD>
                  <TD>
                    <div className="flex gap-1">
                      {item.user_positions.map(({ position }) => (position ? <Badge key={position.id}>{position.name}</Badge> : null))}
                    </div>
                  </TD>
                  <TD>{item.hire_date}</TD>
                  <TD>{item.system_role === "admin" ? "管理员" : "普通用户"}</TD>
                  <TD>{item.status === "active" ? "在职" : "已停用"}</TD>
                  <TD className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" onClick={() => setDetailing(item)}>详情</Button>
                      <Button variant="ghost" onClick={() => setEditing(item)}>编辑</Button>
                      <Button variant="ghost" onClick={() => setResetting(item)}>重置密码</Button>
                      <Button
                        variant="ghost"
                        onClick={() => setStatus.mutate({ id: item.id, status: item.status === "active" ? "disabled" : "active" })}
                      >
                        {item.status === "active" ? "停用" : "启用"}
                      </Button>
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}

type EditFormValues = {
  username: string;
  name: string;
  phone: string;
  email: string;
  hireDate: string;
  idCard: string;
  status: "active" | "disabled";
};

function EditMemberModal({
  member,
  positions,
  onClose,
}: {
  member: Member;
  positions: Position[];
  onClose: () => void;
}) {
  const update = useUpdateMember();
  const [selected, setSelected] = useState<number[]>(
    member.user_positions.map(({ position }) => position?.id).filter((id): id is number => typeof id === "number"),
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const { register, handleSubmit } = useForm<EditFormValues>({
    defaultValues: {
      username: member.username ?? "",
      name: member.name,
      phone: member.phone ?? "",
      email: member.email ?? "",
      hireDate: member.hire_date,
      idCard: member.id_card ?? "",
      status: member.status,
    },
  });

  async function submit(values: EditFormValues) {
    setErrorMsg(null);
    if (values.status === "disabled" && member.status === "active") {
      if (!window.confirm(`确认停用「${member.name}」的账号？停用后该成员将无法登录。`)) return;
    }
    try {
      await update.mutateAsync({
        id: member.id,
        username: values.username,
        name: values.name,
        phone: values.phone,
        email: values.email,
        hireDate: values.hireDate,
        idCard: values.idCard,
        status: values.status,
        positionIds: selected,
      });
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "编辑成员失败，请稍后再试");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <Card className="w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h3 className="text-sm font-semibold text-slate-900">编辑成员 · {member.name}</h3>
          <button type="button" onClick={onClose} className="text-muted hover:text-foreground">×</button>
        </div>
        <CardContent>
          <form onSubmit={handleSubmit(submit)} className="grid gap-4 sm:grid-cols-2">
            <FormField label="用户名 *" hint="登录账号，唯一">
              <Input required maxLength={32} {...register("username")} />
            </FormField>
            <FormField label="姓名 *">
              <Input required {...register("name")} />
            </FormField>
            <FormField label="手机号">
              <Input {...register("phone")} />
            </FormField>
            <FormField label="联系邮箱" hint="留空可清除">
              <Input type="email" {...register("email")} />
            </FormField>
            <FormField label="入职日期 *">
              <Input required type="date" {...register("hireDate")} />
            </FormField>
            <FormField label="身份证号" hint="留空可清除">
              <Input maxLength={32} {...register("idCard")} />
            </FormField>
            <FormField label="状态">
              <select
                className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
                {...register("status")}
              >
                <option value="active">在职</option>
                <option value="disabled">已停用</option>
              </select>
            </FormField>
            <div className="sm:col-span-2">
              <FormField label="职位">
                <div className="flex flex-wrap gap-2">
                  {positions.map((item) => (
                    <button
                      type="button"
                      key={item.id}
                      onClick={() =>
                        setSelected((old) =>
                          old.includes(item.id) ? old.filter((id) => id !== item.id) : [...old, item.id],
                        )
                      }
                      className={`rounded border px-3 py-1 text-xs ${selected.includes(item.id) ? "border-indigo-600 text-indigo-700" : ""}`}
                    >
                      {item.name}
                    </button>
                  ))}
                </div>
              </FormField>
            </div>
            {errorMsg ? <p className="sm:col-span-2 text-xs text-danger">{errorMsg}</p> : null}
            <div className="sm:col-span-2 flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={onClose}>取消</Button>
              <Button type="submit" disabled={update.isPending}>{update.isPending ? "保存中…" : "保存"}</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function ResetPasswordModal({
  member,
  onClose,
}: {
  member: Member;
  onClose: () => void;
}) {
  const update = useUpdateMember();
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    if (password.length < 6 || password.length > 64) {
      setErrorMsg("密码需为 6-64 位");
      return;
    }
    if (!window.confirm(`确认将「${member.name}」的登录密码重置为新密码？`)) return;
    try {
      await update.mutateAsync({ id: member.id, password });
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "重置密码失败，请稍后再试");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <Card className="w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h3 className="text-sm font-semibold text-slate-900">重置密码 · {member.name}</h3>
          <button type="button" onClick={onClose} className="text-muted hover:text-foreground">×</button>
        </div>
        <CardContent>
          <form onSubmit={submit} className="grid gap-4">
            <FormField label="新密码 *" hint="6-64 位">
              <div className="flex items-center gap-2">
                <Input
                  required
                  type={showPassword ? "text" : "password"}
                  minLength={6}
                  maxLength={64}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="请输入新密码"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="shrink-0 text-xs text-muted hover:text-foreground"
                >
                  {showPassword ? "隐藏" : "显示"}
                </button>
              </div>
            </FormField>
            {errorMsg ? <p className="text-xs text-danger">{errorMsg}</p> : null}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={onClose}>取消</Button>
              <Button type="submit" disabled={update.isPending}>{update.isPending ? "重置中…" : "重置密码"}</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-slate-100 py-2 last:border-0">
      <span className="text-xs text-muted">{label}</span>
      <span className="text-sm text-slate-900">{value}</span>
    </div>
  );
}

function MemberDetailModal({
  member,
  onClose,
}: {
  member: Member;
  onClose: () => void;
}) {
  const positions = member.user_positions
    .map(({ position }) => position?.name)
    .filter((n): n is string => Boolean(n));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <Card className="w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h3 className="text-sm font-semibold text-slate-900">成员详情 · {member.name}</h3>
          <button type="button" onClick={onClose} className="text-muted hover:text-foreground">×</button>
        </div>
        <CardContent>
          <div className="grid gap-x-6 sm:grid-cols-2">
            <DetailRow label="姓名" value={member.name} />
            <DetailRow label="用户名" value={member.username ?? "-"} />
            <DetailRow label="手机号" value={member.phone || "-"} />
            <DetailRow label="联系邮箱" value={member.email || "-"} />
            <DetailRow label="身份证号" value={member.id_card || "-"} />
            <DetailRow label="入职日期" value={member.hire_date} />
            <DetailRow label="系统角色" value={member.system_role === "admin" ? "管理员" : "普通用户"} />
            <DetailRow
              label="账号状态"
              value={<Badge>{member.status === "active" ? "在职" : "已停用"}</Badge>}
            />
            <div className="sm:col-span-2">
              <DetailRow
                label="职位"
                value={
                  positions.length ? (
                    <div className="flex flex-wrap gap-1">
                      {positions.map((n) => (
                        <Badge key={n}>{n}</Badge>
                      ))}
                    </div>
                  ) : (
                    "-"
                  )
                }
              />
            </div>
            <DetailRow label="创建时间" value={member.created_at ?? "-"} />
            <DetailRow label="更新时间" value={member.updated_at ?? "-"} />
          </div>
          <div className="mt-4 flex justify-end">
            <Button type="button" variant="ghost" onClick={onClose}>关闭</Button>
       </div>
        </CardContent>
      </Card>
    </div>
  );
}