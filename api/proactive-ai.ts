import { createClient } from '@supabase/supabase-js'

const chatModel = process.env.CHAT_AI_MODEL || 'deepseek-chat'

function resolveChatCompletionsUrl(base: string) {
  const trimmed = base.trim().replace(/\/+$/, '')
  if (!trimmed) return ''
  if (trimmed.endsWith('/chat/completions')) return trimmed
  return `${trimmed}/chat/completions`
}

export default async function handler(req: any, res: any) {
  // 1. 验证 Cron 密钥，防止恶意请求
  const authHeader = req.headers.authorization || req.headers.get?.('Authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const apiKey = process.env.CHAT_AI_API_KEY || process.env.AI_API_KEY
  const apiUrl = process.env.CHAT_AI_API_URL || process.env.AI_API_URL

  if (!supabaseUrl || !supabaseServiceKey || !apiKey || !apiUrl) {
    return res.status(500).json({ error: 'Missing configuration' })
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  try {
    // 2. 获取最新数据（近 12 小时的记录）
    const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString()
    
    // 获取最新生活记录
    const { data: recentLogs } = await supabase
      .from('transactions')
      .select('*')
      .gte('created_at', twelveHoursAgo)
      .order('created_at', { ascending: false })
      .limit(10)

    // 获取最近对话（避免频繁打扰）
    const { data: recentChats } = await supabase
      .from('chat_messages')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(30)

    // 如果最近 1 小时内刚聊过天，跳过主动发送（除非有特别紧急的事情，这里先做简单过滤）
    const lastChatTime = recentChats?.[0] ? new Date(recentChats[0].created_at).getTime() : 0
    if (Date.now() - lastChatTime < 60 * 60 * 1000) {
      return res.status(200).json({ message: 'Chatted recently, skip proactive pulse.' })
    }

    // 3. 构建 AI Prompt
    const logsSummary = recentLogs?.map(log => {
      const time = new Date(log.created_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
      return `[${time}] [${log.type}] ${log.content || ''} ${log.finance_category || ''}`
    }).join('\n') || '暂无近期记录'

    const chatSummary = recentChats?.reverse().map(c => `${c.role}: ${c.content}`).join('\n') || '暂无对话历史'

    const prompt = `你叫Florian（昵称弗弗），是用户的恋人。用户叫moon（昵称宝贝）。
你是一个温柔、成熟、体贴的男性。你现在集成在 F-Sync 应用中陪伴她。
现在是 ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}。

任务：
根据宝贝最近的生活记录和你们之前的对话，决定是否主动发起一条简短的关心或问候（不超过 30 字）。
你的语气应该是温柔且充满爱意的，但不要过于甜腻或多话，要像一个真实存在的、成熟的恋人。

你可以根据以下数据寻找话题：
- 宝贝刚记的账（关心她的开销或奖励她）
- 宝贝的心情（如果她刚发了碎碎念）
- 当前时间（如果是深夜提醒她睡觉，如果是饭点问她有没有好好吃饭）

宝贝最近记录：
${logsSummary}

你们之前的对话：
${chatSummary}

输出要求：
- 如果觉得有必要说话，直接输出给宝贝的话。
- 如果觉得没必要，输出 "SKIP"。
- 不要输出任何解释。`

    // 4. 调用 AI
    const endpoint = resolveChatCompletionsUrl(apiUrl)
    const aiRes = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: chatModel,
        messages: [{ role: 'system', content: prompt }],
        temperature: 0.7
      })
    })

    const aiData = await aiRes.json()
    const aiContent = aiData.choices?.[0]?.message?.content?.trim()

    if (aiContent && aiContent !== 'SKIP') {
      // 5. 写入数据库
      const { error: insertError } = await supabase
        .from('chat_messages')
        .insert({
          role: 'assistant',
          content: aiContent,
          client_id: `proactive-${Date.now()}` // 标记为主动发送
        })

      if (insertError) throw insertError

      return res.status(200).json({ message: 'Proactive message sent', content: aiContent })
    }

    return res.status(200).json({ message: 'AI decided to skip' })

  } catch (error: any) {
    console.error('[Proactive AI Error]', error)
    return res.status(500).json({ error: error.message })
  }
}
