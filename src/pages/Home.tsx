import { Menu, Send, Sparkles } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { useUi } from '../store/ui'
import type { ActiveMediaItem, MediaStatus, MediaType, QuickMode } from '../types/domain'
import { IconButton } from '../shared/ui/IconButton'
import { useSettingsStore } from '../store/settings'
import { PillButton } from '../shared/ui/PillButton'
import { RepurchaseIndexPill } from '../shared/ui/RepurchaseIndexPill'
import { useTimeline, TIMELINE_KINDS } from '../hooks/useTimeline'
import { WeeklyTimeline } from '../components/WeeklyTimeline'
import InvestmentPanel from '../components/InvestmentPanel'
import { extractDate } from '../utils/dateUtils'
import { extractAmount, pickItemNameFallback, formatAmount } from '../utils/amountUtils'
import { FinanceDashboard } from '../components/FinanceDashboard'
import { useFinanceDashboard } from '../hooks/useFinanceDashboard'
import {
  datePartsToDayKey,
  dayKeyToNoonIso,
  formatFinanceMonthLabel,
  formatSelectedFinanceDate,
  getLocalDayKey,
} from '../utils/financeDashboard'

const modeMeta: Record<
  QuickMode,
  { label: string; accent: 'peach' | 'mint' | 'baby' | 'butter' | 'lavender' | 'timeline' | 'rose'; hint: string }
> = {
  finance: { label: '记账', accent: 'mint', hint: '' },
  review: { label: '点评', accent: 'peach', hint: '对一个物品/服务写一句感受' },
  note: { label: '碎碎念', accent: 'baby', hint: '写点当下的想法，不用完整' },
  work: { label: '工作', accent: 'butter', hint: '记录推进点 / blockers / 下一步' },
  save: { label: '收藏', accent: 'lavender', hint: '保存链接/片段，稍后再整理' },
  timeline: { label: '时间轴', accent: 'timeline', hint: '计时记录：选择分类，开始 / 停止' },
  invest: { label: '理财', accent: 'rose', hint: '' },
  media: { label: '书影', accent: 'baby', hint: '输入书名/影名和感受，一句话记下来' },
}

const accentHex: Record<(typeof modeMeta)[QuickMode]['accent'], string> = {
  peach: '#FAD9D2',
  mint: '#CFF3E5',
  baby: '#D7E8FF',
  butter: '#FFF1B8',
  lavender: '#E9D9FF',
  timeline: '#F2DEBD',
  rose: '#FAD1D1',
}

