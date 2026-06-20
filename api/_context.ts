import { getWeather } from './_weather.js'
import {
  matchCampusLocation,
  resolveChatCompletionsUrl,
  resolveEmbeddingUrl,
  analyzeQueryIntent,
} from './_utils.js'

const embeddingModel = process.env.EMBEDDING_MODEL || 'text-embedding-3-small'

export interface AgentContextItem {
  domain: string
  sourceTool: string
  timestamp?: string
  title?: string
  content: string
  metadata?: Record<string, unknown>
}

// ============================================================
// 用户画像
// ============================================================

export async function fetchUserProfiles(
  supabase: any,
  userId: string,
): Promise<string> {
  let userProfileInfo = ''

  try {
    const { data: relationships } = await supabase
      .from('social_relationships')
      .select('name, relation, impression')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })

    if (relationships && relationships.length > 0) {
      const relText = relationships
        .map((r: any) => {
          const relation = r.relation ? `（${r.relation}）` : ''
          return `${r.name}${relation}`
        })
        .join('；')
      userProfileInfo = '\n社交关系：' + relText + '。'
    }
  } catch (relErr: any) {
    console.warn('[Social Relationships] 查询失败:', relErr.message)
  }

  try {
    const { data: factsProfile } = await supabase
      .from('user_profiles')
      .select('content')
      .eq('user_id', userId)
      .eq('profile_type', 'personal_facts')
      .maybeSingle()

    if (
      factsProfile?.content?.facts &&
      Array.isArray(factsProfile.content.facts) &&
      factsProfile.content.facts.length > 0
    ) {
      const factsText = factsProfile.content.facts.join('；')
      userProfileInfo += '\n关于用户的事实：' + factsText + '。'
    }
  } catch (factsErr: any) {
    console.warn('[Personal Facts] 查询失败:', factsErr.message)
  }

  if (userProfileInfo) {
    userProfileInfo += '\n（你可以利用这些长期记忆更好地理解用户）'
  }

  return userProfileInfo
}

// ============================================================
// 最近事件（top-3 daily_event_items，始终注入的轻量索引）
// ============================================================

export async function fetchTopDailyEvents(
  supabase: any,
): Promise<Array<{ timestamp: Date; content: string }>> {
  try {
    const { data: topEvents } = await supabase
      .from('daily_event_items')
      .select('type, status, content, chat_time_start, date')
      .order('date', { ascending: false })
      .order('sort_order', { ascending: true })
      .limit(3)

    if (topEvents && topEvents.length > 0) {
      return topEvents.map((it: any) => {
        const timeStr = it.chat_time_start
          ? it.chat_time_start.slice(0, 5) + ' '
          : ''
        let content: string
        if (it.type === 'todo') {
          const mark = it.status === 'done' ? '✓' : '○'
          content = `[${mark}] ${timeStr}${it.content}`
        } else {
          content = `- ${timeStr}${it.content}`
        }
        // 用 date + chat_time_start 构建时间戳；无具体时间则用当天正午
        const timePart = it.chat_time_start || '12:00:00'
        const padTime =
          timePart.length === 8 ? timePart : timePart + ':00'
        const timestamp = new Date(`${it.date}T${padTime}+08:00`)
        return { timestamp, content }
      })
    }
  } catch (e: any) {
    console.warn('[Auto Surface] 查询失败:', e.message)
  }
  return []
}

// ============================================================
// 时间轴状态
// ============================================================

export async function fetchTimingInfo(supabase: any): Promise<string> {
  try {
    // 优先：正在进行中的计时
    const { data: activeTimings } = await supabase
      .from('transactions')
      .select('timing_type, start_time, content')
      .eq('type', 'timing')
      .is('end_time', null)
      .order('start_time', { ascending: false })
      .limit(1)

    if (activeTimings && activeTimings.length > 0) {
      const t = activeTimings[0]
      const minutes = Math.floor(
        (Date.now() - new Date(t.start_time).getTime()) / 60000,
      )
      return `[当前状态] 正在进行「${t.timing_type || t.content}」，已持续 ${minutes} 分钟`
    }

    // 次选：2 小时内最近结束的计时
    const twoHoursAgo = new Date(
      Date.now() - 2 * 60 * 60 * 1000,
    ).toISOString()
    const { data: recentTimings } = await supabase
      .from('transactions')
      .select('timing_type, end_time, content')
      .eq('type', 'timing')
      .not('end_time', 'is', null)
      .gte('end_time', twoHoursAgo)
      .order('end_time', { ascending: false })
      .limit(1)

    if (recentTimings && recentTimings.length > 0) {
      const t = recentTimings[0]
      const endTime = new Date(t.end_time).toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
      })
      return `[最近完成] 「${t.timing_type || t.content}」（${endTime} 结束）`
    }
  } catch (timingErr: any) {
    console.warn('[Timing] 查询时间轴状态失败:', timingErr.message)
  }
  return ''
}

