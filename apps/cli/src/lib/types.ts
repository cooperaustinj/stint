export type Shell = 'fish' | 'bash' | 'zsh'

export type EntryInput = {
    entryDate: string
    durationMinutes: number
    note: string
    clientKey: string
    projectKey: string
    startAtUtc?: string | null
    endAtUtc?: string | null
}

export type EntryRow = {
    id: number
    entry_date: string
    start_at_utc: string | null
    end_at_utc: string | null
    duration_minutes: number
    calculated_duration_minutes?: number
    duration_override_minutes?: number | null
    status?: 'completed' | 'tracking'
    note: string
    overlap_warning: number
    deleted_at: string | null
    client_key: string
    project_key: string
    client_name: string
    project_name: string
}

export type StintConfig = {
    defaultClientKey?: string
    defaultProjectKey?: string
    defaultReportLast?: number
    invoiceContractor?: {
        name?: string
        company?: string
        email?: string
        phone?: string
        addressLine1?: string
        addressLine2?: string
        city?: string
        state?: string
        postalCode?: string
        country?: string
    }
    invoiceNextNumber?: number
}
