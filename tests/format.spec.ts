// 渲染守卫：时区呈现、截断、limit 上限、空窗口文案、坏会话留痕。
import { describe, expect, it } from 'vitest'
import { formatFull, renderTranscripts } from '../src/format.ts'
import type { ScanResult } from '../src/scan.ts'

const TZ = 'Asia/Shanghai'
const T0 = Date.parse('2026-06-27T18:00:00Z') // 2026-06-28 02:00 +08:00

function result(sessions: ScanResult['sessions'], skipped: ScanResult['skipped'] = []): ScanResult {
  return { sessions, skipped }
}

const BASE = { timezone: TZ, limit: 200, since: T0, until: T0 + 3_600_000, hours: 1, explicitWindow: false }

describe('renderTranscripts', () => {
  it('时间按配置时区渲染（东八区，非 UTC）', () => {
    const out = renderTranscripts(result([
      { id: 'session-x', messages: [
        { ts: T0, role: 'user', text: '你好' },
        { ts: T0 + 60_000, role: 'assistant', text: '早' },
      ] },
    ]), BASE)
    expect(out).toContain('===== session-x (2 messages, since 2026-06-28 02:00) =====')
    expect(out).toContain('[02:00] user: 你好')
    expect(out).toContain('[02:01] assistant: 早')
    expect(out).not.toContain('T18:00') // 不得泄漏 UTC 串
  })

  it('formatFull 输出 YYYY-MM-DD HH:mm', () => {
    expect(formatFull(T0, TZ)).toBe('2026-06-28 02:00')
    expect(formatFull(T0, 'UTC')).toBe('2026-06-27 18:00')
  })

  it('单条超 500 字截断加省略号', () => {
    const long = 'x'.repeat(600)
    const out = renderTranscripts(result([
      { id: 's', messages: [{ ts: T0, role: 'user', text: long }] },
    ]), BASE)
    expect(out).toContain('x'.repeat(500) + '…')
    expect(out).not.toContain('x'.repeat(501))
  })

  it('limit 截断后输出截断标记', () => {
    const messages = Array.from({ length: 5 }, (_, i) => ({ ts: T0 + i, role: 'user' as const, text: `m${i}` }))
    const out = renderTranscripts(result([{ id: 's', messages }]), { ...BASE, limit: 3 })
    expect(out).toContain('m2')
    expect(out).not.toContain('m3')
    expect(out).toContain('… (truncated at 3 messages)')
  })

  it('空窗口：滚动窗与显式窗措辞不同', () => {
    expect(renderTranscripts(result([]), BASE)).toBe('No conversations in the last 1 hours.')
    expect(renderTranscripts(result([]), { ...BASE, explicitWindow: true }))
      .toBe('No conversations between 2026-06-28 02:00 and 2026-06-28 03:00.')
  })

  it('跳过的会话在输出末尾留痕', () => {
    const out = renderTranscripts(result([], [{ id: 'session-bad', reason: 'boom' }]), BASE)
    expect(out).toContain('(skipped session session-bad: boom)')
  })
})