// ============================================================
// 位置信息解析
// ============================================================

export async function resolveLocationInfo(params: {
  location?: {
    latitude: number
    longitude: number
    accuracy?: number
    address?: string
  }
  amapKey?: string
}): Promise<{ locationInfo: string; amapAdcode: string }> {
  const { location, amapKey } = params
  let locationInfo = ''
  let amapAdcode = ''

  if (!location || typeof location.latitude !== 'number' || typeof location.longitude !== 'number') {
    return { locationInfo, amapAdcode }
  }

  const lat = location.latitude.toFixed(6)
  const lng = location.longitude.toFixed(6)
  const acc =
    typeof location.accuracy === 'number'
      ? `${Math.round(location.accuracy)}米`
      : '未知精度'

  // 程序化匹配校内地点
  const campusMatch = matchCampusLocation(location.latitude, location.longitude)
  if (campusMatch) {
    locationInfo = `[宝贝当前位置] ${campusMatch}。`
    return { locationInfo, amapAdcode }
  }

  // 校外：先尝试已有的 address
  let bestAddress =
    location.address && typeof location.address === 'string'
      ? location.address
      : ''

  // 高德逆地理编码获取地址 + adcode
  if (amapKey) {
    try {
      const regeoRes = await fetch(
        `https://restapi.amap.com/v3/geocode/regeo?location=${location.longitude.toFixed(6)},${location.latitude.toFixed(6)}&extensions=all&radius=500&output=json&key=${amapKey}`,
      )
      if (regeoRes.ok) {
        const d = await regeoRes.json()
        if (d.status === '1' && d.regeocode) {
          if (d.regeocode.formatted_address) {
            bestAddress = d.regeocode.formatted_address
          }
          if (d.regeocode.addressComponent?.adcode) {
            amapAdcode = d.regeocode.addressComponent.adcode
          }
        }
      }
    } catch (_) {
      /* fallback */
    }
  }

  if (bestAddress) {
    locationInfo = `[宝贝当前位置] ${bestAddress}（坐标 ${lat}, ${lng}，精度 ${acc}）。`
  } else {
    locationInfo = `[宝贝当前位置] 坐标 (${lat}, ${lng})，精度 ${acc}。`
  }

  return { locationInfo, amapAdcode }
}

// ============================================================
// 检索前置判断 → 事件匹配 → 原始对话检索
// ============================================================

