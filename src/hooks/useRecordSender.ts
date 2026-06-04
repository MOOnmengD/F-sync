import { useState, useCallback, useRef } from 'react'
import { supabase } from '../supabaseClient'
import { extractDate } from '../utils/dateUtils'
import { extractAmount, pickItemNameFallback } from '../utils/amountUtils'

function makeClientId() {
  const cryptoAny = crypto as unknown as { randomUUID?: () => string } | undefined
  if (cryptoAny?.randomUUID) return cryptoAny.randomUUID()
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

type OutboxEntry = {
  id: string
  raw: string
  ts: number
}

const OUTBOX_KEY = 'fsync_outbox'

function loadOutbox(): OutboxEntry[] {
  try {
    const raw = localStorage.getItem(OUTBOX_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(Boolean) as OutboxEntry[]
  } catch {
    return []
  }
}

function saveOutbox(next: OutboxEntry[]) {
  try {
    localStorage.setItem(OUTBOX_KEY, JSON.stringify(next))
  } catch {
    /* ignore */
  }
}

function addOutbox(entry: OutboxEntry) {
  const prev = loadOutbox()
  saveOutbox([...prev, entry])
}

function removeOutbox(id: string) {
  const prev = loadOutbox()
  saveOutbox(prev.filter((e) => e?.id !== id))
}

async function parseTransactionByAi(raw: string) {
  const r = await fetch('/api/parse-transaction', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: raw }),
  })
  const data = (await r.json().catch(() => null)) as unknown
  if (!r.ok || !data || typeof data !== 'object') {
    const msg =
      typeof (data as any)?.error === 'string'
        ? (data as any).error
        : 'AI 解析失败（后端未返回有效 JSON）'
    throw new Error(msg)
  }
  return data as {
    amount: number | null
    item_name: string | null
    brand: string | null
    details: string | null
    review: string | null
  }
}

export interface SendFinanceOpts {
  mode: 'finance' | 'review'
  raw: string
  category: string | null
  necessity: 'need' | 'want' | null
  repurchaseIndex: number
}

export interface SendNoteOpts {
  raw: string
  mood: string
}

