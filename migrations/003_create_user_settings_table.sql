-- 创建用户设置表
-- 用于云端存储用户的 AI 设置（角色设定、API 配置等），防止应用重装后丢失
-- 每个用户只有一条记录，通过 upsert 更新

BEGIN;

CREATE TABLE IF NOT EXISTS user_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE, -- 每个用户只有一条设置记录
    settings JSONB NOT NULL DEFAULT '{}'::jsonb, -- 完整的 AISettings 对象
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- 确保每个用户只有一条记录
    CONSTRAINT fk_user_settings_user_id
        FOREIGN KEY (user_id)
        REFERENCES auth.users(id) ON DELETE CASCADE
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_user_settings_user_id ON user_settings(user_id);

-- 创建 updated_at 自动更新触发器
CREATE OR REPLACE FUNCTION update_user_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trig_user_settings_updated_at ON user_settings;
CREATE TRIGGER trig_user_settings_updated_at
    BEFORE UPDATE ON user_settings
    FOR EACH ROW
    EXECUTE FUNCTION update_user_settings_updated_at();

-- 启用 RLS
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;

-- 创建策略：用户只能访问自己的设置
DROP POLICY IF EXISTS "Users can view their own settings" ON user_settings;
CREATE POLICY "Users can view their own settings"
ON user_settings FOR SELECT
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own settings" ON user_settings;
CREATE POLICY "Users can insert their own settings"
ON user_settings FOR INSERT
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own settings" ON user_settings;
CREATE POLICY "Users can update their own settings"
ON user_settings FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own settings" ON user_settings;
CREATE POLICY "Users can delete their own settings"
ON user_settings FOR DELETE
USING (auth.uid() = user_id);

COMMIT;