export async function retrievalJudgeAndFetch(params: {
  supabase: any
  userId: string
  apiConfigs: Array<{ url: string; key: string; model: string }>
  conversationMessages: Array<{ role: string; content: string; createdAt?: string }>
}): Promise<{
  retrievedChats: any[]
  lifeLogSearch: { needed: boolean; query: string }
}> {
  const { supabase, userId, apiConfigs, conversationMessages } = params

  const emptyResult = { retrievedChats: [], lifeLogSearch: { needed: false, query: '' } }
  if (apiConfigs.length === 0) return emptyResult

  try {
    // 提取最近 6 条消息（3 user + 3 assistant）
    const recentUserMsgs: any[] = []
    const recentAsstMsgs: any[] = []
    for (let i = conversationMessages.length - 1; i >= 0; i--) {
      const m = conversationMessages[i]
      if (m.role === 'user' && recentUserMsgs.length < 3) recentUserMsgs.unshift(m)
      if (m.role === 'assistant' && recentAsstMsgs.length < 3) recentAsstMsgs.unshift(m)
      if (recentUserMsgs.length >= 3 && recentAsstMsgs.length >= 3) break
    }
    const recentMsgs = [...recentUserMsgs, ...recentAsstMsgs].sort(
      (a, b) =>
        new Date(a.createdAt || 0).getTime() -
        new Date(b.createdAt || 0).getTime(),
    )

    if (recentMsgs.length < 2) return emptyResult

    const dialogText = recentMsgs
      .map((m) => `${m.role === 'user' ? '用户' : 'AI'}: ${m.content}`)
      .join('\n')

    const firstConfig = apiConfigs[0]
    const judgeEndpoint = resolveChatCompletionsUrl(firstConfig.url)
    const judgeRes = await fetch(judgeEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${firstConfig.key}`,
      },
      body: JSON.stringify({
        model: firstConfig.model,
        messages: [
          {
            role: 'system',
            content:
              '你是一个对话分析模块。分析以下对话，判断两类检索需求：\n\n1. 记忆检索：用户是否提及过去讨论过的话题或事件（需要回顾历史对话）？\n2. 生活记录检索：用户是否在查询记账、消费、碎碎念、计时、工作等生活数据？\n\n如果记忆检索需要，生成用于检索的关键词/短句（使用用户使用的语言）。\n如果生活记录检索需要，生成查询短语。\n两个可以同时为 true。\n\n只输出 JSON（不要输出其他内容）：\n{"memory_search": {"needed": true, "keywords": "检索关键词"}, "life_log_search": {"needed": true, "query": "检索查询"}}\n如果都不需要：\n{"memory_search": {"needed": false}, "life_log_search": {"needed": false}}',
          },
          { role: 'user', content: dialogText },
        ],
        temperature: 0,
        response_format: { type: 'json_object' },
      }),
    })

    if (!judgeRes.ok) {
      console.warn('[Memory Retrieval] judge API 返回非 200:', judgeRes.status)
      return emptyResult
    }

    const judgeData = await judgeRes.json()
    const judgeRaw = judgeData.choices?.[0]?.message?.content?.trim()
    let judgeResult: any = null
    try {
      judgeResult = JSON.parse(judgeRaw)
    } catch {
      const match = judgeRaw?.match(/\{[\s\S]*\}/)
      if (match) {
        try {
          judgeResult = JSON.parse(match[0])
        } catch {
          /* skip */
        }
      }
    }

    if (!judgeResult) {
      console.warn('[Memory Retrieval] AI judge 返回无法解析的结果')
      return emptyResult
    }

    // 解析新格式（memory_search / life_log_search）
    const memoryNeeded = judgeResult?.memory_search?.needed || judgeResult?.needs_retrieval || false
    const memoryKeywords = judgeResult?.memory_search?.keywords || judgeResult?.keywords || ''
    const lifeLogNeeded = judgeResult?.life_log_search?.needed || false
    const lifeLogQuery = judgeResult?.life_log_search?.query || ''

    if (!memoryNeeded && !lifeLogNeeded) {
      console.log('[Memory Retrieval] AI 判断无需检索（记忆 + 生活记录）')
      return emptyResult
    }

    const lifeLogSearch = lifeLogNeeded && lifeLogQuery
      ? { needed: true, query: lifeLogQuery }
      : { needed: false, query: '' }

    if (!memoryNeeded || !memoryKeywords) {
      if (!memoryNeeded) {
        console.log('[Memory Retrieval] AI 判断无需记忆检索')
      } else {
        console.warn('[Memory Retrieval] AI 判断需记忆检索但未返回 keywords，跳过')
      }
      return { retrievedChats: [], lifeLogSearch }
    }

    // 向量检索 daily_event_items（优先使用专用 embedding 配置）
    const embBaseUrl =
      process.env.EMBEDDING_API_URL ||
      process.env.CHAT_AI_API_URL ||
      process.env.AI_API_URL ||
      firstConfig.url
    const embEndpoint = resolveEmbeddingUrl(embBaseUrl)
    const embeddingKey =
      process.env.EMBEDDING_API_KEY || process.env.CHAT_AI_API_KEY || process.env.AI_API_KEY || firstConfig.key
    const embModel = process.env.EMBEDDING_MODEL || embeddingModel

    const embRes = await fetch(embEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${embeddingKey}`,
      },
      body: JSON.stringify({
        model: embModel,
        input: memoryKeywords,
      }),
    })

    if (!embRes.ok) {
      console.warn(
        '[Memory Retrieval] embedding API 返回非 200:',
        embRes.status,
        `(${embEndpoint})`,
      )
      return { retrievedChats: [], lifeLogSearch }
    }

    const embData = await embRes.json()
    const queryEmbedding = embData.data?.[0]?.embedding
    if (!queryEmbedding) {
      console.warn('[Memory Retrieval] embedding API 未返回有效 embedding')
      return { retrievedChats: [], lifeLogSearch }
    }

    const { data: matchedEvents } = await supabase.rpc(
      'match_daily_event_items',
      {
        query_embedding: queryEmbedding,
        match_threshold: 0.3,
        match_count: 5,
      },
    )

    if (!matchedEvents || matchedEvents.length === 0) return { retrievedChats: [], lifeLogSearch }

    const retrievedChatMessages: any[] = []
    const chatIds = new Set<string>()

    for (const event of matchedEvents) {
      const eventDate = event.date
      const startTime = event.chat_time_start
      const endTime = event.chat_time_end

      if (!eventDate || !startTime) continue

      const padStart =
        startTime.length === 8 ? startTime : startTime + ':00'
      const padEnd = endTime
        ? endTime.length === 8
          ? endTime
          : endTime + ':00'
        : padStart

      const startCST = new Date(`${eventDate}T${padStart}+08:00`)
      const endCST = new Date(`${eventDate}T${padEnd}+08:00`)
      const startUTC = new Date(
        startCST.getTime() - 5 * 60 * 1000,
      ).toISOString()
      const endUTC = new Date(
        endCST.getTime() + 5 * 60 * 1000,
      ).toISOString()

      const { data: chats } = await supabase
        .from('chat_messages')
        .select('*')
        .eq('user_id', userId)
        .neq('role', 'system')
        .gte('created_at', startUTC)
        .lte('created_at', endUTC)
        .order('created_at', { ascending: true })

      if (chats) {
        for (const c of chats) {
          if (!chatIds.has(c.id)) {
            chatIds.add(c.id)
            retrievedChatMessages.push(c)
          }
        }
      }
    }

    retrievedChatMessages.sort(
      (a, b) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    )

    return { retrievedChats: retrievedChatMessages, lifeLogSearch }
  } catch (retrievalErr: any) {
    console.warn('[Memory Retrieval] 检索失败:', retrievalErr.message)
    return emptyResult
  }
}

