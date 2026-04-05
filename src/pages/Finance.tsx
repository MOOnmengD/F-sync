import { ChevronDown, Menu } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../supabaseClient'
import { useUi } from '../store/ui'
import { IconButton } from '../shared/ui/IconButton'

type MonthKey = `${number}-${string}`

type TransactionRow = {
  id: string
  created_at: string
  content: string | null
  amount: number | null
}

function pad2(n: number) {
  return String(n).padStart(2, '0')
}

function toMonthKey(year: number, month: number): MonthKey {
  return `${year}-${pad2(month)}`
}

function parseMonthKey(key: MonthKey) {
  const [y, m] = key.split('-')
  return { year: Number(y), month: Number(m) }
}

function monthRangeIso(key: MonthKey) {
  const { year, month } = parseMonthKey(key)
  const start = new Date(year, month - 1, 1, 0, 0, 0, 0)
  const end = new Date(year, month, 1, 0, 0, 0, 0)
  return { startIso: start.toISOString(), endIso: end.toISOString() }
}

function formatMonthLabel(key: MonthKey) {
  const { year, month } = parseMonthKey(key)
  return `${year}年${month}月`
}

function dayKeyFromIso(iso: string) {
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function formatDayLabel(dayKey: string) {
  const [y, m, d] = dayKey.split('-').map((v) => Number(v))
  const date = new Date(y, m - 1, d, 12, 0, 0, 0)
  return new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' }).format(
    date,
  )
}

function formatAmount(amount: number | null) {
  if (amount === null || amount === undefined) return '—'
  if (!Number.isFinite(amount)) return '—'
  return `¥${amount.toFixed(2)}`
}

