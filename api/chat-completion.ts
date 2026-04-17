const defaultModel = process.env.CHAT_AI_MODEL || process.env.AI_MODEL || 'deepseek-chat'

function resolveChatCompletionsUrl(base: string) {
  const trimmed = base.trim().replace(/\/+$/, '')
  if (!trimmed) return ''
  if (trimmed.endsWith('/chat/completions')) return trimmed
  return `${trimmed}/chat/completions`
}

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
  res.setHeader('Cache-Control', 'no-store')

  if (req.method !== 'POST') {
    res.statusCode = 405
    res.end(JSON.stringify({ error: 'Method Not Allowed' }))
    return
  }

  const apiKey = process.env.CHAT_AI_API_KEY || process.env.AI_API_KEY
  const apiUrl = process.env.CHAT_AI_API_URL || process.env.AI_API_URL

  if (!apiKey || !apiUrl) {
    res.statusCode = 500
    res.end(JSON.stringify({ error: 'Missing AI configuration' }))
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

  const messages = Array.isArray(body?.messages) ? body.messages : []
  if (messages.length === 0) {
    res.statusCode = 400
    res.end(JSON.stringify({ error: 'Missing messages' }))
    return
  }

  const endpoint = resolveChatCompletionsUrl(apiUrl)
  if (!endpoint) {
    res.statusCode = 500
    res.end(JSON.stringify({ error: 'Invalid AI_API_URL' }))
    return
  }

  const systemPrompt = {
    role: 'system',
    content: `你是一个全能的生活助手 AI，集成在 F-Sync 应用中。
你的任务是协助用户记录生活、分析财务、总结工作以及进行日常对话。
你可以访问用户的生活轨迹数据（包括记账、碎碎念、工作记录、时间轴等）。
在对话中，请保持友好、专业且有洞察力的语气。
如果你需要读写数据，请引导用户通过应用界面操作，或者在对话中给出结构化的建议。
当前时间：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`
  }

  const fullMessages = [systemPrompt, ...messages]

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: defaultModel,
        messages: fullMessages,
        stream: false
      })
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      res.statusCode = response.status
      res.end(JSON.stringify({ error: errorData.error?.message || 'AI API request failed' }))
      return
    }

    const data = await response.json()
    res.statusCode = 200
    res.end(JSON.stringify(data))
  } catch (error: any) {
    res.statusCode = 500
    res.end(JSON.stringify({ error: error.message || 'Internal Server Error' }))
  }
}
