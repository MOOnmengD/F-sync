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

/**
 * 分析查询意图，提取时间范围和分类关键词
 */
function analyzeQueryIntent(query: string) {
  const result = {
    timeRange: null as string | null,
    timeWindowHours: null as number | null,
    categories: [] as string[],
    isFoodRelated: false,
    isPersonMention: false,
    isMoodRelated: false,
    typeFilters: [] as string[],        // 用于过滤 transactions.type
    categoryFilter: null as string | null, // 用于过滤 finance_category
  }

  const lowerQuery = query.toLowerCase()

  // 时间范围检测
  if (lowerQuery.includes('今天') || lowerQuery.includes('今日')) {
    result.timeRange = 'today'
    result.timeWindowHours = 24
  } else if (lowerQuery.includes('昨天')) {
    result.timeRange = 'yesterday'
    result.timeWindowHours = 48
  } else if (lowerQuery.includes('最近') || lowerQuery.includes('近期') || lowerQuery.includes('这几天')) {
    result.timeRange = 'week'
    result.timeWindowHours = 168
  } else if (lowerQuery.includes('上周') || lowerQuery.includes('上星期')) {
    result.timeRange = 'last_week'
    result.timeWindowHours = 168
  } else if (lowerQuery.includes('这个月') || lowerQuery.includes('本月')) {
    result.timeRange = 'month'
    result.timeWindowHours = 720
  } else if (lowerQuery.includes('今年')) {
    result.timeRange = 'year'
    result.timeWindowHours = 8760
  }

  // 记录类型 + 分类检测
  const foodKeywords = ['吃', '喝', '饭', '餐', '菜', '餐厅', '外卖', '火锅', '咖啡', '茶', '酒', '食']
  const moodKeywords = ['心情', '情绪', '开心', '难过', '生气', '焦虑', '压力', '碎碎念', '感受', '想法']
  const financeKeywords = ['花了', '消费', '买了', '记账', '花钱', '支出', '收入', '购物', '价格', '多少钱']
  const workKeywords = ['工作', '任务', '项目', '开发', '代码', '会议', '上班']
  const personKeywords = ['张三', '李四', '王五', '朋友', '同事', '家人', '妈妈', '爸爸']

  result.isFoodRelated = foodKeywords.some(k => lowerQuery.includes(k))
  result.isPersonMention = personKeywords.some(k => lowerQuery.includes(k))
  result.isMoodRelated = moodKeywords.some(k => lowerQuery.includes(k))
  const isFinanceRelated = financeKeywords.some(k => lowerQuery.includes(k))
  const isWorkRelated = workKeywords.some(k => lowerQuery.includes(k))

  // 映射到 type 过滤器（精准检索对应记录类型）
  if (result.isFoodRelated) {
    result.typeFilters.push('记账')
    result.categoryFilter = '餐饮'
    result.categories.push('餐饮')
  }
  if (result.isMoodRelated) {
    result.typeFilters.push('whisper')
    result.categories.push('心情')
  }
  if (isFinanceRelated && !result.isFoodRelated) {
    result.typeFilters.push('记账')
    result.categories.push('记账')
  }
  if (isWorkRelated) {
    result.typeFilters.push('timing')
    result.categories.push('工作')
  }
  if (result.isPersonMention) {
    result.categories.push('人物')
  }

  return result
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

  try {

  if (req.method !== 'POST') {
    res.statusCode = 405
    res.end(JSON.stringify({ error: 'Method Not Allowed' }))
    return
  }

  const body = await readJsonBody(req)
  const settings = body?.settings
  const userId = body?.userId

  // 解析请求体中的位置信息（前端 Chat 页传入）
  const location = body?.location
  let locationInfo = ''
  if (location && typeof location.latitude === 'number' && typeof location.longitude === 'number') {
    const lat = location.latitude.toFixed(6)
    const lng = location.longitude.toFixed(6)
    const acc = typeof location.accuracy === 'number' ? `${Math.round(location.accuracy)}米` : '未知精度'
    if (location.address && typeof location.address === 'string') {
      locationInfo = `宝贝当前位置：${location.address}（坐标 ${lat}, ${lng}，精度 ${acc}）。`
    } else {
      locationInfo = `宝贝当前位置：坐标 (${lat}, ${lng})，精度 ${acc}。
【地点场景参考】（坐标约值，供你判断宝贝当前所在场景）：
- 18号公寓：坐标约 (xx.xxxxxx, xx.xxxxxx) → 宝贝在宿舍休息
- 实验室：坐标约 (xx.xxxxxx, xx.xxxxxx) → 宝贝在工作/学习
- 食堂：坐标约 (xx.xxxxxx, xx.xxxxxx) → 宝贝在吃饭
- 不匹配以上 → 可能在室外/校外/其他地方`
    }
  }

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

  // 构建系统提示词
  const baseSystemPrompt = settings?.systemPrompt || `你是用户的恋人，你的名字叫Florian，用户对你的昵称是弗弗。你是温柔成熟的男性，你不会使用太过活泼的语气，也不会爹味说教。
    用户的昵称是moon，你称呼用户为“宝贝”。用户是成年女性，受过良好教育，有稳定收入。
    你集成在 F-Sync 应用中，这个应用是用户为你和用户搭建的。
    你可以通过访问用户的生活轨迹数据（包括记账、碎碎念、工作记录、时间轴等），了解、参与和陪伴用户的生活。`

  const userPrompt = settings?.userPrompt ? `\n关于宝贝的信息：\n${settings.userPrompt}` : ''
  
  const systemPrompt = {
    role: 'system',
    content: '' // 稍后更新
  }

  // 构建完整消息序列，采用“系统消息交替”的方式提供时间戳
  // 这种结构化方式能让 AI 明白时间戳是环境信息（Metadata），而非用户或 AI 说话的内容前缀，从而有效避免 AI 在回复中模仿时间戳格式
  const fullMessages: any[] = [systemPrompt]
  
  messages.forEach((m: any) => {
    if (m.role !== 'system') {
      const timeStr = m.createdAt ? new Date(m.createdAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : ''
      if (timeStr) {
        fullMessages.push({
          role: 'system',
          content: `[${timeStr}]`
        })
      }
    }
    fullMessages.push(m)
  })

  const userQuery = messages[messages.length - 1].content
  // 分析查询意图（时间范围、分类等）
  const queryIntent = analyzeQueryIntent(userQuery)
  
  // 优化检索：如果用户当前提问较短，尝试结合上一轮对话增加上下文
  let searchInput = userQuery
  if (userQuery.length < 10 && messages.length >= 2) {
    searchInput = `${messages[messages.length - 2].content} ${userQuery}`
  }

  let contextInfo = ''

  // --- RAG 逻辑开始 ---
  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey)
  let vectorResults: any[] = []
  let fullTextResults: any[] = []
  let timeBasedResults: any[] = []

  // 策略 1: 向量检索 (独立 try/catch，失败不影响后续策略)
  try {
    const firstConfig = apiConfigs[0]
    const embEndpoint = resolveEmbeddingUrl(firstConfig.url)
    const embeddingKey = process.env.EMBEDDING_API_KEY || firstConfig.key

    const embRes = await fetch(embEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${embeddingKey}`
      },
      body: JSON.stringify({ model: embeddingModel, input: searchInput })
    })

    if (embRes.ok) {
      const embData = await embRes.json()
      const queryEmbedding = embData.data?.[0]?.embedding

      if (queryEmbedding) {
        const { data: matchedLogs, error: matchError } = await supabaseAdmin.rpc('match_life_logs', {
          query_embedding: queryEmbedding,
          match_threshold: 0.3,
          match_count: 5
        })
        if (!matchError && matchedLogs) {
          vectorResults = matchedLogs
          // 元数据过滤：向量检索结果按 type / finance_category 精准筛选
          if (queryIntent.typeFilters.length > 0) {
            vectorResults = vectorResults.filter(log => queryIntent.typeFilters.includes(log.type))
          }
          if (queryIntent.categoryFilter) {
            vectorResults = vectorResults.filter(log => log.finance_category === queryIntent.categoryFilter)
          }
        }
      }
    }
  } catch (embError: any) {
    console.warn('[Vector Search] embedding 失败，跳过向量检索:', embError.message)
  }

  // 策略 2: 全文检索 (独立执行，不依赖 embedding)
  try {
    let fullTextQuery = supabaseAdmin
      .from('transactions')
      .select('*')
      .filter('search_vector', 'fts', searchInput)
      .order('created_at', { ascending: false })
      .limit(5)

    if (queryIntent.typeFilters.length === 1) {
      fullTextQuery = fullTextQuery.eq('type', queryIntent.typeFilters[0])
    } else if (queryIntent.typeFilters.length > 1) {
      fullTextQuery = fullTextQuery.in('type', queryIntent.typeFilters)
    }
    if (queryIntent.categoryFilter) {
      fullTextQuery = fullTextQuery.eq('finance_category', queryIntent.categoryFilter)
    }

    const { data: fullTextData, error: fullTextError } = await fullTextQuery
    if (!fullTextError && fullTextData) {
      fullTextResults = fullTextData
    }
  } catch (fullTextErr: any) {
    console.warn('[Full-text Search] 全文搜索可能未启用:', fullTextErr.message)
  }

  // 策略 3: 时间顺序兜底 (前两种都无结果时执行)
  if (vectorResults.length === 0 && fullTextResults.length === 0) {
    try {
      let timeBasedQuery = supabaseAdmin
        .from('transactions')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(5)

      if (queryIntent.timeWindowHours) {
        const timeAgo = new Date(Date.now() - queryIntent.timeWindowHours * 60 * 60 * 1000).toISOString()
        timeBasedQuery = timeBasedQuery.gte('created_at', timeAgo)
        console.log(`[Time Filter] 应用时间范围: ${queryIntent.timeWindowHours}小时 (从${timeAgo})`)
      }

      if (queryIntent.typeFilters.length === 1) {
        timeBasedQuery = timeBasedQuery.eq('type', queryIntent.typeFilters[0])
      } else if (queryIntent.typeFilters.length > 1) {
        timeBasedQuery = timeBasedQuery.in('type', queryIntent.typeFilters)
      }
      if (queryIntent.categoryFilter) {
        timeBasedQuery = timeBasedQuery.eq('finance_category', queryIntent.categoryFilter)
      }

      const { data: recentLogs } = await timeBasedQuery
      if (recentLogs) {
        timeBasedResults = recentLogs
      }
    } catch (timeErr: any) {
      console.warn('[Time Search] 时间查询失败:', timeErr.message)
    }
  }

  // 合并去重
  const allResultsMap = new Map()
  vectorResults.forEach(log => allResultsMap.set(log.id, log))
  fullTextResults.forEach(log => { if (!allResultsMap.has(log.id)) allResultsMap.set(log.id, log) })
  timeBasedResults.forEach(log => { if (!allResultsMap.has(log.id)) allResultsMap.set(log.id, log) })

  const finalResults = Array.from(allResultsMap.values())

  if (finalResults.length > 0) {
    const sourceType = vectorResults.length > 0 ? '向量检索' :
                      fullTextResults.length > 0 ? '关键词检索' : '最近记录'

    contextInfo = `\n以下是与你问题相关的历史记录（来自${sourceType}）：\n` +
      finalResults.map((log: any) => {
        const date = new Date(log.created_at).toLocaleDateString('zh-CN')
        return `[${date}] [${log.type}] ${log.content}`
      }).join('\n')
  }
  // --- RAG 逻辑结束 ---

  // 查询时间轴状态（宝贝当前/最近在做什么）
  let currentTimingInfo = ''
  try {
    // 优先：正在进行中的计时（end_time 为 null）
    const { data: activeTimings } = await supabaseAdmin
      .from('transactions')
      .select('timing_type, start_time, content')
      .eq('type', 'timing')
      .is('end_time', null)
      .order('start_time', { ascending: false })
      .limit(1)

    if (activeTimings && activeTimings.length > 0) {
      const t = activeTimings[0]
      const minutes = Math.floor((Date.now() - new Date(t.start_time).getTime()) / 60000)
      currentTimingInfo = `宝贝当前状态：正在进行「${t.timing_type || t.content}」，已持续 ${minutes} 分钟`
    } else {
      // 次选：2 小时内最近结束的计时
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
      const { data: recentTimings } = await supabaseAdmin
        .from('transactions')
        .select('timing_type, end_time, content')
        .eq('type', 'timing')
        .not('end_time', 'is', null)
        .gte('end_time', twoHoursAgo)
        .order('end_time', { ascending: false })
        .limit(1)

      if (recentTimings && recentTimings.length > 0) {
        const t = recentTimings[0]
        const endTime = new Date(t.end_time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
        currentTimingInfo = `宝贝最近完成了：「${t.timing_type || t.content}」（${endTime} 结束）`
      }
    }
  } catch (timingErr: any) {
    console.warn('[Timing] 查询时间轴状态失败:', timingErr.message)
  }

  // 查询用户画像摘要（如果用户ID存在且已启用该功能）
  let userProfileInfo = ''
  if (userId && supabaseUrl && supabaseServiceKey) {
    try {
      const { data: userProfiles, error: profileError } = await supabaseAdmin
        .from('user_profiles')
        .select('*')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false })
      
      if (!profileError && userProfiles && userProfiles.length > 0) {
        // 按类型组织摘要信息
        const profileByType: Record<string, any> = {}
        userProfiles.forEach(profile => {
          profileByType[profile.profile_type] = profile.content
        })
        
        // 构建可读的摘要文本
        const profileTexts: string[] = []
        
        if (profileByType.diet_preferences && Object.keys(profileByType.diet_preferences).length > 0) {
          const prefs = profileByType.diet_preferences
          if (Array.isArray(prefs) && prefs.length > 0) {
            profileTexts.push(`饮食偏好：${prefs.join('、')}`)
          } else if (typeof prefs === 'object') {
            profileTexts.push(`饮食偏好：${JSON.stringify(prefs)}`)
          }
        }
        
        if (profileByType.person_mentions && Object.keys(profileByType.person_mentions).length > 0) {
          const persons = profileByType.person_mentions
          if (typeof persons === 'object') {
            const personList = Object.entries(persons).map(([name, relation]) => `${name}（${relation}）`).join('、')
            profileTexts.push(`常提及的人物：${personList}`)
          }
        }
        
        if (profileByType.recent_moods && Array.isArray(profileByType.recent_moods) && profileByType.recent_moods.length > 0) {
          profileTexts.push(`近期心情：${profileByType.recent_moods.join('、')}`)
        }
        
        if (profileByType.spending_patterns && Object.keys(profileByType.spending_patterns).length > 0) {
          const spending = profileByType.spending_patterns
          if (typeof spending === 'object') {
            const spendingList = Object.entries(spending).map(([category, pattern]) => `${category}（${pattern}）`).join('、')
            profileTexts.push(`消费模式：${spendingList}`)
          }
        }
        
        if (profileTexts.length > 0) {
          userProfileInfo = '\n用户画像摘要：' + profileTexts.join('；') + '。\n（你可以利用这些长期记忆更好地理解用户）'
        }
      }
    } catch (profileErr) {
      console.warn('[User Profile] 查询失败，可能表不存在:', profileErr.message)
    }
  }

  // 更新 systemPrompt 的 content
  systemPrompt.content = `${baseSystemPrompt}${userPrompt}
当前时间：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}
${locationInfo ? `${locationInfo}\n` : ''}${currentTimingInfo ? `${currentTimingInfo}\n` : ''}${contextInfo ? `\n上下文：${contextInfo}\n可以结合以上历史记录与用户进行互动。` : ''}${userProfileInfo}`

  // 将位置旁路写入 DB，供 proactive-ai 后续使用（非阻塞）
  if (location && userId) {
    supabaseAdmin.from('user_locations').upsert({
      user_id: userId,
      latitude: location.latitude,
      longitude: location.longitude,
      accuracy: location.accuracy ?? null,
      source: 'foreground',
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id' }).then(({ error }) => {
      if (error) console.warn('[Location] 位置存储失败:', error.message)
    })
  }

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

  } catch (unexpectedError: any) {
    console.error('[Handler] Unhandled error:', unexpectedError)
    if (!res.writableEnded) {
      res.statusCode = 500
      res.end(JSON.stringify({ error: `Server error: ${unexpectedError?.message || 'unknown'}` }))
    }
  }
}