export default function Home() {
  const navigate = useNavigate()
  const toggleDrawer = useUi((s) => s.toggleDrawer)
  const mode = useUi((s) => s.homeMode)
  const setMode = useUi((s) => s.setHomeMode)
  const category = useUi((s) => s.financeCategory)
  const setCategory = useUi((s) => s.setFinanceCategory)
  const necessity = useUi((s) => s.financeNecessity)
  const setNecessity = useUi((s) => s.setFinanceNecessity)
  const mood = useUi((s) => s.noteMood)
  const setMood = useUi((s) => s.setNoteMood)
  const mediaType = useUi((s) => s.mediaType)
  const setMediaType = useUi((s) => s.setMediaType)
  const mediaStatus = useUi((s) => s.mediaStatus)
  const setMediaStatus = useUi((s) => s.setMediaStatus)

  const meta = modeMeta[mode]
  const [text, setText] = useState('')
  const [customMoods, setCustomMoods] = useState<string[]>([])
  const [customMoodOpen, setCustomMoodOpen] = useState(false)
  const [customMoodDraft, setCustomMoodDraft] = useState('')
  const customMoodInputRef = useRef<HTMLInputElement | null>(null)
  const [keyboardOffset, setKeyboardOffset] = useState(0)
  const [toast, setToast] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const settings = useSettingsStore((s) => s.settings)
  const loadSettingsFromCloud = useSettingsStore((s) => s.loadFromCloud)
  const [repurchaseIndex, setRepurchaseIndex] = useState(0)
  const [lastFinanceTx, setLastFinanceTx] = useState<LastFinanceTx | null>(null)
  const [reviewTargetId, setReviewTargetId] = useState<string | null>(null)
  const [reviewTargetTx, setReviewTargetTx] = useState<LastFinanceTx | null>(null)
  const [financeTodayKey, setFinanceTodayKey] = useState(() => getLocalDayKey())
  const [selectedFinanceDate, setSelectedFinanceDate] = useState(() => getLocalDayKey())
  const financeTodayKeyRef = useRef(financeTodayKey)
  const [activeMediaItems, setActiveMediaItems] = useState<ActiveMediaItem[]>([])
  const [activeMediaLoading, setActiveMediaLoading] = useState(false)
  const [selectedMediaItemId, setSelectedMediaItemId] = useState<string | null>(null)

  const [refreshKey, setRefreshKey] = useState(0)
  const [userId, setUserId] = useState<string | null>(null)
  const {
    summary: financeSummary,
    calendarDays: financeCalendarDays,
    selectedDayRecords: financeSelectedDayRecords,
    quickRecords: financeQuickRecords,
    loading: financeDashboardLoading,
    quickSending: financeQuickSending,
    errorText: financeDashboardError,
    refresh: refreshFinanceDashboard,
    sendQuickRecord,
  } = useFinanceDashboard({
    enabled: mode === 'finance',
    selectedDayKey: selectedFinanceDate,
    onToast: setToast,
  })

  const {
    kind: timelineKind,
    running: timelineRunning,
    durationLabel: timelineDurationLabel,
    handleStart: handleTimelineStart,
    handleStop: handleTimelineStop,
    handleCancel: handleTimelineCancel,
    handleKindChange,
  } = useTimeline(setToast, () => setRefreshKey((k) => k + 1))

  const makeClientId = () => {
    const cryptoAny = crypto as unknown as { randomUUID?: () => string } | undefined
    if (cryptoAny?.randomUUID) return cryptoAny.randomUUID()
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`
  }

  type OutboxEntry = {
    id: string
    mode: QuickMode
    raw: string
    ts: number
  }

  const loadOutbox = (): OutboxEntry[] => {
    try {
      const raw = localStorage.getItem('fsync_outbox')
      if (!raw) return []
      const parsed = JSON.parse(raw) as unknown
      if (!Array.isArray(parsed)) return []
      return parsed.filter(Boolean) as OutboxEntry[]
    } catch {
      return []
    }
  }

  const saveOutbox = (next: OutboxEntry[]) => {
    try {
      localStorage.setItem('fsync_outbox', JSON.stringify(next))
    } catch {
      return
    }
  }

  const addOutbox = (entry: OutboxEntry) => {
    const prev = loadOutbox()
    saveOutbox([...prev, entry])
  }

  const removeOutbox = (id: string) => {
    const prev = loadOutbox()
    saveOutbox(prev.filter((e) => e?.id !== id))
  }

  const readJsonResponse = async (response: Response, fallbackMessage: string) => {
    const responseText = await response.text()
    let data: unknown = null
    if (responseText.trim()) {
      try {
        data = JSON.parse(responseText) as unknown
      } catch {
        throw new Error(`${fallbackMessage}：接口返回非 JSON（HTTP ${response.status}）`)
      }
    }
    if (!response.ok || !data || typeof data !== 'object') {
      const detail = (data as any)?.detail
      const detailText =
        typeof detail === 'string'
          ? detail
          : typeof detail?.error?.message === 'string'
            ? detail.error.message
            : typeof detail?.message === 'string'
              ? detail.message
              : detail
                ? JSON.stringify(detail)
                : ''
      const statusText =
        typeof (data as any)?.upstreamStatus === 'number'
          ? `（上游 HTTP ${(data as any).upstreamStatus}）`
          : ''
      const msg =
        typeof (data as any)?.error === 'string'
          ? `${(data as any).error}${statusText}${detailText ? `：${detailText.slice(0, 160)}` : ''}`
          : `${fallbackMessage}（HTTP ${response.status}）`
      throw new Error(msg)
    }
    return data
  }

  const parseTransactionByAi = async (raw: string) => {
    const cfg = settings.parseTransactionConfig
    const r = await fetch('/api/parse-transaction', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: raw,
        url: cfg.url || undefined,
        key: cfg.key || undefined,
        model: cfg.model || undefined,
        systemPrompt: cfg.systemPrompt || undefined,
        userPrompt: cfg.userPrompt || undefined,
      }),
    })
    const data = await readJsonResponse(r, 'AI 解析失败')
    return data as {
      amount: number | null
      item_name: string | null
      brand: string | null
      details: string | null
      review: string | null
    }
  }

  const parseMediaByAi = async (raw: string) => {
    const mediaCfg = settings.parseMediaConfig
    const fallbackCfg = settings.parseTransactionConfig
    const r = await fetch('/api/parse-media', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: raw,
        url: mediaCfg.url || fallbackCfg.url || undefined,
        key: mediaCfg.key || fallbackCfg.key || undefined,
        model: mediaCfg.model || fallbackCfg.model || undefined,
        systemPrompt: mediaCfg.systemPrompt || undefined,
        userPrompt: mediaCfg.userPrompt || undefined,
      }),
    })
    const data = await readJsonResponse(r, '书影解析失败')
    return data as {
      title: string | null
      review: string | null
    }
  }

  const fetchActiveMediaItems = async () => {
    const client = supabase
    if (!client || !userId) return

    setActiveMediaLoading(true)
    const { data, error } = await client
      .from('media_items')
      .select('id, title, media_type, status, updated_at')
      .eq('user_id', userId)
      .eq('status', 'consuming')
      .order('updated_at', { ascending: false })

    setActiveMediaLoading(false)

    if (error) {
      setToast('正在看的书影加载失败')
      return
    }

    const next = (data ?? []).flatMap((row: any): ActiveMediaItem[] => {
      if (
        typeof row?.id !== 'string' ||
        typeof row?.title !== 'string' ||
        (row?.media_type !== 'book' && row?.media_type !== 'movie') ||
        row?.status !== 'consuming' ||
        typeof row?.updated_at !== 'string'
      ) {
        return []
      }

      return [{
        id: row.id,
        title: row.title,
        mediaType: row.media_type,
        status: 'consuming',
        updatedAt: row.updated_at,
      }]
    })

    setActiveMediaItems(next)
  }

  const fetchLastFinanceTx = async () => {
    const client = supabase
    if (!client) return

    const { data, error } = await client
      .from('transactions')
      .select(
        'id, created_at, content, amount, type, item_id, ai_metadata, review, details, finance_category, item_name_snapshot, brand_snapshot, necessity, repurchase_index',
      )
      .eq('type', '记账')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error || !data?.id || !data.created_at) {
      setLastFinanceTx(null)
      return
    }

    const itemId = (data as any)?.item_id ? String((data as any).item_id) : null
    const content = typeof (data as any)?.content === 'string' ? String((data as any).content) : ''
    const rawAmount = (data as any)?.amount
    const amount =
      typeof rawAmount === 'number'
        ? rawAmount
        : typeof rawAmount === 'string'
          ? Number.parseFloat(rawAmount)
          : null
    const aiMetadata = isRecord((data as any)?.ai_metadata)
      ? ((data as any).ai_metadata as Record<string, unknown>)
      : null
    const review = typeof (data as any)?.review === 'string' ? (data as any).review : null
    const details = typeof (data as any)?.details === 'string' ? (data as any).details : null
    const financeCategory =
      typeof (data as any)?.finance_category === 'string' ? (data as any).finance_category : null
    const itemNameSnapshot =
      typeof (data as any)?.item_name_snapshot === 'string' ? (data as any).item_name_snapshot : null
    const brandSnapshot =
      typeof (data as any)?.brand_snapshot === 'string' ? (data as any).brand_snapshot : null
    const txNecessity = (data as any)?.necessity ?? null
    const txRepurchaseIndex =
      typeof (data as any)?.repurchase_index === 'number' ? (data as any).repurchase_index : 0

    if (!itemId) {
      setLastFinanceTx({
        id: String(data.id),
        created_at: String(data.created_at),
        content,
        amount,
        item_id: null,
        item_name: null,
        ai_metadata: aiMetadata,
        review,
        details,
        finance_category: financeCategory,
        item_name_snapshot: itemNameSnapshot,
        brand_snapshot: brandSnapshot,
        necessity: txNecessity,
        repurchase_index: txRepurchaseIndex,
      })
      return
    }

    const { data: item, error: itemErr } = await client
      .from('items')
      .select('id, item_name')
      .eq('id', itemId)
      .maybeSingle()

    const itemName =
      !itemErr && typeof (item as any)?.item_name === 'string' ? (item as any).item_name.trim() : null

    setLastFinanceTx({
      id: String(data.id),
      created_at: String(data.created_at),
      content,
      amount,
      item_id: itemId,
      item_name: itemName || null,
      ai_metadata: aiMetadata,
      review,
      details,
      finance_category: financeCategory,
      item_name_snapshot: itemNameSnapshot,
      brand_snapshot: brandSnapshot,
      necessity: txNecessity,
      repurchase_index: txRepurchaseIndex,
    })
  }

  useEffect(() => {
    void loadSettingsFromCloud()
  }, [loadSettingsFromCloud])

  useEffect(() => {
    let midnightTimer: number | null = null

    const scheduleMidnightSync = () => {
      if (midnightTimer !== null) window.clearTimeout(midnightTimer)
      const now = new Date()
      const nextMidnight = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + 1,
        0,
        0,
        1,
        0,
      )
      midnightTimer = window.setTimeout(() => {
        syncCurrentDay()
        scheduleMidnightSync()
      }, Math.max(1000, nextMidnight.getTime() - now.getTime()))
    }

    const syncCurrentDay = () => {
      const nextTodayKey = getLocalDayKey()
      const previousTodayKey = financeTodayKeyRef.current
      financeTodayKeyRef.current = nextTodayKey
      setFinanceTodayKey(nextTodayKey)
      setSelectedFinanceDate((current) => {
        const sameMonth = current.slice(0, 7) === nextTodayKey.slice(0, 7)
        const wasDefaultToday = current === previousTodayKey
        return sameMonth && current <= nextTodayKey && !wasDefaultToday ? current : nextTodayKey
      })
    }

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') syncCurrentDay()
    }

    window.addEventListener('focus', syncCurrentDay)
    document.addEventListener('visibilitychange', handleVisibility)
    scheduleMidnightSync()
    return () => {
      window.removeEventListener('focus', syncCurrentDay)
      document.removeEventListener('visibilitychange', handleVisibility)
      if (midnightTimer !== null) window.clearTimeout(midnightTimer)
    }
  }, [])

  useEffect(() => {
    const client = supabase
    if (!client) return
    client.auth.getUser().then(({ data }) => {
      if (data?.user?.id) setUserId(data.user.id)
    })
  }, [])

  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return

    const update = () => {
      const offset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
      setKeyboardOffset(offset)
    }

    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [])

  useEffect(() => {
    const client = supabase
    if (!client) return

    let active = true
    const safeFetch = async () => {
      if (!active) return
      await fetchLastFinanceTx()
    }

    void safeFetch()

    const channel = client
      .channel('home-last-finance')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'transactions' }, (payload) => {
        const next = payload.new as any
        if (!next?.id || !next?.created_at) return
        if (next.type !== '记账') return
        void safeFetch()
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'transactions' }, (payload) => {
        const next = payload.new as any
        if (!next?.id || !next?.created_at) return
        if (next.type !== '记账') return
        void safeFetch()
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'transactions' }, (payload) => {
        const previous = payload.old as any
        if (previous?.type && previous.type !== '记账') return
        void safeFetch()
      })
      .subscribe()

    return () => {
      active = false
      void client.removeChannel(channel)
    }
  }, [])

  useEffect(() => {
    if (mode !== 'media' || !userId) return
    void fetchActiveMediaItems()
  }, [mode, userId])

  useEffect(() => {
    const client = supabase
    if (!client || !userId) return

    const channel = client
      .channel(`home-active-media-${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'media_items',
          filter: `user_id=eq.${userId}`,
        },
        () => {
          void fetchActiveMediaItems()
        },
      )
      .subscribe()

    return () => {
      void client.removeChannel(channel)
    }
  }, [userId])

  useEffect(() => {
    if (mode !== 'media' || !userId) return

    const handleFocus = () => {
      void fetchActiveMediaItems()
    }

    window.addEventListener('focus', handleFocus)
    return () => window.removeEventListener('focus', handleFocus)
  }, [mode, userId])

  const composerBorder = useMemo(() => ({ borderColor: accentHex[meta.accent] }), [meta.accent])
  const sendStyle = useMemo(
    () => ({ backgroundColor: accentHex[meta.accent], borderColor: accentHex[meta.accent] }),
    [meta.accent],
  )
  const chipActiveStyle = useMemo(() => ({ backgroundColor: accentHex[modeMeta.finance.accent] }), [])
  const noteMoodActiveStyle = useMemo(() => ({ backgroundColor: accentHex[modeMeta.note.accent] }), [])
  const mediaTypeActiveStyle = useMemo(() => ({ backgroundColor: accentHex.lavender }), [])
  const mediaStatusAccent: Record<MediaStatus, string> = useMemo(
    () => ({
      want_to_consume: accentHex.lavender,
      consuming: accentHex.butter,
      consumed: accentHex.mint,
    }),
    [],
  )

  useEffect(() => {
    if (!toast) return
    if (toast === '记录中…') return
    const t = window.setTimeout(() => setToast(null), 1200)
    return () => window.clearTimeout(t)
  }, [toast])

  const financeCategories = useMemo(() => ['衣', '食', '住', '行', '其他'] as const, [])
  const baseMoods = useMemo(() => ['😐', '🥰', '😔', '🤬', '😖'] as const, [])
  const moodOptions = useMemo(() => [...baseMoods, ...customMoods], [baseMoods, customMoods])

  useEffect(() => {
    if (!customMoodOpen) return
    const id = window.requestAnimationFrame(() => {
      customMoodInputRef.current?.focus()
      customMoodInputRef.current?.select()
    })
    return () => window.cancelAnimationFrame(id)
  }, [customMoodOpen])

  const commitCustomMood = () => {
    const trimmed = customMoodDraft.trim()
    if (!trimmed) return
    setCustomMoods((prev) => (prev.includes(trimmed) ? prev : [...prev, trimmed]))
    setMood(trimmed)
    setCustomMoodOpen(false)
  }

  const pendingReviewTx = useMemo(() => {
    if (mode !== 'finance') return null
    if (!lastFinanceTx) return null
    const txReview = typeof lastFinanceTx.review === 'string' ? lastFinanceTx.review : ''
    if (txReview.trim()) return null
    const metaReview =
      typeof lastFinanceTx.ai_metadata?.review === 'string' ? lastFinanceTx.ai_metadata.review : ''
    if (metaReview.trim()) return null
    return lastFinanceTx
  }, [lastFinanceTx, mode])

  const activeReviewTx = useMemo(() => {
    if (!reviewTargetId || !reviewTargetTx) return null
    return reviewTargetTx.id === reviewTargetId ? reviewTargetTx : null
  }, [reviewTargetId, reviewTargetTx])

  const selectedMediaItem = useMemo(
    () => activeMediaItems.find((item) => item.id === selectedMediaItemId) ?? null,
    [activeMediaItems, selectedMediaItemId],
  )

  useEffect(() => {
    if (!selectedMediaItemId) return
    if (selectedMediaItem) return
    setSelectedMediaItemId(null)
    setMediaType(null)
    setMediaStatus(null)
  }, [selectedMediaItem, selectedMediaItemId, setMediaStatus, setMediaType])

  const sendReviewSupplement = async (transactionId: string) => {
    const reviewText = text.trim()

    if (!supabase) {
      setToast('先配置 Supabase URL/Key')
      return
    }

    if (sending) return

    setToast('记录中…')
    setSending(true)
    try {
      const { data: tx, error: txError } = await supabase
        .from('transactions')
        .select('id, item_id, ai_metadata')
        .eq('id', transactionId)
        .maybeSingle()

      if (txError || !tx?.id) {
        setToast(txError?.message || '读取上一条记录失败')
        return
      }

      const currentAiMetadata = isRecord((tx as any)?.ai_metadata)
        ? ((tx as any).ai_metadata as Record<string, unknown>)
        : {}

      const nextAiMetadata: Record<string, unknown> = { ...currentAiMetadata }
      if (reviewText) nextAiMetadata.review = reviewText

      const payload: Record<string, unknown> = { ai_metadata: nextAiMetadata }
      if (reviewText) payload.review = reviewText
      if (category) payload.finance_category = category
      if (necessity !== null) payload.necessity = necessity === 'need'
      if (repurchaseIndex > 0) payload.repurchase_index = repurchaseIndex

      const { error: updateError } = await supabase
        .from('transactions')
        .update(payload)
        .eq('id', transactionId)

      if (updateError) {
        setToast(updateError.message || '写入失败')
        return
      }

      const itemId = (tx as any)?.item_id ? String((tx as any).item_id) : null
      if (itemId) {
        const itemUpdatePatch: Record<string, unknown> = {}
        if (reviewText) itemUpdatePatch.last_review = reviewText
        if (Object.keys(itemUpdatePatch).length > 0) {
          await supabase.from('items').update(itemUpdatePatch).eq('id', itemId)
        }
      }

      setReviewTargetId(null)
      setReviewTargetTx(null)
      setText('')
      setCategory(null)
      setNecessity(null)
      setRepurchaseIndex(0)
      await fetchLastFinanceTx()
      void refreshFinanceDashboard()
      setToast('已补点评')
    } finally {
      setSending(false)
    }
  }

  const sendTransaction = async () => {
    const raw = text.trim()
    if (!raw) return

    if (!supabase) {
      setToast('先配置 Supabase URL/Key')
      return
    }

    if (sending) return

    const outboxId = makeClientId()
    addOutbox({ id: outboxId, mode, raw, ts: Date.now() })
    setText('')
    setToast('记录中…')

    setSending(true)
    try {
      const normalized = raw.replace(/\u3000/g, ' ').trim()
      const dateResult = extractDate(normalized, new Date())
      const amountResult = extractAmount(dateResult.rest)
      const extractedAmount = amountResult.amount
      const aiInput = amountResult.rest.trim()
      if (!aiInput) {
        setToast('请输入内容')
        return
      }

      const parsed = await parseTransactionByAi(aiInput)
      const parsedReview = typeof parsed.review === 'string' ? parsed.review.trim() : ''
      const reviewText = parsedReview ? parsedReview : null
      const itemName = parsed.item_name?.trim() || pickItemNameFallback(aiInput) || null
      if (!itemName) {
        setToast('AI 未解析出 item_name')
        return
      }

      const brandText = typeof parsed.brand === 'string' ? parsed.brand.trim() : ''
      const brand = brandText ? brandText : null
      const detailsText = typeof parsed.details === 'string' ? parsed.details.trim() : ''
      const details = detailsText ? detailsText : null

      const aiMetadata: Record<string, unknown> = { item_name: itemName, brand, details, review: reviewText }
      const contentToStore = raw

      const { data: existingItem, error: findError } = await supabase
        .from('items')
        .select('id, brand')
        .eq('item_name', itemName)
        .maybeSingle()

      if (findError) {
        setToast(findError.message || '查询 items 失败')
        return
      }

      let itemId: string | null = existingItem?.id ? String(existingItem.id) : null

      if (!itemId) {
        const { data: created, error: createError } = await supabase
          .from('items')
          .insert({ item_name: itemName, last_review: reviewText, brand })
          .select('id')
          .single()

        if (createError) {
          setToast(createError.message || '创建 item 失败')
          return
        }
        itemId = created?.id ? String(created.id) : null
      } else {
        const updatePatch: Record<string, unknown> = {}
        if (brand && (existingItem as any)?.brand !== brand) updatePatch.brand = brand
        if (reviewText) updatePatch.last_review = reviewText

        const { error: updateError } = await supabase.from('items').update(updatePatch).eq('id', itemId)
        if (updateError) {
          setToast(updateError.message || '更新 item 失败')
          return
        }
      }

      if (!itemId) {
        setToast('item_id 获取失败')
        return
      }

      const payload: Record<string, unknown> = {
        type: modeMeta[mode].label,
        content: contentToStore,
        amount: extractedAmount ?? parsed.amount ?? null,
        item_id: itemId,
        ai_metadata: aiMetadata,
        review: reviewText,
        details,
        item_name_snapshot: itemName,
        brand_snapshot: brand,
      }
      if (mode === 'finance') {
        payload.necessity = necessity === null ? null : necessity === 'need'
        payload.repurchase_index = repurchaseIndex > 0 ? repurchaseIndex : null
        payload.finance_category = category ?? null
      }
      if (dateResult.date) {
        const explicitDayKey = datePartsToDayKey(dateResult.date)
        const createdAt = dayKeyToNoonIso(explicitDayKey)
        if (createdAt) payload.created_at = createdAt
      } else if (mode === 'finance' && selectedFinanceDate !== financeTodayKey) {
        const createdAt = dayKeyToNoonIso(selectedFinanceDate)
        if (createdAt) payload.created_at = createdAt
      }

      const { data: inserted, error } = await supabase.from('transactions').insert(payload).select('id').single()
      if (error) {
        setToast(error.message || '写入失败')
        return
      }

      if (inserted?.id) {
        void fetch('/api/vectorize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transaction_id: inserted.id }),
        })
      }

      removeOutbox(outboxId)
      setCategory(null)
      setNecessity(null)
      setRepurchaseIndex(0)
      void fetchLastFinanceTx()
      void refreshFinanceDashboard()
      setToast('已记录')
    } catch (e: any) {
      const msg = String(e?.message ?? e) || 'AI 解析失败'
      setToast(`${msg}（已保存在本地草稿）`)
      if (!text.trim()) setText(raw)
    } finally {
      setSending(false)
    }
  }

  const sendMedia = async () => {
    const raw = text.trim()
    if (!raw) return

    if (!supabase) {
      setToast('先配置 Supabase URL/Key')
      return
    }

    if (sending) return

    const outboxId = makeClientId()
    addOutbox({ id: outboxId, mode, raw, ts: Date.now() })
    setText('')
    setToast('记录中…')

    setSending(true)
    try {
      const target = selectedMediaItem
      let title: string
      let review: string | null
      let finalType: MediaType
      let finalStatus: MediaStatus

      if (target) {
        title = target.title
        review = raw
        finalType = target.mediaType
        finalStatus = mediaStatus ?? target.status
      } else {
        const parsed = await parseMediaByAi(raw)
        title = parsed.title?.trim() || ''
        if (!title) throw new Error('AI 未解析出标题')
        review = parsed.review?.trim() || null
        finalType = mediaType ?? 'book'
        finalStatus = mediaStatus ?? 'want_to_consume'
      }

      const { error } = await supabase.rpc('save_media_record', {
        p_media_item_id: target?.id ?? null,
        p_title: title,
        p_media_type: finalType,
        p_status: finalStatus,
        p_review: review,
        p_occurred_at: new Date().toISOString(),
      })

      if (error) throw error

      removeOutbox(outboxId)
      setSelectedMediaItemId(null)
      setMediaType(null)
      setMediaStatus(null)
      await fetchActiveMediaItems()
      setToast(target ? '已新增点评' : '已记录')
    } catch (e: any) {
      const msg = String(e?.message ?? e) || 'AI 解析失败'
      setToast(`${msg}（已保存在本地草稿）`)
      if (!text.trim()) setText(raw)
    } finally {
      setSending(false)
    }
  }

  const sendWhisper = async () => {
    const raw = text.trim()
    if (!raw) return

    if (!supabase) {
      setToast('先配置 Supabase URL/Key')
      return
    }

    if (sending) return

    const outboxId = makeClientId()
    addOutbox({ id: outboxId, mode, raw, ts: Date.now() })
    setText('')
    setToast('记录中…')

    setSending(true)
    try {
      const payload = { type: 'whisper', content: raw, mood }
      const { data: inserted, error } = await supabase.from('transactions').insert(payload).select('id').single()
      if (error) {
        setToast(error.message || '写入失败')
        return
      }

      if (inserted?.id) {
        void fetch('/api/vectorize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transaction_id: inserted.id }),
        })
      }

      removeOutbox(outboxId)
      setToast('已记录')
    } finally {
      setSending(false)
    }
  }

  const handleSend = () => {
    if (mode === 'note') {
      void sendWhisper()
      return
    }

    if (mode === 'finance' && activeReviewTx) {
      void sendReviewSupplement(activeReviewTx.id)
      return
    }

    if (mode === 'finance' || mode === 'review') {
      void sendTransaction()
      return
    }

    if (mode === 'media') {
      void sendMedia()
      return
    }

    setText('')
    setToast('已发送')
  }

  const toggleReviewSupplement = () => {
    if (activeReviewTx) {
      setReviewTargetId(null)
      setReviewTargetTx(null)
      setCategory(null)
      setNecessity(null)
      setRepurchaseIndex(0)
      return
    }
    if (!pendingReviewTx) return
    setReviewTargetId(pendingReviewTx.id)
    setReviewTargetTx(pendingReviewTx)
    setCategory(pendingReviewTx.finance_category as any)
    setNecessity(
      pendingReviewTx.necessity === null
        ? null
        : pendingReviewTx.necessity
          ? 'need'
          : 'want',
    )
    setRepurchaseIndex(pendingReviewTx.repurchase_index || 0)
  }

  const handleQuickRecord = async (record: (typeof financeQuickRecords)[number]) => {
    await sendQuickRecord(record)
    await fetchLastFinanceTx()
  }

  return (
    <div
      className={`mx-auto min-h-dvh max-w-[480px] bg-base-bg px-4 text-base-text ${
        mode === 'finance' ? 'pb-[280px]' : 'pb-[160px]'
      }`}
    >
      <header className="sticky top-0 z-50 -mx-4 bg-base-bg/95 px-4 pb-3 pt-4 backdrop-blur-sm">
        <div className="flex items-center justify-between">
          <IconButton label="打开导航" onClick={toggleDrawer} icon={<Menu size={18} />} />
          <div className="text-sm font-medium text-base-text">主页</div>
          <IconButton label="AI 助手" onClick={() => navigate('/chat')} icon={<Sparkles size={18} />} />
        </div>

        <div className="mt-4 rounded-2xl bg-base-surface p-2">
          <div className="flex flex-wrap gap-2">
            <PillButton
              label="记账"
              active={mode === 'finance'}
              onClick={() => setMode('finance')}
              accent={modeMeta.finance.accent}
            />
            <PillButton
              label="点评"
              active={mode === 'review'}
              onClick={() => setMode('review')}
              accent={modeMeta.review.accent}
            />
            <PillButton
              label="碎碎念"
              active={mode === 'note'}
              onClick={() => {
                setMode('note')
                setMood('😐')
              }}
              accent={modeMeta.note.accent}
            />
            <PillButton
              label="工作"
              active={mode === 'work'}
              onClick={() => setMode('work')}
              accent={modeMeta.work.accent}
            />
            <PillButton
              label="收藏"
              active={mode === 'save'}
              onClick={() => setMode('save')}
              accent={modeMeta.save.accent}
            />
            <PillButton
              label="时间轴"
              active={mode === 'timeline'}
              onClick={() => setMode('timeline')}
              accent="timeline"
            />
            <PillButton
              label="理财"
              active={mode === 'invest'}
              onClick={() => setMode('invest')}
              accent="rose"
            />
            <PillButton
              label="书影"
              active={mode === 'media'}
              onClick={() => setMode('media')}
              accent={modeMeta.media.accent}
            />
          </div>
        </div>
        <div
          className="pointer-events-none absolute inset-x-0 -bottom-5 h-5"
          style={{ background: 'linear-gradient(to bottom, rgba(253,252,251,0.98), rgba(253,252,251,0))' }}
        />
      </header>

      {mode === 'timeline' ? (
        <div className="mt-4">
          <WeeklyTimeline refreshKey={refreshKey} />
        </div>
      ) : mode === 'invest' ? (
        userId ? <InvestmentPanel userId={userId} /> : (
          <div className="mt-4 text-center text-sm text-base-muted py-8">加载中…</div>
        )
      ) : mode === 'finance' ? (
        <FinanceDashboard
          monthLabel={formatFinanceMonthLabel(financeTodayKey)}
          summary={financeSummary}
          calendarDays={financeCalendarDays}
          selectedDayKey={selectedFinanceDate}
          selectedDayRecords={financeSelectedDayRecords}
          loading={financeDashboardLoading}
          errorText={financeDashboardError}
          onSelectDay={setSelectedFinanceDate}
        />
      ) : (
        <div className="mt-4 text-sm text-base-muted">{meta.hint}</div>
      )}

      <div
        className="fixed left-1/2 z-40 w-full max-w-[480px] -translate-x-1/2 px-4"
        style={{ bottom: keyboardOffset }}
      >
        {mode === 'timeline' && (
          <div
            className="rounded-2xl border border-base-line bg-base-surface p-3"
            style={{ borderColor: '#F2DEBD' }}
          >
            <div className="grid grid-cols-4 gap-2">
              {TIMELINE_KINDS.map((k) => {
                const active = timelineKind === k
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => handleKindChange(k)}
                    className={`rounded-full border border-base-line px-4 py-2 text-sm active:opacity-70 ${
                      active ? 'text-base-text' : 'bg-transparent text-base-muted'
                    }`}
                    style={active ? { backgroundColor: '#F2DEBD' } : undefined}
                  >
                    {k}
                  </button>
                )
              })}
            </div>

            <div className="mt-3 flex items-center gap-2 pb-[env(safe-area-inset-bottom)]">
              <button
                type="button"
                onClick={handleTimelineStart}
                className="rounded-full border border-base-line bg-base-bg px-4 py-2 text-sm text-base-text active:opacity-70 whitespace-nowrap disabled:opacity-40 disabled:active:opacity-40"
                disabled={timelineRunning}
              >
                开始
              </button>

              <div className="min-w-0 flex-1 text-center text-sm font-bold" style={{ color: '#E49F5E' }}>
                {timelineDurationLabel}
              </div>

              <button
                type="button"
                onClick={handleTimelineStop}
                className="rounded-full border border-base-line bg-base-bg px-4 py-2 text-sm text-base-text active:opacity-70 whitespace-nowrap disabled:opacity-40 disabled:active:opacity-40"
                disabled={!timelineRunning}
              >
                停止
              </button>

              <button
                type="button"
                onClick={handleTimelineCancel}
                className="rounded-full border border-base-line bg-base-bg px-4 py-2 text-sm text-base-text active:opacity-70 whitespace-nowrap disabled:opacity-40 disabled:active:opacity-40"
                disabled={!timelineRunning}
              >
                取消计时
              </button>
            </div>
          </div>
        )}

        {mode !== 'timeline' && mode !== 'invest' && (
          <>
            {mode === 'note' && (
              <div className="mb-2 rounded-2xl bg-base-surface p-3">
                <div className="flex flex-wrap gap-2">
                  {moodOptions.map((m) => {
                    const active = mood === m
                    return (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setMood(m)}
                        className={`rounded-full border border-base-line px-4 py-2 text-sm active:opacity-70 ${
                          active ? 'text-base-text' : 'bg-base-bg text-base-muted'
                        }`}
                        style={active ? noteMoodActiveStyle : undefined}
                      >
                        {m}
                      </button>
                    )
                  })}
                  <button
                    type="button"
                    onClick={() => {
                      setCustomMoodDraft(mood)
                      setCustomMoodOpen(true)
                    }}
                    className="rounded-full border border-base-line bg-base-bg px-4 py-2 text-sm text-base-muted active:opacity-70"
                    aria-label="添加自定义 emoji"
                  >
                    ➕
                  </button>
                </div>
              </div>
            )}
            {mode === 'finance' && (
              <div className="mb-2 rounded-2xl bg-base-surface p-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  {financeCategories.map((c) => {
                    const active = category === c
                    return (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setCategory(active ? null : c)}
                        className={`rounded-full border border-base-line px-3 py-1 text-xs active:opacity-70 ${
                          active ? 'text-base-text' : 'bg-transparent text-base-muted'
                        }`}
                        style={active ? chipActiveStyle : undefined}
                      >
                        {c}
                      </button>
                    )
                  })}
                  {(pendingReviewTx || activeReviewTx) && (
                    <button
                      type="button"
                      onClick={toggleReviewSupplement}
                      className={`rounded-full border border-base-line px-3 py-1 text-xs active:opacity-70 ${
                        activeReviewTx ? 'text-base-text' : 'bg-transparent text-base-muted'
                      }`}
                      style={activeReviewTx ? chipActiveStyle : undefined}
                      aria-pressed={Boolean(activeReviewTx)}
                      aria-label="为上一条记账补点评"
                    >
                      {activeReviewTx ? '补充中' : '补点评'}
                    </button>
                  )}
                </div>

                <div className="mt-2 flex items-center gap-2">
                  <div className="inline-grid grid-cols-2 overflow-hidden rounded-full border border-base-line bg-base-bg">
                    {(
                      [
                        { key: 'need' as const, label: '必需' },
                        { key: 'want' as const, label: '非必需' },
                      ] as const
                    ).map((o) => {
                      const active = necessity === o.key
                      return (
                        <button
                          key={o.key}
                          type="button"
                          onClick={() => setNecessity(active ? null : o.key)}
                          className={`w-14 whitespace-nowrap py-1 text-xs font-medium active:opacity-70 ${
                            active ? 'text-base-text' : 'bg-transparent text-base-muted'
                          }`}
                          style={active ? chipActiveStyle : undefined}
                        >
                          {o.label}
                        </button>
                      )
                    })}
                  </div>
                  <RepurchaseIndexPill value={repurchaseIndex} onChange={setRepurchaseIndex} />
                </div>

                {financeQuickRecords.length > 0 && (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5" aria-label="快捷记录">
                    {financeQuickRecords.map((record) => (
                      <button
                        key={record.key}
                        type="button"
                        onClick={() => void handleQuickRecord(record)}
                        disabled={financeQuickSending || sending}
                        className="inline-flex max-w-full items-center gap-1 rounded-full border border-[#BFE8DA] bg-[#E9F8F2] px-3 py-1 text-xs text-base-text active:opacity-70 disabled:opacity-50"
                        title={`${record.itemName} ${formatAmount(record.amountCents / 100)}`}
                      >
                        <span className="max-w-[120px] truncate">{record.itemName}</span>
                        <span className="shrink-0 text-base-muted">
                          {formatAmount(record.amountCents / 100)}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {mode === 'media' && (
              <div className="mb-2 rounded-2xl bg-base-surface p-3">
                {activeMediaItems.length > 0 && (
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    {activeMediaItems.map((item) => {
                      const active = selectedMediaItemId === item.id
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => {
                            if (active) {
                              setSelectedMediaItemId(null)
                              setMediaType(null)
                              setMediaStatus(null)
                              return
                            }
                            setSelectedMediaItemId(item.id)
                            setMediaType(item.mediaType)
                            setMediaStatus(item.status)
                          }}
                          className={`inline-flex max-w-full items-center rounded-full border border-base-line px-3 py-1 text-xs active:opacity-70 ${
                            active ? 'text-base-text' : 'bg-base-bg text-base-muted'
                          }`}
                          style={active ? { backgroundColor: accentHex.baby } : undefined}
                          aria-pressed={active}
                          title={item.title}
                        >
                          <span className="max-w-[260px] truncate">《{item.title}》</span>
                        </button>
                      )
                    })}
                  </div>
                )}
                {activeMediaLoading && activeMediaItems.length === 0 && (
                  <div className="mb-2 text-xs text-base-muted">正在加载正在看的书影…</div>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  {(['book', 'movie'] as MediaType[]).map((t) => {
                    const active = mediaType === t
                    const label = t === 'book' ? '📖 书籍' : '🎬 影片'
                    return (
                      <button
                        key={t}
                        type="button"
                        onClick={() => {
                          if (selectedMediaItemId) {
                            setSelectedMediaItemId(null)
                            setMediaStatus(null)
                          }
                          setMediaType(active ? null : t)
                        }}
                        className={`rounded-full border border-base-line px-3 py-1 text-xs active:opacity-70 ${
                          active ? 'text-base-text' : 'bg-transparent text-base-muted'
                        }`}
                        style={active ? mediaTypeActiveStyle : undefined}
                      >
                        {label}
                      </button>
                    )
                  })}
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {(
                    [
                      ['want_to_consume', '想看'],
                      ['consuming', '正在看'],
                      ['consumed', '看过'],
                    ] as [MediaStatus, string][]
                  ).map(([s, label]) => {
                    const active = mediaStatus === s
                    return (
                      <button
                        key={s}
                        type="button"
                        onClick={() => {
                          if (selectedMediaItemId && active) return
                          setMediaStatus(active ? null : s)
                        }}
                        className={`rounded-full border border-base-line px-3 py-1 text-xs active:opacity-70 ${
                          active ? 'text-base-text' : 'bg-transparent text-base-muted'
                        }`}
                        style={active ? { backgroundColor: mediaStatusAccent[s] } : undefined}
                      >
                        {label}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
            <section
              className="rounded-2xl border bg-base-surface p-3"
              style={composerBorder}
              aria-label="快速输入"
            >
              {mode === 'finance' && selectedFinanceDate !== financeTodayKey && !activeReviewTx && (
                <div className="mb-1 px-1 text-[11px] font-medium text-[#4F9F86]">
                  记录到 {formatSelectedFinanceDate(selectedFinanceDate)}
                </div>
              )}
              <div className="relative">
                <textarea
                  rows={2}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={
                    mode === 'finance' && activeReviewTx
                      ? `给「${activeReviewTx.item_name_snapshot || activeReviewTx.item_name || '上一条记账'}」补点评…`
                      : mode === 'media' && selectedMediaItem
                        ? `给《${selectedMediaItem.title}》写一条新点评…`
                      : `在「${meta.label}」里输入…`
                  }
                  className="min-h-[52px] w-full resize-none bg-transparent px-1 py-2 pr-14 text-base-text placeholder:text-base-muted focus:outline-none"
                />
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={sending}
                  className="absolute right-0 top-2 inline-flex h-10 w-10 items-center justify-center rounded-full border text-base-text active:opacity-70"
                  style={sendStyle}
                  aria-label="发送"
                >
                  <Send size={18} />
                </button>
              </div>

              <div className="mt-2 pb-[env(safe-area-inset-bottom)]">
                {mode !== 'finance' && mode !== 'note' && mode !== 'media' && (
                  <div className="flex flex-wrap gap-2">
                    <span className="rounded-full border border-base-line bg-base-bg px-3 py-1 text-xs text-base-muted">
                      自动关联 Item（后续）
                    </span>
                  </div>
                )}
              </div>
            </section>
          </>
        )}
      </div>

      {toast && (
        <div
          className="fixed left-1/2 z-50 -translate-x-1/2 rounded-full border border-base-line bg-base-surface/95 px-4 py-2 text-xs text-base-text backdrop-blur-sm"
          style={{ bottom: keyboardOffset + 96 }}
          role="status"
          aria-live="polite"
        >
          {toast}
        </div>
      )}

      {customMoodOpen && (
        <div
          className="fixed inset-0 z-[60] flex items-end justify-center bg-black/15 px-4 pb-6 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="添加自定义 emoji"
          onClick={() => setCustomMoodOpen(false)}
        >
          <div
            className="w-full max-w-[480px] rounded-2xl border border-base-line bg-base-surface p-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2">
              <input
                ref={customMoodInputRef}
                value={customMoodDraft}
                onChange={(e) => setCustomMoodDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    commitCustomMood()
                  }
                  if (e.key === 'Escape') setCustomMoodOpen(false)
                }}
                inputMode="text"
                className="h-11 w-11 rounded-xl border border-base-line bg-base-bg px-3 text-base-text focus:outline-none"
                placeholder="例如：😵‍💫"
                aria-label="自定义 emoji"
              />
              <button
                type="button"
                onClick={() => setCustomMoodOpen(false)}
                className="h-11 rounded-xl border border-base-line bg-base-bg px-4 text-sm text-base-muted active:opacity-70"
              >
                取消
              </button>
              <button
                type="button"
                onClick={commitCustomMood}
                className="h-11 rounded-xl border border-base-line bg-base-bg px-4 text-sm text-base-text active:opacity-70"
                style={noteMoodActiveStyle}
              >
                添加
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

type LastFinanceTx = {
  id: string
  created_at: string
  content: string
  amount: number | null
  item_id: string | null
  item_name: string | null
  ai_metadata: Record<string, unknown> | null
  review: string | null
  details: string | null
  finance_category: string | null
  item_name_snapshot: string | null
  brand_snapshot: string | null
  necessity: boolean | null
  repurchase_index: number | null
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v)
}
