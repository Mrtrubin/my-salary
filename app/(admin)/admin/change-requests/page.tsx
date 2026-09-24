"use client";

import { App, Button, Card, Empty, Flex, Input, List, Modal, Space, Typography } from "antd";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/admin/page-header";
import { QueryMessage } from "@/components/admin/query-message";
import { ChangeRequestStatusBadge } from "@/components/admin/status-tag";
import { usePendingChangeRequests, useReviewProfileChanges } from "@/lib/api/hooks";
import { EDITABLE_PROFILE_FIELDS, type ProfileChangeRequest } from "@/lib/api/data";
import { formatDateTime } from "@/lib/format";

const FIELD_LABEL: Record<string, string> = {
  ...EDITABLE_PROFILE_FIELDS.reduce(
    (acc, item) => ({ ...acc, [item.field]: item.label }),
    {} as Record<string, string>,
  ),
  password: "登录密码",
};

type Group = { profileId: string; name: string; items: ProfileChangeRequest[] };

export default function ChangeRequestsPage() {
  const { message } = App.useApp();
  const query = usePendingChangeRequests();
  const review = useReviewProfileChanges();
  const [keyword, setKeyword] = useState("");
  const [rejecting, setRejecting] = useState<{ ids: string[]; title: string } | null>(null);
  const [reason, setReason] = useState("");

  // 只有真正在途的那些申请才转圈，否则点一条会让整页所有按钮一起转
  const pendingIds = useMemo(() => new Set(review.variables?.ids ?? []), [review.variables]);

  const groups = useMemo<Group[]>(() => {
    const kw = keyword.trim().toLowerCase();
    const map = new Map<string, Group>();
    for (const item of query.data ?? []) {
      const name = item.profile?.name ?? "未知成员";
      if (kw && !name.toLowerCase().includes(kw)) continue;
      const g = map.get(item.profile_id) ?? { profileId: item.profile_id, name, items: [] };
      g.items.push(item);
      map.set(item.profile_id, g);
    }
    return [...map.values()];
  }, [query.data, keyword]);

  async function approve(ids: string[]) {
    try {
      await review.mutateAsync({ ids, action: "approve" });
      message.success(`已通过 ${ids.length} 项申请`);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "审核失败，请稍后重试");
    }
  }

  async function confirmReject() {
    if (!rejecting || !reason.trim()) return;
    try {
      await review.mutateAsync({ ids: rejecting.ids, action: "reject", reason: reason.trim() });
      setRejecting(null);
      setReason("");
      message.success(`已驳回 ${rejecting.ids.length} 项申请`);
    } catch (err) {
      // 失败时保留弹窗与已填原因，方便重试
      message.error(err instanceof Error ? err.message : "驳回失败，请稍后重试");
    }
  }

  return (
    <>
      <PageHeader
        title="资料审核"
        description="成员提交的资料修改申请，逐字段审核；通过后写入成员资料"
      />

      <Card
        title="待审核申请"
        extra={
          <Input.Search
            allowClear
            style={{ width: 220 }}
            placeholder="搜索成员姓名"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
          />
        }
      >
        <QueryMessage loading={query.isLoading} error={query.error} />

        {!query.isLoading && !query.error ? (
          groups.length ? (
            <Flex vertical gap={16}>
              {groups.map((group) => {
                const allIds = group.items.map((item) => item.id);
                return (
                  <Card
                    key={group.profileId}
                    size="small"
                    title={group.name}
                    extra={
                      <Space>
                        <Button
                          type="primary"
                          size="small"
                          loading={review.isPending && allIds.every((id) => pendingIds.has(id))}
                          onClick={() => approve(allIds)}
                        >
                          一键同意
                        </Button>
                        <Button
                          danger
                          size="small"
                          onClick={() =>
                            setRejecting({
                              ids: allIds,
                              title: `驳回 ${group.name} 的全部 ${allIds.length} 项申请`,
                            })
                          }
                        >
                          全部驳回
                        </Button>
                      </Space>
                    }
                  >
                    <Typography.Text type="secondary">
                      {group.items.length} 项待审核
                    </Typography.Text>
                    <List
                      size="small"
                      dataSource={group.items}
                      renderItem={(item) => (
                        <List.Item
                          actions={[
                            <Button
                              key="approve"
                              size="small"
                              loading={review.isPending && pendingIds.has(item.id)}
                              onClick={() => approve([item.id])}
                            >
                              通过
                            </Button>,
                            <Button
                              key="reject"
                              size="small"
                              danger
                              onClick={() =>
                                setRejecting({
                                  ids: [item.id],
                                  title: `驳回「${FIELD_LABEL[item.field] ?? item.field}」修改申请`,
                                })
                              }
                            >
                              驳回
                            </Button>,
                          ]}
                        >
                          <Flex align="center" gap={8} wrap style={{ minWidth: 0 }}>
                            <Typography.Text strong>
                              {FIELD_LABEL[item.field] ?? item.field}
                            </Typography.Text>
                            {item.field === "password" ? (
                              <Typography.Text>重置为新密码（已加密，管理员不可见）</Typography.Text>
                            ) : (
                              <Typography.Text>
                                {item.old_value || "（空）"} →{" "}
                                <Typography.Text strong>
                                  {item.new_value || "（清空）"}
                                </Typography.Text>
                              </Typography.Text>
                            )}
                            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                              {formatDateTime(item.created_at)}
                            </Typography.Text>
                            <ChangeRequestStatusBadge status={item.status} />
                          </Flex>
                        </List.Item>
                      )}
                    />
                  </Card>
                );
              })}
            </Flex>
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无待审核申请" />
          )
        ) : null}
      </Card>

      <Modal
        title={rejecting?.title ?? "驳回申请"}
        open={Boolean(rejecting)}
        onCancel={() => {
          setRejecting(null);
          setReason("");
        }}
        onOk={confirmReject}
        okText="确认驳回"
        okButtonProps={{ danger: true, disabled: !reason.trim(), loading: review.isPending }}
        cancelText="取消"
        destroyOnHidden
      >
        <Input.TextArea
          rows={3}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="请输入驳回原因（将展示给成员）"
        />
      </Modal>
    </>
  );
}