export function useRecordSender(onToast: (msg: string) => void, onRecordSaved?: () => void) {
  const [sending, setSending] = useState(false)
  const sendingRef = useRef(false)

  const sendTransaction = useCallback(
    async (opts: SendFinanceOpts): Promise<boolean> => {
      const { mode, raw, category, necessity, repurchaseIndex } = opts
      if (!raw.trim()) return false

      if (!supabase) {
        onToast('先配置 Supabase URL/Key')
        return false
      }

      if (sendingRef.current) return false

      const outboxId = makeClientId()
      addOutbox({ id: outboxId, raw, ts: Date.now() })
      onToast('记录中…')

      sendingRef.current = true
      setSending(true)
      try {
        const normalized = raw.replace(/　/g, ' ').trim()
        const dateResult = extractDate(normalized, new Date())
        const amountResult = extractAmount(dateResult.rest)
        const extractedAmount = amountResult.amount
        const aiInput = amountResult.rest.trim()
        if (!aiInput) {
          onToast('请输入内容')
          return false
        }

        const parsed = await parseTransactionByAi(aiInput)
        const parsedReview = typeof parsed.review === 'string' ? parsed.review.trim() : ''
        const reviewText = parsedReview ? parsedReview : null
        const itemName = parsed.item_name?.trim() || pickItemNameFallback(aiInput) || null
        if (!itemName) {
          onToast('AI 未解析出 item_name')
          return false
        }

        const brandText = typeof parsed.brand === 'string' ? parsed.brand.trim() : ''
        const brand = brandText ? brandText : null
        const detailsText = typeof parsed.details === 'string' ? parsed.details.trim() : ''
        const details = detailsText ? detailsText : null

        const aiMetadata: Record<string, unknown> = {
          item_name: itemName,
          brand,
          details,
          review: reviewText,
        }

        const { data: existingItem, error: findError } = await supabase
          .from('items')
          .select('id, brand')
          .eq('item_name', itemName)
          .maybeSingle()

        if (findError) {
          onToast(findError.message || '查询 items 失败')
          return false
        }

        let itemId: string | null = existingItem?.id ? String(existingItem.id) : null

        if (!itemId) {
          const { data: created, error: createError } = await supabase
            .from('items')
            .insert({ item_name: itemName, last_review: reviewText, brand })
            .select('id')
            .single()

          if (createError) {
            onToast(createError.message || '创建 item 失败')
            return false
          }
          itemId = created?.id ? String(created.id) : null
        } else {
          const updatePatch: Record<string, unknown> = {}
          if (brand && (existingItem as any)?.brand !== brand) updatePatch.brand = brand
          if (reviewText) updatePatch.last_review = reviewText

          if (Object.keys(updatePatch).length > 0) {
            const { error: updateError } = await supabase
              .from('items')
              .update(updatePatch)
              .eq('id', itemId)
            if (updateError) {
              onToast(updateError.message || '更新 item 失败')
              return false
            }
          }
        }

        if (!itemId) {
          onToast('item_id 获取失败')
          return false
        }

        const payload: Record<string, unknown> = {
          type: mode === 'finance' ? '记账' : '点评',
          content: raw,
          amount: extractedAmount ?? parsed.amount ?? null,
          item_id: itemId,
          ai_metadata: aiMetadata,
          review: reviewText,
          details,
          item_name_snapshot: itemName,
          brand_snapshot: brand,
        }
        if (mode === 'finance') {
          payload.necessity = necessity === null ? null : necessity === 'need'
          payload.repurchase_index = repurchaseIndex > 0 ? repurchaseIndex : null
          payload.finance_category = category ?? null
        }
        if (dateResult.date) {
          payload.created_at = new Date(
            dateResult.date.year,
            dateResult.date.month - 1,
            dateResult.date.day,
            12,
            0,
            0,
            0,
          ).toISOString()
        }

        const { data: inserted, error } = await supabase
          .from('transactions')
          .insert(payload)
          .select('id')
          .single()
        if (error) {
          onToast(error.message || '写入失败')
          return false
        }

        if (inserted?.id) {
          void fetch('/api/vectorize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ transaction_id: inserted.id }),
          })
        }

        removeOutbox(outboxId)
        onToast('已记录')
        onRecordSaved?.()
        return true
      } catch (e: any) {
        const msg = String(e?.message ?? e) || 'AI 解析失败'
        onToast(`${msg}（已保存在本地草稿）`)
        return false
      } finally {
        sendingRef.current = false
        setSending(false)
      }
    },
    [onToast, onRecordSaved],
  )

  const sendWhisper = useCallback(
    async (opts: SendNoteOpts): Promise<boolean> => {
      const { raw, mood } = opts
      if (!raw.trim()) return false

      if (!supabase) {
        onToast('先配置 Supabase URL/Key')
        return false
      }

      if (sendingRef.current) return false

      const outboxId = makeClientId()
      addOutbox({ id: outboxId, raw, ts: Date.now() })
      onToast('记录中…')

      sendingRef.current = true
      setSending(true)
      try {
        const payload = { type: 'whisper', content: raw, mood }
        const { data: inserted, error } = await supabase
          .from('transactions')
          .insert(payload)
          .select('id')
          .single()
        if (error) {
          onToast(error.message || '写入失败')
          return false
        }

        if (inserted?.id) {
          void fetch('/api/vectorize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ transaction_id: inserted.id }),
          })
        }

        removeOutbox(outboxId)
        onToast('已记录')
        onRecordSaved?.()
        return true
      } catch (e: any) {
        const msg = String(e?.message ?? e) || '发送失败'
        onToast(`${msg}（已保存在本地草稿）`)
        return false
      } finally {
        sendingRef.current = false
        setSending(false)
      }
    },
    [onToast, onRecordSaved],
  )

  const sendSimple = useCallback(() => {
    onToast('已发送')
    onRecordSaved?.()
  }, [onToast, onRecordSaved])

  return { sending, sendTransaction, sendWhisper, sendSimple }
}
