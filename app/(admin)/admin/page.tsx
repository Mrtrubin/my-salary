"use client";

import { Card, Col, Flex, Row, Typography } from "antd";
import dayjs from "dayjs";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/admin/page-header";
import { QueryMessage } from "@/components/admin/query-message";
import { StatCard } from "@/components/admin/stat-card";
import { TimeRangeFilter } from "@/components/admin/time-range-filter";
import { getPresetRange, type PeriodRange } from "@/lib/domain/settlement/cycle";
import {
  useHostSalaryRecords,
  useLedgerSummary,
  useMembers,
  usePendingChangeRequests,
  useSalaryRecords,
  useStaffSalaryRecords,
  useTeams,
} from "@/lib/api/hooks";
import { formatCentsToYuan } from "@/lib/format";
import { LedgerCharts } from "./ledger/LedgerCharts";

const { Text } = Typography;

export default function AdminHomePage() {
  const [range, setRange] = useState<PeriodRange>(() => getPresetRange("thisMonth"));

  const members = useMembers();
  const teams = useTeams();
  const anchorSalary = useSalaryRecords();
  const hostSalary = useHostSalaryRecords();
  const staffSalary = useStaffSalaryRecords();
  const changeRequests = usePendingChangeRequests();
  const ledger = useLedgerSummary(range);

  const loading =
    members.isLoading ||
    teams.isLoading ||
    anchorSalary.isLoading ||
    hostSalary.isLoading ||
    staffSalary.isLoading ||
    changeRequests.isLoading ||
    ledger.isLoading;
  const error =
    members.error ||
    teams.error ||
    anchorSalary.error ||
    hostSalary.error ||
    staffSalary.error ||
    changeRequests.error ||
    ledger.error;

  // 本地月份而非 toISOString()（UTC）：CST 每月 1 日凌晨会算成上个月。
  const currentMonth = dayjs().format("YYYY-MM");
  const allSalary = useMemo(
    () => [...(anchorSalary.data ?? []), ...(hostSalary.data ?? []), ...(staffSalary.data ?? [])],
    [anchorSalary.data, hostSalary.data, staffSalary.data],
  );
  const monthRecords = allSalary.filter((item) => item.month.slice(0, 7) === currentMonth);
  const monthNet = monthRecords
    .filter((item) => item.status === "completed")
    .reduce((sum, item) => sum + item.net_cents, 0);
  const monthCompleted = monthRecords.filter((item) => item.status === "completed").length;
  const pendingReview = allSalary.filter((item) => item.status === "pending_review").length;
  const pendingConfirm = allSalary.filter((item) => item.status === "pending_confirm").length;

  const totalMembers = members.data?.length ?? 0;
  const activeMembers = members.data?.filter((item) => item.status === "active").length ?? 0;
  const teamCount = teams.data?.length ?? 0;
  const pendingChange = changeRequests.data?.length ?? 0;

  return (
    <>
      <PageHeader title="控制台" description={`${currentMonth} 核算周期 · Supabase 实时数据`} />
      <QueryMessage loading={loading} error={error} />
      {!loading && !error ? (
        <>
          <Card
            title="经营收支"
            extra={
              <Flex align="center" gap={12} wrap>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {range.start} ~ {range.end}
                </Text>
                <TimeRangeFilter value={range} onChange={(next) => next && setRange(next)} />
              </Flex>
            }
          >
            <Row gutter={[16, 16]}>
              <Col xs={24} sm={8}>
                <StatCard label="收入" value={formatCentsToYuan(ledger.data?.incomeCents ?? 0)} accent="positive" />
              </Col>
              <Col xs={24} sm={8}>
                <StatCard label="支出" value={formatCentsToYuan(ledger.data?.expenseCents ?? 0)} accent="negative" />
              </Col>
              <Col xs={24} sm={8}>
                <StatCard label="结余" value={formatCentsToYuan(ledger.data?.netCents ?? 0)} />
              </Col>
            </Row>
            {ledger.data ? <LedgerCharts summary={ledger.data} /> : null}
          </Card>

          <Card title="工资核算进度" style={{ marginTop: 16 }}>
            <Row gutter={[16, 16]}>
              <Col xs={24} sm={12} xl={6}>
                <StatCard label="本月实发工资" value={formatCentsToYuan(monthNet)} />
              </Col>
              <Col xs={24} sm={12} xl={6}>
                <StatCard label="本月核算进度" value={`${monthCompleted}/${monthRecords.length}`} />
              </Col>
              <Col xs={24} sm={12} xl={6}>
                <StatCard label="待审核工资" value={`${pendingReview} 条`} />
              </Col>
              <Col xs={24} sm={12} xl={6}>
                <StatCard label="待确认到账" value={`${pendingConfirm} 条`} />
              </Col>
            </Row>
          </Card>

          <Card title="人员与团队" style={{ marginTop: 16 }}>
            <Row gutter={[16, 16]}>
              <Col xs={24} sm={12}>
                <StatCard label="在职成员" value={`${activeMembers}/${totalMembers}`} hint="在职 / 总成员" />
              </Col>
              <Col xs={24} sm={12}>
                <StatCard label="团队数量" value={`${teamCount} 个`} />
              </Col>
            </Row>
          </Card>

          <Card title="待办事项" style={{ marginTop: 16 }}>
            <Row gutter={[16, 16]}>
              <Col xs={24} sm={8}>
                <StatCard label="待审核资料变更" value={`${pendingChange} 条`} />
              </Col>
              <Col xs={24} sm={8}>
                <StatCard label="待审核工资" value={`${pendingReview} 条`} />
              </Col>
              <Col xs={24} sm={8}>
                <StatCard label="待确认到账" value={`${pendingConfirm} 条`} />
              </Col>
            </Row>
          </Card>
        </>
      ) : null}
    </>
  );
}
