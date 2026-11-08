// @dreamariner/dsh-chat-search 配置
// 校验语义：默认值填充 + 带路径的类型报错。schemastery 与宿主共享同一实例
// （peerDependencies 声明 + dev 精确钉版本），不要改成普通 dependency。

import z from '@deepseek-ai/schemastery'

export interface ChatSearchConfig {
  /** 渲染时间戳用的 IANA 时区；无时区后缀的时间入参也按它解释。 */
  timezone: string
  /** 未显式给窗口时的滚动时长（小时）。 */
  defaultHours: number
  /** 单次调用允许输出的最大消息条数上限（limit 入参会被夹到它以内）。 */
  maxLimit: number
}

export const Config: z<ChatSearchConfig> = z.object({
  timezone: z.string().default('Asia/Shanghai'),
  defaultHours: z.number().step(1).min(1).default(24),
  maxLimit: z.number().step(1).min(1).default(2000),
})

/** 已知键（schemastery 的 Schema 类型不暴露 properties，故显式列出）。 */
export const KNOWN_KEYS = ['timezone', 'defaultHours', 'maxLimit'] as const

/** schemastery 标准校验的同步封装：默认值填充 + 带路径报错；不支持异步校验。 */
export function resolveConfig<T>(schema: z<T>, raw: unknown, plugin: string): T {
  const result = (schema as unknown as { '~standard': { validate: (v: unknown) => unknown } })['~standard'].validate(raw) as
    | { issues?: Array<{ path?: string[]; message: string }>; value?: T }
    | undefined
  if (result === undefined || result === null) throw new Error(`[${plugin}] 配置校验无返回`)
  if (typeof (result as { then?: unknown }).then === 'function') {
    throw new TypeError(`[${plugin}] 不支持异步配置校验`)
  }
  if (result.issues !== undefined && result.issues.length > 0) {
    const detail = result.issues.map((i) => `${(i.path ?? []).join('.') || '(root)'}: ${i.message}`).join('；')
    throw new Error(`[${plugin}] 配置校验失败：${detail}`)
  }
  return result.value as T
}