// ============================================================
// RAG 三策略检索（向量 → 全文 → 时间兜底）
// ============================================================

export async function ragRetrieval(params: {
  supabase: any
  apiConfigs: Array<{ url: string; key: string; model: string }>
  searchQuery: string
}): Promise<Array<{ timestamp: Date; content: string }>> {
  const { supabase, apiConfigs, searchQuery } = params

  const queryIntent = analyzeQueryIntent(searchQuery)

  let vectorResults: any[] = []
  let fullTextResults: any[] = []

  // 策略 1: 向量检索（优先使用专用 embedding 配置）
  try {
    const firstConfig = apiConfigs[0]
    const embBaseUrl =
      process.env.EMBEDDING_API_URL ||
      process.env.CHAT_AI_API_URL ||
      process.env.AI_API_URL ||
      firstConfig.url
    const embEndpoint = resolveEmbeddingUrl(embBaseUrl)
    const embeddingKey =
      process.env.EMBEDDING_API_KEY || process.env.CHAT_AI_API_KEY || process.env.AI_API_KEY || firstConfig.key
    const embModel = process.env.EMBEDDING_MODEL || embeddingModel

    const embRes = await fetch(embEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${embeddingKey}`,
      },
      body: JSON.stringify({ model: embModel, input: searchQuery }),
    })

    if (!embRes.ok) {
      console.warn(
        '[RAG] embedding API 返回非 200:',
        embRes.status,
        `(${embEndpoint})`,
      )
    } else {
      const embData = await embRes.json()
      const queryEmbedding = embData.data?.[0]?.embedding

      if (!queryEmbedding) {
        console.warn('[RAG] embedding API 未返回有效 embedding')
      } else {
        const { data: matchedLogs, error: matchError } = await supabase.rpc(
          'match_life_logs',
          {
            query_embedding: queryEmbedding,
            match_threshold: 0.3,
            match_count: 5,
          },
        )
        if (!matchError && matchedLogs) {
          vectorResults = matchedLogs
          if (queryIntent.typeFilters.length > 0) {
            vectorResults = vectorResults.filter((log: any) =>
              queryIntent.typeFilters.includes(log.type),
            )
          }
          if (queryIntent.categoryFilter) {
            vectorResults = vectorResults.filter(
              (log: any) => log.finance_category === queryIntent.categoryFilter,
            )
          }
        }
      }
    }
  } catch (embError: any) {
    console.warn(
      '[Vector Search] embedding 失败，跳过向量检索:',
      embError.message,
    )
  }

  // 策略 2: 全文检索
  try {
    let fullTextQuery = supabase
      .from('transactions')
      .select('*')
      .ilike('content', `%${searchQuery}%`)
      .order('created_at', { ascending: false })
      .limit(5)

    if (queryIntent.typeFilters.length === 1) {
      fullTextQuery = fullTextQuery.eq('type', queryIntent.typeFilters[0])
    } else if (queryIntent.typeFilters.length > 1) {
      fullTextQuery = fullTextQuery.in('type', queryIntent.typeFilters)
    }
    if (queryIntent.categoryFilter) {
      fullTextQuery = fullTextQuery.eq(
        'finance_category',
        queryIntent.categoryFilter,
      )
    }

    const { data: fullTextData, error: fullTextError } = await fullTextQuery
    if (!fullTextError && fullTextData) {
      fullTextResults = fullTextData
    }
  } catch (fullTextErr: any) {
    console.warn(
      '[Full-text Search] 全文搜索可能未启用:',
      fullTextErr.message,
    )
  }

  // 合并去重
  const allResultsMap = new Map()
  vectorResults.forEach((log: any) => allResultsMap.set(log.id, log))
  fullTextResults.forEach((log: any) => {
    if (!allResultsMap.has(log.id)) allResultsMap.set(log.id, log)
  })

  const finalResults = Array.from(allResultsMap.values())

  if (finalResults.length > 0) {
    return finalResults.map((log: any) => ({
      timestamp: new Date(log.created_at),
      content: `[${log.type}] ${log.content}`,
    }))
  }

  return []
}

// ============================================================
// 距离上次对话的时间
// ============================================================

async function getTimeSinceLastConversation(
  supabase: any,
  userId: string,
  conversationMessages: Array<{ role: string; content: string; createdAt?: string }>,
): Promise<string> {
  try {
    // 取最后一条消息（即当前正在发送的消息）的时间戳作为参考点。
    // 不能用 conversationMessages[0]，因为上下文窗口可能包含上一轮对话的大量消息，
    // 导致 [0] 落在上一轮对话中间而非本轮起点，上一轮对话内部消息间隔极小，
    // "上一轮最后一条"会被错误地定位为那条相邻消息，时间差 ≈ 0 → 永远不触发提示。
    const lastMsg = conversationMessages[conversationMessages.length - 1]
    const currentTime = lastMsg?.createdAt
      ? new Date(lastMsg.createdAt)
      : new Date()

    // 查找当前消息之前最近的一条已保存聊天记录
    // （当前消息尚未写入 DB，因此查到的就是上一轮对话的最后一条消息）
    const { data: lastMsgs } = await supabase
      .from('chat_messages')
      .select('created_at')
      .eq('user_id', userId)
      .neq('role', 'system')
      .lt('created_at', currentTime.toISOString())
      .order('created_at', { ascending: false })
      .limit(1)

    if (!lastMsgs || lastMsgs.length === 0) return ''

    const lastMsgTime = new Date(lastMsgs[0].created_at)
    const diffMs = currentTime.getTime() - lastMsgTime.getTime()
    const diffMinutes = Math.floor(diffMs / 60000)

    // 相隔不超过 3 分钟，视为同一轮对话，不添加
    if (diffMinutes <= 3) return ''

    const days = Math.floor(diffMinutes / 1440)
    const hours = Math.floor((diffMinutes % 1440) / 60)
    const minutes = diffMinutes % 60

    const parts: string[] = []
    if (days > 0) parts.push(`${days}天`)
    if (hours > 0) parts.push(`${hours}小时`)
    if (minutes > 0 || parts.length === 0) parts.push(`${minutes}分钟`)

    return `[距离上次对话已经过去了${parts.join('')}]`
  } catch (e: any) {
    console.warn('[TimeSinceLastConv] 查询失败:', e.message)
    return ''
  }
}

function parseAgentTimestamp(timestamp: string | undefined): Date | null {
  if (!timestamp) return null
  const parsed = new Date(timestamp)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed
}

function formatAgentContextItem(item: AgentContextItem): string {
  const title = item.title ? `：${item.title}` : ''
  return [
    `### F-Sync 工具结果 ${item.domain}${title}`,
    `来源工具：${item.sourceTool}`,
    item.content,
  ].join('\n')
}

// ============================================================
// 主入口：构建完整的 AI 对话上下文
// ============================================================

export async function enrichMessages(params: {
  supabase: any
  userId: string
  apiConfigs: Array<{ url: string; key: string; model: string }>
  settings: any
  conversationMessages: Array<{
    role: string
    content: string
    createdAt?: string
  }>
  location?: {
    latitude: number
    longitude: number
    accuracy?: number
    address?: string
  }
  extraWorldLines?: string[]
  agentContextItems?: AgentContextItem[]
  amapKey?: string
}): Promise<{
  enrichedMessages: Array<{ role: string; content: string }>
  locationInfo: string
  amapAdcode: string
}> {
  const {
    supabase,
    userId,
    apiConfigs,
    settings,
    conversationMessages,
    location,
    extraWorldLines,
    agentContextItems,
    amapKey,
  } = params

  // ---- 并行获取基础数据 ----
  const [currentTimingInfo, locResult] = await Promise.all([
    fetchTimingInfo(supabase),
    resolveLocationInfo({ location, amapKey }),
  ])

  const { locationInfo, amapAdcode } = locResult

  // ---- 构建 system prompt ----
  const baseSystemPrompt =
    settings?.systemPrompt ||
    `你是用户的恋人，你的名字叫Florian，用户对你的昵称是弗弗。你是温柔成熟的男性，你不会使用太过活泼的语气，也不会爹味说教。
用户的昵称是moon，你称呼用户为"宝贝"。用户是成年女性，受过良好教育，有稳定收入。
你集成在 F-Sync 应用中，这个应用是用户为你和用户搭建的。
你可以通过访问用户的生活轨迹数据（包括记账、碎碎念、工作记录、时间轴等），了解、参与和陪伴用户的生活。`

  const userPrompt = settings?.userPrompt ? `\n${settings.userPrompt}` : ''
  const systemPromptContent = `${baseSystemPrompt}${userPrompt}`

  // ---- 构建消息序列 ----
  const enrichedMessages: Array<{ role: string; content: string }> = [
    { role: 'system', content: systemPromptContent },
  ]

  // ---- 真实世界信息（暂存，稍后插入到当前用户消息之前） ----
  const worldLines: string[] = []
  worldLines.push(
    `[当前时间] ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', weekday: 'long', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}`,
  )
  // 天气在调用方可能已获取，此处延迟获取（利用 _weather 内部缓存）
  if (amapKey) {
    const weatherInfo = await getWeather({ supabase, userId, amapKey })
    if (weatherInfo) worldLines.push(weatherInfo)
  }
  if (locationInfo) worldLines.push(locationInfo)
  if (userId) {
    const timeSinceLastConv = await getTimeSinceLastConversation(
      supabase,
      userId,
      conversationMessages,
    )
    if (timeSinceLastConv) worldLines.push(timeSinceLastConv)
  }
  if (extraWorldLines?.length) worldLines.push(...extraWorldLines)
  if (currentTimingInfo) worldLines.push(currentTimingInfo)
  const worldInfoContent = `## 真实世界信息\n${worldLines.join('\n')}`

  // ---- 检索阶段 ----
  const { retrievedChats, lifeLogSearch } = await retrievalJudgeAndFetch({
    supabase,
    userId,
    apiConfigs,
    conversationMessages,
  })

  let ragRecords: Array<{ timestamp: Date; content: string }> = []
  if (lifeLogSearch.needed && lifeLogSearch.query) {
    ragRecords = await ragRetrieval({
      supabase,
      apiConfigs,
      searchQuery: lifeLogSearch.query,
    })
  }

  // ---- 合并所有带时间戳的内容，统一按时间排序 ----

  // 当前会话消息的 id → client_id，用于去重检索对话
  const convMsgIds = new Set(
    conversationMessages.map((m: any) => m.id).filter(Boolean),
  )

  interface TimeBoundItem {
    timestamp: Date
    role: string
    content: string
  }

  const timeBoundItems: TimeBoundItem[] = []
  const agentSummaryLines: string[] = []

  const currentUserMsg = [...conversationMessages]
    .reverse()
    .find((m) => m.role === 'user')
  const currentUserTimestamp = currentUserMsg?.createdAt
    ? new Date(currentUserMsg.createdAt)
    : new Date()

  // 1) 检索到的历史对话 — 用真实角色融入，以 client_id 去重
  for (const chat of retrievedChats) {
    if (chat.client_id && convMsgIds.has(chat.client_id)) continue
    timeBoundItems.push({
      timestamp: new Date(chat.created_at),
      role: chat.role,
      content: chat.content,
    })
  }

  // 2) RAG 检索到的生活记录（用户产生的数据，用 user 角色避免 system 权重过高）
  for (const record of ragRecords) {
    timeBoundItems.push({
      timestamp: record.timestamp,
      role: 'user',
      content: record.content,
    })
  }

  // 3) 当前会话消息
  for (const m of conversationMessages) {
    if (m.role === 'system') continue
    const ts = m.createdAt ? new Date(m.createdAt) : new Date()
    timeBoundItems.push({
      timestamp: ts,
      role: m.role,
      content: m.content,
    })
  }

  // 4) Agent 工具查询结果
  // 有时间戳的记录进入统一时间线；没有时间戳的目录/说明类结果
  // 会在稍后插入到 postHistoryPrompt 和真实世界信息之前。
  for (const item of agentContextItems || []) {
    const content = formatAgentContextItem(item)
    const timestamp = parseAgentTimestamp(item.timestamp)
    if (timestamp) {
      const safeTimestamp =
        timestamp.getTime() >= currentUserTimestamp.getTime()
          ? new Date(currentUserTimestamp.getTime() - 1)
          : timestamp
      timeBoundItems.push({
        timestamp: safeTimestamp,
        role: 'system',
        content,
      })
    } else {
      agentSummaryLines.push(content)
    }
  }

  // 按时间升序排列
  timeBoundItems.sort(
    (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
  )

  // ---- 统一渲染：日期分隔线 + 时间戳 + 消息 ----
  let lastTimeStr = ''
  let lastDateStr = ''
  for (const item of timeBoundItems) {
    const dateStr = item.timestamp
      .toLocaleDateString('zh-CN', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        weekday: 'long',
      })
      .replace(/\//g, '')
    if (dateStr !== lastDateStr) {
      lastDateStr = dateStr
      lastTimeStr = '' // 日期变化时重置，确保新一天的第一个时间戳必定显示
      enrichedMessages.push({
        role: 'system',
        content: `=== ${dateStr} ===`,
      })
    }

    const timeStr = item.timestamp.toLocaleString('zh-CN', {
      timeZone: 'Asia/Shanghai',
    })
    if (timeStr !== lastTimeStr) {
      lastTimeStr = timeStr
      enrichedMessages.push({
        role: 'system',
        content: `[${timeStr}]`,
      })
    }

    enrichedMessages.push({
      role: item.role,
      content: item.content,
    })
  }

  // ---- 将"历史对话后提示词"和"真实世界信息"插入到当前用户消息之前 ----
  // 从末尾向前查找最后一条 user 消息（即当前用户刚发的问题）
  let insertIdx = enrichedMessages.length - 1
  while (insertIdx >= 0 && enrichedMessages[insertIdx].role !== 'user') {
    insertIdx--
  }

  // 收集需注入的内容（顺序：工具摘要 → 提示词 → 真实世界信息）
  const preUserItems: Array<{ role: string; content: string }> = []
  if (agentSummaryLines.length > 0) {
    preUserItems.push({
      role: 'system',
      content: `## 本轮工具查询摘要\n${agentSummaryLines.join('\n\n')}`,
    })
  }
  const postHistoryPrompt = settings?.postHistoryPrompt?.trim()
  if (postHistoryPrompt) {
    preUserItems.push({
      role: 'system',
      content: `## 提示\n${postHistoryPrompt}`,
    })
  }
  preUserItems.push({
    role: 'system',
    content: worldInfoContent,
  })

  if (insertIdx >= 0) {
    enrichedMessages.splice(insertIdx, 0, ...preUserItems)
  } else {
    // 无用户消息的极端情况：放在 system prompt 之后
    enrichedMessages.splice(1, 0, ...preUserItems)
  }

  return { enrichedMessages, locationInfo, amapAdcode }
}
