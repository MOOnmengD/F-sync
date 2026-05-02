/**
 * 天气查询工具 — 每日首次查询调用高德 API，当天后续复用缓存
 *
 * 使用方式（各 API 文件内）：
 *   import { getWeather } from './_weather'
 *   const weatherInfo = await getWeather({ supabase, userId, amapKey })
 */

export async function getWeather(params: {
  supabase: any
  userId: string
  amapKey: string
}): Promise<string | null> {
  const { supabase, userId, amapKey } = params

  try {
    const today = new Date().toISOString().split('T')[0]

    // 检查缓存
    const { data: cached } = await supabase
      .from('weather_cache')
      .select('date, weather')
      .eq('user_id', userId)
      .single()

    if (cached && cached.date === today) {
      const w = cached.weather
      return `今日天气：${w.weather}，气温 ${w.temperature}℃，${w.winddirection} ${w.windpower} 级`
    }

    // 获取位置 + adcode
    const { data: locData } = await supabase
      .from('user_locations')
      .select('latitude, longitude, adcode')
      .eq('user_id', userId)
      .single()

    if (!locData) return null

    let adcode = locData.adcode

    // 如果没有 adcode，通过逆地理编码获取
    if (!adcode) {
      const regeoRes = await fetch(
        `https://restapi.amap.com/v3/geocode/regeo?location=${locData.longitude.toFixed(6)},${locData.latitude.toFixed(6)}&extensions=base&output=json&key=${amapKey}`
      )
      if (regeoRes.ok) {
        const d = await regeoRes.json()
        if (d.status === '1' && d.regeocode?.addressComponent?.adcode) {
          adcode = d.regeocode.addressComponent.adcode
          // 异步存储 adcode 供后续复用
          supabase.from('user_locations')
            .update({ adcode, updated_at: new Date().toISOString() })
            .eq('user_id', userId)
            .then(({ error }: any) => {
              if (error) console.warn('[Weather] 保存 adcode 失败:', error.message)
            })
        }
      }
    }

    if (!adcode) return null

    // 调用天气 API
    const weatherRes = await fetch(
      `https://restapi.amap.com/v3/weather/weatherInfo?city=${adcode}&key=${amapKey}&extensions=base&output=json`
    )
    if (!weatherRes.ok) return null

    const weatherData = await weatherRes.json()
    if (weatherData.status !== '1' || !weatherData.lives?.length) return null

    const live = weatherData.lives[0]

    const weatherObj = {
      weather: live.weather,
      temperature: live.temperature,
      winddirection: live.winddirection,
      windpower: live.windpower,
      reporttime: live.reporttime
    }

    // 写缓存
    await supabase
      .from('weather_cache')
      .upsert({
        user_id: userId,
        date: today,
        weather: weatherObj,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id' })

    return `今日天气：${weatherObj.weather}，气温 ${weatherObj.temperature}℃，${weatherObj.winddirection} ${weatherObj.windpower} 级`

  } catch (err: any) {
    console.warn('[Weather] 获取天气失败:', err.message)
    return null
  }
}
