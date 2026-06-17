import { useState, useEffect } from 'react'
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
  suggestion: Suggestion | null        // null = 尚未计算
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
  // 编辑状态
  const [editingField, setEditingField] = useState<'c' | 'r' | 'm' | 'stop' | null>(null)
  const [cDraft, setCDraft] = useState('')
  const [rDraft, setRDraft] = useState('')
  const [mDraft, setMDraft] = useState('')
  const [stopDraft, setStopDraft] = useState('')
  const [actualAmount, setActualAmount] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 同步外部数据到草稿
  useEffect(() => { setCDraft(fmtYuan(fund.current_value_cents)) }, [fund.current_value_cents])
  useEffect(() => { setRDraft(fmtPct(fund.current_profit_rate)) }, [fund.current_profit_rate])
  useEffect(() => { setMDraft(fmtYuan(fund.target_amount_cents)) }, [fund.target_amount_cents])
  useEffect(() => {
    setStopDraft(fund.stop_profit_line != null ? (fund.stop_profit_line * 100).toFixed(0) : '')
  }, [fund.stop_profit_line])

  // 有建议时默认填入建议金额
  useEffect(() => {
    if (suggestion && (suggestion.type === 'buy' || suggestion.type === 'sell')) {
      setActualAmount(fmtYuan(suggestion.amountCents))
    }
  }, [suggestion])

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

  const handleConfirm = async () => {
    const v = parseFloat(actualAmount)
    if (isNaN(v) || v <= 0) {
      setError('请输入有效金额')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await onConfirm(fund.id, Math.round(v * 100))
    } catch {
      setError('确认失败')
    } finally {
      setSaving(false)
    }
  }

  const cancelEditing = () => {
    setEditingField(null)
    setError(null)
    setCDraft(fmtYuan(fund.current_value_cents))
    setRDraft(fmtPct(fund.current_profit_rate))
    setMDraft(fmtYuan(fund.target_amount_cents))
    setStopDraft(fund.stop_profit_line != null ? (fund.stop_profit_line * 100).toFixed(0) : '')
  }

  // 名称截断
  const displayName = truncateName(fund.fund_name)
  const isTruncated = fund.fund_name.length > 6

  // 子行信息
  const subInfoParts: string[] = []
  if (fund.trading_cycle !== 'none') subInfoParts.push(`${cycleLabel[fund.trading_cycle]}调仓`)
  else subInfoParts.push('无周期')
  if (fund.strategy_tag) subInfoParts.push(fund.strategy_tag)
  const subInfo = subInfoParts.join(' · ')

  // 建议列内容
  const renderSuggestion = () => {
    if (!suggestion) return null
    if (suggestion.type === 'hold') {
      return <span className="text-xs text-base-muted">⏸ 持仓观望</span>
    }
    return (
      <div className="space-y-1">
        <div className="text-xs">
          <span className={suggestion.type === 'buy' ? 'text-[#A3D9A5]' : 'text-[#F4A261]'}>
            {suggestion.type === 'buy' ? '⚡建议补仓' : '⚡建议卖出'}
          </span>
          <span className="ml-1 font-medium text-base-text">¥{fmtYuan(suggestion.amountCents)}</span>
        </div>
        <div className="text-[10px] text-base-muted leading-tight">{suggestion.reason}</div>
        {/* 确认操作 */}
        <div className="flex items-center gap-1.5">
          <input
            value={actualAmount}
            onChange={(e) => setActualAmount(e.target.value)}
            className="w-16 rounded-lg border border-base-line bg-base-bg px-1.5 py-0.5 text-[11px] text-base-text focus:outline-none"
            inputMode="decimal"
            placeholder="金额"
          />
          <span className="text-[10px] text-base-muted">元</span>
          <button
            onClick={handleConfirm}
            disabled={saving}
            className="rounded-full border border-base-line bg-base-bg px-2 py-0.5 text-[11px] text-base-text active:opacity-70 disabled:opacity-40"
          >
            {saving ? '…' : '确认'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-base-line bg-base-surface p-3">
      {/* 第一子行：基金名称 | 持仓 | 收益率 | 建议 | 操作 */}
      <div className="flex items-start gap-2">
        {/* 名称列 */}
        <div className="min-w-0 flex-[2]" title={isTruncated ? fund.fund_name : undefined}>
          <span className="text-sm font-medium text-base-text">{displayName}</span>
        </div>

        {/* 持仓列 */}
        <div className="flex-[1.5] text-right">
          {editingField === 'c' ? (
            <div className="flex items-center justify-end gap-1">
              <input
                value={cDraft}
                onChange={(e) => setCDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') cancelEditing() }}
                className="w-16 rounded-lg border border-base-line bg-base-bg px-1 py-0.5 text-xs text-base-text text-right focus:outline-none"
                inputMode="decimal"
                autoFocus
              />
              <button onClick={handleSave} disabled={saving} className="text-[10px] text-base-text active:opacity-70 shrink-0">保存</button>
            </div>
          ) : (
            <div className="flex items-center justify-end gap-1">
              <span className="text-sm font-medium text-base-text">¥{fmtYuan(fund.current_value_cents)}</span>
              <button onClick={() => { setEditingField('c'); setError(null) }} className="text-base-muted active:opacity-70 shrink-0">
                ✏️
              </button>
            </div>
          )}
        </div>

        {/* 收益率列 */}
        <div className="flex-[1.2] text-right">
          {editingField === 'r' ? (
            <div className="flex items-center justify-end gap-1">
              <input
                value={rDraft}
                onChange={(e) => setRDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') cancelEditing() }}
                className="w-16 rounded-lg border border-base-line bg-base-bg px-1 py-0.5 text-xs text-base-text text-right focus:outline-none"
                inputMode="decimal"
                autoFocus
              />
              <button onClick={handleSave} disabled={saving} className="text-[10px] text-base-text active:opacity-70 shrink-0">保存</button>
            </div>
          ) : (
            <div className="flex items-center justify-end gap-1">
              <span className={`text-sm font-medium ${
                fund.current_profit_rate < 0 ? 'text-[#E76F51]' : fund.current_profit_rate > 0 ? 'text-[#A3D9A5]' : 'text-base-muted'
              }`}>
                {fmtPct(fund.current_profit_rate)}
              </span>
              <button onClick={() => { setEditingField('r'); setError(null) }} className="text-base-muted active:opacity-70 shrink-0">
                ✏️
              </button>
            </div>
          )}
        </div>

        {/* 建议列 — 大字号摘要 */}
        <div className="flex-[2] min-w-0">
          {suggestion && suggestion.type !== 'hold' ? (
            <span className={`text-xs font-medium ${suggestion.type === 'buy' ? 'text-[#A3D9A5]' : 'text-[#F4A261]'}`}>
              {suggestion.type === 'buy' ? '补仓' : '卖出'} ¥{fmtYuan(suggestion.amountCents)}
            </span>
          ) : suggestion?.type === 'hold' ? (
            <span className="text-xs text-base-muted">持仓观望</span>
          ) : null}
        </div>

        {/* 操作按钮 */}
        <div className="shrink-0">
          <button
            onClick={() => onCalculateSingle(fund.id)}
            disabled={saving}
            className="rounded-lg border border-base-line bg-base-bg px-2 py-0.5 text-[11px] text-base-muted active:opacity-70 disabled:opacity-40"
          >
            计算
          </button>
        </div>
      </div>

      {/* 第二子行：周期·标签 | 目标M | 止盈线 | 建议详情 */}
      <div className="mt-1 flex items-start gap-2">
        {/* 名称列下方：周期 + 标签 */}
        <div className="min-w-0 flex-[2]">
          <span className="text-[10px] text-base-muted">{subInfo}</span>
        </div>

        {/* 持仓列下方：目标 M */}
        <div className="flex-[1.5] text-right">
          {editingField === 'm' ? (
            <div className="flex items-center justify-end gap-1">
              <input
                value={mDraft}
                onChange={(e) => setMDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') cancelEditing() }}
                className="w-16 rounded-lg border border-base-line bg-base-bg px-1 py-0.5 text-[10px] text-base-text text-right focus:outline-none"
                inputMode="decimal"
                autoFocus
              />
              <button onClick={handleSave} disabled={saving} className="text-[10px] text-base-text active:opacity-70 shrink-0">保存</button>
            </div>
          ) : (
            <div className="flex items-center justify-end gap-1">
              <span className="text-[10px] text-base-muted">目标 ¥{fmtYuan(fund.target_amount_cents)}</span>
              <button onClick={() => { setEditingField('m'); setError(null) }} className="text-base-muted active:opacity-70 shrink-0">
                ✏️
              </button>
            </div>
          )}
        </div>

        {/* 收益率列下方：止盈线 */}
        <div className="flex-[1.2] text-right">
          {editingField === 'stop' ? (
            <div className="flex items-center justify-end gap-1">
              <input
                value={stopDraft}
                onChange={(e) => setStopDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') cancelEditing() }}
                className="w-12 rounded-lg border border-base-line bg-base-bg px-1 py-0.5 text-[10px] text-base-text text-right focus:outline-none"
                inputMode="decimal"
                placeholder="如15"
                autoFocus
              />
              <button onClick={handleSave} disabled={saving} className="text-[10px] text-base-text active:opacity-70 shrink-0">保存</button>
            </div>
          ) : (
            <div className="flex items-center justify-end gap-1">
              <span className="text-[10px] text-base-muted">
                止盈 {fund.stop_profit_line != null ? `${(fund.stop_profit_line * 100).toFixed(0)}%` : '无'}
              </span>
              <button onClick={() => { setEditingField('stop'); setError(null) }} className="text-base-muted active:opacity-70 shrink-0">
                ✏️
              </button>
            </div>
          )}
        </div>

        {/* 建议详情列 */}
        <div className="flex-[2] min-w-0">
          {renderSuggestion()}
        </div>

        {/* 操作列占位（与第一子行对齐） */}
        <div className="shrink-0 w-[34px]" />
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="mt-1 text-[10px] text-[#E76F51]">{error}</div>
      )}
    </div>
  )
}
