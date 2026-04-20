import { ChevronDown, Menu } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../supabaseClient'
import { useUi } from '../store/ui'
import { IconButton } from '../shared/ui/IconButton'
import { MonthPicker } from '../shared/ui/MonthPicker'
import {
  toMonthKey,
  monthRangeIso,
  formatMonthLabel,
  dayKeyFromIso,
  formatDayLabel,
} from '../utils/dateUtils'
import type { MonthKey } from '../utils/dateUtils'
import { formatAmount } from '../utils/amountUtils'

type TransactionRow = {
  id: string
  created_at: string
  amount: number | null
  type: string | null
  item_id: string | null
  item_name: string | null
}

export default function Finance() {
  const toggleDrawer = useUi((s) => s.toggleDrawer)
  const defaultMonthKey = useMemo(
    () => toMonthKey(new Date().getFullYear(), new Date().getMonth() + 1),
    [],
  )

  const [monthKey, setMonthKey] = useState<MonthKey>(defaultMonthKey)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [errorText, setErrorText] = useState<string | null>(null)
  const [rows, setRows] = useState<TransactionRow[]>([])
  const contentRef = useRef<HTMLDivElement | null>(null)

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
        .select('id, created_at, amount, type, item_id')
        .eq('type', '记账')
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

      const normalized = ((data ?? []).filter(Boolean) as unknown as TransactionRow[])
        .filter((r) => r.type === '记账')
        .map((r) => ({
          ...r,
          item_id: r.item_id ? String(r.item_id) : null,
          item_name: null,
        }))

      const itemIds = Array.from(
        new Set(normalized.map((r) => r.item_id).filter((v): v is string => Boolean(v))),
      )

      if (itemIds.length === 0) {
        setRows(normalized)
        setLoading(false)
        return
      }

      const { data: itemRows, error: itemError } = await client.from('items').select('id, item_name').in('id', itemIds)
      if (!active) return
      if (itemError) {
        setRows(normalized)
        setLoading(false)
        return
      }

      const nameById = new Map<string, string>()
      for (const it of (itemRows ?? []) as Array<{ id: unknown; item_name: unknown }>) {
        const id = typeof it?.id === 'string' ? it.id : it?.id != null ? String(it.id) : ''
        const name = typeof it?.item_name === 'string' ? it.item_name.trim() : ''
        if (id && name) nameById.set(id, name)
      }

      setRows(
        normalized.map((r) => ({
          ...r,
          item_name: r.item_id ? nameById.get(r.item_id) ?? null : null,
        })),
      )
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
          if (next.type !== '记账') return

          const { startIso, endIso } = monthRangeIso(monthKey)
          const t = Date.parse(next.created_at)
          if (!Number.isFinite(t)) return
          if (t < Date.parse(startIso) || t >= Date.parse(endIso)) return

          const itemId = (next as any)?.item_id ? String((next as any).item_id) : null

          setRows((prev) => {
            if (prev.some((r) => r.id === next.id)) return prev
            const merged: TransactionRow[] = [
              {
                id: String(next.id),
                created_at: String(next.created_at),
                amount: (typeof next.amount === 'number' ? next.amount : null) as number | null,
                type: (next.type ?? null) as string | null,
                item_id: itemId,
                item_name: null,
              },
              ...prev,
            ]
            merged.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
            return merged
          })

          if (!itemId) return
          void (async () => {
            const { data: item, error } = await client
              .from('items')
              .select('id, item_name')
              .eq('id', itemId)
              .maybeSingle()
            if (error || !item) return
            const name = typeof (item as any)?.item_name === 'string' ? (item as any).item_name.trim() : ''
            if (!name) return
            setRows((prev) =>
              prev.map((r) => (r.id === String(next.id) ? { ...r, item_name: name } : r)),
            )
          })()
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
    if (!contentRef.current) return
    contentRef.current.scrollTop = 0
  }, [monthKey])

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
                            <div className="truncate">{r.item_name || '（无名称）'}</div>
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

      <MonthPicker monthKey={monthKey} setMonthKey={setMonthKey} open={open} setOpen={setOpen} />
    </div>
  )
}
