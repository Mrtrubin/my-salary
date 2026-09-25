import { describe, expect, it } from "vitest";
import { formatBpsAsPercent, formatCentsToYuan, formatDurationSeconds, formatMonth } from "@/lib/format";

describe("formatCentsToYuan", () => {
  it("基本换算：123456 分 → ¥1,234.56", () => {
    expect(formatCentsToYuan(123456)).toBe("¥1,234.56");
  });

  it("个位分补零：5 分 → ¥0.05", () => {
    expect(formatCentsToYuan(5)).toBe("¥0.05");
  });

  it("零值：0 分 → ¥0.00", () => {
    expect(formatCentsToYuan(0)).toBe("¥0.00");
  });

  it("负数：-485000 分 → -¥4,850.00（保留负号不归零）", () => {
    expect(formatCentsToYuan(-485000)).toBe("-¥4,850.00");
  });

  it("千分位：2120000 分 → ¥21,200.00", () => {
    expect(formatCentsToYuan(2120000)).toBe("¥21,200.00");
  });
});

describe("formatBpsAsPercent", () => {
  it("整百分比：300 bps → 3%", () => {
    expect(formatBpsAsPercent(300)).toBe("3%");
  });

  it("非整百分比：250 bps → 2.50%", () => {
    expect(formatBpsAsPercent(250)).toBe("2.50%");
  });

  it("门槛系数：26500 bps → 265%", () => {
    expect(formatBpsAsPercent(26500)).toBe("265%");
  });

  it("零费率：0 bps → 0%", () => {
    expect(formatBpsAsPercent(0)).toBe("0%");
  });
});

describe("formatMonth", () => {
  it("补零月份：2026-08 → 2026年8月", () => {
    expect(formatMonth("2026-08")).toBe("2026年8月");
  });

  it("非补零月份：2026-11 → 2026年11月", () => {
    expect(formatMonth("2026-11")).toBe("2026年11月");
  });
});

describe("formatDurationSeconds", () => {
  it("按时长接口真实值：23786 秒 → 6小时36分", () => {
    expect(formatDurationSeconds(23786)).toBe("6小时36分");
  });

  it("整小时不带分：7200 秒 → 2小时", () => {
    expect(formatDurationSeconds(7200)).toBe("2小时");
  });

  it("不足一小时只显示分钟：1500 秒 → 25分钟", () => {
    expect(formatDurationSeconds(1500)).toBe("25分钟");
  });

  it("不足一分钟与零值：59 秒 / 0 秒 → 不足1分钟", () => {
    expect(formatDurationSeconds(59)).toBe("不足1分钟");
    expect(formatDurationSeconds(0)).toBe("不足1分钟");
  });
});
