-- 创建每日日记表
-- 由 daily-summary API 每天自动生成 AI 日记条目
-- 每条记录对应一个用户一天的一篇日记（Florian 第一人称视角）

BEGIN;

CREATE TABLE IF NOT EXISTS daily_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    date TEXT NOT NULL, -- YYYY-MM-DD 格式
    content TEXT NOT NULL, -- AI 生成的日记正文
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE(user_id, date)
);

-- 外键约束
ALTER TABLE daily_logs
ADD CONSTRAINT fk_daily_logs_user_id
FOREIGN KEY (user_id)
REFERENCES auth.users(id) ON DELETE CASCADE;

-- 索引
CREATE INDEX IF NOT EXISTS idx_daily_logs_user_id ON daily_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_daily_logs_date ON daily_logs(date DESC);

-- updated_at 自动更新
CREATE OR REPLACE FUNCTION update_daily_logs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trig_daily_logs_updated_at ON daily_logs;
CREATE TRIGGER trig_daily_logs_updated_at
    BEFORE UPDATE ON daily_logs
    FOR EACH ROW
    EXECUTE FUNCTION update_daily_logs_updated_at();

-- RLS
ALTER TABLE daily_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own daily logs" ON daily_logs;
CREATE POLICY "Users can view their own daily logs"
ON daily_logs FOR SELECT
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own daily logs" ON daily_logs;
CREATE POLICY "Users can insert their own daily logs"
ON daily_logs FOR INSERT
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own daily logs" ON daily_logs;
CREATE POLICY "Users can update their own daily logs"
ON daily_logs FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

COMMIT;
