const defaultModel = 'deepseek-chat'

function resolveChatCompletionsUrl(base: string) {
  const trimmed = base.trim().replace(/\/+$/, '')
  if (!trimmed) return ''
  if (trimmed.endsWith('/chat/completions')) return trimmed
  return `${trimmed}/chat/completions`
}

async function readJsonBody(req: any) {
  const chunks: Uint8Array[] = []
  for await (const chunk of req) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString('utf8').trim()
  if (!raw) return {}
  return JSON.parse(raw)
}

function extractJsonObject(text: string) {
  const trimmed = text.trim()
  try {
    return JSON.parse(trimmed)
  } catch {
    const m = trimmed.match(/\{[\s\S]*\}/)
    if (!m) throw new Error('AI response is not valid JSON')
    return JSON.parse(m[0])
  }
}

function normalizeParsed(payload: any) {
  const itemName =
    typeof payload?.item_name === 'string' && payload.item_name.trim() ? payload.item_name.trim() : null
  const brand = typeof payload?.brand === 'string' && payload.brand.trim() ? payload.brand.trim() : null
  const details = typeof payload?.details === 'string' && payload.details.trim() ? payload.details.trim() : null
  const review = typeof payload?.review === 'string' && payload.review.trim() ? payload.review.trim() : null

  let amount: number | null = null
  if (typeof payload?.amount === 'number') amount = Number.isFinite(payload.amount) ? payload.amount : null
  if (typeof payload?.amount === 'string') {
    const n = Number(payload.amount.replace(/[¥￥元块,\s]/g, ''))
    amount = Number.isFinite(n) ? n : null
  }

  return { amount, item_name: itemName, brand, details, review }
}

export default async function handler(req: any, res: any) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')

  if (req.method !== 'POST') {
    res.statusCode = 405
    res.end(JSON.stringify({ error: 'Method Not Allowed' }))
    return
  }

  const apiKey = process.env.AI_API_KEY
  const apiUrl = process.env.AI_API_URL
  if (!apiKey || !apiUrl) {
    res.statusCode = 500
    res.end(JSON.stringify({ error: 'Missing AI_API_KEY or AI_API_URL' }))
    return
  }

  let body: any
  try {
    body = await readJsonBody(req)
  } catch {
    res.statusCode = 400
    res.end(JSON.stringify({ error: 'Invalid JSON body' }))
    return
  }

  const text = typeof body?.text === 'string' ? body.text.trim() : ''
  if (!text) {
    res.statusCode = 400
    res.end(JSON.stringify({ error: 'Missing text' }))
    return
  }

  const endpoint = resolveChatCompletionsUrl(apiUrl)
  if (!endpoint) {
    res.statusCode = 500
    res.end(JSON.stringify({ error: 'Invalid AI_API_URL' }))
    return
  }

  const system = [
    '你是一个严格的 JSON 生成器，只输出 JSON，不要输出 Markdown、解释或多余文字。',
    '任务：把用户输入的中文消费/点评文本解析为结构化 JSON。',
    '输出字段固定为：amount(数字或null), item_name(字符串或null), brand(字符串或null), details(字符串或null), review(字符串或null)。',
    'amount 使用数字（例如 9.9），无法确定就返回 null。',
    'details 放偏客观的规格/口味/温度/加料等；review 放主观感受/评价。',
  ].join('\n')

  const user = [
    '请解析下面这段文字，并只返回 JSON：',
    text,
    '',
    '示例输入：瑞幸小黄油拿铁 9.9 热，不额外加糖 不是很苦，但有点淡',
    '示例输出：{"amount":9.9,"item_name":"小黄油拿铁","brand":"瑞幸","details":"热，不额外加糖","review":"不是很苦，但有点淡"}',
  ].join('\n')

  const model = typeof body?.model === 'string' && body.model.trim() ? body.model.trim() : defaultModel

  let upstream: any
  try {
    const r = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0.1,
      }),
    })

    upstream = await r.json().catch(() => null)
    if (!r.ok) {
      res.statusCode = 502
      res.end(JSON.stringify({ error: 'Upstream AI error', detail: upstream }))
      return
    }
  } catch (e: any) {
    res.statusCode = 502
    res.end(JSON.stringify({ error: 'Failed to reach AI service', detail: String(e?.message ?? e) }))
    return
  }

  const content =
    typeof upstream?.choices?.[0]?.message?.content === 'string' ? upstream.choices[0].message.content : ''
  if (!content) {
    res.statusCode = 502
    res.end(JSON.stringify({ error: 'Empty AI response', detail: upstream }))
    return
  }

  try {
    const obj = extractJsonObject(content)
    const normalized = normalizeParsed(obj)
    res.statusCode = 200
    res.end(JSON.stringify(normalized))
  } catch (e: any) {
    res.statusCode = 502
    res.end(
      JSON.stringify({ error: 'AI response parse error', detail: String(e?.message ?? e), raw: content }),
    )
  }
}
