"use client";

import { Button, Card, Col, Form, Input, Modal, Row, Space, Typography } from "antd";
import { useMemo, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { FormField } from "@/components/admin/form-field";
import { PageHeader } from "@/components/admin/page-header";
import { QueryMessage } from "@/components/admin/query-message";
import { ResizableTable } from "@/components/admin/resizable-table";
import { zebraRowClassName } from "@/components/admin/table-zebra";
import { useCreateRole, useMembers, useRoles, useUpdateRole } from "@/lib/api/hooks";
import type { Role } from "@/lib/api/data";

type FormValues = { code: string; name: string };

/** 编辑角色弹窗。 */
function EditRoleDialog({ role, onClose }: { role: Role; onClose: () => void }) {
  const update = useUpdateRole();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    defaultValues: { code: role.code, name: role.name },
  });

  async function submit(values: FormValues) {
    setErrorMsg(null);
    try {
      await update.mutateAsync({ id: role.id, code: values.code, name: values.name });
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "编辑角色失败，请稍后再试");
    }
  }

  return (
    <Modal
      title={`编辑角色 · ${role.name}`}
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
              label="角色编码"
              error={errors.code ? "请填写角色编码" : undefined}
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
              label="角色名称"
              error={errors.name ? "请填写角色名称" : undefined}
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

export default function RolesPage() {
  const roles = useRoles();
  const members = useMembers();
  const create = useCreateRole();

  const [show, setShow] = useState(false);
  const [editing, setEditing] = useState<Role | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const {
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    defaultValues: { code: "", name: "" },
  });

  const countByRole = useMemo(() => {
    const map = new Map<number, number>();
    members.data?.forEach((member) => {
      member.user_roles.forEach((item) => {
        if (item.role) map.set(item.role.id, (map.get(item.role.id) ?? 0) + 1);
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
      setCreateError(err instanceof Error ? err.message : "新建角色失败，请稍后再试");
    }
  }

  return (
    <>
      <PageHeader
        title="角色管理"
        description="管理角色；角色编码与名称需唯一"
        action={
          <Button
            type="primary"
            onClick={() => {
              setCreateError(null);
              setShow(!show);
            }}
          >
            {show ? "收起" : "+ 新建角色"}
          </Button>
        }
      />

      {show ? (
        <Card title="新建角色" style={{ marginBottom: 16 }}>
          <Form layout="vertical" onFinish={handleSubmit(submitCreate)} style={{ maxWidth: 720 }}>
            <Row gutter={16}>
              <Col xs={24} md={12}>
                <FormField
                  label="角色编码"
                  error={errors.code ? "请填写角色编码" : undefined}
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
                  label="角色名称"
                  error={errors.name ? "请填写角色名称" : undefined}
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
        {roles.error || members.error ? (
          <QueryMessage loading={false} error={roles.error ?? members.error} />
        ) : (
          <ResizableTable<Role>
            rowClassName={zebraRowClassName}
            rowKey="id"
            loading={roles.isLoading || members.isLoading}
            dataSource={roles.data ?? []}
            locale={{ emptyText: "暂无角色" }}
            columns={[
              {
                title: "角色",
                dataIndex: "name",
                width: 160,
                render: (value: string) => <Typography.Text strong>{value}</Typography.Text>,
              },
              {
                title: "编码",
                dataIndex: "code",
                width: 160,
                render: (value: string) => <Typography.Text type="secondary">{value}</Typography.Text>,
              },
              {
                title: "成员数",
                key: "member_count",
                align: "right",
                width: 120,
                sortValue: (record) => countByRole.get(record.id) ?? 0,
                render: (_, record) => `${countByRole.get(record.id) ?? 0} 人`,
              },
              {
                title: "操作",
                key: "action",
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

      {editing ? <EditRoleDialog role={editing} onClose={() => setEditing(null)} /> : null}
    </>
  );
}
