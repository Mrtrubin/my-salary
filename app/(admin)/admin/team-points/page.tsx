"use client";

import { App, Button, Card, Col, Form, Input, InputNumber, Row, Table, Typography } from "antd";
import { useState } from "react";
import { FormField } from "@/components/admin/form-field";
import { PageHeader } from "@/components/admin/page-header";
import { QueryMessage } from "@/components/admin/query-message";
import { zebraRowClassName } from "@/components/admin/table-zebra";
import { useConfirm } from "@/components/admin/use-confirm";
import {
  useCreatePerformancePoint,
  useDeletePerformancePoint,
  usePerformancePoints,
} from "@/lib/api/hooks";

export default function TeamPointsPage() {
  const confirm = useConfirm();
  const points = usePerformancePoints();
  const create = useCreatePerformancePoint();
  const remove = useDeletePerformancePoint();
  const { message } = App.useApp();
  const [name, setName] = useState("");
  const [rate, setRate] = useState<number | null>(null);

  async function add() {
    if (!name.trim() || rate === null || !Number.isInteger(rate) || rate <= 0) {
      message.warning("请填写绩效点名称与正整数换算率");
      return;
    }
    try {
      await create.mutateAsync({ name: name.trim(), pointsPerYuan: rate });
      setName("");
      setRate(null);
      message.success("绩效点已添加");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "添加失败，请稍后重试");
    }
  }

  async function removePoint(id: string, pointName: string) {
    const ok = await confirm({
      title: "确认删除绩效点",
      content: `确认删除「${pointName}」？已引用该绩效点的团队与流水记录不受影响，但后续无法再选择。`,
      okText: "确认删除",
      okButtonProps: { danger: true },
    });
    if (!ok) return;
    remove.mutate(id, {
      onError: (err) => message.error(err instanceof Error ? err.message : "删除失败，请稍后重试"),
    });
  }

  return (
    <>
      <PageHeader
        title="绩效点管理"
        description="维护绩效点类型及换算率（N 绩效点 = 1 元），换算率为绩效点自带的全局属性，团队在团队管理页选择启用。"
      />
      <Card
        title="绩效点类型"
        extra={
          <Typography.Text type="secondary">
            换算率含义：N 绩效点 = 1 元。金额（分）= 点数 × 100 ÷ 换算率，向下取整。
          </Typography.Text>
        }
      >
        {points.error ? (
          <QueryMessage loading={false} error={points.error} />
        ) : (
          <Table
            rowClassName={zebraRowClassName}
            rowKey="id"
            loading={points.isLoading}
            dataSource={points.data ?? []}
            pagination={false}
            locale={{ emptyText: "暂无绩效点" }}
            columns={[
              { title: "绩效点名称", dataIndex: "name" },
              {
                title: "换算率",
                dataIndex: "points_per_yuan",
                render: (value: number) => `${value} 绩效点 = 1 元`,
              },
              {
                title: "操作",
                key: "action",
                width: 120,
                render: (_, record) => (
                  <Button
                    type="link"
                    danger
                    size="small"
                    loading={remove.isPending && remove.variables === record.id}
                    onClick={() => removePoint(record.id, record.name)}
                  >
                    删除
                  </Button>
                ),
              },
            ]}
          />
        )}

        <Form layout="vertical" style={{ marginTop: 24 }}>
          <Row gutter={16} align="bottom">
            <Col xs={24} sm={8} md={6}>
              <FormField label="绩效点名称">
                <Input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="如 音浪"
                />
              </FormField>
            </Col>
            <Col xs={24} sm={8} md={6}>
              <FormField label="换算率（N 绩效点 = 1 元）">
                <InputNumber
                  style={{ width: "100%" }}
                  min={1}
                  step={1}
                  precision={0}
                  value={rate}
                  onChange={setRate}
                  placeholder="如 10"
                />
              </FormField>
            </Col>
            <Col xs={24} sm={8} md={6}>
              {/* 这里刻意不用 FormField：它需要一个 label，用空格占位会多出一个空 label 节点。
                  外层的 marginBottom 与 FormField 的 Form.Item 一致，配合 Row 的 align="bottom" 对齐。 */}
              <div style={{ marginBottom: 16 }}>
                <Button type="primary" onClick={add} loading={create.isPending}>
                  + 添加绩效点
                </Button>
              </div>
            </Col>
          </Row>
        </Form>
      </Card>
    </>
  );
}
