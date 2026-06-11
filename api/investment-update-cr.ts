import { createClient } from '@supabase/supabase-js'

export default async function handler(req: any, res: any) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8')

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' })
  }

  try {
    const body = req.body || {}
    const { userId, investmentId, currentValueCents, currentProfitRate } = body

    // 参数校验
    if (!userId || !investmentId) {
      return res.status(400).json({ error: 'Missing userId or investmentId' })
    }
    if (typeof currentValueCents !== 'number' || !Number.isFinite(currentValueCents)) {
      return res.status(400).json({ error: 'Invalid currentValueCents' })
    }
    if (typeof currentProfitRate !== 'number' || !Number.isFinite(currentProfitRate)) {
      return res.status(400).json({ error: 'Invalid currentProfitRate' })
    }

    const supabaseUrl = process.env.VITE_SUPABASE_URL
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY
    if (!supabaseUrl || !supabaseKey) {
      return res.status(500).json({ error: 'Missing Supabase configuration' })
    }

    const supabase = createClient(supabaseUrl, supabaseKey)

    // 校验 investment 归属
    const { data: inv, error: invErr } = await supabase
      .from('investments')
      .select('id, current_value_cents, current_profit_rate')
      .eq('id', investmentId)
      .eq('user_id', userId)
      .maybeSingle()

    if (invErr || !inv) {
      return res.status(404).json({ error: 'Investment not found' })
    }

    const cBefore = Number(inv.current_value_cents)
    const rBefore = Number(inv.current_profit_rate)

    // 更新 C 和 R
    const { error: updateErr } = await supabase
      .from('investments')
      .update({
        current_value_cents: currentValueCents,
        current_profit_rate: currentProfitRate,
      })
      .eq('id', investmentId)

    if (updateErr) {
      return res.status(500).json({ error: updateErr.message })
    }

    // 写入操作流水
    const { error: actionErr } = await supabase.from('investment_actions').insert({
      user_id: userId,
      investment_id: investmentId,
      action_type: 'update_cr',
      amount_cents: null,
      c_before_cents: cBefore,
      c_after_cents: currentValueCents,
      notes: `C: ${cBefore}→${currentValueCents} (¥${(cBefore / 100).toFixed(2)}→¥${(currentValueCents / 100).toFixed(2)}), R: ${(rBefore * 100).toFixed(2)}%→${(currentProfitRate * 100).toFixed(2)}%`,
    })

    if (actionErr) {
      console.warn('[investment-update-cr] action log failed:', actionErr.message)
    }

    return res.status(200).json({
      success: true,
      cBefore: cBefore,
      cAfter: currentValueCents,
      rBefore,
      rAfter: currentProfitRate,
    })
  } catch (e: any) {
    console.error('[investment-update-cr]', e)
    return res.status(500).json({ error: `Server error: ${e?.message || 'unknown'}` })
  }
}
