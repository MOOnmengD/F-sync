-- 018: 书影连续点评与状态事件
-- 用途：
-- 1. 同一个 media_items 条目保存多条点评
-- 2. 记录想看 / 正在看 / 看过的状态变化时间
-- 3. 提供统一 RPC，原子更新条目当前快照并写入历史事件

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS idx_media_items_id_user
  ON media_items (id, user_id);

CREATE TABLE IF NOT EXISTS media_item_events (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  media_item_id        UUID NOT NULL,
  media_title_snapshot TEXT NOT NULL,
  media_type_snapshot  TEXT NOT NULL
                       CHECK (media_type_snapshot IN ('book', 'movie')),
  review               TEXT,
  status_from          TEXT
                       CHECK (
                         status_from IS NULL OR
                         status_from IN ('want_to_consume', 'consuming', 'consumed')
                       ),
  status_to            TEXT
                       CHECK (
                         status_to IS NULL OR
                         status_to IN ('want_to_consume', 'consuming', 'consumed')
                       ),
  occurred_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    NULLIF(BTRIM(review), '') IS NOT NULL
    OR status_to IS NOT NULL
  ),
  FOREIGN KEY (media_item_id, user_id)
    REFERENCES media_items(id, user_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_media_item_events_item_time
  ON media_item_events (media_item_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_media_item_events_user_time
  ON media_item_events (user_id, occurred_at DESC);

ALTER TABLE media_item_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS media_item_events_user_policy ON media_item_events;
CREATE POLICY media_item_events_user_policy
  ON media_item_events
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

REVOKE ALL ON TABLE media_item_events FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE media_item_events TO authenticated;
GRANT ALL ON TABLE media_item_events TO service_role;

-- 将现有条目的当前状态与点评迁移为第一条历史事件。
-- NOT EXISTS 使迁移脚本在需要重新执行时不会重复回填。
INSERT INTO media_item_events (
  user_id,
  media_item_id,
  media_title_snapshot,
  media_type_snapshot,
  review,
  status_from,
  status_to,
  occurred_at,
  created_at
)
SELECT
  item.user_id,
  item.id,
  item.title,
  item.media_type,
  NULLIF(BTRIM(item.review), ''),
  NULL,
  item.status,
  item.created_at,
  item.created_at
FROM media_items AS item
WHERE NOT EXISTS (
  SELECT 1
  FROM media_item_events AS event
  WHERE event.media_item_id = item.id
);

CREATE OR REPLACE FUNCTION save_media_record(
  p_media_item_id UUID,
  p_title TEXT,
  p_media_type TEXT,
  p_status TEXT,
  p_review TEXT,
  p_occurred_at TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_existing media_items%ROWTYPE;
  v_saved media_items%ROWTYPE;
  v_title TEXT;
  v_media_type TEXT;
  v_status TEXT;
  v_review TEXT := NULLIF(BTRIM(p_review), '');
  v_occurred_at TIMESTAMPTZ := COALESCE(p_occurred_at, now());
  v_status_changed BOOLEAN := FALSE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION '登录状态失效，请重新登录';
  END IF;

  IF p_media_item_id IS NULL THEN
    v_title := NULLIF(BTRIM(p_title), '');
    v_media_type := p_media_type;
    v_status := p_status;

    IF v_title IS NULL THEN
      RAISE EXCEPTION '书影标题不能为空';
    END IF;
  ELSE
    SELECT *
      INTO v_existing
      FROM media_items
     WHERE id = p_media_item_id
       AND user_id = v_user_id
     FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION '未找到可更新的书影条目';
    END IF;

    v_title := COALESCE(NULLIF(BTRIM(p_title), ''), v_existing.title);
    v_media_type := COALESCE(p_media_type, v_existing.media_type);
    v_status := COALESCE(p_status, v_existing.status);
    v_status_changed := v_status IS DISTINCT FROM v_existing.status;
  END IF;

  IF v_media_type IS NULL OR v_media_type NOT IN ('book', 'movie') THEN
    RAISE EXCEPTION '无效的书影类型';
  END IF;

  IF v_status IS NULL OR v_status NOT IN ('want_to_consume', 'consuming', 'consumed') THEN
    RAISE EXCEPTION '无效的书影状态';
  END IF;

  IF p_media_item_id IS NULL THEN
    INSERT INTO media_items (
      user_id,
      title,
      media_type,
      status,
      review
    )
    VALUES (
      v_user_id,
      v_title,
      v_media_type,
      v_status,
      v_review
    )
    RETURNING * INTO v_saved;

    INSERT INTO media_item_events (
      user_id,
      media_item_id,
      media_title_snapshot,
      media_type_snapshot,
      review,
      status_from,
      status_to,
      occurred_at
    )
    VALUES (
      v_user_id,
      v_saved.id,
      v_saved.title,
      v_saved.media_type,
      v_review,
      NULL,
      v_saved.status,
      v_occurred_at
    );
  ELSE
    UPDATE media_items
       SET title = v_title,
           media_type = v_media_type,
           status = v_status,
           review = CASE
             WHEN v_review IS NOT NULL THEN v_review
             ELSE review
           END
     WHERE id = p_media_item_id
       AND user_id = v_user_id
    RETURNING * INTO v_saved;

    IF v_review IS NOT NULL OR v_status_changed THEN
      INSERT INTO media_item_events (
        user_id,
        media_item_id,
        media_title_snapshot,
        media_type_snapshot,
        review,
        status_from,
        status_to,
        occurred_at
      )
      VALUES (
        v_user_id,
        v_saved.id,
        v_saved.title,
        v_saved.media_type,
        v_review,
        CASE WHEN v_status_changed THEN v_existing.status ELSE NULL END,
        CASE WHEN v_status_changed THEN v_saved.status ELSE NULL END,
        v_occurred_at
      );
    END IF;
  END IF;

  RETURN TO_JSONB(v_saved);
END;
$$;

REVOKE ALL ON FUNCTION save_media_record(UUID, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION save_media_record(UUID, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ) TO authenticated;

COMMIT;
