import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Check, Loader2, RefreshCw, Send, Settings, Sparkles, X, Save, Eye, EyeOff, ClipboardPaste, Copy, FileText } from 'lucide-react'
import { IconButton } from '../shared/ui/IconButton'
import { useChatStore, type ChatMessage } from '../store/chat'
import { supabase } from '../supabaseClient'
import { useSettingsStore } from '../store/settings'

function formatTime(timestamp: number) {
  const d = new Date(timestamp)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
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
                  {msg.content}
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

function SettingsModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { settings, updateSettings } = useSettingsStore()
  const [localSettings, setLocalSettings] = useState(settings)
  const [showApiKeys, setShowApiKeys] = useState<Record<number, boolean>>({})

  if (!isOpen) return null

  const handleSave = (key: keyof typeof settings, value: any) => {
    updateSettings({ [key]: value })
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
                      className="opacity-0 group-focus-within:opacity-100 transition-opacity flex items-center gap-1 text-xs text-[#B4AEE8] font-bold"
                    >
                      <Save size={14} /> 保存
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
                      className="opacity-0 group-focus-within:opacity-100 transition-opacity flex items-center gap-1 text-xs text-[#B4AEE8] font-bold"
                    >
                      <Save size={14} /> 保存
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
        </div>
      </div>
    </div>
  )
}

function MessageBubble({ msg, isTyping }: { msg: ChatMessage; isTyping?: boolean }) {
  const isUser = msg.role === 'user'
  return (
    <div className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}>
      <div className="flex items-center gap-2 w-full justify-inherit" style={{ justifyContent: isUser ? 'flex-end' : 'flex-start' }}>
        <div
          className={`w-[70%] rounded-2xl border border-base-line px-4 py-3 ${
            isUser ? 'bg-[#E8F5E9]' : 'bg-[#F0F7FF]'
          }`}
        >
          {msg.content ? (
            <p className="text-sm text-base-text whitespace-pre-wrap break-words">{msg.content}</p>
          ) : !isUser && isTyping ? (
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
      <p className="mt-1 text-xs text-base-text/40">{formatTime(msg.createdAt)}</p>
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

  const [input, setInput] = useState('')
  const [vectorSyncStatus, setVectorSyncStatus] = useState<'synced' | 'pending' | 'syncing'>('synced')
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isContextOpen, setIsContextOpen] = useState(false)
  const [lastFullContext, setLastFullContext] = useState<any[]>([])
  const [textareaHeight, setTextareaHeight] = useState(44)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const { settings } = useSettingsStore()

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

  // 滚动到底部
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
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

  const handleSend = async () => {
    const text = input.trim()
    if (!text || isLoading) return

    setInput('')
    if (inputRef.current) {
      inputRef.current.style.height = '44px'
      inputRef.current.style.overflowY = 'hidden'
    }
    setTextareaHeight(44)
    setLoading(true)

    // 1. 添加用户消息
    addMessage({ role: 'user', content: text, createdAt: Date.now() })

    // 2. 准备 AI 占位消息
    const aiMsgId = addMessage({ role: 'assistant', content: '', createdAt: Date.now() })

    try {
      // 3. 打包上下文
      const context = messages.slice(-CONTEXT_WINDOW).map(m => ({
        role: m.role,
        content: m.content,
        createdAt: m.createdAt
      }))
      const userMessage = { role: 'user' as const, content: text, createdAt: Date.now() }
      context.push(userMessage)

      // 4. 调用 API
      const response = await fetch('/api/chat-completion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          messages: context,
          settings: {
            systemPrompt: settings.systemPrompt,
            userPrompt: settings.userPrompt,
            apiConfigs: settings.apiConfigs
          }
        })
      })

      const data = await response.json()
      
      if (!response.ok) throw new Error(data.error || '请求失败')

      // 如果后端返回了 fullMessages，则更新最后一次上下文
      if (data.fullMessages) {
        setLastFullContext(data.fullMessages)
      } else {
        // 降级：仅保存前端已知的
        setLastFullContext(context)
      }

      const aiContent = data.choices?.[0]?.message?.content || 'AI 暂时无法回答。'
      
      // 5. 更新 AI 消息
      updateMessage(aiMsgId, { content: aiContent })

      // 6. 批次同步判断
      const unsyncedCount = messages.filter(m => !m.isSynced).length
      if (unsyncedCount >= 10) {
        void syncMessages()
      }

    } catch (error: any) {
      console.error('[Chat] Error:', error)
      updateMessage(aiMsgId, { content: `抱歉，出错了：${error.message}` })
    } finally {
      setLoading(false)
    }
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
            className="h-10 px-3 text-xs text-base-text/50 border border-base-line rounded-full bg-base-surface active:opacity-70 flex items-center justify-center"
            style={{ width: '40px' }}
          >
            <Settings size={16} />
          </button>
          <button
            type="button"
            onClick={vectorSyncStatus === 'pending' ? handleManualVectorSync : undefined}
            disabled={vectorSyncStatus === 'syncing'}
            className={`h-10 px-3 text-xs border border-base-line rounded-full bg-base-surface flex items-center gap-1 ${
              vectorSyncStatus === 'pending' ? 'text-[#B4AEE8] active:opacity-70' : 'text-base-text/30 cursor-default'
            }`}
            style={{ width: '40px', justifyContent: 'center' }}
          >
            {vectorSyncStatus === 'syncing' ? (
              <Loader2 size={14} className="animate-spin" />
            ) : vectorSyncStatus === 'synced' ? (
              <Check size={14} className="text-green-400" />
            ) : (
              <RefreshCw size={14} />
            )}
            {vectorSyncStatus === 'syncing' ? '' : vectorSyncStatus === 'synced' ? '' : ''}
          </button>
          <button
            type="button"
            onClick={clearMessages}
            className="h-10 px-3 text-xs text-base-text/50 border border-base-line rounded-full bg-base-surface active:opacity-70"
            style={{ width: '40px' }}
          >
            清空
          </button>
          <button
            type="button"
            onClick={() => setIsContextOpen(true)}
            className="h-10 px-3 text-xs text-base-text/50 border border-base-line rounded-full bg-base-surface active:opacity-70 flex items-center justify-center"
            title="全量上下文显示"
            style={{ width: '40px' }}
          >
            <FileText size={16} />
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
          />
        ))}
        <div ref={bottomRef} />
      </div>

      <footer className="p-4 bg-base-bg pb-[calc(env(safe-area-inset-bottom)+1rem)]">
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
            onClick={handleSend}
            disabled={!input.trim() || isLoading}
            className={`h-11 w-11 rounded-2xl flex items-center justify-center transition-colors ${
              input.trim() && !isLoading
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
      />
      <ContextViewerModal
        isOpen={isContextOpen}
        onClose={() => setIsContextOpen(false)}
        context={lastFullContext}
      />
    </div>
  )
}
