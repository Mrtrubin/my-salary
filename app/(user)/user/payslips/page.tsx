"use client";

import { AnchorPayslipList } from "./AnchorPayslipList";
import { HostPayslipList } from "./HostPayslipList";
import { StaffPayslipList } from "./StaffPayslipList";

/**
 * 工资条页：只做拼装。
 *
 * 主播 / 主持 / 固定薪资 各自独立组件，各组件自取数据、自判断是否展示（含加载/错误/空态）；
 * 本页不含任何角色判定、数据查询或工资条渲染逻辑。
 */
export default function UserPayslipsPage() {
  return (
    <div className="space-y-4">
      <AnchorPayslipList />
      <HostPayslipList />
      <StaffPayslipList />
    </div>
  );
}
