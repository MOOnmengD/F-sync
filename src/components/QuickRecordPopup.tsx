import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Send } from 'lucide-react'
import type { QuickMode } from '../types/domain'
import { PillButton } from '../shared/ui/PillButton'
import { RepurchaseIndexPill } from '../shared/ui/RepurchaseIndexPill'
import { useTimeline, TIMELINE_KINDS } from '../hooks/useTimeline'
import { useRecordSender } from '../hooks/useRecordSender'

const modeMeta: Record<
  QuickMode,
  { label: string; accent: 'peach' | 'mint' | 'baby' | 'butter' | 'lavender' | 'timeline' | 'rose' }
> = {
  finance: { label: '记账', accent: 'mint' },
  review: { label: '点评', accent: 'peach' },
  note: { label: '碎碎念', accent: 'baby' },
  work: { label: '工作', accent: 'butter' },
  save: { label: '收藏', accent: 'lavender' },
  timeline: { label: '时间轴', accent: 'timeline' },
  invest: { label: '理财', accent: 'rose' },
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

type FinanceCategory = '衣' | '食' | '住' | '行' | '娱乐'
const FINANCE_CATEGORIES: FinanceCategory[] = ['衣', '食', '住', '行', '娱乐']
const BASE_MOODS = ['😐', '🥰', '😔', '🤬', '😖'] as const

interface QuickRecordPopupProps {
  open: boolean
  initialMode: QuickMode
  onClose: () => void
}

export function QuickRecordPopup({ open, initialMode, onClose }: QuickRecordPopupProps) {
  const meta = modeMeta[initialMode]
  const accent = accentHex[meta.accent]

  // ---- shared state ----
  const [text, setText] = useState('')
  const [toast, setToast] = useState<string | null>(null)
  const [animOpen, setAnimOpen] = useState(false)

  // ---- finance state ----
  const [category, setCategory] = useState<FinanceCategory | null>(null)
  const [necessity, setNecessity] = useState<'need' | 'want' | null>(null)
  const [repurchaseIndex, setRepurchaseIndex] = useState(0)

  // ---- note state ----
  const [mood, setMood] = useState('😐')
  const [customMoods, setCustomMoods] = useState<string[]>([])
  const [customMoodOpen, setCustomMoodOpen] = useState(false)
  const [customMoodDraft, setCustomMoodDraft] = useState('')
  const customMoodInputRef = useRef<HTMLInputElement | null>(null)

  // ---- enter animation ----
  useEffect(() => {
    if (open) {
      const id = requestAnimationFrame(() => {
        requestAnimationFrame(() => setAnimOpen(true))
      })
      return () => cancelAnimationFrame(id)
    } else {
      setAnimOpen(false)
    }
  }, [open])

  // ---- reset state when opening ----
  useEffect(() => {
    if (open) {
      setText('')
      setCategory(null)
      setNecessity(null)
      setRepurchaseIndex(0)
      setMood('😐')
      setToast(null)
      setCustomMoodOpen(false)
    }
  }, [open, initialMode])

  // ---- toast auto-dismiss ----
  useEffect(() => {
    if (!toast) return
    if (toast === '记录中…') return
    const t = window.setTimeout(() => setToast(null), 1200)
    return () => window.clearTimeout(t)
  }, [toast])

  // ---- custom mood auto-focus ----
  useEffect(() => {
    if (!customMoodOpen) return
    const id = window.requestAnimationFrame(() => {
      customMoodInputRef.current?.focus()
      customMoodInputRef.current?.select()
    })
    return () => window.cancelAnimationFrame(id)
  }, [customMoodOpen])

  const commitCustomMood = useCallback(() => {
    const trimmed = customMoodDraft.trim()
    if (!trimmed) return
    setCustomMoods((prev) => (prev.includes(trimmed) ? prev : [...prev, trimmed]))
    setMood(trimmed)
    setCustomMoodOpen(false)
  }, [customMoodDraft])

  // ---- callbacks ----
  const handleRecordSaved = useCallback(() => {
    onClose()
  }, [onClose])

  const { sending, sendTransaction, sendWhisper, sendSimple } = useRecordSender(
    setToast,
    handleRecordSaved,
  )

  const {
    kind: timelineKind,
    running: timelineRunning,
    durationLabel: timelineDurationLabel,
    handleStart,
    handleStop,
    handleCancel,
    handleKindChange,
  } = useTimeline(setToast, handleRecordSaved)

  // ---- send handler ----
  const handleSend = useCallback(async () => {
    if (initialMode === 'note') {
      const raw = text
      setText('')
      const ok = await sendWhisper({ raw, mood })
      if (!ok) setText(raw)
      return
    }

    if (initialMode === 'finance' || initialMode === 'review') {
      const raw = text
      setText('')
      const ok = await sendTransaction({
        mode: initialMode,
        raw,
        category,
        necessity,
        repurchaseIndex,
      })
      if (!ok) setText(raw)
      return
    }

    // work / save
    setText('')
    sendSimple()
  }, [
    initialMode,
    text,
    mood,
    category,
    necessity,
    repurchaseIndex,
    sendTransaction,
    sendWhisper,
    sendSimple,
  ])

  // ---- mood options ----
  const moodOptions = useMemo(() => [...BASE_MOODS, ...customMoods], [customMoods])

  const sendStyle = useMemo(() => ({ backgroundColor: accent, borderColor: accent }), [accent])
  const composerBorder = useMemo(() => ({ borderColor: accent }), [accent])

  if (!open) return null

  return (
    <div
      className={`fixed inset-0 z-50 transition-opacity duration-300 ease-out ${
        animOpen ? 'opacity-100' : 'opacity-0'
      }`}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/20" onClick={onClose} />

      {/* Sheet */}
      <div
        className={`absolute bottom-0 left-0 right-0 max-w-[480px] mx-auto transition-transform duration-300 ease-out ${
          animOpen ? 'translate-y-0' : 'translate-y-full'
        }`}
        style={{ transitionTimingFunction: 'cubic-bezier(0.32, 0.72, 0, 1)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="rounded-t-2xl bg-base-surface px-4 pt-3 pb-6 max-h-[85vh] overflow-y-auto border border-base-line border-b-0">
          {/* Drag handle */}
          <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-base-line" />

          {/* Mode title */}
          <div className="text-center text-sm font-medium text-base-text mb-4">
            在「{meta.label}」里输入…
          </div>

          {initialMode === 'timeline' ? (
            /* ======== Timeline Controls ======== */
            <div className="flex flex-col items-center gap-4">
              {/* Kind selector */}
              <div className="grid grid-cols-2 gap-2 w-full max-w-[240px]">
                {TIMELINE_KINDS.map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => handleKindChange(k)}
                    disabled={timelineRunning && timelineKind !== k}
                    className={`rounded-full px-4 py-2 text-sm border border-base-line transition-colors ${
                      timelineKind === k ? 'text-base-text' : 'text-base-muted bg-base-bg'
                    }`}
                    style={
                      timelineKind === k ? { backgroundColor: accent } : undefined
                    }
                  >
                    {k}
                  </button>
                ))}
              </div>

              {/* Timer display */}
              <div className="text-2xl font-mono tracking-wider text-base-text tabular-nums">
                {timelineRunning ? timelineDurationLabel : '00:00:00'}
              </div>

              {/* Controls */}
              <div className="flex items-center gap-3">
                {!timelineRunning ? (
                  <button
                    type="button"
                    onClick={handleStart}
                    className="rounded-full px-6 py-2 text-sm font-medium text-base-text border border-base-line active:opacity-70"
                    style={{ backgroundColor: accent }}
                  >
                    开始
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={handleStop}
                      className="rounded-full px-5 py-2 text-sm font-medium text-base-text border border-base-line active:opacity-70"
                      style={{ backgroundColor: accent }}
                    >
                      停止
                    </button>
                    <button
                      type="button"
                      onClick={handleCancel}
                      className="rounded-full px-5 py-2 text-sm text-base-muted border border-base-line active:opacity-70 bg-base-bg"
                    >
                      取消
                    </button>
                  </>
                )}
              </div>
            </div>
          ) : (
            /* ======== Non-timeline modes ======== */
            <>
              {/* ---- Finance sub-controls ---- */}
              {initialMode === 'finance' && (
                <div className="flex flex-col gap-3 mb-3">
                  {/* Category pills */}
                  <div className="flex items-center justify-center gap-1.5 flex-wrap">
                    {FINANCE_CATEGORIES.map((cat) => (
                      <PillButton
                        key={cat}
                        label={cat}
                        active={category === cat}
                        onClick={() => setCategory(category === cat ? null : cat)}
                        accent="mint"
                      />
                    ))}
                  </div>

                  {/* Necessity toggle */}
                  <div className="flex items-center justify-center gap-2">
                    <span className="text-xs text-base-muted">必需性</span>
                    <div className="inline-flex items-center rounded-full border border-base-line bg-base-bg p-1">
                      <button
                        type="button"
                        onClick={() => setNecessity(necessity === 'need' ? null : 'need')}
                        className={`rounded-full px-3 py-1 text-xs ${
                          necessity === 'need' ? 'text-base-text' : 'text-base-muted'
                        }`}
                        style={
                          necessity === 'need'
                            ? { backgroundColor: accentHex.mint }
                            : undefined
                        }
                      >
                        必需
                      </button>
                      <button
                        type="button"
                        onClick={() => setNecessity(necessity === 'want' ? null : 'want')}
                        className={`rounded-full px-3 py-1 text-xs ${
                          necessity === 'want' ? 'text-base-text' : 'text-base-muted'
                        }`}
                        style={
                          necessity === 'want'
                            ? { backgroundColor: accentHex.peach }
                            : undefined
                        }
                      >
                        非必需
                      </button>
                    </div>
                  </div>

                  {/* Repurchase index */}
                  <div className="flex justify-center">
                    <RepurchaseIndexPill
                      value={repurchaseIndex}
                      onChange={setRepurchaseIndex}
                    />
                  </div>
                </div>
              )}

              {/* ---- Note sub-controls ---- */}
              {initialMode === 'note' && (
                <div className="flex flex-col gap-3 mb-3">
                  {/* Mood buttons */}
                  <div className="flex items-center justify-center gap-1.5 flex-wrap">
                    {moodOptions.map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setMood(m)}
                        className={`w-10 h-10 flex items-center justify-center rounded-full text-lg border border-base-line transition-colors ${
                          mood === m ? 'text-base-text' : 'text-base-muted'
                        }`}
                        style={
                          mood === m
                            ? { backgroundColor: accentHex.baby }
                            : undefined
                        }
                      >
                        {m}
                      </button>
                    ))}
                    {/* Add custom mood */}
                    <button
                      type="button"
                      onClick={() => {
                        setCustomMoodDraft(mood)
                        setCustomMoodOpen(true)
                      }}
                      className="w-10 h-10 flex items-center justify-center rounded-full text-lg text-base-muted border border-dashed border-base-line hover:border-base-text/30 transition-colors"
                    >
                      ＋
                    </button>
                  </div>

                  {/* Custom mood dialog */}
                  {customMoodOpen && (
                    <div
                      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 backdrop-blur-sm"
                      onClick={() => setCustomMoodOpen(false)}
                    >
                      <div
                        className="bg-base-bg rounded-2xl px-6 py-5 border border-base-line w-[280px]"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          ref={customMoodInputRef}
                          type="text"
                          value={customMoodDraft}
                          onChange={(e) => setCustomMoodDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') commitCustomMood()
                            if (e.key === 'Escape') setCustomMoodOpen(false)
                          }}
                          placeholder="输入 emoji 或文字"
                          className="w-full bg-transparent text-center text-lg border-b border-base-line pb-1 mb-4 outline-none text-base-text placeholder:text-base-muted"
                        />
                        <div className="flex justify-center gap-3">
                          <button
                            type="button"
                            onClick={() => setCustomMoodOpen(false)}
                            className="rounded-full px-4 py-1.5 text-xs text-base-muted border border-base-line"
                          >
                            取消
                          </button>
                          <button
                            type="button"
                            onClick={commitCustomMood}
                            className="rounded-full px-4 py-1.5 text-xs text-base-text border border-base-line"
                            style={{ backgroundColor: accentHex.baby }}
                          >
                            确定
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ---- Composer (textarea + send) ---- */}
              <div
                className="flex items-end gap-2 rounded-2xl border bg-base-bg px-3 py-2"
                style={composerBorder}
              >
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      if (!sending && text.trim()) handleSend()
                    }
                  }}
                  rows={2}
                  placeholder={
                    initialMode === 'finance'
                      ? '花了多少？买了什么？'
                      : initialMode === 'review'
                        ? '写一句评价…'
                        : initialMode === 'note'
                          ? '写点当下的想法…'
                          : initialMode === 'work'
                            ? '记录推进点…'
                            : '记录想保存的内容…'
                  }
                  disabled={sending}
                  className="flex-1 resize-none bg-transparent text-sm text-base-text placeholder:text-base-muted outline-none min-h-[44px]"
                />
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={sending || !text.trim()}
                  aria-label="发送"
                  className="flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-full transition-opacity active:opacity-70"
                  style={{
                    ...sendStyle,
                    opacity: sending || !text.trim() ? 0.3 : 1,
                  }}
                >
                  <Send size={16} className="text-white" />
                </button>
              </div>

              {/* ---- Toast ---- */}
              {toast && (
                <div
                  className="mt-3 text-center text-xs text-base-muted"
                  role="status"
                  aria-live="polite"
                >
                  {toast}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
