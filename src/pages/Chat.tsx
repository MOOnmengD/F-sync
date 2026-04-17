import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Check, Loader2, RefreshCw, Send, Sparkles } from 'lucide-react'
import { IconButton } from '../shared/ui/IconButton'
import { useChatStore, type ChatMessage } from '../store/chat'
import { supabase } from '../supabaseClient'

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

const CONTEXT_WINDOW = 30 // 打包最近 30 条对话

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
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

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
      const { data, error } = await client
        .from('chat_messages')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50)

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
  }, [messages.length, isLoading])

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
    setLoading(true)

    // 1. 添加用户消息
    addMessage({ role: 'user', content: text, createdAt: Date.now() })

    // 2. 准备 AI 占位消息
    const aiMsgId = addMessage({ role: 'assistant', content: '', createdAt: Date.now() })

    try {
      // 3. 打包上下文
      const context = messages.slice(-CONTEXT_WINDOW).map(m => ({
        role: m.role,
        content: m.content
      }))
      context.push({ role: 'user', content: text })

      // 4. 调用 API
      const response = await fetch('/api/chat-completion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: context })
      })

      const data = await response.json()
      
      if (!response.ok) throw new Error(data.error || '请求失败')

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
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="flex flex-col h-dvh bg-base-bg">
      <header className="flex items-center justify-between bg-base-bg px-4 pb-3 pt-[calc(env(safe-area-inset-top)+0.75rem)]">
        <div className="flex items-center gap-2">
          <Sparkles size={16} className="text-[#B4AEE8]" />
          <span className="text-sm font-medium text-base-text">AI 助手</span>
        </div>
        <div className="flex items-center gap-2">
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

      <div className="bg-base-bg px-4 py-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="问 AI 任何问题…"
            rows={1}
            className="flex-1 resize-none border border-base-line rounded-2xl bg-base-surface px-4 py-3 text-sm text-base-text placeholder:text-base-text/30 focus:outline-none focus:border-[#B4AEE8] max-h-32 overflow-y-auto"
            style={{ minHeight: '44px' }}
          />
          <IconButton
            label="发送"
            onClick={() => void handleSend()}
            icon={<Send size={18} />}
          />
        </div>
      </div>
    </div>
  )
}
