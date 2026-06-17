import { createClient } from '@supabase/supabase-js'
import { resolveChatCompletionsUrl } from './_utils.js'

/**
 * /api/investment
 *
 * 统一的投资管理端点，合并了原有的 investment-action / investment-update-cr / investment-manage / investment-ocr。
 * 通过请求体中的 `type` 字段区分操作类型。
 *
 * type 取值：
 * - "action"     — 执行投资操作（确认/覆盖建议、手动调整）
 * - "update_cr"  — 更新持仓的当前价值 C 和收益率 R
 * - "manage"     — 创建/更新/停用投资（通过 body.action 进一步区分 create/update/deactivate）
 * - "ocr"        — OCR 截图识别基金持仓（支付宝截图 → 结构化基金数据）
 */

function getSupabase() {
  const url = process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('Missing Supabase configuration')
  return createClient(url, key)
}

async function handleAction(body: any, res: any) {
  const { userId, investmentId, suggestionId, actualAmountCents, actionType, cBeforeCents, cAfterCents } = body

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

  const supabase = getSupabase()

  const { data: inv, error: invErr } = await supabase
    .from('investments')
    .select('id, current_value_cents')
    .eq('id', investmentId)
    .eq('user_id', userId)
    .maybeSingle()

  if (invErr || !inv) {
    return res.status(404).json({ error: 'Investment not found' })
  }

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

  const { error: actionErr } = await supabase.from('investment_actions').insert({
    user_id: userId,
    investment_id: investmentId,
    suggestion_id: suggestionId || null,
    action_type: actionType,
    amount_cents: actualAmountCents,
    c_before_cents: cBeforeCents,
    c_after_cents: cAfterCents,
  })

  if (actionErr) return res.status(500).json({ error: actionErr.message })

  const { error: updateErr } = await supabase
    .from('investments')
    .update({ current_value_cents: cAfterCents })
    .eq('id', investmentId)

  if (updateErr) return res.status(500).json({ error: updateErr.message })

  return res.status(200).json({ success: true })
}

