-- 用 chat_time_start / chat_time_end 替代 event_time
-- chat_time_start: 事件对应对话的起始时间（HH:MM）
-- chat_time_end:   事件对应对话的结束时间（HH:MM）

ALTER TABLE daily_event_items ADD COLUMN IF NOT EXISTS chat_time_start TIME;
ALTER TABLE daily_event_items ADD COLUMN IF NOT EXISTS chat_time_end TIME;

-- 将现有 event_time 数据迁移到 chat_time_start
UPDATE daily_event_items SET chat_time_start = event_time WHERE chat_time_start IS NULL;

ALTER TABLE daily_event_items DROP COLUMN IF EXISTS event_time;
