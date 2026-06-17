import {
  DEFAULT_PARSE_TRANSACTION_SYSTEM_PROMPT,
  buildParseTransactionUserPrompt,
} from './_prompt-defaults'

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

  // 解析参数：body 优先 → 环境变量 → 硬编码默认值
  const apiUrl = (typeof body?.url === 'string' && body.url.trim())
    ? body.url.trim()
    : process.env.AI_API_URL
  const apiKey = (typeof body?.key === 'string' && body.key.trim())
    ? body.key.trim()
    : process.env.AI_API_KEY
  const model = (typeof body?.model === 'string' && body.model.trim())
    ? body.model.trim()
    : (process.env.AI_MODEL || 'deepseek-chat')
  const systemPrompt = (typeof body?.systemPrompt === 'string' && body.systemPrompt.trim())
    ? body.systemPrompt.trim()
    : DEFAULT_PARSE_TRANSACTION_SYSTEM_PROMPT
  const userPrompt = (typeof body?.userPrompt === 'string' && body.userPrompt.trim())
    ? body.userPrompt.trim().replace('{text}', text)
    : buildParseTransactionUserPrompt(text)

  if (!apiUrl || !apiKey) {
    res.statusCode = 500
    res.end(JSON.stringify({ error: 'Missing AI_API_URL or AI_API_KEY' }))
    return
  }

  const endpoint = resolveChatCompletionsUrl(apiUrl)
  if (!endpoint) {
    res.statusCode = 500
    res.end(JSON.stringify({ error: 'Invalid AI_API_URL' }))
    return
  }

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
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
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
