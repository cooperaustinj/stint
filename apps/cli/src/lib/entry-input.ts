import type { EntryInput, StintConfig } from './types'
import { buildRangeFromLocalTimes, parseDurationMinutes, todayIsoLocal } from './time'

export type EntryArgs = {
    durationArg?: string
    noteArg?: string
    duration?: string
    start?: string
    end?: string
    date?: string
    note?: string
    client?: string
    project?: string
}

export function buildEntryInput(args: EntryArgs, config: StintConfig): EntryInput {
    const note = (args.note ?? args.noteArg ?? '').trim()
    if (!note) {
        throw new Error('Note is required')
    }

    const entryDate = args.date ?? todayIsoLocal()

    const durationInput = args.duration ?? args.durationArg
    const hasDuration = Boolean(durationInput)
    const hasRange = Boolean(args.start || args.end)

    if (hasDuration && hasRange) {
        throw new Error('Provide either duration or start/end, not both')
    }
    if (!hasDuration && !hasRange) {
        throw new Error('Provide either duration or start/end')
    }

    if (hasDuration) {
        const clientKey = args.client ?? config.defaultClientKey
        const projectKey = args.project ?? config.defaultProjectKey
        if (!clientKey) {
            throw new Error('Client is required. Pass --client or set config default.')
        }
        if (!projectKey) {
            throw new Error('Project is required. Pass --project or set config default.')
        }

        return {
            entryDate,
            durationMinutes: parseDurationMinutes(durationInput as string),
            note,
            clientKey,
            projectKey,
            startAtUtc: null,
            endAtUtc: null,
        }
    }

    if (!args.start || !args.end) {
        throw new Error('Both --start and --end are required when using time range')
    }

    const clientKey = args.client ?? config.defaultClientKey
    const projectKey = args.project ?? config.defaultProjectKey
    if (!clientKey) {
        throw new Error('Client is required. Pass --client or set config default.')
    }
    if (!projectKey) {
        throw new Error('Project is required. Pass --project or set config default.')
    }

    const range = buildRangeFromLocalTimes(entryDate, args.start, args.end)
    return {
        entryDate,
        durationMinutes: range.durationMinutes,
        note,
        clientKey,
        projectKey,
        startAtUtc: range.startAtUtc,
        endAtUtc: range.endAtUtc,
    }
}
