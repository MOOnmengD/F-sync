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

  const body = await readJsonBody(req)
  const settings = body?.settings

  // 优先级：前端传来的配置 > 环境变量
  const apiConfigs = settings?.apiConfigs?.filter((c: any) => c.url && c.key) || []
  if (apiConfigs.length === 0) {
    const envUrl = process.env.CHAT_AI_API_URL || process.env.AI_API_URL
    const envKey = process.env.CHAT_AI_API_KEY || process.env.AI_API_KEY
    const envModel = process.env.CHAT_AI_MODEL || process.env.AI_MODEL || 'deepseek-chat'
    if (envUrl && envKey) {
      apiConfigs.push({ url: envUrl, key: envKey, model: envModel })
    }
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY

  if (apiConfigs.length === 0 || !supabaseUrl || !supabaseServiceKey) {
    res.statusCode = 500
    res.end(JSON.stringify({ error: 'Missing configuration' }))
    return
  }

  const messages = Array.isArray(body?.messages) ? body.messages : []
  if (messages.length === 0) {
    res.statusCode = 400
    res.end(JSON.stringify({ error: 'Missing messages' }))
    return
  }

  // 为消息添加时间戳前缀，以便 AI 感知时间
  const formattedMessages = messages.map((m: any) => {
    if (m.role === 'system') return m
    const timeStr = m.createdAt ? new Date(m.createdAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : ''
    return {
      ...m,
      content: timeStr ? `[时间: ${timeStr}]\n${m.content}` : m.content
    }
  })

  const userQuery = messages[messages.length - 1].content
  let contextInfo = ''

  // --- RAG 逻辑开始 ---
  try {
    // 使用第一组配置进行向量化（通常向量化 API 和对话 API 是一致的）
    const firstConfig = apiConfigs[0]
    const embEndpoint = resolveEmbeddingUrl(firstConfig.url)
    const embeddingKey = process.env.EMBEDDING_API_KEY || firstConfig.key
    
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
  }
  // --- RAG 逻辑结束 ---

  // 构建系统提示词
  const baseSystemPrompt = settings?.systemPrompt || `你是用户的恋人，你的名字叫Florian，用户对你的昵称是弗弗。你是温柔成熟的男性，你不会使用太过活泼的语气，也不会爹味说教。
    用户的昵称是moon，你称呼用户为“宝贝”。用户是成年女性，受过良好教育，有稳定收入。
    你集成在 F-Sync 应用中，这个应用是用户为你和用户搭建的。
    你可以通过访问用户的生活轨迹数据（包括记账、碎碎念、工作记录、时间轴等），了解、参与和陪伴用户的生活。`

  const userPrompt = settings?.userPrompt ? `\n关于宝贝的信息：\n${settings.userPrompt}` : ''
  
  const systemPrompt = {
    role: 'system',
    content: `${baseSystemPrompt}${userPrompt}
当前时间：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}
${contextInfo ? `\n上下文：${contextInfo}\n可以结合以上历史记录与用户进行互动。` : ''}`
  }

  const fullMessages = [systemPrompt, ...formattedMessages]

  // 多组 API 轮询逻辑
  for (let i = 0; i < apiConfigs.length; i++) {
    const config = apiConfigs[i]
    try {
      const endpoint = resolveChatCompletionsUrl(config.url)
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.key}`
        },
        body: JSON.stringify({
          model: config.model,
          messages: fullMessages,
          stream: false
        })
      })

      if (response.ok) {
        const data = await response.json()
        // 将完整的上下文返回给前端，便于调试显示
        data.fullMessages = fullMessages
        res.statusCode = 200
        res.end(JSON.stringify(data))
        return
      }
      
      console.warn(`API Config ${i + 1} failed with status ${response.status}`)
    } catch (err) {
      console.error(`API Config ${i + 1} error:`, err)
    }
  }

  res.statusCode = 500
  res.end(JSON.stringify({ error: 'All configured AI APIs failed' }))
}