export default function Finance() {
  const toggleDrawer = useUi((s) => s.toggleDrawer)
  const defaultMonthKey = useMemo(
    () => toMonthKey(new Date().getFullYear(), new Date().getMonth() + 1),
    [],
  )

  const nowYear = useMemo(() => new Date().getFullYear(), [])
  const yearOptions = useMemo(() => [nowYear, nowYear - 1], [nowYear])
  const monthOptions = useMemo(() => Array.from({ length: 12 }, (_, i) => i + 1), [])
  const wheel = useMemo(() => ({ itemH: 44, viewH: 220 }), [])
  const wheelPad = useMemo(() => Math.max(0, Math.floor((wheel.viewH - wheel.itemH) / 2)), [wheel])

  const [monthKey, setMonthKey] = useState<MonthKey>(defaultMonthKey)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [errorText, setErrorText] = useState<string | null>(null)
  const [rows, setRows] = useState<TransactionRow[]>([])
  const contentRef = useRef<HTMLDivElement | null>(null)
  const yearWheelRef = useRef<HTMLDivElement | null>(null)
  const monthWheelRef = useRef<HTMLDivElement | null>(null)
  const yearRafRef = useRef<number | null>(null)
  const monthRafRef = useRef<number | null>(null)
  const yearSnapRef = useRef<number | null>(null)
  const monthSnapRef = useRef<number | null>(null)

  const [pickerYearIndex, setPickerYearIndex] = useState(0)
  const [pickerMonthIndex, setPickerMonthIndex] = useState(0)

  const clampIndex = (value: number, max: number) => Math.min(Math.max(0, value), Math.max(0, max))
  const scrollToIndex = (el: HTMLDivElement | null, idx: number) => {
    if (!el) return
    el.scrollTo({ top: idx * wheel.itemH, behavior: 'smooth' })
  }

  useEffect(() => {
    const client = supabase
    if (!client) return

    let active = true
    const fetchMonth = async () => {
      setLoading(true)
      setErrorText(null)
      const { startIso, endIso } = monthRangeIso(monthKey)

      const { data, error } = await client
        .from('transactions')
        .select('id, created_at, content, amount')
        .gte('created_at', startIso)
        .lt('created_at', endIso)
        .order('created_at', { ascending: false })

      if (!active) return
      if (error) {
        setErrorText('读取失败')
        setRows([])
        setLoading(false)
        return
      }

      const normalized = (data ?? []).filter(Boolean) as unknown as TransactionRow[]
      setRows(normalized)
      setLoading(false)
    }

    void fetchMonth()
    return () => {
      active = false
    }
  }, [monthKey])

  useEffect(() => {
    const client = supabase
    if (!client) return

    const channel = client
      .channel('transactions-insert')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'transactions' },
        (payload) => {
          const next = payload.new as unknown as Partial<TransactionRow> | null
          if (!next?.id || !next.created_at) return

          const { startIso, endIso } = monthRangeIso(monthKey)
          const t = Date.parse(next.created_at)
          if (!Number.isFinite(t)) return
          if (t < Date.parse(startIso) || t >= Date.parse(endIso)) return

          setRows((prev) => {
            if (prev.some((r) => r.id === next.id)) return prev
            const merged: TransactionRow[] = [
              {
                id: String(next.id),
                created_at: String(next.created_at),
                content: (next.content ?? null) as string | null,
                amount: (typeof next.amount === 'number' ? next.amount : null) as number | null,
              },
              ...prev,
            ]
            merged.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
            return merged
          })
        },
      )
      .subscribe()

    return () => {
      void client.removeChannel(channel)
    }
  }, [monthKey])

  const groups = useMemo(() => {
    const m = new Map<string, TransactionRow[]>()
    for (const r of rows) {
      if (!r.created_at) continue
      const key = dayKeyFromIso(r.created_at)
      const list = m.get(key)
      if (list) list.push(r)
      else m.set(key, [r])
    }
    return Array.from(m.entries()).map(([key, items]) => ({ key, label: formatDayLabel(key), items }))
  }, [rows])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open])

  useEffect(() => {
    if (!contentRef.current) return
    contentRef.current.scrollTop = 0
  }, [monthKey])

  useEffect(() => {
    if (!open) return

    const { year, month } = parseMonthKey(monthKey)
    const yIdx = clampIndex(yearOptions.indexOf(year), yearOptions.length - 1)
    const mIdx = clampIndex(month - 1, monthOptions.length - 1)
    setPickerYearIndex(yIdx)
    setPickerMonthIndex(mIdx)

    const id = window.requestAnimationFrame(() => {
      if (yearWheelRef.current) yearWheelRef.current.scrollTop = yIdx * wheel.itemH
      if (monthWheelRef.current) monthWheelRef.current.scrollTop = mIdx * wheel.itemH
    })
    return () => window.cancelAnimationFrame(id)
  }, [open, monthKey, monthOptions.length, yearOptions, wheel.itemH])

  useEffect(() => {
    if (!open) return
    return () => {
      if (yearRafRef.current) window.cancelAnimationFrame(yearRafRef.current)
      if (monthRafRef.current) window.cancelAnimationFrame(monthRafRef.current)
      if (yearSnapRef.current) window.clearTimeout(yearSnapRef.current)
      if (monthSnapRef.current) window.clearTimeout(monthSnapRef.current)
      yearRafRef.current = null
      monthRafRef.current = null
      yearSnapRef.current = null
      monthSnapRef.current = null
    }
  }, [open])

  return (
    <div className="mx-auto min-h-dvh max-w-[480px] bg-base-bg px-4 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] pt-[calc(env(safe-area-inset-top)+1.25rem)] text-base-text">
      <header className="sticky top-0 z-20 -mx-4 bg-base-bg/95 px-4 pb-3 backdrop-blur-sm">
        <div className="flex items-center justify-between">
          <IconButton label="打开导航" onClick={toggleDrawer} icon={<Menu size={18} />} />
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="inline-flex items-center gap-1 rounded-full border border-base-line bg-base-surface px-4 py-2 text-sm font-medium text-base-text active:opacity-70"
            aria-label="选择月份"
            aria-expanded={open}
          >
            <span>{formatMonthLabel(monthKey)}</span>
            <ChevronDown size={16} className={open ? 'rotate-180 transition-transform' : 'transition-transform'} />
          </button>
          <div className="h-10 w-10" />
        </div>
      </header>

      <div ref={contentRef} className="mt-2">
        {!supabase && (
          <div className="rounded-2xl border border-base-line bg-base-surface p-4 text-sm text-base-muted">
            未配置 Supabase（请设置 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY）
          </div>
        )}

        {supabase && (
          <>
            {loading && (
              <div className="rounded-2xl border border-base-line bg-base-surface p-4 text-sm text-base-muted">
                加载中…
              </div>
            )}
            {!loading && errorText && (
              <div className="rounded-2xl border border-base-line bg-base-surface p-4 text-sm text-base-muted">
                {errorText}
              </div>
            )}
            {!loading && !errorText && groups.length === 0 && (
              <div className="rounded-2xl border border-base-line bg-base-surface p-4 text-sm text-base-muted">
                这个月还没有记录
              </div>
            )}

            {!loading && !errorText && groups.length > 0 && (
              <div className="space-y-6">
                {groups.map((g) => (
                  <section key={g.key}>
                    <div className="px-1 text-xs font-medium text-base-muted">{g.label}</div>
                    <div className="mt-2 space-y-2">
                      {g.items.map((r) => (
                        <div
                          key={r.id}
                          className="flex items-center justify-between rounded-2xl border border-base-line border-l-4 border-l-pastel-mint bg-base-surface px-4 py-3"
                        >
                          <div className="min-w-0 flex-1 pr-3 text-sm text-base-text">
                            <div className="truncate">{r.content || '（无内容）'}</div>
                          </div>
                          <div className="shrink-0 text-sm font-medium text-base-text">
                            {formatAmount(r.amount)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {open && (
        <div className="fixed inset-0 z-50" aria-label="月份选择器">
          <button
            type="button"
            className="absolute inset-0 bg-black/20"
            aria-label="关闭月份选择器"
            onClick={() => setOpen(false)}
          />
          <div className="absolute left-1/2 top-[calc(env(safe-area-inset-top)+4.5rem)] w-[calc(100%-2rem)] max-w-[440px] -translate-x-1/2 rounded-2xl border border-base-line bg-[#FDFCFB] p-3">
            <div className="grid grid-cols-[1fr_1fr_auto] items-center gap-2 px-1">
              <div className="text-xs font-medium text-base-muted">年份</div>
              <div className="text-xs font-medium text-base-muted">月份</div>
              <button
                type="button"
                onClick={() => {
                  const year = yearOptions[clampIndex(pickerYearIndex, yearOptions.length - 1)] ?? nowYear
                  const month = monthOptions[clampIndex(pickerMonthIndex, monthOptions.length - 1)] ?? 1
                  setMonthKey(toMonthKey(year, month))
                  setOpen(false)
                }}
                className="rounded-2xl border border-base-line bg-pastel-mint px-4 py-2 text-sm font-medium text-base-text active:opacity-70"
              >
                确定
              </button>
            </div>

            <div className="relative mt-3 grid grid-cols-2 gap-2">
              <div className="relative">
                <div
                  className="pointer-events-none absolute left-2 right-2 top-1/2 z-10 -translate-y-1/2 rounded-2xl border border-base-line bg-[#F7F5F2]/40"
                  style={{ height: wheel.itemH }}
                />
                <div
                  ref={yearWheelRef}
                  className="overflow-y-auto snap-y snap-mandatory [-webkit-overflow-scrolling:touch] [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                  style={{ height: wheel.viewH, paddingTop: wheelPad, paddingBottom: wheelPad }}
                  onScroll={(e) => {
                    const el = e.currentTarget
                    if (yearRafRef.current) window.cancelAnimationFrame(yearRafRef.current)
                    yearRafRef.current = window.requestAnimationFrame(() => {
                      const nextIdx = clampIndex(Math.round(el.scrollTop / wheel.itemH), yearOptions.length - 1)
                      setPickerYearIndex(nextIdx)
                    })
                    if (yearSnapRef.current) window.clearTimeout(yearSnapRef.current)
                    yearSnapRef.current = window.setTimeout(() => {
                      const idx = clampIndex(Math.round(el.scrollTop / wheel.itemH), yearOptions.length - 1)
                      scrollToIndex(el, idx)
                    }, 120)
                  }}
                >
                  {yearOptions.map((y, idx) => {
                    const active = idx === pickerYearIndex
                    return (
                      <div
                        key={y}
                        className={`mx-2 flex snap-center items-center justify-center rounded-2xl ${
                          active
                            ? 'bg-pastel-mint text-lg font-semibold text-base-text'
                            : 'text-sm text-base-muted'
                        }`}
                        style={{ height: wheel.itemH }}
                      >
                        {y}年
                      </div>
                    )
                  })}
                </div>
              </div>

              <div className="relative">
                <div
                  className="pointer-events-none absolute left-2 right-2 top-1/2 z-10 -translate-y-1/2 rounded-2xl border border-base-line bg-[#F7F5F2]/40"
                  style={{ height: wheel.itemH }}
                />
                <div
                  ref={monthWheelRef}
                  className="overflow-y-auto snap-y snap-mandatory [-webkit-overflow-scrolling:touch] [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                  style={{ height: wheel.viewH, paddingTop: wheelPad, paddingBottom: wheelPad }}
                  onScroll={(e) => {
                    const el = e.currentTarget
                    if (monthRafRef.current) window.cancelAnimationFrame(monthRafRef.current)
                    monthRafRef.current = window.requestAnimationFrame(() => {
                      const nextIdx = clampIndex(Math.round(el.scrollTop / wheel.itemH), monthOptions.length - 1)
                      setPickerMonthIndex(nextIdx)
                    })
                    if (monthSnapRef.current) window.clearTimeout(monthSnapRef.current)
                    monthSnapRef.current = window.setTimeout(() => {
                      const idx = clampIndex(Math.round(el.scrollTop / wheel.itemH), monthOptions.length - 1)
                      scrollToIndex(el, idx)
                    }, 120)
                  }}
                >
                  {monthOptions.map((m, idx) => {
                    const active = idx === pickerMonthIndex
                    return (
                      <div
                        key={m}
                        className={`mx-2 flex snap-center items-center justify-center rounded-2xl ${
                          active
                            ? 'bg-pastel-mint text-lg font-semibold text-base-text'
                            : 'text-sm text-base-muted'
                        }`}
                        style={{ height: wheel.itemH }}
                      >
                        {m}月
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
