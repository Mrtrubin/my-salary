"use client";

import { Table } from "antd";
import type { TableColumnsType, TableColumnType, TablePaginationConfig, TableProps } from "antd";
import {
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent as ReactPointerEvent,
  type ThHTMLAttributes,
} from "react";

/**
 * 管理端通用表格：在 antd Table 之上补齐三件事 ——
 *   1. 可拖拽列宽（B 方案），并给每列一个合理的初始宽度窗口；
 *   2. 表头强制单行：拖拽下限不会小于「表头单行所需宽度」；
 *   3. 默认分页 + 自动排序（有 dataIndex / sortValue 的列自动可排序）。
 *
 * 用法与 antd Table 基本一致：把 `<Table>` 换成 `<ResizableTable>`，columns 里
 * 可选地补 `sortValue`（给没有 dataIndex 的 render 列提供排序依据）。
 */

const DEFAULT_MIN_COLUMN_WIDTH = 96;
const DEFAULT_MAX_COLUMN_WIDTH = 320;
const MEASURE_SAMPLE_ROWS = 40;
const CELL_PADDING_X = 32;
const SORTER_ICON_WIDTH = 24;
// 表头是加粗字体（antd fontWeightStrong = 600），量算表头时用同字重，避免低估导致表头溢出。
const MEASURE_FONT =
  '14px "PingFang SC", "Microsoft YaHei", -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif';
const MEASURE_HEADER_FONT =
  '600 14px "PingFang SC", "Microsoft YaHei", -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif';

const subscribeMounted = () => () => {};

const DEFAULT_PAGINATION: TablePaginationConfig = {
  defaultPageSize: 10,
  showSizeChanger: true,
  showQuickJumper: true,
  hideOnSinglePage: true,
  pageSizeOptions: [10, 20, 50, 100],
  showTotal: (total, range) => `第 ${range[0]}-${range[1]} 条 / 共 ${total} 条`,
};

export interface ResizableColumnType<RecordType = object> extends TableColumnType<RecordType> {
  /** 排序取值：没有 dataIndex 的 render 列可通过它获得排序能力。 */
  sortValue?: (record: RecordType) => string | number | Date | null | undefined;
  /** 初始宽度下限（px）；表头单行所需宽度会在此基础上抬高。 */
  minWidth?: number;
  /** 初始及拖拽宽度上限（px）。 */
  maxWidth?: number;
  /** 置为 false 可关闭该列的自动排序。 */
  sortable?: boolean;
}

export type ResizableColumnsType<RecordType = object> = ResizableColumnType<RecordType>[];

export interface ResizableTableProps<RecordType extends object>
  extends Omit<TableProps<RecordType>, "columns"> {
  columns: ResizableColumnsType<RecordType>;
  /** 初始宽度下限（px），默认 96。 */
  minColumnWidth?: number;
  /** 初始及拖拽宽度上限（px），默认 320。 */
  maxColumnWidth?: number;
  /** 是否自动为可排序的列注入排序，默认开启。 */
  sortable?: boolean;
}

interface ResizableTitleProps extends ThHTMLAttributes<HTMLTableCellElement> {
  width?: number;
  minWidth?: number;
  maxWidth?: number;
  onResize?: (width: number) => void;
}

let measureContext: CanvasRenderingContext2D | null | undefined;

function measureText(text: string, bold = false): number {
  if (!text || typeof document === "undefined") return 0;
  if (measureContext === undefined) {
    measureContext = document.createElement("canvas").getContext("2d");
  }
  if (!measureContext) return 0;
  measureContext.font = bold ? MEASURE_HEADER_FONT : MEASURE_FONT;
  return measureContext.measureText(text).width;
}

function nodeToText(node: unknown): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  // 函数式 title / render（如 (props) => ReactNode）无法静态量算，视作无文本。
  if (typeof node === "function") return "";
  if (Array.isArray(node)) return node.map(nodeToText).join("");
  if (typeof node === "object" && "props" in node) {
    return nodeToText((node as { props?: { children?: unknown } }).props?.children);
  }
  return "";
}

