// 窗口解析语义守卫：时区解释、start/end 优先级、区间合法性。
import { describe, expect, it } from 'vitest'
import { resolveWindow, wallTimeToEpoch, WindowError } from '../src/window.ts'

const TZ = 'Asia/Shanghai' // 固定 +08:00，无夏令时

describe('wallTimeToEpoch', () => {
  it('纯日期按配置时区取该日 00:00', () => {
    // 2026-06-28 00:00 +08:00 = 2026-06-27T16:00:00Z
    expect(wallTimeToEpoch(TZ, '2026-06-28')).toBe(Date.parse('2026-06-27T16:00:00Z'))
  })

  it('无时区的日期时间按配置时区解释', () => {
    // 2026-06-28 02:00 +08:00 = 2026-06-27T18:00:00Z
    expect(wallTimeToEpoch(TZ, '2026-06-28 02:00')).toBe(Date.parse('2026-06-27T18:00:00Z'))
    expect(wallTimeToEpoch(TZ, '2026-06-28T02:00')).toBe(Date.parse('2026-06-27T18:00:00Z'))
    expect(wallTimeToEpoch(TZ, '2026-06-28T02:00:30')).toBe(Date.parse('2026-06-27T18:00:30Z'))
  })

  it('带时区后缀的 ISO 串按其后缀直接解析', () => {
    expect(wallTimeToEpoch(TZ, '2026-06-28T02:00:00+09:00')).toBe(Date.parse('2026-06-27T17:00:00Z'))
    expect(wallTimeToEpoch(TZ, '2026-06-28T02:00:00Z')).toBe(Date.parse('2026-06-28T02:00:00Z'))
  })

  it('其他时区的墙钟解释随之变化（UTC 的 00:00 = 东八区前一天 08:00 的 UTC 锚）', () => {
    expect(wallTimeToEpoch('UTC', '2026-06-28')).toBe(Date.parse('2026-06-28T00:00:00Z'))
    // 同一墙钟 02:00，纽约（西四区，6 月为 EDT -04:00）比东八区晚 12 小时
    expect(wallTimeToEpoch('America/New_York', '2026-06-28 02:00')).toBe(Date.parse('2026-06-28T06:00:00Z'))
  })

  it('无法解析的入参抛 WindowError', () => {
    expect(() => wallTimeToEpoch(TZ, 'yesterday')).toThrow(WindowError)
    expect(() => wallTimeToEpoch(TZ, '2026-06-28 25:00')).toThrow(WindowError)
    expect(() => wallTimeToEpoch(TZ, '2026-06-28 12:00 nowhere')).toThrow(WindowError)
  })
})

describe('resolveWindow', () => {
  const NOW = Date.parse('2026-06-29T18:00:00Z') // = 2026-06-30 02:00 +08:00

  it('只给 hours：滚动窗 [now - h, now)', () => {
    const w = resolveWindow({ hours: 24 }, TZ, 24, NOW)
    expect(w.since).toBe(NOW - 24 * 3_600_000)
    expect(w.until).toBe(NOW)
  })

  it('不给 hours 用配置默认', () => {
    const w = resolveWindow({}, TZ, 12, NOW)
    expect(w.since).toBe(NOW - 12 * 3_600_000)
  })

  it('start/end 优先于 hours；纯日期解释受时区影响', () => {
    const w = resolveWindow({ start: '2026-06-28 02:00', end: '2026-06-29 02:00', hours: 1 }, TZ, 24, NOW)
    expect(w.since).toBe(Date.parse('2026-06-27T18:00:00Z'))
    expect(w.until).toBe(Date.parse('2026-06-28T18:00:00Z'))
  })

  it('只给 end：起点回落到 now - hours；只给 start：终点回落到 now', () => {
    const onlyEnd = resolveWindow({ end: '2026-06-30 00:00', hours: 6 }, TZ, 6, NOW)
    expect(onlyEnd.since).toBe(NOW - 6 * 3_600_000)
    expect(onlyEnd.until).toBe(Date.parse('2026-06-29T16:00:00Z'))
    const onlyStart = resolveWindow({ start: '2026-06-29 00:00' }, TZ, 6, NOW)
    expect(onlyStart.since).toBe(Date.parse('2026-06-28T16:00:00Z'))
    expect(onlyStart.until).toBe(NOW)
  })

  it('起点晚于终点抛 WindowError；hours 非法抛 WindowError', () => {
    expect(() => resolveWindow({ start: '2026-06-29 02:00', end: '2026-06-28 02:00' }, TZ, 24, NOW)).toThrow(WindowError)
    expect(() => resolveWindow({ hours: 0 }, TZ, 24, NOW)).toThrow(WindowError)
    expect(() => resolveWindow({ hours: -3 }, TZ, 24, NOW)).toThrow(WindowError)
  })
})
