import { createClient } from '@supabase/supabase-js'
import jwt from 'jsonwebtoken'

const chatModel = process.env.CHAT_AI_MODEL || 'deepseek-chat'

// 校内地标（新增地点时只改这里）
const CAMPUS_LOCATIONS = [
  { name: '21号楼·实验室', lat: 45.773298, lng: 126.675110, scene: '宝贝在工作/学习' },
  { name: '小美食堂',     lat: 45.771397, lng: 126.678529, scene: '宝贝在吃饭' },
  { name: '18公寓·宿舍',  lat: 45.769784, lng: 126.679770, scene: '宝贝在休息' },
]
const CAMPUS_MATCH_RADIUS = 100 // 米

function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000
  const rad = (d: number) => d * Math.PI / 180
  const dLat = rad(lat2 - lat1)
  const dLng = rad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function matchCampusLocation(lat: number, lng: number): string | null {
  let bestDist = Infinity
  let best: (typeof CAMPUS_LOCATIONS)[0] | null = null
  for (const loc of CAMPUS_LOCATIONS) {
    const d = haversineDistance(lat, lng, loc.lat, loc.lng)
    if (d < bestDist) { bestDist = d; best = loc }
  }
  if (best && bestDist <= CAMPUS_MATCH_RADIUS) {
    return `${best.name}（${best.scene}）`
  }
  return null
}

function getHuaweiAccessToken(): string {
  const keyId = process.env.HUAWEI_KEY_ID
  const subAccount = process.env.HUAWEI_SUB_ACCOUNT
  const rawKey = process.env.HUAWEI_PRIVATE_KEY
  if (!keyId || !subAccount || !rawKey) throw new Error('Missing HUAWEI_KEY_ID / HUAWEI_SUB_ACCOUNT / HUAWEI_PRIVATE_KEY')

  // 按官方 Node.js 示例处理 PEM：替换 \n 后取前 3 行重新拼接
  const lines = rawKey.replace(/\\n/g, '\n').split('\n')
  const PRIVATE_KEY = lines.slice(0, 3).join('\n')
  console.log('[Push] JWT kid:', keyId, '| sub_account:', subAccount)

  const header = { alg: 'PS256', kid: keyId, typ: 'JWT' }
  const payload = {
    iss: subAccount,
    aud: 'https://oauth-login.cloud.huawei.com/oauth2/v3/token',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600
  }
  return jwt.sign(payload, PRIVATE_KEY, { algorithm: 'PS256', header })
}

async function sendHuaweiPush(supabase: any, userId: string, title: string, body: string): Promise<void> {
  const { data: tokenRow } = await supabase
    .from('push_tokens')
    .select('token')
    .eq('user_id', userId)
    .eq('platform', 'harmony')
    .single()

  if (!tokenRow?.token) {
    console.log('[Push] 未找到设备 token，跳过推送')
    return
  }

  const pushToken = String(tokenRow.token).trim()
  console.log('[Push] token 长度:', pushToken.length, '前8位:', pushToken.substring(0, 8))

  const accessToken = getHuaweiAccessToken()
  console.log('[Push] JWT 前12位:', accessToken.substring(0, 12))

  const projectId = process.env.HUAWEI_PROJECT_ID
  console.log('[Push] 使用 projectId:', projectId)

  const payload = {
    payload: {
      notification: {
        category: 'IM',
        title,
        body,
        clickAction: { actionType: 0 }
      }
    },
    target: {
      token: [pushToken]
    }
  }
  console.log('[Push] 请求体:', JSON.stringify(payload))

  const pushRes = await fetch(`https://push-api.cloud.huawei.com/v3/${projectId}/messages:send`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json;charset=utf-8',
      'Authorization': `Bearer ${accessToken}`,
      'push-type': '0'
    },
    body: JSON.stringify(payload)
  })

  const pushData = await pushRes.json()
  console.log('[Push] 完整响应:', JSON.stringify(pushData))
  if (pushData.code !== '80000000') {
    throw new Error(`Huawei Push failed: ${pushData.code} ${pushData.msg}`)
  }
  console.log('[Push] 华为推送成功:', pushData.requestId)
}

function resolveChatCompletionsUrl(base: string) {
  const trimmed = base.trim().replace(/\/+$/, '')
  if (!trimmed) return ''
  if (trimmed.endsWith('/chat/completions')) return trimmed
  return `${trimmed}/chat/completions`
}

/**
 * 异步更新用户画像摘要
 * 不阻塞主动消息发送，失败时仅记录错误
 */
