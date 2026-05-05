-- 创建每日事件表
-- 存储从聊天记录中提取的客观事件 + 约定/待办
-- 作为对话/长期记忆的索引层

BEGIN;

CREATE TABLE IF NOT EXISTS daily_events (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES auth.users(id),
    date date NOT NULL,
    content text NOT NULL DEFAULT '',
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    UNIQUE(user_id, date)
);

-- RLS 策略：用户只能访问自己的事件
ALTER TABLE daily_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own daily events"
    ON daily_events FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own daily events"
    ON daily_events FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own daily events"
    ON daily_events FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own daily events"
    ON daily_events FOR DELETE
    USING (auth.uid() = user_id);

COMMIT;
