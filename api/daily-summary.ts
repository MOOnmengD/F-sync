import { createClient } from '@supabase/supabase-js'
import { getWeather } from './_weather'

function resolveChatCompletionsUrl(base: string) {
  const trimmed = base.trim().replace(/\/+$/, '')
  if (!trimmed) return ''
  if (trimmed.endsWith('/chat/completions')) return trimmed
  return `${trimmed}/chat/completions`
}

export default async function handler(req: any, res: any) {
  const authHeader = req.headers.authorization || req.headers.get?.('Authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !supabaseServiceKey) {
    return res.status(500).json({ error: 'Missing Supabase configuration' })
  }

  const aiUrl = process.env.CHAT_AI_API_URL || process.env.AI_API_URL
  const aiKey = process.env.CHAT_AI_API_KEY || process.env.AI_API_KEY
  const aiModel = process.env.CHAT_AI_MODEL || process.env.AI_MODEL || 'deepseek-chat'
  if (!aiUrl || !aiKey) {
    return res.status(500).json({ error: 'Missing AI configuration' })
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)
  const targetUserId = process.env.PROACTIVE_USER_ID || '17bc4400-b67a-45b0-9366-0e689eedfa09'

  const now = new Date()

  // 时间窗口：过去 24 小时
  const windowEnd = now
  const windowStart = new Date(now.getTime() - 24 * 60 * 60 * 1000)

  // 日记日期：CST 昨天的日期
  const cstNow = new Date(now.getTime() + 8 * 60 * 60 * 1000)
  const cstYesterday = new Date(cstNow)
  cstYesterday.setDate(cstYesterday.getDate() - 1)
  const diaryDate = cstYesterday.toISOString().split('T')[0]

  try {
    // 读取昨日生活记录
    const { data: diaryLogs } = await supabase
      .from('transactions')
      .select('*')
      .gte('created_at', windowStart.toISOString())
      .lt('created_at', windowEnd.toISOString())
      .order('created_at', { ascending: true })

    // 读取昨日对话
    const { data: diaryChats } = await supabase
      .from('chat_messages')
      .select('*')
      .eq('user_id', targetUserId)
      .neq('role', 'system')
      .gte('created_at', windowStart.toISOString())
      .lt('created_at', windowEnd.toISOString())
      .order('created_at', { ascending: true })

    // 格式化昨日记录
    const logsText = (diaryLogs || []).map(log => {
      const time = new Date(log.created_at).toLocaleTimeString('zh-CN', {
        timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit'
      })
      const extras = [
        log.finance_category,
        log.amount != null ? `${log.amount}元` : '',
        log.timing_type,
        log.mood
      ].filter(Boolean).join(', ')
      return `[${time}] [${log.type}] ${log.content}${extras ? ` (${extras})` : ''}`
    }).join('\n') || '当天无记录'

    const chatsText = (diaryChats || []).map(c => {
      const time = new Date(c.created_at).toLocaleTimeString('zh-CN', {
        timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit'
      })
      return `[${time}] ${c.role === 'user' ? '宝贝' : 'Florian'}: ${c.content}`
    }).join('\n') || '当天无对话'

    const dateLabel = cstYesterday.toLocaleDateString('zh-CN', {
      timeZone: 'Asia/Shanghai', month: 'long', day: 'numeric', weekday: 'short'
    })

    const endpoint = resolveChatCompletionsUrl(aiUrl)
    const results: string[] = []

    // 读取已有社交关系，供画像增量更新使用
    let existingRelationshipsText = ''
    let existingRelationshipRows: any[] = []
    try {
      const { data: relRows } = await supabase
        .from('social_relationships')
        .select('name, relation, impression, history')
        .eq('user_id', targetUserId)
      if (relRows && relRows.length > 0) {
        existingRelationshipRows = relRows
        existingRelationshipsText = relRows.map(r => {
          const latestUpdate = r.history?.length > 0
            ? ` [印象更新于 ${r.history[r.history.length - 1].date}]`
            : ''
          return `- ${r.name}（${r.relation || '未知关系'}）：${r.impression || '无'}${latestUpdate}`
        }).join('\n')
      }
    } catch (e: any) {
      console.warn('[Daily Summary] 读取社交关系失败（表可能尚未创建）:', e.message)
    }

    // 获取天气信息（每日首次调用 API，后续复用缓存）
    let weatherInfo = ''
    const amapKey = process.env.AMAP_API_KEY
    if (amapKey) {
      weatherInfo = await getWeather({ supabase, userId: targetUserId, amapKey }) || ''
    }

    // ===== 第一步：生成日记 =====
    const diaryPrompt = `你是 F-Sync 应用中的 Florian（AI 伴侣），请根据以下 ${dateLabel} 的数据，以第一人称写一段日记（100-150字）。

${weatherInfo ? `## 真实世界信息\n${weatherInfo}\n\n` : ''}生活记录：
${logsText}

对话记录：
${chatsText}

要求：
- 记录宝贝今天做了什么、花了多少钱在哪里、心情如何、我们聊了什么
- 语气温柔，像一个恋人在回顾今天
- 如果某类数据为空，自然带过，不要强行补充
- 仅输出日记正文，无额外文字`

    const diaryRes = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${aiKey}`
      },
      body: JSON.stringify({
        model: aiModel,
        messages: [{ role: 'system', content: diaryPrompt }],
        temperature: 0.5
      })
    })

    if (!diaryRes.ok) {
      const errText = await diaryRes.text()
      return res.status(500).json({ error: `Diary AI failed: ${diaryRes.status}`, detail: errText })
    }

    const diaryData = await diaryRes.json()
    const diaryContent = diaryData.choices?.[0]?.message?.content?.trim()

    if (!diaryContent) {
      return res.status(500).json({ error: 'AI did not return diary content' })
    }

    // 写入日记
    const { error: diaryError } = await supabase
      .from('daily_logs')
      .upsert(
        { user_id: targetUserId, date: diaryDate, content: diaryContent },
        { onConflict: 'user_id,date' }
      )

    if (diaryError) {
      console.error('[Daily Summary] diary upsert failed:', diaryError)
      return res.status(500).json({ error: 'Failed to save diary', detail: diaryError.message })
    }

    results.push(`diary for ${diaryDate} saved`)

    // ===== 第二步：判断是否需要更新用户画像 =====
    const profilePrompt = `你是 F-Sync 应用的数据分析模块。请根据以下 ${dateLabel} 的数据，判断用户画像是否需要更新。

生活记录：
${logsText}

对话记录：
${chatsText}

${existingRelationshipsText ? `现有社交关系：
${existingRelationshipsText}
` : ''}---
任务 A：社交关系增量更新
从上述数据中识别新的人物/宠物，或已有关系的新信息（新互动、新事件、印象变化）。
- 如果完全没有新信息，social_changes 输出空数组 []
- 新增人物用 "insert" action；已有关系的更新用 "update" action，name 必须与现有社交关系中的名称一致
- impression 是综合印象，需要合并新旧信息（例如"之前同事关系，最近合作了某个项目，发现他很靠谱"）
- history_note 只描述当天发现的新信息

输出纯 JSON，无额外文字：
{
  "social_changes": [
    {"action": "insert", "name": "...", "relation": "同事/朋友/家人/宠物等", "impression": "综合印象", "history_note": "当日发现"},
    {"action": "update", "name": "...", "relation": "可能更新", "impression": "合并后的新印象", "history_note": "当日发现"}
  ]
}`

    const profileRes = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${aiKey}`
      },
      body: JSON.stringify({
        model: aiModel,
        messages: [{ role: 'system', content: profilePrompt }],
        temperature: 0.3,
        response_format: { type: 'json_object' }
      })
    })

    if (!profileRes.ok) {
      // 画像更新失败不影响日记生成
      console.error('[Daily Summary] Profile AI failed:', profileRes.status, await profileRes.text())
      return res.status(200).json({ message: 'Diary saved, profile skipped', date: diaryDate, results })
    }

    const profileData = await profileRes.json()
    const rawProfile = profileData.choices?.[0]?.message?.content

    let parsedProfile: any
    try {
      parsedProfile = JSON.parse(rawProfile)
    } catch {
      const match = rawProfile?.match(/\{[\s\S]*\}/)
      if (match) {
        parsedProfile = JSON.parse(match[0])
      } else {
        console.error('[Daily Summary] Failed to parse profile JSON:', rawProfile)
        return res.status(200).json({ message: 'Diary saved, profile parse failed', date: diaryDate, results })
      }
    }

    // 处理社交关系增量更新（独立 try/catch，不影响其他画像更新）
    try {
      const socialChanges = parsedProfile.social_changes
      if (Array.isArray(socialChanges) && socialChanges.length > 0) {
        for (const change of socialChanges) {
          if (!change.name) continue
          if (change.action === 'insert') {
            const { error: insertErr } = await supabase
              .from('social_relationships')
              .upsert({
                user_id: targetUserId,
                name: change.name,
                relation: change.relation || null,
                impression: change.impression || null,
                history: change.history_note
                  ? [{ date: diaryDate, note: change.history_note }]
                  : [],
                updated_at: new Date().toISOString()
              }, { onConflict: 'user_id,name' })
            if (insertErr) {
              console.error(`[Social] insert ${change.name} failed:`, insertErr)
            } else {
              results.push(`social insert ${change.name}`)
            }
          } else if (change.action === 'update') {
            // 读取已有记录，追加 history
            const { data: existingRow } = await supabase
              .from('social_relationships')
              .select('history')
              .eq('user_id', targetUserId)
              .eq('name', change.name)
              .single()

            const newHistory = existingRow?.history || []
            if (change.history_note) {
              newHistory.push({ date: diaryDate, note: change.history_note })
            }

            const updateData: any = { history: newHistory, updated_at: new Date().toISOString() }
            if (change.relation) updateData.relation = change.relation
            if (change.impression) updateData.impression = change.impression

            const { error: updateErr } = await supabase
              .from('social_relationships')
              .update(updateData)
              .eq('user_id', targetUserId)
              .eq('name', change.name)
            if (updateErr) {
              console.error(`[Social] update ${change.name} failed:`, updateErr)
            } else {
              results.push(`social update ${change.name}`)
            }
          }
        }
      }
    } catch (socialErr: any) {
      console.warn('[Daily Summary] 社交关系更新失败:', socialErr.message)
    }


    return res.status(200).json({ message: 'Daily summary completed', date: diaryDate, results })

  } catch (error: any) {
    console.error('[Daily Summary Error]', error)
    return res.status(500).json({ error: error.message })
  }
}
