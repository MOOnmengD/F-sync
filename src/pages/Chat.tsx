import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, BookOpen, Check, ImagePlus, ListTodo, Loader2, Pencil, Plus, RefreshCw, Send, Settings, Sparkles, X, Save, Eye, EyeOff, ClipboardPaste, Copy, FileText, Trash2 } from 'lucide-react'
import { compressImage, type CompressedImage } from '../utils/image'
import { IconButton } from '../shared/ui/IconButton'
import { useChatStore, type ChatMessage } from '../store/chat'
import { supabase } from '../supabaseClient'
import { useSettingsStore } from '../store/settings'

// 位置缓存，避免频繁调用原生定位（5 分钟窗口）
let locationCache: { latitude: number; longitude: number; accuracy: number; address?: string; timestamp: number } | null = null
const LOCATION_CACHE_MS = 5 * 60 * 1000
const LOCATION_TOTAL_TIMEOUT_MS = 8000

async function getCurrentLocation(): Promise<{ latitude: number; longitude: number; accuracy: number; address?: string } | null> {
  if (locationCache && Date.now() - locationCache.timestamp < LOCATION_CACHE_MS) {
    return { latitude: locationCache.latitude, longitude: locationCache.longitude, accuracy: locationCache.accuracy, address: locationCache.address }
  }

  return new Promise((resolve) => {
    let settled = false
    const done = (result: { latitude: number; longitude: number; accuracy: number; address?: string } | null) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolve(result)
    }

    // 总超时兜底（绝不阻塞消息发送）
    const timer = setTimeout(() => {
      console.warn('[Location] 定位总超时，放弃获取')
      done(null)
    }, LOCATION_TOTAL_TIMEOUT_MS)

    void (async () => {
      // 仅使用 HarmonyOS 原生桥接（navigator.geolocation 在 HarmonyOS WebView 中不响应 timeout）
      const bridge = (window as any).harmonyBridge
      if (bridge && typeof bridge.requestLocation === 'function') {
        try {
          const nativeLoc = await bridge.requestLocation()
          if (nativeLoc && !settled) {
            console.log(`[Location] 原生定位成功: lat=${nativeLoc.latitude}, lng=${nativeLoc.longitude}${nativeLoc.address ? ', addr=' + nativeLoc.address : ''}`)
            locationCache = { ...nativeLoc, timestamp: Date.now() }
            done(nativeLoc)
            return
          }
        } catch (err: any) {
          console.warn('[Location] 原生定位失败:', err?.message || err)
        }
      }
      done(null)
    })()
  })
}

