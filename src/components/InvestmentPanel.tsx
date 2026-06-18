import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUpDown, Calculator, ImageUp, Save, Settings2 } from 'lucide-react'
import { supabase } from '../supabaseClient'
import { useSettingsStore } from '../store/settings'
import InvestmentCard, { investmentTableGrid, type InvestmentData } from './InvestmentCard'
import InvestManageModal from './InvestManageModal'
import {
  calculateSuggestion,
  defaultInvestmentFormulaConfig,
  getDateLabel,
  getInvestmentFormulaLines,
  type InvestmentFormulaConfig,
  type Suggestion,
} from '../utils/investmentCalculator'
import { compressImage } from '../utils/image'

type Props = {
  userId: string
}

type InvestmentUpdateParams = {
  c?: number
  r?: number
  m?: number
  stopProfit?: number | null
}

type FormulaDraft = Record<keyof InvestmentFormulaConfig, string>

const formulaStorageKey = 'fsync.investment.formula.v1'

type OcrResult = {
  fund_name: string
  holding_cents: number | null
  profit_rate: number | null
  matchedId?: string
  sourceIndex: number
  sourceName: string
}

function applyInvestmentUpdate(fund: InvestmentData, params: InvestmentUpdateParams): InvestmentData {
  return {
    ...fund,
    ...(params.c !== undefined ? { current_value_cents: params.c } : {}),
    ...(params.r !== undefined ? { current_profit_rate: params.r } : {}),
    ...(params.m !== undefined ? { target_amount_cents: params.m } : {}),
    ...(params.stopProfit !== undefined ? { stop_profit_line: params.stopProfit } : {}),
  }
}

function buildPendingUpdate(current: InvestmentData, saved: InvestmentData | undefined): InvestmentUpdateParams | null {
  if (!saved) {
    return {
      c: current.current_value_cents,
      r: current.current_profit_rate,
      m: current.target_amount_cents,
      stopProfit: current.stop_profit_line,
    }
  }

  const patch: InvestmentUpdateParams = {}
  if (current.current_value_cents !== saved.current_value_cents) patch.c = current.current_value_cents
  if (Math.abs(current.current_profit_rate - saved.current_profit_rate) > 0.00000001) patch.r = current.current_profit_rate
  if (current.target_amount_cents !== saved.target_amount_cents) patch.m = current.target_amount_cents

  const currentStop = current.stop_profit_line ?? null
  const savedStop = saved.stop_profit_line ?? null
  if (
    currentStop !== savedStop &&
    (currentStop == null || savedStop == null || Math.abs(currentStop - savedStop) > 0.00000001)
  ) {
    patch.stopProfit = currentStop
  }

  return Object.keys(patch).length > 0 ? patch : null
}

function normalizeFundNameForMatch(name: string): string {
  return name
    .replace(/\s+/g, '')
    .replace(/\.{2,}|…|⋯/g, '')
    .replace(/[，,。]/g, '')
}

function isFundNameMatch(ocrName: string, dbName: string): boolean {
  const normalizedOcr = normalizeFundNameForMatch(ocrName)
  const normalizedDb = normalizeFundNameForMatch(dbName)
  if (!normalizedOcr || !normalizedDb) return false
  if (normalizedOcr === normalizedDb) return true
  return (
    (normalizedOcr.length >= 4 && normalizedDb.includes(normalizedOcr)) ||
    (normalizedDb.length >= 4 && normalizedOcr.includes(normalizedDb))
  )
}

function getOcrMergeKey(result: OcrResult): string {
  if (result.matchedId) return `id:${result.matchedId}`
  const normalizedName = normalizeFundNameForMatch(result.fund_name)
  return normalizedName ? `name:${normalizedName}` : `raw:${result.sourceIndex}:${result.fund_name}`
}

function mergeOcrResults(results: OcrResult[]): OcrResult[] {
  const merged = new Map<string, OcrResult>()

  for (const result of results) {
    const key = getOcrMergeKey(result)
    const existing = merged.get(key)
    if (!existing) {
      merged.set(key, result)
      continue
    }

    merged.set(key, {
      ...existing,
      fund_name: result.fund_name.length > existing.fund_name.length ? result.fund_name : existing.fund_name,
      holding_cents: result.holding_cents ?? existing.holding_cents,
      profit_rate: result.profit_rate ?? existing.profit_rate,
      matchedId: existing.matchedId ?? result.matchedId,
      sourceIndex: existing.sourceIndex,
      sourceName: existing.sourceName,
    })
  }

  return Array.from(merged.values())
}

