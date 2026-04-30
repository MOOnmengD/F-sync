-- 008: user_locations 新增逆地理编码地址字段
ALTER TABLE user_locations ADD COLUMN IF NOT EXISTS address text;
