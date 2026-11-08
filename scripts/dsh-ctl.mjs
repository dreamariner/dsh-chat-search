#!/usr/bin/env node
// @dreamariner/dsh-chat-search :: dsh-ctl.mjs — DSH 实例管理（状态 / 启动 / 重启 / 停止 / 装载探针）
//
// ## 为什么需要它（机制借自早期插件仓的实测教训）
//
// **教训 1 · 停止不能走信号。** DSH 的 Electron 主进程在 `before-quit` 里总是
// `event.preventDefault()`，随后检查在飞任务，任一为真就弹原生模态确认框等人点。
// 脚本发的 quit 没人点 → 应用不退；macOS 上 SIGTERM 走同一条路径同样被拦。
// → stop 走**主进程 inspector**：把 `dialog.showMessageBox` 覆盖成自动应答，再
//   `app.quit()`，走正常退出路径。
//
// **教训 2 · 判活不能看日志。** 日志 append-only 跨重启累积（末条 URL 可能属于死
// 实例），前台启动时 URL 根本不进日志，端口又是 OS 分配 → 判据失效时不是报错而是
// **静默双开**。→ 判活用**主进程 inspector 端口是否应答**（默认 9229，同一时刻只可能
//   有一个实例绑着它）；打包版二进制要带 `--inspect=127.0.0.1:9229` 启动才有该端口。
//
// **教训 3 · 兜底强杀只能杀自己的实例。** 宽模式（命令行含 Harness 就算）会误杀机器上
// 别的 DSH 实例。→ 兜底按**属主圈定**：host 进程命令行带本实例 profile 路径 +
// `dsh-desktop-host`，Electron 主进程由 host 的 ppid 反推。
//
// **教训 4 · 启动前构建失败必须阻断。** lib/ 出库后没有旧产物可跑：构建失败继续启动 =
// 插件按包名解析 lib/index.js 失败 = 插件凭空消失（loader 吞异常，无日志）。
//
// ## 命令（pnpm dsh:<同名>）
//
//   dsh:status            实例状态（在跑 / 访问地址 / 主进程 pid）
//   dsh:url               打印访问地址（含 launch token；重启后旧地址失效）
//   dsh:start [前台|后台]  启动实例（默认前台；后台 = detached + 等就绪）
//   dsh:restart [前台|后台] 停止后重启（默认后台）
//   dsh:stop              优雅停止（inspector → 兜底属主圈定 SIGKILL）
//   dsh:probe [--all]     连接实例并验证本插件装载（pluginInventory/list → fiberPhase）
//
// ## 环境变量
//
//   DSH_HOME                        实例 home（默认 ~/.dsh）
//   DSH_PROFILE                     实例 profile 名（默认 desktop；属主圈定与探针用）
//   DSH_LOG                         实例日志（默认 $DSH_HOME/logs/dsh-desktop.log）
//   DSH_DESKTOP_MAIN_INSPECT_PORT   主进程 inspector 端口（默认 9229）
//   DSH_DESKTOP_APP                 官方打包版 .app 路径（默认 /Applications/DeepSeek Harness.app）
//   DSH_DESKTOP_FORM                official（默认）| dev（DSH_CHECKOUT 源码形态）
//   DSH_CHECKOUT                    dev 形态的 DSH 源码 checkout 路径（显式指定，无默认推导）
//
// ## 退出码
//
//   0 = 成功；1 = 用法错 / 操作失败；3 = status 时实例没在跑；4 = 插件已装载但非 active；
//   5 = 插件未出现在实例的插件清单里。
//
// ⚠ 纪律：实例必须固定经本脚本（dsh:start）启动。Dock 直启的实例没有 inspector，
//   stop / restart / 双开守卫都管不了它。
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const NAME = '@dreamariner/dsh-chat-search'
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const dshHome = () => process.env.DSH_HOME || join(homedir(), '.dsh')
const profileName = () => process.env.DSH_PROFILE || 'desktop'
const logFile = () => process.env.DSH_LOG || join(dshHome(), 'logs', 'dsh-desktop.log')
const stateFile = () => join(dshHome(), 'dsh-instance.json')
const inspectPort = () => Number(process.env.DSH_DESKTOP_MAIN_INSPECT_PORT || 9229)
const desktopApp = () => process.env.DSH_DESKTOP_APP || '/Applications/DeepSeek Harness.app'

