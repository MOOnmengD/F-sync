import { createClient } from '@supabase/supabase-js'
import { resolveChatCompletionsUrl } from './_utils.js'
import { enrichMessages } from './_context.js'

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

  try {
    if (req.method !== 'POST') {
      res.statusCode = 405
      res.end(JSON.stringify({ error: 'Method Not Allowed' }))
      return
    }

    const body = await readJsonBody(req)
    const settings = body?.settings
    const userId = body?.userId

    // 优先级：前端传来的配置 > 环境变量（仅使用启用中的配置）
    const apiConfigs =
      settings?.apiConfigs?.filter(
        (c: any) => c.enabled !== false && c.url && c.key,
      ) || []
    if (apiConfigs.length === 0) {
      const envUrl = process.env.CHAT_AI_API_URL || process.env.AI_API_URL
      const envKey = process.env.CHAT_AI_API_KEY || process.env.AI_API_KEY
      const envModel =
        process.env.CHAT_AI_MODEL || process.env.AI_MODEL || 'deepseek-chat'
      if (envUrl && envKey) {
        apiConfigs.push({ url: envUrl, key: envKey, model: envModel, enabled: true })
      }
    }

    const supabaseUrl = process.env.VITE_SUPABASE_URL
    const supabaseServiceKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY

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

    // 用户查询（用于 RAG 检索）
    const userQuery = messages[messages.length - 1].content
    let searchQuery = userQuery
    if (userQuery.length < 10 && messages.length >= 2) {
      searchQuery = `${messages[messages.length - 2].content} ${userQuery}`
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey)

    // 构建上下文（共享模块统一处理：用户画像、时间、天气、位置、事件、RAG 检索）
    const amapKey = process.env.AMAP_API_KEY
    const { enrichedMessages, amapAdcode } =
      await enrichMessages({
        supabase: supabaseAdmin,
        userId,
        apiConfigs,
        settings,
        conversationMessages: messages,
        searchQuery,
        location: body?.location,
        amapKey,
      })

    // 将位置旁路写入 DB，供 proactive-ai 后续使用（非阻塞）
    if (body?.location && userId) {
      const locUpsertData: Record<string, any> = {
        user_id: userId,
        latitude: body.location.latitude,
        longitude: body.location.longitude,
        accuracy: body.location.accuracy ?? null,
        source: 'foreground',
        updated_at: new Date().toISOString(),
      }
      if (amapAdcode) {
        locUpsertData.adcode = amapAdcode
      }
      supabaseAdmin
        .from('user_locations')
        .upsert(locUpsertData, { onConflict: 'user_id' })
        .then(({ error }: any) => {
          if (error) console.warn('[Location] 位置存储失败:', error.message)
        })
    }

    // 将含图片的消息转换为多模态格式
    const apiMessages = enrichedMessages.map((m: any) => {
      if (m.images && Array.isArray(m.images) && m.images.length > 0) {
        const parts: any[] = m.images.map((url: string) => ({
          type: 'image_url',
          image_url: { url },
        }))
        if (m.content) {
          parts.push({ type: 'text', text: m.content })
        }
        return { role: m.role, content: parts }
      }
      return { role: m.role, content: m.content }
    })

    // 多组 API 轮询
    for (let i = 0; i < apiConfigs.length; i++) {
      const config = apiConfigs[i]
      try {
        const endpoint = resolveChatCompletionsUrl(config.url)
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.key}`,
          },
          body: JSON.stringify({
            model: config.model,
            messages: apiMessages,
            stream: false,
          }),
        })

        if (response.ok) {
          const data = await response.json()
          data.fullMessages = apiMessages
          res.statusCode = 200
          res.end(JSON.stringify(data))
          return
        }

        console.warn(
          `API Config ${i + 1} failed with status ${response.status}`,
        )
      } catch (err) {
        console.error(`API Config ${i + 1} error:`, err)
      }
    }

    res.statusCode = 500
    res.end(
      JSON.stringify({
        error: `全部 ${apiConfigs.length} 个启用的 API 配置均调用失败，请检查网络或 API 配置`,
      }),
    )
  } catch (unexpectedError: any) {
    console.error('[Handler] Unhandled error:', unexpectedError)
    if (!res.writableEnded) {
      res.statusCode = 500
      res.end(
        JSON.stringify({
          error: `Server error: ${unexpectedError?.message || 'unknown'}`,
        }),
      )
    }
  }
}
