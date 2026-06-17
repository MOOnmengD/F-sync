import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUpDown, Calculator, ImageUp, Settings2 } from 'lucide-react'
import { supabase } from '../supabaseClient'
import InvestmentCard, { investmentTableGrid, type InvestmentData } from './InvestmentCard'
import InvestManageModal from './InvestManageModal'
import { calculateSuggestion, getDateLabel, type Suggestion } from '../utils/investmentCalculator'
import { compressImage } from '../utils/image'

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
  const [sortBy, setSortBy] = useState<string>('c-desc')
  const [sortOpen, setSortOpen] = useState(false)

  // OCR
  const [ocrLoading, setOcrLoading] = useState(false)
  const [ocrResults, setOcrResults] = useState<Array<{
    fund_name: string
    holding_cents: number | null
    profit_rate: number | null
    matchedId?: string  // 匹配到的现有基金 ID
  }> | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // 总资产
  const totalAssets = useMemo(() =>
    funds.reduce((sum, f) => sum + f.current_value_cents, 0),
    [funds],
  )

  // 排序
  const sortedFunds = useMemo(() => {
    const list = [...funds]
    switch (sortBy) {
      case 'c-asc':
        list.sort((a, b) => a.current_value_cents - b.current_value_cents)
        break
      case 'c-desc':
        list.sort((a, b) => b.current_value_cents - a.current_value_cents)
        break
      case 'r-asc':
        list.sort((a, b) => a.current_profit_rate - b.current_profit_rate)
        break
      case 'r-desc':
        list.sort((a, b) => b.current_profit_rate - a.current_profit_rate)
        break
      case 'cycle':
        list.sort((a, b) => {
          const order: Record<string, number> = { weekly: 0, monthly: 1, none: 2 }
          return (order[a.trading_cycle] ?? 2) - (order[b.trading_cycle] ?? 2)
        })
        break
    }
    return list
  }, [funds, sortBy])

  const sortLabel: Record<string, string> = {
    'c-desc': '持仓↓',
    'c-asc': '持仓↑',
    'r-desc': '收益率↓',
    'r-asc': '收益率↑',
    'cycle': '周期',
  }

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

  const calcOne = useCallback((fund: InvestmentData): Suggestion => {
    return calculateSuggestion({
      M: fund.target_amount_cents,
      C: fund.current_value_cents,
      R: fund.current_profit_rate,
      stopProfitLine: fund.stop_profit_line,
    })
  }, [])

  const handleCalculate = useCallback(() => {
    setCalculating(true)
    setTimeout(() => {
      const map = new Map<string, Suggestion>()
      for (const fund of sortedFunds) {
        map.set(fund.id, calcOne(fund))
      }
      setSuggestions(map)
      setCalculating(false)
    }, 200)
  }, [sortedFunds, calcOne])

  const handleCalculateSingle = useCallback((id: string) => {
    const fund = funds.find((f) => f.id === id)
    if (!fund) return
    setSuggestions((prev) => {
      const next = new Map(prev)
      next.set(id, calcOne(fund))
      return next
    })
  }, [funds, calcOne])

  const handleUpdate = useCallback(async (investmentId: string, params: {
    c?: number
    r?: number
    m?: number
    stopProfit?: number | null
  }) => {
    const res = await fetch('/api/investment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'update_cr',
        userId,
        investmentId,
        ...(params.c !== undefined ? { currentValueCents: params.c } : {}),
        ...(params.r !== undefined ? { currentProfitRate: params.r } : {}),
        ...(params.m !== undefined ? { targetAmountCents: params.m } : {}),
        ...(params.stopProfit !== undefined ? { stopProfitLine: params.stopProfit } : {}),
      }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || '更新失败')

    // 本地更新状态
    setFunds((prev) =>
      prev.map((f) => {
        if (f.id !== investmentId) return f
        return {
          ...f,
          ...(params.c !== undefined ? { current_value_cents: params.c } : {}),
          ...(params.r !== undefined ? { current_profit_rate: params.r } : {}),
          ...(params.m !== undefined ? { target_amount_cents: params.m } : {}),
          ...(params.stopProfit !== undefined ? { stop_profit_line: params.stopProfit } : {}),
        }
      }),
    )
    // 清除该基金的旧建议（参数变了，需要重新计算）
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

  // toast 临时状态
  const [toastMsg, setToastMsg] = useState<string | null>(null)
  const setToast = useCallback((msg: string) => {
    setToastMsg(msg)
    setTimeout(() => setToastMsg(null), 2500)
  }, [])

  const handleOcrUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setOcrLoading(true)
    setOcrResults(null)

    try {
      const compressed = await compressImage(file)
      const res = await fetch('/api/investment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'ocr', imageDataUrl: compressed.dataUrl }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'OCR 失败')

      // 尝试匹配现有基金（按名称包含匹配）
      const results = (data.funds || []).map((f: any) => {
        const match = funds.find((existing) => {
          const ocrName = f.fund_name.replace(/\s+/g, '')
          const dbName = existing.fund_name.replace(/\s+/g, '')
          return ocrName === dbName || ocrName.includes(dbName) || dbName.includes(ocrName)
        })
        return {
          ...f,
          matchedId: match?.id,
        }
      })
      setOcrResults(results)
    } catch (e: any) {
      setToast(e.message || 'OCR 识别失败')
    } finally {
      setOcrLoading(false)
    }

    // 重置 input 以允许重新选择同一文件
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [funds, setToast])

  const handleOcrApply = useCallback(async () => {
    if (!ocrResults) return
    // 批量更新匹配到的基金
    let updated = 0
    for (const r of ocrResults) {
      if (!r.matchedId) continue
      const params: { c?: number; r?: number } = {}
      if (r.holding_cents !== null) params.c = r.holding_cents
      if (r.profit_rate !== null) params.r = r.profit_rate
      if (Object.keys(params).length === 0) continue

      try {
        await fetch('/api/investment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'update_cr',
            userId,
            investmentId: r.matchedId,
            ...(params.c !== undefined ? { currentValueCents: params.c } : {}),
            ...(params.r !== undefined ? { currentProfitRate: params.r } : {}),
          }),
        })
        updated++
      } catch {
        // 继续处理下一个
      }
    }
    // 刷新数据
    await fetchFunds()
    setOcrResults(null)
    if (updated > 0) {
      setToast(`已更新 ${updated} 只基金`)
    }
  }, [ocrResults, userId, fetchFunds])

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
    <div className="mt-4 space-y-3">
      {/* 日期标签 */}
      <div className="text-xs text-base-muted">{dateLabel}</div>

      {/* 操作按钮 */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto min-w-[104px] text-xs text-base-muted">
          总资产
          <div className="text-sm font-semibold text-base-text">¥{(totalAssets / 100).toFixed(2)}</div>
        </div>
        <button
          type="button"
          onClick={handleCalculate}
          disabled={calculating || funds.length === 0}
          className="inline-flex items-center gap-1.5 rounded-xl border border-base-line bg-base-bg px-3 py-2 text-xs text-base-text active:opacity-70 disabled:opacity-40"
        >
          <Calculator size={14} />
          {calculating ? '计算中…' : '计算建议'}
        </button>
        <button
          type="button"
          onClick={() => setManageOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-xl border border-base-line bg-base-bg px-3 py-2 text-xs text-base-muted active:opacity-70"
        >
          <Settings2 size={14} />
          管理持仓
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleOcrUpload}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={ocrLoading}
          className="inline-flex items-center gap-1.5 rounded-xl border border-base-line bg-base-bg px-3 py-2 text-xs text-base-muted active:opacity-70 disabled:opacity-40"
        >
          <ImageUp size={14} />
          {ocrLoading ? '识别中…' : '上传截图'}
        </button>
        <div className="relative">
          <button
            type="button"
            onClick={() => setSortOpen((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-base-line bg-base-bg px-3 py-2 text-xs text-base-muted active:opacity-70"
          >
            <ArrowUpDown size={14} />
            {sortLabel[sortBy]}
          </button>
          {sortOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setSortOpen(false)} />
              <div className="absolute right-0 top-full mt-1 z-50 min-w-[160px] rounded-xl border border-base-line bg-base-bg py-1 shadow-sm">
                {[
                  { key: 'c-desc', label: '持仓金额 从大到小' },
                  { key: 'c-asc', label: '持仓金额 从小到大' },
                  { key: 'r-desc', label: '收益率 从大到小' },
                  { key: 'r-asc', label: '收益率 从小到大' },
                  { key: 'cycle', label: '按调仓周期' },
                ].map((opt) => (
                  <button
                    key={opt.key}
                    onClick={() => { setSortBy(opt.key); setSortOpen(false) }}
                    className={`w-full px-4 py-2 text-left text-xs active:opacity-70 ${
                      sortBy === opt.key ? 'text-base-text font-medium' : 'text-base-muted'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
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

      {/* 基金表格 */}
      {funds.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-base-line bg-base-surface">
          <div className="min-w-96 divide-y divide-base-line">
            <div className={`${investmentTableGrid} bg-base-bg px-3 py-2 text-[10px] font-medium leading-4 text-base-muted`}>
              <div>基金</div>
              <div className="text-right">当前 C / 建议 M</div>
              <div className="text-right">收益 R / 止盈</div>
              <div className="text-right">调仓建议</div>
              <div className="text-right">操作</div>
            </div>
            {sortedFunds.map((fund) => (
              <InvestmentCard
                key={fund.id}
                fund={fund}
                suggestion={suggestions.get(fund.id) ?? null}
                onUpdate={handleUpdate}
                onConfirm={handleConfirm}
                onCalculateSingle={handleCalculateSingle}
              />
            ))}
          </div>
        </div>
      )}

      {/* 已计算且全部为 hold 时，卡片区下方不额外提示；汇总已说明 */}

      {/* 管理弹窗 */}
      <InvestManageModal
        open={manageOpen}
        onClose={() => setManageOpen(false)}
        userId={userId}
        onChanged={fetchFunds}
      />

      {/* OCR 识别结果弹窗 */}
      {ocrResults !== null && (
        <div
          className="fixed inset-0 z-[60] flex items-end justify-center bg-black/15 px-4 pb-6 backdrop-blur-sm"
          onClick={() => setOcrResults(null)}
        >
          <div
            className="w-full max-w-[480px] max-h-[75dvh] overflow-y-auto rounded-2xl border border-base-line bg-base-surface p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-medium text-base-text">
                识别结果（{ocrResults.length} 只基金）
              </h2>
              <button onClick={() => setOcrResults(null)} className="text-xs text-base-muted active:opacity-70">
                关闭
              </button>
            </div>

            {ocrResults.length === 0 ? (
              <div className="text-xs text-base-muted text-center py-4">未识别到基金数据</div>
            ) : (
              <div className="space-y-2">
                {ocrResults.map((r, i) => (
                  <div
                    key={i}
                    className={`rounded-xl border p-3 ${
                      r.matchedId ? 'border-[#A3D9A5] bg-base-bg' : 'border-base-line bg-base-bg opacity-60'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-medium text-base-text truncate">{r.fund_name}</div>
                        <div className="mt-0.5 flex items-center gap-2 text-[10px] text-base-muted">
                          {r.holding_cents !== null && (
                            <span>持仓 ¥{(r.holding_cents / 100).toFixed(2)}</span>
                          )}
                          {r.profit_rate !== null && (
                            <span className={r.profit_rate < 0 ? 'text-[#E76F51]' : r.profit_rate > 0 ? 'text-[#A3D9A5]' : ''}>
                              收益率 {(r.profit_rate * 100).toFixed(2)}%
                            </span>
                          )}
                        </div>
                      </div>
                      <span className={`text-[10px] shrink-0 ${r.matchedId ? 'text-[#A3D9A5]' : 'text-base-muted'}`}>
                        {r.matchedId ? '✓ 已匹配' : '未匹配'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-4 flex gap-2">
              <button
                onClick={() => setOcrResults(null)}
                className="flex-1 rounded-xl border border-base-line bg-base-bg py-2 text-xs text-base-muted active:opacity-70"
              >
                取消
              </button>
              <button
                onClick={handleOcrApply}
                disabled={!ocrResults.some((r) => r.matchedId)}
                className="flex-1 rounded-xl border border-base-line bg-base-bg py-2 text-xs text-base-text active:opacity-70 disabled:opacity-40"
              >
                更新已匹配基金
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toastMsg && (
        <div className="fixed bottom-20 left-1/2 z-[70] -translate-x-1/2 rounded-full border border-base-line bg-base-surface px-4 py-2 text-xs text-base-text shadow-sm">
          {toastMsg}
        </div>
      )}
    </div>
  )
}
