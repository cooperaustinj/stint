import { describe, expect, test } from 'bun:test'
import { buildRangeFromLocalTimes, parseDurationMinutes } from '../src/lib/time'

describe('parseDurationMinutes', () => {
  test('parses decimal hours', () => {
    expect(parseDurationMinutes('2.5h')).toBe(150)
  })

  test('parses minutes', () => {
    expect(parseDurationMinutes('15m')).toBe(15)
  })

  test('parses compound', () => {
    expect(parseDurationMinutes('1h 30m')).toBe(90)
  })
})

describe('buildRangeFromLocalTimes', () => {
  test('rolls end time to next day when needed', () => {
    const out = buildRangeFromLocalTimes('2026-01-01', '11pm', '1am')
    expect(out.durationMinutes).toBe(120)
  })
})