function getColumnKey<RecordType>(
  column: ResizableColumnType<RecordType>,
  index: number,
): string {
  if (column.key !== undefined && column.key !== null) return String(column.key);
  const { dataIndex } = column;
  if (typeof dataIndex === "string") return dataIndex;
  if (Array.isArray(dataIndex)) return dataIndex.map(String).join(".");
  return `column-${index}`;
}

function getRawValue<RecordType extends object>(
  column: ResizableColumnType<RecordType>,
  record: RecordType,
): unknown {
  if (column.sortValue) return column.sortValue(record);
  const { dataIndex } = column;
  if (typeof dataIndex === "string") return (record as Record<string, unknown>)[dataIndex];
  if (Array.isArray(dataIndex)) {
    let value: unknown = record;
    for (const key of dataIndex) {
      if (value === null || typeof value !== "object") return undefined;
      value = (value as Record<string, unknown>)[String(key)];
    }
    return value;
  }
  return undefined;
}

function isAutoSortable<RecordType>(column: ResizableColumnType<RecordType>): boolean {
  if (column.sortable === false) return false;
  if (column.sorter) return true;
  return column.dataIndex !== undefined || typeof column.sortValue === "function";
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function toComparable(value: unknown): number | string {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  const text = String(value);
  const numeric = Number(text);
  if (text.trim() !== "" && Number.isFinite(numeric)) return numeric;
  return text;
}

function compareValues(a: unknown, b: unknown): number {
  const aEmpty = a === null || a === undefined || a === "";
  const bEmpty = b === null || b === undefined || b === "";
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return -1;
  if (bEmpty) return 1;
  const left = toComparable(a);
  const right = toComparable(b);
  if (typeof left === "number" && typeof right === "number") return left - right;
  return String(left).localeCompare(String(right), "zh-Hans-CN");
}

/** 表头单行所需宽度（含内边距，若该列有排序图标再补图标位）。 */
function headerWidthOf<RecordType>(
  column: ResizableColumnType<RecordType>,
  autoSortable: boolean,
): number {
  const text = nodeToText(column.title);
  if (!text) return 0;
  return measureText(text, true) + CELL_PADDING_X + (autoSortable ? SORTER_ICON_WIDTH : 0);
}

function computeInitialWidths<RecordType extends object>(
  columns: ResizableColumnsType<RecordType>,
  dataSource: readonly RecordType[],
  minColumnWidth: number,
  maxColumnWidth: number,
  sortable: boolean,
): Record<string, number> {
  const widths: Record<string, number> = {};
  columns.forEach((column, index) => {
    const key = getColumnKey(column, index);
    const headerWidth = headerWidthOf(column, sortable && isAutoSortable(column));
    const lower = Math.max(minColumnWidth, column.minWidth ?? 0, Math.ceil(headerWidth));
    const upper = Math.max(maxColumnWidth, column.maxWidth ?? 0, lower);

    let fit = headerWidth;
    if (typeof column.width === "number") fit = Math.max(fit, column.width);
    if (!column.render) {
      const sample = dataSource.slice(0, MEASURE_SAMPLE_ROWS);
      for (const record of sample) {
        const content = nodeToText(getRawValue(column, record));
        const width = measureText(content) + CELL_PADDING_X;
        if (width > fit) fit = width;
      }
    }
    widths[key] = Math.round(clamp(fit || lower, lower, upper));
  });
  return widths;
}

function ResizableTitle({
  width,
  minWidth,
  maxWidth,
  onResize,
  className,
  children,
  ...rest
}: ResizableTitleProps) {
  const dragRef = useRef<{ pointerX: number; startWidth: number } | null>(null);

  const resizable = typeof width === "number" && typeof onResize === "function";

  const handlePointerDown = (event: ReactPointerEvent<HTMLSpanElement>) => {
    if (!resizable || typeof width !== "number" || !onResize) return;
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = { pointerX: event.clientX, startWidth: width };
    const min = minWidth ?? 0;
    const max = maxWidth ?? Number.POSITIVE_INFINITY;

    const handleMove = (moveEvent: PointerEvent) => {
      const start = dragRef.current;
      if (!start) return;
      onResize(clamp(start.startWidth + moveEvent.clientX - start.pointerX, min, max));
    };
    const handleUp = () => {
      dragRef.current = null;
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      document.body.style.removeProperty("cursor");
      document.body.style.removeProperty("user-select");
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  };

  // 拖拽手柄用绝对定位，需要 th 作为定位上下文；该定位由 CSS 类提供，
  // 并通过 :not(.ant-table-cell-fix) 排除固定列，避免覆盖其 position: sticky。
  const mergedClassName = ["admin-resizable-cell", className].filter(Boolean).join(" ");

  return (
    <th {...rest} className={mergedClassName}>
      {children}
      {resizable ? (
        <span
          role="separator"
          aria-orientation="vertical"
          aria-label="拖动调整列宽"
          className="admin-resizable-handle"
          onPointerDown={handlePointerDown}
          onClick={(event) => event.stopPropagation()}
        />
      ) : null}
    </th>
  );
}

export function ResizableTable<RecordType extends object>({
  columns,
  dataSource,
  minColumnWidth = DEFAULT_MIN_COLUMN_WIDTH,
  maxColumnWidth = DEFAULT_MAX_COLUMN_WIDTH,
  sortable = true,
  pagination,
  scroll,
  components,
  tableLayout,
  ...rest
}: ResizableTableProps<RecordType>) {
  const rows = dataSource ?? [];
  // 仅在客户端量算文本宽度，避免 SSR 与首帧不一致；useSyncExternalStore 是官方推荐且不触发 lint 的挂载检测方式。
  const mounted = useSyncExternalStore(
    subscribeMounted,
    () => true,
    () => false,
  );
  const [overrides, setOverrides] = useState<Record<string, number>>({});

  const columnsKey = columns.map((column, index) => getColumnKey(column, index)).join("|");
  const hasRows = rows.length > 0;

  // 首帧拿到数据后量出各列初始宽度；列集合或「有/无数据」变化时重算，普通筛选/翻页保持不变。
  const initialWidths = useMemo(() => {
    if (!mounted) return {} as Record<string, number>;
    return computeInitialWidths(columns, rows, minColumnWidth, maxColumnWidth, sortable);
    // 以列集合签名 + 是否有数据作为触发条件，避免每次数据引用变化都重量。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, columnsKey, hasRows, minColumnWidth, maxColumnWidth, sortable]);

  const mergedColumns = useMemo(() => {
    return columns.map((column, index) => {
      const key = getColumnKey(column, index);
      const autoSortable = sortable && isAutoSortable(column);
      const headerWidth = headerWidthOf(column, autoSortable);
      const lower = Math.max(minColumnWidth, column.minWidth ?? 0, Math.ceil(headerWidth));
      const upper = Math.max(maxColumnWidth, column.maxWidth ?? 0, lower);
      const width = overrides[key] ?? initialWidths[key] ?? column.width;
      const sorter =
        column.sorter ??
        (autoSortable
          ? (a: RecordType, b: RecordType) =>
              compareValues(getRawValue(column, a), getRawValue(column, b))
          : undefined);

      return {
        ...column,
        width,
        sorter,
        onHeaderCell: () => ({
          width,
          minWidth: lower,
          maxWidth: upper,
          onResize: (nextWidth: number) => {
            setOverrides((prev) =>
              prev[key] === nextWidth ? prev : { ...prev, [key]: nextWidth },
            );
          },
        }),
      };
    });
  }, [columns, overrides, initialWidths, minColumnWidth, maxColumnWidth, sortable]);

  const totalWidth = mergedColumns.reduce(
    (sum, column) => sum + (typeof column.width === "number" ? column.width : 0),
    0,
  );

  return (
    <Table<RecordType>
      {...rest}
      components={{ ...components, header: { ...components?.header, cell: ResizableTitle } }}
      tableLayout={tableLayout ?? "fixed"}
      columns={mergedColumns as TableColumnsType<RecordType>}
      dataSource={dataSource}
      pagination={pagination === undefined ? DEFAULT_PAGINATION : pagination}
      scroll={{ ...scroll, x: totalWidth || undefined }}
    />
  );
}
