#!/usr/bin/env node
// dsh-chat-search :: dev-hmr.mjs — 项目级 hmr 接线：把本仓的 lib/ 注册进本机 DSH 的 hmr watch 根
//
// 用途：开发时「保存 → pnpm dev 重建 → 实例内热重载（免重启、PID 不变）」。
//   pnpm dev:hmr            注册本仓的 lib 目录（幂等；add 新插件后重跑一次即可）
//   pnpm dev:hmr --remove   注销本仓的全部注册
//
// 布局自适应：workspace 布局注册 packages/*/lib；单包布局（根即插件包）注册根 lib/，
// 并同时认旧布局的 packages/*/lib 条目（历史注册重跑一次即清）。
//
// 机制：DSH 的 hmr 行住在本机 home patch（$DSH_HOME/cordis.patch.yml，机器本地产物，
// 不进任何 git）。本脚本只往该行 config.root 数组里增删**本仓**的 lib 绝对路径，
// 不触碰 root 里的其它行（各家脚本互不干扰、各自管理自己的行）。
// 变更 watch 根需重启实例一次生效；之后的改动随 pnpm dev 重建即时热重载。
//
// 固有限制（DSH hmr 机制）：只认 change 事件（删除文件不触发 reload）、实例启动
// 窗口内的改动被丢弃、macOS FSEvents 注册窗口。client 半边不用注册：DSH 的
// client-hmr 自动盯着 lib/client.js（若存在），重建即热替换。
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packagesDir = join(repo, 'packages')
const remove = process.argv.includes('--remove')
const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
const homePatch = join(dshHome, 'cordis.patch.yml')

const packageDirs = existsSync(packagesDir)
  ? readdirSync(packagesDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => join(packagesDir, e.name))
  : []
// 本仓的 lib 目录集合（存在的才算：没构建的包注册了也没有产物可热重载）。
// workspace 布局扫 packages/*/lib；单包布局（根即插件包，无 packages/）用根 lib/。
const libDirs = existsSync(packagesDir)
  ? packageDirs.filter((d) => existsSync(join(d, 'lib'))).map((d) => join(d, 'lib'))
  : existsSync(join(repo, 'lib'))
    ? [join(repo, 'lib')]
    : []

if (!remove && libDirs.length === 0) {
  console.error('[dev-hmr] 没有可注册的 lib/（packages/*/lib 或根 lib/）:先构建一次：pnpm build')
  process.exit(1)
}

// js-yaml 借用：单包布局它就是根 devDep（从根 package.json 借）；workspace 布局根壳
// 没有它（pnpm 严格隔离），回落扫各插件包。
let yaml
const borrowYaml = (pkgJson) => {
  try {
    return createRequire(pkgJson)('js-yaml')
  } catch {}
  return null
}
yaml = borrowYaml(join(repo, 'package.json'))
if (!yaml) {
  for (const pkg of packageDirs) {
    yaml = borrowYaml(join(pkg, 'package.json'))
    if (yaml) break
  }
}
if (!yaml) {
  console.error('[dev-hmr] 缺 js-yaml 依赖:先 pnpm install')
  process.exit(1)
}

// ⚠ home patch 是 DSH 的 YAML 方言：允许 `!!js <表达式>`（DSH 读取时求值出本机路径）。
// js-yaml 默认 schema 不认识这个标签（unknown tag 直接抛错），这里注册一个**透传**类型：
// 读进来包成占位对象、写出去原样还原，标签与表达式逐字节保留。
// ⚠ 刻意不在本脚本求值表达式：求值是 DSH 的职责（它才有 dshHomePath 的定义域），
// 在这里求值等于执行配置里的任意 JS。
// （固有限制：js-yaml 的 round-trip 不保留注释:注释会丢，语义与标签不丢。）
class JSExpression {
  constructor(source) {
    this.source = source
  }
}
const jsTag = new yaml.Type('tag:yaml.org,2002:js', {
  kind: 'scalar',
  resolve: () => true,
  construct: (data) => new JSExpression(data),
  predicate: (obj) => obj instanceof JSExpression,
  represent: (obj) => obj.source,
})
const PATCH_SCHEMA = yaml.DEFAULT_SCHEMA.extend({ explicit: [jsTag] })

let rows = []
if (existsSync(homePatch)) {
  const loaded = yaml.load(readFileSync(homePatch, 'utf8'), { schema: PATCH_SCHEMA })
  rows = Array.isArray(loaded) ? loaded : []
}
let hmr = rows.find((r) => r && r.id === 'hmr')
if (!hmr) {
  hmr = { id: 'hmr', config: { root: [] } }
  rows.push(hmr)
}
hmr.config ??= {}
if (hmr.config.root !== undefined && !Array.isArray(hmr.config.root)) {
  // root 若被写成 !!js 表达式（非数组），覆盖它会静默抹掉表达式:宁可失败
  console.error('[dev-hmr] hmr 行的 config.root 不是数组（可能是 !!js 表达式），为避免覆盖请手工处理')
  process.exit(1)
}
if (!Array.isArray(hmr.config.root)) hmr.config.root = []

// 本脚本家族的管理范围：本仓的 lib 条目（别的仓 / 别家工具的行不动）。
// 根 lib 分支服务单包布局；packages/*/lib 分支服务 workspace 布局，同时承担
// 旧布局注册项的识别与清理（单包仓的 packages/ 已不存在，历史条目重跑即清）。
const rootLibDir = join(repo, 'lib')
const isOurs = (r) => typeof r === 'string' && (
  r === rootLibDir
  || (r.startsWith(packagesDir + sep) && r.endsWith(sep + 'lib'))
)
const oursBefore = hmr.config.root.filter(isOurs)

if (remove) {
  hmr.config.root = hmr.config.root.filter((r) => !isOurs(r))
} else {
  // 先清掉本仓已失效的条目（包被删 / lib 被清），再补齐现存集合
  hmr.config.root = hmr.config.root.filter((r) => !isOurs(r) || libDirs.includes(r))
  for (const dir of libDirs) {
    if (!hmr.config.root.includes(dir)) hmr.config.root.push(dir)
  }
}

const oursAfter = hmr.config.root.filter(isOurs)
writeFileSync(homePatch, `${yaml.dump(rows, { schema: PATCH_SCHEMA, lineWidth: -1 })}\n`)

if (remove) {
  console.log(oursBefore.length > 0
    ? `[dev-hmr] 已注销 ${oursBefore.length} 个注册（本仓 lib/；重启实例生效）`
    : '[dev-hmr] 本来就未注册，无需操作')
} else {
  const added = oursAfter.filter((r) => !oursBefore.includes(r)).length
  const summary = oursAfter.map((r) => r.slice(repo.length + 1)).join(', ')
  console.log(added > 0
    ? `[dev-hmr] 已注册 ${added} 个 watch 根：${summary}\n[dev-hmr] 重启实例一次生效；之后 pnpm dev 的重建即热重载（PID 不变）`
    : `[dev-hmr] 已在 hmr watch 根中（幂等，未改动）：${summary}`)
}
