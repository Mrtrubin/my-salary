"use client";

import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { QueryMessage } from "@/components/query-message";
import { PageHeader } from "@/components/ui/stat-card";
import { FormField, Input } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useCreatePosition, useMembers, usePositions, useUpdatePosition } from "@/lib/api/hooks";
import type { Position } from "@/lib/api/data";

type FormValues = { code: string; name: string };

/** 编辑职位弹窗（复用 members 页的弹窗模式）。 */
function EditPositionDialog({ position, onClose }: { position: Position; onClose: () => void }) {
  const update = useUpdatePosition();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const { register, handleSubmit } = useForm<FormValues>({
    defaultValues: { code: position.code, name: position.name },
  });

  async function submit(values: FormValues) {
    setErrorMsg(null);
    try {
      await update.mutateAsync({ id: position.id, code: values.code, name: values.name });
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "编辑职位失败，请稍后再试");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <Card className="w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h3 className="text-sm font-semibold text-slate-900">编辑职位 · {position.name}</h3>
          <button type="button" onClick={onClose} className="text-muted hover:text-foreground">×</button>
        </div>
        <CardContent>
          <form onSubmit={handleSubmit(submit)} className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="职位编码 *">
                <Input required {...register("code")} />
              </FormField>
              <FormField label="职位名称 *">
                <Input required {...register("name")} />
              </FormField>
            </div>
            {errorMsg ? <p className="text-xs text-red-600">{errorMsg}</p> : null}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={onClose}>取消</Button>
              <Button type="submit" disabled={update.isPending}>保存</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

export default function PositionsPage() {
  const positions = usePositions();
  const members = useMembers();
  const create = useCreatePosition();

  const [show, setShow] = useState(false);
  const [editing, setEditing] = useState<Position | null>(null);
  const { register, handleSubmit, reset } = useForm<FormValues>();

  const countByPosition = useMemo(() => {
    const map = new Map<number, number>();
    members.data?.forEach((member) => {
      member.user_positions.forEach((item) => {
        if (item.position) map.set(item.position.id, (map.get(item.position.id) ?? 0) + 1);
      });
    });
    return map;
  }, [members.data]);

  async function submitCreate(values: FormValues) {
    await create.mutateAsync({ code: values.code, name: values.name });
    reset();
    setShow(false);
  }

  return (
    <>
      <PageHeader
        title="职位管理"
        description="管理职位；职位编码与名称需唯一"
        action={<Button onClick={() => setShow(!show)}>{show ? "收起" : "+ 新建职位"}</Button>}
      />

      {show ? (
        <Card className="mb-6">
          <CardHeader title="新建职位" />
          <CardContent>
            <form onSubmit={handleSubmit(submitCreate)} className="grid gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="职位编码">
                  <Input required {...register("code")} placeholder="如 host / anchor" />
                </FormField>
                <FormField label="职位名称">
                  <Input required {...register("name")} placeholder="如 主持 / 主播" />
                </FormField>
              </div>
              <div className="flex gap-2">
                <Button type="submit" disabled={create.isPending}>保存</Button>
                <Button type="button" variant="ghost" onClick={() => setShow(false)}>取消</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent className="p-0">
          <QueryMessage loading={positions.isLoading || members.isLoading} error={positions.error || members.error} empty={!positions.data?.length} />
          <Table>
            <THead>
              <TH isRowHeader>职位</TH>
              <TH>编码</TH>
              <TH>成员数</TH>
              <TH className="text-left">操作</TH>
            </THead>
            <TBody>
              {positions.data?.map((position) => {
                const count = countByPosition.get(position.id) ?? 0;
                return (
                  <TR key={position.id}>
                    <TD><span className="font-medium">{position.name}</span></TD>
                    <TD><span className="text-muted">{position.code}</span></TD>
                    <TD>{count} 人</TD>
                    <TD className="text-left">
                      <Button size="sm" variant="ghost" onClick={() => setEditing(position)}>编辑</Button>
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </CardContent>
      </Card>

      {editing ? <EditPositionDialog position={editing} onClose={() => setEditing(null)} /> : null}
    </>
  );
}