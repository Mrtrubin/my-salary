"use client";

import { Button, Card, Col, Form, Input, Row, Select, Space, Table, Typography } from "antd";
import { useMemo, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { FormField } from "@/components/admin/form-field";
import { PageHeader } from "@/components/admin/page-header";
import { QueryMessage } from "@/components/admin/query-message";
import { zebraRowClassName } from "@/components/admin/table-zebra";
import { TextLink } from "@/components/admin/text-link";
import { useConfirm } from "@/components/admin/use-confirm";
import { useCreateTeam, useDeleteTeam, useMembers, useTeams, useUpdateTeam } from "@/lib/api/hooks";

type FormValues = { name: string; teamKey: string; hostProfileId: string; anchorProfileIds: string[] };

const DEFAULTS: FormValues = { name: "", teamKey: "", hostProfileId: "", anchorProfileIds: [] };

/** 团队 Key 的唯一约束名写在 Postgres 报错里，转成可读提示；其它错误原样返回。 */
function teamErrorMessage(error: unknown): string | null {
  if (!error) return null;
  if (!(error instanceof Error)) return "请稍后再试";
  return error.message.includes("teams_team_key_key") ? "团队 Key 已存在，请更换" : error.message;
}

/** 团队详情页地址，避免同一路径在列定义里重复拼接。 */
function teamDetailHref(teamId: string, tab: "members" | "points") {
  return `/admin/teams/detail/${tab}?teamId=${teamId}`;
}

function hasPosition(emp: { user_positions: { position: { code: string } | null }[] }, code: string) {
  return emp.user_positions.some(({ position }) => position?.code === code);
}

export default function TeamsPage() {
  const confirm = useConfirm();
  const teams = useTeams();
  const members = useMembers();
  const create = useCreateTeam();
  const update = useUpdateTeam();
  const remove = useDeleteTeam();
  const [show, setShow] = useState(false);
  /** 行内编辑中的团队 Key；非空即代表该行处于编辑态。 */
  const [editingKey, setEditingKey] = useState<{ id: string; value: string } | null>(null);
  const {
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({ defaultValues: DEFAULTS });

  const hosts = useMemo(() => members.data?.filter((e) => hasPosition(e, "host")) ?? [], [members.data]);
  const anchors = useMemo(
    () => members.data?.filter((e) => hasPosition(e, "anchor")) ?? [],
    [members.data],
  );

  const createErrorMessage = teamErrorMessage(create.error);

  /** 保存行内编辑的团队 Key；成功后关闭编辑态，失败原因由单元格内的 update.error 渲染。 */
  async function saveTeamKey() {
    if (!editingKey) return;
    const next = editingKey.value.trim();
    if (!next) return;
    if (next === teams.data?.find((team) => team.id === editingKey.id)?.team_key) {
      setEditingKey(null);
      return;
    }
    try {
      await update.mutateAsync({ id: editingKey.id, teamKey: next });
      setEditingKey(null);
    } catch {
      // 失败原因由下方 update.error 渲染，这里只是避免未处理的 rejection
    }
  }

  async function submit(values: FormValues) {
    try {
      await create.mutateAsync({
        name: values.name,
        teamKey: values.teamKey,
        hostProfileId: values.hostProfileId,
        anchorProfileIds: values.anchorProfileIds,
      });
      reset({ ...DEFAULTS, anchorProfileIds: [] });
      setShow(false);
    } catch {
      // 失败原因由下方 create.error 渲染，这里只是避免未处理的 rejection
    }
  }

  async function removeTeam(teamId: string, name: string) {
    const ok = await confirm({
      title: "确认删除团队",
      content: `确认删除「${name}」？该团队的成员与绩效关联会一并移除，操作不可撤销。`,
      okText: "确认删除",
      okButtonProps: { danger: true },
    });
    if (!ok) return;
    remove.mutate(teamId);
  }

  return (
    <>
      <PageHeader
        title="团队管理"
        description="每个团队含 1 名主持人与若干主播；点击团队进入详情，可分别管理成员与绩效"
        action={
          <Button
            type="primary"
            onClick={() => {
              create.reset();
              setShow(!show);
            }}
          >
            {show ? "收起" : "+ 新建团队"}
          </Button>
        }
      />

      {show ? (
        <Card title="新建团队" style={{ marginBottom: 16 }}>
          <Form layout="vertical" onFinish={handleSubmit(submit)}>
            <Row gutter={16}>
              <Col xs={24} md={12}>
                <FormField
                  label="团队名称"
                  error={errors.name ? "请填写团队名称" : undefined}
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
              <Col xs={24} md={12}>
                <FormField
                  label="团队 Key（唯一，创建后可在列表中修改）"
                  error={errors.teamKey ? "请填写团队 Key" : undefined}
                  required
                >
                  <Controller
                    control={control}
                    name="teamKey"
                    rules={{ required: true }}
                    render={({ field }) => <Input {...field} placeholder="如：TEAM-001" />}
                  />
                </FormField>
              </Col>
              <Col xs={24} md={12}>
                <FormField
                  label="主持人"
                  error={errors.hostProfileId ? "请选择主持人" : undefined}
                  required
                >
                  <Controller
                    control={control}
                    name="hostProfileId"
                    rules={{ required: true }}
                    render={({ field }) => (
                      <Select
                        {...field}
                        placeholder="请选择主持人"
                        options={hosts.map((host) => ({ value: host.id, label: host.name }))}
                      />
                    )}
                  />
                </FormField>
              </Col>
              <Col xs={24} md={12}>
                <FormField label="主播成员">
                  <Controller
                    control={control}
                    name="anchorProfileIds"
                    render={({ field }) => (
                      <Select
                        {...field}
                        mode="multiple"
                        allowClear
                        placeholder="可多选"
                        options={anchors.map((anchor) => ({ value: anchor.id, label: anchor.name }))}
                      />
                    )}
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
            {createErrorMessage ? (
              <Typography.Paragraph type="danger" style={{ marginTop: 12, marginBottom: 0 }}>
                保存失败：{createErrorMessage}
              </Typography.Paragraph>
            ) : null}
          </Form>
        </Card>
      ) : null}

      <Card>
        {teams.error ? (
          <QueryMessage loading={false} error={teams.error} />
        ) : (
          <Table
            rowClassName={zebraRowClassName}
            rowKey="id"
            loading={teams.isLoading}
            dataSource={teams.data ?? []}
            pagination={false}
            locale={{ emptyText: "暂无团队" }}
            scroll={{ x: "max-content" }}
            columns={[
              {
                title: "团队",
                dataIndex: "name",
                fixed: "left",
                width: 200,
                render: (name: string, record) => (
                  <TextLink href={teamDetailHref(record.id, "members")}>{name}</TextLink>
                ),
              },
              {
                title: "Key",
                dataIndex: "team_key",
                width: 240,
                render: (value: string, record) => {
                  if (editingKey?.id !== record.id) {
                    return (
                      <Space size={8}>
                        <Typography.Text code>{value}</Typography.Text>
                        <Button
                          type="link"
                          size="small"
                          style={{ padding: 0 }}
                          onClick={() => {
                            update.reset();
                            setEditingKey({ id: record.id, value });
                          }}
                        >
                          修改
                        </Button>
                      </Space>
                    );
                  }
                  return (
                    <Space direction="vertical" size={4} style={{ display: "flex" }}>
                      <Input
                        autoFocus
                        value={editingKey.value}
                        disabled={update.isPending}
                        onChange={(event) =>
                          setEditingKey({ id: record.id, value: event.target.value })
                        }
                        onPressEnter={() => void saveTeamKey()}
                      />
                      <Space size={8}>
                        <Button
                          type="primary"
                          size="small"
                          loading={update.isPending}
                          disabled={!editingKey.value.trim()}
                          onClick={() => void saveTeamKey()}
                        >
                          保存
                        </Button>
                        <Button
                          size="small"
                          disabled={update.isPending}
                          onClick={() => setEditingKey(null)}
                        >
                          取消
                        </Button>
                      </Space>
                      {update.error ? (
                        <Typography.Text type="danger">
                          {teamErrorMessage(update.error)}
                        </Typography.Text>
                      ) : null}
                    </Space>
                  );
                },
              },
              {
                title: "主持人",
                width: 140,
                render: (_, record) => record.host?.name ?? "-",
              },
              {
                title: "主播成员数",
                width: 120,
                render: (_, record) => record.members.length,
              },
              {
                title: "绩效点数",
                width: 120,
                render: (_, record) => record.points.length,
              },
              {
                title: "操作",
                key: "action",
                fixed: "right",
                width: 260,
                render: (_, record) => (
                  <Space size={12}>
                    <TextLink href={teamDetailHref(record.id, "members")}>成员管理</TextLink>
                    <TextLink href={teamDetailHref(record.id, "points")}>绩效管理</TextLink>
                    <Button
                      type="link"
                      size="small"
                      danger
                      style={{ padding: 0 }}
                      loading={remove.isPending && remove.variables === record.id}
                      onClick={() => removeTeam(record.id, record.name)}
                    >
                      删除
                    </Button>
                  </Space>
                ),
              },
            ]}
          />
        )}
      </Card>
    </>
  );
}
