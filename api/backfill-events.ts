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

  const targetUserId = process.env.PROACTIVE_USER_ID
  if (!targetUserId) {
    return res.status(500).json({ error: 'Missing PROACTIVE_USER_ID' })
  }
  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  let body: any = {}
  try {
    if (req.body) {
      body = req.body
    } else {
      const chunks: Uint8Array[] = []
      for await (const chunk of req) chunks.push(chunk)
      const raw = Buffer.concat(chunks).toString('utf8').trim()
      if (raw) body = JSON.parse(raw)
    }
  } catch {
    return res.status(400).json({ error: 'Invalid JSON body' })
  }

  const startDateStr = body.startDate
  const endDateStr = body.endDate || new Date().toISOString().split('T')[0]
  const maxDays = body.maxDays || 10

  if (!startDateStr) {
    return res.status(400).json({ error: 'Missing startDate (YYYY-MM-DD)' })
  }

  const startDate = new Date(startDateStr + 'T00:00:00+08:00')
  const endDate = new Date(endDateStr + 'T23:59:59+08:00')

  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    return res.status(400).json({ error: 'Invalid date format, use YYYY-MM-DD' })
  }

  if (endDate < startDate) {
    return res.status(400).json({ error: 'endDate must be >= startDate' })
  }

  const endpoint = resolveChatCompletionsUrl(aiUrl)
  const results: string[] = []
  let processed = 0

  // embedding 配置
  const embApiKey = process.env.EMBEDDING_API_KEY || aiKey
  const embApiUrl = process.env.EMBEDDING_API_URL || aiUrl
  const embModel = process.env.EMBEDDING_MODEL || 'text-embedding-3-small'
  let embEndpoint = embApiUrl.trim().replace(/\/+$/, '')
  if (!embEndpoint.endsWith('/embeddings')) embEndpoint = `${embEndpoint}/embeddings`

  const current = new Date(startDate)
  while (current <= endDate && processed < maxDays) {
    const dateStr = current.toISOString().split('T')[0]
    const dateLabel = current.toLocaleDateString('zh-CN', {
      timeZone: 'Asia/Shanghai', month: 'long', day: 'numeric', weekday: 'short'
    })

    const dayStartUTC = new Date(dateStr + 'T00:00:00+08:00')
    const dayEndUTC = new Date(dateStr + 'T23:59:59.999+08:00')

    try {
      // 跳过已有事件的日子（幂等）
      const { data: existing } = await supabase
        .from('daily_event_items')
        .select('id')
        .eq('user_id', targetUserId)
        .eq('date', dateStr)
        .limit(1)

      if (existing && existing.length > 0) {
        results.push(`${dateStr}: 跳过（已有事件）`)
        current.setDate(current.getDate() + 1)
        processed++
        continue
      }

      // 获取当天对话
      const { data: dayChats } = await supabase
        .from('chat_messages')
        .select('*')
        .eq('user_id', targetUserId)
        .neq('role', 'system')
        .gte('created_at', dayStartUTC.toISOString())
        .lt('created_at', dayEndUTC.toISOString())
        .order('created_at', { ascending: true })

      if (!dayChats || dayChats.length === 0) {
        results.push(`${dateStr}: 跳过（无对话）`)
        current.setDate(current.getDate() + 1)
        processed++
        continue
      }

      const chatsText = dayChats.map((c: any) => {
        const time = new Date(c.created_at).toLocaleTimeString('zh-CN', {
          timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit'
        })
        return `[${time}] ${c.role === 'user' ? '宝贝' : 'Florian'}: ${c.content}`
      }).join('\n')

      // 与 daily-summary.ts 保持一致的 prompt
      const eventsPrompt = `你是 F-Sync 应用的每日事件提取模块。请根据用户与 AI 在 ${dateLabel} 的以下对话记录，提取客观的"每日事件"。

### 对话记录（每条前面的 [HH:MM] 为对话时间）：
${chatsText}

### 情况说明：
- 每日事件是AI长期记忆的基础，因此，每日事件应绝对客观准确，严禁杜撰或揣测未发生的事,并在准确的前提下尽可能简洁。
- 当用户在当前对话中提到过去发生的某件事时，AI会向量检索每日事件。因此，每日事件作为当前与过去的索引和桥梁，应当重点突出、便于查询。
- 每日事件起到目录、提纲或索引的功能。
### 提取要求：
- 以AI的视角提取每日事件，以＂宝贝＂称呼用户，以＂弗弗＂称呼 AI，用户与AI为恋人关系。
- 客观、准确、简洁，每条不超过 30 字。
- 不要写入琐碎的日常寒暄，只提取有信息量的事件。
- 只记录"今天发生了什么"（时效性事件），不要记录用户的持久性个人信息（如生日日期、长期偏好等）。
- 根据对话时间 [HH:MM] 输出每条事件对应对话的起止时间。chat_time_start 是该事件被讨论的第一条消息的时间，chat_time_end 是最后一条消息的时间（格式均为 HH:MM）。如果事件只有一句对话，start 和 end 填相同值。

### 输出格式
输出一个纯 JSON 数组，每个元素格式：
{"type":"event","content":"事件描述","chat_time_start":"HH:MM","chat_time_end":"HH:MM"}
chat_time_start 和 chat_time_end 都必填，如果无法确定则填写距离最近的对话标记时间。
如果无事可记，输出空数组 []。不要输出任何额外文字，只输出 JSON。`

      const eventsRes = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${aiKey}`
        },
        body: JSON.stringify({
          model: aiModel,
          messages: [{ role: 'system', content: eventsPrompt }],
          temperature: 0.3,
          response_format: { type: 'json_object' }
        })
      })

      if (!eventsRes.ok) {
        const errText = await eventsRes.text()
        results.push(`${dateStr}: AI 失败 (${eventsRes.status})`)
        console.error(`[Backfill] ${dateStr} AI error:`, errText)
        current.setDate(current.getDate() + 1)
        processed++
        continue
      }

      const eventsData = await eventsRes.json()
      const rawContent = eventsData.choices?.[0]?.message?.content?.trim()

      if (!rawContent) {
        results.push(`${dateStr}: AI 空响应`)
        current.setDate(current.getDate() + 1)
        processed++
        continue
      }

      let items: any[] = []
      try {
        const parsed = JSON.parse(rawContent)
        items = Array.isArray(parsed) ? parsed : (parsed.items || [])
      } catch {
        const match = rawContent.match(/\[[\s\S]*\]/)
        if (match) {
          try { items = JSON.parse(match[0]) } catch { /* skip */ }
        }
      }

      if (items.length > 0) {
        items.sort((a: any, b: any) => {
          const timeA = a.chat_time_start || '23:59'
          const timeB = b.chat_time_start || '23:59'
          return timeA.localeCompare(timeB)
        })

        const rows = items.map((item: any, idx: number) => ({
          user_id: targetUserId,
          date: dateStr,
          type: item.type || 'event',
          status: item.status || null,
          content: item.content || '',
          chat_time_start: item.chat_time_start || null,
          chat_time_end: item.chat_time_end || null,
          sort_order: idx
        }))

        const { error: insertError, data: insertedRows } = await supabase
          .from('daily_event_items')
          .insert(rows)
          .select('id, content')

        if (insertError) {
          results.push(`${dateStr}: 写入失败 (${insertError.message})`)
        } else {
          // 为事件生成 embedding
          if (insertedRows && insertedRows.length > 0) {
            for (const row of insertedRows) {
              try {
                const embRes = await fetch(embEndpoint, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${embApiKey}`
                  },
                  body: JSON.stringify({ model: embModel, input: row.content })
                })
                if (embRes.ok) {
                  const embData = await embRes.json()
                  const embedding = embData.data?.[0]?.embedding
                  if (embedding) {
                    await supabase
                      .from('daily_event_items')
                      .update({ embedding })
                      .eq('id', row.id)
                  }
                }
              } catch {
                // 单条 embedding 失败不影响其他
              }
            }
          }
          results.push(`${dateStr}: 已保存 ${items.length} 条事件`)
        }
      } else {
        results.push(`${dateStr}: 无事件`)
      }

    } catch (err: any) {
      results.push(`${dateStr}: 异常 (${err.message})`)
      console.error(`[Backfill] ${dateStr} error:`, err)
    }

    current.setDate(current.getDate() + 1)
    processed++
  }

  const hasMore = current <= endDate
  return res.status(200).json({
    message: hasMore ? 'Backfill partial (run again to continue)' : 'Backfill complete',
    nextStartDate: hasMore ? current.toISOString().split('T')[0] : undefined,
    results
  })
}
