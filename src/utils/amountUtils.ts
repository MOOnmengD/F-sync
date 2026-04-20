export function parseAmountToken(token: string): number | null {
  const t = token.trim().replace(/[,，]/g, '')
  const m = t.match(/^(?:¥|￥)?(\d+(?:\.\d+)?)(?:元|块)?$/)
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) ? n : null
}

export function extractAmount(source: string): { amount: number | null; rest: string } {
  const s = source.replace(/\u3000/g, ' ').replace(/\s+/g, ' ').trim()
  if (!s) return { amount: null, rest: '' }
  const parts = s.split(' ').filter(Boolean)
  if (parts.length === 0) return { amount: null, rest: '' }

  const leading = parseAmountToken(parts[0] ?? '')
  if (leading !== null) {
    return { amount: leading, rest: parts.slice(1).join(' ') }
  }

  const trailing = parseAmountToken(parts[parts.length - 1] ?? '')
  if (trailing !== null) {
    return { amount: trailing, rest: parts.slice(0, -1).join(' ') }
  }

  return { amount: null, rest: s }
}

export function pickItemNameFallback(source: string): string | null {
  const tokens = source.split(/\s+/g).filter(Boolean)
  for (const token of tokens) {
    if (parseAmountToken(token) !== null) continue
    return token
  }
  return null
}

export function formatAmount(amount: number | null) {
  if (amount === null || amount === undefined) return '—'
  if (!Number.isFinite(amount)) return '—'
  return `¥${amount.toFixed(2)}`
}
