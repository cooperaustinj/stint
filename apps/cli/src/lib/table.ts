import Table from 'cli-table3'

export function printTable(
  headers: string[],
  rows: string[][],
  options?: {
    colAligns?: Array<'left' | 'right' | 'center'>
  },
): void {
  if (headers.length === 0) {
    return
  }

  const terminalWidth = Math.max(process.stdout.columns ?? 120, 60)
  const separatorWidth = 3 * Math.max(headers.length - 1, 0)
  const minWidths = headers.map(header => Math.max(4, Math.min(header.length, 16)))
  const maxWidths = headers.map((_, idx) => (idx === headers.length - 1 ? 80 : 24))
  const naturalWidths = headers.map((header, idx) => {
    const cellMax = Math.max(...rows.map(row => (row[idx] ?? '').length), 0)
    return Math.max(header.length, cellMax)
  })

  const nonLastNatural = naturalWidths.slice(0, -1).map((value, idx) => Math.min(value, maxWidths[idx] ?? 24))
  const nonLastWidthTotal = nonLastNatural.reduce((sum, value) => sum + value, 0)
  const minLast = minWidths[minWidths.length - 1] ?? 10
  const maxLast = maxWidths[maxWidths.length - 1] ?? 80
  const lastNatural = naturalWidths[naturalWidths.length - 1] ?? minLast
  const lastAvailable = Math.max(minLast, terminalWidth - separatorWidth - nonLastWidthTotal)
  const lastWidth = Math.max(minLast, Math.min(lastNatural, maxLast, lastAvailable))
  const colWidths = [...nonLastNatural, lastWidth]

  const table = new Table({
    head: headers,
    colWidths,
    ...(options?.colAligns ? { colAligns: options.colAligns } : {}),
    wordWrap: true,
    style: {
      'padding-left': 0,
      'padding-right': 0,
      head: [],
      border: [],
    },
  })

  for (const row of rows) {
    table.push(row.map(cell => cell ?? ''))
  }

  console.log(table.toString())
}
