import { useEffect, useRef, useState } from 'react'
import { Check } from 'lucide-react'
import type { Suggestion } from '../utils/investmentCalculator'

export type InvestmentData = {
  id: string
  fund_code: string | null
  fund_name: string
  current_value_cents: number
  current_profit_rate: number
  target_amount_cents: number
  stop_profit_line: number | null
  trading_cycle: 'weekly' | 'monthly' | 'none'
  strategy_tag: string | null
  is_active: boolean
}

type Props = {
  fund: InvestmentData
  suggestion: Suggestion | null
  onUpdate: (id: string, params: {
    c?: number
    r?: number
    m?: number
    stopProfit?: number | null
  }) => void
  onConfirm: (id: string, actualAmountCents: number) => Promise<void>
  onCalculateSingle: (id: string) => void
  pendingCreate?: boolean
  onCancelPendingCreate?: (id: string) => void
}

const cycleLabel: Record<string, string> = {
  weekly: '周',
  monthly: '月',
  none: '—',
}

export const investmentTableGrid =
  'grid grid-cols-[minmax(68px,1.05fr)_minmax(76px,1fr)_minmax(62px,0.82fr)_minmax(88px,1.12fr)] gap-x-1'

function fmtYuan(cents: number): string {
  return (cents / 100).toFixed(2)
}

function fmtYuanCompact(cents: number): string {
  const yuan = cents / 100
  return Number.isInteger(yuan) ? yuan.toFixed(0) : yuan.toFixed(2)
}

function fmtPct(rate: number): string {
  return `${(rate * 100).toFixed(2)}%`
}

function truncateName(name: string, max: number = 6): string {
  if (name.length <= max) return name
  return name.slice(0, max) + '...'
}

