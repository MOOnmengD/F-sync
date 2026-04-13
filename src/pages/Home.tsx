import { Menu, Send, Star } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { supabase } from '../supabaseClient'
import { useUi } from '../store/ui'
import type { QuickMode } from '../types/domain'
import { IconButton } from '../shared/ui/IconButton'
import { PillButton } from '../shared/ui/PillButton'

type TimelineKind = '睡眠' | '生活' | '工作' | '娱乐'

type TimingType = 'sleep' | 'life' | 'work' | 'play'

function pad2(n: number) {
  return String(n).padStart(2, '0')
}

function formatDurationHm(ms: number) {
  const totalMin = Math.max(0, Math.floor(ms / 60000))
  const hh = Math.floor(totalMin / 60)
  const mm = totalMin % 60
  return `${pad2(hh)}:${pad2(mm)}`
}

const modeMeta: Record<
  QuickMode,
  { label: string; accent: 'peach' | 'mint' | 'baby' | 'butter' | 'lavender' | 'timeline'; hint: string }
> = {
  finance: { label: '记账', accent: 'mint', hint: '今天花了多少？一句话记下来' },
  review: { label: '点评', accent: 'peach', hint: '对一个物品/服务写一句感受' },
  note: { label: '碎碎念', accent: 'baby', hint: '写点当下的想法，不用完整' },
  work: { label: '工作', accent: 'butter', hint: '记录推进点 / blockers / 下一步' },
  save: { label: '收藏', accent: 'lavender', hint: '保存链接/片段，稍后再整理' },
  timeline: { label: '时间轴', accent: 'timeline', hint: '计时记录：选择分类，开始 / 停止' },
}

const accentHex: Record<(typeof modeMeta)[QuickMode]['accent'], string> = {
  peach: '#FAD9D2',
  mint: '#CFF3E5',
  baby: '#D7E8FF',
  butter: '#FFF1B8',
  lavender: '#E9D9FF',
  timeline: '#F2DEBD',
}

