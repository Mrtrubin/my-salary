/**
 * antd Table 的斑马纹行类名，配合 app/admin.css 的 .admin-table-row-alt 使用。
 *
 * 为什么用 rowClassName 而不是纯 CSS 的 :nth-child(even)：
 * antd 在需要测量列宽时（如设置了 scroll.x 或有固定列）会在 <tbody> 的**首行**
 * 插入一个 MeasureRow，导致 :nth-child 的奇偶整体错位一位；而并非所有表格都会
 * 渲染该行。用 rowClassName 由 antd 直接给出数据行下标，与 DOM 结构无关。
 */
export function zebraRowClassName(_record: unknown, index: number) {
  return index % 2 === 1 ? "admin-table-row-alt" : "";
}
