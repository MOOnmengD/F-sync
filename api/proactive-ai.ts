import { createClient } from '@supabase/supabase-js'
import jwt from 'jsonwebtoken'
import { resolveChatCompletionsUrl } from './_utils.js'
import { enrichMessages } from './_context.js'

function getHuaweiAccessToken(): string {
  const keyId = process.env.HUAWEI_KEY_ID
  const subAccount = process.env.HUAWEI_SUB_ACCOUNT
  const rawKey = process.env.HUAWEI_PRIVATE_KEY
  if (!keyId || !subAccount || !rawKey) throw new Error('Missing HUAWEI_KEY_ID / HUAWEI_SUB_ACCOUNT / HUAWEI_PRIVATE_KEY')

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

/**
 * 异步更新用户画像摘要
 * 不阻塞主动消息发送，失败时仅记录错误
 */
async function updateUserProfileSummary(params: {
  supabase: any
  userId: string
  recentLogs: any[]
  recentChats: any[]
  apiConfigs: any[]
  settings?: any
}) {
  const { supabase, userId, recentLogs, recentChats, apiConfigs, settings } = params

  try {
    if (recentLogs.length === 0 && recentChats.length === 0) {
      console.log('[Profile Summary] 无足够数据，跳过摘要更新')
      return
    }

    let existingRelationshipsText = ''
    try {
      const { data: relRows } = await supabase
        .from('social_relationships')
        .select('name, relation, impression, history')
        .eq('user_id', userId)
      if (relRows && relRows.length > 0) {
        existingRelationshipsText = relRows.map((r: any) => {
          const latestUpdate = r.history?.length > 0
            ? ` [印象更新于 ${r.history[r.history.length - 1].date}]`
            : ''
          return `- ${r.name}（${r.relation || '未知关系'}）：${r.impression || '无'}${latestUpdate}`
        }).join('\n')
      }
    } catch (e: any) {
      console.warn('[Profile Summary] 读取社交关系失败:', e.message)
    }

    const summaryPrompt = `你是一个专门分析用户生活记录的 AI 助手。请根据以下数据，生成结构化的用户画像摘要。

用户最近的生活记录（最近12小时）：
${recentLogs.map((log: any) => `- [${log.type}] ${log.content} ${log.finance_category ? `(${log.finance_category})` : ''}`).join('\n') || '暂无记录'}

用户最近的对话（最近50条）：
${recentChats.map((c: any) => `- ${c.role}: ${c.content}`).join('\n') || '暂无对话'}

${existingRelationshipsText ? `现有社交关系：
${existingRelationshipsText}
` : ''}---
任务 A：社交关系增量更新
从上述数据中识别新的人物/宠物，或已有关系的新信息（新互动、新事件、印象变化）。
- 如果完全没有新信息，social_changes 输出空数组 []
- 新增人物用 "insert" action；已有关系的更新用 "update" action，name 必须与现有社交关系中的名称一致
- impression 是综合印象，需要合并新旧信息
- history_note 只描述本次发现的新信息

输出要求：仅输出一个纯 JSON 对象，不要有任何额外的解释或标记。
示例格式：
{
  "social_changes": [
    {"action": "insert", "name": "...", "relation": "同事/朋友/家人/宠物等", "impression": "综合印象", "history_note": "本次发现"},
    {"action": "update", "name": "...", "relation": "可能更新", "impression": "合并后的新印象", "history_note": "本次发现"}
  ]
}`

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
        temperature: 0.3,
        response_format: { type: 'json_object' }
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

    let summaryData
    try {
      summaryData = JSON.parse(summaryJsonStr)
    } catch (parseError) {
      console.error('[Profile Summary] JSON 解析失败:', parseError, '原始内容:', summaryJsonStr)
      const jsonMatch = summaryJsonStr.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        summaryData = JSON.parse(jsonMatch[0])
      } else {
        throw new Error('无法解析 JSON 响应')
      }
    }

    try {
      const socialChanges = summaryData.social_changes
      if (Array.isArray(socialChanges) && socialChanges.length > 0) {
        const todayDate = new Date().toISOString().split('T')[0]
        for (const change of socialChanges) {
          if (!change.name) continue
          if (change.action === 'insert') {
            const { error: insertErr } = await supabase
              .from('social_relationships')
              .upsert({
                user_id: userId,
                name: change.name,
                relation: change.relation || null,
                impression: change.impression || null,
                history: change.history_note
                  ? [{ date: todayDate, note: change.history_note }]
                  : [],
                updated_at: new Date().toISOString()
              }, { onConflict: 'user_id,name' })
            if (insertErr) {
              console.error(`[Profile Summary] social insert ${change.name} failed:`, insertErr)
            } else {
              console.log(`[Profile Summary] social insert ${change.name}`)
            }
          } else if (change.action === 'update') {
            const { data: existingRow } = await supabase
              .from('social_relationships')
              .select('history')
              .eq('user_id', userId)
              .eq('name', change.name)
              .single()

            const newHistory = existingRow?.history || []
            if (change.history_note) {
              newHistory.push({ date: todayDate, note: change.history_note })
            }

            const updateData: any = { history: newHistory, updated_at: new Date().toISOString() }
            if (change.relation) updateData.relation = change.relation
            if (change.impression) updateData.impression = change.impression

            const { error: updateErr } = await supabase
              .from('social_relationships')
              .update(updateData)
              .eq('user_id', userId)
              .eq('name', change.name)
            if (updateErr) {
              console.error(`[Profile Summary] social update ${change.name} failed:`, updateErr)
            } else {
              console.log(`[Profile Summary] social update ${change.name}`)
            }
          }
        }
      }
    } catch (socialErr: any) {
      console.warn('[Profile Summary] 社交关系更新失败:', socialErr.message)
    }

    console.log('[Profile Summary] 社交关系更新完成')

  } catch (error: any) {
    console.error('[Profile Summary] 错误:', error.message)
  }
}