export default function Home() {
  const toggleDrawer = useUi((s) => s.toggleDrawer)
  const mode = useUi((s) => s.homeMode)
  const setMode = useUi((s) => s.setHomeMode)
  const category = useUi((s) => s.financeCategory)
  const setCategory = useUi((s) => s.setFinanceCategory)
  const necessity = useUi((s) => s.financeNecessity)
  const setNecessity = useUi((s) => s.setFinanceNecessity)
  const mood = useUi((s) => s.noteMood)
  const setMood = useUi((s) => s.setNoteMood)

  const meta = modeMeta[mode]
  const [text, setText] = useState('')
  const [customMoods, setCustomMoods] = useState<string[]>([])
  const [customMoodOpen, setCustomMoodOpen] = useState(false)
  const [customMoodDraft, setCustomMoodDraft] = useState('')
  const customMoodInputRef = useRef<HTMLInputElement | null>(null)
  const [keyboardOffset, setKeyboardOffset] = useState(0)
  const [toast, setToast] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [repurchaseIndex, setRepurchaseIndex] = useState(0)
  const [lastFinanceTx, setLastFinanceTx] = useState<LastFinanceTx | null>(null)
  const [reviewTargetId, setReviewTargetId] = useState<string | null>(null)

  const timelineStorageKey = 'fsync.timeline.active.v1'
  const timelineKinds = useMemo(() => ['睡眠', '生活', '工作', '娱乐'] as const, [])
  const [timelineKind, setTimelineKind] = useState<TimelineKind | null>(null)
  const [timelineRunning, setTimelineRunning] = useState(false)
  const [timelineStartAt, setTimelineStartAt] = useState<number | null>(null)
  const [timelineTick, setTimelineTick] = useState(0)

  const timingTypeByKind: Record<TimelineKind, TimingType> = useMemo(
    () => ({
      睡眠: 'sleep',
      生活: 'life',
      工作: 'work',
      娱乐: 'play',
    }),
    [],
  )

  const kindByTimingType: Record<TimingType, TimelineKind> = useMemo(
    () => ({
      sleep: '睡眠',
      life: '生活',
      work: '工作',
      play: '娱乐',
    }),
    [],
  )

  useEffect(() => {
    const raw = localStorage.getItem(timelineStorageKey)
    if (!raw) return
    try {
      const parsed = JSON.parse(raw) as { timing_type?: unknown; start_time?: unknown } | null
      const timingType = typeof parsed?.timing_type === 'string' ? parsed.timing_type : ''
      const startTime = typeof parsed?.start_time === 'string' ? parsed.start_time : ''
      if (!timingType || !startTime) {
        localStorage.removeItem(timelineStorageKey)
        return
      }
      if (!['sleep', 'life', 'work', 'play'].includes(timingType)) {
        localStorage.removeItem(timelineStorageKey)
        return
      }
      const ms = Date.parse(startTime)
      if (!Number.isFinite(ms)) {
        localStorage.removeItem(timelineStorageKey)
        return
      }

      setTimelineKind(kindByTimingType[timingType as TimingType])
      setTimelineStartAt(ms)
      setTimelineRunning(true)
    } catch {
      localStorage.removeItem(timelineStorageKey)
    }
  }, [kindByTimingType])

  useEffect(() => {
    if (!timelineRunning) return
    const id = window.setInterval(() => setTimelineTick((t) => t + 1), 1000)
    return () => window.clearInterval(id)
  }, [timelineRunning])

  const timelineElapsedMs = useMemo(() => {
    if (!timelineRunning || timelineStartAt === null) return 0
    return Math.max(0, Date.now() - timelineStartAt)
  }, [timelineRunning, timelineStartAt, timelineTick])

  const timelineDurationLabel = useMemo(() => formatDurationHm(timelineElapsedMs), [timelineElapsedMs])

  const writeTiming = async (input: { timingType: TimingType; startMs: number; endMs: number }) => {
    const client = supabase
    if (!client) {
      setToast('未配置 Supabase')
      return false
    }
    const duration = Math.max(0, Math.floor((input.endMs - input.startMs) / 1000))
    const payload = {
      type: 'timing',
      timing_type: input.timingType,
      start_time: new Date(input.startMs).toISOString(),
      end_time: new Date(input.endMs).toISOString(),
      duration,
    }

    const { error } = await client.from('transactions').insert(payload)
    if (error) {
      setToast('写入失败')
      return false
    }
    return true
  }

  const handleTimelineStart = () => {
    if (timelineRunning) return
    if (!timelineKind) {
      setToast('请先选择计时类型')
      return
    }
    const now = Date.now()
    localStorage.setItem(
      timelineStorageKey,
      JSON.stringify({ timing_type: timingTypeByKind[timelineKind], start_time: new Date(now).toISOString() }),
    )
    setTimelineStartAt(now)
    setTimelineRunning(true)
  }

  const handleTimelineStop = () => {
    if (!timelineRunning || timelineStartAt === null) return
    setTimelineRunning(false)
    setTimelineStartAt(null)
    localStorage.removeItem(timelineStorageKey)

    if (!timelineKind) return
    const endMs = Date.now()
    void (async () => {
      await writeTiming({ timingType: timingTypeByKind[timelineKind], startMs: timelineStartAt, endMs })
    })()
  }

  const handleTimelineCancel = () => {
    if (!timelineRunning) return
    setTimelineRunning(false)
    setTimelineStartAt(null)
    setTimelineKind(null)
    localStorage.removeItem(timelineStorageKey)
  }

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
    const merged = [...prev, entry]
    saveOutbox(merged)
  }

  const removeOutbox = (id: string) => {
    const prev = loadOutbox()
    const next = prev.filter((e) => e?.id !== id)
    saveOutbox(next)
  }

  const parseTransactionByAi = async (raw: string) => {
    const r = await fetch('/api/parse-transaction', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: raw }),
    })
    const data = (await r.json().catch(() => null)) as unknown
    if (!r.ok || !data || typeof data !== 'object') {
      const msg =
        typeof (data as any)?.error === 'string'
          ? (data as any).error
          : 'AI 解析失败（后端未返回有效 JSON）'
      throw new Error(msg)
    }
    return data as {
      amount: number | null
      item_name: string | null
      brand: string | null
      details: string | null
      review: string | null
    }
  }

  const fetchLastFinanceTx = async () => {
    const client = supabase
    if (!client) return

    const { data, error } = await client
      .from('transactions')
      .select(
        'id, created_at, content, amount, type, item_id, ai_metadata, review, details, finance_category, item_name_snapshot, brand_snapshot',
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
    })
  }

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
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'transactions' },
        (payload) => {
          const next = payload.new as any
          if (!next?.id || !next?.created_at) return
          if (next.type !== '记账') return
          void safeFetch()
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'transactions' },
        (payload) => {
          const next = payload.new as any
          if (!next?.id || !next?.created_at) return
          if (next.type !== '记账') return
          void safeFetch()
        },
      )
      .subscribe()

    return () => {
      active = false
      void client.removeChannel(channel)
    }
  }, [])

  const composerBorder = useMemo(() => ({ borderColor: accentHex[meta.accent] }), [meta.accent])
  const sendStyle = useMemo(
    () => ({ backgroundColor: accentHex[meta.accent], borderColor: accentHex[meta.accent] }),
    [meta.accent],
  )
  const chipActiveStyle = useMemo(() => ({ backgroundColor: accentHex[modeMeta.finance.accent] }), [])
  const noteMoodActiveStyle = useMemo(() => ({ backgroundColor: accentHex[modeMeta.note.accent] }), [])

  useEffect(() => {
    if (!toast) return
    if (toast === '记录中…') return
    const t = window.setTimeout(() => setToast(null), 1200)
    return () => window.clearTimeout(t)
  }, [toast])

  const financeCategories = useMemo(() => ['衣', '食', '住', '行', '娱乐'] as const, [])
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
    const metaReview = typeof lastFinanceTx.ai_metadata?.review === 'string' ? lastFinanceTx.ai_metadata.review : ''
    if (metaReview.trim()) return null
    return lastFinanceTx
  }, [lastFinanceTx, mode])

  useEffect(() => {
    if (!reviewTargetId) return
    if (!pendingReviewTx || pendingReviewTx.id !== reviewTargetId) setReviewTargetId(null)
  }, [pendingReviewTx, reviewTargetId])

  const sendReviewSupplement = async (transactionId: string) => {
    const reviewText = text.trim()
    if (!reviewText) return

    if (!supabase) {
      setToast('先配置 Supabase URL/Key')
      return
    }

    if (sending) return

    setText('')
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
      const nextAiMetadata: Record<string, unknown> = { ...currentAiMetadata, review: reviewText }

      const { error: updateError } = await supabase
        .from('transactions')
        .update({ ai_metadata: nextAiMetadata, review: reviewText })
        .eq('id', transactionId)

      if (updateError) {
        setToast(updateError.message || '写入失败')
        return
      }

      const itemId = (tx as any)?.item_id ? String((tx as any).item_id) : null
      if (itemId) {
        const { error: itemUpdateError } = await supabase
          .from('items')
          .update({ last_review: reviewText })
          .eq('id', itemId)
        if (itemUpdateError) {
          setToast(itemUpdateError.message || '更新 item 失败')
          return
        }
      }

      setReviewTargetId(null)
      await fetchLastFinanceTx()
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

      const aiMetadata: Record<string, unknown> = {
        item_name: itemName,
        brand,
        details,
        review: reviewText,
      }
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
          .insert({
            item_name: itemName,
            last_review: reviewText,
            brand,
          })
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
        payload.created_at = new Date(
          dateResult.date.year,
          dateResult.date.month - 1,
          dateResult.date.day,
          12,
          0,
          0,
          0,
        ).toISOString()
      }

      const { error } = await supabase.from('transactions').insert(payload)
      if (error) {
        setToast(error.message || '写入失败')
        return
      }

      removeOutbox(outboxId)
      setCategory(null)
      setNecessity(null)
      setRepurchaseIndex(0)
      void fetchLastFinanceTx()
      setToast('已记录')
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
      const payload: {
        type: string
        content: string
        mood: string
      } = {
        type: 'whisper',
        content: raw,
        mood,
      }

      const { error } = await supabase.from('transactions').insert(payload)
      if (error) {
        setToast(error.message || '写入失败')
        return
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

    if (mode === 'finance' && pendingReviewTx && reviewTargetId === pendingReviewTx.id) {
      void sendReviewSupplement(pendingReviewTx.id)
      return
    }

    if (mode === 'finance' || mode === 'review') {
      void sendTransaction()
      return
    }

    setText('')
    setToast('已发送')
  }

  return (
    <div className="mx-auto min-h-dvh max-w-[480px] bg-base-bg px-4 pb-[160px] text-base-text">
      <header className="sticky top-0 z-10 -mx-4 bg-base-bg/95 px-4 pb-3 pt-4">
        <div className="flex items-center justify-between">
          <IconButton label="打开导航" onClick={toggleDrawer} icon={<Menu size={18} />} />
          <div className="text-sm font-medium text-base-text">主页</div>
          <div className="h-10 w-10" />
        </div>

        <div
          className="mt-4 rounded-2xl bg-base-surface p-2"
        >
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
          </div>
        </div>
      </header>

      <div className="mt-4 text-sm text-base-muted">{meta.hint}</div>

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
              {timelineKinds.map((k) => {
                const active = timelineKind === k
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => {
                      if (!timelineRunning) {
                        setTimelineKind(active ? null : k)
                        return
                      }
                      if (k === timelineKind) return
                      if (!timelineKind || timelineStartAt === null) {
                        const now = Date.now()
                        setTimelineKind(k)
                        setTimelineStartAt(now)
                        localStorage.setItem(
                          timelineStorageKey,
                          JSON.stringify({
                            timing_type: timingTypeByKind[k],
                            start_time: new Date(now).toISOString(),
                          }),
                        )
                        return
                      }

                      const prevKind = timelineKind
                      const prevStartAt = timelineStartAt
                      const now = Date.now()

                      setTimelineKind(k)
                      setTimelineStartAt(now)
                      localStorage.setItem(
                        timelineStorageKey,
                        JSON.stringify({
                          timing_type: timingTypeByKind[k],
                          start_time: new Date(now).toISOString(),
                        }),
                      )
                      void (async () => {
                        await writeTiming({
                          timingType: timingTypeByKind[prevKind],
                          startMs: prevStartAt,
                          endMs: now,
                        })
                      })()
                    }}
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

        {mode !== 'timeline' && (
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
                <div className="flex flex-wrap items-center gap-2">
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
                          className={`w-14 whitespace-nowrap py-2 text-xs font-medium active:opacity-70 ${
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
              </div>
            )}
            {mode === 'finance' && pendingReviewTx && (
              <button
                type="button"
                onClick={() =>
                  setReviewTargetId((prev) => (prev === pendingReviewTx.id ? null : pendingReviewTx.id))
                }
                className={`mb-2 w-full rounded-2xl border bg-base-surface p-3 text-left active:opacity-70 ${
                  reviewTargetId === pendingReviewTx.id ? 'border-base-text' : 'border-base-line'
                }`}
                aria-label="上一条记账待补点评"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-medium text-base-text">上一条记账待补点评</div>
                  <div className="text-xs text-base-muted">
                    {reviewTargetId === pendingReviewTx.id ? '正在补点评' : '点一下补'}
                  </div>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-base-muted">
                  <span>{pendingReviewTx.item_name_snapshot || pendingReviewTx.item_name || '（未识别 item）'}</span>
                  <span>·</span>
                  <span>{formatAmount(pendingReviewTx.amount)}</span>
                  <span>·</span>
                  <span>{formatCompactDateTime(pendingReviewTx.created_at)}</span>
                </div>
              </button>
            )}
            <section
              className="rounded-2xl border bg-base-surface p-3"
              style={composerBorder}
              aria-label="快速输入"
            >
              <div className="relative">
                <textarea
                  rows={2}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={
                    mode === 'finance' && pendingReviewTx && reviewTargetId === pendingReviewTx.id
                      ? '给上一条记账补充点评…'
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
                {mode !== 'finance' && mode !== 'note' && (
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
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v)
}

function parseAmountToken(token: string): number | null {
  const t = token.trim().replace(/[,，]/g, '')
  const m = t.match(/^(?:¥|￥)?(\d+(?:\.\d+)?)(?:元|块)?$/)
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) ? n : null
}

function extractAmount(source: string): { amount: number | null; rest: string } {
  const s = source.replace(/\u3000/g, ' ').replace(/\s+/g, ' ').trim()
  if (!s) return { amount: null, rest: '' }
  const parts = s.split(' ').filter(Boolean)
  if (parts.length === 0) return { amount: null, rest: '' }

  const leading = parseAmountToken(parts[0] ?? '')
  if (leading !== null) {
    return { amount: leading, rest: parts.slice(1).join(' ') }
  }

  const trailing = parseAmountToken(parts[parts.length - 1] ?? '')
  if (trailing !== null) {
    return { amount: trailing, rest: parts.slice(0, -1).join(' ') }
  }

  return { amount: null, rest: s }
}

function pickItemNameFallback(source: string): string | null {
  const tokens = source.split(/\s+/g).filter(Boolean)
  for (const token of tokens) {
    if (parseAmountToken(token) !== null) continue
    return token
  }
  return null
}

function formatCompactDateTime(iso: string) {
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

function formatAmount(amount: number | null) {
  if (amount === null || amount === undefined) return '—'
  if (!Number.isFinite(amount)) return '—'
  return `¥${amount.toFixed(2)}`
}

function RepurchaseIndexPill({
  value,
  onChange,
}: {
  value: number
  onChange: (v: number) => void
}) {
  const starsRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<{ pointerId: number | null }>({ pointerId: null })

  const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))
  const setFromClientX = (clientX: number) => {
    const el = starsRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const rel = clientX - rect.left
    const ratio = rect.width > 0 ? rel / rect.width : 0
    const next = clamp(Math.ceil(ratio * 5), 0, 5)
    onChange(next)
  }

  const handlePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    e.preventDefault()
    dragRef.current.pointerId = e.pointerId
    e.currentTarget.setPointerCapture(e.pointerId)
    setFromClientX(e.clientX)
  }

  const handlePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (dragRef.current.pointerId !== e.pointerId) return
    setFromClientX(e.clientX)
  }

  const endDrag = (e: PointerEvent<HTMLDivElement>) => {
    if (dragRef.current.pointerId !== e.pointerId) return
    dragRef.current.pointerId = null
  }

  return (
    <div
      className="flex select-none items-center gap-2 rounded-full border border-base-line bg-base-bg px-3 py-2 text-xs text-base-muted"
      role="group"
      aria-label="回购指数"
    >
      <span className="whitespace-nowrap">回购指数</span>
      <div
        ref={starsRef}
        className="flex items-center gap-1"
        role="slider"
        aria-label="回购指数评分"
        aria-valuemin={0}
        aria-valuemax={5}
        aria-valuenow={value}
        tabIndex={0}
        style={{ touchAction: 'none' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => {
          if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
            e.preventDefault()
            onChange(clamp(value - 1, 0, 5))
          }
          if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
            e.preventDefault()
            onChange(clamp(value + 1, 0, 5))
          }
          if (e.key === 'Home') {
            e.preventDefault()
            onChange(0)
          }
          if (e.key === 'End') {
            e.preventDefault()
            onChange(5)
          }
        }}
      >
        {Array.from({ length: 5 }, (_, i) => {
          const n = i + 1
          const selected = value >= n
          return (
            <Star
              key={n}
              size={14}
              strokeWidth={2}
              color={selected ? '#CFF3E5' : '#D1D5DB'}
              fill={selected ? '#CFF3E5' : 'none'}
            />
          )
        })}
      </div>
    </div>
  )
}

function extractDate(
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
