"use client";

import { Fragment, useMemo, useState } from "react";
import { Tab, TabList, TabPanel, Tabs } from "@heroui/react";
import { SalaryRecordStatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { QueryMessage } from "@/components/query-message";
import { COMMISSION_BASE_RATE_BPS } from "@/lib/domain/payroll/types";
import type { PayrollAdjustment } from "@/lib/domain/payroll/adjustment";
import { Select } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import {
  useCurrentProfile,
  useMembers,
  usePositions,
  useRejectAndRecompute,
  useSalaryRecords,
  useSalaryStatusLogs,
  useTransitionSalaryStatus,
} from "@/lib/api/hooks";
import type { SalaryRecord } from "@/lib/api/data";
import { formatBpsAsPercent, formatCentsToYuan, formatDateTime } from "@/lib/format";

/** 状态变更历史时间轴（展开某条工资条时按需加载，精确到秒）。 */
function StatusTimeline({ recordId }: { recordId: string }) {
  const logs = useSalaryStatusLogs(recordId);
  const labels: Record<string, string> = {
    pending_review: "待审核",
    pending_confirm: "待确认",
    confirmed: "已确认",
    completed: "已完成",
  };
  return (
    <div className="bg-slate-50 p-3 text-xs">
      <QueryMessage loading={logs.isLoading} error={logs.error} empty={!logs.data?.length} />
      <ol className="space-y-1">
        {logs.data?.map((log) => (
          <li key={log.id} className="flex items-center gap-2">
            <span className="text-slate-400">{formatDateTime(log.created_at)}</span>
            <span>
              {log.from_status ? `${labels[log.from_status] ?? log.from_status} → ` : ""}
              {labels[log.to_status] ?? log.to_status}
            </span>
            {log.operator?.name ? <span className="text-slate-400">· {log.operator.name}</span> : null}
            {log.note ? <span className="text-slate-500">（{log.note}）</span> : null}
          </li>
        ))}
      </ol>
    </div>
  );
}

/** 周期标签：优先用 period_start ~ period_end，否则回退 month。 */
function periodLabel(item: SalaryRecord): string {
  if (item.period_start && item.period_end) {
    return `${item.period_start} ~ ${item.period_end}`;
  }
  return item.month.slice(0, 7);
}

const DEFAULT_POSITION_TABS = [
  { code: "anchor", name: "主播" },
  { code: "host", name: "主持" },
  { code: "dance", name: "舞蹈老师" },
  { code: "makeup", name: "化妆师" },
];

const ANCHOR_COLUMN_COUNT = 22;

/** 读取结算时保存的调整项，不读取流水页尚未结算的临时输入。 */
function readAdjustments(value: SalaryRecord["adjustments"]): PayrollAdjustment[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    if (typeof entry.name !== "string" || typeof entry.amountCents !== "number" || !Number.isSafeInteger(entry.amountCents)) return [];
    return [{ name: entry.name, amountCents: entry.amountCents }];
  });
}

function signedAmount(cents: number): string {
  return `${cents > 0 ? "+" : ""}${formatCentsToYuan(cents)}`;
}

