import { createClient } from '@supabase/supabase-js'

const embeddingModel = process.env.EMBEDDING_MODEL || 'text-embedding-3-small'

function resolveEmbeddingUrl(base: string) {
  const trimmed = base.trim().replace(/\/+$/, '')
  if (!trimmed) return ''
  if (trimmed.endsWith('/embeddings')) return trimmed
  return `${trimmed}/embeddings`
}

async function readJsonBody(req: any) {
  if (req.body) return req.body
  const chunks: Uint8Array[] = []
  for await (const chunk of req) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString('utf8').trim()
  if (!raw) return {}
  return JSON.parse(raw)
}

/**
 * 将交易记录转换为语义字符串
 */
function formatTransactionToText(tx: any) {
  const date = new Date(tx.created_at).toLocaleDateString('zh-CN')
  if (tx.type === '记账') {
    const necessity = tx.necessity === true ? '是' : tx.necessity === false ? '否' : '未知'
    return `[${date}] [${tx.finance_category || '未分类'}] ${tx.content} 复购指数:${tx.repurchase_index || 0} 必要:${necessity}`
  } else if (tx.type === 'whisper') {
    return `[${date}] 碎碎念：今天心情 ${tx.mood || '未知'}。内容：${tx.content}`
  }
  return `[${date}] [${tx.type}] ${tx.content}`
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.statusCode = 405
    res.end(JSON.stringify({ error: 'Method Not Allowed' }))
    return
  }

  const apiKey = process.env.EMBEDDING_API_KEY || process.env.CHAT_AI_API_KEY || process.env.AI_API_KEY
  const apiUrl = process.env.EMBEDDING_API_URL || process.env.CHAT_AI_API_URL || process.env.AI_API_URL
  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY

  if (!apiKey || !apiUrl || !supabaseUrl || !supabaseServiceKey) {
    res.statusCode = 500
    res.end(JSON.stringify({ 
      error: 'Missing configuration', 
      details: { 
        hasApiKey: !!apiKey, 
        hasApiUrl: !!apiUrl, 
        hasSupabaseUrl: !!supabaseUrl, 
        hasServiceKey: !!supabaseServiceKey 
      } 
    }))
    return
  }

  let body: any
  try {
    body = await readJsonBody(req)
  } catch {
    res.statusCode = 400
    res.end(JSON.stringify({ error: 'Invalid JSON body' }))
    return
  }

  // 支持单个 ID 向量化或全量同步请求
  const { transaction_id, mode } = body
  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey)

  try {
    let tasks = []

    if (transaction_id) {
      // 模式 A: 针对特定 ID 向量化
      const { data: tx, error: fetchError } = await supabaseAdmin
        .from('transactions')
        .select('*')
        .eq('id', transaction_id)
        .single()
      
      if (fetchError || !tx) throw new Error('Transaction not found')
      tasks = [tx]
    } else if (mode === 'all') {
      // 模式 B: 全量同步（处理尚未向量化的数据）
      const { data, error: fetchError } = await supabaseAdmin
        .from('transactions')
        .select('*')
        .is('embedding', null)
        .in('type', ['记账', 'whisper']) // 仅处理这两类
        .limit(5) // 减小批次到 5 条，防止 Vercel 超时 (Hobby 限制 10s)
      
      if (fetchError) throw new Error(fetchError.message)
      tasks = data || []
    }

    if (tasks.length === 0) {
      res.statusCode = 200
      res.end(JSON.stringify({ message: 'No tasks to process' }))
      return
    }

    const embEndpoint = resolveEmbeddingUrl(apiUrl)
    const results = []
    let errorCount = 0

    for (const tx of tasks) {
      const text = formatTransactionToText(tx)
      
      try {
        const embRes = await fetch(embEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model: embeddingModel,
            input: text
          })
        })

        if (!embRes.ok) {
          const errText = await embRes.text()
          results.push({ id: tx.id, success: false, error: `Embedding API failed: ${errText}` })
          errorCount++
          continue
        }

        const embData = await embRes.json()
        const embedding = embData.data?.[0]?.embedding
        
        if (embedding) {
          // 使用 { count: 'exact' } 强制要求返回受影响行数
          const { error: updateError, data: updatedData } = await supabaseAdmin
            .from('transactions')
            .update({ embedding })
            .eq('id', tx.id)
            .select()

          if (updateError) {
            results.push({ id: tx.id, success: false, error: `DB Update Error: ${updateError.message}` })
            errorCount++
          } else if (!updatedData || updatedData.length === 0) {
            results.push({ id: tx.id, success: false, error: 'DB Update Failed: No rows affected (check RLS)' })
            errorCount++
          } else {
            results.push({ id: tx.id, success: true })
          }
        }
      } catch (e: any) {
        results.push({ id: tx.id, success: false, error: e.message })
        errorCount++
      }
    }

    // 如果全部失败，返回 500 以停止前端循环
    if (errorCount === tasks.length && tasks.length > 0) {
      res.statusCode = 500
      res.end(JSON.stringify({ error: 'All tasks failed in this batch', results }))
      return
    }

    res.statusCode = 200
    res.end(JSON.stringify({ results }))

  } catch (error: any) {
    res.statusCode = 500
    res.end(JSON.stringify({ error: error.message }))
  }
}