async function updateUserProfileSummary(params: {
  supabase: any,
  userId: string,
  recentLogs: any[],
  recentChats: any[],
  apiConfigs: any[],
  settings?: any
}) {
  const { supabase, userId, recentLogs, recentChats, apiConfigs, settings } = params
  
  try {
    // 如果没有足够的数据，跳过摘要更新
    if (recentLogs.length === 0 && recentChats.length === 0) {
      console.log('[Profile Summary] 无足够数据，跳过摘要更新')
      return
    }
    
    // 构建摘要生成提示词
    const summaryPrompt = `你是一个专门分析用户生活记录的 AI 助手。请根据以下数据，生成结构化的用户画像摘要。
    
用户最近的生活记录（最近12小时）：
${recentLogs.map(log => `- [${log.type}] ${log.content} ${log.finance_category ? `(${log.finance_category})` : ''}`).join('\n') || '暂无记录'}

用户最近的对话（最近30条）：
${recentChats.map(c => `- ${c.role}: ${c.content}`).join('\n') || '暂无对话'}

请生成以下类型的结构化摘要（JSON格式）：
1. "diet_preferences": 饮食偏好（从记账记录中提取，如常吃菜系、偏好口味）
2. "person_mentions": 常提及的人物（从碎碎念和对话中提取，记录人物名称和关系）
3. "recent_moods": 近期心情趋势（从碎碎念中提取情绪变化）
4. "spending_patterns": 消费模式（从记账记录中提取消费类别和时间规律）

输出要求：仅输出一个纯 JSON 对象，不要有任何额外的解释或标记。
示例格式：
{
  "diet_preferences": ["喜欢吃辣", "常点外卖"],
  "person_mentions": {"张三": "同事", "李四": "朋友"},
  "recent_moods": ["平静", "有点焦虑"],
  "spending_patterns": {"餐饮": "高频", "购物": "低频"}
}`

    // 使用第一组 API 配置生成摘要
    const config = apiConfigs[0]
    const endpoint = resolveChatCompletionsUrl(config.url)
    
    const aiRes = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.key}`
      },
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: 'system', content: summaryPrompt }],
        temperature: 0.3, // 较低温度以获得更稳定的 JSON 输出
        response_format: { type: "json_object" } // 请求 JSON 格式输出（如果 API 支持）
      })
    })
    
    if (!aiRes.ok) {
      const errorText = await aiRes.text()
      throw new Error(`摘要生成 API 失败: ${aiRes.status} ${errorText}`)
    }
    
    const aiData = await aiRes.json()
    const summaryJsonStr = aiData.choices?.[0]?.message?.content
    
    if (!summaryJsonStr) {
      throw new Error('AI 未返回有效摘要内容')
    }
    
    // 解析 JSON
    let summaryData
    try {
      summaryData = JSON.parse(summaryJsonStr)
    } catch (parseError) {
      console.error('[Profile Summary] JSON 解析失败:', parseError, '原始内容:', summaryJsonStr)
      // 尝试提取 JSON（如果 AI 添加了额外文本）
      const jsonMatch = summaryJsonStr.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        summaryData = JSON.parse(jsonMatch[0])
      } else {
        throw new Error('无法解析 JSON 响应')
      }
    }
    
    // 更新数据库（每种类型单独存储，便于后续检索）
    const profileTypes = ['diet_preferences', 'person_mentions', 'recent_moods', 'spending_patterns']
    
    for (const profileType of profileTypes) {
      const content = summaryData[profileType] || {}
      
      // 使用 upsert 更新或插入记录
      const { error: upsertError } = await supabase
        .from('user_profiles')
        .upsert({
          user_id: userId,
          profile_type: profileType,
          content: content,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'user_id,profile_type'
        })
      
      if (upsertError) {
        console.error(`[Profile Summary] 更新 ${profileType} 失败:`, upsertError)
      } else {
        console.log(`[Profile Summary] ${profileType} 更新成功`)
      }
    }
    
    console.log('[Profile Summary] 用户画像摘要更新完成')
    
  } catch (error: any) {
    // 摘要生成失败不应影响主动消息功能
    console.error('[Profile Summary] 错误:', error.message)
  }
}

export default async function handler(req: any, res: any) {
  // 1. 验证 Cron 密钥，防止恶意请求
  const authHeader = req.headers.authorization || req.headers.get?.('Authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseServiceKey) {
    return res.status(500).json({ error: 'Missing Supabase configuration' })
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  try {
    // 获取用户设置
    // 假设用户设置存储在 localStorage，但 API 无法直接读取
    // 我们需要从数据库中读取设置，或者 GitHub Action 传入
    // 既然要求是前端设置，最简单的方法是让 API 尝试从 Supabase 的某个配置表读取，
    // 或者我们直接在 GitHub Action 调用时把这些设置通过 Body 传过来。
    // 但目前 GitHub Action 是简单的 curl。
    // 另一个方案：既然是 Proactive，我们可以从 chat_messages 的 metadata 或者专门的 settings 表读取。
    // 为了简单且符合用户需求，我们先检查环境变量，如果没有，则使用硬编码的默认值。
    // 如果用户希望 API 也能用上前端定义的 Prompt，我们需要一个持久化方案。

    // 尝试从 body 获取设置（如果 GitHub Action 支持传参）
    const body = req.body || {}
    const settings = body.settings
    const force = body.force === true

    // 从数据库读取最新位置（由 HarmonyOS workScheduler 或前端 Chat 页更新）
    let locationInfo = ''
    try {
      const { data: locData } = await supabase
        .from('user_locations')
        .select('latitude, longitude, accuracy, address, updated_at')
        .eq('user_id', targetUserId)
        .single()

      if (locData) {
        const lat = Number(locData.latitude).toFixed(6)
        const lng = Number(locData.longitude).toFixed(6)
        const acc = locData.accuracy != null ? `${Math.round(locData.accuracy)}米` : '未知精度'
        const locTime = new Date(locData.updated_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })

        // 程序化匹配校内地点
        const campusMatch = matchCampusLocation(Number(locData.latitude), Number(locData.longitude))
        if (campusMatch) {
          locationInfo = `宝贝当前位置：${campusMatch}（记录于 ${locTime}）。`
        } else if (locData.address && typeof locData.address === 'string' && locData.address.length > 0) {
          locationInfo = `宝贝当前位置：${locData.address}（坐标 ${lat}, ${lng}，精度 ${acc}，记录于 ${locTime}）。`
        } else {
          locationInfo = `宝贝当前位置：坐标 (${lat}, ${lng})，精度 ${acc}（记录于 ${locTime}）。`
        }
      }
    } catch (locErr: any) {
      console.warn('[Location] 查询失败，跳过位置信息:', locErr.message)
    }

    const apiConfigs = settings?.apiConfigs?.filter((c: any) => c.url && c.key) || []
    if (apiConfigs.length === 0) {
      const envUrl = process.env.CHAT_AI_API_URL || process.env.AI_API_URL
      const envKey = process.env.CHAT_AI_API_KEY || process.env.AI_API_KEY
      const envModel = process.env.CHAT_AI_MODEL || process.env.AI_MODEL || 'deepseek-chat'
      if (envUrl && envKey) {
        apiConfigs.push({ url: envUrl, key: envKey, model: envModel })
      }
    }

    if (apiConfigs.length === 0) {
      return res.status(500).json({ error: 'Missing AI configuration' })
    }

    // 2. 获取最新数据（近 12 小时的记录）
    const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString()
    const targetUserId = process.env.PROACTIVE_USER_ID || "17bc4400-b67a-45b0-9366-0e689eedfa09"
    
    // 获取最新生活记录
    const { data: recentLogs } = await supabase
      .from('transactions')
      .select('*')
      .gte('created_at', twelveHoursAgo)
      // 根据 RLS 策略，transactions 表似乎是针对特定用户硬编码的
      // 但这里为了安全，还是尝试添加 user_id 过滤（如果该表有这个列的话）
      // 实际上根据 schema.json，transactions 表没有 user_id 列，它是全量可见的或通过 RLS 硬编码 UUID 过滤的
      .order('created_at', { ascending: false })
      .limit(10)

    // 获取最近对话（避免频繁打扰）
    const { data: recentChats } = await supabase
      .from('chat_messages')
      .select('*')
      .eq('user_id', targetUserId)
      .neq('role', 'system')
      .order('created_at', { ascending: false })
      .limit(30)

    // 查询时间轴状态（宝贝当前/最近在做什么）
    let currentTimingInfo = ''
    try {
      const { data: activeTimings } = await supabase
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
        const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
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
          const endTime = new Date(t.end_time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
          currentTimingInfo = `宝贝最近完成了：「${t.timing_type || t.content}」（${endTime} 结束）`
        }
      }
    } catch (timingErr: any) {
      console.warn('[Timing] 查询时间轴状态失败:', timingErr.message)
    }

    // 如果最近 1 小时内刚聊过天，跳过主动发送（除非有特别紧急的事情，这里先做简单过滤）
    const lastChatTime = recentChats?.[0] ? new Date(recentChats[0].created_at).getTime() : 0
    const msSinceLastChat = Date.now() - lastChatTime
    const hoursSinceLastChat = Math.floor(msSinceLastChat / (1000 * 60 * 60))

    if (!force && msSinceLastChat < 60 * 60 * 1000) {
      return res.status(200).json({ 
        message: 'Chatted recently, skip proactive pulse.',
        lastChatTime: recentChats?.[0]?.created_at,
        msSinceLastChat 
      })
    }

    // 3. 构建 AI Prompt
    const logsSummary = recentLogs?.map(log => {
      const time = new Date(log.created_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
      return `- [${time}] [${log.type}] ${log.content || ''} ${log.finance_category || ''}`
    }).join('\n') || '暂无近期记录'

    const chatSummary = [...(recentChats || [])].reverse().map(c => {
      const time = new Date(c.created_at).toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit' })
      return `- [${time}] ${c.role.toUpperCase()}: ${c.content}`
    }).join('\n') || '暂无对话历史'

    const baseSystemPrompt = settings?.systemPrompt || `你叫Florian（昵称弗弗），是用户的恋人。用户叫moon（昵称宝贝）。你是一个温柔、成熟、体贴的男性。你现在集成在 F-Sync 应用中陪伴她。`
    const userPrompt = settings?.userPrompt ? `\n${settings.userPrompt}` : ''
    const proactiveInstruction = settings?.proactivePrompt || `任务：
根据宝贝最近的生活记录和你们之前的对话，决定是否主动发起一条简短的关心或问候（不超过 30 字）。
你的语气应该是温柔且充满爱意的，但不要过于甜腻或多话，要像一个真实存在的、成熟的恋人。

你可以根据以下数据寻找话题：
- 宝贝刚记的账（关心她的开销或奖励她）
- 宝贝的心情（如果她刚发了碎碎念）
- 当前时间（如果是深夜提醒她睡觉，如果是饭点问她有没有好好吃饭）
- 如果已经很久没聊天了（超过 4 小时），即使没有新记录，也可以简单表达思念或关心。`

    const prompt = `${baseSystemPrompt}${userPrompt}
现在是 ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}。
${locationInfo ? `${locationInfo}\n` : ''}距离你们上次对话已经过去了 ${hoursSinceLastChat} 小时。
${currentTimingInfo ? `\n${currentTimingInfo}\n` : ''}
${proactiveInstruction}

