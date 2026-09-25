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

type FormValues = { name: string; teamCode: string; hostProfileId: string; anchorProfileIds: string[] };

const DEFAULTS: FormValues = { name: "", teamCode: "", hostProfileId: "", anchorProfileIds: [] };

/** 行内可编辑的字段：团队名称、团队 ID。 */
type EditField = "name" | "teamCode";
type Editing = { id: string; field: EditField; value: string };

/**
 * 把 DB 约束名转成可读提示：
 *   - teams_team_code_host_profile_id_key：(团队 ID, 主持人) 组合重复（23505）；
 *   - teams_team_code_not_blank：团队 ID 去空白后为空。
 * 其它错误原样返回。
 */
function teamErrorMessage(error: unknown): string | null {
  if (!error) return null;
  if (!(error instanceof Error)) return "请稍后再试";
  if (error.message.includes("teams_team_code_host_profile_id_key")) {
    return "该主持人名下已有相同团队 ID 的团队，请更换团队 ID（不同主持人之间可以重复）";
  }
  return error.message.includes("teams_team_code_not_blank") ? "团队 ID 不能为空" : error.message;
}

/** 团队详情页地址，避免同一路径在列定义里重复拼接。 */
function teamDetailHref(teamId: string, tab: "members" | "points") {
  return `/admin/teams/detail/${tab}?teamId=${teamId}`;
}

function hasPosition(emp: { user_positions: { position: { code: string } | null }[] }, code: string) {
  return emp.user_positions.some(({ position }) => position?.code === code);
}

/** 行内编辑：输入 + 保存/取消，错误就地展示（团队名称与团队 ID 两列共用）。 */
function InlineTextEdit({
  value,
  onChange,
  onSave,
  onCancel,
  pending,
  error,
}: {
  value: string;
  onChange: (next: string) => void;
  onSave: () => void;
  onCancel: () => void;
  pending: boolean;
  error: string | null;
}) {
  return (
    <Space direction="vertical" size={4} style={{ display: "flex" }}>
      <Input
        autoFocus
        value={value}
        disabled={pending}
        onChange={(event) => onChange(event.target.value)}
        onPressEnter={onSave}
      />
      <Space size={8}>
        <Button
          type="primary"
          size="small"
          loading={pending}
          disabled={!value.trim()}
          onClick={onSave}
        >
          保存
        </Button>
        <Button size="small" disabled={pending} onClick={onCancel}>
          取消
        </Button>
      </Space>
      {error ? <Typography.Text type="danger">{error}</Typography.Text> : null}
    </Space>
  );
}

export default function TeamsPage() {
  const confirm = useConfirm();
  const teams = useTeams();
  const members = useMembers();
  const create = useCreateTeam();
  const update = useUpdateTeam();
  const remove = useDeleteTeam();
  const [show, setShow] = useState(false);
  /** 行内编辑态：非空即代表该行的某个字段正在编辑。 */
  const [editing, setEditing] = useState<Editing | null>(null);
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
  const updateErrorMessage = teamErrorMessage(update.error);

  /** 进入某行的行内编辑态；顺带清掉上一次的提交错误。 */
  function startEdit(id: string, field: EditField, value: string) {
    update.reset();
    setEditing({ id, field, value });
  }

  /**
   * 保存行内编辑（团队名称或团队 ID）；成功后关闭编辑态，失败原因由单元格内的 update.error 渲染。
   * 值未变化时直接退出，不产生无意义的 update。
   */
  async function saveEdit() {
    if (!editing) return;
    const next = editing.value.trim();
    const team = teams.data?.find((item) => item.id === editing.id);
    if (!next || !team) return;
    const current = editing.field === "name" ? team.name : team.team_code;
    if (next === current) {
      setEditing(null);
      return;
    }
    try {
      await update.mutateAsync(
        editing.field === "name" ? { id: editing.id, name: next } : { id: editing.id, teamCode: next },
      );
      setEditing(null);
    } catch {
      // 失败原因由单元格内的 update.error 渲染，这里只是避免未处理的 rejection
    }
  }

  async function submit(values: FormValues) {
    try {
      await create.mutateAsync({
        name: values.name,
        teamCode: values.teamCode,
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
        description="每个团队含 1 名主持人与若干主播；一个主持人可带多个团队。团队名称可重复；团队 ID 在同一主持人名下不可重复（不同主持人之间可重复）。两者均可在列表中直接修改"
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
                  label="团队 ID（同一主持人下不可重复，创建后可在列表中修改）"
                  error={errors.teamCode ? "请填写团队 ID" : undefined}
                  required
                >
                  <Controller
                    control={control}
                    name="teamCode"
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
                width: 260,
                render: (name: string, record) => {
                  if (editing?.id === record.id && editing.field === "name") {
                    return (
                      <InlineTextEdit
                        value={editing.value}
                        onChange={(value) => setEditing({ ...editing, value })}
                        onSave={() => void saveEdit()}
                        onCancel={() => setEditing(null)}
                        pending={update.isPending}
                        error={updateErrorMessage}
                      />
                    );
                  }
                  return (
                    <Space size={8}>
                      <TextLink href={teamDetailHref(record.id, "members")}>{name}</TextLink>
                      <Button
                        type="link"
                        size="small"
                        style={{ padding: 0 }}
                        onClick={() => startEdit(record.id, "name", name)}
                      >
                        改名
                      </Button>
                    </Space>
                  );
                },
              },
              {
                title: "ID",
                dataIndex: "team_code",
                width: 240,
                render: (value: string, record) => {
                  if (editing?.id === record.id && editing.field === "teamCode") {
                    return (
                      <InlineTextEdit
                        value={editing.value}
                        onChange={(next) => setEditing({ ...editing, value: next })}
                        onSave={() => void saveEdit()}
                        onCancel={() => setEditing(null)}
                        pending={update.isPending}
                        error={updateErrorMessage}
                      />
                    );
                  }
                  return (
                    <Space size={8}>
                      <Typography.Text code>{value}</Typography.Text>
                      <Button
                        type="link"
                        size="small"
                        style={{ padding: 0 }}
                        onClick={() => startEdit(record.id, "teamCode", value)}
                      >
                        修改
                      </Button>
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
