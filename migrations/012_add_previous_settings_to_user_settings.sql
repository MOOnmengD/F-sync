-- 012: 为 user_settings 表增加 previous_settings 列
-- 每次保存时备份上一版本的 settings，保留最近 2 个版本便于回退

ALTER TABLE user_settings
ADD COLUMN IF NOT EXISTS previous_settings JSONB DEFAULT NULL;