const argv = process.argv.slice(2)
const cmd = argv[0]
const rest = argv.slice(1)
const argOf = (name, dflt) => { const i = rest.indexOf(name); return i >= 0 && rest[i + 1] !== undefined ? rest[i + 1] : dflt }
const fail = (msg) => { console.error(`[dsh-ctl] ✗ ${msg}`); process.exit(1) }
const usage = () => fail(`未知命令：${cmd ?? '（缺）'}。可用：status | url | start [前台|后台] | restart [前台|后台] | stop | probe [--all]`)

/** 启动形态：official（打包版 + --inspect）| dev（DSH_CHECKOUT 源码）。 */
const form = () => process.env.DSH_DESKTOP_FORM || 'official'

/** 从日志取最后一个访问地址（仅展示兜底——它可能是上一次实例的）。 */
function lastUrlFromLog() {
  const log = logFile()
  if (!existsSync(log)) return undefined
  try {
    const m = [...readFileSync(log, 'utf8').matchAll(/http:\/\/127\.0\.0\.1:(\d+)\/\?token=([A-Za-z0-9_-]+)/g)].pop()
    return m ? `http://127.0.0.1:${m[1]}/?token=${m[2]}` : undefined
  } catch { return undefined }
}

function readState() { try { return JSON.parse(readFileSync(stateFile(), 'utf8')) } catch { return undefined } }
function record(patch) {
  mkdirSync(dshHome(), { recursive: true })
  writeFileSync(stateFile(), `${JSON.stringify({ ...(readState() ?? {}), ...patch }, null, 2)}\n`)
}
const alive = (pid) => { if (!pid) return false; try { process.kill(pid, 0); return true } catch { return false } }

/** 主进程 inspector 是否应答（= Electron 主进程活着且可管理）。 */
async function inspectorUp() {
  try {
    const res = await fetch(`http://127.0.0.1:${inspectPort()}/json/list`, { signal: AbortSignal.timeout(1500) })
    if (!res.ok) return undefined
    const list = await res.json()
    return Array.isArray(list) && list.length > 0 ? list : undefined
  } catch { return undefined }
}

/** 在 inspector 目标（主进程）里求值一个表达式。 */
async function evaluate(target, expression) {
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true })
    ws.addEventListener('error', () => rej(new Error('inspector websocket error')), { once: true })
  })
  try {
    return await new Promise((res) => {
      ws.addEventListener('message', function onMessage(event) {
        const msg = JSON.parse(event.data)
        if (msg.id === 1) { ws.removeEventListener('message', onMessage); res(msg.result?.result?.value) }
      })
      ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }))
    })
  } finally { ws.close() }
}

/** 探测地址 origin 是否可达（实例活着时 `/` 会 401，但连接是通的）。 */
async function originUp(url) {
  try { await fetch(new URL(url).origin + '/', { signal: AbortSignal.timeout(1500) }); return true } catch { return false }
}

/** 属主圈定：只找属于本 DSH_HOME + profile 的实例进程（host 带 profile 路径，主进程按 ppid 反推）。 */
function findOurInstancePids() {
  const marker = join(dshHome(), 'profiles', profileName())
  const table = spawnSync('ps', ['-eo', 'pid=,ppid=,command='], { encoding: 'utf8' }).stdout ?? ''
  const rows = table.split('\n').map((line) => {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/)
    return m ? { pid: Number(m[1]), ppid: Number(m[2]), cmd: m[3] } : undefined
  }).filter(Boolean)
  const out = new Set()
  for (const row of rows) {
    if (row.pid === process.pid) continue
    if (!row.cmd.includes(marker) || !row.cmd.includes('dsh-desktop-host')) continue
    out.add(row.pid)
    const parent = rows.find((r) => r.pid === row.ppid)
    if (parent && /Harness/i.test(parent.cmd)) out.add(parent.pid)
  }
  return [...out]
}

async function waitGone(pids, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (pids.every((p) => !alive(p))) return true
    await new Promise((r) => setTimeout(r, 200))
  }
  return pids.every((p) => !alive(p))
}

