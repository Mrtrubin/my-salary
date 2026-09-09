/**
 * 通用请求/响应/分页契约。不引用任何后端 SDK 类型。
 */

/** 金额以“分”为单位的 64 位整数（避免浮点误差）。 */
export type AmountInCents = number;

/** 比例以“基点”为单位（10000 基点 = 100%）。 */
export type RateInBps = number;

/** 分页请求参数。 */
export interface PageQuery {
  page: number;
  pageSize: number;
}

/** 分页响应包裹。 */
export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

/** 统一列表查询过滤（按需扩展）。 */
export interface ListParams<TFilter = Record<string, unknown>> {
  page?: PageQuery;
  filter?: TFilter;
  /** 排序字段，前缀 "-" 表示降序，例如 "-createdAt"。 */
  sort?: string;
}