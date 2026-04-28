import type { Database } from 'bun:sqlite'
import type { EntryInput, EntryRow } from '../lib/types'

export function mustGetClient(db: Database, key: string): { id: number; key: string; name: string } {
    const row = db
        .query('SELECT id, key, name FROM clients WHERE key = ? AND archived_at IS NULL AND active = 1')
        .get(key) as { id: number; key: string; name: string } | null
    if (!row) {
        throw new Error(`Client not found or archived: ${key}`)
    }
    return row
}

export function mustGetProject(
    db: Database,
    key: string,
): { id: number; key: string; client_id: number; name: string } {
    const row = db
        .query('SELECT id, key, client_id, name FROM projects WHERE key = ? AND archived_at IS NULL AND active = 1')
        .get(key) as { id: number; key: string; client_id: number; name: string } | null
    if (!row) {
        throw new Error(`Project not found or archived: ${key}`)
    }
    return row
}

export function createClient(db: Database, key: string, name: string): void {
    const now = new Date().toISOString()
    db.query('INSERT INTO clients (key, name, active, created_at, updated_at) VALUES (?, ?, 1, ?, ?)').run(
        key,
        name,
        now,
        now,
    )
}

export function listClients(
    db: Database,
): Array<{ key: string; name: string; active: number; archived_at: string | null }> {
    return db.query('SELECT key, name, active, archived_at FROM clients ORDER BY key').all() as Array<{
        key: string
        name: string
        active: number
        archived_at: string | null
    }>
}

export function listActiveClients(db: Database): Array<{ key: string; name: string }> {
    return db
        .query('SELECT key, name FROM clients WHERE archived_at IS NULL AND active = 1 ORDER BY key')
        .all() as Array<{ key: string; name: string }>
}

export function editClient(db: Database, key: string, name: string): void {
    const now = new Date().toISOString()
    db.query('UPDATE clients SET name = ?, updated_at = ? WHERE key = ?').run(name, now, key)
}

export function archiveClient(db: Database, key: string): void {
    const now = new Date().toISOString()
    db.query('UPDATE clients SET archived_at = ?, active = 0, updated_at = ? WHERE key = ?').run(now, now, key)
}

export function createProject(db: Database, key: string, name: string, clientKey: string): void {
    const client = mustGetClient(db, clientKey)
    const now = new Date().toISOString()
    db.query(
        'INSERT INTO projects (key, client_id, name, active, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)',
    ).run(key, client.id, name, now, now)
}

export function listProjects(
    db: Database,
): Array<{ key: string; name: string; client_key: string; active: number; archived_at: string | null }> {
    return db
        .query(
            `SELECT p.key, p.name, c.key as client_key, p.active, p.archived_at
       FROM projects p
       JOIN clients c ON c.id = p.client_id
       ORDER BY c.key, p.key`,
        )
        .all() as Array<{ key: string; name: string; client_key: string; active: number; archived_at: string | null }>
}

export function listActiveProjects(
    db: Database,
    clientKey?: string,
): Array<{ key: string; name: string; client_key: string }> {
    const baseSql = `SELECT p.key, p.name, c.key as client_key\n       FROM projects p\n       JOIN clients c ON c.id = p.client_id\n       WHERE p.archived_at IS NULL AND p.active = 1`

    if (clientKey) {
        return db.query(`${baseSql} AND c.key = ? ORDER BY p.key`).all(clientKey) as Array<{
            key: string
            name: string
            client_key: string
        }>
    }

    return db.query(`${baseSql} ORDER BY c.key, p.key`).all() as Array<{
        key: string
        name: string
        client_key: string
    }>
}

export function editProject(db: Database, key: string, name: string): void {
    const now = new Date().toISOString()
    db.query('UPDATE projects SET name = ?, updated_at = ? WHERE key = ?').run(name, now, key)
}

export function archiveProject(db: Database, key: string): void {
    const now = new Date().toISOString()
    db.query('UPDATE projects SET archived_at = ?, active = 0, updated_at = ? WHERE key = ?').run(now, now, key)
}

