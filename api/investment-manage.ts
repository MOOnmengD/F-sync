import { createClient } from '@supabase/supabase-js'

export default async function handler(req: any, res: any) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8')

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' })
  }

  try {
    const body = req.body || {}
    const { userId, action } = body

    if (!userId) {
      return res.status(400).json({ error: 'Missing userId' })
    }
    if (!['create', 'update', 'deactivate'].includes(action)) {
      return res.status(400).json({ error: 'Invalid action. Must be: create, update, or deactivate' })
    }

    const supabaseUrl = process.env.VITE_SUPABASE_URL
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY
    if (!supabaseUrl || !supabaseKey) {
      return res.status(500).json({ error: 'Missing Supabase configuration' })
    }

    const supabase = createClient(supabaseUrl, supabaseKey)

    if (action === 'deactivate') {
      const { investmentId } = body
      if (!investmentId) {
        return res.status(400).json({ error: 'Missing investmentId' })
      }

      const { error } = await supabase
        .from('investments')
        .update({ is_active: false })
        .eq('id', investmentId)
        .eq('user_id', userId)

      if (error) return res.status(500).json({ error: error.message })
      return res.status(200).json({ success: true })
    }

    if (action === 'create') {
      const {
        fundCode,
        fundName,
        currentValueCents,
        currentProfitRate,
        targetAmountCents,
        stopProfitLine,
        tradingCycle,
        strategyTag,
        notes,
      } = body

      if (!fundName || typeof fundName !== 'string' || !fundName.trim()) {
        return res.status(400).json({ error: 'Missing fundName' })
      }
      if (typeof currentValueCents !== 'number' || !Number.isFinite(currentValueCents)) {
        return res.status(400).json({ error: 'Invalid currentValueCents' })
      }
      if (typeof currentProfitRate !== 'number' || !Number.isFinite(currentProfitRate)) {
        return res.status(400).json({ error: 'Invalid currentProfitRate' })
      }
      if (typeof targetAmountCents !== 'number' || !Number.isFinite(targetAmountCents)) {
        return res.status(400).json({ error: 'Invalid targetAmountCents' })
      }

      const insert: Record<string, any> = {
        user_id: userId,
        fund_code: fundCode || null,
        fund_name: fundName.trim(),
        current_value_cents: currentValueCents,
        current_profit_rate: currentProfitRate,
        target_amount_cents: targetAmountCents,
        stop_profit_line: stopProfitLine ?? null,
        trading_cycle: tradingCycle || 'monthly',
        strategy_tag: strategyTag || null,
        notes: notes || null,
      }

      const { data: created, error } = await supabase
        .from('investments')
        .insert(insert)
        .select('*')
        .single()

      if (error) {
        if (error.message?.includes('duplicate') || error.code === '23505') {
          return res.status(409).json({ error: '该基金名称已存在' })
        }
        return res.status(500).json({ error: error.message })
      }

      return res.status(200).json({ success: true, investment: created })
    }

    if (action === 'update') {
      const {
        investmentId,
        fundCode,
        fundName,
        currentValueCents,
        currentProfitRate,
        targetAmountCents,
        stopProfitLine,
        tradingCycle,
        strategyTag,
        notes,
        isActive,
      } = body

      if (!investmentId) {
        return res.status(400).json({ error: 'Missing investmentId' })
      }

      const patch: Record<string, any> = {}
      if (fundCode !== undefined) patch.fund_code = fundCode || null
      if (fundName !== undefined) patch.fund_name = fundName.trim()
      if (currentValueCents !== undefined) patch.current_value_cents = currentValueCents
      if (currentProfitRate !== undefined) patch.current_profit_rate = currentProfitRate
      if (targetAmountCents !== undefined) patch.target_amount_cents = targetAmountCents
      if (stopProfitLine !== undefined) patch.stop_profit_line = stopProfitLine ?? null
      if (tradingCycle !== undefined) patch.trading_cycle = tradingCycle
      if (strategyTag !== undefined) patch.strategy_tag = strategyTag || null
      if (notes !== undefined) patch.notes = notes || null
      if (isActive !== undefined) patch.is_active = isActive

      if (Object.keys(patch).length === 0) {
        return res.status(400).json({ error: 'No fields to update' })
      }

      const { data: updated, error } = await supabase
        .from('investments')
        .update(patch)
        .eq('id', investmentId)
        .eq('user_id', userId)
        .select('*')
        .single()

      if (error) return res.status(500).json({ error: error.message })
      return res.status(200).json({ success: true, investment: updated })
    }
  } catch (e: any) {
    console.error('[investment-manage]', e)
    return res.status(500).json({ error: `Server error: ${e?.message || 'unknown'}` })
  }
}
