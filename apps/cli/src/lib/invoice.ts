import { writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { DateTime } from 'luxon'
import { printTable } from './table'

export type InvoicePreviewView = {
    invoice: {
        id: number
        invoiceNumber: string
        status: 'draft' | 'generated'
        issueDate: string
        fromDate: string
        toDate: string
        currency: string
        clientKey: string
        clientName: string
        projectKey: string | null
        projectName: string | null
        notes: string | null
    }
    contractor: Record<string, string | undefined>
    clientBilling: Record<string, string | undefined>
    timeItems: Array<{
        entryId: number
        entryDate: string
        projectName: string
        note: string
        durationMinutes: number
        hourlyRateCents: number
        amountCents: number
    }>
    expenses: Array<{
        id: number
        expenseDate: string
        description: string
        amountCents: number
    }>
    totals: {
        timeSubtotalCents: number
        expenseSubtotalCents: number
        grandTotalCents: number
        totalHours: number
    }
    warnings: string[]
    paymentInfoPresent: boolean
}

export function formatUsd(cents: number): string {
    const sign = cents < 0 ? '-' : ''
    const abs = Math.abs(cents)
    return `${sign}$${(abs / 100).toFixed(2)}`
}

export function formatHours(minutes: number): string {
    return (minutes / 60).toFixed(2)
}

export function formatUsDate(isoDate: string): string {
    const dt = DateTime.fromISO(isoDate)
    return dt.isValid ? dt.toFormat('MM/dd/yyyy') : isoDate
}

export function parseMoneyToCents(input: string): number {
    const normalized = input.trim().replace(/[$,]/g, '')
    if (!normalized) {
        throw new Error('Amount cannot be empty')
    }
    if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) {
        throw new Error(`Invalid money amount: ${input}`)
    }
    const value = Math.round(Number(normalized) * 100)
    if (!Number.isFinite(value)) {
        throw new Error(`Invalid money amount: ${input}`)
    }
    if (value <= 0) {
        throw new Error('Amount must be greater than 0')
    }
    return value
}

function compactAddress(source: Record<string, string | undefined>, prefix: string): string[] {
    const line1 = source[`${prefix}Line1`]
    const line2 = source[`${prefix}Line2`]
    const city = source[`${prefix}City`]
    const state = source[`${prefix}State`]
    const postalCode = source[`${prefix}PostalCode`]
    const country = source[`${prefix}Country`]
    const cityLine = [city, state, postalCode].filter(Boolean).join(', ')
    return [line1, line2, cityLine || undefined, country].filter(Boolean) as string[]
}

export function printInvoicePreview(view: InvoicePreviewView): void {
    console.log(`INVOICE # ${view.invoice.invoiceNumber}`)
    console.log(`Issue Date: ${formatUsDate(view.invoice.issueDate)}`)
    console.log(`Period: ${formatUsDate(view.invoice.fromDate)} - ${formatUsDate(view.invoice.toDate)}`)
    if (view.invoice.notes) {
        console.log(`Notes: ${view.invoice.notes}`)
    }

    console.log('\nContractor:')
    for (const line of [
        view.contractor.name,
        view.contractor.company,
        ...compactAddress(view.contractor, 'address'),
        view.contractor.email,
        view.contractor.phone,
    ]) {
        if (line) {
            console.log(`  ${line}`)
        }
    }

    console.log('\nBill To:')
    for (const line of [
        view.clientBilling.name ?? view.invoice.clientName,
        ...compactAddress(view.clientBilling, 'address'),
        view.clientBilling.email,
    ]) {
        if (line) {
            console.log(`  ${line}`)
        }
    }

    console.log('\nTime Entries')
    printTable(
        ['Date', 'Project', 'Description', 'Hours', 'Rate', 'Amount'],
        view.timeItems.map(item => [
            formatUsDate(item.entryDate),
            item.projectName,
            item.note,
            formatHours(item.durationMinutes),
            formatUsd(item.hourlyRateCents),
            formatUsd(item.amountCents),
        ]),
        { colAligns: ['left', 'left', 'left', 'right', 'right', 'right'] },
    )

    if (view.expenses.length > 0) {
        console.log('\nBillable Expenses')
        printTable(
            ['Description', 'Amount'],
            view.expenses.map(expense => [expense.description, formatUsd(expense.amountCents)]),
            { colAligns: ['left', 'right'] },
        )
    }

    console.log('\nTotals')
    printTable(
        ['Label', 'Amount'],
        [
            ['Total Hours', view.totals.totalHours.toFixed(2)],
            ['Labor Subtotal', formatUsd(view.totals.timeSubtotalCents)],
            ['Expenses Subtotal', formatUsd(view.totals.expenseSubtotalCents)],
            ['Total Due', formatUsd(view.totals.grandTotalCents)],
        ],
        { colAligns: ['left', 'right'] },
    )

    if (view.warnings.length > 0) {
        console.log('\nWarnings')
        for (const warning of view.warnings) {
            console.log(`  - ${warning}`)
        }
    }
}

