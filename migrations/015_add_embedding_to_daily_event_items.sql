-- 为 daily_event_items 添加向量支持
-- 用于 chat-completion API 的按需记忆检索（检索前置判断 → 向量检索事件 → 获取原始对话）

BEGIN;

-- 1. 添加 embedding 列（与 transactions.embedding 同维度）
ALTER TABLE daily_event_items ADD COLUMN IF NOT EXISTS embedding vector(3072);

-- 2. 创建向量相似度搜索函数
CREATE OR REPLACE FUNCTION match_daily_event_items(
    query_embedding vector,
    match_threshold float DEFAULT 0.3,
    match_count int DEFAULT 5
)
RETURNS TABLE(
    id uuid,
    content text,
    type text,
    status text,
    date date,
    chat_time_start time,
    chat_time_end time,
    similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        e.id,
        e.content,
        e.type,
        e.status,
        e.date,
        e.chat_time_start,
        e.chat_time_end,
        1 - (e.embedding <=> query_embedding) AS similarity
    FROM daily_event_items e
    WHERE e.embedding IS NOT NULL
        AND 1 - (e.embedding <=> query_embedding) > match_threshold
    ORDER BY e.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;

COMMIT;
