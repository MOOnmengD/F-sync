import { createClient } from '@supabase/supabase-js'

export default async function handler(req: any, res: any) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8')

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' })
  }

  try {
    const body = req.body || {}
    const {
      userId,
      investmentId,
      suggestionId,
      actualAmountCents,
      actionType,
      cBeforeCents,
      cAfterCents,
    } = body

    // 参数校验
    if (!userId || !investmentId) {
      return res.status(400).json({ error: 'Missing userId or investmentId' })
    }
    if (
      typeof actualAmountCents !== 'number' ||
      typeof cBeforeCents !== 'number' ||
      typeof cAfterCents !== 'number'
    ) {
      return res.status(400).json({ error: 'Invalid amount fields' })
    }
    const validActions = ['confirm_suggestion', 'override_suggestion', 'manual_adjust']
    if (!validActions.includes(actionType)) {
      return res.status(400).json({ error: `Invalid actionType. Must be one of: ${validActions.join(', ')}` })
    }

    const supabaseUrl = process.env.VITE_SUPABASE_URL
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY
    if (!supabaseUrl || !supabaseKey) {
      return res.status(500).json({ error: 'Missing Supabase configuration' })
    }

    const supabase = createClient(supabaseUrl, supabaseKey)

    // 1. 校验 investment 归属
    const { data: inv, error: invErr } = await supabase
      .from('investments')
      .select('id, current_value_cents')
      .eq('id', investmentId)
      .eq('user_id', userId)
      .maybeSingle()

    if (invErr || !inv) {
      return res.status(404).json({ error: 'Investment not found' })
    }

    // 2. 更新 suggestion（如有）
    if (suggestionId) {
      await supabase
        .from('investment_suggestions')
        .update({
          action_status: actionType === 'confirm_suggestion' ? 'confirmed' : 'overridden',
          actual_amount_cents: actualAmountCents,
          action_time: new Date().toISOString(),
        })
        .eq('id', suggestionId)
        .eq('user_id', userId)
    }

    // 3. 写入操作流水
    const { error: actionErr } = await supabase.from('investment_actions').insert({
      user_id: userId,
      investment_id: investmentId,
      suggestion_id: suggestionId || null,
      action_type: actionType,
      amount_cents: actualAmountCents,
      c_before_cents: cBeforeCents,
      c_after_cents: cAfterCents,
    })

    if (actionErr) {
      return res.status(500).json({ error: actionErr.message })
    }

    // 4. 更新持仓 C
    const { error: updateErr } = await supabase
      .from('investments')
      .update({ current_value_cents: cAfterCents })
      .eq('id', investmentId)

    if (updateErr) {
      return res.status(500).json({ error: updateErr.message })
    }

    return res.status(200).json({ success: true })
  } catch (e: any) {
    console.error('[investment-action]', e)
    return res.status(500).json({ error: `Server error: ${e?.message || 'unknown'}` })
  }
}
