-- 013: 为每日事件添加事件时间字段，支持按时间排序
-- event_time 存储大致事件时间（TIME 类型），可为空（无明确时间时）

BEGIN;

ALTER TABLE daily_event_items ADD COLUMN IF NOT EXISTS event_time TIME;

COMMIT;
