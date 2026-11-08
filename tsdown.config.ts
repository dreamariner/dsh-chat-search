import { defineConfig } from 'tsdown'
import { fileURLToPath } from 'node:url'
// 项目共用脚本住根 scripts/（一仓一份，add 插件不复制）
import { hostDeps, readManifest } from './scripts/lib/manifest-deps.mjs'

// host 半边构建：dev 与安装/发布都跑本产物（lib/index.js 是装载入口）。
//
// 依赖策略（不变式）：名单只写在 package.json 一处 :
//   peerDependencies → 外置（宿主拦截层供给同一实例）；
//   dependencies → 内联（不依赖运行期 node_modules 布局）；
//   devDependencies → 只许 import type。
// ⚠ 少内联一个依赖的后果不是「运行时报错」，而是 profile 装载期解析不到 →
//   插件静默不装载（cordis loader 吞异常）：没有堆栈，只有「插件不见了」。
const manifest = readManifest(fileURLToPath(new URL('.', import.meta.url)))

export default defineConfig({
  entry: ['src/index.ts'],
  format: 'esm',
  platform: 'node',
  outDir: 'lib',
  dts: false,
  // tsdown 0.22 对 node 平台默认 fixedExtension=true（强制 .mjs）；关掉它按包内
  // type: module 出 .js，与 DSH/社区包的 lib/index.js 形态一致。
  fixedExtension: false,
  // clean: false : 构建失败时不能毁掉上一份产物（tsdown 的 clean 在构建开始时执行，
  // 先删 outDir 再构建；clean: true 遇到编译错误 = 旧产物没了 + 新产物没出来）。
  clean: false,
  deps: hostDeps(manifest),
})
