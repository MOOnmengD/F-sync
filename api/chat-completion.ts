import { createClient } from '@supabase/supabase-js'
import { resolveChatCompletionsUrl } from './_utils.js'
import { enrichMessages, type AgentContextItem } from './_context.js'
import {
  executeFsyncTool,
  getAgentSystemInstruction,
  getFsyncToolDefinitions,
  type AgentTraceItem,
} from './_tools.js'
import { prepareChatVisionMessages, type ChatVisionResult } from './_vision.js'

async function readJsonBody(req: any) {
  if (req.body) return req.body
  const chunks: Uint8Array[] = []
  for await (const chunk of req) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString('utf8').trim()
  if (!raw) return {}
  return JSON.parse(raw)
}

type ApiConfig = {
  url: string
  key: string
  model: string
  enabled?: boolean
  name?: string
}

type ApiMessage = {
  role: string
  content: any
  images?: string[]
  tool_calls?: any[]
  tool_call_id?: string
  name?: string
}

async function callChatCompletions(params: {
  apiConfigs: ApiConfig[]
  messages: ApiMessage[]
  extraBody?: Record<string, unknown>
}) {
  const { apiConfigs, messages, extraBody } = params
  const errors: string[] = []

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
          messages,
          stream: false,
          ...(extraBody || {}),
        }),
      })

      if (response.ok) {
        return {
          data: await response.json(),
          configIndex: i,
        }
      }

      const errText = await response.text().catch(() => '')
      errors.push(`API Config ${i + 1} failed with status ${response.status}${errText ? `: ${errText.slice(0, 240)}` : ''}`)
      console.warn(`API Config ${i + 1} failed with status ${response.status}`)
    } catch (err: any) {
      errors.push(`API Config ${i + 1} error: ${err?.message || err}`)
      console.error(`API Config ${i + 1} error:`, err)
    }
  }

  throw new Error(
    errors[0] ||
      `全部 ${apiConfigs.length} 个启用的 API 配置均调用失败，请检查网络或 API 配置`,
  )
}

