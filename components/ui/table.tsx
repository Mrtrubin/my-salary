import {
  TableBody,
  TableCell,
  TableColumn,
  TableContent,
  TableHeader,
  TableRoot,
  TableRow,
  TableScrollContainer,
} from "@heroui/react";
import type { CSSProperties, ReactNode } from "react";

/** 列吸附方向：left 吸附到滚动容器左边缘，right 吸附到右边缘。 */
export type StickySide = "left" | "right";

/**
 * 计算吸附列所需的 class 与偏移样式。
 * @param sticky 吸附方向，未传则不吸附
 * @param offset 距离对应边缘的像素偏移（多列吸附时用于错开）
 */
function stickyAttrs(sticky?: StickySide, offset = 0): { cls: string; style?: CSSProperties } {
  if (!sticky) return { cls: "" };
  return {
    cls: `hui-sticky hui-sticky--${sticky}`,
    style: sticky === "left" ? { left: offset } : { right: offset },
  };
}

/**
 * 通用表格：横向滚动、内容自适应列宽，表头和单元格默认左对齐。
 * @param striped 是否启用奇偶行不同底色（默认开启）
 */
export function Table({
  children,
  className,
  striped = true,
}: {
  children: ReactNode;
  className?: string;
  striped?: boolean;
}) {
  return (
    <TableRoot className="w-full min-w-0">
      <TableScrollContainer>
        <TableContent
          aria-label="数据表格"
          className={`hui-table ${striped ? "hui-table--striped" : ""} w-max min-w-full table-auto ${className ?? ""}`}
        >
          {children}
        </TableContent>
      </TableScrollContainer>
    </TableRoot>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return <TableHeader>{children}</TableHeader>;
}

export function TBody({ children }: { children: ReactNode }) {
  return <TableBody>{children}</TableBody>;
}

export function TR({
  className,
  children,
}: {
  className?: string;
  children?: ReactNode;
}) {
  return <TableRow className={className}>{children}</TableRow>;
}

/**
 * 表头单元格。
 * @param sticky 传入方向后该列吸附在滚动容器边缘，不随横向滚动移出视口
 * @param stickyOffset 吸附列的边缘偏移（px），多列吸附时依次累加前面列的宽度
 */
export function TH({
  className,
  children,
  isRowHeader,
  sticky,
  stickyOffset,
}: {
  className?: string;
  children?: ReactNode;
  isRowHeader?: boolean;
  sticky?: StickySide;
  stickyOffset?: number;
}) {
  const { cls, style } = stickyAttrs(sticky, stickyOffset);
  return (
    <TableColumn
      className={`whitespace-nowrap px-4 py-3 text-left ${cls} ${className ?? ""}`}
      style={style}
      isRowHeader={isRowHeader}
    >
      {children}
    </TableColumn>
  );
}

/**
 * 数据单元格。
 * @param sticky 传入方向后该列吸附在滚动容器边缘，需与对应表头 TH 的 sticky/stickyOffset 保持一致
 * @param stickyOffset 吸附列的边缘偏移（px）
 */
export function TD({
  className,
  children,
  colSpan,
  sticky,
  stickyOffset,
}: {
  className?: string;
  children?: ReactNode;
  colSpan?: number;
  sticky?: StickySide;
  stickyOffset?: number;
}) {
  const { cls, style } = stickyAttrs(sticky, stickyOffset);
  return (
    <TableCell
      className={`whitespace-nowrap px-4 py-3 text-left ${cls} ${className ?? ""}`}
      style={style}
      colSpan={colSpan}
    >
      {children}
    </TableCell>
  );
}