async function status() {
  if (typeof WebSocket === 'undefined') fail('本 Node 没有全局 WebSocket（需 node ≥ 22），inspector 通道不可用')
  const targets = await inspectorUp()
  let mainPid
  if (targets) { try { mainPid = await evaluate(targets[0], 'process.pid') } catch { /* 忽略 */ } }
  const state = readState()
  const url = state?.url ?? lastUrlFromLog()
  const running = Boolean(targets) || Boolean(url && (await originUp(url)))
  return { running, mainPid: typeof mainPid === 'number' ? mainPid : state?.mainPid, url, inspectorPort: inspectPort(), form: form() }
}

async function stop() {
  if (typeof WebSocket === 'undefined') fail('本 Node 没有全局 WebSocket（需 node ≥ 22），inspector 通道不可用')
  const targets = await inspectorUp()
  if (!targets) {
    // 无 inspector：没在跑，或实例不是经本脚本启动的（打包版 Dock 直启）。只能属主圈定强杀。
    const pids = findOurInstancePids()
    if (pids.length === 0) return { stopped: false, via: 'not-running' }
    for (const p of pids) { try { process.kill(p, 'SIGKILL') } catch { /* noop */ } }
    await waitGone(pids, 5000)
    return { stopped: true, via: 'sigkill(no-inspector)', pid: pids[0] }
  }
  let pid
  try { pid = await evaluate(targets[0], 'process.pid') } catch { /* 忽略 */ }
  // 覆盖原生确认框为自动应答，再走 app.quit() 的正常退出路径（before-quit 模态不再拦人）。
  try {
    await evaluate(targets[0], `(() => {
      const electron = process.mainModule.require('electron');
      electron.dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
      setTimeout(() => electron.app.quit(), 50);
      return 'armed';
    })()`)
  } catch { /* 求值失败退到兜底强杀 */ }
  if (typeof pid === 'number' && (await waitGone([pid], 8000))) return { stopped: true, via: 'inspector(app.quit)', pid }
  const pids = typeof pid === 'number' ? [pid, ...findOurInstancePids().filter((p) => p !== pid)] : findOurInstancePids()
  for (const p of pids) { try { process.kill(p, 'SIGKILL') } catch { /* noop */ } }
  await waitGone(pids, 5000)
  return { stopped: true, via: 'sigkill(fallback)', pid: pids[0] ?? pid }
}

/** 启动前构建门（教训 4）：构建失败阻断启动。 */
function buildGate() {
  console.log('[dsh-ctl] pnpm build（启动前构建门：lib/ 出库，没有旧产物可跑）')
  const r = spawnSync('pnpm', ['run', 'build'], { cwd: repo, stdio: 'inherit' })
  if (r.status !== 0) fail('构建失败，已阻断启动（继续启动 = 插件凭空消失）')
}

function launchCmd() {
  if (form() === 'dev') {
    const checkout = process.env.DSH_CHECKOUT
    if (!checkout) fail('dev 形态需要显式指定 DSH_CHECKOUT（或用默认 official 形态）')
    if (!existsSync(checkout)) fail(`DSH_CHECKOUT 目录不存在：${checkout}`)
    const skip = process.env.DSH_SKIP_BUILD === '1' && existsSync(join(checkout, 'apps/desktop/.desktop-build'))
    return { cmd: 'pnpm', args: [skip ? 'start:desktop' : 'dev:desktop'], cwd: checkout }
  }
  const app = desktopApp()
  const bin = join(app, 'Contents', 'MacOS', app.split('/').pop().replace(/\.app$/, ''))
  if (!existsSync(bin)) fail(`官方打包版不存在或不可执行：${app}（DSH_DESKTOP_APP 可指定 .app 路径）`)
  // 打包版自己不开 inspector；--inspect 是 Electron 二进制级开关，stop/status/双开守卫全靠它。
  return { cmd: bin, args: [`--inspect=127.0.0.1:${inspectPort()}`], cwd: homedir() }
}

