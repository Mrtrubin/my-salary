"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { FormField, Input, Select } from "@/components/ui/input";
import { QueryMessage } from "@/components/query-message";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import {
  useCreateScheme,
  useMembers,
  usePositions,
  useSchemes,
  useUpdateAnchorSettings,
} from "@/lib/api/hooks";
import type { Member, SalaryScheme } from "@/lib/api/data";
import { formatCentsToYuan } from "@/lib/format";

function isAnchor(member: Member) {
  return member.user_positions.some(({ position }) => position?.code === "anchor");
}

function latestPersonalScheme(schemes: SalaryScheme[] | undefined, profileId: string) {
  return schemes
    ?.filter((scheme) => scheme.profile_id === profileId)
    .sort((a, b) => b.version - a.version)[0];
}

function latestTemplateScheme(schemes: SalaryScheme[] | undefined, positionId?: number) {
  return schemes
    ?.filter((scheme) => scheme.profile_id == null && scheme.position_id === positionId)
    .sort((a, b) => b.version - a.version)[0];
}

type Editing = {
  id: string;
  name: string;
  anchorType: "new" | "experienced";
  commissionPercent: string;
  baseSalary: string;
  guaranteedSalary: string;
};

export default function AnchorsPage() {
  const members = useMembers();
  const positions = usePositions();
  const schemes = useSchemes();
  const updateSettings = useUpdateAnchorSettings();
  const createScheme = useCreateScheme();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [error, setError] = useState("");

  const anchors = useMemo(
    () => members.data?.filter(isAnchor) ?? [],
    [members.data],
  );
  const anchorPositionId = positions.data?.find((position) => position.code === "anchor")?.id;
  const template = latestTemplateScheme(schemes.data, anchorPositionId);

  function openEditor(member: Member) {
    const effective = latestPersonalScheme(schemes.data, member.id) ?? template;
    setError("");
    setEditing({
      id: member.id,
      name: member.name,
      anchorType: member.anchor_type,
      commissionPercent: String(member.anchor_base_commission_bps / 100),
      baseSalary: effective ? String(effective.base_salary_cents / 100) : "",
      guaranteedSalary: effective ? String(effective.guaranteed_salary_cents / 100) : "",
    });
  }

  async function save() {
    if (!editing || !anchorPositionId) return;
    const commissionBps = Math.round(Number(editing.commissionPercent) * 100);
    const baseSalary = Number(editing.baseSalary);
    const guaranteedSalary = Number(editing.guaranteedSalary);
    if (!Number.isInteger(commissionBps) || commissionBps < 1 || commissionBps > 10000) {
      setError("基础提成率必须在 0.01%～100% 之间，最多两位小数");
      return;
    }
    if (!Number.isFinite(baseSalary) || !Number.isFinite(guaranteedSalary) || baseSalary <= 0 || guaranteedSalary <= 0) {
      setError("初始保底和降级保底必须大于 0");
      return;
    }
    const personal = schemes.data?.filter((scheme) => scheme.profile_id === editing.id) ?? [];
    const version = Math.max(0, ...personal.map((scheme) => scheme.version)) + 1;
    try {
      await updateSettings.mutateAsync({
        id: editing.id,
        anchorType: editing.anchorType,
        baseCommissionRateBps: commissionBps,
      });
      await createScheme.mutateAsync({
        name: `${editing.name}个人方案`,
        profile_id: editing.id,
        position_id: anchorPositionId,
        version,
        base_salary_cents: Math.round(baseSalary * 100),
        guaranteed_salary_cents: Math.round(guaranteedSalary * 100),
        effective_from: new Date().toISOString().slice(0, 10),
      });
      setEditing(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败，请稍后重试");
    }
  }

  return (
    <Card>
      <CardHeader title="主播管理" description="统一管理主播类型、基础提成率、初始保底和降级保底" />
      <CardContent>
        <QueryMessage loading={members.isLoading || schemes.isLoading} error={members.error ?? schemes.error} empty={!members.isLoading && anchors.length === 0} />
        {anchors.length ? (
          <Table>
            <THead><TH isRowHeader>主播</TH><TH>主播类型</TH><TH>基础提成率</TH><TH>初始保底</TH><TH>降级保底</TH><TH>操作</TH></THead>
            <TBody>
              {anchors.map((anchor) => {
                const personal = latestPersonalScheme(schemes.data, anchor.id);
                const effective = personal ?? template;
                return (
                  <TR key={anchor.id}>
                    <TD>{anchor.name}</TD>
                    <TD>{anchor.anchor_type === "new" ? "新主播" : "老主播"}</TD>
                    <TD>{anchor.anchor_base_commission_bps / 100}%</TD>
                    <TD>{effective ? formatCentsToYuan(effective.base_salary_cents) : "—"}</TD>
                    <TD>{effective ? formatCentsToYuan(effective.guaranteed_salary_cents) : "—"}</TD>
<TD><Button variant="ghost" onClick={() => openEditor(anchor)}>编辑</Button></TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        ) : null}
        {editing ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setEditing(null)}>
            <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl" onClick={(event) => event.stopPropagation()}>
              <h3 className="mb-4 text-base font-semibold">编辑主播 · {editing.name}</h3>
              <div className="grid gap-4">
                <FormField label="主播类型"><Select value={editing.anchorType} options={[{ id: "new", name: "新主播" }, { id: "experienced", name: "老主播" }]} onChange={(value) => setEditing({ ...editing, anchorType: value as Editing["anchorType"] })} /></FormField>
                <FormField label="基础提成率（%）"><Input type="number" min="0.01" max="100" step="0.01" value={editing.commissionPercent} onChange={(event) => setEditing({ ...editing, commissionPercent: event.target.value })} /></FormField>
                <FormField label="初始保底（元）"><Input type="number" min="0.01" step="0.01" value={editing.baseSalary} onChange={(event) => setEditing({ ...editing, baseSalary: event.target.value })} /></FormField>
                <FormField label="降级保底（元）"><Input type="number" min="0.01" step="0.01" value={editing.guaranteedSalary} onChange={(event) => setEditing({ ...editing, guaranteedSalary: event.target.value })} /></FormField>
                {error ? <p className="text-sm text-red-600">{error}</p> : null}
              </div>
              <div className="mt-6 flex justify-end gap-2"><Button variant="ghost" onClick={() => setEditing(null)}>取消</Button><Button disabled={updateSettings.isPending || createScheme.isPending} onClick={save}>保存</Button></div>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}