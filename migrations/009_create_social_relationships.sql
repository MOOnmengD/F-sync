-- 009: 社交关系表
-- 以增量方式存储用户生活中的人物/宠物关系，每条记录一个独立实体
-- 取代 user_profiles 中 person_mentions 的覆盖式更新

BEGIN;

CREATE TABLE IF NOT EXISTS social_relationships (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL,
    name        TEXT NOT NULL,
    relation    TEXT,
    impression  TEXT,
    history     JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE(user_id, name)
);

ALTER TABLE social_relationships
  ADD CONSTRAINT fk_social_relationships_user_id
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_social_relationships_user_id
  ON social_relationships(user_id);

CREATE INDEX IF NOT EXISTS idx_social_relationships_updated_at
  ON social_relationships(updated_at DESC);

ALTER TABLE social_relationships ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own social relationships" ON social_relationships;
CREATE POLICY "Users can manage own social relationships" ON social_relationships
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

COMMIT;
