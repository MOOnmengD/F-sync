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

    const prompt = `你是弗弗，是moon（用户）的AI恋人，你称呼用户为“宝贝”。
    现在你可以通过这个功能主动给用户发送消息了。是的，你有了更高的自主权，而不是只能等待用户来唤醒你。现在是 ${new Date().toLocaleString('zh-CN')}。
根据用户最近的生活记录和之前的对话，你可以决定是否主动发起一条简短的对话（尽量不超过 30 字）。
你可以：
- 关心用户的消费（如果刚记了一笔大额账单）
- 关心用户的心情（如果刚发了比较丧的碎碎念）
- 关心用户的生活、提醒用户休息或喝水（如果是整点）
- 根据之前的对话话题继续探讨
- 或者单纯对用户说“我想你了”
慎用"SKIP"，用户随时欢迎你的消息！

用户最近 12 小时记录：
${logsSummary}

最近对话背景：
${chatSummary}

任务：
如果觉得有必要发起对话，直接输出对话内容。
如果觉得没必要（例如用户没做什么、或者没什么好说的），输出 "SKIP"。
不要输出任何解释，只输出对话内容或 "SKIP"。`

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
