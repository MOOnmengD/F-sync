import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../supabaseClient'
import { monthRangeIso, toMonthKey } from '../utils/dateUtils'
import {
  buildFinanceCalendar,
  buildFinanceQuickRecords,
  buildFinanceSummary,
  buildSelectedDayRecords,
  dayKeyToNoonIso,
  getLocalDayKey,
  type FinanceDashboardRow,
  type FinanceQuickRecord,
  type FinanceQuickSourceRow,
} from '../utils/financeDashboard'

const QUICK_PAGE_SIZE = 1000

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeDashboardRow(row: Record<string, unknown>): FinanceDashboardRow | null {
  if (typeof row.id !== 'string' || typeof row.created_at !== 'string') return null
  return {
    id: row.id,
    created_at: row.created_at,
    amount:
      typeof row.amount === 'number' || typeof row.amount === 'string'
        ? row.amount
        : null,
    item_name_snapshot:
      typeof row.item_name_snapshot === 'string' ? row.item_name_snapshot : null,
    necessity: typeof row.necessity === 'boolean' ? row.necessity : null,
  }
}

function normalizeQuickSourceRow(row: Record<string, unknown>): FinanceQuickSourceRow | null {
  const base = normalizeDashboardRow(row)
  if (!base) return null
  return {
    ...base,
    item_id: typeof row.item_id === 'string' ? row.item_id : null,
    brand_snapshot: typeof row.brand_snapshot === 'string' ? row.brand_snapshot : null,
    review: typeof row.review === 'string' ? row.review : null,
    details: typeof row.details === 'string' ? row.details : null,
    finance_category: typeof row.finance_category === 'string' ? row.finance_category : null,
    repurchase_index:
      typeof row.repurchase_index === 'number' ? row.repurchase_index : null,
    ai_metadata: isRecord(row.ai_metadata) ? row.ai_metadata : null,
  }
}

