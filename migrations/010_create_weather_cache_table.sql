-- 010: 天气缓存表
-- 每天首次 AI 对话时调用高德天气 API 并缓存结果，当天后续对话复用缓存

CREATE TABLE IF NOT EXISTS public.weather_cache (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  weather JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

ALTER TABLE public.weather_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own weather cache" ON public.weather_cache
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_weather_cache_user_id ON public.weather_cache USING btree (user_id);