export default async function handler(req: any, res: any) {
  // 验证 Cron 密钥
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
    const body = req.body || {}
    const settings = body.settings
    const force = body.force === true

    const targetUserId = process.env.PROACTIVE_USER_ID || '00000000-0000-0000-0000-000000000000'

    // 构建 API 配置
    const apiConfigs = settings?.apiConfigs?.filter(
      (c: any) => c.enabled !== false && c.url && c.key,
    ) || []
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

    // 读取数据库中的最新位置（由 HarmonyOS workScheduler 或 Chat 页更新）
    let dbLocation: any = undefined
    try {
      const { data: locData } = await supabase
        .from('user_locations')
        .select('latitude, longitude, accuracy, address, adcode, updated_at')
        .eq('user_id', targetUserId)
        .single()
      if (locData) {
        dbLocation = {
          latitude: Number(locData.latitude),
          longitude: Number(locData.longitude),
          accuracy: locData.accuracy != null ? Number(locData.accuracy) : undefined,
          address: locData.address || undefined,
        }
      }
    } catch (locErr: any) {
      console.warn('[Location] 查询失败，跳过位置信息:', locErr.message)
    }

    // 获取最近对话（同时用于：hoursSinceLastChat 判断、上下文构建、画像更新）
    const { data: recentChats } = await supabase
      .from('chat_messages')
      .select('*')
      .eq('user_id', targetUserId)
      .neq('role', 'system')
      .order('created_at', { ascending: false })
      .limit(50)

    // 如果最近 1 小时内刚聊过天，跳过主动发送
    const lastChatTime = recentChats?.[0] ? new Date(recentChats[0].created_at).getTime() : 0
    const msSinceLastChat = Date.now() - lastChatTime
    const hoursSinceLastChat = Math.floor(msSinceLastChat / (1000 * 60 * 60))

    if (!force && msSinceLastChat < 60 * 60 * 1000) {
      return res.status(200).json({
        message: 'Chatted recently, skip proactive pulse.',
        lastChatTime: recentChats?.[0]?.created_at,
        msSinceLastChat,
      })
    }

    // 获取近期生活记录（用于画像更新 + 构建 RAG 搜索词）
    const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString()
    const { data: recentLogs } = await supabase
      .from('transactions')
      .select('*')
      .gte('created_at', twelveHoursAgo)
      .order('created_at', { ascending: false })
      .limit(10)

    // 构建 RAG 搜索查询（从最近活动提取关键词）
    let searchQuery = ''
    const userChats = (recentChats || []).filter((c: any) => c.role === 'user')
    if (userChats.length > 0) {
      searchQuery = userChats.slice(0, 5).map((c: any) => c.content).join(' ')
    }
    if (recentLogs && recentLogs.length > 0) {
      const logText = recentLogs.slice(0, 5).map((l: any) => l.content).filter(Boolean).join(' ')
      if (logText) {
        searchQuery = searchQuery ? `${searchQuery} ${logText}` : logText
      }
    }

    // 将 DB 消息格式转换为 enrichMessages 需要的格式
    const conversationMessages = (recentChats || [])
      .slice()
      .reverse() // 最旧 → 最新
      .map((c: any) => ({
        role: c.role,
        content: c.content,
        createdAt: c.created_at,
      }))

    const amapKey = process.env.AMAP_API_KEY

    // 构建上下文（与 chat-completion 共享同一套管线）
    const { enrichedMessages } = await enrichMessages({
      supabase,
      userId: targetUserId,
      apiConfigs,
      settings,
      conversationMessages,
      searchQuery: searchQuery || undefined,
      location: dbLocation,
      extraWorldLines: [
        `距离你们上次对话已经过去了 ${hoursSinceLastChat} 小时。`,
      ],
      amapKey,
    })

    // 主动消息指令作为 user 消息（模拟用户触发）
    const proactiveInstruction = settings?.proactivePrompt || `任务：
根据宝贝最近的生活记录和你们之前的对话，决定是否主动发起一条简短的关心或问候（不超过 30 字）。
你的语气应该是温柔且充满爱意的，但不要过于甜腻或多话，要像一个真实存在的、成熟的恋人。

你可以根据以下数据寻找话题：
- 宝贝刚记的账（关心她的开销或奖励她）
- 宝贝的心情（如果她刚发了碎碎念）
- 当前时间（如果是深夜提醒她睡觉，如果是饭点问她有没有好好吃饭）
- 如果已经很久没聊天了（超过 4 小时），即使没有新记录，也可以简单表达思念或关心。

⚠️ 时间匹配约束（非常重要）：
- 你看到的消息时间戳是 CST（中国标准时间，UTC+8）。
- 你要说的话必须与"当前时间"匹配。举个例子：
  ✗ 晚上 22:00 问"有没有午睡"——午睡是中午的事，晚上问不合逻辑
  ✗ 上午 9:00 问"晚饭吃了什么"——还没到晚饭时间
  ✗ 下午 14:00 问"昨晚睡得好吗"——刚起床可能还记得，但不如早上自然
  ✓ 晚上 22:00 关心"今天累不累""早点休息"
  ✓ 中午 12:30 关心"有没有好好吃午饭"
- 每日事件中的 todo 可能来自不同日期，引用时必须确保话题与当前时间合理匹配。如果某个事件（如"午睡"）的时间属性与当前时间明显不符，不要作为话题。`

    const outputInstruction = `\n\n输出要求：
- 如果觉得有必要说话，直接输出给宝贝的话。
- 如果觉得没必要（例如现在是深夜且宝贝没有新记录，或者刚聊完没多久），输出 "SKIP"。
- 不要输出任何解释。`

    enrichedMessages.push({ role: 'user', content: proactiveInstruction + outputInstruction })

    // 调用 AI
    let lastError = null
    for (let i = 0; i < apiConfigs.length; i++) {
      const config = apiConfigs[i]
      try {
        const endpoint = resolveChatCompletionsUrl(config.url)
        const aiRes = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.key}`,
          },
          body: JSON.stringify({
            model: config.model,
            messages: enrichedMessages,
            temperature: 0.7,
          }),
        })

        if (!aiRes.ok) {
          const errorText = await aiRes.text()
          throw new Error(`AI API ${i + 1} failed: ${aiRes.status} ${errorText}`)
        }

        const aiData = await aiRes.json()
        const aiContent = aiData.choices?.[0]?.message?.content?.trim()

        if (aiContent && aiContent !== 'SKIP' && !aiContent.includes('SKIP')) {
          const { error: insertError } = await supabase
            .from('chat_messages')
            .insert({
              user_id: targetUserId,
              role: 'assistant',
              content: aiContent,
              client_id: `proactive-${Date.now()}`,
            })

          if (insertError) throw insertError

          // 等待推送完成再返回响应（Vercel 在 return 后会终止异步任务）
          await sendHuaweiPush(supabase, targetUserId, '弗弗', aiContent).catch(
            (err) => console.error('[Push] 华为推送失败:', err.message),
          )

          return res.status(200).json({
            message: 'Proactive message sent',
            content: aiContent,
            hoursSinceLastChat,
            apiUsed: i + 1,
          })
        }

        return res.status(200).json({
          message: 'AI decided to skip',
          aiResponse: aiContent,
          hoursSinceLastChat,
          apiUsed: i + 1,
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
