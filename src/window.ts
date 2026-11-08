// 窗口解析：把 hours / start / end 入参折算成 [since, until) 毫秒区间。
//
// 语义与 CLI 时代的摘要脚本一致：
//   · start 与 end 任一给出时优先于 hours；缺 start 回落到 now - hours（此时 hours
//     仍可用），缺 end 回落到 now；
//   · 纯日期（YYYY-MM-DD）取该日 00:00；无时区后缀的时间按配置时区解释；
//   · 半开区间：[since, until)，恰好等于 until 的事件不算在内。

/** 时间入参无法解析或区间非法时抛出。 */
export class WindowError extends Error {}

/** 把 IANA 时区在给定时刻的 UTC 偏移量算出来（毫秒，东八区 = 28800000）。 */
function tzOffsetMs(timezone: string, at: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  })
  const parts = new Map<string, number>()
  for (const part of dtf.formatToParts(at)) {
    if (part.type !== 'literal') parts.set(part.type, Number(part.value))
  }
  const asUtc = Date.UTC(
    parts.get('year') ?? 1970,
    (parts.get('month') ?? 1) - 1,
    parts.get('day') ?? 1,
    parts.get('hour') ?? 0,
    parts.get('minute') ?? 0,
    parts.get('second') ?? 0,
  )
  return asUtc - at.getTime()
}

/**
 * 把「墙钟时间」折算成 epoch 毫秒。
 *
 * 接受三种形态：
 *   · YYYY-MM-DD              → 该日 00:00（配置时区）
 *   · YYYY-MM-DD[T ]HH:mm[:ss] → 该墙钟时刻（配置时区）
 *   · 带时区后缀（Z / ±HH:mm）的 ISO 串 → 按其后缀直接解析
 */
export function wallTimeToEpoch(timezone: string, value: string): number {
  const text = value.trim()
  const naive = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2})(?::(\d{2}))?)?$/.exec(text)
  if (naive !== null) {
    const [, date, hm = '00:00', ss = '00'] = naive
    const guess = Date.parse(`${date}T${hm}:${ss}Z`) // 先当 UTC 猜一个锚点
    if (Number.isNaN(guess)) throw new WindowError(`无法解析时间：${value}`)
    // 两遍法消 DST 歧义：用锚点处的偏移回推，再在结果处复核偏移，不同则以复核值为准
    const offsetGuess = tzOffsetMs(timezone, new Date(guess))
    const first = guess - offsetGuess
    const offsetCheck = tzOffsetMs(timezone, new Date(first))
    return offsetCheck === offsetGuess ? first : guess - offsetCheck
  }
  if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(text)) {
    throw new WindowError(
      `无法解析时间：${value}（用 YYYY-MM-DD、YYYY-MM-DD HH:mm，或带时区后缀的 ISO 串）`,
    )
  }
  const parsed = Date.parse(text)
  if (Number.isNaN(parsed)) throw new WindowError(`无法解析时间：${value}`)
  return parsed
}

export interface ChatWindow {
  since: number
  until: number
}

export interface WindowArgs {
  hours?: number
  start?: string
  end?: string
}

/**
 * 折算查询窗口。
 * @param timezone 配置时区（解释无后缀入参）
 * @param defaultHours 未给 hours 时的滚动时长
 * @param now 当前时刻（测试可注入）
 */
export function resolveWindow(
  args: WindowArgs,
  timezone: string,
  defaultHours: number,
  now: number = Date.now(),
): ChatWindow {
  const explicit = args.start !== undefined || args.end !== undefined
  const hours = args.hours ?? defaultHours
  if (!Number.isFinite(hours) || hours <= 0) {
    throw new WindowError(`hours 必须是正数，收到：${String(args.hours)}`)
  }
  if (!explicit) {
    return { since: now - hours * 3_600_000, until: now }
  }
  const since = args.start !== undefined ? wallTimeToEpoch(timezone, args.start) : now - hours * 3_600_000
  const until = args.end !== undefined ? wallTimeToEpoch(timezone, args.end) : now
  if (since > until) {
    throw new WindowError(`窗口起点晚于终点：${args.start ?? ''} → ${args.end ?? ''}`)
  }
  return { since, until }
}
