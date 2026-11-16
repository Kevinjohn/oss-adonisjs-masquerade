import { DateTime } from 'luxon'

export interface AuditHistoryFilters {
  from?: string
  to?: string
  page: number
}

/** Validate the host history route's untrusted query values and normalize ISO instants to UTC. */
export function parseAuditHistoryFilters(input: {
  from?: unknown
  to?: unknown
  page?: unknown
}): AuditHistoryFilters | null {
  const from = parseIsoDate(input.from)
  const to = parseIsoDate(input.to)
  const page = parsePage(input.page)
  if (from === false || to === false || page === null) return null
  return { from, to, page }
}

function parseIsoDate(value: unknown): string | undefined | false {
  if (value === undefined) return undefined
  if (typeof value !== 'string') return false

  const date = DateTime.fromISO(value, { setZone: true })
  return date.isValid ? (date.toUTC().toISO() ?? false) : false
}

function parsePage(value: unknown): number | null {
  if (value === undefined) return 1
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return null

  const page = Number(value)
  return Number.isSafeInteger(page) ? page : null
}
