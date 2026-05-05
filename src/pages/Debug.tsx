import { useState } from 'react'
import { Search, Loader2, AlertTriangle } from 'lucide-react'
import { supabase } from '../supabaseClient'

interface VectorResult {
  id: string
  type: string
  content: string
  date: string
  similarity: number
  finance_category: string | null
  mood: string | null
  amount: number | null
}

interface FulltextResult {
  id: string
  type: string
  content: string
  date: string
  finance_category: string | null
  mood: string | null
  amount: number | null
}

interface SearchResult {
  embedding: {
    model: string
    dimensions: number
    first10: number[]
    timeMs: number
    usage: { total_tokens: number } | null
  }
  vector: { error: string | null; results: VectorResult[] }
  fulltext: { error: string | null; results: FulltextResult[] }
  overlap: { count: number; ids: string[] }
  params: { threshold: number; limit: number }
}

export default function Debug() {
  const [query, setQuery] = useState('')
  const [threshold, setThreshold] = useState(0.3)
  const [limit, setLimit] = useState(10)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<SearchResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function search() {
    if (!query.trim()) return
    setLoading(true)
    setError(null)

    try {
      // 1. 生成 embedding（通过 Vite proxy 转发到硅基流动）
      const embStart = performance.now()
      const embRes = await fetch('/embedding-api/embeddings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'BAAI/bge-m3', input: query.trim() })
      })

      if (!embRes.ok) {
        const errText = await embRes.text()
        setError(`Embedding API 失败 (${embRes.status}): ${errText}`)
        setLoading(false)
        return
      }

      const embData = await embRes.json()
      const embTimeMs = Math.round(performance.now() - embStart)
      const queryEmbedding = embData.data?.[0]?.embedding

      if (!queryEmbedding) {
        setError(`Embedding 返回为空: ${JSON.stringify(embData, null, 2)}`)
        setLoading(false)
        return
      }

      const embeddingMeta = {
        model: embData.model || 'BAAI/bge-m3',
        dimensions: queryEmbedding.length,
        first10: queryEmbedding.slice(0, 10),
        timeMs: embTimeMs,
        usage: embData.usage || null
      }

      // 2. 向量检索
      let vectorResults: VectorResult[] = []
      let vectorError: string | null = null

      const { data: vectorData, error: vErr } = await supabase!.rpc('match_life_logs', {
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

      // 3. 全文检索
      let fulltextResults: FulltextResult[] = []
      let fulltextError: string | null = null

      try {
        const { data: ftData, error: ftErr } = await supabase!
          .from('transactions')
          .select('*')
          .ilike('content', `%${query}%`)
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
      const vectorIds = new Set(vectorResults.map(r => r.id))
      const ftIds = new Set(fulltextResults.map(r => r.id))
      const overlapIds = [...vectorIds].filter(id => ftIds.has(id))

      setResult({
        embedding: embeddingMeta,
        vector: { error: vectorError, results: vectorResults },
        fulltext: { error: fulltextError, results: fulltextResults },
        overlap: { count: overlapIds.length, ids: overlapIds },
        params: { threshold, limit }
      })
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const presetQueries = [
    '我今天吃了什么',
    '最近购买的东西',
    '心情不好',
    '喜欢的餐厅',
    '上周做了什么',
    '花了多少钱',
  ]

  return (
    <div className="mx-auto max-w-[640px] px-4 py-6 pb-24 text-base-text">
      <h1 className="text-lg font-semibold mb-4">向量检索调试</h1>

      <div className="space-y-3 mb-5">
        <div className="flex gap-2">
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') search() }}
            placeholder="输入测试查询…"
            className="flex-1 rounded-2xl border border-base-line bg-base-surface px-4 py-2.5 text-sm outline-none focus:border-lavender"
          />
          <button onClick={search} disabled={loading || !query.trim()}
            className="rounded-2xl bg-lavender px-4 py-2.5 text-white text-sm disabled:opacity-50 flex items-center gap-1.5"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            搜索
          </button>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {presetQueries.map(q => (
            <button key={q} onClick={() => setQuery(q)}
              className="rounded-full border border-base-line px-3 py-1 text-xs hover:bg-base-surface"
            >{q}</button>
          ))}
        </div>

        <div className="flex items-center gap-4 text-xs text-base-muted">
          <label className="flex items-center gap-1.5">
            相似度阈值
            <input type="number" step={0.05} min={0} max={1} value={threshold}
              onChange={e => setThreshold(Number(e.target.value))}
              className="w-16 rounded-lg border border-base-line bg-base-surface px-2 py-1 outline-none"
            />
          </label>
          <label className="flex items-center gap-1.5">
            返回条数
            <input type="number" step={1} min={1} max={50} value={limit}
              onChange={e => setLimit(Number(e.target.value))}
              className="w-16 rounded-lg border border-base-line bg-base-surface px-2 py-1 outline-none"
            />
          </label>
        </div>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 mb-4">
          <div className="flex items-center gap-2 text-red-600 text-sm mb-2">
            <AlertTriangle className="w-4 h-4" /> 错误
          </div>
          <pre className="text-xs text-red-700 whitespace-pre-wrap">{error}</pre>
        </div>
      )}

      {result && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-base-line bg-base-surface p-3 text-xs space-y-1">
            <div className="font-medium text-sm mb-1">Embedding 信息</div>
            <div>模型: {result.embedding.model}</div>
            <div>维度: {result.embedding.dimensions}</div>
            <div>耗时: {result.embedding.timeMs}ms</div>
            {result.embedding.usage && <div>Token: {result.embedding.usage.total_tokens}</div>}
            <div className="truncate">前10维: [{result.embedding.first10.map(v => v.toFixed(4)).join(', ')}]</div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-sm font-medium">
                  向量检索
                  {result.vector.error && ' ⚠'}
                </h2>
                <span className="text-xs text-base-muted">{result.vector.results.length} 条</span>
              </div>
              {result.vector.error && (
                <div className="text-xs text-red-500 mb-2">{result.vector.error}</div>
              )}
              <div className="space-y-2">
                {result.vector.results.map(r => (
                  <div key={r.id}
                    className={`rounded-xl border p-2.5 text-xs ${result.overlap.ids.includes(r.id) ? 'border-green-300 bg-green-50/50' : 'border-base-line bg-base-surface'}`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium text-[11px] px-1.5 py-0.5 rounded bg-base-line/50">{r.type}</span>
                      <span className={`font-mono ${r.similarity >= 0.7 ? 'text-green-600' : r.similarity >= 0.4 ? 'text-amber-600' : 'text-red-500'}`}>
                        {r.similarity.toFixed(4)}
                      </span>
                    </div>
                    <div className="text-base-text mb-0.5">{r.content}</div>
                    <div className="text-base-muted text-[11px]">
                      {r.date}
                      {r.finance_category && ` · ${r.finance_category}`}
                      {r.mood && ` · ${r.mood}`}
                      {r.amount != null && ` · ¥${r.amount}`}
                    </div>
                  </div>
                ))}
                {result.vector.results.length === 0 && (
                  <div className="text-xs text-base-muted text-center py-6">无结果（阈值 {result.params.threshold}）</div>
                )}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-sm font-medium">
                  全文检索
                  {result.fulltext.error && ' ⚠'}
                </h2>
                <span className="text-xs text-base-muted">{result.fulltext.results.length} 条</span>
              </div>
              {result.fulltext.error && (
                <div className="text-xs text-red-500 mb-2">{result.fulltext.error}</div>
              )}
              <div className="space-y-2">
                {result.fulltext.results.map(r => (
                  <div key={r.id}
                    className={`rounded-xl border p-2.5 text-xs ${result.overlap.ids.includes(r.id) ? 'border-green-300 bg-green-50/50' : 'border-base-line bg-base-surface'}`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium text-[11px] px-1.5 py-0.5 rounded bg-base-line/50">{r.type}</span>
                    </div>
                    <div className="text-base-text mb-0.5">{r.content}</div>
                    <div className="text-base-muted text-[11px]">
                      {r.date}
                      {r.finance_category && ` · ${r.finance_category}`}
                      {r.mood && ` · ${r.mood}`}
                      {r.amount != null && ` · ¥${r.amount}`}
                    </div>
                  </div>
                ))}
                {result.fulltext.results.length === 0 && (
                  <div className="text-xs text-base-muted text-center py-6">无结果</div>
                )}
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-base-line bg-base-surface p-3 text-xs">
            <span className="font-medium">重叠分析：</span>
            两种策略共同命中 <span className="font-semibold">{result.overlap.count}</span> 条
            {result.overlap.count > 0 && (
              <span className="text-base-muted">（已用绿色边框标注）</span>
            )}
          </div>
        </div>
      )}

      {!result && !loading && !error && (
        <div className="text-center text-base-muted text-sm py-12">
          输入查询文本，对比向量检索和全文检索的效果
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center gap-2 text-sm text-base-muted py-12">
          <Loader2 className="w-4 h-4 animate-spin" /> 检索中…
        </div>
      )}
    </div>
  )
}
