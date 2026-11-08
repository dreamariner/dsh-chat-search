// ctx.sessionQuery 的结构化视图：只声明本插件用到的成员。
//
// 走官方 seam 的理由（相对手拼 sessions 目录直读文件）：
//   · 物理编码（明文 / zstd）透明，日志文件怎么存都不影响；
//   · 活会话与冷会话统一读取，路径归一化、半截日志的中断轮补齐都由服务处理；
//   · 读取失败带稳定的错误码，可逐会话隔离。
//
// 刻意不 import @deepseek-ai/dsh-session-query：宿主运行时自挂数据形状用结构化
// 类型钉住即可，插件依赖面只剩 schemastery。字段如有漂移，index.ts 的运行时守卫
// 会显式报错，不会静默。

/** 会话消息内容块的最小视图（只关心 text 块）。 */
export interface ContentBlockView {
  type: string
  text?: string
}

/** 原始会话事件的最小视图。 */
export interface SessionEventView {
  type: string
  time: number
  data: {
    source?: { kind?: string }
    content?: ContentBlockView[]
    message?: { content?: ContentBlockView[] }
  }
}

/** readSession 返回的最小视图。 */
export interface SessionLogView {
  session: { id: string; createdAt?: number }
  events: SessionEventView[]
}

/** listSessions 返回的最小视图。 */
export interface SessionRecordView {
  header: { id: string }
}

/** 本插件消费的 ctx.sessionQuery 服务面。 */
export interface SessionQueryService {
  listSessions(signal?: AbortSignal): Promise<SessionRecordView[]>
  readSession(sessionId: string): Promise<SessionLogView>
}

/** 从 ctx 上取出服务并守卫：取不到就明确抛错，宁可装载失败也不要静默。 */
export function requireSessionQuery(ctx: unknown): SessionQueryService {
  const svc = (ctx as { sessionQuery?: unknown }).sessionQuery as SessionQueryService | undefined
  if (svc === undefined || typeof svc.listSessions !== 'function' || typeof svc.readSession !== 'function') {
    throw new Error(
      '[dsh-chat-search] ctx.sessionQuery 不可用：inject 白名单需声明 sessionQuery，且宿主须挂载 dsh-session-query 后端（dsh-base 自带）',
    )
  }
  return svc
}
