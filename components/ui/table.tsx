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
import type { ReactNode } from "react";

/** 通用表格：横向滚动、内容自适应列宽，表头和单元格默认左对齐。 */
export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <TableRoot className="w-full min-w-0">
      <TableScrollContainer>
        <TableContent aria-label="数据表格" className={`w-max min-w-full table-auto ${className ?? ""}`}>{children}</TableContent>
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

export function TH({
  className,
  children,
  isRowHeader,
}: {
  className?: string;
  children?: ReactNode;
  isRowHeader?: boolean;
}) {
  return (
    <TableColumn className={`whitespace-nowrap px-4 py-3 text-left ${className ?? ""}`} isRowHeader={isRowHeader}>
      {children}
    </TableColumn>
  );
}

export function TD({
  className,
  children,
  colSpan,
}: {
  className?: string;
  children?: ReactNode;
  colSpan?: number;
}) {
  return <TableCell className={`whitespace-nowrap px-4 py-3 text-left ${className ?? ""}`} colSpan={colSpan}>{children}</TableCell>;
}