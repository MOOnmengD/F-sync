import { createClient } from '@supabase/supabase-js'

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseServiceKey) {
    return res.status(500).json({ error: 'Missing Supabase configuration' })
  }

  const { token } = req.body || {}
  if (!token || typeof token !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid token' })
  }

  const cleanToken = token.trim()
  if (!cleanToken) {
    return res.status(400).json({ error: 'Token is empty after trimming' })
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)
  const userId = process.env.PROACTIVE_USER_ID || '17bc4400-b67a-45b0-9366-0e689eedfa09'

  const { error } = await supabase
    .from('push_tokens')
    .upsert(
      { user_id: userId, token: cleanToken, platform: 'harmony', updated_at: new Date().toISOString() },
      { onConflict: 'user_id,platform' }
    )

  if (error) {
    console.error('[Save Push Token]', error)
    return res.status(500).json({ error: error.message })
  }

  return res.status(200).json({ success: true })
}