function loadFormulaConfig(): InvestmentFormulaConfig {
  if (typeof window === 'undefined') return defaultInvestmentFormulaConfig
  try {
    const raw = window.localStorage.getItem(formulaStorageKey)
    if (!raw) return defaultInvestmentFormulaConfig
    const parsed = JSON.parse(raw) as Partial<InvestmentFormulaConfig>
    return { ...defaultInvestmentFormulaConfig, ...parsed }
  } catch {
    return defaultInvestmentFormulaConfig
  }
}

function configToDraft(config: InvestmentFormulaConfig): FormulaDraft {
  return {
    buyBelowTargetRatio: (config.buyBelowTargetRatio * 100).toString(),
    buyProfitRateBelow: (config.buyProfitRateBelow * 100).toString(),
    buyGapRatio: (config.buyGapRatio * 100).toString(),
    buyMaxCents: (config.buyMaxCents / 100).toString(),
    stopSellExcessRatio: (config.stopSellExcessRatio * 100).toString(),
    strongStopMultiplier: config.strongStopMultiplier.toString(),
    strongStopBonusCents: (config.strongStopBonusCents / 100).toString(),
    strongStopMaxCurrentRatio: (config.strongStopMaxCurrentRatio * 100).toString(),
    rebalanceOverTargetRatio: (config.rebalanceOverTargetRatio * 100).toString(),
    rebalanceBelowTargetRatio: (config.rebalanceBelowTargetRatio * 100).toString(),
    rebalanceBuyToTargetRatio: (config.rebalanceBuyToTargetRatio * 100).toString(),
  }
}

function draftToConfig(draft: FormulaDraft): InvestmentFormulaConfig | null {
  const parse = (key: keyof FormulaDraft) => {
    const value = parseFloat(draft[key])
    return Number.isFinite(value) ? value : null
  }

  const buyBelowTargetRatio = parse('buyBelowTargetRatio')
  const buyProfitRateBelow = parse('buyProfitRateBelow')
  const buyGapRatio = parse('buyGapRatio')
  const buyMaxCents = parse('buyMaxCents')
  const stopSellExcessRatio = parse('stopSellExcessRatio')
  const strongStopMultiplier = parse('strongStopMultiplier')
  const strongStopBonusCents = parse('strongStopBonusCents')
  const strongStopMaxCurrentRatio = parse('strongStopMaxCurrentRatio')
  const rebalanceOverTargetRatio = parse('rebalanceOverTargetRatio')
  const rebalanceBelowTargetRatio = parse('rebalanceBelowTargetRatio')
  const rebalanceBuyToTargetRatio = parse('rebalanceBuyToTargetRatio')

  if (
    buyBelowTargetRatio == null ||
    buyProfitRateBelow == null ||
    buyGapRatio == null ||
    buyMaxCents == null ||
    stopSellExcessRatio == null ||
    strongStopMultiplier == null ||
    strongStopBonusCents == null ||
    strongStopMaxCurrentRatio == null ||
    rebalanceOverTargetRatio == null ||
    rebalanceBelowTargetRatio == null ||
    rebalanceBuyToTargetRatio == null
  ) {
    return null
  }

  return {
    buyBelowTargetRatio: buyBelowTargetRatio / 100,
    buyProfitRateBelow: buyProfitRateBelow / 100,
    buyGapRatio: buyGapRatio / 100,
    buyMaxCents: Math.round(buyMaxCents * 100),
    stopSellExcessRatio: stopSellExcessRatio / 100,
    strongStopMultiplier,
    strongStopBonusCents: Math.round(strongStopBonusCents * 100),
    strongStopMaxCurrentRatio: strongStopMaxCurrentRatio / 100,
    rebalanceOverTargetRatio: rebalanceOverTargetRatio / 100,
    rebalanceBelowTargetRatio: rebalanceBelowTargetRatio / 100,
    rebalanceBuyToTargetRatio: rebalanceBuyToTargetRatio / 100,
  }
}

const formulaFields: Array<{
  key: keyof InvestmentFormulaConfig
  label: string
  suffix: string
}> = [
  { key: 'buyBelowTargetRatio', label: '补仓持仓线', suffix: '%' },
  { key: 'buyProfitRateBelow', label: '补仓收益线', suffix: '%' },
  { key: 'buyGapRatio', label: '补仓差额比例', suffix: '%' },
  { key: 'buyMaxCents', label: '补仓上限', suffix: '元' },
  { key: 'stopSellExcessRatio', label: '止盈卖出比例', suffix: '%' },
  { key: 'strongStopMultiplier', label: '强止盈倍数', suffix: '倍' },
  { key: 'strongStopBonusCents', label: '强止盈加额', suffix: '元' },
  { key: 'strongStopMaxCurrentRatio', label: '强止盈持仓上限', suffix: '%' },
  { key: 'rebalanceOverTargetRatio', label: '超配线', suffix: '%' },
  { key: 'rebalanceBelowTargetRatio', label: '低配线', suffix: '%' },
  { key: 'rebalanceBuyToTargetRatio', label: '低配买到', suffix: '%' },
]

