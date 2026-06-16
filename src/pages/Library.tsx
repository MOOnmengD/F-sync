import { Menu, Plus, X, Pencil, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { useUi } from '../store/ui'
import { IconButton } from '../shared/ui/IconButton'
import { PillButton } from '../shared/ui/PillButton'
import type { MediaItem, MediaType, MediaStatus } from '../types/domain'

const MEDIA_TYPE_LABEL: Record<MediaType, string> = { book: '书籍', movie: '影片' }
const MEDIA_TYPE_ICON: Record<MediaType, string> = { book: '📖', movie: '🎬' }
const STATUS_LABEL: Record<MediaStatus, string> = {
  want_to_consume: '想看',
  consuming: '正在看',
  consumed: '看过',
}
const STATUS_ORDER: Record<MediaStatus, number> = {
  consuming: 0,
  want_to_consume: 1,
  consumed: 2,
}

function statusAccent(s: MediaStatus): 'lavender' | 'butter' | 'mint' {
  if (s === 'want_to_consume') return 'lavender'
  if (s === 'consuming') return 'butter'
  return 'mint'
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

type RawRow = {
  id: string
  user_id: string
  title: string
  media_type: string
  status: string
  review: string | null
  created_at: string
  updated_at: string
}

function toMediaItem(r: RawRow): MediaItem {
  return {
    id: r.id,
    userId: r.user_id,
    title: r.title,
    mediaType: r.media_type as MediaType,
    status: r.status as MediaStatus,
    review: r.review,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

type FormDraft = {
  title: string
  mediaType: MediaType
  status: MediaStatus
  review: string
}

const EMPTY_DRAFT: FormDraft = {
  title: '',
  mediaType: 'book',
  status: 'want_to_consume',
  review: '',
}

export default function Library() {
  const toggleDrawer = useUi((s) => s.toggleDrawer)

  const [typeFilter, setTypeFilter] = useState<'all' | MediaType>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | MediaStatus>('all')
  const [items, setItems] = useState<MediaItem[]>([])
  const [loading, setLoading] = useState(false)
  const [errorText, setErrorText] = useState<string | null>(null)

  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null) // null = add new
  const [draft, setDraft] = useState<FormDraft>(EMPTY_DRAFT)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)

  const fetchItems = async () => {
    const client = supabase
    if (!client) return

    setLoading(true)
    setErrorText(null)

    let query = client
      .from('media_items')
      .select('*')
      .order('created_at', { ascending: false })

    if (typeFilter !== 'all') query = query.eq('media_type', typeFilter)
    if (statusFilter !== 'all') query = query.eq('status', statusFilter)

    const { data, error } = await query

    if (error) {
      setErrorText('加载失败，请重试')
      setLoading(false)
      return
    }

    setItems((data as RawRow[] | null)?.map(toMediaItem) ?? [])
    setLoading(false)
  }

  useEffect(() => {
    void fetchItems()
  }, [typeFilter, statusFilter])

  const openAdd = () => {
    setEditingId(null)
    setDraft(EMPTY_DRAFT)
    setModalOpen(true)
  }

  const openEdit = (item: MediaItem) => {
    setEditingId(item.id)
    setDraft({
      title: item.title,
      mediaType: item.mediaType,
      status: item.status,
      review: item.review ?? '',
    })
    setModalOpen(true)
  }

  const closeModal = () => {
    setModalOpen(false)
    setEditingId(null)
    setDraft(EMPTY_DRAFT)
  }

  const handleSave = async () => {
    const client = supabase
    if (!client) return
    if (!draft.title.trim()) return

    setSaving(true)

    if (editingId) {
      const { error } = await client
        .from('media_items')
        .update({
          title: draft.title.trim(),
          media_type: draft.mediaType,
          status: draft.status,
          review: draft.review.trim() || null,
        })
        .eq('id', editingId)

      if (error) {
        setErrorText('保存失败，请重试')
        setSaving(false)
        return
      }
    } else {
      const { error } = await client.from('media_items').insert({
        title: draft.title.trim(),
        media_type: draft.mediaType,
        status: draft.status,
        review: draft.review.trim() || null,
      })

      if (error) {
        setErrorText('添加失败，请重试')
        setSaving(false)
        return
      }
    }

    setSaving(false)
    closeModal()
    await fetchItems()
  }

  const handleDelete = async (id: string) => {
    const client = supabase
    if (!client) return

    setDeletingId(id)
    const { error } = await client.from('media_items').delete().eq('id', id)
    setDeletingId(null)
    setDeleteConfirmId(null)

    if (error) {
      setErrorText('删除失败，请重试')
      return
    }
    await fetchItems()
  }

  const sorted = [...items].sort((a, b) => {
    const so = STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
    if (so !== 0) return so
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  })

  return (
    <div className="mx-auto flex min-h-dvh max-w-[480px] flex-col bg-base-bg px-4 pb-8 pt-[calc(env(safe-area-inset-top)+0.75rem)]">
      {/* Header */}
      <div className="relative flex min-h-10 items-center justify-center">
        <div className="absolute left-0 top-1/2 -translate-y-1/2">
          <IconButton label="菜单" onClick={toggleDrawer} icon={<Menu size={18} />} />
        </div>
        <div className="text-sm font-medium text-base-text">书影清单</div>
      </div>

      {/* Type filter */}
      <div className="mt-4 flex items-center gap-2">
        <PillButton
          label="全部"
          active={typeFilter === 'all'}
          onClick={() => setTypeFilter('all')}
          accent="baby"
        />
        <PillButton
          label="📖 书籍"
          active={typeFilter === 'book'}
          onClick={() => setTypeFilter('book')}
          accent="mint"
        />
        <PillButton
          label="🎬 影片"
          active={typeFilter === 'movie'}
          onClick={() => setTypeFilter('movie')}
          accent="peach"
        />
      </div>

      {/* Status filter */}
      <div className="mt-3 flex items-center gap-2">
        <PillButton
          label="全部"
          active={statusFilter === 'all'}
          onClick={() => setStatusFilter('all')}
          accent="baby"
        />
        {(
          [
            ['want_to_consume', '想看'],
            ['consuming', '正在看'],
            ['consumed', '看过'],
          ] as [MediaStatus, string][]
        ).map(([s, label]) => (
          <PillButton
            key={s}
            label={label}
            active={statusFilter === s}
            onClick={() => setStatusFilter(statusFilter === s ? 'all' : s)}
            accent={statusAccent(s)}
          />
        ))}
      </div>

      {/* Content */}
      <div className="mt-5 flex-1">
        {loading && (
          <div className="rounded-2xl border border-base-line bg-base-surface px-4 py-6 text-center text-sm text-base-muted">
            加载中…
          </div>
        )}

        {errorText && !loading && (
          <div className="rounded-2xl border border-base-line bg-base-surface px-4 py-6 text-center text-sm">
            <p className="text-base-muted">{errorText}</p>
            <button
              type="button"
              onClick={() => void fetchItems()}
              className="mt-2 rounded-full bg-pastel-baby px-4 py-1.5 text-xs text-base-text active:opacity-70"
            >
              重试
            </button>
          </div>
        )}

        {!loading && !errorText && sorted.length === 0 && (
          <div className="rounded-2xl border border-base-line bg-base-surface px-4 py-12 text-center">
            <p className="text-sm text-base-muted">
              {typeFilter !== 'all' || statusFilter !== 'all'
                ? '没有符合条件的条目'
                : '还没有记录'}
            </p>
            {typeFilter === 'all' && statusFilter === 'all' && (
              <p className="mt-1 text-xs text-base-muted">点击下方按钮添加第一本书或影片吧</p>
            )}
          </div>
        )}

        {!loading && !errorText && sorted.length > 0 && (
          <div className="flex flex-col gap-3">
            {sorted.map((item) => (
              <div
                key={item.id}
                className="rounded-2xl border border-base-line bg-base-surface p-4"
              >
                {/* Top row: icon + title + status badge */}
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 text-lg leading-none">
                    {MEDIA_TYPE_ICON[item.mediaType]}
                  </span>
                  <div className="min-w-0 flex-1">
                    <span className="text-sm font-medium text-base-text break-words">
                      {item.title}
                    </span>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs ${
                      item.status === 'want_to_consume'
                        ? 'bg-pastel-lavender text-base-muted'
                        : item.status === 'consuming'
                          ? 'bg-pastel-butter text-base-text'
                          : 'bg-pastel-mint text-base-text'
                    }`}
                  >
                    {STATUS_LABEL[item.status]}
                  </span>
                </div>

                {/* Review preview */}
                {item.review && (
                  <p className="mt-2 line-clamp-3 text-xs text-base-muted leading-relaxed ml-7">
                    {item.review}
                  </p>
                )}

                {/* Bottom row: date + actions */}
                <div className="mt-3 flex items-center justify-between ml-7">
                  <span className="text-xs text-base-muted">{formatDate(item.createdAt)}</span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => openEdit(item)}
                      className="rounded-full p-1.5 text-base-muted active:bg-pastel-baby active:text-base-text"
                      aria-label="编辑"
                    >
                      <Pencil size={14} />
                    </button>
                    {deleteConfirmId === item.id ? (
                      <span className="flex items-center gap-1 text-xs">
                        <span className="text-base-muted">确认删除？</span>
                        <button
                          type="button"
                          onClick={() => void handleDelete(item.id)}
                          disabled={deletingId === item.id}
                          className="rounded-full bg-pastel-peach px-2 py-0.5 text-base-text active:opacity-70"
                        >
                          是
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteConfirmId(null)}
                          className="rounded-full bg-base-bg px-2 py-0.5 text-base-muted"
                        >
                          否
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setDeleteConfirmId(item.id)}
                        className="rounded-full p-1.5 text-base-muted active:bg-pastel-peach active:text-base-text"
                        aria-label="删除"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add FAB */}
      <div className="mt-6 flex justify-center">
        <button
          type="button"
          onClick={openAdd}
          className="inline-flex items-center gap-2 rounded-full border border-base-line bg-base-surface px-5 py-2.5 text-sm text-base-text active:opacity-70"
        >
          <Plus size={16} />
          添加条目
        </button>
      </div>

      {/* Add / Edit Modal */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/20 backdrop-blur-sm"
          onClick={closeModal}
        >
          <div
            className="w-full max-w-[480px] rounded-t-2xl border border-base-line bg-[#FDFCFB] p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal header */}
            <div className="relative flex min-h-8 items-center justify-center">
              <div className="absolute left-0 top-1/2 -translate-y-1/2">
                <IconButton label="关闭" onClick={closeModal} icon={<X size={18} />} />
              </div>
              <div className="text-sm font-medium text-base-text">
                {editingId ? '编辑条目' : '添加条目'}
              </div>
            </div>

            {/* Media type toggle */}
            <div className="mt-4">
              <p className="mb-2 text-xs text-base-muted">类型</p>
              <div className="flex items-center gap-2">
                {(['book', 'movie'] as MediaType[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setDraft((d) => ({ ...d, mediaType: t }))}
                    className={`rounded-full px-4 py-2 text-sm border border-base-line ${
                      draft.mediaType === t
                        ? 'bg-pastel-mint text-base-text'
                        : 'bg-base-surface text-base-muted'
                    }`}
                  >
                    {MEDIA_TYPE_ICON[t]} {MEDIA_TYPE_LABEL[t]}
                  </button>
                ))}
              </div>
            </div>

            {/* Title input */}
            <div className="mt-4">
              <p className="mb-2 text-xs text-base-muted">标题</p>
              <input
                type="text"
                value={draft.title}
                onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                placeholder={draft.mediaType === 'book' ? '书名…' : '影片名…'}
                className="w-full rounded-2xl border border-base-line bg-base-surface px-4 py-2.5 text-sm text-base-text placeholder:text-base-muted outline-none"
                autoFocus
              />
            </div>

            {/* Status selector */}
            <div className="mt-4">
              <p className="mb-2 text-xs text-base-muted">状态</p>
              <div className="flex items-center gap-2">
                {(
                  [
                    ['want_to_consume', '想看'],
                    ['consuming', '正在看'],
                    ['consumed', '看过'],
                  ] as [MediaStatus, string][]
                ).map(([s, label]) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setDraft((d) => ({ ...d, status: s }))}
                    className={`rounded-full px-4 py-2 text-sm border border-base-line ${
                      draft.status === s
                        ? 'bg-pastel-' + statusAccent(s) + ' text-base-text'
                        : 'bg-base-surface text-base-muted'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Review textarea */}
            <div className="mt-4">
              <p className="mb-2 text-xs text-base-muted">点评（可选）</p>
              <textarea
                value={draft.review}
                onChange={(e) => setDraft((d) => ({ ...d, review: e.target.value }))}
                placeholder="自由记录感受…"
                rows={3}
                className="w-full resize-none rounded-2xl border border-base-line bg-base-surface px-4 py-2.5 text-sm text-base-text placeholder:text-base-muted outline-none"
              />
            </div>

            {/* Save button */}
            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={closeModal}
                className="rounded-full px-5 py-2 text-sm text-base-muted active:opacity-70"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={!draft.title.trim() || saving}
                className="rounded-full bg-pastel-mint px-5 py-2 text-sm text-base-text disabled:opacity-50 active:opacity-70"
              >
                {saving ? '保存中…' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
