-- 007: 用户位置记录表
-- 用途：存储用户最近的地理位置，供 AI 对话获取位置上下文
-- 用于判断用户当前在实验室、食堂、宿舍还是校外，辅助 AI 判断用户状态

CREATE TABLE IF NOT EXISTS user_locations (
    id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id   UUID NOT NULL,
    latitude  float8 NOT NULL,
    longitude float8 NOT NULL,
    accuracy  float8,
    source    text NOT NULL DEFAULT 'foreground',
    updated_at timestamptz NOT NULL DEFAULT now(),

    UNIQUE(user_id)
);

-- 外键约束
ALTER TABLE user_locations
  ADD CONSTRAINT fk_user_locations_user_id
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- 索引
CREATE INDEX IF NOT EXISTS idx_user_locations_user_id ON user_locations(user_id);
CREATE INDEX IF NOT EXISTS idx_user_locations_updated_at ON user_locations(updated_at DESC);

-- RLS
ALTER TABLE user_locations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own location" ON user_locations;
CREATE POLICY "Users can manage own location" ON user_locations
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
