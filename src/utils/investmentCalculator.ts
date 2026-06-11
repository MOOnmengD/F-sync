// 调仓计算引擎
// 所有规则均为纯数值判断，不限制日期。由用户手动触发，自行决定何时执行。

// ── 类型定义 ──

export type FundParams = {
  M: number               // 目标最大持仓金额（分），0 = 清仓
  C: number               // 当前市值（分）
  R: number               // 当前持有收益率（如 0.0431 = 4.31%）
  stopProfitLine: number | null  // 止盈线（如 0.15 = 15%），null = 无止盈线
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

// ── 金额格式化辅助 ──

function cny(cents: number): string {
  return `¥${(cents / 100).toFixed(2)}`
}

function pct(rate: number): string {
  return `${(rate * 100).toFixed(2)}%`
}

// ── 核心计算 ──

export function calculateSuggestion(fund: FundParams): Suggestion {
  const { M, C, R, stopProfitLine } = fund

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
  // 条件：C < 0.8M 且 R < -5%
  if (C < 0.8 * M && R < -0.05) {
    const amount = Math.round(Math.min((M - C) * 0.2, 50000)) // 不超过 ¥500
    if (amount > 0) {
      rules.push({ type: 'buy', amount, rule: '补仓' })
    }
  }

  // ── 规则 2：止盈 ──
  if (stopProfitLine !== null) {
    // 第一档：R > 止盈线 且 C > M
    if (R > stopProfitLine && C > M) {
      const amount = Math.round((C - M) * 0.5)
      if (amount > 0) {
        rules.push({ type: 'sell', amount, rule: '止盈' })
      }
    }
    // 第二档：R > 2×止盈线（不要求 C>M）
    else if (R > 2 * stopProfitLine) {
      const amount = Math.round(Math.min((C - M) + 50000, C * 0.2))
      if (amount > 0) {
        rules.push({ type: 'sell', amount, rule: '止盈(翻倍)' })
      }
    }
  }

  // ── 规则 3：再平衡 ──
  // 超配：C > 1.15M → 卖出至 M
  if (C > 1.15 * M) {
    const amount = Math.round(C - M)
    if (amount > 0) {
      rules.push({ type: 'sell', amount, rule: '再平衡-超配' })
    }
  }
  // 低配：C < 0.7M → 补仓至 0.8M
  else if (C < 0.7 * M) {
    const amount = Math.round(0.8 * M - C)
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
              return `C=${cny(C)}<0.8M(${cny(M * 0.8)}) 且 R=${pct(R)}<-5%，触发补仓`
            case '再平衡-低配':
              return `再平衡：C=${cny(C)}<0.7M(${cny(M * 0.7)})，补仓至0.8M(${cny(M * 0.8)})`
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
              return `R=${pct(R)}>止盈线${stopProfitLine != null ? pct(stopProfitLine) : ''} 且 C>M，触发止盈`
            case '止盈(翻倍)':
              return `R=${pct(R)}>2×止盈线${stopProfitLine != null ? pct(2 * stopProfitLine) : ''}，触发强止盈`
            case '再平衡-超配':
              return `再平衡：C=${cny(C)}>1.15M(${cny(M * 1.15)})，卖出至M(${cny(M)})`
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
