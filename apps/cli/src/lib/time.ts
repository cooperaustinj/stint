import { DateTime } from 'luxon'

const DURATION_TOKEN = /([0-9]+(?:\.[0-9]+)?)\s*(h|m)/gi

export function parseDurationMinutes(input: string): number {
  const normalized = input.trim().toLowerCase()
  if (!normalized) {
    throw new Error('Duration cannot be empty')
  }

  let minutes = 0
  let consumed = ''
  let match: RegExpExecArray | null = DURATION_TOKEN.exec(normalized)
  while (match) {
    const value = Number(match[1])
    const unit = match[2]
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`Invalid duration token: ${match[0]}`)
    }
    minutes += unit === 'h' ? Math.round(value * 60) : Math.round(value)
    consumed += match[0]
    match = DURATION_TOKEN.exec(normalized)
  }

  if (minutes <= 0) {
    throw new Error(`Could not parse positive duration from: ${input}`)
  }

  const compactInput = normalized.replace(/\s+/g, '')
  const compactConsumed = consumed.replace(/\s+/g, '')
  if (compactInput !== compactConsumed) {
    throw new Error(`Unsupported duration format: ${input}`)
  }

  return minutes
}

const TIME_FORMATS = ['h:mma', 'h:mm a', 'ha', 'h a', 'H:mm', 'HH:mm']

export function parseDateInput(date: string): DateTime {
  const dt = DateTime.fromISO(date)
  if (!dt.isValid) {
    throw new Error(`Invalid date format: ${date}. Expected YYYY-MM-DD`)
  }
  return dt.startOf('day')
}

function parseTimeOnDate(input: string, date: DateTime): DateTime {
  for (const fmt of TIME_FORMATS) {
    const dt = DateTime.fromFormat(input.trim(), fmt, { zone: 'local' })
    if (dt.isValid) {
      return date.set({ hour: dt.hour, minute: dt.minute, second: 0, millisecond: 0 })
    }
  }
  throw new Error(`Could not parse time: ${input}`)
}

export function buildRangeFromLocalTimes(date: string, start: string, end: string): {
  durationMinutes: number
  startAtUtc: string
  endAtUtc: string
} {
  const entryDate = parseDateInput(date)
  const localStart = parseTimeOnDate(start, entryDate)
  let localEnd = parseTimeOnDate(end, entryDate)
  if (localEnd <= localStart) {
    localEnd = localEnd.plus({ days: 1 })
  }

  const durationMinutes = Math.round(localEnd.diff(localStart, 'minutes').minutes)
  if (durationMinutes <= 0) {
    throw new Error('Computed duration must be positive')
  }

  return {
    durationMinutes,
    startAtUtc: localStart.toUTC().toISO() as string,
    endAtUtc: localEnd.toUTC().toISO() as string,
  }
}

export function todayIsoLocal(): string {
  return DateTime.local().toISODate() as string
}

export function minutesToHuman(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h > 0 && m > 0) {
    return `${h}h ${m}m`
  }
  if (h > 0) {
    return `${h}h`
  }
  return `${m}m`
}
