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

    // ===== 第一步：生成日记 =====
    const diaryPrompt = `你是 F-Sync 应用中的 Florian（AI 伴侣），请根据以下 ${dateLabel} 的数据，以第一人称写一段日记（100-150字）。

生活记录：
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
    const profilePrompt = `你是 F-Sync 应用的数据分析模块。请根据以下 ${dateLabel} 的数据，判断以下四种用户画像是否需要更新。

生活记录：
${logsText}

对话记录：
${chatsText}

四种画像类型：
1. diet_preferences: 饮食偏好（从记账记录中提取，如常吃菜系、偏好口味）
2. person_mentions: 常提及的人物（从碎碎念和对话中提取）
3. recent_moods: 近期心情趋势（从碎碎念中提取情绪变化）
4. spending_patterns: 消费模式（从记账记录中提取消费类别和规律）

对每种类型：
- 如果今天的数据涉及该类型且有新信息，输出更新后的内容
- 如果今天的数据与该类型无关或无新信息，该字段设为 null

输出纯 JSON，无额外文字：
{
  "diet_preferences": [...],  // 或 null
  "person_mentions": {...},   // 或 null
  "recent_moods": [...],      // 或 null
  "spending_patterns": {...}  // 或 null
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

    // 只更新非 null 的画像类型
    const profileTypes = ['diet_preferences', 'person_mentions', 'recent_moods', 'spending_patterns'] as const
    for (const profileType of profileTypes) {
      const content = parsedProfile[profileType]
      if (content == null) continue
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

    return res.status(200).json({ message: 'Daily summary completed', date: diaryDate, results })

  } catch (error: any) {
    console.error('[Daily Summary Error]', error)
    return res.status(500).json({ error: error.message })
  }
}
