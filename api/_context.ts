import { getWeather } from './_weather.js'
import {
  matchCampusLocation,
  resolveChatCompletionsUrl,
  resolveEmbeddingUrl,
  analyzeQueryIntent,
} from './_utils.js'

const embeddingModel = process.env.EMBEDDING_MODEL || 'text-embedding-3-small'

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

export async function fetchTopDailyEvents(supabase: any): Promise<string> {
  try {
    const { data: topEvents } = await supabase
      .from('daily_event_items')
      .select('type, status, content, chat_time_start, date')
      .order('date', { ascending: false })
      .order('sort_order', { ascending: true })
      .limit(3)

    if (topEvents && topEvents.length > 0) {
      const lines: string[] = []
      topEvents.forEach((it: any) => {
        const time = it.chat_time_start ? it.chat_time_start.slice(0, 5) + ' ' : ''
        if (it.type === 'todo') {
          const mark = it.status === 'done' ? '✓' : '○'
          lines.push(`[${mark}] ${it.date} ${time}${it.content}`)
        } else {
          lines.push(`- ${it.date} ${time}${it.content}`)
        }
      })
      return `## 最近事件\n${lines.join('\n')}`
    }
  } catch (e: any) {
    console.warn('[Auto Surface] 查询失败:', e.message)
  }
  return ''
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
}): Promise<any[]> {
  const { supabase, userId, apiConfigs, conversationMessages } = params

  if (apiConfigs.length === 0) return []

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

    if (recentMsgs.length < 2) return []

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
              '你是一个对话分析模块。判断以下对话中，用户的当前消息是否涉及过去讨论过的话题或事件。\n\n如果是，生成用于检索的关键词/短句（使用用户使用的语言）。\n如果否，返回 needs_retrieval: false。\n\n只输出 JSON：\n{"needs_retrieval": true, "keywords": "简短的关键词或短句"}\n或 {"needs_retrieval": false}',
          },
          { role: 'user', content: dialogText },
        ],
        temperature: 0,
        response_format: { type: 'json_object' },
      }),
    })

    if (!judgeRes.ok) {
      console.warn('[Memory Retrieval] judge API 返回非 200:', judgeRes.status)
      return []
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

    if (!judgeResult?.needs_retrieval || !judgeResult?.keywords) {
      if (!judgeResult?.needs_retrieval) {
        console.log('[Memory Retrieval] AI 判断无需检索')
      } else {
        console.warn('[Memory Retrieval] AI 判断需检索但未返回 keywords')
      }
      return []
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
        input: judgeResult.keywords,
      }),
    })

    if (!embRes.ok) {
      console.warn(
        '[Memory Retrieval] embedding API 返回非 200:',
        embRes.status,
        `(${embEndpoint})`,
      )
      return []
    }

    const embData = await embRes.json()
    const queryEmbedding = embData.data?.[0]?.embedding
    if (!queryEmbedding) {
      console.warn('[Memory Retrieval] embedding API 未返回有效 embedding')
      return []
    }

    const { data: matchedEvents } = await supabase.rpc(
      'match_daily_event_items',
      {
        query_embedding: queryEmbedding,
        match_threshold: 0.3,
        match_count: 5,
      },
    )

    if (!matchedEvents || matchedEvents.length === 0) return []

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

    return retrievedChatMessages
  } catch (retrievalErr: any) {
    console.warn('[Memory Retrieval] 检索失败:', retrievalErr.message)
    return []
  }
}

// ============================================================
// RAG 三策略检索（向量 → 全文 → 时间兜底）
// ============================================================

