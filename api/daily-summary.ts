import { createClient } from '@supabase/supabase-js'

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

  // 时间窗口：过去 24 小时（昨天 01:00 CST 到今天 01:00 CST）
  const windowEnd = now
  const windowStart = new Date(now.getTime() - 24 * 60 * 60 * 1000)

  // 日记日期：CST 昨天的日期（UTC+8，加 8 小时后取日期部分）
  const cstNow = new Date(now.getTime() + 8 * 60 * 60 * 1000)
  const cstYesterday = new Date(cstNow)
  cstYesterday.setDate(cstYesterday.getDate() - 1)
  const diaryDate = cstYesterday.toISOString().split('T')[0] // YYYY-MM-DD

  // 近 7 天数据（用于更新用户画像）
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)

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

    // 读取近 7 天记录（用于画像）
    const { data: profileLogs } = await supabase
      .from('transactions')
      .select('*')
      .gte('created_at', sevenDaysAgo.toISOString())
      .order('created_at', { ascending: false })
      .limit(100)

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

    const profileLogsText = (profileLogs || []).map(log => {
      const extras = [
        log.finance_category,
        log.amount != null ? `${log.amount}元` : ''
      ].filter(Boolean).join(', ')
      return `[${log.type}] ${log.content}${extras ? ` (${extras})` : ''}`
    }).join('\n') || '近期无记录'

    const dateLabel = cstYesterday.toLocaleDateString('zh-CN', {
      timeZone: 'Asia/Shanghai', month: 'long', day: 'numeric', weekday: 'short'
    })

    const prompt = `你是 F-Sync 应用的数据分析模块，负责帮 Florian（AI伴侣）整理关于宝贝（moon）的记忆。

=== ${dateLabel} 的数据 ===

生活记录：
${logsText}

对话记录：
${chatsText}

=== 近 7 天生活记录（用于更新用户画像）===
${profileLogsText}

=== 任务 ===

任务1：以 Florian 第一人称，写一段 ${dateLabel} 的日记（100-150字）。
- 记录宝贝今天做了什么、花了多少钱在哪里、心情如何、我们聊了什么
- 语气温柔，像一个恋人在回顾今天
- 如果某类数据为空，自然带过，不要强行补充

任务2：根据近 7 天数据，更新用户画像中的稳定特征：
- diet_preferences: 饮食偏好数组（如 ["喜欢辣食", "常点外卖"]）
- person_mentions: 常提及人物对象（如 {"小明": "同事"}）
- recent_moods: 近期心情数组（如 ["平静", "有些焦虑"]）
- spending_patterns: 消费模式对象（如 {"餐饮": "高频", "购物": "低频"}）

输出纯 JSON，无额外文字：
{
  "diary": "...",
  "profile": {
    "diet_preferences": [...],
    "person_mentions": {...},
    "recent_moods": [...],
    "spending_patterns": {...}
  }
}`

    const endpoint = resolveChatCompletionsUrl(aiUrl)
    const aiRes = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${aiKey}`
      },
      body: JSON.stringify({
        model: aiModel,
        messages: [{ role: 'system', content: prompt }],
        temperature: 0.5,
        response_format: { type: 'json_object' }
      })
    })

    if (!aiRes.ok) {
      const errText = await aiRes.text()
      return res.status(500).json({ error: `AI API failed: ${aiRes.status}`, detail: errText })
    }

    const aiData = await aiRes.json()
    const rawContent = aiData.choices?.[0]?.message?.content

    let parsed: any
    try {
      parsed = JSON.parse(rawContent)
    } catch {
      const match = rawContent?.match(/\{[\s\S]*\}/)
      if (match) {
        parsed = JSON.parse(match[0])
      } else {
        return res.status(500).json({ error: 'Failed to parse AI response', raw: rawContent })
      }
    }

    const results: string[] = []

    // 写入日记
    if (parsed.diary) {
      const { error: diaryError } = await supabase
        .from('daily_logs')
        .upsert(
          { user_id: targetUserId, date: diaryDate, content: parsed.diary },
          { onConflict: 'user_id,date' }
        )
      if (diaryError) {
        console.error('[Daily Summary] diary upsert failed:', diaryError)
      } else {
        results.push(`diary for ${diaryDate} saved`)
      }
    }

    // 更新用户画像
    if (parsed.profile) {
      const profileTypes = ['diet_preferences', 'person_mentions', 'recent_moods', 'spending_patterns'] as const
      for (const profileType of profileTypes) {
        const content = parsed.profile[profileType]
        if (!content) continue
        const { error } = await supabase
          .from('user_profiles')
          .upsert(
            { user_id: targetUserId, profile_type: profileType, content, updated_at: new Date().toISOString() },
            { onConflict: 'user_id,profile_type' }
          )
        if (error) {
          console.error(`[Daily Summary] profile ${profileType} failed:`, error)
        } else {
          results.push(`profile ${profileType} updated`)
        }
      }
    }

    return res.status(200).json({ message: 'Daily summary completed', date: diaryDate, results })

  } catch (error: any) {
    console.error('[Daily Summary Error]', error)
    return res.status(500).json({ error: error.message })
  }
}
