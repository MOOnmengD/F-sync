const defaultModel = process.env.AI_MODEL || 'deepseek-chat'

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
  const title =
    typeof payload?.title === 'string' && payload.title.trim() ? payload.title.trim() : null
  const review =
    typeof payload?.review === 'string' && payload.review.trim() ? payload.review.trim() : null

  return { title, review }
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
    '任务：把用户输入的书影内容解析为结构化 JSON。',
    '输出字段固定为：title(字符串或null), review(字符串或null)。',
    '',
    '## 核心原则（必须严格遵守）：',
    '1. 忠于用户原始文本，严禁改写或拆分：必须保留用户输入的原始文本，禁止总结、简化、删减、改写、拆分或合并任何文本。',
    '2. 空格分隔：用户使用空格分隔不同的信息。请尊重空格作为边界，不要随意合并被空格分隔的内容，也不要拆分没有空格分隔的内容。',
    '3. 完整性：输入中的所有文字都必须被完整地分配到 title 和 review 这两个字段中，不得丢失任何字符。',
    '',
    '## 字段分配指南：',
    '1. title: 书名或影片名。通常是输入中最前面的一两个词（如"三体"、"肖申克的救赎"、"星际穿越"）。如果书名/影名中包含空格（如"肖申克的救赎"），请完整保留。',
    '2. review: 用户对这本书/影片的全部主观感受、评价、笔记。必须完整保留用户原文，不得改写、删减、拆分或总结。如果输入中没有任何评价内容，review 为 null。',
    '注意：如果整个输入只有一个书名/影名（没有空格分隔的其他内容），则 title 为该书影名，review 为 null。',
  ].join('\n')

  const user = [
    '请解析下面这段文字，并只返回 JSON：',
    text,
    '',
    '## 正确示例 1',
    '输入：三体 震撼的硬科幻，读完久久不能平静，黑暗森林法则太精妙了',
    '输出：{"title":"三体","review":"震撼的硬科幻，读完久久不能平静，黑暗森林法则太精妙了"}',
    '',
    '## 正确示例 2',
    '输入：肖申克的救赎 经典中的经典，每次看都有新的感悟',
    '输出：{"title":"肖申克的救赎","review":"经典中的经典，每次看都有新的感悟"}',
    '',
    '## 正确示例 3',
    '输入：深入理解Java虚拟机',
    '输出：{"title":"深入理解Java虚拟机","review":null}',
    '',
    '## 正确示例 4',
    '输入：星际穿越 诺兰真的厉害，配乐和画面都太震撼了',
    '输出：{"title":"星际穿越","review":"诺兰真的厉害，配乐和画面都太震撼了"}',
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
