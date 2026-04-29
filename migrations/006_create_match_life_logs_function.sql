-- 创建向量相似度搜索函数
-- 用于 chat-completion API 的 RAG 检索策略（向量检索）
-- 通过 pgvector 的余弦距离匹配与查询最相似的 transactions 记录

BEGIN;

CREATE OR REPLACE FUNCTION match_life_logs(
    query_embedding vector,
    match_threshold float DEFAULT 0.3,
    match_count int DEFAULT 5
)
RETURNS TABLE(
    id uuid,
    content text,
    type text,
    created_at timestamptz,
    amount numeric,
    details text,
    finance_category text,
    brand_snapshot text,
    item_name_snapshot text,
    review text,
    mood text,
    ai_metadata jsonb,
    similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        t.id,
        t.content,
        t.type,
        t.created_at,
        t.amount,
        t.details,
        t.finance_category,
        t.brand_snapshot,
        t.item_name_snapshot,
        t.review,
        t.mood,
        t.ai_metadata,
        1 - (t.embedding <=> query_embedding) AS similarity
    FROM transactions t
    WHERE t.embedding IS NOT NULL
        AND 1 - (t.embedding <=> query_embedding) > match_threshold
    ORDER BY t.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;

COMMIT;
