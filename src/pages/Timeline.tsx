import { Menu } from 'lucide-react'
import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { IconButton } from '../shared/ui/IconButton'
import { useUi } from '../store/ui'
import { useTimeline, TIMELINE_KINDS } from '../hooks/useTimeline'

export default function Timeline() {
  const toggleDrawer = useUi((s) => s.toggleDrawer)
  const accent = '#F2DEBD'

  const [toast, setToast] = useState<string | null>(null)

  const { kind, running, durationLabel, handleStart, handleStop, handleCancel, handleKindChange } =
    useTimeline(setToast)

  useEffect(() => {
    if (!toast) return
    const id = window.setTimeout(() => setToast(null), 1200)
    return () => window.clearTimeout(id)
  }, [toast])

  const kindBtnBase = 'rounded-full border border-base-line px-4 py-2 text-sm active:opacity-70'
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
            {TIMELINE_KINDS.map((k) => {
              const active = kind === k
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => handleKindChange(k)}
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
