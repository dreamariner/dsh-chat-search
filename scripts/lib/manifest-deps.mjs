/**
 * 依赖声明的单一来源（不变式：peer 外置宿主供给，其余内联自带）。
 *
 * ## 为什么要有这个文件
 *
 * 修复前，一处依赖要在**三个地方**各写一遍：
 *   1. `package.json` 的 dependencies / peerDependencies
 *   2. `tsdown.config.ts` 的 `external` / `noExternal`（已废弃 API，构建时还会打 WARN）
 *   3. 源码护栏里的手写白名单 `RUNTIME_ALLOWED`
 *
 * 三处各写一遍 = 漏一处就静默出事：漏 2 → 产物留裸 import → 运行期解析不到 →
 * cordis loader 吞异常 → 插件凭空消失（无堆栈、无报错，只有「面板不见了」）。
 *
 * 本模块把 **package.json 变成唯一事实源**：
 *   - `peerDependencies` = 宿主供给 → **外置**（运行期由 DSH 拦截层给同一实例）
 *   - `dependencies`      = 插件自带 → **内联**（不依赖运行期 node_modules 布局）
 *   - `devDependencies`   = 只许 `import type`（由源码护栏强制）
 *
 * 新增一个依赖 = 只改 `package.json` 一处。
 *
 * ## tsdown `deps` API 的三个开关（tsdown 0.22 / rolldown 1.2）
 *
 * | 开关 | 语义 | 本仓用法 |
 * |------|------|----------|
 * | `neverBundle` | 永远外置（宿主供给） | = peers |
 * | `alwaysBundle` | 强制内联（覆盖「dependencies 默认外置」） | = 非 peers 的一切 |
 * | `onlyImport` | **产物只准 import 清单里的包**，否则构建报错 | = peers ∪ dependencies |
 *
 * `onlyImport` 的检查是真的拿解析器扫产物 chunk 的（`parse(chunk.code)` +
 * `collectImportSources`），覆盖 ES import / export-from / 动态 import，这正是
 * 手写正则护栏的两个洞（正则只认行首 `import`）。
 *
 * ## 为什么 `onlyImport` 是 peers ∪ dependencies，而不是只有 peers
 *
 * typert 代码生成器产出的 `lib/typert.host.js` / `lib/typert.remote-client.js`
 * 是**独立文件**（不进 bundle，生成器单独 emit），它们 `import { z } from 'zod'`。
 * zod 是本包的 `dependencies` → 分发时被包管理器真装 → 运行期解析得到 ✓。
 * 若 `onlyImport` 只放 peers，这两行会让构建直接失败。
 *
 * 换句话说：`onlyImport` 锁的是「**产物只准 import manifest 声明过的运行期依赖**」，
 * 传递依赖 / devDependency / 没声明的包一律构建期报错。这才是这条不变式的目的。
 */
import { readFileSync } from 'node:fs'
import { isBuiltin } from 'node:module'
import { join } from 'node:path'

/** 读一个包的 manifest（package.json）。 */
export function readManifest(pkgDir) {
  return JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'))
}

/** peer 依赖名：宿主供给，运行期外置，必须与宿主是**同一实例**。 */
export function peersOf(manifest) {
  return Object.keys(manifest.peerDependencies ?? {})
}

/** 运行期依赖名：插件自带，构建期内联进产物。 */
export function depsOf(manifest) {
  return Object.keys(manifest.dependencies ?? {})
}

/** devDependency 名：只许 `import type`（源码护栏强制）。 */
export function devDepsOf(manifest) {
  return Object.keys(manifest.devDependencies ?? {})
}

/**
 * host 半边的 tsdown `deps` 三件套。
 *
 * - `neverBundle` = peers → 宿主供给的那份（同一实例）
 * - `alwaysBundle` = 非 peers 的一切 → 内联，产物不再依赖运行期 node_modules 布局
 *   （node 内建模块除外：它们本来就外置，强行内联会报错）
 * - `onlyImport` = peers ∪ dependencies → 产物只准 import manifest 声明过的运行期依赖
 */
export function hostDeps(manifest) {
  const peers = peersOf(manifest)
  return {
    neverBundle: [...peers],
    alwaysBundle: (specifier) => !peers.includes(specifier) && !isBuiltin(specifier),
    onlyImport: [...new Set([...peers, ...depsOf(manifest)])],
  }
}

/**
 * 某个包在某一半边**允许出现**的裸导入集合（源码护栏用）。
 *
 * - host 半边：只允许 manifest 声明过的运行期依赖（peers ∪ dependencies）。
 *   客户端的模块表清单**不在这里**：渲染进程的模块表在 host 半边不存在，
 *   放进共用白名单等于对 host 半边也放行，正是这条护栏要防的故障。
 * - client 半边：额外允许模块表清单（EXTERNALS），那些包由宿主渲染进程的模块表供给。
 *
 * @param {object} manifest 包 manifest
 * @param {'host' | 'client'} half 半边
 * @param {string[]} [clientExternals] 该包 client 半边的模块表清单
 */
export function runtimeAllowed(manifest, half, clientExternals = []) {
  const declared = [...peersOf(manifest), ...depsOf(manifest)]
  if (half === 'client') return [...new Set([...declared, ...clientExternals])]
  return [...new Set(declared)]
}