async function handleUpdateCr(body: any, res: any) {
  const { userId, investmentId, currentValueCents, currentProfitRate, targetAmountCents, stopProfitLine } = body

  if (!userId || !investmentId) {
    return res.status(400).json({ error: 'Missing userId or investmentId' })
  }

  const supabase = getSupabase()

  const { data: inv, error: invErr } = await supabase
    .from('investments')
    .select('id, current_value_cents, current_profit_rate, target_amount_cents, stop_profit_line')
    .eq('id', investmentId)
    .eq('user_id', userId)
    .maybeSingle()

  if (invErr || !inv) {
    return res.status(404).json({ error: 'Investment not found' })
  }

  const cBefore = Number(inv.current_value_cents)
  const rBefore = Number(inv.current_profit_rate)
  const mBefore = Number(inv.target_amount_cents)
  const sBefore = inv.stop_profit_line != null ? Number(inv.stop_profit_line) : null

  // 构建更新对象，仅包含请求中提供的字段
  const patch: Record<string, any> = {}
  let hasCrUpdate = false
  let hasParamUpdate = false

  if (typeof currentValueCents === 'number' && Number.isFinite(currentValueCents)) {
    patch.current_value_cents = currentValueCents
    hasCrUpdate = true
  }
  if (typeof currentProfitRate === 'number' && Number.isFinite(currentProfitRate)) {
    patch.current_profit_rate = currentProfitRate
    hasCrUpdate = true
  }
  if (typeof targetAmountCents === 'number' && Number.isFinite(targetAmountCents)) {
    patch.target_amount_cents = targetAmountCents
    hasParamUpdate = true
  }
  if (stopProfitLine !== undefined) {
    patch.stop_profit_line = stopProfitLine ?? null
    hasParamUpdate = true
  }

  if (Object.keys(patch).length === 0) {
    return res.status(400).json({ error: 'No valid fields to update' })
  }

  const { error: updateErr } = await supabase
    .from('investments')
    .update(patch)
    .eq('id', investmentId)

  if (updateErr) return res.status(500).json({ error: updateErr.message })

  // 构建 notes
  const notesParts: string[] = []
  if (hasCrUpdate) {
    notesParts.push(`C: ${cBefore}→${currentValueCents ?? cBefore} (¥${(cBefore / 100).toFixed(2)}→¥${((currentValueCents ?? cBefore) / 100).toFixed(2)})`)
    notesParts.push(`R: ${(rBefore * 100).toFixed(2)}%→${((currentProfitRate ?? rBefore) * 100).toFixed(2)}%`)
  }
  if (hasParamUpdate) {
    notesParts.push(`M: ¥${(mBefore / 100).toFixed(2)}→¥${((targetAmountCents ?? mBefore) / 100).toFixed(2)}`)
    notesParts.push(`止盈线: ${sBefore != null ? (sBefore * 100).toFixed(0) + '%' : '无'}→${stopProfitLine !== undefined ? (stopProfitLine != null ? (stopProfitLine * 100).toFixed(0) + '%' : '无') : (sBefore != null ? (sBefore * 100).toFixed(0) + '%' : '无')}`)
  }

  const { error: actionErr } = await supabase.from('investment_actions').insert({
    user_id: userId,
    investment_id: investmentId,
    action_type: hasParamUpdate && !hasCrUpdate ? 'update_params' : 'update_cr',
    amount_cents: null,
    c_before_cents: cBefore,
    c_after_cents: currentValueCents ?? cBefore,
    notes: notesParts.join(', '),
  })

  if (actionErr) {
    console.warn('[investment] update_cr action log failed:', actionErr.message)
  }

  return res.status(200).json({
    success: true,
    cBefore,
    cAfter: currentValueCents ?? cBefore,
    rBefore,
    rAfter: currentProfitRate ?? rBefore,
    mBefore,
    mAfter: targetAmountCents ?? mBefore,
    sBefore,
    sAfter: stopProfitLine !== undefined ? stopProfitLine : sBefore,
  })
}

