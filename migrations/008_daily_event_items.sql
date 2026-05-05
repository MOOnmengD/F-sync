-- 用 daily_event_items 替代 daily_events
-- 每条事件独立一行，支持逐条编辑/检索
-- type: 'event' (普通事件) | 'todo' (约定/待办)
-- status: NULL (event 无状态) | 'pending' | 'done' (todo 专用)

BEGIN;

-- 新建结构化事件表
CREATE TABLE IF NOT EXISTS daily_event_items (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES auth.users(id),
    date date NOT NULL,
    type text NOT NULL DEFAULT 'event' CHECK (type IN ('event', 'todo')),
    status text DEFAULT NULL CHECK (status IS NULL OR status IN ('pending', 'done')),
    content text NOT NULL,
    sort_order int NOT NULL DEFAULT 0,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- RLS
ALTER TABLE daily_event_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own daily event items"
    ON daily_event_items FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own daily event items"
    ON daily_event_items FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own daily event items"
    ON daily_event_items FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own daily event items"
    ON daily_event_items FOR DELETE
    USING (auth.uid() = user_id);

-- 索引
CREATE INDEX IF NOT EXISTS idx_daily_event_items_user_date
    ON daily_event_items (user_id, date);

-- 废弃旧表
DROP TABLE IF EXISTS daily_events;

COMMIT;
