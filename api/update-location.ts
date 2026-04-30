import { createClient } from '@supabase/supabase-js'

export default async function handler(req: any, res: any) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8')

  if (req.method !== 'POST') {
    res.statusCode = 405
    res.end(JSON.stringify({ error: 'Method Not Allowed' }))
    return
  }

  try {
    const body = req.body || {}
    const userId = body.userId
    const latitude = typeof body.latitude === 'number' ? body.latitude : parseFloat(body.latitude)
    const longitude = typeof body.longitude === 'number' ? body.longitude : parseFloat(body.longitude)
    const accuracy = body.accuracy != null ? parseFloat(body.accuracy) : null
    const address = body.address || null
    const source = body.source || 'foreground'

    if (!userId) {
      res.statusCode = 400
      res.end(JSON.stringify({ error: 'Missing userId' }))
      return
    }

    if (isNaN(latitude) || isNaN(longitude)) {
      res.statusCode = 400
      res.end(JSON.stringify({ error: 'Invalid latitude or longitude' }))
      return
    }

    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      res.statusCode = 400
      res.end(JSON.stringify({ error: 'Coordinates out of range' }))
      return
    }

    const supabaseUrl = process.env.VITE_SUPABASE_URL
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY
    if (!supabaseUrl || !supabaseKey) {
      res.statusCode = 500
      res.end(JSON.stringify({ error: 'Missing Supabase configuration' }))
      return
    }

    // 高德逆地理编码：坐标 → 结构化地址 + 附近 POI
    let amapAddress = ''
    const amapKey = process.env.AMAP_API_KEY
    console.log(`[update-location] AMAP_API_KEY configured: ${amapKey ? 'yes' : 'NO'}`)
    if (amapKey) {
      try {
        const amapRes = await fetch(
          `https://restapi.amap.com/v3/geocode/regeo?location=${longitude.toFixed(6)},${latitude.toFixed(6)}&extensions=all&radius=500&output=json&key=${amapKey}`
        )
        if (amapRes.ok) {
          const amapData = await amapRes.json()
          if (amapData.status === '1' && amapData.regeocode) {
            const parts: string[] = []
            const regeo = amapData.regeocode

            // 结构化地址
            if (regeo.formatted_address) {
              parts.push(regeo.formatted_address)
            }

            // 建筑名
            const building = regeo.addressComponent?.building
            if (building && building.name && typeof building.name === 'string') {
              parts.push(building.name)
            }

            // 最近 POI（200 米内）
            const pois = regeo.pois
            if (Array.isArray(pois) && pois.length > 0) {
              const nearest = pois[0]
              if (nearest.name && nearest.distance != null) {
                const dist = parseInt(nearest.distance, 10)
                if (dist <= 200) {
                  const poiStr = dist === 0 ? nearest.name : `${nearest.name}${dist}米`
                  parts.push(`靠近${poiStr}`)
                }
              }
            }

            amapAddress = parts.join(' ')
            console.log(`[update-location] Amap address: "${amapAddress}"`)
          }
        } else {
          console.warn(`[update-location] Amap API failed: ${amapRes.status}`)
        }
      } catch (amapErr: any) {
        console.warn(`[update-location] Amap error: ${amapErr.message}`)
      }
    }

    // 地址优先级：高德 > HarmonyOS Location Kit
    const finalAddress = amapAddress || address

    const supabase = createClient(supabaseUrl, supabaseKey)

    const { error } = await supabase
      .from('user_locations')
      .upsert({
        user_id: userId,
        latitude,
        longitude,
        accuracy,
        address: finalAddress,
        source,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'user_id'
      })

    if (error) {
      console.error('[update-location] Upsert failed:', error)
      res.statusCode = 500
      res.end(JSON.stringify({ error: 'Failed to save location' }))
      return
    }

    res.statusCode = 200
    res.end(JSON.stringify({ message: 'Location updated' }))
  } catch (err: any) {
    console.error('[update-location] Error:', err)
    res.statusCode = 500
    res.end(JSON.stringify({ error: `Server error: ${err?.message || 'unknown'}` }))
  }
}