export default function PayrollPage() {
  const salary = useSalaryRecords();
  const members = useMembers();
  const positions = usePositions();
  const me = useCurrentProfile();
  const transition = useTransitionSalaryStatus();
  const reject = useRejectAndRecompute();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // 驳回重算的行内反馈：记录正在处理的行 id，以及每行最近一次操作结果提示。
  const [recomputingId, setRecomputingId] = useState<string | null>(null);
  const [recomputeFeedback, setRecomputeFeedback] = useState<{ id: string; ok: boolean; message: string } | null>(null);

  function handleReject(id: string) {
    setRecomputeFeedback(null);
    setRecomputingId(id);
    reject.mutate(
      { id, operatorProfileId },
      {
        onSuccess: () => setRecomputeFeedback({ id, ok: true, message: "驳回重算成功，已按当前流水重新计算" }),
        onError: (err) => setRecomputeFeedback({ id, ok: false, message: err instanceof Error ? err.message : "驳回重算失败" }),
        onSettled: () => setRecomputingId(null),
      },
    );
  }

  // 筛选状态
  const [memberId, setMemberId] = useState("");
  const [period, setPeriod] = useState("");
  const [status, setStatus] = useState("");
  const [activePosition, setActivePosition] = useState("anchor");

  const operatorProfileId = me.data?.id;
  // 职位标签独立于工资记录，未结算或筛选为空时也不会消失。
  const positionTabs = useMemo(() => {
    const map = new Map(DEFAULT_POSITION_TABS.map((position) => [position.code, position]));
    for (const position of positions.data ?? []) map.set(position.code, position);
    return Array.from(map.values());
  }, [positions.data]);

  const anchorRecords = useMemo(
    () => (salary.data ?? []).filter((item) => item.position?.code === "anchor"),
    [salary.data],
  );
  const anchorMembers = useMemo(() => {
    const profileIds = new Set(anchorRecords.map((item) => item.profile_id));
    return (members.data ?? []).filter((member) => profileIds.has(member.id));
  }, [anchorRecords, members.data]);

  const periods = useMemo(
    () => Array.from(new Set(anchorRecords.map(periodLabel))).sort((a, b) => b.localeCompare(a)),
    [anchorRecords],
  );

  const filtered = useMemo(() => anchorRecords.filter((item) => {
    if (memberId && item.profile_id !== memberId) return false;
    if (period && periodLabel(item) !== period) return false;
    if (status && item.status !== status) return false;
    return true;
  }), [anchorRecords, memberId, period, status]);

  return (
    <Tabs className="w-full min-w-0 gap-5" selectedKey={activePosition} onSelectionChange={(key) => {
      setActivePosition(String(key));
      setExpandedId(null);
    }}>
      <div className="max-w-full self-start overflow-x-auto rounded-2xl border border-slate-200/80 bg-slate-100/80 p-1">
        <TabList aria-label="工资条职位" className="gap-1 p-0">
          {positionTabs.map((position) => (
            <Tab
              key={position.code}
              id={position.code}
              className="h-10 w-auto shrink-0 gap-2 whitespace-nowrap rounded-xl px-5 text-slate-500 hover:bg-white/60 data-[selected=true]:bg-white data-[selected=true]:font-semibold data-[selected=true]:text-indigo-600 data-[selected=true]:shadow-sm data-[focus-visible=true]:outline-2 data-[focus-visible=true]:outline-offset-[-2px] data-[focus-visible=true]:outline-indigo-500"
            >
              {position.name}
            </Tab>
          ))}
        </TabList>
      </div>
      <TabPanel id="anchor" className="m-0 min-w-0 space-y-4 p-0">
      <Card>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <Select
            value={memberId}
            placeholder="全部主播"
            options={[{ id: "", name: "全部主播" }, ...anchorMembers.map((m) => ({ id: m.id, name: m.name }))]}
            onChange={setMemberId}
          />
          <Select
            value={period}
            placeholder="全部周期"
            options={[{ id: "", name: "全部周期" }, ...periods.map((p) => ({ id: p, name: p }))]}
            onChange={setPeriod}
          />
          <Select
            value={status}
            placeholder="全部状态"
            options={[
              { id: "", name: "全部状态" },
              { id: "pending_review", name: "待审核" },
              { id: "pending_confirm", name: "待确认" },
              { id: "confirmed", name: "已确认" },
              { id: "completed", name: "已完成" },
            ]}
            onChange={setStatus}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader
          title="主播工资条"
          description={`共 ${filtered.length} 条记录 · 金额单位：元 · 左右滑动查看全部字段`}
        />
        <CardContent className="p-0">
          <QueryMessage loading={salary.isLoading} error={salary.error} empty={!filtered.length} />
          <Table>
                <THead>
                  <TH isRowHeader>主播姓名</TH>
                  <TH>结算周期</TH>
                  <TH>主播类型</TH>
                  <TH className="text-left">保底金额</TH>
                  <TH className="text-left">总音浪</TH>
                  <TH className="text-left">总流水</TH>
                  <TH className="text-left">拿提点门槛</TH>
                  <TH className="text-left">拿保底门槛</TH>
                  <TH>是否达标</TH>
                  <TH className="text-left">基础提成率</TH>
                  <TH className="text-left">阶梯提点</TH>
                  <TH className="text-left">考勤加点</TH>
                  <TH className="text-left">dy任务加点</TH>
                  <TH className="text-left">最终提成率</TH>
                  <TH className="text-left">基础收益</TH>
                  <TH>调整项</TH>
                  <TH className="text-left">实发收益</TH>
                  <TH className="text-left">服务费</TH>
                  <TH className="text-left">到手工资</TH>
                  <TH>备注</TH>
                  <TH>状态</TH>
                  <TH className="text-left">操作</TH>
                </THead>
                <TBody>
                  {filtered.map((item) => {
                        const adjustments = readAdjustments(item.adjustments);
                        const adjustmentTotal = adjustments.reduce((sum, adjustment) => sum + adjustment.amountCents, 0);
                        // 展示历史结算快照，不能按新公式重算已结算工资。
                        const baseIncome = item.gross_cents - adjustmentTotal;
                        const stepRate = Math.max(0, item.commission_rate_bps - COMMISSION_BASE_RATE_BPS);
                        return (
                        <Fragment key={item.id}>
                          <TR>
                            <TD>
                              <button className="text-indigo-600 hover:underline" onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}>
                                {item.profile?.name ?? "未关联"}
                              </button>
                            </TD>
                            <TD><span className="whitespace-nowrap text-xs">{periodLabel(item)}</span></TD>
                            <TD>{item.is_grace_period ? "新主播" : "老主播"}</TD>
                            <TD className="text-left tabular-nums">{formatCentsToYuan(item.base_guarantee_cents)}</TD>
                            <TD className="text-left tabular-nums">
                              <span title="按总流水 × 10 折算，非原始录入音浪">{(item.revenue_cents / 10).toLocaleString("zh-CN", { maximumFractionDigits: 1 })}</span>
                            </TD>
                            <TD className="text-left tabular-nums">{formatCentsToYuan(item.revenue_cents)}</TD>
                            <TD className="text-left tabular-nums">{formatCentsToYuan(item.commission_start_cents)}</TD>
                            <TD className="text-left tabular-nums">{formatCentsToYuan(item.threshold_cents)}</TD>
                            <TD>{item.is_qualified ? "达标" : "未达标"}</TD>
                            <TD className="text-left tabular-nums">{formatBpsAsPercent(COMMISSION_BASE_RATE_BPS)}</TD>
                            <TD className="text-left tabular-nums">{formatBpsAsPercent(stepRate)}</TD>
                            <TD className="text-left"><span title="暂未接入考勤加点，不将金额调整项作为提点">—</span></TD>
                            <TD className="text-left"><span title="暂未接入抖音任务加点">—</span></TD>
                            <TD className="text-left tabular-nums"><span title={item.commission_rate_bps === 0 ? "本次结算未计提成" : "本次结算实际采用的提成率"}>{formatBpsAsPercent(item.commission_rate_bps)}</span></TD>
                            <TD className="text-left tabular-nums"><span title="已结算实发收益扣除调整项合计">{formatCentsToYuan(baseIncome)}</span></TD>
                            <TD>
                              {adjustments.length ? (
                                <div className="space-y-1 text-xs">
                                  {adjustments.map((adjustment, index) => (
                                    <div key={index} className="flex justify-between gap-3">
                                      <span className="max-w-48 whitespace-normal break-words">{adjustment.name}</span>
                                      <span className={`tabular-nums ${adjustment.amountCents < 0 ? "text-red-600" : "text-emerald-600"}`}>{signedAmount(adjustment.amountCents)}</span>
                                    </div>
                                  ))}
                                  <div className="flex justify-between gap-3 border-t border-slate-100 pt-1 font-semibold">
                                    <span>合计</span><span className="tabular-nums">{signedAmount(adjustmentTotal)}</span>
                                  </div>
                                </div>
                              ) : "—"}
                            </TD>
                            <TD className="text-left tabular-nums">{formatCentsToYuan(item.gross_cents)}</TD>
                            <TD className="text-left tabular-nums">{formatCentsToYuan(item.service_fee_cents)}</TD>
                            <TD className="text-left font-semibold tabular-nums">{formatCentsToYuan(item.net_cents)}</TD>
                            <TD><span title="当前工资记录暂无备注字段">—</span></TD>
                            <TD><SalaryRecordStatusBadge status={item.status} /></TD>
                            <TD className="text-left">
                              <span className="flex justify-start gap-1">
                                {item.status === "pending_review" ? (
                                  <>
                                    <Button variant="secondary" size="sm" onClick={() => transition.mutate({ id: item.id, status: "pending_confirm", operatorProfileId, note: "管理员审核通过" })}>通过</Button>
                                    <Button variant="ghost" size="sm" disabled={recomputingId === item.id} onClick={() => handleReject(item.id)}>{recomputingId === item.id ? "重算中…" : "驳回重算"}</Button>
                                  </>
                                ) : null}
                                {item.status === "confirmed" ? (
                                  <Button variant="secondary" size="sm" onClick={() => transition.mutate({ id: item.id, status: "completed", operatorProfileId, note: "管理员确认到账" })}>确认到账</Button>
                                ) : null}
                              </span>
                              {recomputeFeedback?.id === item.id ? (
                                <p className={`mt-1 text-left text-xs ${recomputeFeedback.ok ? "text-emerald-600" : "text-red-600"}`}>
                                  {recomputeFeedback.message}
                                </p>
                              ) : null}
                            </TD>
                          </TR>
                          {expandedId === item.id ? (
                            <TR>
                              <TD colSpan={ANCHOR_COLUMN_COUNT}>
                                <div className="space-y-2">
                                  <StatusTimeline recordId={item.id} />
                                  {/* 该条记录的计算参数明细（主播展示阶梯提点相关参数） */}
                                  <div className="bg-slate-50 p-3 text-xs text-slate-600">
                                    <p>在职月序：{item.tenure_month} 月</p>
                                    <p>保底基准：{formatCentsToYuan(item.base_guarantee_cents)}</p>
                                    <p>达标门槛：{formatCentsToYuan(item.threshold_cents)}</p>
                                    <p>提成起征：{formatCentsToYuan(item.commission_start_cents)}</p>
                                  </div>
                                </div>
                              </TD>
                            </TR>
                          ) : null}
                        </Fragment>
                        );
                  })}
                </TBody>
              </Table>
            </CardContent>
          </Card>
        </TabPanel>
        {positionTabs.filter((position) => position.code !== "anchor").map((position) => (
          <TabPanel key={position.code} id={position.code} className="m-0 min-w-0 p-0">{null}</TabPanel>
        ))}
      </Tabs>
  );
}