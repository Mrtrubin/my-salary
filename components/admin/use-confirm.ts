"use client";

import { App } from "antd";
import type { ModalFuncProps } from "antd";
import { useCallback } from "react";

/**
 * 把 antd 的命令式确认弹窗包成 `Promise<boolean>`。
 *
 * antd 的 `modal.confirm()` 返回的是 `{ destroy, update }` 而不是 Promise，
 * 直接 `await` 拿不到用户的选择，取消路径会静默失效。包一层后可以写成
 * `if (!(await confirm({...}))) return;`，语义与原来的 `window.confirm` 一致。
 */
export function useConfirm() {
  const { modal } = App.useApp();
  return useCallback(
    (options: ModalFuncProps) =>
      new Promise<boolean>((resolve) => {
        modal.confirm({
          okText: "确认",
          cancelText: "取消",
          ...options,
          onOk: () => resolve(true),
          onCancel: () => resolve(false),
        });
      }),
    [modal],
  );
}
