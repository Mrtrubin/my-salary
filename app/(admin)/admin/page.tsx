"use client";

import { Card, Col, Row } from "antd";
import dayjs from "dayjs";
import { PageHeader } from "@/components/admin/page-header";
import { QueryMessage } from "@/components/admin/query-message";
import { StatCard } from "@/components/admin/stat-card";
import { useMembers, useSalaryRecords } from "@/lib/api/hooks";
import { formatCentsToYuan } from "@/lib/format";

export default function AdminHomePage() {
  const members = useMembers();
  const salary = useSalaryRecords();
  const loading = members.isLoading || salary.isLoading;
  const error = members.error || salary.error;
  const payroll = salary.data ?? [];
  // 用本地月份而非 toISOString()（UTC）：CST 每月 1 日凌晨会算成上个月
  const currentMonth = dayjs().format("YYYY-MM");
  const monthNet = payroll
    .filter((item) => item.month.slice(0, 7) === currentMonth && item.status === "completed")
    .reduce((sum, item) => sum + item.net_cents, 0);
  const pendingReview = payroll.filter((item) => item.status === "pending_review").length;
  const activeMembers = members.data?.filter((item) => item.status === "active").length ?? 0;

  return (
    <>
      <PageHeader title="控制台" description={`${currentMonth} 核算周期 · Supabase 实时数据`} />
      <QueryMessage loading={loading} error={error} />
      {!loading && !error ? (
        <>
          <Row gutter={[16, 16]}>
            <Col xs={24} sm={12} xl={8}>
              <StatCard label="本月实发工资" value={formatCentsToYuan(monthNet)} />
            </Col>
            <Col xs={24} sm={12} xl={8}>
              <StatCard
                label="工资核算进度"
                value={`${payroll.length - pendingReview}/${payroll.length}`}
              />
            </Col>
            <Col xs={24} sm={12} xl={8}>
              <StatCard label="待审核工资" value={`${pendingReview} 条`} />
            </Col>
          </Row>

          <Card title="团队概览" style={{ marginTop: 16 }}>
            在职成员 {activeMembers} / {members.data?.length ?? 0}
          </Card>
        </>
      ) : null}
    </>
  );
}
