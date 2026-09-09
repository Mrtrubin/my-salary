/**
 * 展示层格式化工具。
 * 金额内部一律以「分」存整数；比例以「基点」(bps) 表示（10000 bps = 100%）。
 */
import type { AmountInCents, RateInBps } from "@/lib/api/contracts/common";

/** 分 → 人民币展示（带千分位，保留两位小数），允许负数。 */
export function formatCentsToYuan(cents: AmountInCents): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const yuan = Math.floor(abs / 100);
  const fen = String(abs % 100).padStart(2, "0");
  return `${sign}¥${yuan.toLocaleString("zh-CN")}.${fen}`;
}

/** 基点 → 百分比文本，例如 300 bps → "3%"。 */
export function formatBpsAsPercent(bps: RateInBps): string {
  const pct = bps / 100;
  return `${Number.isInteger(pct) ? pct : pct.toFixed(2)}%`;
}

/** "2026-08" → "2026年8月"。 */
export function formatMonth(month: string): string {
  const [y, m] = month.split("-");
  return `${y}年${Number(m)}月`;
}

/** 当前月份 "YYYY-MM"。 */
export function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/** ISO时间戳 → 本地完整日期时间，例如 "2026-09-08 14:30:05"。空值返回 "—"。 */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}