function escTypst(input: string): string {
    return input.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('$', '\\$').replaceAll('@', '\\@')
}

function joinNonEmpty(lines: Array<string | undefined | null>): string[] {
    return lines.filter(Boolean).map(line => String(line))
}

function typstSectionBlock(sections: string[][]): string {
    const nonEmptySections = sections.map(section => section.filter(Boolean)).filter(section => section.length > 0)
    if (nonEmptySections.length === 0) {
        return ''
    }
    return nonEmptySections.map(section => section.map(line => `${escTypst(line)} \\`).join('\n')).join('\n\n')
}

export function writeTypstInvoice(view: InvoicePreviewView, outDir: string): { typPath: string; pdfPath: string } {
    const fileBase = `invoice-${view.invoice.invoiceNumber}`
    const typPath = resolve(outDir, `${fileBase}.typ`)
    const pdfPath = resolve(outDir, `${fileBase}.pdf`)
    const contractorIdentity = joinNonEmpty([view.contractor.name, view.contractor.company])
    const contractorAddress = compactAddress(view.contractor, 'address')
    const contractorContact = joinNonEmpty([view.contractor.email, view.contractor.phone])
    const contractorBlock = typstSectionBlock([contractorIdentity, contractorAddress, contractorContact])

    const billToIdentity = joinNonEmpty([view.clientBilling.name ?? view.invoice.clientName])
    const billToAddress = compactAddress(view.clientBilling, 'address')
    const billToContact = joinNonEmpty([view.clientBilling.email])
    const billToBlock = typstSectionBlock([billToIdentity, billToAddress, billToContact])

    const contractorLines = joinNonEmpty([
        ...contractorIdentity,
        ...contractorAddress,
        view.contractor.email,
        view.contractor.phone,
    ])
    const billToLines = joinNonEmpty([
        view.clientBilling.name ?? view.invoice.clientName,
        ...compactAddress(view.clientBilling, 'address'),
        view.clientBilling.email,
    ])

    const timeRows = view.timeItems
        .map(
            item =>
                `  [${escTypst(formatUsDate(item.entryDate))}], [${escTypst(item.projectName)}], [${escTypst(item.note)}], [${formatHours(item.durationMinutes)}], [${escTypst(
                    formatUsd(item.hourlyRateCents),
                )}], [${escTypst(formatUsd(item.amountCents))}],`,
        )
        .join('\n')

    const expenseSection =
        view.expenses.length === 0
            ? ''
            : `
= Billable Expenses

#table(
  columns: (1fr, auto),
  table.header([Description], [Amount]),
${view.expenses
    .map(expense => `  [${escTypst(expense.description)}], [${escTypst(formatUsd(expense.amountCents))}],`)
    .join('\n')}
)
`

    const typ = `#set page(margin: 1in)
#set text(font: ("Arial", "Liberation Sans", "Noto Sans"), size: 10pt)

#grid(
  columns: (1fr, auto),
  [],
  [
    *Invoice No.* ${escTypst(view.invoice.invoiceNumber)} \\
    *Issue Date:* ${escTypst(formatUsDate(view.invoice.issueDate))} \\
    *Period:* ${escTypst(formatUsDate(view.invoice.fromDate))} - ${escTypst(formatUsDate(view.invoice.toDate))}
  ],
)

#v(10pt)
#grid(
  columns: (1fr, 1fr),
  gutter: 24pt,
  [
    #box(
      width: 100%,
      inset: 10pt,
      stroke: (left: 1pt + black),
      [
        *From*

        ${contractorBlock}
      ],
    )
  ],
  [
    #box(
      width: 100%,
      inset: 10pt,
      stroke: (left: 1pt + black),
      [
        *Bill To*

        ${billToBlock}
      ],
    )
  ],
)

#v(10pt)
#set text(size: 8pt)
#table(
  columns: (auto, auto, 1fr, auto, auto, auto),
  table.header([Date], [Project], [Description], [Hours], [Rate], [Amount]),
${timeRows}
)
${expenseSection}
#set text(size: 10pt)

#set text(size: 8pt)
#align(right, table(
  columns: (auto, auto),
  [Total Hours], [${escTypst(view.totals.totalHours.toFixed(2))}],
  [Labor Subtotal], [${escTypst(formatUsd(view.totals.timeSubtotalCents))}],
  [Expenses Subtotal], [${escTypst(formatUsd(view.totals.expenseSubtotalCents))}],
  [*Total Due*], [*${escTypst(formatUsd(view.totals.grandTotalCents))}*],
))
#set text(size: 10pt)
`
    writeFileSync(typPath, typ, 'utf8')
    return { typPath, pdfPath }
}

export function defaultInvoiceOutputDir(): string {
    return join(homedir(), 'Downloads')
}

export function todayIso(): string {
    return DateTime.local().toISODate() as string
}
