import { Menu, Send } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../supabaseClient'
import { useUi } from '../store/ui'
import type { QuickMode } from '../types/domain'
import { IconButton } from '../shared/ui/IconButton'
import { PillButton } from '../shared/ui/PillButton'

const modeMeta: Record<
  QuickMode,
  { label: string; accent: 'peach' | 'mint' | 'baby' | 'butter' | 'lavender'; hint: string }
> = {
  finance: { label: '记账', accent: 'mint', hint: '今天花了多少？一句话记下来' },
  review: { label: '点评', accent: 'peach', hint: '对一个物品/服务写一句感受' },
  note: { label: '碎碎念', accent: 'baby', hint: '写点当下的想法，不用完整' },
  work: { label: '工作', accent: 'butter', hint: '记录推进点 / blockers / 下一步' },
  save: { label: '收藏', accent: 'lavender', hint: '保存链接/片段，稍后再整理' },
}

const accentHex: Record<(typeof modeMeta)[QuickMode]['accent'], string> = {
  peach: '#FAD9D2',
  mint: '#CFF3E5',
  baby: '#D7E8FF',
  butter: '#FFF1B8',
  lavender: '#E9D9FF',
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

  const composerBorder = useMemo(() => ({ borderColor: accentHex[meta.accent] }), [meta.accent])
  const sendStyle = useMemo(
    () => ({ backgroundColor: accentHex[meta.accent], borderColor: accentHex[meta.accent] }),
    [meta.accent],
  )
  const chipActiveStyle = useMemo(() => ({ backgroundColor: accentHex[modeMeta.finance.accent] }), [])
  const noteMoodActiveStyle = useMemo(() => ({ backgroundColor: accentHex[modeMeta.note.accent] }), [])

  useEffect(() => {
    if (!toast) return
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

  const sendTransaction = async () => {
    const raw = text.trim()
    if (!raw) return

    if (!supabase) {
      setToast('先配置 Supabase URL/Key')
      return
    }

    if (sending) return
    setSending(true)
    try {
      const normalized = raw.replace(/\u3000/g, ' ').trim()
      const dateResult = extractDate(normalized, new Date())
      const aiInput = dateResult.rest.trim()
      if (!aiInput) {
        setToast('请输入内容')
        return
      }

      const parsed = await parseTransactionByAi(aiInput)
      const itemName = parsed.item_name?.trim() || aiInput.split(/\s+/g).filter(Boolean)[0] || null
      if (!itemName) {
        setToast('AI 未解析出 item_name')
        return
      }

      const metadata = { brand: parsed.brand, details: parsed.details }

      const { data: existingItem, error: findError } = await supabase
        .from('items')
        .select('id')
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
            last_review: parsed.review ?? null,
            metadata,
          })
          .select('id')
          .single()

        if (createError) {
          setToast(createError.message || '创建 item 失败')
          return
        }
        itemId = created?.id ? String(created.id) : null
      } else {
        const { error: updateError } = await supabase
          .from('items')
          .update({
            last_review: parsed.review ?? null,
            metadata,
          })
          .eq('id', itemId)

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
        content: raw,
        amount: parsed.amount ?? null,
        item_id: itemId,
      }
      if (mode === 'finance') {
        payload.necessity = necessity === null ? null : necessity === 'need'
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

      setText('')
      setCategory(null)
      setNecessity(null)
      setToast('已记录')
    } catch (e: any) {
      setToast(String(e?.message ?? e) || 'AI 解析失败')
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

      setText('')
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
          </div>
        </div>
      </header>

      <div className="mt-4 text-sm text-base-muted">{meta.hint}</div>

      <div
        className="fixed left-1/2 z-40 w-full max-w-[480px] -translate-x-1/2 px-4"
        style={{ bottom: keyboardOffset }}
      >
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

            <div className="mt-2">
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
            </div>
          </div>
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
              placeholder={`在「${meta.label}」里输入…`}
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
                className="h-11 flex-1 rounded-xl border border-base-line bg-base-bg px-3 text-base-text focus:outline-none"
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
