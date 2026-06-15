import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabaseClient'
import InvestmentCard, { type InvestmentData } from './InvestmentCard'
import InvestManageModal from './InvestManageModal'
import { calculateSuggestion, getDateLabel, type Suggestion } from '../utils/investmentCalculator'

type Props = {
  userId: string
}

export default function InvestmentPanel({ userId }: Props) {
  const [funds, setFunds] = useState<InvestmentData[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<Map<string, Suggestion>>(new Map())
  const [manageOpen, setManageOpen] = useState(false)
  const [calculating, setCalculating] = useState(false)

  const fetchFunds = useCallback(async () => {
    if (!supabase) return
    setLoading(true)
    setError(null)

    const { data, error: err } = await supabase
      .from('investments')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true)
      .order('created_at', { ascending: true })

    setLoading(false)
    if (err) {
      setError(err.message)
      return
    }
    setFunds((data || []) as InvestmentData[])
  }, [userId])

  useEffect(() => {
    fetchFunds()
  }, [fetchFunds])

  const handleCalculate = useCallback(() => {
    setCalculating(true)
    // 短暂延迟让用户感知计算过程
    setTimeout(() => {
      const map = new Map<string, Suggestion>()
      for (const fund of funds) {
        const s = calculateSuggestion({
          M: fund.target_amount_cents,
          C: fund.current_value_cents,
          R: fund.current_profit_rate,
          stopProfitLine: fund.stop_profit_line,
        })
        map.set(fund.id, s)
      }
      setSuggestions(map)
      setCalculating(false)
    }, 200)
  }, [funds])

  const handleUpdateCR = useCallback(async (investmentId: string, c: number, r: number) => {
    const res = await fetch('/api/investment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'update_cr',
        userId,
        investmentId,
        currentValueCents: c,
        currentProfitRate: r,
      }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || '更新失败')

    // 本地更新状态
    setFunds((prev) =>
      prev.map((f) =>
        f.id === investmentId
          ? { ...f, current_value_cents: c, current_profit_rate: r }
          : f,
      ),
    )
    // 清除该基金的旧建议（C/R 变了，需要重新计算）
    setSuggestions((prev) => {
      const next = new Map(prev)
      next.delete(investmentId)
      return next
    })
  }, [userId])

  const handleConfirm = useCallback(async (investmentId: string, actualAmountCents: number) => {
    const fund = funds.find((f) => f.id === investmentId)
    if (!fund) throw new Error('Fund not found')

    const sug = suggestions.get(investmentId)
    const actionType = sug && sug.type !== 'hold'
      ? (actualAmountCents === sug.amountCents ? 'confirm_suggestion' : 'override_suggestion')
      : 'manual_adjust'

    const cAfter = sug?.type === 'buy'
      ? fund.current_value_cents + actualAmountCents
      : sug?.type === 'sell'
        ? fund.current_value_cents - actualAmountCents
        : fund.current_value_cents

    const res = await fetch('/api/investment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'action',
        userId,
        investmentId,
        suggestionId: null, // 前端计算，暂不关联 suggestion 记录
        actualAmountCents: sug?.type === 'sell' ? -actualAmountCents : actualAmountCents,
        actionType,
        cBeforeCents: fund.current_value_cents,
        cAfterCents: cAfter,
      }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || '确认失败')

    // 本地更新持仓市值
    setFunds((prev) =>
      prev.map((f) =>
        f.id === investmentId
          ? { ...f, current_value_cents: cAfter }
          : f,
      ),
    )
    // 清除该基金的建议
    setSuggestions((prev) => {
      const next = new Map(prev)
      next.delete(investmentId)
      return next
    })
  }, [funds, suggestions, userId])

  // 建议统计
  const summary = useMemo(() => {
    if (suggestions.size === 0) return null
    let buy = 0
    let sell = 0
    let hold = 0
    let totalBuy = 0
    let totalSell = 0
    for (const s of suggestions.values()) {
      if (s.type === 'buy') { buy++; totalBuy += s.amountCents }
      else if (s.type === 'sell') { sell++; totalSell += s.amountCents }
      else hold++
    }
    return { buy, sell, hold, totalBuy, totalSell }
  }, [suggestions])

  const dateLabel = getDateLabel()

  if (loading) {
    return (
      <div className="mt-4 text-center text-xs text-base-muted py-8">加载中…</div>
    )
  }

  if (error) {
    return (
      <div className="mt-4 text-center text-xs text-[#E76F51] py-8">
        加载失败：{error}
        <button onClick={fetchFunds} className="ml-2 underline active:opacity-70">重试</button>
      </div>
    )
  }

  return (
    <div className="mt-4 space-y-4">
      {/* 日期标签 */}
      <div className="text-xs text-base-muted">{dateLabel}</div>

      {/* 操作按钮 */}
      <div className="flex items-center gap-2">
        <button
          onClick={handleCalculate}
          disabled={calculating || funds.length === 0}
          className="rounded-xl border border-base-line bg-base-bg px-4 py-2 text-sm text-base-text active:opacity-70 disabled:opacity-40"
        >
          {calculating ? '计算中…' : '计算建议'}
        </button>
        <button
          onClick={() => setManageOpen(true)}
          className="rounded-xl border border-base-line bg-base-bg px-4 py-2 text-sm text-base-muted active:opacity-70"
        >
          管理持仓
        </button>
      </div>

      {/* 计算结果汇总 */}
      {summary && (
        <div className="rounded-xl border border-base-line bg-base-bg p-3">
          <div className="flex items-center gap-3 text-xs">
            {summary.buy > 0 && (
              <span className="text-[#A3D9A5]">{summary.buy} 只建议补仓 共 ¥{(summary.totalBuy / 100).toFixed(2)}</span>
            )}
            {summary.sell > 0 && (
              <span className="text-[#F4A261]">{summary.sell} 只建议卖出 共 ¥{(summary.totalSell / 100).toFixed(2)}</span>
            )}
            {summary.hold > 0 && (
              <span className="text-base-muted">{summary.hold} 只持仓观望</span>
            )}
          </div>
        </div>
      )}

      {/* 空状态 */}
      {funds.length === 0 && (
        <div className="text-center text-xs text-base-muted py-8">
          暂无持仓基金，点击「管理持仓」添加
        </div>
      )}

      {/* 基金卡片列表 */}
      {funds.map((fund) => (
        <InvestmentCard
          key={fund.id}
          fund={fund}
          suggestion={suggestions.get(fund.id) ?? null}
          onUpdateCR={handleUpdateCR}
          onConfirm={handleConfirm}
        />
      ))}

      {/* 已计算且全部为 hold 时，卡片区下方不额外提示；汇总已说明 */}

      {/* 管理弹窗 */}
      <InvestManageModal
        open={manageOpen}
        onClose={() => setManageOpen(false)}
        userId={userId}
        onChanged={fetchFunds}
      />
    </div>
  )
}
