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
  onUpdateCR: (id: string, c: number, r: number) => Promise<void>
  onConfirm: (id: string, actualAmountCents: number) => Promise<void>
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

export default function InvestmentCard({ fund, suggestion, onUpdateCR, onConfirm }: Props) {
  const [cDraft, setCDraft] = useState('')
  const [rDraft, setRDraft] = useState('')
  const [editingC, setEditingC] = useState(false)
  const [editingR, setEditingR] = useState(false)
  const [actualAmount, setActualAmount] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 同步外部数据到草稿
  useEffect(() => {
    setCDraft(fmtYuan(fund.current_value_cents))
  }, [fund.current_value_cents])

  useEffect(() => {
    setRDraft(fmtPct(fund.current_profit_rate))
  }, [fund.current_profit_rate])

  // 有建议时默认填入建议金额
  useEffect(() => {
    if (suggestion && (suggestion.type === 'buy' || suggestion.type === 'sell')) {
      setActualAmount(fmtYuan(suggestion.amountCents))
    }
  }, [suggestion])

  const handleSaveC = async () => {
    const v = parseFloat(cDraft)
    if (isNaN(v) || v < 0) {
      setError('请输入有效金额')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await onUpdateCR(fund.id, Math.round(v * 100), fund.current_profit_rate)
      setEditingC(false)
    } catch {
      setError('更新失败')
    } finally {
      setSaving(false)
    }
  }

  const handleSaveR = async () => {
    const raw = rDraft.replace('%', '')
    const v = parseFloat(raw)
    if (isNaN(v)) {
      setError('请输入有效收益率')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await onUpdateCR(fund.id, fund.current_value_cents, v / 100)
      setEditingR(false)
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

  // 进度条
  const ratio = fund.target_amount_cents > 0
    ? fund.current_value_cents / fund.target_amount_cents
    : 0
  const barPct = Math.min(ratio * 100, 100)
  const barColor =
    ratio > 1.15 ? '#F4A261'   // 超配 — 暖橙
    : ratio < 0.7 ? '#E76F51'  // 低配 — 珊瑚
    : ratio >= 0.8 ? '#A3D9A5' // 健康 — 薄荷绿
    : '#F4D03F'                // 略低 — 淡黄

  return (
    <div className="rounded-2xl border border-base-line bg-base-surface p-4">
      {/* 头部：基金名称 + 标签 + 周期 */}
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1 text-sm font-medium text-base-text truncate">
          {fund.fund_name}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {fund.strategy_tag && (
            <span className="rounded-full border border-base-line bg-base-bg px-2 py-0.5 text-[10px] text-base-muted">
              {fund.strategy_tag}
            </span>
          )}
          <span className="text-[10px] text-base-muted">
            {cycleLabel[fund.trading_cycle]}
          </span>
        </div>
      </div>

      {/* C / R / M / 止盈线 */}
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs text-base-muted">
        {/* C 行 */}
        <div className="flex items-center gap-1.5">
          <span className="shrink-0">C:</span>
          {editingC ? (
            <div className="flex items-center gap-1">
              <input
                value={cDraft}
                onChange={(e) => setCDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveC()
                  if (e.key === 'Escape') { setEditingC(false); setCDraft(fmtYuan(fund.current_value_cents)) }
                }}
                className="w-20 rounded-lg border border-base-line bg-base-bg px-1.5 py-0.5 text-xs text-base-text focus:outline-none"
                inputMode="decimal"
                autoFocus
              />
              <button onClick={handleSaveC} disabled={saving} className="text-[10px] text-base-text active:opacity-70">
                保存
              </button>
            </div>
          ) : (
            <>
              <span className="font-medium text-base-text">¥{fmtYuan(fund.current_value_cents)}</span>
              <button onClick={() => { setEditingC(true); setError(null) }} className="text-base-muted active:opacity-70">
                ✏️
              </button>
            </>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <span className="shrink-0">M: ¥{fmtYuan(fund.target_amount_cents)}</span>
        </div>

        {/* R 行 */}
        <div className="flex items-center gap-1.5">
          <span className="shrink-0">R:</span>
          {editingR ? (
            <div className="flex items-center gap-1">
              <input
                value={rDraft}
                onChange={(e) => setRDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveR()
                  if (e.key === 'Escape') { setEditingR(false); setRDraft(fmtPct(fund.current_profit_rate)) }
                }}
                className="w-20 rounded-lg border border-base-line bg-base-bg px-1.5 py-0.5 text-xs text-base-text focus:outline-none"
                inputMode="decimal"
                autoFocus
              />
              <button onClick={handleSaveR} disabled={saving} className="text-[10px] text-base-text active:opacity-70">
                保存
              </button>
            </div>
          ) : (
            <>
              <span
                className={`font-medium ${fund.current_profit_rate < 0 ? 'text-[#E76F51]' : fund.current_profit_rate > 0 ? 'text-[#A3D9A5]' : 'text-base-muted'}`}
              >
                {fmtPct(fund.current_profit_rate)}
              </span>
              <button onClick={() => { setEditingR(true); setError(null) }} className="text-base-muted active:opacity-70">
                ✏️
              </button>
            </>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <span className="shrink-0">
            止盈线: {fund.stop_profit_line != null ? `${(fund.stop_profit_line * 100).toFixed(0)}%` : '无'}
          </span>
        </div>
      </div>

      {/* 进度条 */}
      {fund.target_amount_cents > 0 && (
        <div className="mt-2 flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-base-bg">
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{ width: `${barPct}%`, backgroundColor: barColor }}
            />
          </div>
          <span className="text-[10px] text-base-muted shrink-0">{(ratio * 100).toFixed(1)}%</span>
        </div>
      )}

      {/* 错误提示 */}
      {error && (
        <div className="mt-2 text-[11px] text-[#E76F51]">{error}</div>
      )}

      {/* 建议区域 */}
      {suggestion && (
        <div className="mt-3 rounded-xl border border-base-line bg-base-bg p-3">
          {suggestion.type === 'hold' ? (
            <div className="text-xs text-base-muted">⏸️ {suggestion.reason}</div>
          ) : (
            <>
              <div className="text-xs text-base-text">
                <span className={suggestion.type === 'buy' ? 'text-[#A3D9A5]' : 'text-[#F4A261]'}>
                  {suggestion.type === 'buy' ? '⚡ 建议补仓' : '⚡ 建议卖出'}
                </span>
              </div>
              <div className="mt-0.5 text-[11px] text-base-muted">{suggestion.reason}</div>
              <div className="mt-0.5 text-xs font-medium text-base-text">
                {suggestion.type === 'buy' ? '补仓' : '卖出'}：¥{fmtYuan(suggestion.amountCents)}
              </div>

              {/* 确认操作 */}
              <div className="mt-2 flex items-center gap-2">
                <span className="text-[11px] text-base-muted shrink-0">实际：</span>
                <input
                  value={actualAmount}
                  onChange={(e) => setActualAmount(e.target.value)}
                  className="w-24 rounded-lg border border-base-line bg-base-bg px-2 py-1 text-xs text-base-text focus:outline-none"
                  inputMode="decimal"
                  placeholder="金额"
                />
                <span className="text-[11px] text-base-muted">元</span>
                <button
                  onClick={handleConfirm}
                  disabled={saving}
                  className="ml-auto rounded-full border border-base-line bg-base-bg px-3 py-1 text-xs text-base-text active:opacity-70 disabled:opacity-40"
                >
                  {saving ? '…' : '确认 ✓'}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* 未计算状态 */}
      {!suggestion && (
        <div className="mt-2 text-xs text-base-muted/60">点击「计算建议」查看调仓方案</div>
      )}
    </div>
  )
}
