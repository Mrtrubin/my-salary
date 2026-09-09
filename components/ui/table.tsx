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

/** HeroUI Table 复合结构封装：自带横向滚动容器。 */
export function Table({ children }: { children: ReactNode }) {
  return (
    <TableRoot>
      <TableScrollContainer>
        <TableContent aria-label="数据表格">{children}</TableContent>
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
    <TableColumn className={className} isRowHeader={isRowHeader}>
      {children}
    </TableColumn>
  );
}

export function TD({
  className,
  children,
}: {
  className?: string;
  children?: ReactNode;
}) {
  return <TableCell className={className}>{children}</TableCell>;
}