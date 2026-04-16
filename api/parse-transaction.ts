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
    '',
    '## 核心原则（必须严格遵守）：',
    '1. 禁止改写：必须保留用户输入的原始文本，禁止总结、简化、删减或改写任何文字。',
    '2. 空格分隔：用户通常使用空格分隔不同的信息。请尊重空格作为边界，不要随意合并被空格分隔的内容，也不要拆分没有空格分隔的内容。',
    '3. 完整性：输入中的所有文字（除了已被识别为 amount 的部分）都必须被完整地分配到 item_name, brand, details, review 这四个字段中，不得丢失任何字符。',
    '',
    '## 字段分配指南：',
    '1. amount: 只能是数字（例如 9.9）。如果文本中出现明确金额，优先识别。',
    '2. brand: 品牌名、店铺名或商户位置（如：瑞幸、蜜雪冰城、天美一楼、小美四楼小杨生煎）。',
    '3. item_name: 具体商品或服务名称（如：生煎包、拿铁、卤肉饭）。如果输入中包含 "数量" 或 "组合"（如：生煎包*8+皮蛋瘦肉粥），应完整保留在 item_name 中。',
    '4. details: 客观的规格、要求、口味、备注信息（如：大杯、去冰、5分糖、外卖、打包、酱香浓郁）。',
    '5. review: 用户的主观感受、评价、吐槽（如：很好吃、太咸了、相性不合、越来越不好吃了）。',
    '注意：如果一个片段既包含客观描述又包含主观感受（且中间没有空格），请将其视为一个整体放入 review 或 details。如果有空格分隔，则按上述规则拆分。',
  ].join('\n')

  const user = [
    '请解析下面这段文字，并只返回 JSON：',
    text,
    '',
    '## 正确示例 1',
    '输入：14.8 （外卖）合意蛋包饭 黑胡椒蛋包炸鸡饭 是怎么把蛋包饭做的又好吃又难吃的……',
    '输出：{"amount":14.8,"item_name":"黑胡椒蛋包炸鸡饭","brand":"合意蛋包饭","details":"（外卖）","review":"是怎么把蛋包饭做的又好吃又难吃的……"}',
    '',
    '## 正确示例 2',
    '输入：15.8 天美一楼卤肉饭窗口 统一卤肉饭 好吃😋越来越好吃了，酱香浓郁，肉也很多，就是稍微有一点点咸。',
    '输出：{"amount":15.8,"item_name":"统一卤肉饭","brand":"天美一楼卤肉饭窗口","details":"酱香浓郁，肉也很多","review":"好吃😋越来越好吃了，就是稍微有一点点咸。"}',
    '',
    '## 正确示例 3',
    '输入：小美四楼小杨生煎 生煎包*8+皮蛋瘦肉粥 12 上次吃还不觉得，这次吃确实生煎包有一点腻，皮蛋瘦肉粥有点稀有点淡，8个生煎包有点腻，5个又吃不饱，有点纠结',
    '输出：{"amount":12,"item_name":"生煎包*8+皮蛋瘦肉粥","brand":"小美四楼小杨生煎","details":null,"review":"上次吃还不觉得，这次吃确实生煎包有一点腻，皮蛋瘦肉粥有点稀有点淡，8个生煎包有点腻，5个又吃不饱，有点纠结"}',
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
