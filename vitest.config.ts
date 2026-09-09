import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// 配置主体见此文件；.mts 为等价副本。使用 defineConfig 保持类型提示。
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./", import.meta.url)) } },
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
});