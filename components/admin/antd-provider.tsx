"use client";

import { App, ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import dayjs from "dayjs";
import "dayjs/locale/zh-cn";
import type { ReactNode } from "react";

// DatePicker / 日期区间等组件的中文月份与星期文案由 dayjs 提供。
dayjs.locale("zh-cn");

/**
 * admin 端 antd 作用边界：中文文案 + 统一主题 token。
 *
 * user 端不经过这里，继续使用 HeroUI，两套设计系统在路由层就分开了。
 * 需要调整主色时改 `token.colorPrimary` 即可（当前沿用 antd 默认蓝）。
 */
export function AdminAntdProvider({ children }: { children: ReactNode }) {
  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
          borderRadius: 8,
        },
      }}
    >
      {/* antd App 提供 message / modal / notification 的上下文，避免静态调用脱离主题 */}
      <App>{children}</App>
    </ConfigProvider>
  );
}
