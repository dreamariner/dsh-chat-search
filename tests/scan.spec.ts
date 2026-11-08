// 扫描语义守卫：来源过滤（只认真人）、窗口边界、坏会话隔离、排序。
// 语义对照来源：原 CLI 摘要脚本的实测规则（真人发言 / 注入上下文剔除 / 半开区间）。
import { describe, expect, it } from 'vitest'
import { extractChatMessage, scanChatHistory, type ChatMessage } from '../src/scan.ts'
import type { SessionQueryService, SessionEventView } from '../src/session-query.ts'

const T0 = Date.parse('2026-06-27T18:00:00Z') // 2026-06-28 02:00 +08:00
const H = 3_600_000

interface FakeEvent { type: string; time: number; data: Record<string, unknown> }

function userMsg(ts: number, text: string, kind = 'user'): FakeEvent {
  return { type: 'user/message', time: ts, data: { source: { kind }, content: [{ type: 'text', text }] } }
}
function assistantMsg(ts: number, text: string): FakeEvent {
  return { type: 'assistant/message', time: ts, data: { message: { content: [{ type: 'text', text }] } } }
}

function fakeService(sessions: Record<string, FakeEvent[]>, failIds: string[] = []): SessionQueryService {
  return {
    async listSessions() {
      return Object.keys(sessions).map((id) => ({ header: { id } }))
    },
    async readSession(id: string) {
      if (failIds.includes(id)) throw new Error(`simulated read failure for ${id}`)
      return { session: { id }, events: sessions[id] ?? [] as unknown as SessionEventView[] }
    },
  }
}

function texts(messages: ChatMessage[]): string[] {
  return messages.map((m) => m.text)
}

describe('extractChatMessage', () => {
  it('user/message 只认 source.kind=user 的真人发言', () => {
    expect(extractChatMessage(userMsg(T0, '你好'))).toMatchObject({ role: 'user', text: '你好' })
    // 注入上下文全家：定时投递、记忆召回、缺 source 的都剔除
    expect(extractChatMessage(userMsg(T0, '投递', 'schedule'))).toBeNull()
    expect(extractChatMessage(userMsg(T0, '记忆', 'memory-recall'))).toBeNull()
    expect(extractChatMessage(userMsg(T0, '指令', 'agent-instructions'))).toBeNull()
    expect(extractChatMessage({ type: 'user/message', time: T0, data: { content: [{ type: 'text', text: '无来源' }] } })).toBeNull()
  })

  it('assistant/message 全收；text 块拼接；空文本剔除', () => {
    expect(extractChatMessage(assistantMsg(T0, '回复'))).toMatchObject({ role: 'assistant' })
    const multi = { type: 'assistant/message', time: T0, data: { message: { content: [
      { type: 'text', text: 'a' }, { type: 'reasoning', text: 'x' }, { type: 'text', text: 'b' },
    ] } } }
    expect(extractChatMessage(multi)?.text).toBe('ab')
    expect(extractChatMessage({ type: 'assistant/message', time: T0, data: { message: { content: [] } } })).toBeNull()
  })

  it('非对话事件一律不进输出', () => {
    const toolCall = { type: 'tool/call', time: T0, data: { name: 'bash' } } as unknown as Parameters<typeof extractChatMessage>[0]
    expect(extractChatMessage(toolCall)).toBeNull()
    expect(extractChatMessage({ type: 'tool/result', time: T0, data: {} })).toBeNull()
    expect(extractChatMessage({ type: 'turn/start', time: T0, data: {} })).toBeNull()
  })
})

describe('scanChatHistory', () => {
  const SESSIONS = {
    'session-aaa': [
      { type: 'turn/start', time: T0 - H, data: {} },
      userMsg(T0, '早上好'),
      userMsg(T0 + 1, '注入噪音', 'runtime-context'),
      assistantMsg(T0 + 2, '早'),
      userMsg(T0 + 2 * 24 * H, '窗口外'),
    ],
    'session-bbb': [
      assistantMsg(T0 + 5, '先说话的会话（按首条时间排序应排前面）'),
      userMsg(T0 + 6, '嗯'),
    ],
    'session-ccc': [userMsg(T0 + 3 * 24 * H, '完全在窗口外')],
  }

  it('窗口半开区间 [since, until)：恰好等于 until 的不算', async () => {
    const r = await scanChatHistory(fakeService(SESSIONS), { since: T0, until: T0 + 2 })
    const aaa = r.sessions.find((s) => s.id === 'session-aaa')
    expect(texts(aaa?.messages ?? [])).toEqual(['早上好'])
  })

  it('坏会话跳过并留痕，其余会话照常输出', async () => {
    const r = await scanChatHistory(fakeService(SESSIONS, ['session-aaa']), { since: T0, until: T0 + 10 * H })
    expect(r.sessions.map((s) => s.id)).toEqual(['session-bbb'])
    expect(r.skipped).toEqual([{ id: 'session-aaa', reason: 'simulated read failure for session-aaa' }])
  })

  it('会话按首条消息时间升序排列；全窗口外的会话不出现', async () => {
    const r = await scanChatHistory(fakeService(SESSIONS), { since: T0, until: T0 + 10 * H })
    expect(r.sessions.map((s) => s.id)).toEqual(['session-aaa', 'session-bbb'])
  })

  it('session_id 子串过滤是纯过滤项', async () => {
    const r = await scanChatHistory(fakeService(SESSIONS), { since: T0, until: T0 + 10 * H, sessionId: 'bbb' })
    expect(r.sessions.map((s) => s.id)).toEqual(['session-bbb'])
  })
})
