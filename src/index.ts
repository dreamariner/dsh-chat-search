// @dreamariner/dsh-chat-search :: Node 半边入口
//
// 注册 chat_search 工具：按时间窗检索全部会话历史，输出 slim 聊天实录
// （仅真人发言与助手回复的原文；框架注入上下文一律过滤）。
//
// ⚠ inject 是白名单：只声明的 service 才会出现在 ctx 上，漏声明不报错，只是
//   ctx.tools 为 undefined；而 loader 静默吞掉插件异常，表现为「插件静默失效」。
//   所以本插件对服务取用一律「取不到就明确抛错」，宁可装载失败也不要静默。

import type { Context } from '@deepseek-ai/cordis'
import { Config, KNOWN_KEYS, resolveConfig, type ChatSearchConfig } from './config.ts'
import { renderTranscripts } from './format.ts'
import { scanChatHistory } from './scan.ts'
import { requireSessionQuery } from './session-query.ts'
import { resolveWindow, WindowError } from './window.ts'

export const name = 'dsh-chat-search'
export const inject = ['tools', 'sessionQuery']
export { Config }

const DEFAULT_LIMIT = 200

/** 本插件用到的服务面（窄化：只声明用到的成员，cordis 的 Context 类型很宽）。 */
interface ToolsService {
  register(tool: {
    name: string
    description: string
    parameters: Record<string, unknown>
    output: { schema: { type: string }; render: (args: unknown, value: unknown) => Array<{ type: 'text'; text: string }> }
    execute: (args: unknown) => Promise<string>
    timeoutMs?: number
    isConcurrencySafe?: () => boolean
    presentCall?: (args: unknown) => { card: string; kind: string; title: string; rawInput?: unknown }
  }): void
}

interface ChatSearchArgs {
  hours?: number
  start?: string
  end?: string
  session_id?: string
  limit?: number
}

function assertPositive(name: string, value: number | undefined): void {
  if (value !== undefined && (!Number.isFinite(value) || value <= 0)) {
    throw new WindowError(`${name} 必须是正数，收到：${String(value)}`)
  }
}

export function apply(ctx: Context, rawConfig?: Partial<ChatSearchConfig> | null): void {
  // patch 里没有 config 时 YAML 会解析出 null，默认参数只对 undefined 生效，故显式兜底
  const config = resolveConfig(Config, rawConfig ?? {}, name)
  const log = (...args: unknown[]): void => { ctx.logger?.info?.(`[${name}]`, ...args) }

  const tools = (ctx as unknown as { tools?: ToolsService }).tools
  if (tools === undefined || typeof tools.register !== 'function') {
    throw new Error(`[${name}] ctx.tools 不可用：inject 白名单声明（['tools','sessionQuery']）与服务实际名称不一致`)
  }
  const sessionQuery = requireSessionQuery(ctx)

  tools.register({
    name: 'chat_search',
    description: 'Search chat history across all sessions in a time window and return the slim transcript: '
      + 'only real user messages and assistant replies, framework-injected context (memory recalls, agent '
      + 'instructions, scheduled deliveries) is filtered out. Use it to recall what was discussed recently '
      + 'or to verify conversation facts for a period.',
    parameters: {
      type: 'object',
      properties: {
        hours: { type: 'number', description: `Rolling window length in hours (default ${config.defaultHours}). Ignored when start or end is given.` },
        start: { type: 'string', description: 'Window start: YYYY-MM-DD or YYYY-MM-DD HH:mm, interpreted in the configured timezone; ISO strings with an offset are taken as-is.' },
        end: { type: 'string', description: 'Window end (exclusive), same formats as start. Defaults to now.' },
        session_id: { type: 'string', description: 'Only include sessions whose id contains this substring.' },
        limit: { type: 'number', description: `Maximum number of messages to print (default ${DEFAULT_LIMIT}).` },
      },
    },
    // 所有 tool 输出统一纯文本：模型不必二次解析结构化结果
    output: {
      schema: { type: 'string' },
      render: (_args: unknown, value: unknown) => [{ type: 'text', text: String(value) }],
    },
    timeoutMs: 120_000,
    isConcurrencySafe: () => true,
    presentCall: (args: unknown) => {
      const a = args as ChatSearchArgs
      const rawInput = a.start !== undefined || a.end !== undefined
        ? `${a.start ?? ''} → ${a.end ?? ''}`
        : `last ${a.hours ?? config.defaultHours}h`
      return { card: 'generic', kind: 'search', title: 'Search chat history', rawInput }
    },
    execute: async (rawArgs: unknown) => {
      const args = (rawArgs ?? {}) as ChatSearchArgs
      if (typeof args.hours !== 'undefined') assertPositive('hours', args.hours)
      if (typeof args.limit !== 'undefined') assertPositive('limit', args.limit)
      if (args.session_id !== undefined && (typeof args.session_id !== 'string' || args.session_id.trim() === '')) {
        throw new WindowError('session_id 给了就必须是非空字符串')
      }
      const explicitWindow = args.start !== undefined || args.end !== undefined
      const window = resolveWindow(args, config.timezone, config.defaultHours)
      const limit = Math.min(Math.floor(args.limit ?? DEFAULT_LIMIT), config.maxLimit)
      const result = await scanChatHistory(sessionQuery, {
        since: window.since,
        until: window.until,
        ...(args.session_id !== undefined ? { sessionId: args.session_id } : {}),
      })
      log(`chat_search：窗口 ${new Date(window.since).toISOString()} → ${new Date(window.until).toISOString()}，`
        + `命中 ${result.sessions.length} 个会话，跳过 ${result.skipped.length} 个`)
      return renderTranscripts(result, {
        timezone: config.timezone,
        limit,
        since: window.since,
        until: window.until,
        hours: args.hours ?? config.defaultHours,
        explicitWindow,
      })
    },
  })
  log('tool 已注册：chat_search')
}

// KNOWN_KEYS 导出给测试用（未知配置键守卫）；resolveConfig 的校验语义见 config.ts
export { KNOWN_KEYS }
