import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Loader2, Send, Sparkles } from 'lucide-react'
import { IconButton } from '../shared/ui/IconButton'
import { useChatStore, type ChatMessage } from '../store/chat'

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
          你好！我是 F-Sync AI 助手。我已经了解了你最近的生活记录，可以帮你回顾、分析，或者随便聊聊。
          有任何问题尽管问我～
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

  const [input, setInput] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

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
            onClick={clearMessages}
            className="h-10 px-3 text-xs text-base-text/50 border border-base-line rounded-full bg-base-surface active:opacity-70"
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
