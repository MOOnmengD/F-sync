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

type WhisperRow = {
  id: string
  created_at: string
  content: string | null
  mood: string | null
  type?: string | null
}

export default function Whisper() {
  const toggleDrawer = useUi((s) => s.toggleDrawer)
  const defaultMonthKey = useMemo(
    () => toMonthKey(new Date().getFullYear(), new Date().getMonth() + 1),
    [],
  )

  const [monthKey, setMonthKey] = useState<MonthKey>(defaultMonthKey)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [errorText, setErrorText] = useState<string | null>(null)
  const [rows, setRows] = useState<WhisperRow[]>([])
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set())
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
        .select('id, created_at, content, mood, type')
        .eq('type', 'whisper')
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

      const normalized = (data ?? []).filter(Boolean) as unknown as WhisperRow[]
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
      .channel('transactions-insert-whisper')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'transactions' },
        (payload) => {
          const next = payload.new as unknown as Partial<WhisperRow> | null
          if (!next?.id || !next.created_at) return
          if (next.type !== 'whisper') return

          const { startIso, endIso } = monthRangeIso(monthKey)
          const t = Date.parse(next.created_at)
          if (!Number.isFinite(t)) return
          if (t < Date.parse(startIso) || t >= Date.parse(endIso)) return

          setRows((prev) => {
            if (prev.some((r) => r.id === next.id)) return prev
            const merged: WhisperRow[] = [
              {
                id: String(next.id),
                created_at: String(next.created_at),
                content: (next.content ?? null) as string | null,
                mood: (next.mood ?? null) as string | null,
                type: (next.type ?? null) as string | null,
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
    const m = new Map<string, WhisperRow[]>()
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
    setExpandedIds(new Set())
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
                      {g.items.map((r) => {
                        const expanded = expandedIds.has(r.id)
                        const mood = r.mood || '😐'
                        const content = r.content || '（无内容）'
                        return (
                          <button
                            key={r.id}
                            type="button"
                            onClick={() => {
                              setExpandedIds((prev) => {
                                const next = new Set(prev)
                                if (next.has(r.id)) next.delete(r.id)
                                else next.add(r.id)
                                return next
                              })
                            }}
                            className="w-full rounded-2xl border border-base-line bg-base-surface px-4 py-3 text-left active:opacity-70"
                            aria-expanded={expanded}
                          >
                            <div className="relative pl-8">
                              <div className="absolute left-0 top-0 text-lg leading-none">{mood}</div>
                              <div
                                className={`text-sm text-base-text ${
                                  expanded
                                    ? ''
                                    : 'overflow-hidden [display:-webkit-box] [-webkit-line-clamp:3] [-webkit-box-orient:vertical]'
                                }`}
                              >
                                {content}
                              </div>
                            </div>
                          </button>
                        )
                      })}
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