function convertMessagesForApi(messages: any[]): ApiMessage[] {
  return messages.map((m: any) => {
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
}

function withAgentInstruction(messages: ApiMessage[]) {
  const next = messages.map((message) => ({ ...message }))
  const firstSystem = next.find((message) => message.role === 'system')
  if (firstSystem && typeof firstSystem.content === 'string') {
    firstSystem.content = `${firstSystem.content}\n\n${getAgentSystemInstruction()}`
  } else {
    next.unshift({ role: 'system', content: getAgentSystemInstruction() })
  }
  return next
}

function normalizeToolCalls(message: any): any[] {
  if (Array.isArray(message?.tool_calls)) return message.tool_calls
  if (message?.function_call?.name) {
    return [
      {
        id: `function-call-${Date.now()}`,
        type: 'function',
        function: message.function_call,
      },
    ]
  }
  return []
}

async function runAgentConversation(params: {
  supabase: any
  userId: string
  apiConfigs: ApiConfig[]
  settings: any
  conversationMessages: any[]
  baseApiMessages: ApiMessage[]
  location?: any
  amapKey?: string
  trace: AgentTraceItem[]
}) {
  const {
    supabase,
    userId,
    apiConfigs,
    settings,
    conversationMessages,
    baseApiMessages,
    location,
    amapKey,
    trace,
  } = params

  const toolDefinitions = getFsyncToolDefinitions()
  const protocolMessages = withAgentInstruction(baseApiMessages)
  const agentContextItems: AgentContextItem[] = []
  let sawToolCalls = false

  for (let round = 0; round < 2; round++) {
    const { data } = await callChatCompletions({
      apiConfigs,
      messages: protocolMessages,
      extraBody: {
        tools: toolDefinitions,
        tool_choice: 'auto',
      },
    })

    const assistantMessage = data.choices?.[0]?.message
    const toolCalls = normalizeToolCalls(assistantMessage)
    if (toolCalls.length === 0) {
      if (!sawToolCalls) {
        data.fullMessages = protocolMessages
        return data
      }
      break
    }

    sawToolCalls = true
    protocolMessages.push({
      role: 'assistant',
      content: assistantMessage?.content || '',
      tool_calls: toolCalls,
    })

    for (const toolCall of toolCalls) {
      const result = await executeFsyncTool(toolCall, {
        supabase,
        userId,
        apiConfigs,
      })
      trace.push(result.trace)
      agentContextItems.push(...result.contextItems)
      protocolMessages.push({
        role: 'tool',
        tool_call_id: result.toolCallId,
        name: result.toolName,
        content: result.content,
      })
    }
  }

  if (!sawToolCalls) return null

  if (agentContextItems.length === 0 && trace.length > 0) {
    agentContextItems.push({
      domain: 'agent_tool_errors',
      sourceTool: 'agent',
      title: '工具调用未获得可用数据',
      content: trace
        .map((item) => `${item.tool}${item.domain ? `(${item.domain})` : ''}: ${item.message || item.status}`)
        .join('\n'),
    })
  }

  const { enrichedMessages } = await enrichMessages({
    supabase,
    userId,
    apiConfigs,
    settings,
    conversationMessages,
    location,
    amapKey,
    agentContextItems,
  })
  const finalMessages = convertMessagesForApi(enrichedMessages)
  const { data: finalData } = await callChatCompletions({
    apiConfigs,
    messages: finalMessages,
  })
  finalData.fullMessages = finalMessages
  return finalData
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
    const configuredApiConfigs = Array.isArray(settings?.apiConfigs)
      ? settings.apiConfigs
      : []
    const apiConfigs: ApiConfig[] = configuredApiConfigs
      .filter((c: any) => c.enabled !== false && c.url && c.key)
      .map((c: any) => ({
        ...c,
        model:
          c.model ||
          process.env.CHAT_AI_MODEL ||
          process.env.AI_MODEL ||
          'deepseek-chat',
      }))
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
    const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    const supabaseServiceKey = supabaseServiceRoleKey || process.env.VITE_SUPABASE_ANON_KEY

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

    const {
      messages: conversationMessages,
      imageUnderstanding,
    }: {
      messages: any[]
      imageUnderstanding: ChatVisionResult[]
    } = await prepareChatVisionMessages({
      messages,
      settings,
      apiConfigs,
    })

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey)

    // 构建上下文（共享模块统一处理：用户画像、时间、天气、位置、事件、RAG 检索）
    const amapKey = process.env.AMAP_API_KEY
    const { enrichedMessages, amapAdcode } =
      await enrichMessages({
        supabase: supabaseAdmin,
        userId,
        apiConfigs,
        settings,
        conversationMessages,
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

    const apiMessages = convertMessagesForApi(enrichedMessages)
    const debugAgent = body?.debugAgent === true || body?.agentLab === true
    const agentTrace: AgentTraceItem[] = []
    const normalizedUserId = typeof userId === 'string' ? userId : ''
    const enableAgent =
      body?.enableAgent !== false &&
      Boolean(normalizedUserId) &&
      Boolean(supabaseServiceRoleKey)

    if (!enableAgent && debugAgent) {
      agentTrace.push({
        tool: 'agent',
        status: 'skipped',
        message: !normalizedUserId
          ? '缺少 userId，已跳过 Agent 工具。'
          : '缺少 SUPABASE_SERVICE_ROLE_KEY，已跳过 Agent 工具。',
      })
    }

    if (enableAgent) {
      try {
        const agentData = await runAgentConversation({
          supabase: supabaseAdmin,
          userId: normalizedUserId,
          apiConfigs,
          settings,
          conversationMessages,
          baseApiMessages: apiMessages,
          location: body?.location,
          amapKey,
          trace: agentTrace,
        })

        if (agentData) {
          if (debugAgent) agentData.agentTrace = agentTrace
          if (imageUnderstanding.length > 0) {
            agentData.imageUnderstanding = imageUnderstanding
          }
          res.statusCode = 200
          res.end(JSON.stringify(agentData))
          return
        }
      } catch (agentError: any) {
        console.warn('[Agent] 工具调用模式失败，降级为普通对话:', agentError?.message || agentError)
        if (debugAgent) {
          agentTrace.push({
            tool: 'agent',
            status: 'skipped',
            message: `工具调用模式失败，已降级：${agentError?.message || 'unknown'}`,
          })
        }
      }
    }

    const { data } = await callChatCompletions({
      apiConfigs,
      messages: apiMessages,
    })
    data.fullMessages = apiMessages
    if (debugAgent) data.agentTrace = agentTrace
    if (imageUnderstanding.length > 0) {
      data.imageUnderstanding = imageUnderstanding
    }
    res.statusCode = 200
    res.end(JSON.stringify(data))
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
