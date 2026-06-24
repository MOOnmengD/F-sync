import { dayKeyFromIso, pad2 } from './dateUtils'

export type FinanceDashboardRow = {
  id: string
  created_at: string
  amount: number | string | null
  item_name_snapshot: string | null
  necessity: boolean | null
}

export type FinanceQuickSourceRow = FinanceDashboardRow & {
  item_id: string | null
  brand_snapshot: string | null
  review: string | null
  details: string | null
  finance_category: string | null
  repurchase_index: number | null
  ai_metadata: Record<string, unknown> | null
}

export type FinanceSummary = {
  necessary: number
  total: number
  nonNecessary: number
}

export type FinanceCalendarDay = {
  day: number | null
  dayKey: string | null
  amount: number | null
  colorLevel: 0 | 1 | 2 | 3 | 4
  isFuture: boolean
}

export type FinanceDayRecord = {
  id: string
  createdAt: string
  itemName: string
  amount: number | null
}

export type FinanceQuickRecord = {
  key: string
  displayKey: string
  itemName: string
  amountCents: number
  review: string | null
  count: number
  monthlyAverage: number
  latestAt: string
  template: FinanceQuickSourceRow
}

export function toFiniteAmount(value: number | string | null | undefined): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string' || !value.trim()) return null
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function getLocalDayKey(date = new Date()) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

