import { Menu } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabaseClient'
import { IconButton } from '../shared/ui/IconButton'
import { useUi } from '../store/ui'

type TimelineKind = '睡眠' | '生活' | '工作' | '娱乐'

type TimingType = 'sleep' | 'life' | 'work' | 'play'

function pad2(n: number) {
  return String(n).padStart(2, '0')
}

function formatDurationHm(ms: number) {
  const totalMin = Math.max(0, Math.floor(ms / 60000))
  const hh = Math.floor(totalMin / 60)
  const mm = totalMin % 60
  return `${pad2(hh)}:${pad2(mm)} 时分`
}

export default function Timeline() {
  const toggleDrawer = useUi((s) => s.toggleDrawer)
  const accent = '#F2DEBD'
  const storageKey = 'fsync.timeline.active.v1'

  const kinds = useMemo(() => ['睡眠', '生活', '工作', '娱乐'] as const, [])
  const [kind, setKind] = useState<TimelineKind | null>(null)

  const [running, setRunning] = useState(false)
  const [startAt, setStartAt] = useState<number | null>(null)
  const [tick, setTick] = useState(0)
  const [toast, setToast] = useState<string | null>(null)

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
    if (!running) return
    const id = window.setInterval(() => setTick((t) => t + 1), 1000)
    return () => window.clearInterval(id)
  }, [running])

  useEffect(() => {
    if (!toast) return
    const id = window.setTimeout(() => setToast(null), 1200)
    return () => window.clearTimeout(id)
  }, [toast])

  useEffect(() => {
    const raw = localStorage.getItem(storageKey)
    if (!raw) return
    try {
      const parsed = JSON.parse(raw) as { timing_type?: unknown; start_time?: unknown } | null
      const timingType = typeof parsed?.timing_type === 'string' ? parsed.timing_type : ''
      const startTime = typeof parsed?.start_time === 'string' ? parsed.start_time : ''
      if (!timingType || !startTime) {
        localStorage.removeItem(storageKey)
        return
      }
      if (!['sleep', 'life', 'work', 'play'].includes(timingType)) {
        localStorage.removeItem(storageKey)
        return
      }
      const ms = Date.parse(startTime)
      if (!Number.isFinite(ms)) {
        localStorage.removeItem(storageKey)
        return
      }

      setKind(kindByTimingType[timingType as TimingType])
      setStartAt(ms)
      setRunning(true)
    } catch {
      localStorage.removeItem(storageKey)
    }
  }, [kindByTimingType])

  const currentElapsedMs = useMemo(() => {
    if (!running || startAt === null) return 0
    return Math.max(0, Date.now() - startAt)
  }, [running, startAt, tick])

  const durationLabel = useMemo(() => formatDurationHm(currentElapsedMs), [currentElapsedMs])

  const writeTiming = async (input: { timingType: TimingType; startMs: number; endMs: number }) => {
    const client = supabase
    if (!client) {
      setToast('未配置 Supabase')
      return false
    }
    const duration = Math.max(0, Math.floor((input.endMs - input.startMs) / 1000))
    const payload = {
      type: 'timing',
      content: '',
      timing_type: input.timingType,
      start_time: new Date(input.startMs).toISOString(),
      end_time: new Date(input.endMs).toISOString(),
      duration,
    }

    console.log('[Timeline] writeTiming payload:', JSON.stringify(payload, null, 2))

    const { error, data } = await client.from('transactions').insert(payload).select()
    console.log('[Timeline] writeTiming response - error:', error)
    console.log('[Timeline] writeTiming response - data:', data)

    if (error) {
      const msg = error.message || error.details || error.hint || '写入失败'
      console.error('[Timeline] writeTiming failed:', msg, error)
      setToast(msg)
      return false
    }
    return true
  }

  const handleStart = () => {
    if (running) return
    if (!kind) {
      setToast('请先选择计时类型')
      return
    }
    const now = Date.now()
    const timingType = timingTypeByKind[kind]
    localStorage.setItem(storageKey, JSON.stringify({ timing_type: timingType, start_time: new Date(now).toISOString() }))
    setStartAt(now)
    setRunning(true)
  }

  const handleStop = () => {
    if (!running || startAt === null) return
    setRunning(false)
    setStartAt(null)
    localStorage.removeItem(storageKey)

    if (!kind) return
    const endMs = Date.now()
    const timingType = timingTypeByKind[kind]
    void (async () => {
      await writeTiming({ timingType, startMs: startAt, endMs })
    })()
  }

  const handleCancel = () => {
    if (!running) return
    setRunning(false)
    setStartAt(null)
    setKind(null)
    localStorage.removeItem(storageKey)
  }

  const kindBtnBase =
    'rounded-full border border-base-line px-4 py-2 text-sm active:opacity-70'
  const ctrlBtnBase =
    'rounded-full border border-base-line bg-base-bg px-4 py-2 text-sm text-base-text active:opacity-70 whitespace-nowrap disabled:opacity-40 disabled:active:opacity-40'

  return (
    <div className="mx-auto min-h-dvh max-w-[480px] bg-base-bg px-4 pb-[220px] text-base-text">
      <header className="sticky top-0 z-20 -mx-4 bg-base-bg/95 px-4 pb-3 pt-4 backdrop-blur-sm">
        <div className="flex items-center justify-between">
          <IconButton label="打开导航" onClick={toggleDrawer} icon={<Menu size={18} />} />
          <div className="text-sm font-medium text-base-text">时间轴</div>
          <div className="h-10 w-10" />
        </div>
      </header>

      {!supabase && (
        <div className="mt-4 rounded-2xl border border-base-line bg-base-surface p-4 text-sm text-base-muted">
          未配置 Supabase（请设置 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY）
        </div>
      )}

      <div
        className="fixed left-1/2 z-40 w-full max-w-[480px] -translate-x-1/2 px-4"
        style={{ bottom: 'calc(env(safe-area-inset-bottom) + 1rem)' }}
      >
        <div className="rounded-2xl border border-base-line bg-base-surface p-3">
          <div className="grid grid-cols-4 gap-2">
            {kinds.map((k) => {
              const active = kind === k
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => {
                    if (!running) {
                      setKind(active ? null : k)
                      return
                    }
                    if (k === kind) return
                    if (!kind || startAt === null) {
                      const now = Date.now()
                      setKind(k)
                      setStartAt(now)
                      localStorage.setItem(
                        storageKey,
                        JSON.stringify({ timing_type: timingTypeByKind[k], start_time: new Date(now).toISOString() }),
                      )
                      return
                    }

                    const prevKind = kind
                    const prevStartAt = startAt
                    const now = Date.now()

                    setKind(k)
                    setStartAt(now)
                    localStorage.setItem(
                      storageKey,
                      JSON.stringify({ timing_type: timingTypeByKind[k], start_time: new Date(now).toISOString() }),
                    )
                    void (async () => {
                      await writeTiming({
                        timingType: timingTypeByKind[prevKind],
                        startMs: prevStartAt,
                        endMs: now,
                      })
                    })()
                  }}
                  className={`${kindBtnBase} ${active ? 'text-base-text' : 'bg-transparent text-base-muted'}`}
                  style={active ? { backgroundColor: accent } : undefined}
                >
                  {k}
                </button>
              )
            })}
          </div>

          <div className="mt-3 flex items-center gap-2">
            <button type="button" onClick={handleStart} className={ctrlBtnBase} disabled={running}>
              开始
            </button>

            <div className="min-w-0 flex-1 text-center text-sm font-bold" style={{ color: '#E49F5E' }}>
              {durationLabel}
            </div>

            <button type="button" onClick={handleStop} className={ctrlBtnBase} disabled={!running}>
              停止
            </button>

            <button type="button" onClick={handleCancel} className={ctrlBtnBase} disabled={!running}>
              取消计时
            </button>
          </div>
        </div>
      </div>

      {toast && (
        <div
          className="fixed left-1/2 z-50 -translate-x-1/2 rounded-full border border-base-line bg-base-surface/95 px-4 py-2 text-xs text-base-text backdrop-blur-sm"
          style={{ bottom: 'calc(env(safe-area-inset-bottom) + 96px)' }}
          role="status"
          aria-live="polite"
        >
          {toast}
        </div>
      )}
    </div>
  )
}
