import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Send, Sparkles } from 'lucide-react'
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

function TypingBubble() {
  return (
    <div className="flex justify-start">
      <div className="max-w-[75%] rounded-2xl border border-base-line bg-[#F0F7FF] px-4 py-3">
        <p className="text-sm text-base-text/50">思考中…</p>
      </div>
    </div>
  )
}

function MessageBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === 'user'
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[75%] rounded-2xl border border-base-line px-4 py-3 ${
          isUser ? 'bg-[#E8F5E9]' : 'bg-[#F0F7FF]'
        }`}
      >
        <p className="text-sm text-base-text whitespace-pre-wrap break-words">{msg.content}</p>
        <p className="mt-1 text-xs text-base-text/40">{formatTime(msg.createdAt)}</p>
      </div>
    </div>
  )
}

const PAGE_SIZE = 30

export default function Chat() {
  const navigate = useNavigate()
  const messages = useChatStore((s) => s.messages)
  const isLoading = useChatStore((s) => s.isLoading)
  const hasMore = useChatStore((s) => s.hasMore)
  const addMessage = useChatStore((s) => s.addMessage)
  const setLoading = useChatStore((s) => s.setLoading)
  const setHasMore = useChatStore((s) => s.setHasMore)
  const clearMessages = useChatStore((s) => s.clearMessages)
  const loadMoreMessages = useChatStore((s) => s.loadMoreMessages)

  const [input, setInput] = useState('')
  const [displayedMessages, setDisplayedMessages] = useState<ChatMessage[]>([])
  const [loadingMore, setLoadingMore] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const loadingIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (messages.length <= PAGE_SIZE) {
      setDisplayedMessages(messages)
      setHasMore(false)
    } else {
      setDisplayedMessages(messages.slice(-PAGE_SIZE))
      setHasMore(true)
    }
  }, [messages.length])

  useEffect(() => {
    if (!isLoading && loadingIdRef.current) {
      loadingIdRef.current = null
    }
  }, [isLoading])

  useEffect(() => {
    if (!isLoading) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [displayedMessages, isLoading])

  const handleLoadMore = async () => {
    if (loadingMore || !hasMore) return
    setLoadingMore(true)
    const older = loadMoreMessages()
    if (older.length === displayedMessages.length) {
      setHasMore(false)
    } else {
      setDisplayedMessages(older)
    }
    setLoadingMore(false)
  }

  const handleSend = async () => {
    const text = input.trim()
    if (!text || isLoading) return
    setInput('')
    addMessage({ role: 'user', content: text, createdAt: Date.now() })
    setLoading(true)
    const tempId = `${Date.now()}-temp`
    loadingIdRef.current = tempId
    addMessage({ role: 'assistant', content: '', createdAt: Date.now() })
    setTimeout(() => {
      if (loadingIdRef.current === tempId) {
        setLoading(false)
      }
    }, 3000)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="flex flex-col h-dvh bg-base-bg">
      <header className="flex items-center justify-between border-b border-base-line bg-base-bg px-4 pb-3 pt-[calc(env(safe-area-inset-top)+0.75rem)]">
        <IconButton
          label="返回"
          onClick={() => navigate(-1)}
          icon={<ArrowLeft size={20} />}
        />
        <div className="flex items-center gap-2">
          <Sparkles size={16} className="text-[#B4AEE8]" />
          <span className="text-sm font-medium text-base-text">AI 助手</span>
        </div>
        <button
          type="button"
          onClick={clearMessages}
          className="h-10 px-3 text-xs text-base-text/50 border border-base-line rounded-full bg-base-surface active:opacity-70"
        >
          清空
        </button>
      </header>

      <div
        ref={listRef}
        className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-3"
        onScroll={(e) => {
          const { scrollTop } = e.currentTarget
          if (scrollTop < 80 && !loadingMore && hasMore) {
            void handleLoadMore()
          }
        }}
      >
        {displayedMessages.length === 0 && <WelcomeBubble />}
        {displayedMessages.map((msg) => (
          <MessageBubble key={msg.id} msg={msg} />
        ))}
        {isLoading && <TypingBubble />}
        <div ref={bottomRef} />
      </div>

      {hasMore && (
        <div className="flex justify-center py-2">
          <button
            type="button"
            onClick={() => void handleLoadMore()}
            disabled={loadingMore}
            className="text-xs text-base-text/40 border border-base-line rounded-full px-3 py-1 bg-base-surface active:opacity-70 disabled:opacity-50"
          >
            {loadingMore ? '加载中…' : '加载更多'}
          </button>
        </div>
      )}

      <div className="border-t border-base-line bg-base-bg px-4 py-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
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