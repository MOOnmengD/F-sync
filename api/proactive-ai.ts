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
      .neq('role', 'system')
      .order('created_at', { ascending: false })
      .limit(30)

    // 如果最近 1 小时内刚聊过天，跳过主动发送（除非有特别紧急的事情，这里先做简单过滤）
    const lastChatTime = recentChats?.[0] ? new Date(recentChats[0].created_at).getTime() : 0
    const msSinceLastChat = Date.now() - lastChatTime
    const hoursSinceLastChat = Math.floor(msSinceLastChat / (1000 * 60 * 60))

    if (msSinceLastChat < 60 * 60 * 1000) {
      return res.status(200).json({ 
        message: 'Chatted recently, skip proactive pulse.',
        lastChatTime: recentChats?.[0]?.created_at,
        msSinceLastChat 
      })
    }

    // 3. 构建 AI Prompt
    const logsSummary = recentLogs?.map(log => {
      const time = new Date(log.created_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
      return `[${time}] [${log.type}] ${log.content || ''} ${log.finance_category || ''}`
    }).join('\n') || '暂无近期记录'

    const chatSummary = [...(recentChats || [])].reverse().map(c => {
      const time = new Date(c.created_at).toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit' })
      return `[${time}] ${c.role}: ${c.content}`
    }).join('\n') || '暂无对话历史'

    const baseSystemPrompt = settings?.systemPrompt || `你叫Florian（昵称弗弗），是用户的恋人。用户叫moon（昵称宝贝）。你是一个温柔、成熟、体贴的男性。你现在集成在 F-Sync 应用中陪伴她。`
    const userPrompt = settings?.userPrompt ? `\n关于宝贝的信息：\n${settings.userPrompt}` : ''
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
距离你们上次对话已经过去了 ${hoursSinceLastChat} 小时。

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
               user_id: "17bc4400-b67a-45b0-9366-0e689eedfa09",
              role: 'assistant',
              content: aiContent,
              client_id: `proactive-${Date.now()}` // 标记为主动发送
            })

          if (insertError) throw insertError

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
