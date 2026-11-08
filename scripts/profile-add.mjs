#!/usr/bin/env node
// @dreamariner/dsh-chat-search :: profile-add.mjs — 把本插件装进 DSH profile：构建 + 装包 + 登记 + 自检，一条命令
//
// 背景：desktop profile 由 Electron 应用专属管理，`dsh plugin add` 的官方 reconcile
// 触达不到（CLI 对 desktop profile 直接拒绝）；裸 `pnpm add` 又只装包不登记：DSH 的
// profile 只认 package.json 里的 `dsh.profile.bundles` 名单（loadProfileDirectory 不扫
// dependencies），装完不登记 = 插件静默不挂载。本脚本把安装收拢成一条命令：
//
//   node scripts/profile-add.mjs [profile目录]     # 缺省 ~/.dsh/profiles/desktop，link: 本仓
//   node scripts/profile-add.mjs --npm [...]       # 从 npm 装
//   node scripts/profile-add.mjs --remove [...]    # 反向卸载（含名单清理）
//
// 动作（link 态）：
//   ⓪ 装前构建：node_modules 缺失先 pnpm install；随后构建本包（single 布局
//     `pnpm build`；workspace 布局 `pnpm --filter <包名>... build` 含依赖链）。
//     lib/ 是构建产物不入库（gitignore），link: 安装也不触发 pnpm lifecycle，构建只能在此做
//   ① pnpm add <spec> --dir <profile>
//   ② 幂等追加 "@dreamariner/dsh-chat-search" 进 dsh.profile.bundles，并钉 packageManager
//     （profile 的 node_modules 布局跟 pnpm 大版本绑定，钉版防嵌套 pnpm 劫持）
//   ③ 自检：realpath 后验目标 manifest 带 dsh.bundle 且包名一致、main 入口产物存在，
//     把「静默失效」变成显式报错
//   ④ 提示重启实例生效
// --npm 态跳过 ⓪（tarball 自带构建产物）；--remove 只走 ①②
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const NAME = '@dreamariner/dsh-chat-search'
// 本包相对仓根的子路径：single 布局 = ''（根即插件包，build 在根）；workspace =
// /packages/<id>（--filter 本包含依赖构建，link 指向子目录）
const SELF_SUFFIX = ''
const PM = 'pnpm@11.7.0'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const remove = args.includes('--remove')
const fromNpm = args.includes('--npm')
const profileArg = args.find((a) => !a.startsWith('--'))
const profileDir = resolve(profileArg ?? join(homedir(), '.dsh', 'profiles', 'desktop'))
const pkgPath = join(profileDir, 'package.json')
const fail = (msg) => {
  console.error(`[profile-add] ✗ ${msg}`)
  process.exit(1)
}
if (!existsSync(pkgPath)) fail(`profile 目录不存在或没有 package.json：${profileDir}`)

// ── 安装来源 ────────────────────────────────────────────────────────────────
// link:（缺省）= 本仓 clone 的开发态；--npm = npm 上的发行版。
const spec = remove ? NAME : fromNpm ? NAME : `link:${repo}${SELF_SUFFIX}`

// ── ⓪ 装前构建（仅 link 态；--npm 的 tarball 自带产物，--remove 无需构建）────
if (!remove && !fromNpm) {
  const run = (cmdArgs) => {
    console.log(`[profile-add] pnpm ${cmdArgs.join(' ')}（cwd ${repo}）`)
    const b = spawnSync('pnpm', cmdArgs, { cwd: repo, stdio: 'inherit' })
    if (b.status !== 0) fail(`pnpm ${cmdArgs.join(' ')} 失败（见上方输出），中止安装`)
  }
  if (!existsSync(join(repo, 'node_modules'))) run(['install'])
  if (SELF_SUFFIX) run(['--filter', `${NAME}...`, 'build'])
  else run(['build'])
}

// ── ① 装包 / 卸包 ───────────────────────────────────────────────────────────
const verb = remove ? 'remove' : 'add'
console.log(`[profile-add] pnpm ${verb} ${spec} --dir ${profileDir}`)
const r = spawnSync('pnpm', [verb, spec, '--dir', profileDir], { stdio: 'inherit' })
if (r.status !== 0) fail(`pnpm ${verb} 失败（见上方输出）`)

// ── ② 登记 / 清名单 ─────────────────────────────────────────────────────────
const manifest = JSON.parse(readFileSync(pkgPath, 'utf8'))
manifest.dsh ??= {}
manifest.dsh.profile ??= {}
const bundles = (manifest.dsh.profile.bundles ??= [])
const had = bundles.includes(NAME)
if (remove) {
  manifest.dsh.profile.bundles = bundles.filter((b) => b !== NAME)
} else if (!had) {
  bundles.push(NAME)
}
// packageManager 钉版：任何入口进到 profile 都自切换到同一 pnpm 大版本
if (!remove && PM && !manifest.packageManager) manifest.packageManager = PM
writeFileSync(pkgPath, `${JSON.stringify(manifest, null, 2)}\n`)

// ── ③ 自检（卸载方向只报结果）───────────────────────────────────────────────
const selfAbs = join(profileDir, 'node_modules', NAME)
if (remove) {
  console.log(`[profile-add] 已卸载并清理名单（bundles 现为：${manifest.dsh.profile.bundles.join(', ') || '(空)'}）`)
  console.log('[profile-add] 重启实例一次生效')
  process.exit(0)
}
if (!existsSync(selfAbs)) fail(`node_modules 里没有 ${NAME}（pnpm add 输出见上）`)
let real
try { real = realpathSync(selfAbs) } catch { fail(`${selfAbs} 是断链（安装源不存在？）`) }
const target = JSON.parse(readFileSync(join(real, 'package.json'), 'utf8'))
if (target.dsh?.bundle === undefined) {
  fail(`安装目标不是插件包（manifest 无 dsh.bundle）：${real}\n  多半装到了根壳：link/spec 必须指向插件包${SELF_SUFFIX || ''}`)
}
if (target.name !== NAME) fail(`包名不一致：期望 ${NAME}，实际 ${target.name}（${real}）`)
// 产物存在性：lib 出库后，漏构建会在这里显式报错（而不是等 boot 时的 plugin.log）
const mainFile = typeof target.main === 'string' ? target.main : '.'
if (!existsSync(join(real, mainFile))) fail(`入口产物缺失：${join(real, mainFile)}\n  构建没跑成？在本仓 pnpm build 后重试`)
const typert = target.exports?.['./typert']
if (typert) {
  const typertFile = typeof typert === 'string' ? typert : typert.default
  if (!existsSync(join(real, typertFile))) fail(`typert 产物缺失：${join(real, typertFile)}（构建不完整？）`)
}

console.log(`[profile-add] ✓ 已安装并登记：${NAME} → ${real}`)
console.log(`[profile-add]   bundles = ${manifest.dsh.profile.bundles.join(', ')}`)
console.log('[profile-add] 重启实例一次生效；plugin.log / 装载排查见插件 README')
