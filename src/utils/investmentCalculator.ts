// 调仓计算引擎
// 所有规则均为纯数值判断，不限制日期。由用户手动触发，自行决定何时执行。

// ── 类型定义 ──

export type FundParams = {
  M: number               // 目标最大持仓金额（分），0 = 清仓
  C: number               // 当前市值（分）
  R: number               // 当前持有收益率（如 0.0431 = 4.31%）
  stopProfitLine: number | null  // 止盈线（如 0.15 = 15%），null = 无止盈线
}

export type InvestmentFormulaConfig = {
  buyBelowTargetRatio: number
  buyProfitRateBelow: number
  buyGapRatio: number
  buyMaxCents: number
  stopSellExcessRatio: number
  strongStopMultiplier: number
  strongStopBonusCents: number
  strongStopMaxCurrentRatio: number
  rebalanceOverTargetRatio: number
  rebalanceBelowTargetRatio: number
  rebalanceBuyToTargetRatio: number
}

export type Suggestion = {
  type: 'buy' | 'sell' | 'hold'
  amountCents: number
  reason: string
  triggeredRules: string[]
}

type Rule = {
  type: 'buy' | 'sell'
  amount: number
  rule: string
}

export const defaultInvestmentFormulaConfig: InvestmentFormulaConfig = {
  buyBelowTargetRatio: 0.8,
  buyProfitRateBelow: -0.05,
  buyGapRatio: 0.2,
  buyMaxCents: 50000,
  stopSellExcessRatio: 0.5,
  strongStopMultiplier: 2,
  strongStopBonusCents: 50000,
  strongStopMaxCurrentRatio: 0.2,
  rebalanceOverTargetRatio: 1.15,
  rebalanceBelowTargetRatio: 0.7,
  rebalanceBuyToTargetRatio: 0.8,
}

// ── 金额格式化辅助 ──

function cny(cents: number): string {
  return `¥${(cents / 100).toFixed(2)}`
}

function pct(rate: number): string {
  return `${(rate * 100).toFixed(2)}%`
}

function mergeFormulaConfig(config?: Partial<InvestmentFormulaConfig>): InvestmentFormulaConfig {
  return { ...defaultInvestmentFormulaConfig, ...(config || {}) }
}

export function getInvestmentFormulaLines(config?: Partial<InvestmentFormulaConfig>): string[] {
  const f = mergeFormulaConfig(config)

  return [
    `补仓：当前持仓 < 目标持仓的 ${pct(f.buyBelowTargetRatio)}，且收益率 < ${pct(f.buyProfitRateBelow)}，买入 min((目标持仓 - 当前持仓) × ${pct(f.buyGapRatio)}，${cny(f.buyMaxCents)})。`,
    `止盈：收益率 > 止盈线且当前持仓 > 目标持仓时，卖出超出部分 × ${pct(f.stopSellExcessRatio)}；收益率 > 止盈线 × ${f.strongStopMultiplier.toFixed(2)} 时，卖出 min(超出部分 + ${cny(f.strongStopBonusCents)}，当前持仓 × ${pct(f.strongStopMaxCurrentRatio)})。`,
    `再平衡：当前持仓 > 目标持仓的 ${pct(f.rebalanceOverTargetRatio)} 时卖出至目标持仓；当前持仓 < 目标持仓的 ${pct(f.rebalanceBelowTargetRatio)} 时买到目标持仓的 ${pct(f.rebalanceBuyToTargetRatio)}。`,
  ]
}

// ── 核心计算 ──