function detectOverlap(
    db: Database,
    startAtUtc: string | null | undefined,
    endAtUtc: string | null | undefined,
    excludeEntryId?: number,
): boolean {
    if (!startAtUtc || !endAtUtc) {
        return false
    }

    if (excludeEntryId) {
        const row = db
            .query(
                `SELECT 1 as overlap
         FROM entries
         WHERE deleted_at IS NULL
           AND id != ?
           AND start_at_utc IS NOT NULL
           AND end_at_utc IS NOT NULL
           AND start_at_utc < ?
           AND end_at_utc > ?
         LIMIT 1`,
            )
            .get(excludeEntryId, endAtUtc, startAtUtc) as { overlap: number } | null
        return Boolean(row)
    }

    const row = db
        .query(
            `SELECT 1 as overlap
       FROM entries
       WHERE deleted_at IS NULL
         AND start_at_utc IS NOT NULL
         AND end_at_utc IS NOT NULL
         AND start_at_utc < ?
         AND end_at_utc > ?
       LIMIT 1`,
        )
        .get(endAtUtc, startAtUtc) as { overlap: number } | null
    return Boolean(row)
}

export function insertEntry(db: Database, input: EntryInput): { id: number; overlapWarning: boolean } {
    const client = mustGetClient(db, input.clientKey)
    const project = mustGetProject(db, input.projectKey)
    if (project.client_id !== client.id) {
        throw new Error(`Project ${project.key} does not belong to client ${client.key}`)
    }

    const overlapWarning = detectOverlap(db, input.startAtUtc, input.endAtUtc)
    const now = new Date().toISOString()

    const result = db
        .query(
            `INSERT INTO entries (
        entry_date, start_at_utc, end_at_utc, duration_minutes, calculated_duration_minutes, duration_override_minutes,
        status, note, client_id, project_id, overlap_warning, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
            input.entryDate,
            input.startAtUtc ?? null,
            input.endAtUtc ?? null,
            input.durationMinutes,
            input.durationMinutes,
            null,
            'completed',
            input.note,
            client.id,
            project.id,
            overlapWarning ? 1 : 0,
            now,
            now,
        )

    return { id: Number(result.lastInsertRowid), overlapWarning }
}

export function getEntryById(db: Database, id: number): EntryRow | null {
    return db
        .query(
            `SELECT e.id, e.entry_date, e.start_at_utc, e.end_at_utc, e.duration_minutes,
              e.calculated_duration_minutes, e.duration_override_minutes, e.status,
              e.note, e.overlap_warning, e.deleted_at,
              c.key as client_key, p.key as project_key, c.name as client_name, p.name as project_name
       FROM entries e
       JOIN clients c ON c.id = e.client_id
       JOIN projects p ON p.id = e.project_id
       WHERE e.id = ?`,
        )
        .get(id) as EntryRow | null
}

export function updateEntry(db: Database, id: number, input: EntryInput): { overlapWarning: boolean } {
    const client = mustGetClient(db, input.clientKey)
    const project = mustGetProject(db, input.projectKey)
    if (project.client_id !== client.id) {
        throw new Error(`Project ${project.key} does not belong to client ${client.key}`)
    }

    const overlapWarning = detectOverlap(db, input.startAtUtc, input.endAtUtc, id)
    const now = new Date().toISOString()

    db.query(
        `UPDATE entries
     SET entry_date = ?,
         start_at_utc = ?,
         end_at_utc = ?,
         duration_minutes = ?,
         calculated_duration_minutes = ?,
         duration_override_minutes = NULL,
         status = 'completed',
         note = ?,
         client_id = ?,
         project_id = ?,
         overlap_warning = ?,
         updated_at = ?
     WHERE id = ?`,
    ).run(
        input.entryDate,
        input.startAtUtc ?? null,
        input.endAtUtc ?? null,
        input.durationMinutes,
        input.durationMinutes,
        input.note,
        client.id,
        project.id,
        overlapWarning ? 1 : 0,
        now,
        id,
    )

    return { overlapWarning }
}

export type ActiveTrackingRow = {
    id: number
    entry_date: string
    start_at_utc: string
    note: string
    client_key: string
    project_key: string
    client_name: string
    project_name: string
}

export function getActiveTrackingEntry(db: Database): ActiveTrackingRow | null {
    return db
        .query(
            `SELECT e.id, e.entry_date, e.start_at_utc, e.note,
              c.key as client_key, p.key as project_key, c.name as client_name, p.name as project_name
       FROM entries e
       JOIN clients c ON c.id = e.client_id
       JOIN projects p ON p.id = e.project_id
       WHERE e.status = 'tracking' AND e.deleted_at IS NULL
       LIMIT 1`,
        )
        .get() as ActiveTrackingRow | null
}

export function startTrackingEntry(
    db: Database,
    input: { clientKey: string; projectKey: string; note: string; startAtUtc: string; entryDate: string },
): { id: number } {
    const client = mustGetClient(db, input.clientKey)
    const project = mustGetProject(db, input.projectKey)
    if (project.client_id !== client.id) {
        throw new Error(`Project ${project.key} does not belong to client ${client.key}`)
    }

    const now = new Date().toISOString()
    try {
        const result = db
            .query(
                `INSERT INTO entries (
          entry_date, start_at_utc, end_at_utc,
          duration_minutes, calculated_duration_minutes, duration_override_minutes,
          status, note, client_id, project_id, overlap_warning, created_at, updated_at
        ) VALUES (?, ?, NULL, 0, 0, NULL, 'tracking', ?, ?, ?, 0, ?, ?)`,
            )
            .run(input.entryDate, input.startAtUtc, input.note, client.id, project.id, now, now)

        return { id: Number(result.lastInsertRowid) }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (
            message.includes('idx_entries_single_tracking') ||
            message.includes('UNIQUE constraint failed: entries.status')
        ) {
            throw new Error('A tracking entry is already active. Stop it first with `stint track stop`.', {
                cause: error,
            })
        }
        throw error
    }
}

export function stopTrackingEntry(
    db: Database,
    input: {
        id: number
        endAtUtc: string
        note: string
        calculatedDurationMinutes: number
        durationOverrideMinutes?: number | null
    },
): { effectiveDurationMinutes: number } {
    const effective = input.durationOverrideMinutes ?? input.calculatedDurationMinutes
    db.query(
        `UPDATE entries
     SET end_at_utc = ?,
         note = ?,
         status = 'completed',
         calculated_duration_minutes = ?,
         duration_override_minutes = ?,
         duration_minutes = ?,
         updated_at = ?
     WHERE id = ?`,
    ).run(
        input.endAtUtc,
        input.note,
        input.calculatedDurationMinutes,
        input.durationOverrideMinutes ?? null,
        effective,
        new Date().toISOString(),
        input.id,
    )

    return { effectiveDurationMinutes: effective }
}

export function softDeleteEntry(db: Database, id: number): void {
    db.query('UPDATE entries SET deleted_at = ?, updated_at = ? WHERE id = ?').run(
        new Date().toISOString(),
        new Date().toISOString(),
        id,
    )
}

export function restoreEntry(db: Database, id: number): void {
    db.query('UPDATE entries SET deleted_at = NULL, updated_at = ? WHERE id = ?').run(new Date().toISOString(), id)
}

export function queryEntries(
    db: Database,
    filters: {
        last: number
        from?: string
        to?: string
        client?: string
        project?: string
        includeDeleted?: boolean
        onlyDeleted?: boolean
    },
): EntryRow[] {
    const conditions: string[] = []
    const params: Array<string | number> = []

    conditions.push("e.status = 'completed'")

    if (filters.onlyDeleted) {
        conditions.push('e.deleted_at IS NOT NULL')
    } else if (!filters.includeDeleted) {
        conditions.push('e.deleted_at IS NULL')
    }
    if (filters.from) {
        conditions.push('e.entry_date >= ?')
        params.push(filters.from)
    }
    if (filters.to) {
        conditions.push('e.entry_date <= ?')
        params.push(filters.to)
    }
    if (filters.client) {
        conditions.push('c.key = ?')
        params.push(filters.client)
    }
    if (filters.project) {
        conditions.push('p.key = ?')
        params.push(filters.project)
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

    // When a date bound is set, return every matching row in that window; --last only applies to open-ended "recent" queries.
    const capByLast = !filters.from && !filters.to
    const limitClause = capByLast ? '\n      LIMIT ?' : ''

    const sql = `
    SELECT * FROM (
      SELECT e.id, e.entry_date, e.start_at_utc, e.end_at_utc, e.duration_minutes,
             e.calculated_duration_minutes, e.duration_override_minutes, e.status,
             e.note, e.overlap_warning, e.deleted_at,
             c.key as client_key, p.key as project_key, c.name as client_name, p.name as project_name
      FROM entries e
      JOIN clients c ON c.id = e.client_id
      JOIN projects p ON p.id = e.project_id
      ${where}
      ORDER BY e.entry_date DESC, e.id DESC${limitClause}
    ) recent
    ORDER BY recent.entry_date ASC, recent.id ASC
  `

    return capByLast
        ? (db.query(sql).all(...params, filters.last) as EntryRow[])
        : (db.query(sql).all(...params) as EntryRow[])
}

export function setClientInvoiceProfile(
    db: Database,
    clientKey: string,
    profile: {
        hourlyRateCents?: number | null
        billingName?: string | null
        billingEmail?: string | null
        billingAddressLine1?: string | null
        billingAddressLine2?: string | null
        billingCity?: string | null
        billingState?: string | null
        billingPostalCode?: string | null
        billingCountry?: string | null
    },
): void {
    const now = new Date().toISOString()
    db.query(
        `UPDATE clients
     SET hourly_rate_cents = COALESCE(?, hourly_rate_cents),
         billing_name = COALESCE(?, billing_name),
         billing_email = COALESCE(?, billing_email),
         billing_address_line1 = COALESCE(?, billing_address_line1),
         billing_address_line2 = COALESCE(?, billing_address_line2),
         billing_city = COALESCE(?, billing_city),
         billing_state = COALESCE(?, billing_state),
         billing_postal_code = COALESCE(?, billing_postal_code),
         billing_country = COALESCE(?, billing_country),
         updated_at = ?
     WHERE key = ?`,
    ).run(
        profile.hourlyRateCents ?? null,
        profile.billingName ?? null,
        profile.billingEmail ?? null,
        profile.billingAddressLine1 ?? null,
        profile.billingAddressLine2 ?? null,
        profile.billingCity ?? null,
        profile.billingState ?? null,
        profile.billingPostalCode ?? null,
        profile.billingCountry ?? null,
        now,
        clientKey,
    )
    mustGetClient(db, clientKey)
}

export function backfillDraftInvoiceRatesForClient(db: Database, clientKey: string, hourlyRateCents: number): number {
    const client = mustGetClient(db, clientKey)
    const result = db
        .query(
            `UPDATE invoice_time_items
       SET hourly_rate_cents = ?,
           amount_cents = ROUND((duration_minutes * ?) / 60.0)
       WHERE hourly_rate_cents = 0
         AND invoice_id IN (
           SELECT id
           FROM invoices
           WHERE client_id = ?
             AND status = 'draft'
         )`,
        )
        .run(hourlyRateCents, hourlyRateCents, client.id)
    return Number(result.changes)
}

export function backfillZeroRatesForDraftInvoice(db: Database, invoiceId: number): number {
    const invoice = db
        .query(
            `SELECT i.id, i.status, c.hourly_rate_cents
       FROM invoices i
       JOIN clients c ON c.id = i.client_id
       WHERE i.id = ?`,
        )
        .get(invoiceId) as { id: number; status: 'draft' | 'generated'; hourly_rate_cents: number | null } | null
    if (!invoice) {
        throw new Error(`Invoice not found: ${invoiceId}`)
    }
    if (invoice.status !== 'draft') {
        return 0
    }
    const rate = invoice.hourly_rate_cents ?? 0
    if (rate <= 0) {
        return 0
    }
    const result = db
        .query(
            `UPDATE invoice_time_items
       SET hourly_rate_cents = ?,
           amount_cents = ROUND((duration_minutes * ?) / 60.0)
       WHERE invoice_id = ?
         AND hourly_rate_cents = 0`,
        )
        .run(rate, rate, invoiceId)
    return Number(result.changes)
}

export type InvoiceSummaryRow = {
    id: number
    invoice_number: string
    status: 'draft' | 'generated'
    issue_date: string
    from_date: string
    to_date: string
    client_key: string
    project_key: string | null
}

export function createInvoiceDraft(
    db: Database,
    input: {
        invoiceNumber: string
        issueDate: string
        fromDate: string
        toDate: string
        clientKey: string
        projectKey?: string
        notes?: string
    },
): { id: number } {
    const client = mustGetClient(db, input.clientKey)
    let projectId: number | null = null
    if (input.projectKey) {
        const project = mustGetProject(db, input.projectKey)
        if (project.client_id !== client.id) {
            throw new Error(`Project ${project.key} does not belong to client ${client.key}`)
        }
        projectId = project.id
    }

    const now = new Date().toISOString()
    const created = db
        .query(
            `INSERT INTO invoices (
        invoice_number, status, issue_date, from_date, to_date, notes, currency,
        client_id, project_id, generated_pdf_path, created_at, updated_at
      ) VALUES (?, 'draft', ?, ?, ?, ?, 'USD', ?, ?, NULL, ?, ?)`,
        )
        .run(
            input.invoiceNumber,
            input.issueDate,
            input.fromDate,
            input.toDate,
            input.notes ?? null,
            client.id,
            projectId,
            now,
            now,
        )

    return { id: Number(created.lastInsertRowid) }
}

export function attachInvoiceTimeItemsFromFilters(db: Database, invoiceId: number): number {
    const invoice = db
        .query(
            `SELECT i.id, i.from_date, i.to_date, i.client_id, i.project_id
       FROM invoices i
       WHERE i.id = ?`,
        )
        .get(invoiceId) as {
        id: number
        from_date: string
        to_date: string
        client_id: number
        project_id: number | null
    } | null
    if (!invoice) {
        throw new Error(`Invoice not found: ${invoiceId}`)
    }

    const rows = db
        .query(
            `SELECT e.id, e.entry_date, e.note, e.duration_minutes, c.hourly_rate_cents
       FROM entries e
       JOIN clients c ON c.id = e.client_id
       WHERE e.status = 'completed'
         AND e.deleted_at IS NULL
         AND e.entry_date >= ?
         AND e.entry_date <= ?
         AND e.client_id = ?
         AND (? IS NULL OR e.project_id = ?)`,
        )
        .all(invoice.from_date, invoice.to_date, invoice.client_id, invoice.project_id, invoice.project_id) as Array<{
        id: number
        entry_date: string
        note: string
        duration_minutes: number
        hourly_rate_cents: number | null
    }>

    const now = new Date().toISOString()
    let inserted = 0
    for (const row of rows) {
        const rate = row.hourly_rate_cents ?? 0
        const amount = Math.round((row.duration_minutes * rate) / 60)
        const result = db
            .query(
                `INSERT OR IGNORE INTO invoice_time_items (
          invoice_id, entry_id, entry_date, note, duration_minutes, hourly_rate_cents, amount_cents, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(invoiceId, row.id, row.entry_date, row.note, row.duration_minutes, rate, amount, now)
        if (Number(result.changes) > 0) {
            inserted += 1
        }
    }
    return inserted
}

export function listInvoices(
    db: Database,
    filters?: { client?: string; status?: 'draft' | 'generated' },
): InvoiceSummaryRow[] {
    const where: string[] = []
    const params: Array<string> = []
    if (filters?.client) {
        where.push('c.key = ?')
        params.push(filters.client)
    }
    if (filters?.status) {
        where.push('i.status = ?')
        params.push(filters.status)
    }
    return db
        .query(
            `SELECT i.id, i.invoice_number, i.status, i.issue_date, i.from_date, i.to_date, c.key as client_key, p.key as project_key
       FROM invoices i
       JOIN clients c ON c.id = i.client_id
       LEFT JOIN projects p ON p.id = i.project_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY i.id DESC`,
        )
        .all(...params) as InvoiceSummaryRow[]
}

export function resolveInvoiceId(db: Database, token: string): number {
    const trimmed = token.trim()
    if (trimmed.startsWith('@')) {
        const invoiceNumber = trimmed.slice(1).trim()
        if (!invoiceNumber) {
            throw new Error('Invoice number token cannot be empty. Use format like @1000')
        }
        const byNumber = db.query('SELECT id FROM invoices WHERE invoice_number = ?').get(invoiceNumber) as {
            id: number
        } | null
        if (byNumber) {
            return byNumber.id
        }
        throw new Error(`Invoice not found: ${token}`)
    }
    if (/^\d+$/.test(trimmed)) {
        const byId = db.query('SELECT id FROM invoices WHERE id = ?').get(Number(trimmed)) as { id: number } | null
        if (byId) {
            return byId.id
        }
        throw new Error(`Invoice id not found: ${token}. To reference invoice number, use @${token}`)
    }
    throw new Error(
        `Invalid invoice token: ${token}. Use numeric id (e.g. 1) or invoice number with @ prefix (e.g. @1000).`,
    )
}

export function addInvoiceEntryById(db: Database, invoiceId: number, entryId: number): void {
    const entry = db
        .query(
            `SELECT e.id, e.entry_date, e.note, e.duration_minutes, c.hourly_rate_cents
       FROM entries e
       JOIN clients c ON c.id = e.client_id
       JOIN invoices i ON i.id = ?
       WHERE e.id = ?
         AND e.status = 'completed'
         AND e.deleted_at IS NULL
         AND e.client_id = i.client_id`,
        )
        .get(invoiceId, entryId) as {
        id: number
        entry_date: string
        note: string
        duration_minutes: number
        hourly_rate_cents: number | null
    } | null
    if (!entry) {
        throw new Error(`Entry ${entryId} is not valid for invoice ${invoiceId}`)
    }
    const rate = entry.hourly_rate_cents ?? 0
    const amount = Math.round((entry.duration_minutes * rate) / 60)
    db.query(
        `INSERT OR IGNORE INTO invoice_time_items (
      invoice_id, entry_id, entry_date, note, duration_minutes, hourly_rate_cents, amount_cents, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
        invoiceId,
        entry.id,
        entry.entry_date,
        entry.note,
        entry.duration_minutes,
        rate,
        amount,
        new Date().toISOString(),
    )
}

export function removeInvoiceEntryById(db: Database, invoiceId: number, entryId: number): void {
    db.query('DELETE FROM invoice_time_items WHERE invoice_id = ? AND entry_id = ?').run(invoiceId, entryId)
}

export function addInvoiceExpense(
    db: Database,
    input: { invoiceId: number; expenseDate: string; description: string; amountCents: number },
): { id: number } {
    const row = db
        .query('SELECT COALESCE(MAX(sort_order), 0) + 1 as next_order FROM invoice_expenses WHERE invoice_id = ?')
        .get(input.invoiceId) as { next_order: number }
    const now = new Date().toISOString()
    const result = db
        .query(
            `INSERT INTO invoice_expenses (
        invoice_id, expense_date, description, amount_cents, sort_order, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(input.invoiceId, input.expenseDate, input.description, input.amountCents, row.next_order, now, now)
    return { id: Number(result.lastInsertRowid) }
}

export function removeInvoiceExpense(db: Database, invoiceId: number, expenseId: number): void {
    db.query('DELETE FROM invoice_expenses WHERE invoice_id = ? AND id = ?').run(invoiceId, expenseId)
}

export function getInvoiceSnapshot(
    db: Database,
    invoiceId: number,
): {
    invoice: {
        id: number
        invoice_number: string
        status: 'draft' | 'generated'
        issue_date: string
        from_date: string
        to_date: string
        currency: string
        notes: string | null
        client_key: string
        client_name: string
        project_key: string | null
        project_name: string | null
        billing_name: string | null
        billing_email: string | null
        billing_address_line1: string | null
        billing_address_line2: string | null
        billing_city: string | null
        billing_state: string | null
        billing_postal_code: string | null
        billing_country: string | null
    }
    timeItems: Array<{
        entry_id: number
        entry_date: string
        project_name: string
        note: string
        duration_minutes: number
        hourly_rate_cents: number
        amount_cents: number
    }>
    expenses: Array<{ id: number; expense_date: string; description: string; amount_cents: number }>
    duplicateEntries: Array<{ entry_id: number; invoice_id: number; invoice_number: string }>
} {
    const invoice = db
        .query(
            `SELECT i.id, i.invoice_number, i.status, i.issue_date, i.from_date, i.to_date, i.currency, i.notes,
              c.key as client_key, c.name as client_name,
              p.key as project_key, p.name as project_name,
              c.billing_name, c.billing_email, c.billing_address_line1, c.billing_address_line2,
              c.billing_city, c.billing_state, c.billing_postal_code, c.billing_country
       FROM invoices i
       JOIN clients c ON c.id = i.client_id
       LEFT JOIN projects p ON p.id = i.project_id
       WHERE i.id = ?`,
        )
        .get(invoiceId) as any
    if (!invoice) {
        throw new Error(`Invoice not found: ${invoiceId}`)
    }

    const timeItems =
        invoice.status === 'draft'
            ? (db
                  .query(
                      `SELECT iti.entry_id,
                              COALESCE(e.entry_date, iti.entry_date) as entry_date,
                              COALESCE(p.name, ip.name, '') as project_name,
                              COALESCE(e.note, iti.note) as note,
                              COALESCE(e.duration_minutes, iti.duration_minutes) as duration_minutes,
                              COALESCE(c.hourly_rate_cents, 0) as hourly_rate_cents,
                              ROUND((COALESCE(e.duration_minutes, iti.duration_minutes) * COALESCE(c.hourly_rate_cents, 0)) / 60.0) as amount_cents
                       FROM invoice_time_items iti
                       LEFT JOIN entries e ON e.id = iti.entry_id
                       JOIN invoices i ON i.id = iti.invoice_id
                       LEFT JOIN projects p ON p.id = e.project_id
                       LEFT JOIN projects ip ON ip.id = i.project_id
                       JOIN clients c ON c.id = i.client_id
                       WHERE iti.invoice_id = ?
                       ORDER BY COALESCE(e.entry_date, iti.entry_date) ASC, iti.entry_id ASC`,
                  )
                  .all(invoiceId) as Array<{
                  entry_id: number
                  entry_date: string
                  project_name: string
                  note: string
                  duration_minutes: number
                  hourly_rate_cents: number
                  amount_cents: number
              }>)
            : (db
                  .query(
                      `SELECT iti.entry_id,
                              iti.entry_date,
                              COALESCE(p.name, ip.name, '') as project_name,
                              iti.note,
                              iti.duration_minutes,
                              iti.hourly_rate_cents,
                              iti.amount_cents
                       FROM invoice_time_items iti
                       JOIN invoices i ON i.id = iti.invoice_id
                       LEFT JOIN entries e ON e.id = iti.entry_id
                       LEFT JOIN projects p ON p.id = e.project_id
                       LEFT JOIN projects ip ON ip.id = i.project_id
                       WHERE iti.invoice_id = ?
                       ORDER BY iti.entry_date ASC, iti.entry_id ASC`,
                  )
                  .all(invoiceId) as Array<{
                  entry_id: number
                  entry_date: string
                  project_name: string
                  note: string
                  duration_minutes: number
                  hourly_rate_cents: number
                  amount_cents: number
              }>)

    const expenses = db
        .query(
            `SELECT id, expense_date, description, amount_cents
       FROM invoice_expenses
       WHERE invoice_id = ?
       ORDER BY sort_order ASC, id ASC`,
        )
        .all(invoiceId) as Array<{ id: number; expense_date: string; description: string; amount_cents: number }>

    const duplicateEntries = db
        .query(
            `SELECT DISTINCT iti.entry_id, oi.id as invoice_id, oi.invoice_number
       FROM invoice_time_items iti
       JOIN invoice_time_items other_iti
         ON other_iti.entry_id = iti.entry_id
        AND other_iti.invoice_id != iti.invoice_id
       JOIN invoices oi ON oi.id = other_iti.invoice_id
       WHERE iti.invoice_id = ?
       ORDER BY iti.entry_id ASC, oi.id ASC`,
        )
        .all(invoiceId) as Array<{ entry_id: number; invoice_id: number; invoice_number: string }>

    return { invoice, timeItems, expenses, duplicateEntries }
}

export function markInvoiceGenerated(db: Database, invoiceId: number, pdfPath: string): void {
    db.query(`UPDATE invoices SET status = 'generated', generated_pdf_path = ?, updated_at = ? WHERE id = ?`).run(
        pdfPath,
        new Date().toISOString(),
        invoiceId,
    )
}
