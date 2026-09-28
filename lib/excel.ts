/**
 * 表格导出为 Excel（.xlsx）。
 * 仅用于管理端「工资核算」等表格的下载：按列定义逐行取值后落表。
 * 金额一律由「分」转成「元」的数值，比例由 bps 转成小数（0.22 表示 22%），便于在 Excel 中直接求和/排序。
 */
import * as XLSX from "xlsx";

/** 单列导出定义。`exportable` 为 false 或未提供 `exportValue` 的列不会出现在导出文件里。 */
export interface ExcelColumn<T> {
  title: string;
  /** 显式排除（如「操作」列）。 */
  exportable?: boolean;
  /** 单元格取值；返回 null 表示空单元格。 */
  exportValue?: (record: T) => string | number | null;
}

/** 分 → 元（数值，保留两位小数，允许负数）。 */
export function centsToYuanNumber(cents: number): number {
  return Number((cents / 100).toFixed(2));
}

/** 基点 → 小数比例（如 2200 bps → 0.22，表示 22%）。 */
export function bpsToRatio(bps: number): number {
  return bps / 10000;
}

/** 按列定义把记录整理成二维数组（首行为表头），便于单测且与写文件解耦。 */
export function buildExcelMatrix<T>(
  columns: readonly ExcelColumn<T>[],
  records: readonly T[],
): (string | number)[][] {
  const cols = columns.filter((column) => column.exportable !== false && column.exportValue);
  const header = cols.map((column) => column.title);
  const body = records.map((record) =>
    cols.map((column) => column.exportValue!(record) ?? ""),
  );
  return [header, ...body];
}

/** 生成并下载 .xlsx 文件。 */
export function downloadExcel<T>(options: {
  fileName: string;
  sheetName?: string;
  columns: readonly ExcelColumn<T>[];
  records: readonly T[];
}): void {
  const matrix = buildExcelMatrix(options.columns, options.records);
  const worksheet = XLSX.utils.aoa_to_sheet(matrix);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, options.sheetName ?? "Sheet1");
  XLSX.writeFile(workbook, options.fileName);
}

/** 文件名时间戳：20260927_1830。 */
export function fileStamp(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}`;
}
