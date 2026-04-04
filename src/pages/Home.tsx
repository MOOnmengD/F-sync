import { Menu, Send } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
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
  const [keyboardOffset, setKeyboardOffset] = useState(0)
  const [toast, setToast] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

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

  useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(() => setToast(null), 1200)
    return () => window.clearTimeout(t)
  }, [toast])

  const financeCategories = useMemo(() => ['衣', '食', '住', '行', '娱乐'] as const, [])

  const sendFinance = async () => {
    const raw = text.trim()
    if (!raw) return

    if (!supabase) {
      setToast('先配置 Supabase URL/Key')
      return
    }

    if (sending) return
    setSending(true)
    try {
      const parsed = parseFinanceInput(raw)
      const payload: {
        type: string
        content: string
        amount?: number | null
        necessity?: boolean | null
        created_at?: string
      } = {
        type: modeMeta.finance.label,
        content: raw,
        amount: parsed.amount ?? null,
        necessity: necessity === null ? null : necessity === 'need',
      }

      if (parsed.date) {
        payload.created_at = new Date(
          parsed.date.year,
          parsed.date.month - 1,
          parsed.date.day,
          12,
          0,
          0,
          0,
        ).toISOString()
      }

      const { error } = await supabase.from('transactions').insert(payload)
      if (error) {
        setToast('写入失败')
        return
      }

      setText('')
      setCategory(null)
      setNecessity(null)
      setToast('已记录')
    } finally {
      setSending(false)
    }
  }

  const handleSend = () => {
    if (mode === 'finance') {
      void sendFinance()
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
            onClick={() => setMode('note')}
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
        <section
          className="rounded-2xl border bg-base-surface p-3"
          style={composerBorder}
          aria-label="快速输入"
        >
          {mode === 'finance' && (
            <div className="mb-2 flex flex-wrap items-center gap-2">
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
              <div className="h-4 w-px bg-base-line/80" />
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
                    className={`rounded-full border border-base-line px-3 py-1 text-xs active:opacity-70 ${
                      active ? 'text-base-text' : 'bg-transparent text-base-muted'
                    }`}
                    style={active ? chipActiveStyle : undefined}
                  >
                    {o.label}
                  </button>
                )
              })}
            </div>
          )}

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

          <div className="mt-2 flex items-center justify-between gap-3">
            <div className="text-xs text-base-muted">辅助选项</div>
            <div className="text-xs text-base-muted">仅静态 UI（Mock）</div>
          </div>

          <div className="mt-2 pb-[env(safe-area-inset-bottom)]">
            {mode === 'note' && (
              <div className="flex gap-2">
                {(['🙂', '😌', '😵‍💫'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMood(m)}
                    className={`rounded-full border border-base-line px-4 py-2 text-sm ${
                      mood === m ? 'bg-pastel-baby text-base-text' : 'bg-base-bg text-base-muted'
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            )}

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
    </div>
  )
}

function parseFinanceInput(input: string): {
  amount: number | null
  date: { year: number; month: number; day: number } | null
  item: string | null
  note: string | null
  review: string | null
} {
  const now = new Date()
  const normalized = input.replace(/\u3000/g, ' ').trim()

  const dateResult = extractDate(normalized, now)
  const amountResult = extractAmount(dateResult.rest)

  const rest = amountResult.rest.replace(/\s+/g, ' ').trim()
  const parts = rest ? rest.split(' ') : []
  const item = parts.length ? parts[0] : null
  const tail = parts.slice(1).join(' ').trim() || null
  const { note, review } = splitNoteAndReview(tail)

  return {
    amount: amountResult.amount,
    date: dateResult.date,
    item,
    note,
    review,
  }
}

function extractAmount(source: string): { amount: number | null; rest: string } {
  const tokens = source.split(/\s+/g).filter(Boolean)
  let amountTokenIndex = -1
  for (let i = tokens.length - 1; i >= 0; i -= 1) {
    const t = tokens[i]
    if (/[年月日]/.test(t)) continue
    if (!/[0-9]/.test(t)) continue
    if (!/^(?:[¥￥])?\d+(?:\.\d{1,2})?(?:元|块)?$/.test(t)) continue
    amountTokenIndex = i
    break
  }

  if (amountTokenIndex === -1) return { amount: null, rest: source }

  const raw = tokens[amountTokenIndex].replace(/[¥￥元块]/g, '')
  const amount = Number(raw)
  if (!Number.isFinite(amount)) return { amount: null, rest: source }

  const restTokens = [...tokens.slice(0, amountTokenIndex), ...tokens.slice(amountTokenIndex + 1)]
  return { amount, rest: restTokens.join(' ') }
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

function splitNoteAndReview(
  tail: string | null,
): { note: string | null; review: string | null } {
  if (!tail) return { note: null, review: null }
  const cut = tail.match(/(.*?)(?:[，,。.!！?？;；:：]\s*)(.+)$/)
  if (!cut) return { note: tail, review: null }
  const note = cut[1].trim() || null
  const review = cut[2].trim() || null
  return { note, review }
}