export default function InvestmentCard({
  fund,
  suggestion,
  onUpdate,
  onConfirm,
  onCalculateSingle,
  pendingCreate = false,
  onCancelPendingCreate,
}: Props) {
  const [editingField, setEditingField] = useState<'c' | 'r' | 'm' | 'stop' | 'action' | null>(null)
  const [cDraft, setCDraft] = useState('')
  const [rDraft, setRDraft] = useState('')
  const [mDraft, setMDraft] = useState('')
  const [stopDraft, setStopDraft] = useState('')
  const [actionDraft, setActionDraft] = useState('')
  const [acting, setActing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const editRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => { setCDraft(fmtYuan(fund.current_value_cents)) }, [fund.current_value_cents])
  useEffect(() => { setRDraft(fmtPct(fund.current_profit_rate)) }, [fund.current_profit_rate])
  useEffect(() => { setMDraft(fmtYuan(fund.target_amount_cents)) }, [fund.target_amount_cents])
  useEffect(() => {
    setStopDraft(fund.stop_profit_line != null ? (fund.stop_profit_line * 100).toFixed(0) : '')
  }, [fund.stop_profit_line])
  useEffect(() => {
    setActionDraft(suggestion && suggestion.type !== 'hold' ? fmtYuan(suggestion.amountCents) : '')
  }, [suggestion])

  const cancelEditing = () => {
    setEditingField(null)
    setError(null)
    setCDraft(fmtYuan(fund.current_value_cents))
    setRDraft(fmtPct(fund.current_profit_rate))
    setMDraft(fmtYuan(fund.target_amount_cents))
    setStopDraft(fund.stop_profit_line != null ? (fund.stop_profit_line * 100).toFixed(0) : '')
    setActionDraft(suggestion && suggestion.type !== 'hold' ? fmtYuan(suggestion.amountCents) : '')
  }

  useEffect(() => {
    if (!editingField) return

    const handlePointerDown = (event: PointerEvent) => {
      const node = editRef.current
      if (!node || !(event.target instanceof Node)) return
      if (node.contains(event.target)) return
      cancelEditing()
    }

    document.addEventListener('pointerdown', handlePointerDown, true)
    return () => document.removeEventListener('pointerdown', handlePointerDown, true)
  }, [editingField, fund.current_profit_rate, fund.current_value_cents, fund.stop_profit_line, fund.target_amount_cents, suggestion])

  const handleConfirmAmount = async (amountCents: number): Promise<boolean> => {
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      setError('请输入有效金额')
      return false
    }

    setActing(true)
    setError(null)
    try {
      await onConfirm(fund.id, amountCents)
      return true
    } catch {
      setError('确认失败')
      return false
    } finally {
      setActing(false)
    }
  }

  const handleSave = () => {
    setError(null)

    if (editingField === 'action') {
      if (!suggestion || suggestion.type === 'hold') {
        cancelEditing()
        return
      }

      const value = parseFloat(actionDraft)
      if (isNaN(value) || value <= 0) {
        setError('请输入有效金额')
        return
      }

      void handleConfirmAmount(Math.round(value * 100)).then((confirmed) => {
        if (confirmed) setEditingField(null)
      })
      return
    }

    const params: { c?: number; r?: number; m?: number; stopProfit?: number | null } = {}

    if (editingField === 'c') {
      const v = parseFloat(cDraft)
      if (isNaN(v) || v < 0) { setError('请输入有效金额'); return }
      params.c = Math.round(v * 100)
    }
    if (editingField === 'r') {
      const raw = rDraft.replace('%', '')
      const v = parseFloat(raw)
      if (isNaN(v)) { setError('请输入有效收益率'); return }
      params.r = v / 100
    }
    if (editingField === 'm') {
      const v = parseFloat(mDraft)
      if (isNaN(v) || v < 0) { setError('请输入有效金额'); return }
      params.m = Math.round(v * 100)
    }
    if (editingField === 'stop') {
      if (stopDraft.trim() === '') {
        params.stopProfit = null
      } else {
        const v = parseFloat(stopDraft)
        if (isNaN(v)) { setError('请输入有效止盈线'); return }
        params.stopProfit = v / 100
      }
    }

    onUpdate(fund.id, params)
    setEditingField(null)
  }

  const renderEditActions = () => (
    <button
      type="button"
      onClick={handleSave}
      disabled={acting}
      className="flex h-7 w-full items-center justify-center gap-1 rounded-lg border border-base-line bg-base-bg text-[10px] text-base-text active:opacity-70 disabled:opacity-40"
    >
      <Check size={13} />
      确定
    </button>
  )

  const displayName = truncateName(fund.fund_name)
  const isTruncated = fund.fund_name.length > 6

  const subInfoParts: string[] = []
  if (fund.trading_cycle !== 'none') subInfoParts.push(`${cycleLabel[fund.trading_cycle]}调仓`)
  else subInfoParts.push('无周期')
  if (fund.strategy_tag) subInfoParts.push(fund.strategy_tag)
  const subInfo = subInfoParts.join(' · ')

  const renderSuggestion = () => {
    if (pendingCreate) {
      return (
        <div className="text-right">
          <div className="text-[11px] font-medium leading-5 text-[#D97757]">待保存</div>
          <button
            type="button"
            onClick={() => onCancelPendingCreate?.(fund.id)}
            className="truncate text-[10px] leading-4 text-base-muted active:opacity-70"
          >
            取消新增
          </button>
        </div>
      )
    }

    if (!suggestion) {
      return (
        <div className="text-right text-[11px] leading-5 text-base-muted">
          待计算
        </div>
      )
    }

    if (suggestion.type === 'hold') {
      return (
        <div className="text-right" title={suggestion.reason}>
          <div className="text-[12px] font-medium leading-5 text-base-muted">观望</div>
          <div className="truncate text-[10px] leading-4 text-base-muted">未触发</div>
        </div>
      )
    }

    const tone = suggestion.type === 'buy' ? 'text-[#2F9E7E]' : 'text-[#D97757]'

    if (editingField === 'action') {
      return (
        <div ref={editRef} className="min-w-0 space-y-1">
          <input
            value={actionDraft}
            onChange={(e) => setActionDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') cancelEditing() }}
            className="w-full rounded-lg border border-base-line bg-base-bg px-1 py-0.5 text-right text-[11px] tabular-nums text-base-text focus:outline-none"
            inputMode="decimal"
            aria-label="实际调仓金额（元）"
            autoFocus
          />
          {renderEditActions()}
          <div className={`mt-0.5 text-right text-[9px] leading-3 ${tone}`}>实际金额（元）</div>
        </div>
      )
    }

    return (
      <button
        type="button"
        onClick={() => {
          setActionDraft(fmtYuan(suggestion.amountCents))
          setEditingField('action')
          setError(null)
        }}
        disabled={acting}
        className="block w-full text-right active:opacity-70 disabled:opacity-40"
        title={`${suggestion.reason}；点击确认或修改实际金额`}
      >
        <div className={`whitespace-nowrap text-[12px] font-semibold leading-5 tabular-nums ${tone}`}>
          {suggestion.type === 'buy' ? '补' : '卖'} ¥{fmtYuanCompact(suggestion.amountCents)}
        </div>
        <div className="text-[10px] leading-4 text-base-muted">点击编辑</div>
      </button>
    )
  }

  return (
    <div className="bg-base-surface px-2 py-2.5">
      <div className={`${investmentTableGrid} items-start`}>
        <div className="min-w-0" title={isTruncated ? fund.fund_name : undefined}>
          <div className="truncate text-[13px] font-semibold leading-5 text-base-text">{displayName}</div>
          <div className="truncate text-[10px] leading-4 text-base-muted">{subInfo}</div>
        </div>

        <div className="min-w-0 text-right">
          {editingField === 'c' ? (
            <div ref={editRef} className="w-full space-y-1">
              <input
                value={cDraft}
                onChange={(e) => setCDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') cancelEditing() }}
                className="w-full rounded-lg border border-base-line bg-base-bg px-1 py-0.5 text-right text-[12px] tabular-nums text-base-text focus:outline-none"
                inputMode="decimal"
                autoFocus
              />
              {renderEditActions()}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => { setEditingField('c'); setError(null) }}
              className="block w-full text-right active:opacity-70"
              title="编辑当前持仓"
            >
              <div className="truncate text-[12px] font-semibold leading-5 text-base-text">¥{fmtYuanCompact(fund.current_value_cents)}</div>
            </button>
          )}
        </div>

        <div className="min-w-0 text-right">
          {editingField === 'r' ? (
            <div ref={editRef} className="w-full space-y-1">
              <input
                value={rDraft}
                onChange={(e) => setRDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') cancelEditing() }}
                className="w-full rounded-lg border border-base-line bg-base-bg px-1 py-0.5 text-right text-[11px] tabular-nums text-base-text focus:outline-none"
                inputMode="decimal"
                autoFocus
              />
              {renderEditActions()}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => { setEditingField('r'); setError(null) }}
              className="block w-full text-right active:opacity-70"
              title="编辑当前收益率"
            >
              <div className={`truncate text-[12px] font-semibold leading-5 ${
                fund.current_profit_rate < 0 ? 'text-[#E76F51]' : fund.current_profit_rate > 0 ? 'text-[#A3D9A5]' : 'text-base-muted'
              }`}>
                {fmtPct(fund.current_profit_rate)}
              </div>
            </button>
          )}
        </div>

        <div className="min-w-0">
          {renderSuggestion()}
        </div>
      </div>

      <div className={`${investmentTableGrid} mt-1 items-center`}>
        <div />

        <div className="min-w-0 text-right">
          {editingField === 'm' ? (
            <div ref={editRef} className="w-full space-y-1">
              <input
                value={mDraft}
                onChange={(e) => setMDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') cancelEditing() }}
                className="w-full rounded-lg border border-base-line bg-base-bg px-1 py-0.5 text-right text-[10px] tabular-nums text-base-text focus:outline-none"
                inputMode="decimal"
                autoFocus
              />
              {renderEditActions()}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => { setEditingField('m'); setError(null) }}
              className="block w-full truncate text-right text-[10px] leading-4 text-base-muted active:opacity-70"
              title="编辑建议持仓"
            >
              建议 ¥{fmtYuanCompact(fund.target_amount_cents)}
            </button>
          )}
        </div>

        <div className="min-w-0 text-right">
          {editingField === 'stop' ? (
            <div ref={editRef} className="w-full space-y-1">
              <input
                value={stopDraft}
                onChange={(e) => setStopDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') cancelEditing() }}
                className="w-full rounded-lg border border-base-line bg-base-bg px-1 py-0.5 text-right text-[10px] tabular-nums text-base-text focus:outline-none"
                inputMode="decimal"
                placeholder="15"
                autoFocus
              />
              {renderEditActions()}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => { setEditingField('stop'); setError(null) }}
              className="block w-full truncate text-right text-[10px] leading-4 text-base-muted active:opacity-70"
              title="编辑止盈线"
            >
              止盈 {fund.stop_profit_line != null ? `${(fund.stop_profit_line * 100).toFixed(0)}%` : '无'}
            </button>
          )}
        </div>

        <div className="min-w-0">
          <button
            type="button"
            onClick={() => onCalculateSingle(fund.id)}
            disabled={acting || pendingCreate}
            className="h-7 w-full rounded-lg border border-base-line bg-base-bg text-[10px] text-base-muted active:opacity-70 disabled:opacity-40"
            aria-label={`计算${fund.fund_name}的调仓建议`}
          >
            单独计算
          </button>
        </div>
      </div>

      {error && (
        <div className="mt-1 text-right text-[10px] text-[#E76F51]">{error}</div>
      )}
    </div>
  )
}
