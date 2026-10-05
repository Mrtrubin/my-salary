import dayjs from "dayjs";
import { describe, expect, it } from "vitest";
import { currentMonthRange, currentYearRange, directionOf, toSignedCents } from "@/lib/domain/ledger";

describe("toSignedCents", () => {
  it("收入为正、支出为负", () => {
    expect(toSignedCents(100, "income")).toBe(10000);
    expect(toSignedCents(100, "expense")).toBe(-10000);
  });

  it("保留两位小数并四舍五入", () => {
    expect(toSignedCents(12.345, "income")).toBe(1235);
    expect(toSignedCents(0.1, "expense")).toBe(-10);
  });

  it("非法或非正金额返回 null", () => {
    expect(toSignedCents(null, "income")).toBeNull();
    expect(toSignedCents(0, "income")).toBeNull();
    expect(toSignedCents(-5, "expense")).toBeNull();
    expect(toSignedCents(Number.NaN, "income")).toBeNull();
  });
});

describe("directionOf", () => {
  it(">= 0 收入，< 0 支出", () => {
    expect(directionOf(0)).toBe("income");
    expect(directionOf(123)).toBe("income");
    expect(directionOf(-1)).toBe("expense");
  });
});

describe("日期区间", () => {
  it("本月与本年区间", () => {
    const now = dayjs("2026-10-05");
    expect(currentMonthRange(now)).toEqual({ start: "2026-10-01", end: "2026-10-31" });
    expect(currentYearRange(now)).toEqual({ start: "2026-01-01", end: "2026-12-31" });
  });
});
