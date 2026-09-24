"use client";

import { Button, Card, Col, Form, Input, Modal, Row, Space, Table, Typography } from "antd";
import { useMemo, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { FormField } from "@/components/admin/form-field";
import { PageHeader } from "@/components/admin/page-header";
import { QueryMessage } from "@/components/admin/query-message";
import { zebraRowClassName } from "@/components/admin/table-zebra";
import { useCreatePosition, useMembers, usePositions, useUpdatePosition } from "@/lib/api/hooks";
import type { Position } from "@/lib/api/data";

type FormValues = { code: string; name: string };

/** 编辑职位弹窗。 */
function EditPositionDialog({ position, onClose }: { position: Position; onClose: () => void }) {
  const update = useUpdatePosition();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
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
    <Modal
      title={`编辑职位 · ${position.name}`}
      open
      onCancel={onClose}
      onOk={handleSubmit(submit)}
      confirmLoading={update.isPending}
      okText="保存"
      cancelText="取消"
      destroyOnHidden
    >
      <Form layout="vertical" onFinish={handleSubmit(submit)}>
        <Row gutter={16}>
          <Col span={12}>
            <FormField
              label="职位编码"
              error={errors.code ? "请填写职位编码" : undefined}
              required
            >
              <Controller
                control={control}
                name="code"
                rules={{ required: true }}
                render={({ field }) => <Input {...field} />}
              />
            </FormField>
          </Col>
          <Col span={12}>
            <FormField
              label="职位名称"
              error={errors.name ? "请填写职位名称" : undefined}
              required
            >
              <Controller
                control={control}
                name="name"
                rules={{ required: true }}
                render={({ field }) => <Input {...field} />}
              />
            </FormField>
          </Col>
        </Row>
        {errorMsg ? <Typography.Text type="danger">{errorMsg}</Typography.Text> : null}
      </Form>
    </Modal>
  );
}

export default function PositionsPage() {
  const positions = usePositions();
  const members = useMembers();
  const create = useCreatePosition();

  const [show, setShow] = useState(false);
  const [editing, setEditing] = useState<Position | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const {
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    defaultValues: { code: "", name: "" },
  });

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
    setCreateError(null);
    try {
      await create.mutateAsync({ code: values.code, name: values.name });
      reset();
      setShow(false);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "新建职位失败，请稍后再试");
    }
  }

  return (
    <>
      <PageHeader
        title="职位管理"
        description="管理职位；职位编码与名称需唯一"
        action={
          <Button
            type="primary"
            onClick={() => {
              setCreateError(null);
              setShow(!show);
            }}
          >
            {show ? "收起" : "+ 新建职位"}
          </Button>
        }
      />

      {show ? (
        <Card title="新建职位" style={{ marginBottom: 16 }}>
          <Form layout="vertical" onFinish={handleSubmit(submitCreate)} style={{ maxWidth: 720 }}>
            <Row gutter={16}>
              <Col xs={24} md={12}>
                <FormField
                  label="职位编码"
                  error={errors.code ? "请填写职位编码" : undefined}
                  required
                >
                  <Controller
                    control={control}
                    name="code"
                    rules={{ required: true }}
                    render={({ field }) => <Input {...field} placeholder="如 host / anchor" />}
                  />
                </FormField>
              </Col>
              <Col xs={24} md={12}>
                <FormField
                  label="职位名称"
                  error={errors.name ? "请填写职位名称" : undefined}
                  required
                >
                  <Controller
                    control={control}
                    name="name"
                    rules={{ required: true }}
                    render={({ field }) => <Input {...field} placeholder="如 主持 / 主播" />}
                  />
                </FormField>
              </Col>
            </Row>
            <Space>
              <Button type="primary" htmlType="submit" loading={create.isPending}>
                保存
              </Button>
              <Button onClick={() => setShow(false)}>取消</Button>
            </Space>
            {createError ? <Typography.Text type="danger">{createError}</Typography.Text> : null}
          </Form>
        </Card>
      ) : null}

      <Card>
        {positions.error || members.error ? (
          <QueryMessage loading={false} error={positions.error ?? members.error} />
        ) : (
          <Table
            rowClassName={zebraRowClassName}
            rowKey="id"
            loading={positions.isLoading || members.isLoading}
            dataSource={positions.data ?? []}
            pagination={false}
            locale={{ emptyText: "暂无职位" }}
            columns={[
              {
                title: "职位",
                dataIndex: "name",
                render: (value: string) => <Typography.Text strong>{value}</Typography.Text>,
              },
              {
                title: "编码",
                dataIndex: "code",
                render: (value: string) => <Typography.Text type="secondary">{value}</Typography.Text>,
              },
              {
                title: "成员数",
                width: 120,
                render: (_, record) => `${countByPosition.get(record.id) ?? 0} 人`,
              },
              {
                title: "操作",
                width: 120,
                render: (_, record) => (
                  <Button type="link" size="small" onClick={() => setEditing(record)}>
                    编辑
                  </Button>
                ),
              },
            ]}
          />
        )}
      </Card>

      {editing ? <EditPositionDialog position={editing} onClose={() => setEditing(null)} /> : null}
    </>
  );
}
