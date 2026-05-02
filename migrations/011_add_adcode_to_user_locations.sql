-- 011: user_locations 添加 adcode 列，供天气 API 使用

ALTER TABLE public.user_locations ADD COLUMN IF NOT EXISTS adcode TEXT;
