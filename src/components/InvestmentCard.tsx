import { useEffect, useState } from 'react'
import { Check, X } from 'lucide-react'
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
  }) => Promise<void>
  onConfirm: (id: string, actualAmountCents: number) => Promise<void>
  onCalculateSingle: (id: string) => void
}

const cycleLabel: Record<string, string> = {
  weekly: '周',
  monthly: '月',
  none: '—',
}

export const investmentTableGrid =
  'grid grid-cols-[minmax(84px,1.28fr)_minmax(80px,1fr)_minmax(64px,0.78fr)_minmax(84px,1.05fr)_40px] gap-x-2'

function fmtYuan(cents: number): string {
  return (cents / 100).toFixed(2)
}

function fmtPct(rate: number): string {
  return `${(rate * 100).toFixed(2)}%`
}

function truncateName(name: string, max: number = 6): string {
  if (name.length <= max) return name
  return name.slice(0, max) + '...'
}

export default function InvestmentCard({ fund, suggestion, onUpdate, onConfirm, onCalculateSingle }: Props) {
  const [editingField, setEditingField] = useState<'c' | 'r' | 'm' | 'stop' | null>(null)
  const [cDraft, setCDraft] = useState('')
  const [rDraft, setRDraft] = useState('')
  const [mDraft, setMDraft] = useState('')
  const [stopDraft, setStopDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { setCDraft(fmtYuan(fund.current_value_cents)) }, [fund.current_value_cents])
  useEffect(() => { setRDraft(fmtPct(fund.current_profit_rate)) }, [fund.current_profit_rate])
  useEffect(() => { setMDraft(fmtYuan(fund.target_amount_cents)) }, [fund.target_amount_cents])
  useEffect(() => {
    setStopDraft(fund.stop_profit_line != null ? (fund.stop_profit_line * 100).toFixed(0) : '')
  }, [fund.stop_profit_line])

  const cancelEditing = () => {
    setEditingField(null)
    setError(null)
    setCDraft(fmtYuan(fund.current_value_cents))
    setRDraft(fmtPct(fund.current_profit_rate))
    setMDraft(fmtYuan(fund.target_amount_cents))
    setStopDraft(fund.stop_profit_line != null ? (fund.stop_profit_line * 100).toFixed(0) : '')
  }

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      const params: { c?: number; r?: number; m?: number; stopProfit?: number | null } = {}

      if (editingField === 'c') {
        const v = parseFloat(cDraft)
        if (isNaN(v) || v < 0) { setError('请输入有效金额'); setSaving(false); return }
        params.c = Math.round(v * 100)
      }
      if (editingField === 'r') {
        const raw = rDraft.replace('%', '')
        const v = parseFloat(raw)
        if (isNaN(v)) { setError('请输入有效收益率'); setSaving(false); return }
        params.r = v / 100
      }
      if (editingField === 'm') {
        const v = parseFloat(mDraft)
        if (isNaN(v) || v < 0) { setError('请输入有效金额'); setSaving(false); return }
        params.m = Math.round(v * 100)
      }
      if (editingField === 'stop') {
        if (stopDraft.trim() === '') {
          params.stopProfit = null
        } else {
          const v = parseFloat(stopDraft)
          if (isNaN(v)) { setError('请输入有效止盈线'); setSaving(false); return }
          params.stopProfit = v / 100
        }
      }

      await onUpdate(fund.id, params)
      setEditingField(null)
    } catch {
      setError('更新失败')
    } finally {
      setSaving(false)
    }
  }

  const handleConfirmAmount = async (amountCents: number) => {
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      setError('请输入有效金额')
      return
    }

    setSaving(true)
    setError(null)
    try {
      await onConfirm(fund.id, amountCents)
    } catch {
      setError('确认失败')
    } finally {
      setSaving(false)
    }
  }

  const confirmSuggested = () => {
    if (!suggestion || suggestion.type === 'hold') return
    void handleConfirmAmount(suggestion.amountCents)
  }

  const confirmCustomAmount = () => {
    if (!suggestion || suggestion.type === 'hold') return
    const value = window.prompt('请输入实际调仓金额（元）', fmtYuan(suggestion.amountCents))
    if (value === null) return

    const amount = parseFloat(value)
    if (isNaN(amount) || amount <= 0) {
      setError('请输入有效金额')
      return
    }
    void handleConfirmAmount(Math.round(amount * 100))
  }

  const renderEditActions = () => (
    <span className="inline-flex items-center gap-0.5">
      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        title="保存"
        aria-label="保存"
        className="grid size-4 place-items-center rounded-full text-base-text active:opacity-70 disabled:opacity-40"
      >
        <Check size={10} />
      </button>
      <button
        type="button"
        onClick={cancelEditing}
        disabled={saving}
        title="取消"
        aria-label="取消"
        className="grid size-4 place-items-center rounded-full text-base-muted active:opacity-70 disabled:opacity-40"
      >
        <X size={10} />
      </button>
    </span>
  )

  const displayName = truncateName(fund.fund_name)
  const isTruncated = fund.fund_name.length > 6

  const subInfoParts: string[] = []
  if (fund.trading_cycle !== 'none') subInfoParts.push(`${cycleLabel[fund.trading_cycle]}调仓`)
  else subInfoParts.push('无周期')
  if (fund.strategy_tag) subInfoParts.push(fund.strategy_tag)
  const subInfo = subInfoParts.join(' · ')

  const renderSuggestion = () => {
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

    return (
      <div className="text-right" title={suggestion.reason}>
        <div className={`truncate text-[12px] font-semibold leading-5 ${tone}`}>
          {suggestion.type === 'buy' ? '补' : '卖'} ¥{fmtYuan(suggestion.amountCents)}
        </div>
        <div className="mt-0.5 flex justify-end gap-1 text-[10px] leading-4">
          <button
            type="button"
            onClick={confirmSuggested}
            disabled={saving}
            className="text-base-text active:opacity-70 disabled:opacity-40"
          >
            确认
          </button>
          <button
            type="button"
            onClick={confirmCustomAmount}
            disabled={saving}
            className="text-base-muted active:opacity-70 disabled:opacity-40"
          >
            改额
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-base-surface px-3 py-2.5">
      <div className={`${investmentTableGrid} items-start`}>
        <div className="min-w-0" title={isTruncated ? fund.fund_name : undefined}>
          <div className="truncate text-[13px] font-semibold leading-5 text-base-text">{displayName}</div>
          <div className="truncate text-[10px] leading-4 text-base-muted">{subInfo}</div>
        </div>

        <div className="min-w-0 text-right">
          {editingField === 'c' ? (
            <div className="flex items-center justify-end gap-0.5">
              <input
                value={cDraft}
                onChange={(e) => setCDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') cancelEditing() }}
                className="w-12 rounded-lg border border-base-line bg-base-bg px-1 py-0.5 text-right text-[12px] text-base-text focus:outline-none"
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
              <div className="truncate text-[13px] font-semibold leading-5 text-base-text">¥{fmtYuan(fund.current_value_cents)}</div>
            </button>
          )}
        </div>

        <div className="min-w-0 text-right">
          {editingField === 'r' ? (
            <div className="flex items-center justify-end gap-0.5">
              <input
                value={rDraft}
                onChange={(e) => setRDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') cancelEditing() }}
                className="w-[42px] rounded-lg border border-base-line bg-base-bg px-1 py-0.5 text-right text-[12px] text-base-text focus:outline-none"
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
              <div className={`truncate text-[13px] font-semibold leading-5 ${
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

        <div className="text-right">
          <button
            type="button"
            onClick={() => onCalculateSingle(fund.id)}
            disabled={saving}
            className="h-8 w-11 rounded-lg border border-base-line bg-base-bg text-[11px] text-base-muted active:opacity-70 disabled:opacity-40"
          >
            计算
          </button>
        </div>
      </div>

      <div className={`${investmentTableGrid} mt-0.5 items-start`}>
        <div />

        <div className="min-w-0 text-right">
          {editingField === 'm' ? (
            <div className="flex items-center justify-end gap-0.5">
              <input
                value={mDraft}
                onChange={(e) => setMDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') cancelEditing() }}
                className="w-12 rounded-lg border border-base-line bg-base-bg px-1 py-0.5 text-right text-[10px] text-base-text focus:outline-none"
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
              建议 ¥{fmtYuan(fund.target_amount_cents)}
            </button>
          )}
        </div>

        <div className="min-w-0 text-right">
          {editingField === 'stop' ? (
            <div className="flex items-center justify-end gap-0.5">
              <input
                value={stopDraft}
                onChange={(e) => setStopDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') cancelEditing() }}
                className="w-[38px] rounded-lg border border-base-line bg-base-bg px-1 py-0.5 text-right text-[10px] text-base-text focus:outline-none"
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

        <div />
        <div />
      </div>

      {error && (
        <div className="mt-1 text-right text-[10px] text-[#E76F51]">{error}</div>
      )}
    </div>
  )
}
