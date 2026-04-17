import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: number
}

type ChatState = {
  messages: ChatMessage[]
  isLoading: boolean
  hasMore: boolean
  addMessage: (msg: Omit<ChatMessage, 'id'>) => void
  updateStreamingMessage: (id: string, content: string) => void
  setLoading: (v: boolean) => void
  setHasMore: (v: boolean) => void
  loadMoreMessages: () => ChatMessage[]
  clearMessages: () => void
}

const PAGE_SIZE = 30

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      messages: [],
      isLoading: false,
      hasMore: true,

      addMessage: (msg) =>
        set((s) => ({
          messages: [
            ...s.messages,
            { ...msg, id: `${Date.now()}-${Math.random().toString(36).slice(2)}` },
          ],
        })),

      updateStreamingMessage: (id, content) =>
        set((s) => ({
          messages: s.messages.map((m) => (m.id === id ? { ...m, content } : m)),
        })),

      setLoading: (v) => set({ isLoading: v }),

      setHasMore: (v) => set({ hasMore: v }),

      loadMoreMessages: () => {
        const { messages } = get()
        const start = Math.max(0, messages.length - PAGE_SIZE)
        return messages.slice(0, start)
      },

      clearMessages: () => set({ messages: [], hasMore: true }),
    }),
    {
      name: 'f-sync-chat-v1',
      partialize: (s) => ({ messages: s.messages }),
    },
  ),
)