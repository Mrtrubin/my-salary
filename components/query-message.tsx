import { Spinner } from "@heroui/react";

export function QueryMessage({ loading, error, empty }: { loading: boolean; error: unknown; empty?: boolean }) {
  if (loading)
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-10 text-sm text-muted">
        <Spinner size="sm" />
        <span>加载中…</span>
      </div>
    );
  if (error) return <p className="py-8 text-center text-sm text-danger">数据加载失败，请稍后重试</p>;
  if (empty) return <p className="py-8 text-center text-sm text-muted">暂无数据</p>;
  return null;
}