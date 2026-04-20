import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabaseClient'
import { getMondayOfWeek, pad2 } from '../utils/dateUtils'
import { TIMELINE_KINDS, type TimelineKind } from '../hooks/useTimeline'

type TimingRecord = {
  timing_type: string
  start_time: string
  end_time: string
}

type Segment = {
  startMs: number
  endMs: number
  timingType: string
}

const DAY_MS = 24 * 60 * 60 * 1000

const KIND_TO_TIMING: Record<TimelineKind, string> = {
  睡眠: 'sleep',
  生活: 'life',
  工作: 'work',
  娱乐: 'play',
}

const TIMING_COLOR: Record<string, string> = {
  sleep: '#E9D9FF',
  life:  '#CFF3E5',
  work:  '#D7E8FF',
  play:  '#FAD9D2',
}

const WEEKDAY_ZH = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

const TIME_LABELS = ['0', '4', '8', '12', '16', '20', '24']

function segmentsForDay(records: TimingRecord[], dayStartMs: number): Segment[] {
  const dayEndMs = dayStartMs + DAY_MS
  const result: Segment[] = []
  for (const r of records) {
    if (!r.end_time) continue
    const startMs = Date.parse(r.start_time)
    const endMs = Date.parse(r.end_time)
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) continue
    const segStart = Math.max(startMs, dayStartMs)
    const segEnd = Math.min(endMs, dayEndMs)
    if (segStart >= segEnd) continue
    result.push({ startMs: segStart, endMs: segEnd, timingType: r.timing_type })
  }
  return result.sort((a, b) => a.startMs - b.startMs)
}

export function WeeklyTimeline({ refreshKey }: { refreshKey: number }) {
  const [records, setRecords] = useState<TimingRecord[]>([])

  const monday = useMemo(() => getMondayOfWeek(new Date()), [])
  const mondayIso = useMemo(() => monday.toISOString(), [monday])
  const nextMondayIso = useMemo(() => {
    const d = new Date(monday.getTime() + 7 * DAY_MS)
    return d.toISOString()
  }, [monday])

  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => new Date(monday.getTime() + i * DAY_MS)),
    [monday],
  )

  useEffect(() => {
    if (!supabase) return
    supabase
      .from('transactions')
      .select('timing_type, start_time, end_time')
      .eq('type', 'timing')
      .lt('start_time', nextMondayIso)
      .gt('end_time', mondayIso)
      .order('start_time')
      .then(({ data }) => {
        if (data) setRecords(data as TimingRecord[])
      })
  }, [refreshKey, mondayIso, nextMondayIso])

  const today = new Date()

  return (
    <div className="rounded-2xl border border-base-line bg-base-surface p-4">
      <div className="mb-3 text-xs font-medium text-base-muted">本周时间轴</div>

      {/* 时间刻度 */}
      <div className="mb-1 flex">
        <div className="w-14 shrink-0" />
        <div className="flex flex-1 justify-between">
          {TIME_LABELS.map((h) => (
            <span key={h} className="text-[9px] leading-none text-base-muted">
              {h}
            </span>
          ))}
        </div>
      </div>

      {/* 每天一行 */}
      <div className="flex flex-col gap-2">
        {weekDays.map((day) => {
          const dayStartMs = day.getTime()
          const segments = segmentsForDay(records, dayStartMs)
          const isToday =
            day.getFullYear() === today.getFullYear() &&
            day.getMonth() === today.getMonth() &&
            day.getDate() === today.getDate()

          return (
            <div key={dayStartMs} className="flex items-center gap-2">
              <div className="w-14 shrink-0 text-right">
                <div
                  className={`text-[11px] leading-tight ${isToday ? 'font-semibold text-base-text' : 'text-base-muted'}`}
                >
                  {pad2(day.getMonth() + 1)}/{pad2(day.getDate())}
                </div>
                <div
                  className={`text-[10px] leading-tight ${isToday ? 'font-semibold text-base-text' : 'text-base-muted'}`}
                >
                  {WEEKDAY_ZH[day.getDay()]}
                </div>
              </div>

              <div className="relative h-4 flex-1 overflow-hidden rounded-full border border-base-line bg-base-bg">
                {segments.map((seg, i) => {
                  const left = ((seg.startMs - dayStartMs) / DAY_MS) * 100
                  const width = ((seg.endMs - seg.startMs) / DAY_MS) * 100
                  return (
                    <div
                      key={i}
                      className="absolute top-0 h-full"
                      style={{
                        left: `${left}%`,
                        width: `${width}%`,
                        backgroundColor: TIMING_COLOR[seg.timingType] ?? '#E7E5E4',
                      }}
                    />
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      {/* 图例 */}
      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1">
        {TIMELINE_KINDS.map((k) => (
          <div key={k} className="flex items-center gap-1">
            <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: TIMING_COLOR[KIND_TO_TIMING[k]] }} />
            <span className="text-[10px] text-base-muted">{k}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