export function calculateSuggestion(fund: FundParams, config?: Partial<InvestmentFormulaConfig>): Suggestion {
  const { M, C, R, stopProfitLine } = fund
  const formula = mergeFormulaConfig(config)

  // M=0 表示清仓标记
  if (M === 0) {
    return {
      type: 'hold',
      amountCents: 0,
      reason: '该基金标记为清仓，请手动输入卖出金额',
      triggeredRules: [],
    }
  }

  const rules: Rule[] = []

  // ── 规则 1：补仓 ──
  if (C < formula.buyBelowTargetRatio * M && R < formula.buyProfitRateBelow) {
    const amount = Math.round(Math.min((M - C) * formula.buyGapRatio, formula.buyMaxCents))
    if (amount > 0) {
      rules.push({ type: 'buy', amount, rule: '补仓' })
    }
  }

  // ── 规则 2：止盈 ──
  if (stopProfitLine !== null) {
    // 第一档：R > 止盈线 且 C > M
    if (R > stopProfitLine && C > M) {
      const amount = Math.round((C - M) * formula.stopSellExcessRatio)
      if (amount > 0) {
        rules.push({ type: 'sell', amount, rule: '止盈' })
      }
    }
    // 第二档：R > 2×止盈线（不要求 C>M）
    else if (R > formula.strongStopMultiplier * stopProfitLine) {
      const amount = Math.round(Math.min((C - M) + formula.strongStopBonusCents, C * formula.strongStopMaxCurrentRatio))
      if (amount > 0) {
        rules.push({ type: 'sell', amount, rule: '止盈(翻倍)' })
      }
    }
  }

  // ── 规则 3：再平衡 ──
  // 超配：C > 1.15M → 卖出至 M
  if (C > formula.rebalanceOverTargetRatio * M) {
    const amount = Math.round(C - M)
    if (amount > 0) {
      rules.push({ type: 'sell', amount, rule: '再平衡-超配' })
    }
  }
  // 低配：C < 0.7M → 补仓至 0.8M
  else if (C < formula.rebalanceBelowTargetRatio * M) {
    const amount = Math.round(formula.rebalanceBuyToTargetRatio * M - C)
    if (amount > 0) {
      rules.push({ type: 'buy', amount, rule: '再平衡-低配' })
    }
  }

  // ── 合并建议 ──
  const netAmount = rules.reduce(
    (sum, r) => sum + (r.type === 'buy' ? r.amount : -r.amount),
    0,
  )

  if (netAmount > 0) {
    return {
      type: 'buy',
      amountCents: netAmount,
      reason: rules
        .map((r) => {
          switch (r.rule) {
            case '补仓':
              return `当前持仓=${cny(C)}<目标持仓的${pct(formula.buyBelowTargetRatio)}(${cny(M * formula.buyBelowTargetRatio)}) 且收益率=${pct(R)}<${pct(formula.buyProfitRateBelow)}，触发补仓`
            case '再平衡-低配':
              return `再平衡：当前持仓=${cny(C)}<目标持仓的${pct(formula.rebalanceBelowTargetRatio)}(${cny(M * formula.rebalanceBelowTargetRatio)})，补仓至目标持仓的${pct(formula.rebalanceBuyToTargetRatio)}(${cny(M * formula.rebalanceBuyToTargetRatio)})`
            default:
              return r.rule
          }
        })
        .join('；'),
      triggeredRules: rules.map((r) => r.rule),
    }
  }

  if (netAmount < 0) {
    return {
      type: 'sell',
      amountCents: Math.abs(netAmount),
      reason: rules
        .map((r) => {
          switch (r.rule) {
            case '止盈':
              return `收益率=${pct(R)}>止盈线${stopProfitLine != null ? pct(stopProfitLine) : ''} 且当前持仓>目标持仓，触发止盈`
            case '止盈(翻倍)':
              return `收益率=${pct(R)}>止盈线×${formula.strongStopMultiplier.toFixed(2)}(${stopProfitLine != null ? pct(formula.strongStopMultiplier * stopProfitLine) : ''})，触发强止盈`
            case '再平衡-超配':
              return `再平衡：当前持仓=${cny(C)}>目标持仓的${pct(formula.rebalanceOverTargetRatio)}(${cny(M * formula.rebalanceOverTargetRatio)})，卖出至目标持仓(${cny(M)})`
            default:
              return r.rule
          }
        })
        .join('；'),
      triggeredRules: rules.map((r) => r.rule),
    }
  }

  // 无建议
  return {
    type: 'hold',
    amountCents: 0,
    reason: '未触发任何规则，持仓观望',
    triggeredRules: [],
  }
}

// ── 日期提示（纯信息展示，不影响计算） ──

export function getDateLabel(): string {
  const today = new Date()
  const weekdays = ['日', '一', '二', '三', '四', '五', '六']
  const y = today.getFullYear()
  const m = today.getMonth() + 1
  const d = today.getDate()
  const w = weekdays[today.getDay()]
  return `${y}年${m}月${d}日 星期${w}`
}