async function start(modeDefault) {
  const mode = rest.find((a) => a === '前台' || a === '后台') ?? modeDefault
  buildGate()
  const st = await status()
  if (st.running) {
    console.log(`[dsh-ctl] 实例已在运行${st.url ? `：${st.url}` : ''}；如需重启用 pnpm dsh:restart`)
    process.exit(0)
  }
  const { cmd, args, cwd } = launchCmd()
  mkdirSync(dirname(logFile()), { recursive: true })
  if (mode === '后台') {
    const out = openSync(logFile(), 'a')
    const child = spawn(cmd, args, { cwd, detached: true, stdio: ['ignore', out, out] })
    child.unref()
    console.log(`[dsh-ctl] 已后台启动（PID ${child.pid}，形态 ${form()}：${cmd} ${args.join(' ')}）`)
    for (let i = 0; i < 90; i++) {
      if (!alive(child.pid)) { console.error('[dsh-ctl] ✗ 进程已退出，日志末尾：'); console.error(readFileSync(logFile(), 'utf8').split('\n').slice(-12).join('\n')); process.exit(1) }
      const url = lastUrlFromLog()
      if (url && (await originUp(url))) {
        console.log(`[dsh-ctl] ✓ 就绪：${url}`)
        record({ mainPid: child.pid, url, startedAt: new Date().toISOString(), form: form(), mode })
        process.exit(0)
      }
      await new Promise((r) => setTimeout(r, 2000))
    }
    console.log('[dsh-ctl] 仍在启动中，稍后用 pnpm dsh:status 取地址')
    process.exit(0)
  }
  // 前台：URL 要等应用打印（不进日志），先记 pid 再顶替
  record({ mainPid: process.pid, mode: 'foreground', form: form() })
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit' })
  process.exit(r.status ?? 0)
}

/** 装载探针：连实例 Web API，验证本插件在 pluginInventory 里且 active。 */
async function probe() {
  const url = readState()?.url ?? lastUrlFromLog()
  if (!url) fail('无法确定实例地址（实例没经 dsh:start 启动过？日志里也没有地址）')
  const base = new URL(url).origin
  const res = await fetch(`${base}/?token=${new URL(url).searchParams.get('token')}`, { redirect: 'manual' })
  const cookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
  const call = async (method, argsObj = {}) => {
    const r = await fetch(`${base}/api/${method}`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'dsh-ctl-' + Date.now(), method, payload: { args: argsObj } }),
      signal: AbortSignal.timeout(20000),
    })
    const j = await r.json()
    if (!j.result?.ok) throw new Error(`${method}: ${j.result?.error?.code ?? ''} ${j.result?.error?.message ?? r.status}`)
    return j.result.value
  }
  const inv = await call('pluginInventory/list')
  const entries = inv.entries ?? []
  const showAll = rest.includes('--all')
  if (showAll) for (const e of entries) console.log(`  ${e.fiberPhase ?? 'disabled'}  ${e.moduleName}  (entry ${e.entryId})`)
  const mine = entries.filter((e) => e.moduleName === NAME)
  console.log(`实例 ${base} · 插件条目 ${entries.length} 条 · 本插件命中 ${mine.length} 条`)
  for (const e of mine) console.log(`  ${e.fiberPhase ?? 'disabled'}  ${e.moduleName}  (entry ${e.entryId})`)
  if (mine.length === 0) { console.error(`[dsh-ctl] ✗ 插件未装载（未登记 / lib 缺失 / 装载报错，查实例日志与 plugin.log）`); process.exit(5) }
  if (!mine.every((e) => e.fiberPhase === 'active')) { console.error('[dsh-ctl] ✗ 已装载但非 active（pending/failed，查装载日志）'); process.exit(4) }
  console.log('[dsh-ctl] ✓ 插件已装载且 active')
}

switch (cmd) {
  case 'status': {
    const st = await status()
    console.log(st.running
      ? `[dsh-ctl] 实例在跑${st.mainPid ? `（主进程 ${st.mainPid}）` : ''}${st.url ? `\n[dsh-ctl] 地址：${st.url}` : ''}`
      : '[dsh-ctl] 实例没在跑')
    process.exit(st.running ? 0 : 3)
  }
  case 'url': {
    const st = await status()
    if (!st.url) fail('没有可用地址（实例没启动过？）')
    console.log(st.url)
    break
  }
  case 'stop': {
    const r = await stop()
    console.log(r.stopped ? `[dsh-ctl] 已停止（${r.via}${r.pid ? `，pid ${r.pid}` : ''}）` : '[dsh-ctl] 实例本来就没在跑')
    break
  }
  case 'start': await start('前台'); break
  case 'restart': {
    const r = await stop()
    console.log(r.stopped ? `[dsh-ctl] 已停止（${r.via}），重新启动…` : '[dsh-ctl] 实例本来就没在跑，直接启动…')
    await start('后台')
    break
  }
  case 'probe': await probe(); break
  default: usage()
}
