// @dreamariner/dsh-chat-search :: 单测配置（single 布局：根即插件包，直接收本包 tests/）
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    testTimeout: 60_000,
  },
})