async function handleManage(body: any, res: any) {
  const { userId, action } = body

  if (!userId) {
    return res.status(400).json({ error: 'Missing userId' })
  }
  if (!['create', 'update', 'deactivate'].includes(action)) {
    return res.status(400).json({ error: 'Invalid action. Must be: create, update, or deactivate' })
  }

  const supabase = getSupabase()

  if (action === 'deactivate') {
    const { investmentId } = body
    if (!investmentId) return res.status(400).json({ error: 'Missing investmentId' })

    const { error } = await supabase
      .from('investments')
      .update({ is_active: false })
      .eq('id', investmentId)
      .eq('user_id', userId)

    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ success: true })
  }

  if (action === 'create') {
    const { fundCode, fundName, currentValueCents, currentProfitRate, targetAmountCents, stopProfitLine, tradingCycle, strategyTag, notes } = body

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

  // action === 'update'
  const { investmentId, fundCode, fundName, currentValueCents, currentProfitRate, targetAmountCents, stopProfitLine, tradingCycle, strategyTag, notes, isActive } = body

  if (!investmentId) return res.status(400).json({ error: 'Missing investmentId' })

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

async function handleOcr(body: any, res: any) {
  const { imageDataUrl } = body || {}

  if (!imageDataUrl || typeof imageDataUrl !== 'string') {
    return res.status(400).json({ error: 'Missing imageDataUrl' })
  }

  if (!imageDataUrl.startsWith('data:image/')) {
    return res.status(400).json({ error: 'imageDataUrl must be a data URL starting with data:image/' })
  }

  // 配置优先级：OCR_AI_* > CHAT_AI_* > AI_*
  const apiUrl = process.env.OCR_AI_API_URL || process.env.CHAT_AI_API_URL || process.env.AI_API_URL
  const apiKey = process.env.OCR_AI_API_KEY || process.env.CHAT_AI_API_KEY || process.env.AI_API_KEY
  const model = process.env.OCR_AI_MODEL || process.env.CHAT_AI_MODEL || process.env.AI_MODEL || 'doubao-vision-pro-32k'

  if (!apiUrl || !apiKey) {
    return res.status(500).json({ error: 'OCR AI not configured (missing API URL/Key)' })
  }

  const endpoint = resolveChatCompletionsUrl(apiUrl)

  const prompt = `你是一个基金持仓截图识别助手。请仔细查看这张支付宝基金持仓页面的截图。

请提取截图中所有可见的基金信息，对每一只基金返回：
- fund_name: 基金完整名称（不要截断）
- holding_cents: 持仓金额，单位为"分"（例如 ¥9,325.00 → 返回 932500）
- profit_rate: 持有收益率，小数形式（例如 +4.31% → 返回 0.0431，-11.35% → 返回 -0.1135）

请严格按照以下 JSON 格式返回，不要包含任何其他文字：
{
  "funds": [
    { "fund_name": "景顺长城宁景混合A", "holding_cents": 932500, "profit_rate": 0.0431 },
    ...
  ]
}

注意：
- 忽略截图中的"累计收益"、"昨日收益"等汇总数据
- 只提取单个基金的持仓金额和持有收益率
- 金额中如有逗号分隔请忽略（如 1,234.56 → 1234.56）
- 如果某个基金的金额或收益率看不清，请将对应字段设为 null，不要编造数值
- 确保 holding_cents 是整数（分），profit_rate 是小数（非百分比）`

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: imageDataUrl } },
          ],
        },
      ],
      max_tokens: 4096,
      temperature: 0.1,
    }),
  })

  if (!response.ok) {
    const errText = await response.text().catch(() => '')
    console.error('[investment:ocr] AI API error:', response.status, errText)
    return res.status(502).json({ error: `AI API error: ${response.status}` })
  }

  const aiResult = await response.json()
  const content = aiResult?.choices?.[0]?.message?.content || ''

  // 尝试解析 AI 返回的 JSON
  let parsed: any = null
  try {
    parsed = JSON.parse(content)
  } catch {
    // 尝试从 markdown 代码块中提取
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
    if (jsonMatch) {
      try {
        parsed = JSON.parse(jsonMatch[1])
      } catch {
        console.error('[investment:ocr] Failed to parse AI response:', content)
        return res.status(500).json({ error: '无法解析 AI 识别结果' })
      }
    } else {
      console.error('[investment:ocr] No JSON found in AI response:', content)
      return res.status(500).json({ error: 'AI 未返回有效识别结果' })
    }
  }

  if (!parsed || !Array.isArray(parsed.funds)) {
    return res.status(500).json({ error: 'AI 返回格式不正确，缺少 funds 数组' })
  }

  // 验证并清理每只基金的数据
  const funds = parsed.funds
    .filter((f: any) => f.fund_name && typeof f.fund_name === 'string')
    .map((f: any) => ({
      fund_name: f.fund_name.trim(),
      holding_cents: typeof f.holding_cents === 'number' && Number.isFinite(f.holding_cents)
        ? Math.round(f.holding_cents)
        : null,
      profit_rate: typeof f.profit_rate === 'number' && Number.isFinite(f.profit_rate)
        ? f.profit_rate
        : null,
    }))

  return res.status(200).json({ funds })
}

export default async function handler(req: any, res: any) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8')

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' })
  }

  try {
    const body = req.body || {}
    const { type } = body

    switch (type) {
      case 'action':
        return await handleAction(body, res)
      case 'update_cr':
        return await handleUpdateCr(body, res)
      case 'manage':
        return await handleManage(body, res)
      case 'ocr':
        return await handleOcr(body, res)
      default:
        return res.status(400).json({ error: `Invalid type: "${type}". Must be one of: action, update_cr, manage, ocr` })
    }
  } catch (e: any) {
    console.error('[investment]', e)
    return res.status(500).json({ error: `Server error: ${e?.message || 'unknown'}` })
  }
}