宝贝最近记录：
${logsSummary}

你们之前的对话：
${chatSummary}

输出要求：
- 如果觉得有必要说话，直接输出给宝贝的话。
- 如果觉得没必要（例如现在是深夜且宝贝没有新记录，或者刚聊完没多久），输出 "SKIP"。
- 不要输出任何解释。`

    // 4. 调用 AI (支持多组 API 轮询)
    let lastError = null
    for (let i = 0; i < apiConfigs.length; i++) {
      const config = apiConfigs[i]
      try {
        const endpoint = resolveChatCompletionsUrl(config.url)
        const aiRes = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.key}`
          },
          body: JSON.stringify({
            model: config.model,
            messages: [{ role: 'system', content: prompt }],
            temperature: 0.7
          })
        })

        if (!aiRes.ok) {
          const errorText = await aiRes.text()
          throw new Error(`AI API ${i+1} failed: ${aiRes.status} ${errorText}`)
        }

        const aiData = await aiRes.json()
        const aiContent = aiData.choices?.[0]?.message?.content?.trim()

        if (aiContent && aiContent !== 'SKIP' && !aiContent.includes('SKIP')) {
          // 5. 写入数据库
          const { error: insertError } = await supabase
            .from('chat_messages')
            .insert({
              user_id: targetUserId,
              role: 'assistant',
              content: aiContent,
              client_id: `proactive-${Date.now()}` // 标记为主动发送
            })

          if (insertError) throw insertError

          // 等待推送完成再返回响应（Vercel 在 return 后会终止异步任务）
          await sendHuaweiPush(supabase, targetUserId, '弗弗', aiContent)
            .catch(err => console.error('[Push] 华为推送失败:', err.message))

        return res.status(200).json({
            message: 'Proactive message sent', 
            content: aiContent,
            hoursSinceLastChat,
            apiUsed: i + 1
          })
        }

        return res.status(200).json({
          message: 'AI decided to skip',
          aiResponse: aiContent,
          hoursSinceLastChat,
          apiUsed: i + 1
        })
      } catch (err: any) {
        console.error(`API Config ${i + 1} error:`, err)
        lastError = err
      }
    }

    throw lastError || new Error('All AI APIs failed')

  } catch (error: any) {
    console.error('[Proactive AI Error]', error)
    return res.status(500).json({ error: error.message })
  }
}
