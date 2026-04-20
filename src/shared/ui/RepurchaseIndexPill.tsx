import { useRef } from 'react'
import { Star } from 'lucide-react'
import type { KeyboardEvent, PointerEvent } from 'react'

export function RepurchaseIndexPill({
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
