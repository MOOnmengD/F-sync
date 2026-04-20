import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabaseClient'
import { formatDurationHm } from '../utils/dateUtils'

export type TimelineKind = '睡眠' | '生活' | '工作' | '娱乐'

type TimingType = 'sleep' | 'life' | 'work' | 'play'

export const TIMELINE_KINDS = ['睡眠', '生活', '工作', '娱乐'] as const

const STORAGE_KEY = 'fsync.timeline.active.v1'

const TIMING_TYPE_BY_KIND: Record<TimelineKind, TimingType> = {
  睡眠: 'sleep',
  生活: 'life',
  工作: 'work',
  娱乐: 'play',
}

const KIND_BY_TIMING_TYPE: Record<TimingType, TimelineKind> = {
  sleep: '睡眠',
  life: '生活',
  work: '工作',
  play: '娱乐',
}

export function useTimeline(onToast: (msg: string) => void) {
  const [kind, setKind] = useState<TimelineKind | null>(null)
  const [running, setRunning] = useState(false)
  const [startAt, setStartAt] = useState<number | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    try {
      const parsed = JSON.parse(raw) as { timing_type?: unknown; start_time?: unknown } | null
      const timingType = typeof parsed?.timing_type === 'string' ? parsed.timing_type : ''
      const startTime = typeof parsed?.start_time === 'string' ? parsed.start_time : ''
      if (!timingType || !startTime) {
        localStorage.removeItem(STORAGE_KEY)
        return
      }
      if (!['sleep', 'life', 'work', 'play'].includes(timingType)) {
        localStorage.removeItem(STORAGE_KEY)
        return
      }
      const ms = Date.parse(startTime)
      if (!Number.isFinite(ms)) {
        localStorage.removeItem(STORAGE_KEY)
        return
      }
      setKind(KIND_BY_TIMING_TYPE[timingType as TimingType])
      setStartAt(ms)
      setRunning(true)
    } catch {
      localStorage.removeItem(STORAGE_KEY)
    }
  }, [])

  useEffect(() => {
    if (!running) return
    const id = window.setInterval(() => setTick((t) => t + 1), 1000)
    return () => window.clearInterval(id)
  }, [running])

  const elapsedMs = useMemo(() => {
    if (!running || startAt === null) return 0
    return Math.max(0, Date.now() - startAt)
  }, [running, startAt, tick])

  const durationLabel = useMemo(() => formatDurationHm(elapsedMs), [elapsedMs])

  const writeTiming = async (input: { timingType: TimingType; startMs: number; endMs: number }) => {
    const client = supabase
    if (!client) {
      onToast('未配置 Supabase')
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
    const { error } = await client.from('transactions').insert(payload)
    if (error) {
      onToast(error.message || '写入失败')
      return false
    }
    return true
  }

  const handleStart = () => {
    if (running) return
    if (!kind) {
      onToast('请先选择计时类型')
      return
    }
    const now = Date.now()
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ timing_type: TIMING_TYPE_BY_KIND[kind], start_time: new Date(now).toISOString() }),
    )
    setStartAt(now)
    setRunning(true)
  }

  const handleStop = () => {
    if (!running || startAt === null) return
    setRunning(false)
    setStartAt(null)
    localStorage.removeItem(STORAGE_KEY)
    if (!kind) return
    const endMs = Date.now()
    void writeTiming({ timingType: TIMING_TYPE_BY_KIND[kind], startMs: startAt, endMs })
  }

  const handleCancel = () => {
    if (!running) return
    setRunning(false)
    setStartAt(null)
    setKind(null)
    localStorage.removeItem(STORAGE_KEY)
  }

  const handleKindChange = (k: TimelineKind) => {
    if (!running) {
      setKind(kind === k ? null : k)
      return
    }
    if (k === kind) return
    if (!kind || startAt === null) {
      const now = Date.now()
      setKind(k)
      setStartAt(now)
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ timing_type: TIMING_TYPE_BY_KIND[k], start_time: new Date(now).toISOString() }),
      )
      return
    }
    const prevKind = kind
    const prevStartAt = startAt
    const now = Date.now()
    setKind(k)
    setStartAt(now)
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ timing_type: TIMING_TYPE_BY_KIND[k], start_time: new Date(now).toISOString() }),
    )
    void writeTiming({ timingType: TIMING_TYPE_BY_KIND[prevKind], startMs: prevStartAt, endMs: now })
  }

  return {
    kind,
    running,
    durationLabel,
    handleStart,
    handleStop,
    handleCancel,
    handleKindChange,
  }
}
