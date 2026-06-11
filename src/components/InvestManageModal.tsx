import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../supabaseClient'
import type { InvestmentData } from './InvestmentCard'

type Props = {
  open: boolean
  onClose: () => void
  userId: string
  onChanged: () => void
}

type FormData = {
  fund_code: string
  fund_name: string
  current_value_cents: string
  current_profit_rate: string
  target_amount_cents: string
  stop_profit_line: string
  trading_cycle: 'weekly' | 'monthly' | 'none'
  strategy_tag: string
  notes: string
}

const emptyForm: FormData = {
  fund_code: '',
  fund_name: '',
  current_value_cents: '',
  current_profit_rate: '',
  target_amount_cents: '',
  stop_profit_line: '',
  trading_cycle: 'monthly',
  strategy_tag: '',
  notes: '',
}

export default function InvestManageModal({ open, onClose, userId, onChanged }: Props) {
  const [funds, setFunds] = useState<InvestmentData[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<'list' | 'create' | 'edit'>('list')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<FormData>(emptyForm)
  const [saving, setSaving] = useState(false)

  const fetchFunds = useCallback(async () => {
    if (!supabase) return
    setLoading(true)
    const { data, error: err } = await supabase
      .from('investments')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: true })

    setLoading(false)
    if (err) {
      setError(err.message)
      return
    }
    setFunds((data || []) as InvestmentData[])
  }, [userId])

  useEffect(() => {
    if (open) {
      fetchFunds()
      setView('list')
      setError(null)
    }
  }, [open, fetchFunds])

  const handleCreate = async () => {
    const c = parseFloat(form.current_value_cents)
    const r = parseFloat(form.current_profit_rate)
    const m = parseFloat(form.target_amount_cents)

    if (!form.fund_name.trim()) { setError('请输入基金名称'); return }
    if (isNaN(c) || c < 0) { setError('请输入有效当前市值'); return }
    if (isNaN(r)) { setError('请输入有效收益率'); return }
    if (isNaN(m) || m < 0) { setError('请输入有效目标上限 M'); return }

    setSaving(true)
    setError(null)

    try {
      const res = await fetch('/api/investment-manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          action: 'create',
          fundCode: form.fund_code || null,
          fundName: form.fund_name.trim(),
          currentValueCents: Math.round(c * 100),
          currentProfitRate: r / 100,
          targetAmountCents: Math.round(m * 100),
          stopProfitLine: form.stop_profit_line ? parseFloat(form.stop_profit_line) / 100 : null,
          tradingCycle: form.trading_cycle,
          strategyTag: form.strategy_tag || null,
          notes: form.notes || null,
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '创建失败')

      setForm(emptyForm)
      setView('list')
      onChanged()
      await fetchFunds()
    } catch (e: any) {
      setError(e.message || '创建失败')
    } finally {
      setSaving(false)
    }
  }

  const handleUpdate = async () => {
    const c = parseFloat(form.current_value_cents)
    const r = parseFloat(form.current_profit_rate)
    const m = parseFloat(form.target_amount_cents)

    if (!form.fund_name.trim()) { setError('请输入基金名称'); return }
    if (isNaN(c) || c < 0) { setError('请输入有效当前市值'); return }
    if (isNaN(r)) { setError('请输入有效收益率'); return }
    if (isNaN(m) || m < 0) { setError('请输入有效目标上限 M'); return }

    setSaving(true)
    setError(null)

    try {
      const res = await fetch('/api/investment-manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          action: 'update',
          investmentId: editingId,
          fundCode: form.fund_code || null,
          fundName: form.fund_name.trim(),
          currentValueCents: Math.round(c * 100),
          currentProfitRate: r / 100,
          targetAmountCents: Math.round(m * 100),
          stopProfitLine: form.stop_profit_line ? parseFloat(form.stop_profit_line) / 100 : null,
          tradingCycle: form.trading_cycle,
          strategyTag: form.strategy_tag || null,
          notes: form.notes || null,
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '更新失败')

      setView('list')
      setEditingId(null)
      onChanged()
      await fetchFunds()
    } catch (e: any) {
      setError(e.message || '更新失败')
    } finally {
      setSaving(false)
    }
  }

  const handleDeactivate = async (id: string) => {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/investment-manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, action: 'deactivate', investmentId: id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '停用失败')
      onChanged()
      await fetchFunds()
    } catch (e: any) {
      setError(e.message || '停用失败')
    } finally {
      setSaving(false)
    }
  }

  const handleReactivate = async (id: string) => {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/investment-manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, action: 'update', investmentId: id, isActive: true }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '启用失败')
      onChanged()
      await fetchFunds()
    } catch (e: any) {
      setError(e.message || '启用失败')
    } finally {
      setSaving(false)
    }
  }

  const openEdit = (fund: InvestmentData) => {
    setEditingId(fund.id)
    setForm({
      fund_code: fund.fund_code || '',
      fund_name: fund.fund_name,
      current_value_cents: (fund.current_value_cents / 100).toFixed(2),
      current_profit_rate: (fund.current_profit_rate * 100).toFixed(2),
      target_amount_cents: (fund.target_amount_cents / 100).toFixed(2),
      stop_profit_line: fund.stop_profit_line != null ? (fund.stop_profit_line * 100).toFixed(0) : '',
      trading_cycle: fund.trading_cycle,
      strategy_tag: fund.strategy_tag || '',
      notes: '',
    })
    setView('edit')
    setError(null)
  }

  if (!open) return null

  const formFields = (
    <>
      <div className="space-y-3">
        <div>
          <label className="text-[11px] text-base-muted">基金名称 *</label>
          <input
            value={form.fund_name}
            onChange={(e) => setForm((f) => ({ ...f, fund_name: e.target.value }))}
            className="mt-0.5 w-full rounded-lg border border-base-line bg-base-bg px-2.5 py-1.5 text-sm text-base-text focus:outline-none"
            placeholder="如：景顺长城宁景混合A"
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[11px] text-base-muted">当前市值 C（元）*</label>
            <input
              value={form.current_value_cents}
              onChange={(e) => setForm((f) => ({ ...f, current_value_cents: e.target.value }))}
              className="mt-0.5 w-full rounded-lg border border-base-line bg-base-bg px-2.5 py-1.5 text-sm text-base-text focus:outline-none"
              inputMode="decimal"
              placeholder="如：9325"
            />
          </div>
          <div>
            <label className="text-[11px] text-base-muted">收益率 R（%）*</label>
            <input
              value={form.current_profit_rate}
              onChange={(e) => setForm((f) => ({ ...f, current_profit_rate: e.target.value }))}
              className="mt-0.5 w-full rounded-lg border border-base-line bg-base-bg px-2.5 py-1.5 text-sm text-base-text focus:outline-none"
              inputMode="decimal"
              placeholder="如：4.31（正）/ -11.35（负）"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[11px] text-base-muted">目标上限 M（元）*</label>
            <input
              value={form.target_amount_cents}
              onChange={(e) => setForm((f) => ({ ...f, target_amount_cents: e.target.value }))}
              className="mt-0.5 w-full rounded-lg border border-base-line bg-base-bg px-2.5 py-1.5 text-sm text-base-text focus:outline-none"
              inputMode="decimal"
              placeholder="如：12000"
            />
          </div>
          <div>
            <label className="text-[11px] text-base-muted">止盈线（%）</label>
            <input
              value={form.stop_profit_line}
              onChange={(e) => setForm((f) => ({ ...f, stop_profit_line: e.target.value }))}
              className="mt-0.5 w-full rounded-lg border border-base-line bg-base-bg px-2.5 py-1.5 text-sm text-base-text focus:outline-none"
              inputMode="decimal"
              placeholder="如：15（留空=无）"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[11px] text-base-muted">调仓周期</label>
            <select
              value={form.trading_cycle}
              onChange={(e) => setForm((f) => ({ ...f, trading_cycle: e.target.value as any }))}
              className="mt-0.5 w-full rounded-lg border border-base-line bg-base-bg px-2.5 py-1.5 text-sm text-base-text focus:outline-none"
            >
              <option value="weekly">周</option>
              <option value="monthly">月</option>
              <option value="none">无</option>
            </select>
          </div>
          <div>
            <label className="text-[11px] text-base-muted">策略标签</label>
            <input
              value={form.strategy_tag}
              onChange={(e) => setForm((f) => ({ ...f, strategy_tag: e.target.value }))}
              className="mt-0.5 w-full rounded-lg border border-base-line bg-base-bg px-2.5 py-1.5 text-sm text-base-text focus:outline-none"
              placeholder="如：核心权益"
            />
          </div>
        </div>

        <div>
          <label className="text-[11px] text-base-muted">基金代码（可选）</label>
          <input
            value={form.fund_code}
            onChange={(e) => setForm((f) => ({ ...f, fund_code: e.target.value }))}
            className="mt-0.5 w-full rounded-lg border border-base-line bg-base-bg px-2.5 py-1.5 text-sm text-base-text focus:outline-none"
            inputMode="numeric"
            placeholder="6 位数字"
          />
        </div>
      </div>
    </>
  )

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/15 px-4 pb-6 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[480px] max-h-[85dvh] overflow-y-auto rounded-2xl border border-base-line bg-base-surface p-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-medium text-base-text">
            {view === 'list' ? '管理持仓' : view === 'create' ? '新增基金' : '编辑基金'}
          </h2>
          <button
            onClick={() => {
              if (view !== 'list') {
                setView('list')
                setError(null)
              } else {
                onClose()
              }
            }}
            className="text-xs text-base-muted active:opacity-70"
          >
            {view === 'list' ? '关闭' : '返回'}
          </button>
        </div>

        {error && (
          <div className="mb-3 text-[11px] text-[#E76F51]">{error}</div>
        )}

        {/* 列表视图 */}
        {view === 'list' && (
          <>
            <button
              onClick={() => { setForm(emptyForm); setView('create'); setError(null) }}
              className="mb-3 w-full rounded-xl border border-dashed border-base-line bg-base-bg py-2 text-xs text-base-muted active:opacity-70"
            >
              + 新增基金
            </button>

            {loading ? (
              <div className="text-xs text-base-muted text-center py-4">加载中…</div>
            ) : funds.length === 0 ? (
              <div className="text-xs text-base-muted text-center py-4">暂无基金</div>
            ) : (
              <div className="space-y-2">
                {funds.map((f) => (
                  <div
                    key={f.id}
                    className={`rounded-xl border bg-base-bg p-3 ${f.is_active ? 'border-base-line' : 'border-base-line opacity-50'}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-medium text-base-text truncate">{f.fund_name}</div>
                        <div className="mt-0.5 flex items-center gap-2 text-[10px] text-base-muted">
                          <span>C: ¥{(f.current_value_cents / 100).toFixed(2)}</span>
                          <span>M: ¥{(f.target_amount_cents / 100).toFixed(2)}</span>
                          {f.strategy_tag && <span>· {f.strategy_tag}</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => openEdit(f)}
                          className="rounded-lg border border-base-line bg-base-bg px-2 py-1 text-[10px] text-base-muted active:opacity-70"
                        >
                          编辑
                        </button>
                        {f.is_active ? (
                          <button
                            onClick={() => handleDeactivate(f.id)}
                            disabled={saving}
                            className="rounded-lg border border-base-line bg-base-bg px-2 py-1 text-[10px] text-base-muted active:opacity-70"
                          >
                            停用
                          </button>
                        ) : (
                          <button
                            onClick={() => handleReactivate(f.id)}
                            disabled={saving}
                            className="rounded-lg border border-[#A3D9A5] bg-base-bg px-2 py-1 text-[10px] text-[#A3D9A5] active:opacity-70"
                          >
                            启用
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* 创建 / 编辑表单 */}
        {(view === 'create' || view === 'edit') && (
          <>
            {formFields}
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => { setView('list'); setError(null) }}
                className="flex-1 rounded-xl border border-base-line bg-base-bg py-2 text-xs text-base-muted active:opacity-70"
              >
                取消
              </button>
              <button
                onClick={view === 'create' ? handleCreate : handleUpdate}
                disabled={saving}
                className="flex-1 rounded-xl border border-base-line bg-base-bg py-2 text-xs text-base-text active:opacity-70 disabled:opacity-40"
              >
                {saving ? '保存中…' : view === 'create' ? '添加' : '保存修改'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
