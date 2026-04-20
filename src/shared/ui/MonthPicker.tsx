import { useEffect, useMemo, useRef, useState } from 'react'
import { parseMonthKey, toMonthKey } from '../../utils/dateUtils'
import type { MonthKey } from '../../utils/dateUtils'

type Props = {
  monthKey: MonthKey
  setMonthKey: (key: MonthKey) => void
  open: boolean
  setOpen: (open: boolean) => void
}

export function MonthPicker({ monthKey, setMonthKey, open, setOpen }: Props) {
  const nowYear = useMemo(() => new Date().getFullYear(), [])
  const yearOptions = useMemo(() => [nowYear, nowYear - 1], [nowYear])
  const monthOptions = useMemo(() => Array.from({ length: 12 }, (_, i) => i + 1), [])
  const wheel = useMemo(() => ({ itemH: 44, viewH: 220 }), [])
  const wheelPad = useMemo(() => Math.max(0, Math.floor((wheel.viewH - wheel.itemH) / 2)), [wheel])

  const yearWheelRef = useRef<HTMLDivElement | null>(null)
  const monthWheelRef = useRef<HTMLDivElement | null>(null)
  const yearRafRef = useRef<number | null>(null)
  const monthRafRef = useRef<number | null>(null)
  const yearSnapRef = useRef<number | null>(null)
  const monthSnapRef = useRef<number | null>(null)

  const [pickerYearIndex, setPickerYearIndex] = useState(0)
  const [pickerMonthIndex, setPickerMonthIndex] = useState(0)

  const clampIndex = (value: number, max: number) => Math.min(Math.max(0, value), Math.max(0, max))
  const scrollToIndex = (el: HTMLDivElement | null, idx: number) => {
    if (!el) return
    el.scrollTo({ top: idx * wheel.itemH, behavior: 'smooth' })
  }

  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, setOpen])

  useEffect(() => {
    if (!open) return
    const { year, month } = parseMonthKey(monthKey)
    const yIdx = clampIndex(yearOptions.indexOf(year), yearOptions.length - 1)
    const mIdx = clampIndex(month - 1, monthOptions.length - 1)
    setPickerYearIndex(yIdx)
    setPickerMonthIndex(mIdx)
    const id = window.requestAnimationFrame(() => {
      if (yearWheelRef.current) yearWheelRef.current.scrollTop = yIdx * wheel.itemH
      if (monthWheelRef.current) monthWheelRef.current.scrollTop = mIdx * wheel.itemH
    })
    return () => window.cancelAnimationFrame(id)
  }, [open, monthKey, monthOptions.length, yearOptions, wheel.itemH])

  useEffect(() => {
    if (!open) return
    return () => {
      if (yearRafRef.current) window.cancelAnimationFrame(yearRafRef.current)
      if (monthRafRef.current) window.cancelAnimationFrame(monthRafRef.current)
      if (yearSnapRef.current) window.clearTimeout(yearSnapRef.current)
      if (monthSnapRef.current) window.clearTimeout(monthSnapRef.current)
      yearRafRef.current = null
      monthRafRef.current = null
      yearSnapRef.current = null
      monthSnapRef.current = null
    }
  }, [open])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50" aria-label="月份选择器">
      <button
        type="button"
        className="absolute inset-0 bg-black/20"
        aria-label="关闭月份选择器"
        onClick={() => setOpen(false)}
      />
      <div className="absolute left-1/2 top-[calc(env(safe-area-inset-top)+4.5rem)] w-[calc(100%-2rem)] max-w-[440px] -translate-x-1/2 rounded-2xl border border-base-line bg-[#FDFCFB] p-3">
        <div className="grid grid-cols-[1fr_1fr_auto] items-center gap-2 px-1">
          <div className="text-xs font-medium text-base-muted">年份</div>
          <div className="text-xs font-medium text-base-muted">月份</div>
          <button
            type="button"
            onClick={() => {
              const year = yearOptions[clampIndex(pickerYearIndex, yearOptions.length - 1)] ?? nowYear
              const month = monthOptions[clampIndex(pickerMonthIndex, monthOptions.length - 1)] ?? 1
              setMonthKey(toMonthKey(year, month))
              setOpen(false)
            }}
            className="rounded-2xl border border-base-line bg-pastel-mint px-4 py-2 text-sm font-medium text-base-text active:opacity-70"
          >
            确定
          </button>
        </div>

        <div className="relative mt-3 grid grid-cols-2 gap-2">
          <div className="relative">
            <div
              className="pointer-events-none absolute left-2 right-2 top-1/2 z-10 -translate-y-1/2 rounded-2xl border border-base-line bg-[#F7F5F2]/40"
              style={{ height: wheel.itemH }}
            />
            <div
              ref={yearWheelRef}
              className="overflow-y-auto snap-y snap-mandatory [-webkit-overflow-scrolling:touch] [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              style={{ height: wheel.viewH, paddingTop: wheelPad, paddingBottom: wheelPad }}
              onScroll={(e) => {
                const el = e.currentTarget
                if (yearRafRef.current) window.cancelAnimationFrame(yearRafRef.current)
                yearRafRef.current = window.requestAnimationFrame(() => {
                  const nextIdx = clampIndex(Math.round(el.scrollTop / wheel.itemH), yearOptions.length - 1)
                  setPickerYearIndex(nextIdx)
                })
                if (yearSnapRef.current) window.clearTimeout(yearSnapRef.current)
                yearSnapRef.current = window.setTimeout(() => {
                  const idx = clampIndex(Math.round(el.scrollTop / wheel.itemH), yearOptions.length - 1)
                  scrollToIndex(el, idx)
                }, 120)
              }}
            >
              {yearOptions.map((y, idx) => {
                const active = idx === pickerYearIndex
                return (
                  <div
                    key={y}
                    className={`mx-2 flex snap-center items-center justify-center rounded-2xl ${
                      active ? 'bg-pastel-mint text-lg font-semibold text-base-text' : 'text-sm text-base-muted'
                    }`}
                    style={{ height: wheel.itemH }}
                  >
                    {y}年
                  </div>
                )
              })}
            </div>
          </div>

          <div className="relative">
            <div
              className="pointer-events-none absolute left-2 right-2 top-1/2 z-10 -translate-y-1/2 rounded-2xl border border-base-line bg-[#F7F5F2]/40"
              style={{ height: wheel.itemH }}
            />
            <div
              ref={monthWheelRef}
              className="overflow-y-auto snap-y snap-mandatory [-webkit-overflow-scrolling:touch] [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              style={{ height: wheel.viewH, paddingTop: wheelPad, paddingBottom: wheelPad }}
              onScroll={(e) => {
                const el = e.currentTarget
                if (monthRafRef.current) window.cancelAnimationFrame(monthRafRef.current)
                monthRafRef.current = window.requestAnimationFrame(() => {
                  const nextIdx = clampIndex(Math.round(el.scrollTop / wheel.itemH), monthOptions.length - 1)
                  setPickerMonthIndex(nextIdx)
                })
                if (monthSnapRef.current) window.clearTimeout(monthSnapRef.current)
                monthSnapRef.current = window.setTimeout(() => {
                  const idx = clampIndex(Math.round(el.scrollTop / wheel.itemH), monthOptions.length - 1)
                  scrollToIndex(el, idx)
                }, 120)
              }}
            >
              {monthOptions.map((m, idx) => {
                const active = idx === pickerMonthIndex
                return (
                  <div
                    key={m}
                    className={`mx-2 flex snap-center items-center justify-center rounded-2xl ${
                      active ? 'bg-pastel-mint text-lg font-semibold text-base-text' : 'text-sm text-base-muted'
                    }`}
                    style={{ height: wheel.itemH }}
                  >
                    {m}月
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
