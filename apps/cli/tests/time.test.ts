import { DateTime } from 'luxon'
import { describe, expect, test } from 'bun:test'
import {
  buildRangeFromLocalTimes,
  formatIsoUtcForDisplay,
  parseDurationMinutes,
  parseTrackStartTimeOverride,
} from '../src/lib/time'

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

describe('parseTrackStartTimeOverride', () => {
  test('uses same local calendar day when time is earlier than now', () => {
    const now = DateTime.fromObject({ year: 2026, month: 4, day: 27, hour: 14, minute: 30 })
    const out = parseTrackStartTimeOverride('9:15am', { now })
    const local = DateTime.fromISO(out.startAtUtc).toLocal()
    expect(local.hour).toBe(9)
    expect(local.minute).toBe(15)
    expect(out.entryDate).toBe('2026-04-27')
  })

  test('rolls back one day when wall clock is later than now (late night)', () => {
    const now = DateTime.fromObject({ year: 2026, month: 4, day: 27, hour: 2, minute: 0 })
    const out = parseTrackStartTimeOverride('11pm', { now })
    const local = DateTime.fromISO(out.startAtUtc).toLocal()
    expect(local.toISODate()).toBe(out.entryDate)
    expect(local.day).toBe(26)
    expect(local.hour).toBe(23)
    expect(out.entryDate).toBe('2026-04-26')
  })

  test('rejects empty time', () => {
    expect(() => parseTrackStartTimeOverride('  ', { now: DateTime.now() })).toThrow('Time cannot be empty')
  })

  test('accepts 24-hour H:mm and 9:10 PM with space', () => {
    const now = DateTime.fromObject({ year: 2026, month: 4, day: 27, hour: 14, minute: 30 })
    const military = parseTrackStartTimeOverride('14:30', { now })
    const localM = DateTime.fromISO(military.startAtUtc).toLocal()
    expect(localM.hour).toBe(14)
    expect(localM.minute).toBe(30)

    const spaced = parseTrackStartTimeOverride('9:10 PM', { now })
    const localS = DateTime.fromISO(spaced.startAtUtc).toLocal()
    expect(localS.hour).toBe(21)
    expect(localS.minute).toBe(10)
    // 9:10 PM same calendar day is after 2:30 PM → rolls to previous local evening
    expect(spaced.entryDate).toBe('2026-04-26')
  })

  test('accepts compact h:mma and ha forms', () => {
    const now = DateTime.fromObject({ year: 2026, month: 4, day: 27, hour: 14, minute: 30 })
    const compact = parseTrackStartTimeOverride('9:10pm', { now })
    const localC = DateTime.fromISO(compact.startAtUtc).toLocal()
    expect(localC.hour).toBe(21)
    expect(localC.minute).toBe(10)

    const ha = parseTrackStartTimeOverride('9am', { now })
    const localHa = DateTime.fromISO(ha.startAtUtc).toLocal()
    expect(localHa.hour).toBe(9)
    expect(localHa.minute).toBe(0)
  })

  test('accepts zero-padded HH:mm', () => {
    const now = DateTime.fromObject({ year: 2026, month: 4, day: 27, hour: 14, minute: 30 })
    const out = parseTrackStartTimeOverride('09:15', { now })
    const local = DateTime.fromISO(out.startAtUtc).toLocal()
    expect(local.hour).toBe(9)
    expect(local.minute).toBe(15)
    expect(out.entryDate).toBe('2026-04-27')
  })
})

describe('formatIsoUtcForDisplay', () => {
  test('shows wall time in a fixed zone', () => {
    expect(formatIsoUtcForDisplay('2026-04-28T04:10:00.000Z', 'America/Los_Angeles')).toBe('2026-04-27 9:10 PM')
  })

  test('maps same instant across IANA zones', () => {
    const iso = '2026-01-15T12:00:00.000Z'
    expect(formatIsoUtcForDisplay(iso, 'UTC')).toBe('2026-01-15 12:00 PM')
    expect(formatIsoUtcForDisplay(iso, 'Asia/Tokyo')).toBe('2026-01-15 9:00 PM')
    expect(formatIsoUtcForDisplay(iso, 'Europe/Paris')).toBe('2026-01-15 1:00 PM')
  })

  test('trims explicit zone string', () => {
    expect(formatIsoUtcForDisplay('2026-04-28T04:10:00.000Z', '  America/Los_Angeles  ')).toBe(
      '2026-04-27 9:10 PM',
    )
  })

  test('returns input when ISO is invalid', () => {
    expect(formatIsoUtcForDisplay('not-a-timestamp')).toBe('not-a-timestamp')
  })

  test('falls back to local wall clock when explicit zone is invalid', () => {
    const out = formatIsoUtcForDisplay('2026-01-15T12:00:00.000Z', 'Not/A/Real/Zone')
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2} \d{1,2}:\d{2} [AP]M$/)
  })
})
