export type MonthKey = `${number}-${string}`

export function pad2(n: number) {
  return String(n).padStart(2, '0')
}

export function formatDurationHm(ms: number) {
  const totalMin = Math.max(0, Math.floor(ms / 60000))
  const hh = Math.floor(totalMin / 60)
  const mm = totalMin % 60
  return `${pad2(hh)}:${pad2(mm)}`
}

export function toMonthKey(year: number, month: number): MonthKey {
  return `${year}-${pad2(month)}`
}

export function parseMonthKey(key: MonthKey) {
  const [y, m] = key.split('-')
  return { year: Number(y), month: Number(m) }
}

export function monthRangeIso(key: MonthKey) {
  const { year, month } = parseMonthKey(key)
  const start = new Date(year, month - 1, 1, 0, 0, 0, 0)
  const end = new Date(year, month, 1, 0, 0, 0, 0)
  return { startIso: start.toISOString(), endIso: end.toISOString() }
}

export function formatMonthLabel(key: MonthKey) {
  const { year, month } = parseMonthKey(key)
  return `${year}年${month}月`
}

export function dayKeyFromIso(iso: string) {
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

export function formatDayLabel(dayKey: string) {
  const [y, m, d] = dayKey.split('-').map((v) => Number(v))
  const date = new Date(y, m - 1, d, 12, 0, 0, 0)
  return new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' }).format(date)
}

export function formatCompactDateTime(iso: string) {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return iso
  const d = new Date(t)
  const now = new Date()
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  const time = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(d)
  if (sameDay) return time
  const date = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(d)
  return `${date} ${time}`
}

export function formatDurationHms(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000))
  const hh = Math.floor(totalSec / 3600)
  const mm = Math.floor((totalSec % 3600) / 60)
  const ss = totalSec % 60
  return `${pad2(hh)}:${pad2(mm)}:${pad2(ss)}`
}

export function formatDurationLabel(ms: number): string {
  const totalMin = Math.max(0, Math.floor(ms / 60000))
  const hh = Math.floor(totalMin / 60)
  const mm = totalMin % 60
  if (hh === 0) return `${mm}min`
  if (mm === 0) return `${hh}h`
  return `${hh}h${mm}min`
}

export function getMondayOfWeek(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  d.setHours(0, 0, 0, 0)
  return d
}

export function extractDate(
  source: string,
  now: Date,
): { date: { year: number; month: number; day: number } | null; rest: string } {
  const s = source

  if (/(^|\s)昨天(\s|$)/.test(s)) {
    const d = new Date(now)
    d.setDate(d.getDate() - 1)
    return {
      date: { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() },
      rest: s.replace(/(^|\s)昨天(\s|$)/g, ' ').trim(),
    }
  }

  if (/(^|\s)今天(\s|$)/.test(s)) {
    return {
      date: { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() },
      rest: s.replace(/(^|\s)今天(\s|$)/g, ' ').trim(),
    }
  }

  const ymd = s.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/)
  if (ymd) {
    const year = Number(ymd[1])
    const month = Number(ymd[2])
    const day = Number(ymd[3])
    return {
      date: { year, month, day },
      rest: s.replace(ymd[0], ' ').trim(),
    }
  }

  const md = s.match(/(\d{1,2})月(\d{1,2})日/)
  if (md) {
    const year = now.getFullYear()
    const month = Number(md[1])
    const day = Number(md[2])
    return {
      date: { year, month, day },
      rest: s.replace(md[0], ' ').trim(),
    }
  }

  return { date: null, rest: s }
}