function formatTime(timestamp: number) {
  const d = new Date(timestamp)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

function splitContent(content: string): string[] {
  return content.split(/\n{2,}/).map(s => s.trim()).filter(s => s.length > 0)
}

function WelcomeBubble() {
  return (
    <div className="flex justify-start">
      <div className="max-w-[75%] rounded-2xl border border-base-line bg-[#F0F7FF] px-4 py-3">
        <p className="text-sm text-base-text">
          宝贝，我是弗弗。
        </p>
      </div>
    </div>
  )
}

function ContextViewerModal({ isOpen, onClose, context }: { isOpen: boolean; onClose: () => void; context: any[] }) {
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="bg-[#FDFCFB] w-full max-w-2xl rounded-3xl flex flex-col max-h-[90vh] shadow-2xl overflow-hidden border border-base-line">
        <div className="px-6 py-4 border-b border-base-line flex items-center justify-between bg-[#F7F5F2]">
          <h2 className="text-lg font-bold text-base-text">发送给 AI 的全量上下文</h2>
          <button onClick={onClose} className="p-2 hover:bg-base-line rounded-full transition-colors">
            <X size={20} className="text-base-text/50" />
          </button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-6 space-y-4 font-mono text-xs">
          {context.length > 0 ? (
            context.map((msg, idx) => (
              <div key={idx} className="p-3 bg-[#F7F5F2] border border-base-line rounded-xl space-y-1">
                <div className="flex justify-between items-center border-b border-base-line/50 pb-1 mb-2">
                  <span className={`font-bold ${
                    msg.role === 'system' ? 'text-red-500' : 
                    msg.role === 'user' ? 'text-blue-500' : 'text-green-500'
                  }`}>
                    {msg.role.toUpperCase()}
                  </span>
                  {msg.createdAt && (
                    <span className="text-base-text/40">
                      {new Date(msg.createdAt).toLocaleString()}
                    </span>
                  )}
                </div>
                <div className="whitespace-pre-wrap break-words text-base-text/80">
                  {formatContextContent(msg.content)}
                </div>
              </div>
            ))
          ) : (
            <div className="text-center py-10 text-base-text/30 italic">
              暂无发送记录
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function SettingsModal({ isOpen, onClose, vectorSyncStatus, onVectorSync, onClearMessages, onOpenContext }: {
  isOpen: boolean
  onClose: () => void
  vectorSyncStatus: 'synced' | 'pending' | 'syncing'
  onVectorSync: () => void
  onClearMessages: () => void
  onOpenContext: () => void
}) {
  const { settings, updateSettings, saveToCloud, isCloudLoaded } = useSettingsStore()
  const [localSettings, setLocalSettings] = useState(settings)
  const [showApiKeys, setShowApiKeys] = useState<Record<number, boolean>>({})
  const [savedSections, setSavedSections] = useState<Record<string, boolean>>({})

  // 打开设置面板时，用当前 Zustand 中的 settings 重置本地编辑副本
  useEffect(() => {
    if (isOpen) {
      setLocalSettings(settings)
    }
    // isOpen 变化时同步；不依赖 settings 以免覆盖用户正在编辑的内容
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  if (!isOpen) return null

  const markSaved = (section: string) => {
    setSavedSections((prev) => ({ ...prev, [section]: true }))
    setTimeout(() => {
      setSavedSections((prev) => ({ ...prev, [section]: false }))
    }, 2000)
  }

  const handleSave = (key: keyof typeof settings, value: any) => {
    updateSettings({ [key]: value })
    saveToCloud()
    markSaved(key)
  }

  const updateLocalApi = (index: number, field: string, value: string) => {
    const next = [...localSettings.apiConfigs]
    next[index] = { ...next[index], [field]: value }
    setLocalSettings({ ...localSettings, apiConfigs: next })
  }

  const toggleApiKeyVisibility = (index: number) => {
    setShowApiKeys(prev => ({ ...prev, [index]: !prev[index] }))
  }

  const handlePaste = async (index: number) => {
    try {
      const text = await navigator.clipboard.readText()
      updateLocalApi(index, 'key', text)
    } catch (err) {
      console.error('Paste failed:', err)
      const text = prompt('请输入 API Key:')
      if (text) updateLocalApi(index, 'key', text)
    }
  }

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="bg-[#FDFCFB] w-full max-w-lg rounded-3xl flex flex-col max-h-[90vh] shadow-2xl overflow-hidden border border-base-line">
        <div className="px-6 py-4 border-b border-base-line flex items-center justify-between bg-[#F7F5F2]">
          <h2 className="text-lg font-bold text-base-text">AI 助手设置</h2>
          <button onClick={onClose} className="p-2 hover:bg-base-line rounded-full transition-colors">
            <X size={20} className="text-base-text/50" />
          </button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-6 space-y-8 pb-12">
          {/* 云端未加载提示 */}
          {!isCloudLoaded && (
            <div className="p-3 bg-[#FFF8E1] border border-[#FFE082] rounded-xl text-xs text-[#8D6E00] flex items-center gap-2">
              <Loader2 size={14} className="animate-spin shrink-0" />
              正在从云端加载设置，请稍候再保存…
            </div>
          )}
          {/* System Prompt Section */}
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-base-text/70 uppercase tracking-wider">Prompt 设定</h3>
            </div>

            <div className="space-y-6">
              {[
                { label: 'AI 角色设定', key: 'systemPrompt' as const, desc: '定义 AI 的性格和背景' },
                { label: '用户基本情况', key: 'userPrompt' as const, desc: '告诉 AI 关于你的信息' },
                { label: '定时触发逻辑', key: 'proactivePrompt' as const, desc: '主动发送消息时的额外指令' }
              ].map((item) => (
                <div key={item.key} className="space-y-2 group">
                  <div className="flex justify-between items-center">
                    <label className="text-sm font-medium text-base-text/80">{item.label}</label>
                    <button
                      onClick={() => handleSave(item.key, localSettings[item.key])}
                      disabled={!isCloudLoaded}
                      className="flex items-center gap-1 text-xs font-bold transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                      style={{ color: !isCloudLoaded ? undefined : savedSections[item.key] ? '#86C8A8' : '#B4AEE8' }}
                    >
                      {savedSections[item.key] ? <Check size={14} /> : <Save size={14} />}
                      {savedSections[item.key] ? '已保存' : '保存'}
                    </button>
                  </div>
                  <textarea
                    className="w-full h-24 p-3 text-sm bg-[#F7F5F2] border border-base-line rounded-xl focus:ring-2 focus:ring-[#B4AEE8]/20 focus:border-[#B4AEE8] transition-all resize-none outline-none"
                    placeholder={item.desc}
                    value={localSettings[item.key]}
                    onChange={(e) => setLocalSettings({ ...localSettings, [item.key]: e.target.value })}
                  />
                </div>
              ))}
            </div>
          </section>

          {/* API Config Section */}
          <section className="space-y-4">
            <h3 className="text-sm font-bold text-base-text/70 uppercase tracking-wider">API 配置 (自动重试)</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {[0, 1].map((idx) => (
                <div key={idx} className="p-4 bg-[#F7F5F2] border border-base-line rounded-2xl space-y-4 relative group">
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-bold text-[#B4AEE8]">配置 {idx + 1}</span>
                    <button
                      onClick={() => handleSave('apiConfigs', localSettings.apiConfigs)}
                      disabled={!isCloudLoaded}
                      className="flex items-center gap-1 text-xs font-bold transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                      style={{ color: !isCloudLoaded ? undefined : savedSections['apiConfigs'] ? '#86C8A8' : '#B4AEE8' }}
                    >
                      {savedSections['apiConfigs'] ? <Check size={14} /> : <Save size={14} />}
                      {savedSections['apiConfigs'] ? '已保存' : '保存'}
                    </button>
                  </div>
                  <div className="space-y-3">
                    <input
                      className="w-full p-2 text-xs bg-[#FDFCFB] border border-base-line rounded-lg outline-none focus:border-[#B4AEE8]"
                      placeholder="API URL (e.g. https://api.openai.com/v1)"
                      value={localSettings.apiConfigs[idx].url}
                      onChange={(e) => updateLocalApi(idx, 'url', e.target.value)}
                      inputMode="url"
                      autoComplete="off"
                    />
                    <div className="relative group/key">
                      <input
                        className="w-full p-2 pr-20 text-xs bg-[#FDFCFB] border border-base-line rounded-lg outline-none focus:border-[#B4AEE8]"
                        type="text"
                        placeholder="API Key (可直接粘贴)"
                        value={localSettings.apiConfigs[idx].key}
                        onChange={(e) => updateLocalApi(idx, 'key', e.target.value)}
                        inputMode="text"
                        autoComplete="off"
                      />
                      <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
                        <button
                          type="button"
                          className="p-1.5 text-base-text/40 hover:text-[#B4AEE8] transition-colors"
                          onClick={() => toggleApiKeyVisibility(idx)}
                          title={showApiKeys[idx] ? "隐藏" : "显示"}
                        >
                          {showApiKeys[idx] ? <EyeOff size={14} /> : <Eye size={14} />}
                        </button>
                        <button
                          type="button"
                          className="p-1.5 text-base-text/40 hover:text-[#B4AEE8] transition-colors"
                          onClick={() => handlePaste(idx)}
                          title="粘贴"
                        >
                          <ClipboardPaste size={14} />
                        </button>
                        <button
                          type="button"
                          className="p-1.5 text-base-text/40 hover:text-[#B4AEE8] transition-colors"
                          onClick={() => handleCopy(localSettings.apiConfigs[idx].key)}
                          title="复制"
                        >
                          <Copy size={14} />
                        </button>
                      </div>
                    </div>
                    <input
                      className="w-full p-2 text-xs bg-[#FDFCFB] border border-base-line rounded-lg outline-none focus:border-[#B4AEE8]"
                      placeholder="Model Name (e.g. gpt-4o)"
                      value={localSettings.apiConfigs[idx].model}
                      onChange={(e) => updateLocalApi(idx, 'model', e.target.value)}
                      autoComplete="off"
                    />
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* 工具 */}
          <section className="space-y-3">
            <h3 className="text-sm font-bold text-base-text/70 uppercase tracking-wider">工具</h3>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={onVectorSync}
                disabled={vectorSyncStatus === 'syncing'}
                className={`h-9 px-4 text-xs border border-base-line rounded-full bg-[#FDFCFB] flex items-center gap-2 transition-colors ${
                  vectorSyncStatus === 'pending' ? 'text-[#B4AEE8] active:opacity-70' : 'text-base-text/30 cursor-default'
                }`}
              >
                {vectorSyncStatus === 'syncing' ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : vectorSyncStatus === 'synced' ? (
                  <Check size={13} className="text-green-400" />
                ) : (
                  <RefreshCw size={13} />
                )}
                向量同步
              </button>
              <button
                type="button"
                onClick={() => { onClearMessages(); onClose() }}
                className="h-9 px-4 text-xs text-base-text/50 border border-base-line rounded-full bg-[#FDFCFB] active:opacity-70"
              >
                清空对话
              </button>
              <button
                type="button"
                onClick={() => { onClose(); onOpenContext() }}
                className="h-9 px-4 text-xs text-base-text/50 border border-base-line rounded-full bg-[#FDFCFB] active:opacity-70 flex items-center gap-2"
              >
                <FileText size={13} />
                查看上下文
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

type SocialRelationship = {
  id: string
  user_id: string
  name: string
  relation: string | null
  impression: string | null
  history: { date: string; note: string }[]
  created_at: string
  updated_at: string
}

function RelationshipTag({ rel, onUpdate, onDelete }: {
  rel: SocialRelationship
  onUpdate: (id: string, updates: Partial<Pick<SocialRelationship, 'relation' | 'impression'>>) => void
  onDelete: (id: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [localRelation, setLocalRelation] = useState(rel.relation || '')
  const [localImpression, setLocalImpression] = useState(rel.impression || '')

  if (editing) {
    return (
      <div className="flex flex-col gap-2 p-3 bg-[#F7F5F2] border border-base-line rounded-xl">
        <span className="text-sm font-medium text-base-text">{rel.name}</span>
        <input
          className="w-full p-1.5 text-sm bg-white border border-base-line rounded-lg text-base-text"
          value={localRelation}
          onChange={e => setLocalRelation(e.target.value)}
          placeholder="关系（同事/朋友/家人/宠物...）"
        />
        <input
          className="w-full p-1.5 text-sm bg-white border border-base-line rounded-lg text-base-text"
          value={localImpression}
          onChange={e => setLocalImpression(e.target.value)}
          placeholder="综合印象"
        />
        <div className="flex items-center gap-2 justify-end">
          <button
            onClick={() => {
              onUpdate(rel.id, { relation: localRelation || null, impression: localImpression || null })
              setEditing(false)
            }}
            className="p-1.5 rounded-lg text-green-600 hover:bg-green-50 transition-colors"
          >
            <Check size={16} />
          </button>
          <button
            onClick={() => { setLocalRelation(rel.relation || ''); setLocalImpression(rel.impression || ''); setEditing(false) }}
            className="p-1.5 rounded-lg text-base-text/40 hover:bg-base-line transition-colors"
          >
            <X size={16} />
          </button>
        </div>
      </div>
    )
  }

  return (
    <span className="inline-flex items-center gap-1 px-3 py-1.5 text-sm bg-[#F7F5F2] border border-base-line rounded-full text-base-text/80 group cursor-default">
      <span className="font-medium">{rel.name}</span>
      {rel.relation && <span className="text-base-text/40">({rel.relation})</span>}
      {rel.impression && <span className="text-base-text/30 hidden sm:inline truncate max-w-[120px]" title={rel.impression}>— {rel.impression}</span>}
      <button
        onClick={() => { setLocalRelation(rel.relation || ''); setLocalImpression(rel.impression || ''); setEditing(true) }}
        className="ml-0.5 p-0.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity text-base-text/30 hover:text-base-text/60"
      >
        <Pencil size={12} />
      </button>
      <button
        onClick={() => onDelete(rel.id)}
        className="p-0.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity text-base-text/30 hover:text-red-400"
      >
        <X size={12} />
      </button>
    </span>
  )
}

function SocialRelationshipsSection({ relationships, onUpdate, onDelete, onAdd }: {
  relationships: SocialRelationship[]
  onUpdate: (id: string, updates: Partial<Pick<SocialRelationship, 'relation' | 'impression'>>) => void
  onDelete: (id: string) => void
  onAdd: (name: string, relation: string, impression: string) => void
}) {
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newRelation, setNewRelation] = useState('')
  const [newImpression, setNewImpression] = useState('')

  const handleAdd = () => {
    if (!newName.trim()) return
    onAdd(newName.trim(), newRelation.trim() || '', newImpression.trim() || '')
    setNewName(''); setNewRelation(''); setNewImpression(''); setAdding(false)
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold text-base-text/40 uppercase tracking-wider">社交关系</h3>
        <button
          onClick={() => setAdding(!adding)}
          className="p-0.5 rounded-full text-base-text/30 hover:text-base-text/60 transition-colors"
        >
          <Plus size={16} />
        </button>
      </div>

      {adding && (
        <div className="flex flex-col gap-2 p-3 bg-[#F7F5F2] border border-base-line rounded-xl">
          <input
            className="w-full p-1.5 text-sm bg-white border border-base-line rounded-lg text-base-text"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="名称（张三 / 咪咪）"
            autoFocus
          />
          <input
            className="w-full p-1.5 text-sm bg-white border border-base-line rounded-lg text-base-text"
            value={newRelation}
            onChange={e => setNewRelation(e.target.value)}
            placeholder="关系（同事/朋友/家人/宠物...）"
          />
          <input
            className="w-full p-1.5 text-sm bg-white border border-base-line rounded-lg text-base-text"
            value={newImpression}
            onChange={e => setNewImpression(e.target.value)}
            placeholder="综合印象"
          />
          <div className="flex items-center gap-2 justify-end">
            <button onClick={handleAdd} className="p-1.5 rounded-lg text-green-600 hover:bg-green-50 transition-colors">
              <Check size={16} />
            </button>
            <button onClick={() => setAdding(false)} className="p-1.5 rounded-lg text-base-text/40 hover:bg-base-line transition-colors">
              <X size={16} />
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {relationships.length === 0 && !adding && (
          <p className="text-xs text-base-text/30">暂无社交关系数据</p>
        )}
        {relationships.map(rel => (
          <RelationshipTag key={rel.id} rel={rel} onUpdate={onUpdate} onDelete={onDelete} />
        ))}
      </div>
    </div>
  )
}

function ProfileContent({ socialRelationships, onSocialUpdate, onSocialDelete, onSocialAdd }: {
  socialRelationships: SocialRelationship[]
  onSocialUpdate: (id: string, updates: Partial<Pick<SocialRelationship, 'relation' | 'impression'>>) => void
  onSocialDelete: (id: string) => void
  onSocialAdd: (name: string, relation: string, impression: string) => void
}) {
  if (socialRelationships.length === 0) {
    return (
      <div className="text-center py-20 space-y-2">
        <p className="text-sm text-base-text/30">暂无画像数据</p>
        <p className="text-xs text-base-text/20">每天 01:00 自动更新</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <SocialRelationshipsSection
        relationships={socialRelationships}
        onUpdate={onSocialUpdate}
        onDelete={onSocialDelete}
        onAdd={onSocialAdd}
      />
    </div>
  )
}

function DiaryContent({ entries }: { entries: any[] }) {
  if (entries.length === 0) {
    return (
      <div className="text-center py-20 space-y-2">
        <p className="text-sm text-base-text/30">暂无日记</p>
        <p className="text-xs text-base-text/20">每天 01:00 生成昨日日记</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {entries.map(entry => {
        // date 是 YYYY-MM-DD 字符串，加 T12:00:00 避免时区导致日期偏移
        const date = new Date(`${entry.date}T12:00:00`)
        const dateStr = date.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' })
        return (
          <div key={entry.id} className="space-y-2">
            <div className="text-xs font-bold text-base-text/40 uppercase tracking-wider">{dateStr}</div>
            <div className="p-4 bg-[#F7F5F2] border border-base-line rounded-2xl">
              <p className="text-sm text-base-text/80 leading-relaxed whitespace-pre-wrap">{entry.content}</p>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function ProfileDiaryModal({ isOpen, onClose, initialTab }: {
  isOpen: boolean
  onClose: () => void
  initialTab: 'profile' | 'diary'
}) {
  const [tab, setTab] = useState<'profile' | 'diary'>(initialTab)
  const [diaryEntries, setDiaryEntries] = useState<any[]>([])
  const [socialRelationships, setSocialRelationships] = useState<SocialRelationship[]>([])
  const [loading, setLoading] = useState(false)

  const loadData = async () => {
    const client = supabase
    if (!client) { setLoading(false); return }

    const [diaryRes, socialRes] = await Promise.all([
      client.from('daily_logs').select('*').order('date', { ascending: false }).limit(60),
      (async () => {
        try { return await client.from('social_relationships').select('*').order('updated_at', { ascending: false }) }
        catch { return { data: [], error: null } }
      })()
    ])

    if (diaryRes.data) setDiaryEntries(diaryRes.data)
    if (socialRes.data) setSocialRelationships(socialRes.data)
    setLoading(false)
  }

  useEffect(() => {
    if (!isOpen) return
    setTab(initialTab)
    setLoading(true)
    loadData()
  }, [isOpen, initialTab])

  const handleSocialUpdate = async (id: string, updates: Partial<Pick<SocialRelationship, 'relation' | 'impression'>>) => {
    const client = supabase
    if (!client) return
    const { error } = await client.from('social_relationships').update(updates).eq('id', id)
    if (!error) {
      setSocialRelationships(prev => prev.map(r => r.id === id ? { ...r, ...updates } : r))
    }
  }

  const handleSocialDelete = async (id: string) => {
    const client = supabase
    if (!client) return
    const { error } = await client.from('social_relationships').delete().eq('id', id)
    if (!error) {
      setSocialRelationships(prev => prev.filter(r => r.id !== id))
    }
  }

  const handleSocialAdd = async (name: string, relation: string, impression: string) => {
    const client = supabase
    if (!client) return
    const { data, error } = await client.from('social_relationships').insert({ name, relation, impression }).select('*').single()
    if (!error && data) {
      setSocialRelationships(prev => [...prev, data])
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="bg-[#FDFCFB] w-full max-w-lg rounded-3xl flex flex-col max-h-[90vh] overflow-hidden border border-base-line">
        <div className="px-6 py-4 border-b border-base-line flex items-center justify-between bg-[#F7F5F2]">
          <div className="flex items-center gap-1 p-1 bg-base-bg rounded-full border border-base-line">
            <button
              onClick={() => setTab('profile')}
              className={`px-4 py-1.5 text-sm rounded-full transition-colors ${
                tab === 'profile' ? 'bg-[#B4AEE8] text-white font-medium' : 'text-base-text/50'
              }`}
            >
              用户画像
            </button>
            <button
              onClick={() => setTab('diary')}
              className={`px-4 py-1.5 text-sm rounded-full transition-colors ${
                tab === 'diary' ? 'bg-[#B4AEE8] text-white font-medium' : 'text-base-text/50'
              }`}
            >
              每日日记
            </button>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-base-line rounded-full transition-colors">
            <X size={20} className="text-base-text/50" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 size={24} className="animate-spin text-base-text/30" />
            </div>
          ) : tab === 'profile' ? (
            <ProfileContent
              socialRelationships={socialRelationships}
              onSocialUpdate={handleSocialUpdate}
              onSocialDelete={handleSocialDelete}
              onSocialAdd={handleSocialAdd}
            />
          ) : (
            <DiaryContent entries={diaryEntries} />
          )}
        </div>
      </div>
    </div>
  )
}

interface EventItem {
  id: string
  type: 'event' | 'todo'
  status: 'pending' | 'done' | null
  content: string
  sort_order: number
}

function DailyEventsModal({ isOpen, onClose }: {
  isOpen: boolean
  onClose: () => void
}) {
  const [items, setItems] = useState<EventItem[]>([])
  const [originalItems, setOriginalItems] = useState<EventItem[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [eventsDate, setEventsDate] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [newText, setNewText] = useState('')
  const [newType, setNewType] = useState<'event' | 'todo'>('event')

  const loadEvents = async () => {
    const client = supabase
    if (!client) { setLoading(false); return }

    // 取最近一天的事件
    const { data: dateRow, error: dateErr } = await client
      .from('daily_event_items')
      .select('date')
      .order('date', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (dateErr || !dateRow) {
      const today = new Date(new Date().getTime() + 8 * 60 * 60 * 1000).toISOString().split('T')[0]
      setEventsDate(today)
      setItems([])
      setOriginalItems([])
      setLoading(false)
      return
    }

    const date = dateRow.date
    setEventsDate(date)

    const { data, error } = await client
      .from('daily_event_items')
      .select('id, type, status, content, sort_order')
      .eq('date', date)
      .order('sort_order', { ascending: true })

    if (!error && data) {
      const loaded = data as EventItem[]
      setItems(loaded)
      setOriginalItems(JSON.parse(JSON.stringify(loaded)))
    } else {
      setItems([])
      setOriginalItems([])
    }
    setLoading(false)
  }

  useEffect(() => {
    if (!isOpen) return
    setEditingId(null)
    setNewText('')
    setLoading(true)
    loadEvents()
  }, [isOpen])

  const startEdit = (item: EventItem) => {
    setEditingId(item.id)
    setEditText(item.content)
  }
  const cancelEdit = () => setEditingId(null)
  const confirmEdit = (id: string) => {
    setItems(prev => prev.map(it => it.id === id ? { ...it, content: editText } : it))
    setEditingId(null)
  }

  const toggleStatus = (id: string) => {
    setItems(prev => prev.map(it => {
      if (it.id !== id || it.type !== 'todo') return it
      return { ...it, status: it.status === 'done' ? 'pending' : 'done' }
    }))
  }

  const deleteItem = (id: string) => {
    setItems(prev => prev.filter(it => it.id !== id))
  }

  const addItem = () => {
    if (!newText.trim()) return
    const maxOrder = items.reduce((max, it) => Math.max(max, it.sort_order), 0)
    const newItem: EventItem = {
      id: `new-${Date.now()}`,
      type: newType,
      status: newType === 'todo' ? 'pending' : null,
      content: newText.trim(),
      sort_order: maxOrder + 1
    }
    setItems(prev => [...prev, newItem])
    setNewText('')
  }

  const handleSave = async () => {
    const client = supabase
    if (!client) return
    setSaving(true)

    // 删掉该日期所有旧数据，再全量插入
    await client
      .from('daily_event_items')
      .delete()
      .eq('date', eventsDate)

    if (items.length > 0) {
      const rows = items.map((it, idx) => ({
        date: eventsDate,
        type: it.type,
        status: it.status,
        content: it.content,
        sort_order: idx
      }))
      await client.from('daily_event_items').insert(rows)
    }

    setOriginalItems(JSON.parse(JSON.stringify(items)))
    setSaving(false)
  }

  const hasChanges = JSON.stringify(items) !== JSON.stringify(originalItems)

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="bg-[#FDFCFB] w-full max-w-lg rounded-3xl flex flex-col max-h-[90vh] overflow-hidden border border-base-line">
        {/* Header */}
        <div className="px-6 py-4 border-b border-base-line flex items-center justify-between bg-[#F7F5F2] shrink-0">
          <div className="flex items-center gap-2">
            <ListTodo size={18} className="text-[#B4AEE8]" />
            <span className="text-sm font-medium text-base-text">每日事件</span>
            <span className="text-xs text-base-muted">{eventsDate}</span>
          </div>
          <div className="flex items-center gap-2">
            {hasChanges && (
              <button onClick={handleSave} disabled={saving}
                className="px-3 py-1.5 text-xs rounded-full bg-[#B4AEE8] text-white disabled:opacity-50 flex items-center gap-1"
              >
                {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                保存
              </button>
            )}
            <button onClick={onClose} className="p-2 hover:bg-base-line rounded-full transition-colors">
              <X size={20} className="text-base-text/50" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-2">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 size={24} className="animate-spin text-base-text/30" />
            </div>
          ) : items.length === 0 ? (
            <div className="text-base-muted text-sm text-center py-12">
              暂无事件，等待 AI 在每日凌晨自动生成
            </div>
          ) : (
            items.map(item => (
              <div key={item.id}
                className={`group flex items-start gap-3 p-3 rounded-xl border transition-colors ${
                  item.type === 'todo' && item.status === 'done'
                    ? 'border-base-line bg-base-surface/50'
                    : 'border-base-line bg-base-surface'
                }`}
              >
                {/* 类型指示器 */}
                <button
                  onClick={() => item.type === 'todo' ? toggleStatus(item.id) : null}
                  className={`shrink-0 mt-0.5 ${
                    item.type === 'todo' && item.status === 'done'
                      ? 'text-green-500'
                      : item.type === 'todo'
                        ? 'text-[#B4AEE8]'
                        : 'text-base-text/25'
                  }`}
                >
                  {item.type === 'todo' && item.status === 'done' ? (
                    <div className="w-5 h-5 rounded-full bg-green-100 flex items-center justify-center">
                      <Check size={12} className="text-green-500" />
                    </div>
                  ) : item.type === 'todo' ? (
                    <div className="w-5 h-5 rounded-full border-2 border-[#B4AEE8]" />
                  ) : (
                    <div className="w-1.5 h-1.5 mt-1.5 rounded-full bg-base-text/30" />
                  )}
                </button>

                {/* 文本 */}
                <div className="flex-1 min-w-0">
                  {editingId === item.id ? (
                    <input
                      type="text"
                      value={editText}
                      onChange={e => setEditText(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') confirmEdit(item.id)
                        if (e.key === 'Escape') cancelEdit()
                      }}
                      onBlur={() => confirmEdit(item.id)}
                      autoFocus
                      className="w-full text-sm rounded-lg border border-[#B4AEE8] bg-white px-2 py-1 outline-none"
                    />
                  ) : (
                    <span className={`text-sm ${
                      item.type === 'todo' && item.status === 'done'
                        ? 'text-base-muted line-through'
                        : 'text-base-text'
                    }`}>
                      {item.content}
                    </span>
                  )}
                </div>

                {/* 操作按钮 */}
                <div className="shrink-0 flex items-center gap-0.5">
                  <button onClick={() => startEdit(item)}
                    className="p-1 rounded hover:bg-base-line/50 text-base-muted"
                  >
                    <Pencil size={12} />
                  </button>
                  <button onClick={() => deleteItem(item.id)}
                    className="p-1 rounded hover:bg-red-50 text-base-muted hover:text-red-400"
                  >
                    <X size={12} />
                  </button>
                </div>
              </div>
            ))
          )}

          {/* 新增输入 */}
          {!loading && (
            <div className="flex items-center gap-1.5 pt-2 border-t border-base-line">
              <select
                value={newType}
                onChange={e => setNewType(e.target.value as 'event' | 'todo')}
                className="text-xs rounded-lg border border-base-line bg-base-surface px-1.5 py-1.5 outline-none text-base-muted shrink-0"
              >
                <option value="event">事件</option>
                <option value="todo">约定</option>
              </select>
              <input
                type="text"
                value={newText}
                onChange={e => setNewText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') addItem() }}
                placeholder="新增…"
                className="w-0 flex-1 min-w-0 text-sm rounded-lg border border-base-line bg-base-surface px-2 py-1.5 outline-none focus:border-[#B4AEE8]"
              />
              <button onClick={addItem} disabled={!newText.trim()}
                className="shrink-0 px-2.5 py-1.5 text-xs rounded-full bg-[#B4AEE8] text-white disabled:opacity-50"
              >
                <Plus size={12} />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function formatContextContent(content: any): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map(part => {
      if (part.type === 'text') return part.text
      if (part.type === 'image_url') return '[图片]'
      return ''
    }).filter(Boolean).join('\n')
  }
  return String(content)
}

function MessageBubble({ msg, isTyping, onDelete, onResend }: { msg: ChatMessage; isTyping?: boolean; onDelete?: (id: string) => void; onResend?: (id: string) => void }) {
  const isUser = msg.role === 'user'
  const [confirmingAction, setConfirmingAction] = useState<'delete' | 'resend' | null>(null)
  const segments = msg.content ? splitContent(msg.content) : []

  const handleDeleteClick = () => setConfirmingAction('delete')
  const handleResendClick = () => setConfirmingAction('resend')
  const handleConfirm = () => {
    const action = confirmingAction
    setConfirmingAction(null)
    if (action === 'delete') onDelete?.(msg.id)
    else if (action === 'resend') onResend?.(msg.id)
  }
  const handleCancel = () => setConfirmingAction(null)

  const bubbleBg = isUser ? 'bg-[#E8F5E9]' : 'bg-[#F0F7FF]'
  const justify = isUser ? 'flex-end' : 'flex-start'

  const renderBubble = (content: string, key: number, images?: string[]) => (
    <div key={key} className="flex items-center gap-2 w-full" style={{ justifyContent: justify }}>
      <div className={`w-[70%] rounded-2xl border border-base-line px-4 py-3 ${bubbleBg}`}>
        {images && images.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {images.map((url, i) => (
              <img
                key={i}
                src={url}
                alt={`发送的图片 ${i + 1}`}
                className="max-w-full max-h-48 rounded-xl border border-base-line/50 object-cover"
              />
            ))}
          </div>
        )}
        {content && (
          <p className="text-sm text-base-text whitespace-pre-wrap break-words">{content}</p>
        )}
      </div>
    </div>
  )

  return (
    <div className={`flex flex-col gap-1.5 ${isUser ? 'items-end' : 'items-start'}`}>
      {segments.length > 0 ? (
        <>
          {segments.map((segment, i) => {
            const isLast = i === segments.length - 1
            return (
              <div key={i} className="contents">
                {renderBubble(segment, i, i === 0 ? msg.images : undefined)}
                {isLast && (
                  <>
                    {!isUser && isTyping && (
                      <div className="flex justify-start w-full">
                        <Loader2 size={16} className="animate-spin text-base-text/30 shrink-0 ml-1" />
                      </div>
                    )}
                    <div className={`flex items-center gap-2 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
                      <p className="text-xs text-base-text/40">{formatTime(msg.createdAt)}</p>
                      {onResend && !isTyping && (
                        <button
                          onClick={handleResendClick}
                          className="p-1 rounded-full text-base-text/20 hover:text-blue-400 hover:bg-blue-50 active:scale-90 transition-all duration-150"
                        >
                          <RefreshCw size={12} />
                        </button>
                      )}
                      {onDelete && !isTyping && (
                        <button
                          onClick={handleDeleteClick}
                          className="p-1 rounded-full text-base-text/20 hover:text-red-400 hover:bg-red-50 active:scale-90 transition-all duration-150"
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                    {confirmingAction && (
                      <div className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border border-red-100 bg-red-50 text-xs ${isUser ? 'self-end' : 'self-start'}`}>
                        <span className="text-base-text/60">{confirmingAction === 'delete' ? '真的要删除这条消息吗？' : '重新生成这条回复？'}</span>
                        <button
                          onClick={handleConfirm}
                          className="font-semibold text-red-500 hover:text-red-600 transition-colors"
                        >
                          是
                        </button>
                        <span className="text-base-text/20">·</span>
                        <button
                          onClick={handleCancel}
                          className="text-base-text/40 hover:text-base-text/70 transition-colors"
                        >
                          否
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            )
          })}
        </>
      ) : (
        <>
          {msg.images && msg.images.length > 0 ? (
            renderBubble('', 0, msg.images)
          ) : (
            <div className="flex items-center gap-2 w-full" style={{ justifyContent: justify }}>
              <div className={`w-[70%] rounded-2xl border border-base-line px-4 py-3 ${bubbleBg}`}>
                {!isUser && isTyping ? (
                  <div className="h-5 w-8 flex items-center justify-center">
                    <div className="flex gap-1">
                      <div className="w-1 h-1 bg-base-text/30 rounded-full animate-bounce" />
                      <div className="w-1 h-1 bg-base-text/30 rounded-full animate-bounce [animation-delay:0.2s]" />
                      <div className="w-1 h-1 bg-base-text/30 rounded-full animate-bounce [animation-delay:0.4s]" />
                    </div>
                  </div>
                ) : null}
              </div>
              {!isUser && isTyping && (
                <Loader2 size={16} className="animate-spin text-base-text/30 shrink-0" />
              )}
            </div>
          )}
          <div className={`flex items-center gap-2 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
            <p className="text-xs text-base-text/40">{formatTime(msg.createdAt)}</p>
            {onResend && !isTyping && (
              <button
                onClick={handleResendClick}
                className="p-1 rounded-full text-base-text/20 hover:text-blue-400 hover:bg-blue-50 active:scale-90 transition-all duration-150"
              >
                <RefreshCw size={12} />
              </button>
            )}
            {onDelete && !isTyping && (
              <button
                onClick={handleDeleteClick}
                className="p-1 rounded-full text-base-text/20 hover:text-red-400 hover:bg-red-50 active:scale-90 transition-all duration-150"
              >
                <Trash2 size={12} />
              </button>
            )}
          </div>
          {confirmingAction && (
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border border-red-100 bg-red-50 text-xs ${isUser ? 'self-end' : 'self-start'}`}>
              <span className="text-base-text/60">{confirmingAction === 'delete' ? '真的要删除这条消息吗？' : '重新生成这条回复？'}</span>
              <button
                onClick={handleConfirm}
                className="font-semibold text-red-500 hover:text-red-600 transition-colors"
              >
                是
              </button>
              <span className="text-base-text/20">·</span>
              <button
                onClick={handleCancel}
                className="text-base-text/40 hover:text-base-text/70 transition-colors"
              >
                否
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

const CONTEXT_WINDOW = 30
const MAX_INPUT_HEIGHT = 160

export default function Chat() {
  const navigate = useNavigate()
  const messages = useChatStore((s) => s.messages)
  const isLoading = useChatStore((s) => s.isLoading)
  const addMessage = useChatStore((s) => s.addMessage)
  const updateMessage = useChatStore((s) => s.updateMessage)
  const setLoading = useChatStore((s) => s.setLoading)
  const clearMessages = useChatStore((s) => s.clearMessages)
  const syncMessages = useChatStore((s) => s.syncMessages)
  const upsertMessage = useChatStore((s) => s.upsertMessage)
  const deleteMessage = useChatStore((s) => s.deleteMessage)

  const [input, setInput] = useState('')
  const [vectorSyncStatus, setVectorSyncStatus] = useState<'synced' | 'pending' | 'syncing'>('synced')
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isContextOpen, setIsContextOpen] = useState(false)
  const [lastFullContext, setLastFullContext] = useState<any[]>([])
  const [isProfileDiaryOpen, setIsProfileDiaryOpen] = useState(false)
  const [profileDiaryInitialTab, setProfileDiaryInitialTab] = useState<'profile' | 'diary'>('profile')
  const [isDailyEventsOpen, setIsDailyEventsOpen] = useState(false)
  const [textareaHeight, setTextareaHeight] = useState(44)
  const [selectedImages, setSelectedImages] = useState<CompressedImage[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const { settings, loadFromCloud } = useSettingsStore()

  // 0. 从云端加载设置（防止重装丢失）
  useEffect(() => {
    loadFromCloud()
  }, [loadFromCloud])

  // 1. 同步云端消息
  useEffect(() => {
    const client = supabase
    if (!client) return

    // 订阅实时更新
    const channel = client
      .channel('chat_messages_realtime')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages' },
        (payload) => {
          const next = payload.new as any
          if (!next?.id || !next.content) return
          upsertMessage({
            id: next.client_id || next.id,
            role: next.role,
            content: next.content,
            createdAt: new Date(next.created_at).getTime(),
            isSynced: true
          })
        }
      )
      .subscribe()

    // 初始拉取最新云端消息（补齐离线时主动发送的消息）
    void (async () => {
      const { data: { user } } = await client.auth.getUser()
      
      let query = client
        .from('chat_messages')
        .select('*')
      
      if (user) {
        query = query.eq('user_id', user.id)
      }

      const { data, error } = await query
        .order('created_at', { ascending: false })
        .limit(100) // 增加拉取数量到 100 条

      if (!error && data) {
        data.reverse().forEach((msg: any) => {
          upsertMessage({
            id: msg.client_id || msg.id,
            role: msg.role,
            content: msg.content,
            createdAt: new Date(msg.created_at).getTime(),
            isSynced: true
          })
        })
      }
    })()

    return () => {
      void client.removeChannel(channel)
    }
  }, [upsertMessage])

  // 2. 检查向量化状态
  const checkVectorStatus = async () => {
    if (!supabase) return
    const { count, error } = await supabase
      .from('transactions')
      .select('*', { count: 'exact', head: true })
      .is('embedding', null)
      .in('type', ['记账', 'whisper'])

    if (!error && count !== null) {
      setVectorSyncStatus(count > 0 ? 'pending' : 'synced')
    }
  }

  useEffect(() => {
    void checkVectorStatus()
  }, [])

  // 手动触发全量同步
  const handleManualVectorSync = async () => {
    if (vectorSyncStatus === 'syncing') return
    setVectorSyncStatus('syncing')
    
    let hasMore = true
    while (hasMore) {
      try {
        const res = await fetch('/api/vectorize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'all' })
        })
        const data = await res.json()
        if (data.results && data.results.length === 50) {
          hasMore = true
        } else {
          hasMore = false
        }
      } catch (err) {
        console.error('Manual sync failed:', err)
        hasMore = false
      }
    }
    void checkVectorStatus()
  }

  const prevMsgLenRef = useRef(0)

  // 滚动到底部（仅在消息增加时触发，删除时保持位置）
  useEffect(() => {
    const prev = prevMsgLenRef.current
    prevMsgLenRef.current = messages.length
    if (messages.length >= prev) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages.length, isLoading, textareaHeight])

  // 输入框自适应高度
  useLayoutEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    const scrollH = el.scrollHeight
    const newHeight = Math.min(scrollH, MAX_INPUT_HEIGHT)
    el.style.height = `${newHeight}px`
    el.style.overflowY = scrollH > MAX_INPUT_HEIGHT ? 'auto' : 'hidden'
    setTextareaHeight(newHeight)
  }, [input])

  // 自动同步逻辑
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        void syncMessages()
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      void syncMessages()
    }
  }, [syncMessages])

  const sendToAi = async (aiMsgId: string) => {
    try {
      const state = useChatStore.getState()
      const context = state.messages
        .filter(m => m.content || m.images?.length)
        .slice(-CONTEXT_WINDOW)
        .map((m, i, arr) => {
          const lastImageIdx = arr.reduce((best, msg, idx) =>
            msg.role === 'user' && msg.images?.length ? idx : best, -1)
          return {
            role: m.role,
            content: m.content,
            createdAt: m.createdAt,
            images: i === lastImageIdx ? m.images : undefined
          }
        })

      const [{ data: { user } }, location] = await Promise.all([
        supabase ? supabase.auth.getUser() : Promise.resolve({ data: { user: null } }),
        getCurrentLocation()
      ])

      if (location && user) {
        fetch('/api/update-location', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: user.id, ...location })
        }).catch(() => {})
      }

      const response = await fetch('/api/chat-completion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: context,
          settings: {
            systemPrompt: settings.systemPrompt,
            userPrompt: settings.userPrompt,
            apiConfigs: settings.apiConfigs
          },
          userId: user?.id,
          location: location || undefined
        })
      })

      const responseText = await response.text()
      if (!responseText) throw new Error('服务器无响应')
      let data: any
      try {
        data = JSON.parse(responseText)
      } catch {
        throw new Error(`服务器返回非 JSON：${responseText.slice(0, 120)}`)
      }

      if (!response.ok) throw new Error(data.error || '请求失败')

      if (data.fullMessages) {
        setLastFullContext(data.fullMessages)
      } else {
        setLastFullContext(context)
      }

      const aiContent = data.choices?.[0]?.message?.content || 'AI 暂时无法回答。'
      updateMessage(aiMsgId, { content: aiContent })

      const unsyncedCount = state.messages.filter(m => !m.isSynced).length
      if (unsyncedCount >= 10) {
        void syncMessages()
      }
    } catch (error: any) {
      console.error('[Chat] Error:', error)
      updateMessage(aiMsgId, { content: `抱歉，出错了：${error.message}` })
    }
  }

  const handleSend = async () => {
    const text = input.trim()
    const hasImages = selectedImages.length > 0
    if ((!text && !hasImages) || isLoading) return

    setInput('')
    if (inputRef.current) {
      inputRef.current.style.height = '44px'
      inputRef.current.style.overflowY = 'hidden'
    }
    setTextareaHeight(44)
    const images = selectedImages
    setSelectedImages([])
    setLoading(true)

    addMessage({
      role: 'user',
      content: text,
      createdAt: Date.now(),
      images: images.map(img => img.dataUrl)
    })
    const aiMsgId = addMessage({ role: 'assistant', content: '', createdAt: Date.now() })

    await sendToAi(aiMsgId)
    setLoading(false)
  }

  const handleResend = async (aiMsgId: string) => {
    const state = useChatStore.getState()
    const aiIndex = state.messages.findIndex(m => m.id === aiMsgId)
    if (aiIndex <= 0) return

    const userMsg = state.messages[aiIndex - 1]
    if (userMsg.role !== 'user' || !userMsg.content) return

    await deleteMessage(aiMsgId)

    setLoading(true)
    const newAiMsgId = addMessage({ role: 'assistant', content: '', createdAt: Date.now() })

    await sendToAi(newAiMsgId)
    setLoading(false)
  }

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return

    for (let i = 0; i < files.length; i++) {
      try {
        const compressed = await compressImage(files[i])
        setSelectedImages(prev => [...prev, compressed])
      } catch (err: any) {
        alert(err.message || '图片处理失败')
      }
    }
    // Reset input so same file can be re-selected
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const removeImage = (index: number) => {
    setSelectedImages(prev => prev.filter((_, i) => i !== index))
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="flex flex-col h-dvh bg-base-bg">
      <header className="flex items-center justify-between bg-base-bg px-4 pb-3 pt-[calc(env(safe-area-inset-top)+0.75rem)]">
        <div className="flex items-center gap-2">
          <Sparkles size="16" className="text-[#B4AEE8]" />
          <span className="text-sm font-medium text-base-text">AI 助手</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setIsSettingsOpen(true)}
            className="h-10 w-10 text-base-text/50 border border-base-line rounded-full bg-base-surface active:opacity-70 flex items-center justify-center"
          >
            <Settings size={16} />
          </button>
          <button
            type="button"
            onClick={() => setIsDailyEventsOpen(true)}
            className="h-10 w-10 text-base-text/50 border border-base-line rounded-full bg-base-surface active:opacity-70 flex items-center justify-center"
            title="每日事件"
          >
            <ListTodo size={16} />
          </button>
          <button
            type="button"
            onClick={() => { setProfileDiaryInitialTab('profile'); setIsProfileDiaryOpen(true) }}
            className="h-10 w-10 text-base-text/50 border border-base-line rounded-full bg-base-surface active:opacity-70 flex items-center justify-center"
            title="记忆（用户画像 + 每日日记）"
          >
            <BookOpen size={16} />
          </button>
          <IconButton
            label="返回"
            onClick={() => navigate(-1)}
            icon={<ArrowLeft size={20} />}
          />
        </div>
      </header>

      <div
        className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-3"
      >
        {messages.length === 0 && <WelcomeBubble />}
        {messages.map((msg, idx) => (
          <MessageBubble
            key={msg.id}
            msg={msg}
            isTyping={isLoading && idx === messages.length - 1}
            onDelete={deleteMessage}
            onResend={msg.role === 'assistant' ? handleResend : undefined}
          />
        ))}
        <div ref={bottomRef} />
      </div>

      <footer className="p-4 bg-base-bg pb-[calc(env(safe-area-inset-bottom)+1rem)]">
        {selectedImages.length > 0 && (
          <div className="flex gap-2 mb-3 overflow-x-auto pb-1">
            {selectedImages.map((img, i) => (
              <div key={i} className="relative shrink-0">
                <img
                  src={img.dataUrl}
                  alt={`预览 ${i + 1}`}
                  className="w-16 h-16 rounded-xl border border-base-line object-cover"
                />
                <button
                  onClick={() => removeImage(i)}
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-base-text/60 text-white flex items-center justify-center active:opacity-70"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="relative flex items-end gap-2">
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="和弗弗聊聊..."
            className="flex-1 rounded-2xl border border-base-line bg-base-surface px-4 py-3 text-sm text-base-text outline-none focus:border-[#B4AEE8] transition-colors resize-none"
            style={{ height: '44px', minHeight: '44px', overflowY: 'hidden' }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isLoading}
            className="h-11 w-11 rounded-2xl flex items-center justify-center transition-colors border border-base-line text-base-text/40 hover:text-[#B4AEE8] hover:border-[#B4AEE8] active:opacity-70 disabled:opacity-30"
          >
            <ImagePlus size={20} />
          </button>
          <button
            onClick={handleSend}
            disabled={(!input.trim() && selectedImages.length === 0) || isLoading}
            className={`h-11 w-11 rounded-2xl flex items-center justify-center transition-colors ${
              (input.trim() || selectedImages.length > 0) && !isLoading
                ? 'bg-[#B4AEE8] text-white shadow-lg'
                : 'bg-base-line text-base-text/20 cursor-not-allowed'
            }`}
          >
            <Send size={20} />
          </button>
        </div>
      </footer>

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        vectorSyncStatus={vectorSyncStatus}
        onVectorSync={handleManualVectorSync}
        onClearMessages={clearMessages}
        onOpenContext={() => setIsContextOpen(true)}
      />
      <ContextViewerModal
        isOpen={isContextOpen}
        onClose={() => setIsContextOpen(false)}
        context={lastFullContext}
      />
      <ProfileDiaryModal
        isOpen={isProfileDiaryOpen}
        onClose={() => setIsProfileDiaryOpen(false)}
        initialTab={profileDiaryInitialTab}
      />
      <DailyEventsModal
        isOpen={isDailyEventsOpen}
        onClose={() => setIsDailyEventsOpen(false)}
      />

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={handleImageSelect}
        className="hidden"
      />
    </div>
  )
}
