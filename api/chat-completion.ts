import { createClient } from '@supabase/supabase-js'

const defaultModel = process.env.CHAT_AI_MODEL || process.env.AI_MODEL || 'deepseek-chat'
const embeddingModel = process.env.EMBEDDING_MODEL || 'text-embedding-3-small'

function resolveChatCompletionsUrl(base: string) {
  const trimmed = base.trim().replace(/\/+$/, '')
  if (!trimmed) return ''
  if (trimmed.endsWith('/chat/completions')) return trimmed
  return `${trimmed}/chat/completions`
}

function resolveEmbeddingUrl(base: string) {
  const trimmed = base.trim().replace(/\/+$/, '')
  if (!trimmed) return ''
  if (trimmed.endsWith('/embeddings')) return trimmed
  return `${trimmed}/embeddings`
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
  const embeddingKey = process.env.EMBEDDING_API_KEY || apiKey
  const embeddingUrl = process.env.EMBEDDING_API_URL || apiUrl
  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY

  if (!apiKey || !apiUrl || !supabaseUrl || !supabaseServiceKey) {
    res.statusCode = 500
    res.end(JSON.stringify({ error: 'Missing configuration' }))
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

  const userQuery = messages[messages.length - 1].content
  let contextInfo = ''

  // --- RAG 逻辑开始 ---
  try {
    // 1. 生成问题向量
    const embEndpoint = resolveEmbeddingUrl(embeddingUrl!)
    const embRes = await fetch(embEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${embeddingKey}`
      },
      body: JSON.stringify({
        model: embeddingModel,
        input: userQuery
      })
    })

    if (embRes.ok) {
      const embData = await embRes.json()
      const queryEmbedding = embData.data?.[0]?.embedding

      if (queryEmbedding) {
        // 2. 在 Supabase 中检索相关记录
        const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey)
        const { data: matchedLogs, error: matchError } = await supabaseAdmin.rpc('match_life_logs', {
          query_embedding: queryEmbedding,
          match_threshold: 0.5,
          match_count: 5
        })

        if (!matchError && matchedLogs && matchedLogs.length > 0) {
          contextInfo = '\n以下是与你问题相关的历史记录：\n' + matchedLogs.map((log: any) => {
            const date = new Date(log.created_at).toLocaleDateString('zh-CN')
            return `[${date}] [${log.type}] ${log.content}`
          }).join('\n')
        }
      }
    }
  } catch (ragError) {
    console.error('[RAG Error]', ragError)
    // 即使 RAG 失败也继续，保证对话不中断
  }
  // --- RAG 逻辑结束 ---

  const endpoint = resolveChatCompletionsUrl(apiUrl)
  const systemPrompt = {
    role: 'system',
    content: `你是一个全能的生活助手 AI，集成在 F-Sync 应用中。
你的任务是协助用户记录生活、分析财务、总结工作以及进行日常对话。
你可以访问用户的生活轨迹数据（包括记账、碎碎念、工作记录、时间轴等）。
在对话中，请保持友好、专业且有洞察力的语气。
当前时间：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}
${contextInfo ? `\n背景上下文：${contextInfo}\n请结合以上历史记录回答用户。` : ''}`
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
