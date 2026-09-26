/**
 * 业绩汇总文案：上传页「提交汇总」与业绩卡片「复制」共用同一格式。
 *
 * 输出示例：
 *   9月6日 水晶之恋
 *   开播情况汇总
 *   总开播时 6.1
 *   个人业绩
 *   甲：12,345（音浪）
 *   乙：休息
 *   总音浪 12,345
 */

/** "YYYY-MM-DD" → "M月D日"。 */
export function shortDate(value: string): string {
  const [, m, d] = value.slice(0, 10).split("-");
  return `${Number(m)}月${Number(d)}日`;
}

/** 开播分钟 → 小时展示（整除去小数）。 */
export function toHoursText(minutes: number): string {
  const h = minutes / 60;
  return Number.isInteger(h) ? String(h) : h.toFixed(1);
}

/** 参与汇总的单个主播。 */
export interface PerfCopyMember {
  name: string;
  noPerf: boolean;
  /** 休息/停播备注；正常流水为 null。 */
  note: string | null;
  pointsAmount: number;
  pointId: string | null;
  pointName: string | null;
}

export interface PerfCopyInput {
  perfDate: string;
  teamName: string;
  /** 该团队当日的「总开播时」（分钟）。 */
  broadcastMinutes: number;
  members: PerfCopyMember[];
}

/** 构造复制到剪贴板的纯文本（与业绩卡片一致）。 */
export function buildPerformanceCopyText(input: PerfCopyInput): string {
  const byPoint = new Map<string, { name: string; total: number }>();
  for (const member of input.members) {
    if (member.noPerf) continue;
    const key = member.pointId ?? member.pointName ?? "";
    const cur = byPoint.get(key) ?? { name: member.pointName ?? "", total: 0 };
    cur.total += member.pointsAmount;
    byPoint.set(key, cur);
  }
  const points = Array.from(byPoint.values());
  const singleUnit = points.length <= 1;

  const lines: string[] = [];
  lines.push(`${shortDate(input.perfDate)} ${input.teamName}`);
  lines.push("开播情况汇总");
  lines.push(`总开播时 ${toHoursText(input.broadcastMinutes)}`);
  lines.push("个人业绩");
  for (const member of input.members) {
    if (member.noPerf) {
      lines.push(`${member.name}：${member.note || "休息"}`);
    } else {
      const amount = member.pointsAmount.toLocaleString();
      lines.push(`${member.name}：${singleUnit ? amount : `${amount}（${member.pointName ?? ""}）`}`);
    }
  }
  if (singleUnit) {
    lines.push(`总${points[0]?.name || "音浪"} ${(points[0]?.total ?? 0).toLocaleString()}`);
  } else {
    points.forEach((p) => lines.push(`总${p.name} ${p.total.toLocaleString()}`));
  }
  return lines.join("\n");
}
