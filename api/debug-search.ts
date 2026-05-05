import { createClient } from '@supabase/supabase-js'

const embeddingModel = process.env.EMBEDDING_MODEL || 'BAAI/bge-m3'

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

export default async function handler(req: any, res: any) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')

  if (req.method !== 'POST') {
    res.statusCode = 405
    res.end(JSON.stringify({ error: 'Method Not Allowed' }))
    return
  }

  try {
    const body = await readJsonBody(req)
    const query: string = body.query
    const threshold: number = body.threshold ?? 0.3
    const limit: number = body.limit ?? 10

    if (!query || typeof query !== 'string') {
      res.statusCode = 400
      res.end(JSON.stringify({ error: 'Missing query (string)' }))
      return
    }

    const apiKey = process.env.EMBEDDING_API_KEY || process.env.CHAT_AI_API_KEY || process.env.AI_API_KEY
    const apiUrl = process.env.EMBEDDING_API_URL || process.env.CHAT_AI_API_URL || process.env.AI_API_URL
    const supabaseUrl = process.env.VITE_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!apiKey || !apiUrl || !supabaseUrl || !supabaseServiceKey) {
      res.statusCode = 500
      res.end(JSON.stringify({
        error: 'Missing configuration',
        details: { apiKey: !!apiKey, apiUrl: !!apiUrl, supabaseUrl: !!supabaseUrl, serviceKey: !!supabaseServiceKey }
      }))
      return
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    const embEndpoint = resolveEmbeddingUrl(apiUrl)

    // 1. 生成 embedding
    const embStart = Date.now()
    const embRes = await fetch(embEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({ model: embeddingModel, input: query })
    })

    if (!embRes.ok) {
      const errText = await embRes.text()
      res.statusCode = 500
      res.end(JSON.stringify({
        error: 'Embedding API failed',
        status: embRes.status,
        detail: errText,
        endpoint: embEndpoint,
        model: embeddingModel
      }))
      return
    }

    const embData = await embRes.json()
    const embTimeMs = Date.now() - embStart
    const queryEmbedding = embData.data?.[0]?.embedding

    if (!queryEmbedding) {
      res.statusCode = 500
      res.end(JSON.stringify({ error: 'No embedding returned', raw: embData }))
      return
    }

    const embeddingMeta = {
      model: embData.model || embeddingModel,
      dimensions: queryEmbedding.length,
      first10: queryEmbedding.slice(0, 10),
      timeMs: embTimeMs,
      usage: embData.usage || null
    }

    // 2. 向量检索
    let vectorResults: any[] = []
    let vectorError: string | null = null

    const { data: vectorData, error: vErr } = await supabase.rpc('match_life_logs', {
      query_embedding: queryEmbedding,
      match_threshold: threshold,
      match_count: limit
    })

    if (vErr) {
      vectorError = vErr.message
    } else if (vectorData) {
      vectorResults = vectorData.map((r: any) => ({
        id: r.id,
        type: r.type,
        content: r.content,
        date: new Date(r.created_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
        similarity: Math.round(r.similarity * 10000) / 10000,
        finance_category: r.finance_category || null,
        mood: r.mood || null,
        amount: r.amount || null
      }))
    }

    // 3. 全文检索（对比用）
    let fulltextResults: any[] = []
    let fulltextError: string | null = null

    try {
      const { data: ftData, error: ftErr } = await supabase
        .from('transactions')
        .select('*')
        .filter('search_vector', 'fts', query)
        .order('created_at', { ascending: false })
        .limit(limit)

      if (ftErr) {
        fulltextError = ftErr.message
      } else if (ftData) {
        fulltextResults = ftData.map((r: any) => ({
          id: r.id,
          type: r.type,
          content: r.content,
          date: new Date(r.created_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
          finance_category: r.finance_category || null,
          mood: r.mood || null,
          amount: r.amount || null
        }))
      }
    } catch (e: any) {
      fulltextError = e.message
    }

    // 4. 重叠分析
    const vectorIds = new Set(vectorResults.map((r: any) => r.id))
    const ftIds = new Set(fulltextResults.map((r: any) => r.id))
    const overlapIds = [...vectorIds].filter(id => ftIds.has(id))

    res.statusCode = 200
    res.end(JSON.stringify({
      query,
      embedding: embeddingMeta,
      vector: {
        error: vectorError,
        count: vectorResults.length,
        results: vectorResults
      },
      fulltext: {
        error: fulltextError,
        count: fulltextResults.length,
        results: fulltextResults
      },
      overlap: {
        count: overlapIds.length,
        ids: overlapIds
      },
      params: { threshold, limit }
    }))

  } catch (e: any) {
    res.statusCode = 500
    res.end(JSON.stringify({ error: e.message, stack: e.stack }))
  }
}
