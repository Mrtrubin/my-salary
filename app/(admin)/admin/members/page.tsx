"use client";

import {
  App,
  Button,
  Card,
  Col,
  DatePicker,
  Descriptions,
  Flex,
  Form,
  Input,
  Modal,
  Row,
  Select,
  Space,
  Switch,
  Table,
  Typography,
} from "antd";
import dayjs from "dayjs";
import { useMemo, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { FormField } from "@/components/admin/form-field";
import { PageHeader } from "@/components/admin/page-header";
import { QueryMessage } from "@/components/admin/query-message";
import { Badge } from "@/components/admin/status-tag";
import { zebraRowClassName } from "@/components/admin/table-zebra";
import { useConfirm } from "@/components/admin/use-confirm";
import type { Member, Position } from "@/lib/api/data";
import {
  useCreateMember,
  useMembers,
  usePositions,
  useSetMemberStatus,
  useUpdateMember,
} from "@/lib/api/hooks";

type FormValues = {
  username: string;
  password: string;
  hireDate: string;
  name: string;
  phone: string;
  email: string;
  idCard: string;
  douyinId: string;
};

const todayStr = () => dayjs().format("YYYY-MM-DD");

/**
 * hireDate 刻意留空：模块作用域求值会分别在服务端与浏览器时区各跑一次，
 * SSR/CSR 拿到不同日期会导致首帧不一致。改为打开弹窗时现算，见 openCreate。
 */
const DEFAULTS: FormValues = {
  username: "",
  password: "123456",
  hireDate: "",
  name: "",
  phone: "",
  email: "",
  idCard: "",
  douyinId: "",
};

export default function MembersPage() {
  const { message } = App.useApp();
  const confirm = useConfirm();
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

  const {
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({ defaultValues: DEFAULTS });

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
      if (
        positionFilter !== "all" &&
        !item.user_positions.some(({ position }) => position?.id === positionFilter)
      ) {
        return false;
      }
      if (kw) {
        const hay = [item.name, item.username, item.phone, item.email, item.id_card, item.douyin_id]
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

  /** 打开新增弹窗：入职日期在这里现算，避免模块作用域求值带来的时区不一致。 */
  function openCreate() {
    reset({ ...DEFAULTS, hireDate: todayStr() });
    setSelected([]);
    setUseUsernameAsName(true);
    setUsername("");
    setShowPassword(true);
    setErrorMsg(null);
    setShow(true);
  }

  function close() {
    setShow(false);
    reset({ ...DEFAULTS, hireDate: todayStr() });
    setSelected([]);
    setUseUsernameAsName(true);
    setUsername("");
    setShowPassword(true);
    setErrorMsg(null);
  }

  /** 停用属于破坏性操作，与编辑弹窗里的口径保持一致：停用要确认，启用不需要。 */
  async function toggleStatus(record: Member) {
    const next = record.status === "active" ? "disabled" : "active";
    if (next === "disabled") {
      const ok = await confirm({
        title: "确认停用账号",
        content: `确认停用「${record.name}」的账号？停用后该成员将无法登录。`,
        okText: "确认停用",
        okButtonProps: { danger: true },
      });
      if (!ok) return;
    }
    setStatus.mutate(
      { id: record.id, status: next },
      { onError: (err) => message.error(err instanceof Error ? err.message : "操作失败，请稍后重试") },
    );
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
        douyinId: values.douyinId || undefined,
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
        action={
          <Button type="primary" onClick={openCreate}>
            + 新增成员
          </Button>
        }
      />

      <Card style={{ marginBottom: 16 }}>
        <Form layout="vertical">
          <Flex align="flex-end" gap={16} wrap>
            <div style={{ width: 240 }}>
              <FormField label="搜索" hint="姓名 / 用户名 / 手机号 / 邮箱 / 身份证">
                <Input
                  value={keyword}
                  onChange={(event) => setKeyword(event.target.value)}
                  placeholder="输入关键词"
                  allowClear
                />
              </FormField>
            </div>
            <div style={{ width: 180 }}>
              <FormField label="职位">
                <Select
                  value={positionFilter === "all" ? "all" : String(positionFilter)}
                  onChange={(value) => setPositionFilter(value === "all" ? "all" : Number(value))}
                  loading={positions.isLoading}
                  status={positions.error ? "error" : undefined}
                  options={[
                    { value: "all", label: "全部职位" },
                    ...(positions.data ?? []).map((p) => ({ value: String(p.id), label: p.name })),
                  ]}
                />
              </FormField>
            </div>
            <div style={{ width: 160 }}>
              <FormField label="状态">
                <Select
                  value={statusFilter}
                  onChange={(value: "all" | "active" | "disabled") => setStatusFilter(value)}
                  options={[
                    { value: "all", label: "全部状态" },
                    { value: "active", label: "在职" },
                    { value: "disabled", label: "已停用" },
                  ]}
                />
              </FormField>
            </div>
            <Button onClick={resetFilters}>重置筛选</Button>
            <Typography.Text type="secondary" style={{ marginInlineStart: "auto" }}>
              共 {filtered.length} / {members.data?.length ?? 0} 人
            </Typography.Text>
          </Flex>
        </Form>
      </Card>

      <Card>
        {members.error ? (
          <QueryMessage loading={false} error={members.error} />
        ) : (
          <Table
            rowClassName={zebraRowClassName}
            rowKey="id"
            loading={members.isLoading}
            dataSource={filtered}
            pagination={{ showSizeChanger: true, showTotal: (total) => `共 ${total} 人` }}
            locale={{ emptyText: "暂无成员" }}
            scroll={{ x: "max-content" }}
            columns={[
              { title: "姓名", dataIndex: "name", fixed: "left", width: 140 },
              {
                title: "用户名",
                dataIndex: "username",
                width: 140,
                render: (value: string | null) => value ?? "-",
              },
              {
                title: "手机号",
                width: 140,
                render: (_, record) => record.phone || "-",
              },
              {
                title: "邮箱",
                width: 200,
                render: (_, record) => record.email || "-",
              },
              {
                title: "身份证号",
                width: 200,
                render: (_, record) => record.id_card || "-",
              },
              {
                title: "职位",
                width: 200,
                render: (_, record) => (
                  <Space size={4} wrap>
                    {record.user_positions.map(({ position }) =>
                      position ? <Badge key={position.id}>{position.name}</Badge> : null,
                    )}
                  </Space>
                ),
              },
              { title: "入职日期", dataIndex: "hire_date", width: 130 },
              {
                title: "系统角色",
                width: 120,
                render: (_, record) => (record.system_role === "admin" ? "管理员" : "普通用户"),
              },
              {
                title: "状态",
                width: 100,
                render: (_, record) => (record.status === "active" ? "在职" : "已停用"),
              },
              {
                title: "操作",
                key: "action",
                fixed: "right",
                width: 300,
                render: (_, record) => (
                  <Space size={0}>
                    <Button type="link" size="small" onClick={() => setDetailing(record)}>
                      详情
                    </Button>
                    <Button type="link" size="small" onClick={() => setEditing(record)}>
                      编辑
                    </Button>
                    <Button type="link" size="small" onClick={() => setResetting(record)}>
                      重置密码
                    </Button>
                    <Button
                      type="link"
                      size="small"
                      loading={setStatus.isPending && setStatus.variables?.id === record.id}
                      onClick={() => toggleStatus(record)}
                    >
                      {record.status === "active" ? "停用" : "启用"}
                    </Button>
                  </Space>
                ),
              },
            ]}
          />
        )}
      </Card>

      <Modal
        title="新增成员"
        open={show}
        onCancel={close}
        onOk={handleSubmit(submit)}
        confirmLoading={create.isPending}
        okText="保存"
        cancelText="取消"
        width={720}
        destroyOnHidden
      >
        <Form layout="vertical" onFinish={handleSubmit(submit)}>
          <Row gutter={16}>
            <Col xs={24} md={12}>
              <FormField
                label="用户名"
                hint="登录账号，允许中文，唯一"
                error={errors.username ? "请填写用户名" : undefined}
                required
              >
                <Controller
                  control={control}
                  name="username"
                  rules={{ required: true }}
                  render={({ field }) => (
                    <Input
                      {...field}
                      maxLength={32}
                      onChange={(event) => {
                        field.onChange(event);
                        setUsername(event.target.value);
                      }}
                    />
                  )}
                />
              </FormField>
            </Col>
            <Col xs={24} md={12}>
              <FormField
                label="密码"
                hint="6-64 位，默认 123456"
                error={errors.password ? "请填写密码" : undefined}
                required
              >
                <Controller
                  control={control}
                  name="password"
                  rules={{ required: true }}
                  render={({ field }) => (
                    <Input.Password
                      {...field}
                      visibilityToggle={{ visible: showPassword, onVisibleChange: setShowPassword }}
                      minLength={6}
                      maxLength={64}
                    />
                  )}
                />
              </FormField>
            </Col>
            <Col xs={24} md={12}>
              <FormField
                label="入职日期"
                error={errors.hireDate ? "请选择入职日期" : undefined}
                required
              >
                <Controller
                  control={control}
                  name="hireDate"
                  rules={{ required: true }}
                  render={({ field }) => (
                    <DatePicker
                      style={{ width: "100%" }}
                      value={field.value ? dayjs(field.value) : null}
                      onChange={(date) => field.onChange(date ? date.format("YYYY-MM-DD") : "")}
                    />
                  )}
                />
              </FormField>
            </Col>
            <Col xs={24} md={12}>
              <FormField label="手机号">
                <Controller
                  control={control}
                  name="phone"
                  render={({ field }) => <Input {...field} />}
                />
              </FormField>
            </Col>

            <Col span={24}>
              <FormField label="姓名">
                <Flex align="center" gap={12} wrap>
                  <Switch
                    checked={useUsernameAsName}
                    onChange={setUseUsernameAsName}
                    size="small"
                  />
                  <Typography.Text type="secondary">将用户名作为姓名</Typography.Text>
                  {useUsernameAsName ? (
                    <Input value={username} disabled readOnly style={{ maxWidth: 240 }} />
                  ) : (
                    <Controller
                      control={control}
                      name="name"
                      render={({ field }) => <Input {...field} style={{ maxWidth: 240 }} />}
                    />
                  )}
                </Flex>
              </FormField>
            </Col>

            <Col xs={24} md={12}>
              <FormField label="联系邮箱">
                <Controller
                  control={control}
                  name="email"
                  render={({ field }) => <Input {...field} type="email" />}
                />
              </FormField>
            </Col>
            <Col xs={24} md={12}>
              <FormField label="身份证号">
                <Controller
                  control={control}
                  name="idCard"
                  render={({ field }) => <Input {...field} maxLength={32} />}
                />
              </FormField>
            </Col>
            <Col xs={24} md={12}>
              <FormField label="抖音号">
                <Controller
                  control={control}
                  name="douyinId"
                  render={({ field }) => <Input {...field} maxLength={64} />}
                />
              </FormField>
            </Col>
            <Col span={24}>
              <FormField label="职位">
                <Select
                  mode="multiple"
                  allowClear
                  placeholder="可多选"
                  value={selected}
                  onChange={setSelected}
                  loading={positions.isLoading}
                  options={(positions.data ?? []).map((item) => ({
                    value: item.id,
                    label: item.name,
                  }))}
                />
              </FormField>
            </Col>
          </Row>
          {errorMsg ? <Typography.Text type="danger">{errorMsg}</Typography.Text> : null}
        </Form>
      </Modal>

      {editing ? (
        <EditMemberModal
          member={editing}
          positions={positions.data ?? []}
          positionsLoading={positions.isLoading}
          onClose={() => setEditing(null)}
        />
      ) : null}

      {resetting ? (
        <ResetPasswordModal member={resetting} onClose={() => setResetting(null)} />
      ) : null}

      {detailing ? (
        <MemberDetailModal member={detailing} onClose={() => setDetailing(null)} />
      ) : null}
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
  douyinId: string;
  status: "active" | "disabled";
};

function EditMemberModal({
  member,
  positions,
  positionsLoading,
  onClose,
}: {
  member: Member;
  positions: Position[];
  /** 职位仍在加载时给下拉一个 loading 态，避免已选职位显示成裸 ID */
  positionsLoading?: boolean;
  onClose: () => void;
}) {
  const confirm = useConfirm();
  const update = useUpdateMember();
  const [selected, setSelected] = useState<number[]>(
    member.user_positions
      .map(({ position }) => position?.id)
      .filter((id): id is number => typeof id === "number"),
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<EditFormValues>({
    defaultValues: {
      username: member.username ?? "",
      name: member.name,
      phone: member.phone ?? "",
      email: member.email ?? "",
      hireDate: member.hire_date,
      idCard: member.id_card ?? "",
      douyinId: member.douyin_id ?? "",
      status: member.status,
    },
  });

  async function submit(values: EditFormValues) {
    setErrorMsg(null);
    if (values.status === "disabled" && member.status === "active") {
      const ok = await confirm({
        title: "确认停用账号",
        content: `确认停用「${member.name}」的账号？停用后该成员将无法登录。`,
        okText: "确认停用",
        okButtonProps: { danger: true },
      });
      if (!ok) return;
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
        douyinId: values.douyinId,
        status: values.status,
        positionIds: selected,
      });
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "编辑成员失败，请稍后再试");
    }
  }

  return (
    <Modal
      title={`编辑成员 · ${member.name}`}
      open
      onCancel={onClose}
      onOk={handleSubmit(submit)}
      confirmLoading={update.isPending}
      okText="保存"
      cancelText="取消"
      width={720}
      destroyOnHidden
    >
      <Form layout="vertical" onFinish={handleSubmit(submit)}>
        <Row gutter={16}>
          <Col xs={24} md={12}>
            <FormField
              label="用户名"
              hint="登录账号，唯一"
              error={errors.username ? "请填写用户名" : undefined}
              required
            >
              <Controller
                control={control}
                name="username"
                rules={{ required: true }}
                render={({ field }) => <Input {...field} maxLength={32} />}
              />
            </FormField>
          </Col>
          <Col xs={24} md={12}>
            <FormField label="姓名" error={errors.name ? "请填写姓名" : undefined} required>
              <Controller
                control={control}
                name="name"
                rules={{ required: true }}
                render={({ field }) => <Input {...field} />}
              />
            </FormField>
          </Col>
          <Col xs={24} md={12}>
            <FormField label="手机号">
              <Controller
                control={control}
                name="phone"
                render={({ field }) => <Input {...field} />}
              />
            </FormField>
          </Col>
          <Col xs={24} md={12}>
            <FormField label="联系邮箱" hint="留空可清除">
              <Controller
                control={control}
                name="email"
                render={({ field }) => <Input {...field} type="email" />}
              />
            </FormField>
          </Col>
          <Col xs={24} md={12}>
            <FormField
              label="入职日期"
              error={errors.hireDate ? "请选择入职日期" : undefined}
              required
            >
              <Controller
                control={control}
                name="hireDate"
                rules={{ required: true }}
                render={({ field }) => (
                  <DatePicker
                    style={{ width: "100%" }}
                    value={field.value ? dayjs(field.value) : null}
                    onChange={(date) => field.onChange(date ? date.format("YYYY-MM-DD") : "")}
                  />
                )}
              />
            </FormField>
          </Col>
          <Col xs={24} md={12}>
            <FormField label="身份证号" hint="留空可清除">
              <Controller
                control={control}
                name="idCard"
                render={({ field }) => <Input {...field} maxLength={32} />}
              />
            </FormField>
          </Col>
          <Col xs={24} md={12}>
            <FormField label="抖音号" hint="留空可清除">
              <Controller
                control={control}
                name="douyinId"
                render={({ field }) => <Input {...field} maxLength={64} />}
              />
            </FormField>
          </Col>
          <Col xs={24} md={12}>
            <FormField label="状态">
              <Controller
                control={control}
                name="status"
                render={({ field }) => (
                  <Select
                    {...field}
                    options={[
                      { value: "active", label: "在职" },
                      { value: "disabled", label: "已停用" },
                    ]}
                  />
                )}
              />
            </FormField>
          </Col>
          <Col span={24}>
            <FormField label="职位">
              <Select
                mode="multiple"
                allowClear
                placeholder="可多选"
                value={selected}
                onChange={setSelected}
                loading={positionsLoading}
                options={positions.map((item) => ({ value: item.id, label: item.name }))}
              />
            </FormField>
          </Col>
        </Row>
        {errorMsg ? <Typography.Text type="danger">{errorMsg}</Typography.Text> : null}
      </Form>
    </Modal>
  );
}

function ResetPasswordModal({ member, onClose }: { member: Member; onClose: () => void }) {
  const confirm = useConfirm();
  const update = useUpdateMember();
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function submit() {
    setErrorMsg(null);
    if (password.length < 6 || password.length > 64) {
      setErrorMsg("密码需为 6-64 位");
      return;
    }
    const ok = await confirm({
      title: "确认重置密码",
      content: `确认将「${member.name}」的登录密码重置为新密码？`,
      okText: "确认重置",
      okButtonProps: { danger: true },
    });
    if (!ok) return;
    try {
      await update.mutateAsync({ id: member.id, password });
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "重置密码失败，请稍后再试");
    }
  }

  return (
    <Modal
      title={`重置密码 · ${member.name}`}
      open
      onCancel={onClose}
      onOk={submit}
      confirmLoading={update.isPending}
      okText="重置密码"
      cancelText="取消"
      destroyOnHidden
    >
      <Form layout="vertical" onFinish={submit}>
        <FormField label="新密码" hint="6-64 位" error={errorMsg} required>
          <Input.Password
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            visibilityToggle={{ visible: showPassword, onVisibleChange: setShowPassword }}
            minLength={6}
            maxLength={64}
            placeholder="请输入新密码"
          />
        </FormField>
      </Form>
    </Modal>
  );
}

function MemberDetailModal({ member, onClose }: { member: Member; onClose: () => void }) {
  const positions = member.user_positions
    .map(({ position }) => position?.name)
    .filter((n): n is string => Boolean(n));

  const items = [
    { key: "name", label: "姓名", children: member.name },
    { key: "username", label: "用户名", children: member.username ?? "-" },
    { key: "phone", label: "手机号", children: member.phone || "-" },
    { key: "email", label: "联系邮箱", children: member.email || "-" },
    { key: "idCard", label: "身份证号", children: member.id_card || "-" },
    { key: "douyinId", label: "抖音号", children: member.douyin_id || "-" },
    { key: "hireDate", label: "入职日期", children: member.hire_date },
    {
      key: "role",
      label: "系统角色",
      children: member.system_role === "admin" ? "管理员" : "普通用户",
    },
    {
      key: "status",
      label: "账号状态",
      children: member.status === "active" ? "在职" : "已停用",
    },
    {
      key: "positions",
      label: "职位",
      children: positions.length ? (
        <Space size={4} wrap>
          {positions.map((name) => (
            <Badge key={name}>{name}</Badge>
          ))}
        </Space>
      ) : (
        "-"
      ),
    },
    { key: "createdAt", label: "创建时间", children: member.created_at ?? "-" },
    { key: "updatedAt", label: "更新时间", children: member.updated_at ?? "-" },
  ];

  return (
    <Modal
      title={`成员详情 · ${member.name}`}
      open
      onCancel={onClose}
      footer={<Button onClick={onClose}>关闭</Button>}
      width={720}
    >
      <Descriptions bordered size="small" column={{ xs: 1, sm: 2 }} items={items} />
    </Modal>
  );
}
