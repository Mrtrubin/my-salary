import { describe, expect, it } from "vitest";
import { bpsToRatio, buildExcelMatrix, centsToYuanNumber, fileStamp } from "@/lib/excel";

describe("Excel 导出工具", () => {
  it("金额由分转元（保留两位小数，允许负数）", () => {
    expect(centsToYuanNumber(800000)).toBe(8000);
    expect(centsToYuanNumber(257693)).toBe(2576.93);
    expect(centsToYuanNumber(-26923)).toBe(-269.23);
    expect(centsToYuanNumber(0)).toBe(0);
  });

  it("基点转小数比例", () => {
    expect(bpsToRatio(2200)).toBe(0.22);
    expect(bpsToRatio(2000)).toBe(0.2);
    expect(bpsToRatio(26500)).toBe(2.65);
    expect(bpsToRatio(0)).toBe(0);
  });

  it("按列定义生成表头与数据行，跳过未提供导出值的列", () => {
    const rows = [
      { name: "甲", amount: 800000, note: null },
      { name: "乙", amount: 500000, note: "复核" },
    ];
    const columns = [
      { title: "姓名", exportValue: (r: (typeof rows)[number]) => r.name },
      { title: "金额", exportValue: (r: (typeof rows)[number]) => centsToYuanNumber(r.amount) },
      { title: "备注", exportValue: (r: (typeof rows)[number]) => r.note },
      { title: "操作" },
    ];
    expect(buildExcelMatrix(columns, rows)).toEqual([
      ["姓名", "金额", "备注"],
      ["甲", 8000, ""],
      ["乙", 5000, "复核"],
    ]);
  });

  it("exportable=false 的列不导出", () => {
    const columns = [
      { title: "保留", exportValue: () => "x" },
      { title: "排除", exportable: false, exportValue: () => "y" },
    ];
    expect(buildExcelMatrix(columns, [{}])).toEqual([["保留"], ["x"]]);
  });

  it("文件名时间戳格式为 YYYYMMDD_HHmm", () => {
    expect(fileStamp(new Date(2026, 8, 27, 18, 30))).toBe("20260927_1830");
  });
});