export function getLocalMonthKey(date = new Date()) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`
}

export function parseDayKey(dayKey: string) {
  const [year, month, day] = dayKey.split('-').map((part) => Number(part))
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return null
  }
  return { year, month, day }
}

export function dayKeyToNoonIso(dayKey: string) {
  const parsed = parseDayKey(dayKey)
  if (!parsed) return null
  return new Date(parsed.year, parsed.month - 1, parsed.day, 12, 0, 0, 0).toISOString()
}

export function datePartsToDayKey(date: { year: number; month: number; day: number }) {
  return `${date.year}-${pad2(date.month)}-${pad2(date.day)}`
}

export function formatFinanceMonthLabel(dayKey: string) {
  const parsed = parseDayKey(dayKey)
  if (!parsed) return ''
  return `${parsed.year}年${parsed.month}月`
}

export function formatSelectedFinanceDate(dayKey: string) {
  const parsed = parseDayKey(dayKey)
  if (!parsed) return dayKey
  return `${parsed.month}月${parsed.day}日`
}

export function formatCalendarAmount(amount: number | null) {
  if (amount === null || !Number.isFinite(amount)) return ''
  const absolute = Math.abs(amount)
  if (absolute >= 10000) {
    const compact = new Intl.NumberFormat('zh-CN', {
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(amount)
    return compact
  }
  return amount.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')
}

function validRowsThroughToday(rows: FinanceDashboardRow[], todayKey: string) {
  return rows.filter((row) => {
    if (!row.created_at) return false
    return dayKeyFromIso(row.created_at) <= todayKey
  })
}

export function buildFinanceSummary(
  rows: FinanceDashboardRow[],
  todayKey: string,
): FinanceSummary {
  let necessary = 0
  let nonNecessary = 0

  for (const row of validRowsThroughToday(rows, todayKey)) {
    const amount = toFiniteAmount(row.amount)
    if (amount === null) continue
    if (row.necessity === true) necessary += amount
    else nonNecessary += amount
  }

  return {
    necessary,
    nonNecessary,
    total: necessary + nonNecessary,
  }
}

export function buildFinanceCalendar(
  rows: FinanceDashboardRow[],
  todayKey: string,
): FinanceCalendarDay[] {
  const today = parseDayKey(todayKey)
  if (!today) return []

  const daysInMonth = new Date(today.year, today.month, 0).getDate()
  const firstDay = new Date(today.year, today.month - 1, 1, 12, 0, 0, 0)
  const mondayOffset = (firstDay.getDay() + 6) % 7
  const totals = new Map<string, { amount: number; hasAmount: boolean }>()

  for (const row of validRowsThroughToday(rows, todayKey)) {
    const dayKey = dayKeyFromIso(row.created_at)
    if (!dayKey.startsWith(`${today.year}-${pad2(today.month)}-`)) continue
    const amount = toFiniteAmount(row.amount)
    const aggregate = totals.get(dayKey) ?? { amount: 0, hasAmount: false }
    if (amount !== null) {
      aggregate.amount += amount
      aggregate.hasAmount = true
    }
    totals.set(dayKey, aggregate)
  }

  const dailyAmounts = Array.from(totals.values())
    .filter((entry) => entry.hasAmount)
    .map((entry) => entry.amount)
  const min = dailyAmounts.length > 0 ? Math.min(...dailyAmounts) : 0
  const max = dailyAmounts.length > 0 ? Math.max(...dailyAmounts) : 0
  const useMiddleLevel = dailyAmounts.length < 2 || min === max

  const cells: FinanceCalendarDay[] = Array.from({ length: mondayOffset }, () => ({
    day: null,
    dayKey: null,
    amount: null,
    colorLevel: 0,
    isFuture: false,
  }))

  for (let day = 1; day <= daysInMonth; day += 1) {
    const dayKey = `${today.year}-${pad2(today.month)}-${pad2(day)}`
    const isFuture = dayKey > todayKey
    const aggregate = totals.get(dayKey)
    const amount = !isFuture && aggregate?.hasAmount ? aggregate.amount : null
    let colorLevel: 0 | 1 | 2 | 3 | 4 = 0

    if (amount !== null) {
      if (useMiddleLevel) {
        colorLevel = 2
      } else {
        const ratio = (amount - min) / (max - min)
        colorLevel = Math.min(4, Math.floor(ratio * 4) + 1) as 1 | 2 | 3 | 4
      }
    }

    cells.push({ day, dayKey, amount, colorLevel, isFuture })
  }

  return cells
}

export function buildSelectedDayRecords(
  rows: FinanceDashboardRow[],
  selectedDayKey: string,
): FinanceDayRecord[] {
  return rows
    .filter((row) => row.created_at && dayKeyFromIso(row.created_at) === selectedDayKey)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      itemName: row.item_name_snapshot?.trim() || '（无名称）',
      amount: toFiniteAmount(row.amount),
    }))
}

function inclusiveMonthCount(firstIso: string, now: Date) {
  const first = new Date(firstIso)
  if (!Number.isFinite(first.getTime())) return Number.POSITIVE_INFINITY
  return (
    (now.getFullYear() - first.getFullYear()) * 12 +
    (now.getMonth() - first.getMonth()) +
    1
  )
}

export function buildFinanceQuickRecords(
  rows: FinanceQuickSourceRow[],
  now = new Date(),
): FinanceQuickRecord[] {
  const todayKey = getLocalDayKey(now)
  const groups = new Map<
    string,
    {
      itemName: string
      amountCents: number
      review: string | null
      count: number
      firstAt: string
      latestAt: string
      template: FinanceQuickSourceRow
    }
  >()

  for (const row of rows) {
    if (!row.created_at || dayKeyFromIso(row.created_at) > todayKey) continue
    const itemName = row.item_name_snapshot?.trim()
    const amount = toFiniteAmount(row.amount)
    if (!itemName || amount === null || amount <= 0) continue
    const amountCents = Math.round(amount * 100)
    const normalizedReview = row.review?.trim() || null
    const key = JSON.stringify([itemName, amountCents, normalizedReview ?? ''])
    const current = groups.get(key)

    if (!current) {
      groups.set(key, {
        itemName,
        amountCents,
        review: normalizedReview,
        count: 1,
        firstAt: row.created_at,
        latestAt: row.created_at,
        template: row,
      })
      continue
    }

    current.count += 1
    if (Date.parse(row.created_at) < Date.parse(current.firstAt)) current.firstAt = row.created_at
    if (Date.parse(row.created_at) > Date.parse(current.latestAt)) {
      current.latestAt = row.created_at
      current.template = row
    }
  }

  const eligible = Array.from(groups.entries()).flatMap(([key, group]): FinanceQuickRecord[] => {
    const monthCount = inclusiveMonthCount(group.firstAt, now)
    const monthlyAverage = group.count / monthCount
    if (group.count < 3 || monthlyAverage < 1) return []
    return [{
      key,
      displayKey: JSON.stringify([group.itemName, group.amountCents]),
      itemName: group.itemName,
      amountCents: group.amountCents,
      review: group.review,
      count: group.count,
      monthlyAverage,
      latestAt: group.latestAt,
      template: group.template,
    }]
  })

  eligible.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count
    return Date.parse(b.latestAt) - Date.parse(a.latestAt)
  })

  const seenDisplayKeys = new Set<string>()
  const result: FinanceQuickRecord[] = []
  for (const record of eligible) {
    if (seenDisplayKeys.has(record.displayKey)) continue
    seenDisplayKeys.add(record.displayKey)
    result.push(record)
    if (result.length === 3) break
  }
  return result
}