export default function InvestmentPanel({ userId }: Props) {
  const investmentOcrConfig = useSettingsStore((s) => s.settings.investmentOcrConfig)
  const [funds, setFunds] = useState<InvestmentData[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<Map<string, Suggestion>>(new Map())
  const [manageOpen, setManageOpen] = useState(false)
  const [calculating, setCalculating] = useState(false)
  const [savingChanges, setSavingChanges] = useState(false)
  const [sortBy, setSortBy] = useState<string>('c-desc')
  const [sortOpen, setSortOpen] = useState(false)
  const [pendingUpdates, setPendingUpdates] = useState<Map<string, InvestmentUpdateParams>>(new Map())
  const [formulaConfig, setFormulaConfig] = useState<InvestmentFormulaConfig>(() => loadFormulaConfig())
  const [formulaDraft, setFormulaDraft] = useState<FormulaDraft>(() => configToDraft(loadFormulaConfig()))
  const [formulaEditing, setFormulaEditing] = useState(false)
  const [formulaError, setFormulaError] = useState<string | null>(null)
  const savedFundsRef = useRef<Map<string, InvestmentData>>(new Map())

  // OCR
  const [ocrLoading, setOcrLoading] = useState(false)
  const [ocrProgress, setOcrProgress] = useState<string | null>(null)
  const [ocrResults, setOcrResults] = useState<OcrResult[] | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // toast 临时状态
  const [toastMsg, setToastMsg] = useState<string | null>(null)
  const setToast = useCallback((msg: string) => {
    setToastMsg(msg)
    setTimeout(() => setToastMsg(null), 2500)
  }, [])

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
    const list = (data || []) as InvestmentData[]
    savedFundsRef.current = new Map(list.map((fund) => [fund.id, fund]))
    setFunds(list)
    setPendingUpdates(new Map())
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
    }, formulaConfig)
  }, [formulaConfig])

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

  const handleUpdate = useCallback((investmentId: string, params: InvestmentUpdateParams) => {
    setFunds((prev) => {
      let changedFund: InvestmentData | null = null
      const nextFunds = prev.map((fund) => {
        if (fund.id !== investmentId) return fund
        changedFund = applyInvestmentUpdate(fund, params)
        return changedFund
      })

      if (changedFund) {
        const pending = buildPendingUpdate(changedFund, savedFundsRef.current.get(investmentId))
        setPendingUpdates((prevPending) => {
          const next = new Map(prevPending)
          if (pending) next.set(investmentId, pending)
          else next.delete(investmentId)
          return next
        })
      }

      return nextFunds
    })

    setSuggestions((prev) => {
      const next = new Map(prev)
      next.delete(investmentId)
      return next
    })
  }, [])

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

    const savedFund = savedFundsRef.current.get(investmentId) || fund
    savedFundsRef.current.set(investmentId, {
      ...savedFund,
      current_value_cents: cAfter,
    })

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
    setPendingUpdates((prev) => {
      const next = new Map(prev)
      const patch = next.get(investmentId)
      if (!patch) return next
      const rest = { ...patch }
      delete rest.c
      if (Object.keys(rest).length > 0) next.set(investmentId, rest)
      else next.delete(investmentId)
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

  const pendingCount = pendingUpdates.size
  const formulaLines = useMemo(() => getInvestmentFormulaLines(formulaConfig), [formulaConfig])

  const handleSavePending = useCallback(async () => {
    if (pendingUpdates.size === 0) return

    const updates = Array.from(pendingUpdates.entries()).map(([investmentId, params]) => ({
      investmentId,
      ...(params.c !== undefined ? { currentValueCents: params.c } : {}),
      ...(params.r !== undefined ? { currentProfitRate: params.r } : {}),
      ...(params.m !== undefined ? { targetAmountCents: params.m } : {}),
      ...(params.stopProfit !== undefined ? { stopProfitLine: params.stopProfit } : {}),
    }))

    setSavingChanges(true)
    try {
      const res = await fetch('/api/investment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'batch_update',
          userId,
          updates,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '保存失败')

      const currentFunds = new Map(funds.map((fund) => [fund.id, fund]))
      const nextSaved = new Map(savedFundsRef.current)
      for (const investmentId of pendingUpdates.keys()) {
        const fund = currentFunds.get(investmentId)
        if (fund) nextSaved.set(investmentId, fund)
      }
      savedFundsRef.current = nextSaved
      setPendingUpdates(new Map())
      setToast(`已保存 ${updates.length} 只基金`)
    } catch (e: any) {
      setToast(e.message || '保存失败')
    } finally {
      setSavingChanges(false)
    }
  }, [funds, pendingUpdates, setToast, userId])

  const handleFormulaDraftChange = useCallback((key: keyof InvestmentFormulaConfig, value: string) => {
    setFormulaDraft((prev) => ({ ...prev, [key]: value }))
  }, [])

  const handleSaveFormula = useCallback(() => {
    const next = draftToConfig(formulaDraft)
    if (!next) {
      setFormulaError('请输入有效数字')
      return
    }
    if (
      next.buyBelowTargetRatio <= 0 ||
      next.buyGapRatio < 0 ||
      next.buyMaxCents < 0 ||
      next.stopSellExcessRatio < 0 ||
      next.strongStopMultiplier <= 0 ||
      next.strongStopBonusCents < 0 ||
      next.strongStopMaxCurrentRatio < 0 ||
      next.rebalanceOverTargetRatio <= 0 ||
      next.rebalanceBelowTargetRatio <= 0 ||
      next.rebalanceBuyToTargetRatio <= 0
    ) {
      setFormulaError('比例和金额不能为负，倍数必须大于 0')
      return
    }

    setFormulaConfig(next)
    try {
      window.localStorage.setItem(formulaStorageKey, JSON.stringify(next))
    } catch {
      // localStorage 不可用时仍允许本次会话使用新公式
    }
    setFormulaEditing(false)
    setFormulaError(null)
    setSuggestions(new Map())
    setToast('公式已更新，请重新计算建议')
  }, [formulaDraft, setToast])

  const handleCancelFormula = useCallback(() => {
    setFormulaDraft(configToDraft(formulaConfig))
    setFormulaEditing(false)
    setFormulaError(null)
  }, [formulaConfig])

  const handleResetFormula = useCallback(() => {
    setFormulaDraft(configToDraft(defaultInvestmentFormulaConfig))
  }, [])

  const handleOcrUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (files.length === 0) return

    setOcrLoading(true)
    setOcrProgress(`0/${files.length}`)
    setOcrResults(null)

    const allResults: OcrResult[] = []
    let failedCount = 0
    let successCount = 0
    let firstError = ''

    try {
      for (const [idx, file] of files.entries()) {
        setOcrProgress(`${idx + 1}/${files.length}`)
        try {
          const compressed = await compressImage(file)
          const res = await fetch('/api/investment', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'ocr',
              imageDataUrl: compressed.dataUrl,
              url: investmentOcrConfig.url || undefined,
              key: investmentOcrConfig.key || undefined,
              model: investmentOcrConfig.model || undefined,
              prompt: investmentOcrConfig.prompt || undefined,
            }),
          })
          const data = await res.json()
          if (!res.ok) throw new Error(data.error || 'OCR 失败')
          successCount++

          const results: OcrResult[] = Array.isArray(data.funds)
            ? data.funds
                .map((f: any) => {
                  const fundName = typeof f.fund_name === 'string' ? f.fund_name.trim() : ''
                  if (!fundName) return null
                  const match = funds.find((existing) => isFundNameMatch(fundName, existing.fund_name))
                  return {
                    fund_name: fundName,
                    holding_cents: typeof f.holding_cents === 'number' && Number.isFinite(f.holding_cents)
                      ? Math.round(f.holding_cents)
                      : null,
                    profit_rate: typeof f.profit_rate === 'number' && Number.isFinite(f.profit_rate)
                      ? f.profit_rate
                      : null,
                    matchedId: match?.id,
                    sourceIndex: idx,
                    sourceName: file.name || `截图 ${idx + 1}`,
                  }
                })
                .filter((item: OcrResult | null): item is OcrResult => item !== null)
            : []

          allResults.push(...results)
        } catch (e: any) {
          failedCount++
          if (!firstError) firstError = e.message || `${file.name || `第 ${idx + 1} 张截图`} 识别失败`
        }
      }

      const mergedResults = mergeOcrResults(allResults)
      if (mergedResults.length > 0) {
        setOcrResults(mergedResults)
        if (failedCount > 0) {
          setToast(`已识别 ${files.length - failedCount} 张，${failedCount} 张失败`)
        }
      } else if (failedCount > 0) {
        if (successCount > 0) {
          setOcrResults([])
          setToast(`已识别 ${successCount} 张，${failedCount} 张失败，未识别到基金数据`)
        } else {
          setToast(files.length === 1 ? firstError : `全部 ${files.length} 张截图识别失败：${firstError || '请稍后重试'}`)
        }
      } else {
        setOcrResults([])
      }
    } finally {
      setOcrLoading(false)
      setOcrProgress(null)
      // 重置 input 以允许重新选择同一批文件
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }, [funds, investmentOcrConfig, setToast])

  const handleOcrApply = useCallback(() => {
    if (!ocrResults) return
    let updated = 0
    for (const r of ocrResults) {
      if (!r.matchedId) continue
      const params: InvestmentUpdateParams = {}
      if (r.holding_cents !== null) params.c = r.holding_cents
      if (r.profit_rate !== null) params.r = r.profit_rate
      if (Object.keys(params).length === 0) continue

      handleUpdate(r.matchedId, params)
      updated++
    }
    setOcrResults(null)
    if (updated > 0) {
      setToast(`已套入 ${updated} 只基金，点击保存后同步`)
    }
  }, [handleUpdate, ocrResults, setToast])

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
          onClick={handleSavePending}
          disabled={pendingCount === 0 || savingChanges}
          className={`inline-flex items-center gap-1.5 rounded-xl border border-base-line px-3 py-2 text-xs active:opacity-70 disabled:opacity-40 ${
            pendingCount > 0 ? 'bg-pastel-mint text-base-text' : 'bg-base-bg text-base-muted'
          }`}
        >
          <Save size={14} />
          {savingChanges ? '保存中…' : pendingCount > 0 ? `保存 ${pendingCount}` : '已保存'}
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
          multiple
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
          {ocrLoading ? `识别 ${ocrProgress || ''}` : '上传截图'}
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

      {/* 计算公式 */}
      <div className="rounded-2xl border border-base-line bg-base-surface p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-medium text-base-text">计算公式</div>
          <button
            type="button"
            onClick={() => {
              setFormulaEditing((v) => !v)
              setFormulaDraft(configToDraft(formulaConfig))
              setFormulaError(null)
            }}
            className="rounded-full border border-base-line bg-base-bg px-3 py-1.5 text-[11px] text-base-muted active:opacity-70"
          >
            {formulaEditing ? '收起' : '编辑'}
          </button>
        </div>

        <div className="mt-2 space-y-1 text-[10px] leading-4 text-base-muted">
          {formulaLines.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>

        {formulaEditing && (
          <div className="mt-3 border-t border-base-line pt-3">
            <div className="grid grid-cols-2 gap-2">
              {formulaFields.map((field) => (
                <label key={field.key} className="min-w-0">
                  <span className="block truncate text-[10px] leading-4 text-base-muted">{field.label}</span>
                  <span className="mt-0.5 flex items-center rounded-lg border border-base-line bg-base-bg px-2">
                    <input
                      value={formulaDraft[field.key]}
                      onChange={(e) => handleFormulaDraftChange(field.key, e.target.value)}
                      className="h-8 min-w-0 flex-1 bg-transparent text-right text-xs text-base-text focus:outline-none"
                      inputMode="decimal"
                    />
                    <span className="ml-1 shrink-0 text-[10px] text-base-muted">{field.suffix}</span>
                  </span>
                </label>
              ))}
            </div>
            {formulaError && (
              <div className="mt-2 text-right text-[10px] text-[#E76F51]">{formulaError}</div>
            )}
            <div className="mt-3 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={handleResetFormula}
                className="rounded-full border border-base-line bg-base-bg px-3 py-1.5 text-[11px] text-base-muted active:opacity-70"
              >
                默认
              </button>
              <button
                type="button"
                onClick={handleCancelFormula}
                className="rounded-full border border-base-line bg-base-bg px-3 py-1.5 text-[11px] text-base-muted active:opacity-70"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleSaveFormula}
                className="rounded-full border border-base-line bg-pastel-mint px-3 py-1.5 text-[11px] text-base-text active:opacity-70"
              >
                应用
              </button>
            </div>
          </div>
        )}
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
        <div className="overflow-hidden rounded-2xl border border-base-line bg-base-surface">
          <div className="w-full min-w-0 divide-y divide-base-line">
            <div className={`${investmentTableGrid} bg-base-bg px-2 py-2 text-[10px] font-medium leading-4 text-base-muted`}>
              <div>基金</div>
              <div className="text-right">当前/建议</div>
              <div className="text-right">收益/止盈</div>
              <div className="text-right">建议</div>
              <div className="text-right">算</div>
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
                          <span className="shrink-0" title={r.sourceName}>第 {r.sourceIndex + 1} 张</span>
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