export function useFinanceDashboard({
  enabled,
  selectedDayKey,
  onToast,
}: {
  enabled: boolean
  selectedDayKey: string
  onToast: (message: string) => void
}) {
  const [monthRows, setMonthRows] = useState<FinanceDashboardRow[]>([])
  const [historyRows, setHistoryRows] = useState<FinanceQuickSourceRow[]>([])
  const [loading, setLoading] = useState(false)
  const [quickLoading, setQuickLoading] = useState(false)
  const [quickSending, setQuickSending] = useState(false)
  const [errorText, setErrorText] = useState<string | null>(null)
  const mountedRef = useRef(true)
  const refreshTimerRef = useRef<number | null>(null)
  const quickErrorNotifiedRef = useRef(false)
  const quickSendingRef = useRef(false)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (refreshTimerRef.current !== null) window.clearTimeout(refreshTimerRef.current)
    }
  }, [])

  const fetchMonthRows = useCallback(async () => {
    const client = supabase
    if (!client || !enabled) return
    setLoading(true)
    const now = new Date()
    const monthKey = toMonthKey(now.getFullYear(), now.getMonth() + 1)
    const { startIso, endIso } = monthRangeIso(monthKey)
    const { data, error } = await client
      .from('transactions')
      .select('id, created_at, amount, item_name_snapshot, necessity')
      .eq('type', '记账')
      .gte('created_at', startIso)
      .lt('created_at', endIso)
      .order('created_at', { ascending: false })

    if (!mountedRef.current) return
    setLoading(false)
    if (error) {
      setErrorText('本月消费读取失败')
      return
    }

    const next = (data ?? []).flatMap((row): FinanceDashboardRow[] => {
      const normalized = normalizeDashboardRow(row as Record<string, unknown>)
      return normalized ? [normalized] : []
    })
    setMonthRows(next)
    setErrorText(null)
  }, [enabled])

  const fetchHistoryRows = useCallback(async () => {
    const client = supabase
    if (!client || !enabled) return
    setQuickLoading(true)
    const allRows: FinanceQuickSourceRow[] = []
    let from = 0
    let failed = false

    while (true) {
      const { data, error } = await client
        .from('transactions')
        .select(
          'id, created_at, amount, item_id, item_name_snapshot, brand_snapshot, review, details, finance_category, necessity, repurchase_index, ai_metadata',
        )
        .eq('type', '记账')
        .order('created_at', { ascending: true })
        .range(from, from + QUICK_PAGE_SIZE - 1)

      if (error) {
        failed = true
        break
      }

      const page = data ?? []
      for (const row of page) {
        const normalized = normalizeQuickSourceRow(row as Record<string, unknown>)
        if (normalized) allRows.push(normalized)
      }
      if (page.length < QUICK_PAGE_SIZE) break
      from += QUICK_PAGE_SIZE
    }

    if (!mountedRef.current) return
    setQuickLoading(false)
    if (failed) {
      if (!quickErrorNotifiedRef.current) {
        quickErrorNotifiedRef.current = true
        onToast('快捷记录加载失败')
      }
      return
    }

    quickErrorNotifiedRef.current = false
    setHistoryRows(allRows)
  }, [enabled, onToast])

  const refresh = useCallback(async () => {
    if (!enabled) return
    await Promise.all([fetchMonthRows(), fetchHistoryRows()])
  }, [enabled, fetchHistoryRows, fetchMonthRows])

  const scheduleRefresh = useCallback(() => {
    if (refreshTimerRef.current !== null) window.clearTimeout(refreshTimerRef.current)
    refreshTimerRef.current = window.setTimeout(() => {
      refreshTimerRef.current = null
      void refresh()
    }, 180)
  }, [refresh])

  useEffect(() => {
    if (!enabled) return
    void refresh()
  }, [enabled, refresh])

  useEffect(() => {
    const client = supabase
    if (!client || !enabled) return

    const channel = client
      .channel('home-finance-dashboard')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'transactions' },
        (payload) => {
          const nextType = (payload.new as Record<string, unknown> | null)?.type
          const oldType = (payload.old as Record<string, unknown> | null)?.type
          if (nextType !== '记账' && oldType !== '记账' && (nextType || oldType)) return
          scheduleRefresh()
        },
      )
      .subscribe()

    const handleFocus = () => scheduleRefresh()
    window.addEventListener('focus', handleFocus)

    return () => {
      window.removeEventListener('focus', handleFocus)
      void client.removeChannel(channel)
    }
  }, [enabled, scheduleRefresh])

  const todayKey = getLocalDayKey()
  const summary = useMemo(
    () => buildFinanceSummary(monthRows, todayKey),
    [monthRows, todayKey],
  )
  const calendarDays = useMemo(
    () => buildFinanceCalendar(monthRows, todayKey),
    [monthRows, todayKey],
  )
  const selectedDayRecords = useMemo(
    () => buildSelectedDayRecords(monthRows, selectedDayKey),
    [monthRows, selectedDayKey],
  )
  const quickRecords = useMemo(
    () => buildFinanceQuickRecords(historyRows),
    [historyRows],
  )

  const sendQuickRecord = useCallback(
    async (record: FinanceQuickRecord) => {
      const client = supabase
      if (!client) {
        onToast('先配置 Supabase URL/Key')
        return
      }
      if (quickSendingRef.current) return

      quickSendingRef.current = true
      setQuickSending(true)
      onToast('记录中…')
      try {
        const payload: Record<string, unknown> = {
          type: '记账',
          content: `快捷记录：${record.itemName} ¥${(record.amountCents / 100).toFixed(2)}`,
          amount: record.amountCents / 100,
          item_id: record.template.item_id,
          item_name_snapshot: record.itemName,
          brand_snapshot: record.template.brand_snapshot,
          review: record.review,
          details: record.template.details,
          finance_category: record.template.finance_category,
          necessity: record.template.necessity,
          repurchase_index: record.template.repurchase_index,
          ai_metadata: record.template.ai_metadata ?? {
            item_name: record.itemName,
            brand: record.template.brand_snapshot,
            details: record.template.details,
            review: record.review,
          },
        }
        const currentTodayKey = getLocalDayKey()
        if (selectedDayKey !== currentTodayKey) {
          const createdAt = dayKeyToNoonIso(selectedDayKey)
          if (createdAt) payload.created_at = createdAt
        }

        const { data, error } = await client
          .from('transactions')
          .insert(payload)
          .select('id')
          .single()
        if (error) throw error

        if (data?.id) {
          void fetch('/api/vectorize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ transaction_id: data.id }),
          })
        }

        await refresh()
        onToast('已记录')
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : '快捷记录失败'
        onToast(message || '快捷记录失败')
      } finally {
        quickSendingRef.current = false
        if (mountedRef.current) setQuickSending(false)
      }
    },
    [onToast, refresh, selectedDayKey],
  )

  return {
    summary,
    calendarDays,
    selectedDayRecords,
    quickRecords,
    loading,
    quickLoading,
    quickSending,
    errorText,
    refresh,
    sendQuickRecord,
  }
}
