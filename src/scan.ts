// 扫描：时间窗内全部会话的 slim 对话提取。
//
// 语义铁律：
//   · user/message 只认 source.kind === 'user'（真人发言）。DSH 会把注入上下文也记成
//     user/message（agent 指令 / 运行时上下文 / 记忆召回快照 / 定时任务投递 …），
//     它们不是人说的话，混进来就是数据污染；
//   · assistant/message 全收（其 source 固定为模型署名）；
//   · 只取 text 块，工具调用、reasoning 等一律不进输出；
//   · 单个会话读取失败跳过并留痕，不拖垮整轮扫描（摘要场景崩一次 = 当天记录缺失）。

import type { SessionQueryService } from './session-query.ts'

export interface ChatMessage {
  /** 消息时间（epoch 毫秒，事件原值）。 */
  ts: number
  role: 'user' | 'assistant'
  text: string
}

export interface SessionTranscript {
  id: string
  messages: ChatMessage[]
}

export interface SkippedSession {
  id: string
  reason: string
}

export interface ScanResult {
  sessions: SessionTranscript[]
  skipped: SkippedSession[]
}

export interface ScanOptions {
  since: number
  until: number
  /** 会话 id 子串过滤；缺省不过滤。 */
  sessionId?: string
  signal?: AbortSignal
}

function textOfBlocks(blocks: Array<{ type: string; text?: string }> | undefined): string {
  if (!Array.isArray(blocks)) return ''
  return blocks
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('')
}

/** 从一个原始事件提取 slim 消息；与对话无关的事件返回 null。 */
export function extractChatMessage(event: {
  type: string
  time: number
  data: {
    source?: { kind?: string }
    content?: Array<{ type: string; text?: string }>
    message?: { content?: Array<{ type: string; text?: string }> }
  }
}): ChatMessage | null {
  if (event.type === 'user/message') {
    if (event.data?.source?.kind !== 'user') return null
    const text = textOfBlocks(event.data.content)
    return text === '' ? null : { ts: event.time, role: 'user', text }
  }
  if (event.type === 'assistant/message') {
    const text = textOfBlocks(event.data?.message?.content)
    return text === '' ? null : { ts: event.time, role: 'assistant', text }
  }
  return null
}

/** 扫描时间窗内的全部会话，返回按首条消息时间升序的实录清单。 */
export async function scanChatHistory(svc: SessionQueryService, opts: ScanOptions): Promise<ScanResult> {
  const records = await svc.listSessions(opts.signal)
  const skipped: SkippedSession[] = []
  const sessions: SessionTranscript[] = []

  for (const record of records) {
    if (opts.signal?.aborted === true) break
    const id = record.header.id
    if (opts.sessionId !== undefined && !id.includes(opts.sessionId)) continue
    let events
    try {
      events = (await svc.readSession(id)).events
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      skipped.push({ id, reason })
      continue
    }
    const messages: ChatMessage[] = []
    for (const event of events) {
      const msg = extractChatMessage(event)
      if (msg === null) continue
      if (msg.ts < opts.since || msg.ts >= opts.until) continue
      messages.push(msg)
    }
    if (messages.length === 0) continue
    sessions.push({ id, messages })
  }

  sessions.sort((a, b) => a.messages[0].ts - b.messages[0].ts)
  return { sessions, skipped }
}
