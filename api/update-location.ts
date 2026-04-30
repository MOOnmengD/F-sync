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

    const supabase = createClient(supabaseUrl, supabaseKey)

    const { error } = await supabase
      .from('user_locations')
      .upsert({
        user_id: userId,
        latitude,
        longitude,
        accuracy,
        address,
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
