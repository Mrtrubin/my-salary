"use client";

import { App, Button, Card, Col, Input, Modal, Row, Select, Tag } from "antd";
import { useState } from "react";
import { FormField } from "@/components/admin/form-field";
import { PageHeader } from "@/components/admin/page-header";
import { QueryMessage } from "@/components/admin/query-message";
import { ResizableTable } from "@/components/admin/resizable-table";
import { zebraRowClassName } from "@/components/admin/table-zebra";
import { useConfirm } from "@/components/admin/use-confirm";
import type { LedgerTag } from "@/lib/api/data";
import {
  useCreateLedgerTag,
  useDeleteLedgerTag,
  useLedgerTags,
  useUpdateLedgerTag,
} from "@/lib/api/hooks";

export default function LedgerTagsPage() {
  const { message } = App.useApp();
  const confirm = useConfirm();
  const tags = useLedgerTags();
  const create = useCreateLedgerTag();
  const update = useUpdateLedgerTag();
  const remove = useDeleteLedgerTag();

  const [name, setName] = useState("");
  const [editing, setEditing] = useState<LedgerTag | null>(null);
  const [editName, setEditName] = useState("");
  const [editStatus, setEditStatus] = useState<"active" | "disabled">("active");

  async function add() {
    if (!name.trim()) {
      message.warning("请填写标签名称");
      return;
    }
    try {
      await create.mutateAsync({ name: name.trim() });
      setName("");
      message.success("标签已新增");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "新增失败，请稍后重试");
    }
  }

  function openEdit(tag: LedgerTag) {
    setEditing(tag);
    setEditName(tag.name);
    setEditStatus(tag.status);
  }

  async function submitEdit() {
    if (!editing) return;
    if (!editName.trim()) {
      message.warning("请填写标签名称");
      return;
    }
    try {
      await update.mutateAsync({ id: editing.id, name: editName.trim(), status: editStatus });
      setEditing(null);
      message.success("标签已保存");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "保存失败，请稍后重试");
    }
  }

  async function removeTag(tag: LedgerTag) {
    const ok = await confirm({
      title: "确认删除标签",
      content: `确认删除「${tag.name}」？历史流水上的该标签会被清空，不影响流水金额。`,
      okText: "确认删除",
      okButtonProps: { danger: true },
    });
    if (!ok) return;
    remove.mutate(tag.id, {
      onError: (err) => message.error(err instanceof Error ? err.message : "删除失败，请稍后重试"),
    });
  }

  return (
    <>
      <PageHeader
        title="收支标签"
        description="维护收支明细使用的标签。系统标签（工资、其他收入/支出）不可改名或删除；自定义标签可增删改。"
      />
      <Card title="标签列表">
        {tags.error ? (
          <QueryMessage loading={false} error={tags.error} />
        ) : (
          <ResizableTable<LedgerTag>
            rowClassName={zebraRowClassName}
            rowKey="id"
            loading={tags.isLoading}
            dataSource={tags.data ?? []}
            locale={{ emptyText: "暂无标签" }}
            columns={[
              { title: "名称", dataIndex: "name", width: 200 },
              { title: "标识（code）", dataIndex: "code", minWidth: 200 },
              {
                title: "类型",
                key: "system",
                width: 120,
                render: (_, record) => (record.is_system ? <Tag color="blue">系统</Tag> : <Tag>自定义</Tag>),
              },
              {
                title: "状态",
                dataIndex: "status",
                width: 100,
                render: (value: string) => (value === "active" ? "启用" : "停用"),
              },
              {
                title: "操作",
                key: "action",
                width: 140,
                render: (_, record) =>
                  record.is_system ? (
                    <span style={{ color: "rgba(0,0,0,0.35)" }}>不可修改</span>
                  ) : (
                    <Row gutter={4}>
                      <Col>
                        <Button type="link" size="small" onClick={() => openEdit(record)}>
                          编辑
                        </Button>
                      </Col>
                      <Col>
                        <Button
                          type="link"
                          size="small"
                          danger
                          loading={remove.isPending && remove.variables === record.id}
                          onClick={() => removeTag(record)}
                        >
                          删除
                        </Button>
                      </Col>
                    </Row>
                  ),
              },
            ]}
          />
        )}

        <Row gutter={16} align="bottom" style={{ marginTop: 24 }}>
          <Col xs={24} sm={10} md={8}>
            <FormField label="新增标签名称">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="如 办公支出" maxLength={30} />
            </FormField>
          </Col>
          <Col xs={24} sm={6} md={4}>
            <div style={{ marginBottom: 16 }}>
              <Button type="primary" onClick={add} loading={create.isPending}>
                + 新增标签
              </Button>
            </div>
          </Col>
        </Row>
      </Card>

      <Modal
        title="编辑标签"
        open={editing !== null}
        onCancel={() => setEditing(null)}
        onOk={submitEdit}
        confirmLoading={update.isPending}
        okText="保存"
        cancelText="取消"
        destroyOnHidden
      >
        <FormField label="名称" required>
          <Input value={editName} onChange={(e) => setEditName(e.target.value)} maxLength={30} />
        </FormField>
        <FormField label="状态">
          <Select
            value={editStatus}
            onChange={setEditStatus}
            options={[
              { value: "active", label: "启用" },
              { value: "disabled", label: "停用" },
            ]}
          />
        </FormField>
      </Modal>
    </>
  );
}