export async function ragRetrieval(params: {
  supabase: any
  apiConfigs: Array<{ url: string; key: string; model: string }>
  searchQuery: string
}): Promise<string> {
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
    const sourceType =
      vectorResults.length > 0 ? '向量检索' : '关键词检索'

    return (
      `以下是与你问题相关的历史记录（来自${sourceType}）：\n` +
      finalResults
        .map((log: any) => {
          const date = new Date(log.created_at).toLocaleDateString('zh-CN')
          return `[${date}] [${log.type}] ${log.content}`
        })
        .join('\n')
    )
  }

  return ''
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
  searchQuery?: string
  location?: {
    latitude: number
    longitude: number
    accuracy?: number
    address?: string
  }
  extraWorldLines?: string[]
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
    searchQuery,
    location,
    extraWorldLines,
    amapKey,
  } = params

  // ---- 并行获取基础数据 ----
  const [autoSurfaceText, currentTimingInfo, locResult] =
    await Promise.all([
      fetchTopDailyEvents(supabase),
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

  // Layer 1: 真实世界信息
  const worldLines: string[] = []
  worldLines.push(
    `[当前时间] ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`,
  )
  // 天气在调用方可能已获取，此处延迟获取（利用 _weather 内部缓存）
  if (amapKey) {
    const weatherInfo = await getWeather({ supabase, userId, amapKey })
    if (weatherInfo) worldLines.push(weatherInfo)
  }
  if (locationInfo) worldLines.push(locationInfo)
  if (extraWorldLines?.length) worldLines.push(...extraWorldLines)
  if (currentTimingInfo) worldLines.push(currentTimingInfo)
  enrichedMessages.push({
    role: 'system',
    content: `## 真实世界信息\n${worldLines.join('\n')}`,
  })

  let nextIdx = 2 // 后续 system 消息的插入位置

  // Layer 2: 最近事件（top-3，始终注入）
  if (autoSurfaceText) {
    enrichedMessages.push({ role: 'system', content: autoSurfaceText })
    nextIdx++
  }

  // Layer 3: 检索前置判断 → 相关历史对话
  const retrievedChats = await retrievalJudgeAndFetch({
    supabase,
    userId,
    apiConfigs,
    conversationMessages,
  })

  if (retrievedChats.length > 0) {
    const chatLines = retrievedChats.map((c: any) => {
      const time = new Date(c.created_at).toLocaleString('zh-CN', {
        timeZone: 'Asia/Shanghai',
      })
      const speaker = c.role === 'user' ? '宝贝' : 'Florian'
      return `[${time}] ${speaker}: ${c.content}`
    })
    enrichedMessages.push({
      role: 'system',
      content: `## 相关历史对话\n以下是与当前话题相关的历史对话原文：\n${chatLines.join('\n')}`,
    })
    nextIdx++
  }

  // Layer 4: RAG 生活记录检索
  if (searchQuery) {
    const contextInfo = await ragRetrieval({
      supabase,
      apiConfigs,
      searchQuery,
    })

    if (contextInfo) {
      const cleaned = contextInfo.replace(
        /^\n*以下是与你问题相关的历史记录（来自[^）]*）：\n?/,
        '',
      )
      enrichedMessages.push({
        role: 'system',
        content: `## 生活记录数据\n通过向量/关键词检索，可能与当前对话相关：\n${cleaned}`,
      })
      nextIdx++
    }
  }

  // ---- 注入对话消息（带时间戳 + 日期分隔线） ----
  let lastTimeStr = ''
  let lastDateStr = ''
  for (const m of conversationMessages) {
    if (m.role !== 'system') {
      const d = m.createdAt ? new Date(m.createdAt) : null
      const timeStr = d
        ? d.toLocaleString('zh-CN', {
            timeZone: 'Asia/Shanghai',
          })
        : ''
      // 日期变化时插入分隔线（程序自动检测，不依赖 AI）
      if (d) {
        const dateStr = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
        if (dateStr !== lastDateStr) {
          lastDateStr = dateStr
          enrichedMessages.push({
            role: 'system',
            content: `=== ${dateStr} ===`,
          })
        }
      }
      if (timeStr && timeStr !== lastTimeStr) {
        lastTimeStr = timeStr
        enrichedMessages.push({
          role: 'system',
          content: `[${timeStr}]`,
        })
      }
    }
    enrichedMessages.push(m)
  }

  return { enrichedMessages, locationInfo, amapAdcode }
}
