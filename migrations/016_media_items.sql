-- 016: 书影清单 — 创建 media_items 表
-- 用途：记录书籍/影片的阅读观看状态和个人点评

CREATE TABLE media_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id),
  title       TEXT NOT NULL,
  media_type  TEXT NOT NULL CHECK (media_type IN ('book', 'movie')),
  status      TEXT NOT NULL DEFAULT 'want_to_consume'
              CHECK (status IN ('want_to_consume', 'consuming', 'consumed')),
  review      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_media_items_user_type_status ON media_items (user_id, media_type, status);
CREATE INDEX idx_media_items_user_created ON media_items (user_id, created_at DESC);

ALTER TABLE media_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY media_items_user_policy ON media_items
  FOR ALL USING (auth.uid() = user_id);

-- 自动更新 updated_at
CREATE OR REPLACE FUNCTION update_media_items_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER media_items_updated_at
  BEFORE UPDATE ON media_items
  FOR EACH ROW EXECUTE FUNCTION update_media_items_updated_at();
