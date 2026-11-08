// 渲染：把扫描结果画成纯文本实录。时间一律按配置时区渲染（纯 toISOString 会
// 让凌晨触发的定时任务看到 UTC 的「昨天」，与当天日期错位）。

import type { ScanResult } from './scan.ts'

/** 单条消息的最长输出字符数，超出截断加省略号（防长回复淹没窗口）。 */
export const MESSAGE_MAX_LENGTH = 500

/** 按配置时区把 epoch 毫秒渲染成 YYYY-MM-DD HH:mm。 */
export function formatFull(ts: number, timezone: string): string {
  const parts = new Map<string, string>()
  for (const part of new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(ts))) {
    if (part.type !== 'literal') parts.set(part.type, part.value)
  }
  const p = (k: string): string => parts.get(k) ?? '00'
  return `${p('year')}-${p('month')}-${p('day')} ${p('hour')}:${p('minute')}`
}

/** 按配置时区把 epoch 毫秒渲染成 HH:mm。 */
export function formatHM(ts: number, timezone: string): string {
  return formatFull(ts, timezone).slice(11)
}

export interface RenderOptions {
  timezone: string
  /** 最大输出消息条数。 */
  limit: number
  since: number
  until: number
  /** 实际生效的滚动时长（小时），空窗口提示里用到。 */
  hours: number
  /** 窗口是否由 start/end 显式给定（决定空窗口提示的措辞）。 */
  explicitWindow: boolean
}

export function renderTranscripts(result: ScanResult, opts: RenderOptions): string {
  if (result.sessions.length === 0) {
    const empty = opts.explicitWindow
      ? `No conversations between ${formatFull(opts.since, opts.timezone)} and ${formatFull(opts.until, opts.timezone)}.`
      : `No conversations in the last ${opts.hours} hours.`
    return appendSkipped(empty, result)
  }

  const lines: string[] = []
  let printed = 0
  let capped = false
  for (const session of result.sessions) {
    lines.push('', `===== ${session.id} (${session.messages.length} messages, since ${formatFull(session.messages[0].ts, opts.timezone)}) =====`)
    for (const msg of session.messages) {
      if (printed >= opts.limit) {
        capped = true
        break
      }
      const text = msg.text.length > MESSAGE_MAX_LENGTH ? msg.text.slice(0, MESSAGE_MAX_LENGTH) + '…' : msg.text
      lines.push(`[${formatHM(msg.ts, opts.timezone)}] ${msg.role}: ${text}`)
      printed++
    }
    if (capped) break
  }
  if (capped) lines.push(`… (truncated at ${opts.limit} messages)`)
  return appendSkipped(lines.join('\n'), result)
}

function appendSkipped(text: string, result: ScanResult): string {
  if (result.skipped.length === 0) return text
  const notes = result.skipped.map((s) => `(skipped session ${s.id}: ${s.reason})`)
  return `${text}\n${notes.join('\n')}`
}
