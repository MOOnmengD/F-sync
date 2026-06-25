import { useEffect, useRef } from 'react'
import { formatAmount } from '../utils/amountUtils'
import {
  formatCalendarAmount,
  type FinanceCalendarDay,
  type FinanceDayRecord,
  type FinanceSummary,
} from '../utils/financeDashboard'

const levelColors: Record<FinanceCalendarDay['colorLevel'], string> = {
  0: '#F7F5F2',
  1: '#E9F8F2',
  2: '#CFF3E5',
  3: '#A5E7D2',
  4: '#6FD1B2',
}

export function FinanceDashboard({
  monthLabel,
  summary,
  calendarDays,
  selectedDayKey,
  selectedDayRecords,
  loading,
  errorText,
  onSelectDay,
}: {
  monthLabel: string
  summary: FinanceSummary
  calendarDays: FinanceCalendarDay[]
  selectedDayKey: string
  selectedDayRecords: FinanceDayRecord[]
  loading: boolean
  errorText: string | null
  onSelectDay: (dayKey: string) => void
}) {
  const recordsRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (recordsRef.current) recordsRef.current.scrollTop = 0
  }, [selectedDayKey])

  return (
    <section className="mt-1.5 space-y-1.5" aria-label="本月消费面板">
      <div className="grid grid-cols-3 gap-1.5">
        <SummaryCell label="必需支出" amount={summary.necessary} />
        <SummaryCell label="本月总支出" amount={summary.total} emphasized />
        <SummaryCell label="非必需支出" amount={summary.nonNecessary} />
      </div>

      <div className="rounded-2xl border border-[#D7EEE6] bg-base-surface px-2.5 pb-2.5 pt-2">
        <div className="mb-2 text-center text-sm font-semibold text-base-text">{monthLabel}</div>
        <div className="grid grid-cols-7 gap-1.5">
          {calendarDays.map((cell, index) => {
            if (!cell.dayKey || cell.day === null) {
              return <div key={`empty-${index}`} className="h-10" aria-hidden="true" />
            }
            const selected = selectedDayKey === cell.dayKey
            return (
              <button
                key={cell.dayKey}
                type="button"
                disabled={cell.isFuture}
                onClick={() => onSelectDay(cell.dayKey as string)}
                className={`flex h-10 min-w-0 flex-col items-center justify-center rounded-lg border text-center leading-none transition-colors disabled:cursor-default ${
                  selected
                    ? 'border-2 border-[#E7B85C] text-[#D97745]'
                    : 'border-base-line text-base-text'
                }`}
                style={{ backgroundColor: levelColors[cell.colorLevel] }}
                aria-label={`${cell.day}日${cell.amount === null ? '无消费' : `消费${cell.amount.toFixed(2)}元`}`}
                aria-pressed={selected}
              >
                <span className="text-[11px] font-semibold">{cell.day}</span>
                <span
                  className="mt-1 max-w-full truncate px-0.5 text-[8px] font-medium"
                  title={cell.amount === null ? undefined : cell.amount.toFixed(2)}
                >
                  {formatCalendarAmount(cell.amount)}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="rounded-2xl border border-[#D7EEE6] bg-base-surface p-1.5">
        <div
          ref={recordsRef}
          className="grid h-[60px] grid-cols-2 content-start gap-x-3 gap-y-0.5 overflow-y-auto [-webkit-overflow-scrolling:touch] [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {selectedDayRecords.length > 0 ? (
            selectedDayRecords.map((record) => (
              <div
                key={record.id}
                className="flex h-7 min-w-0 items-center justify-between gap-2 border-b border-[#E1EEE9] px-1 text-xs"
              >
                <span className="min-w-0 flex-1 truncate text-base-text" title={record.itemName}>
                  {record.itemName}
                </span>
                <span className="shrink-0 text-base-muted">{formatAmount(record.amount)}</span>
              </div>
            ))
          ) : (
            <div className="col-span-2 flex h-[60px] items-center justify-center text-xs text-base-muted">
              {loading ? '本月消费加载中…' : '当天暂无消费'}
            </div>
          )}
        </div>
      </div>

      {errorText && (
        <div className="rounded-2xl border border-base-line bg-base-surface px-3 py-2 text-xs text-base-muted">
          {errorText}，仍可继续记账
        </div>
      )}
    </section>
  )
}

function SummaryCell({
  label,
  amount,
  emphasized = false,
}: {
  label: string
  amount: number
  emphasized?: boolean
}) {
  return (
    <div
      className={`min-w-0 rounded-2xl border px-2 py-1.5 text-center ${
        emphasized
          ? 'border-[#A5E7D2] bg-[#E9F8F2]'
          : 'border-[#D7EEE6] bg-base-surface'
      }`}
    >
      <div className="truncate text-[11px] text-base-muted">{label}</div>
      <div className="mt-0.5 truncate text-sm font-semibold text-base-text" title={formatAmount(amount)}>
        {formatAmount(amount)}
      </div>
    </div>
  )
}
