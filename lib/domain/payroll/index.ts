/**
 * 工资规则执行器领域层（阶段5）。
 * 结构化、受控计算：不执行任意脚本/SQL；金额按分整数、比例按基点；
 * 遵循规则4不做负数归零。持久化侧需保存 formulaVersion + 规则快照 + 输入/结果快照。
 */
export * from "./types";
export * from "./money";
export * from "./anchor";