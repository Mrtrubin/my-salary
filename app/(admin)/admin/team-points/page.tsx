"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { QueryMessage } from "@/components/query-message";
import { FormField, Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/stat-card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import {
  useCreatePerformancePoint,
  useDeletePerformancePoint,
  usePerformancePoints,
} from "@/lib/api/hooks";

export default function TeamPointsPage() {
  const points = usePerformancePoints();
  const create = useCreatePerformancePoint();
  const remove = useDeletePerformancePoint();
  const [name, setName] = useState("");
  const [rate, setRate] = useState("");

  async function add() {
    const pointsPerYuan = Number(rate);
    if (!name.trim() || !Number.isInteger(pointsPerYuan) || pointsPerYuan <= 0) return;
    await create.mutateAsync({ name: name.trim(), pointsPerYuan });
    setName(""); setRate("");
  }

  return <>
    <PageHeader title="绩效点管理" description="维护绩效点类型及换算率（N 绩效点 = 1 元），换算率为绩效点自带的全局属性，团队在团队管理页选择启用。" />
    <Card>
      <CardHeader title="绩效点类型" description="换算率含义：N 绩效点 = 1 元。金额（分）= 点数 × 100 ÷ 换算率，向下取整。" />
      <CardContent>
        <QueryMessage loading={points.isLoading} error={points.error} empty={!points.data?.length} />
        <Table><THead><TH isRowHeader>绩效点名称</TH><TH>换算率</TH><TH className="text-right">操作</TH></THead><TBody>
          {points.data?.map((p) => <TR key={p.id}>
            <TD>{p.name}</TD>
            <TD>{p.points_per_yuan} 绩效点 = 1 元</TD>
            <TD className="text-right"><Button variant="ghost" onClick={() => remove.mutate(p.id)}>删除</Button></TD>
          </TR>)}
        </TBody></Table>

        <div className="mt-4 flex flex-wrap items-end gap-3 border-t pt-4">
          <FormField label="绩效点名称"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="如 音浪" /></FormField>
          <FormField label="换算率（N 绩效点 = 1 元）"><Input type="number" min={1} step={1} value={rate} onChange={(e) => setRate(e.target.value)} placeholder="如 10" /></FormField>
          <Button type="button" onClick={add} disabled={create.isPending}>+ 添加绩效点</Button>
        </div>
      </CardContent>
    </Card>
  </>;
}