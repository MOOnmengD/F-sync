-- 创建用户画像摘要表
-- 这个表用于存储 AI 定期生成的用户画像摘要，作为长期记忆
-- 例如：饮食偏好、常提及的人物、近期心情等

BEGIN;

-- 创建 user_profiles 表
CREATE TABLE IF NOT EXISTS user_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    profile_type TEXT NOT NULL, -- 例如: 'diet_preferences', 'person_mentions', 'recent_moods', 'spending_patterns'
    content JSONB NOT NULL DEFAULT '{}'::jsonb, -- 结构化的摘要内容
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    -- 确保每个用户每个类型只有一条最新记录（可以定期更新）
    UNIQUE(user_id, profile_type)
);

-- 添加外键约束（可选，参考 chat_messages 表）
ALTER TABLE user_profiles 
ADD CONSTRAINT fk_user_profiles_user_id 
FOREIGN KEY (user_id) 
REFERENCES auth.users(id) ON DELETE CASCADE;

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_user_profiles_user_id ON user_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_profiles_profile_type ON user_profiles(profile_type);
CREATE INDEX IF NOT EXISTS idx_user_profiles_updated_at ON user_profiles(updated_at DESC);

-- 创建 updated_at 自动更新触发器
CREATE OR REPLACE FUNCTION update_user_profiles_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trig_user_profiles_updated_at ON user_profiles;
CREATE TRIGGER trig_user_profiles_updated_at
    BEFORE UPDATE ON user_profiles
    FOR EACH ROW
    EXECUTE FUNCTION update_user_profiles_updated_at();

-- 启用 RLS（行级安全策略）
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- 创建策略：用户只能访问自己的画像
DROP POLICY IF EXISTS "Users can view their own profiles" ON user_profiles;
CREATE POLICY "Users can view their own profiles"
ON user_profiles FOR SELECT
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own profiles" ON user_profiles;
CREATE POLICY "Users can insert their own profiles"
ON user_profiles FOR INSERT
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own profiles" ON user_profiles;
CREATE POLICY "Users can update their own profiles"
ON user_profiles FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own profiles" ON user_profiles;
CREATE POLICY "Users can delete their own profiles"
ON user_profiles FOR DELETE
USING (auth.uid() = user_id);

COMMIT;