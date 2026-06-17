import { resolveChatCompletionsUrl } from './_utils.js'

/**
 * /api/investment-ocr
 *
 * 接受支付宝持仓截图（base64），调用视觉模型（Doubao）识别基金数据。
 *
 * POST body: { imageDataUrl: string }
 * Response: { funds: Array<{ fund_name: string, holding_cents: number, profit_rate: number }> }
 */

async function readJsonBody(req: any) {
  if (req.body) return req.body
  const chunks: Uint8Array[] = []
  for await (const chunk of req) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString('utf8').trim()
  if (!raw) return {}
  return JSON.parse(raw)
}

export default async function handler(req: any, res: any) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8')

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' })
  }

  try {
    const body = await readJsonBody(req)
    const { imageDataUrl } = body || {}

    if (!imageDataUrl || typeof imageDataUrl !== 'string') {
      return res.status(400).json({ error: 'Missing imageDataUrl' })
    }

    if (!imageDataUrl.startsWith('data:image/')) {
      return res.status(400).json({ error: 'imageDataUrl must be a data URL starting with data:image/' })
    }

    // 配置优先级：OCR_AI_* > CHAT_AI_* > AI_*
    const apiUrl = process.env.OCR_AI_API_URL || process.env.CHAT_AI_API_URL || process.env.AI_API_URL
    const apiKey = process.env.OCR_AI_API_KEY || process.env.CHAT_AI_API_KEY || process.env.AI_API_KEY
    const model = process.env.OCR_AI_MODEL || process.env.CHAT_AI_MODEL || process.env.AI_MODEL || 'doubao-vision-pro-32k'

    if (!apiUrl || !apiKey) {
      return res.status(500).json({ error: 'OCR AI not configured (missing API URL/Key)' })
    }

    const endpoint = resolveChatCompletionsUrl(apiUrl)

    const prompt = `你是一个基金持仓截图识别助手。请仔细查看这张支付宝基金持仓页面的截图。

请提取截图中所有可见的基金信息，对每一只基金返回：
- fund_name: 基金完整名称（不要截断）
- holding_cents: 持仓金额，单位为"分"（例如 ¥9,325.00 → 返回 932500）
- profit_rate: 持有收益率，小数形式（例如 +4.31% → 返回 0.0431，-11.35% → 返回 -0.1135）

请严格按照以下 JSON 格式返回，不要包含任何其他文字：
{
  "funds": [
    { "fund_name": "景顺长城宁景混合A", "holding_cents": 932500, "profit_rate": 0.0431 },
    ...
  ]
}

注意：
- 忽略截图中的"累计收益"、"昨日收益"等汇总数据
- 只提取单个基金的持仓金额和持有收益率
- 金额中如有逗号分隔请忽略（如 1,234.56 → 1234.56）
- 如果某个基金的金额或收益率看不清，请将对应字段设为 null，不要编造数值
- 确保 holding_cents 是整数（分），profit_rate 是小数（非百分比）`

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: imageDataUrl } },
            ],
          },
        ],
        max_tokens: 4096,
        temperature: 0.1,
      }),
    })

    if (!response.ok) {
      const errText = await response.text().catch(() => '')
      console.error('[investment-ocr] AI API error:', response.status, errText)
      return res.status(502).json({ error: `AI API error: ${response.status}` })
    }

    const aiResult = await response.json()
    const content = aiResult?.choices?.[0]?.message?.content || ''

    // 尝试解析 AI 返回的 JSON
    let parsed: any = null
    try {
      // 尝试直接解析
      parsed = JSON.parse(content)
    } catch {
      // 尝试从 markdown 代码块中提取
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
      if (jsonMatch) {
        try {
          parsed = JSON.parse(jsonMatch[1])
        } catch {
          console.error('[investment-ocr] Failed to parse AI response:', content)
          return res.status(500).json({ error: '无法解析 AI 识别结果' })
        }
      } else {
        console.error('[investment-ocr] No JSON found in AI response:', content)
        return res.status(500).json({ error: 'AI 未返回有效识别结果' })
      }
    }

    if (!parsed || !Array.isArray(parsed.funds)) {
      return res.status(500).json({ error: 'AI 返回格式不正确，缺少 funds 数组' })
    }

    // 验证并清理每只基金的数据
    const funds = parsed.funds
      .filter((f: any) => f.fund_name && typeof f.fund_name === 'string')
      .map((f: any) => ({
        fund_name: f.fund_name.trim(),
        holding_cents: typeof f.holding_cents === 'number' && Number.isFinite(f.holding_cents)
          ? Math.round(f.holding_cents)
          : null,
        profit_rate: typeof f.profit_rate === 'number' && Number.isFinite(f.profit_rate)
          ? f.profit_rate
          : null,
      }))

    return res.status(200).json({ funds })
  } catch (e: any) {
    console.error('[investment-ocr]', e)
    return res.status(500).json({ error: `Server error: ${e?.message || 'unknown'}` })
  }
}
