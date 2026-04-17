import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { supabase } from '../supabaseClient'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  createdAt: number
  isSynced?: boolean
}

type ChatState = {
  messages: ChatMessage[]
  isLoading: boolean
  hasMore: boolean
  addMessage: (msg: Omit<ChatMessage, 'id'>) => string
  updateMessage: (id: string, updates: Partial<ChatMessage>) => void
  setLoading: (v: boolean) => void
  setHasMore: (v: boolean) => void
  clearMessages: () => void
  syncMessages: () => Promise<void>
}

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      messages: [],
      isLoading: false,
      hasMore: false,

      addMessage: (msg) => {
        const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
        set((s) => ({
          messages: [
            ...s.messages,
            { ...msg, id, isSynced: false },
          ],
        }))
        return id
      },

      updateMessage: (id, updates) =>
        set((s) => ({
          messages: s.messages.map((m) => (m.id === id ? { ...m, ...updates } : m)),
        })),

      setLoading: (v) => set({ isLoading: v }),

      setHasMore: (v) => set({ hasMore: v }),

      clearMessages: () => set({ messages: [] }),

      syncMessages: async () => {
        const { messages } = get()
        const unSyncedMessages = messages.filter((m) => !m.isSynced && m.role !== 'system')
        
        if (unSyncedMessages.length === 0) return

        const client = supabase
        if (!client) {
          console.error('[ChatStore] Supabase not configured')
          return
        }

        const toUpload = unSyncedMessages.map(m => ({
          client_id: m.id,
          role: m.role,
          content: m.content,
          created_at: new Date(m.createdAt).toISOString()
        }))

        const { error } = await client.from('chat_messages').insert(toUpload)

        if (!error) {
          set((s) => ({
            messages: s.messages.map(m => 
              unSyncedMessages.some(um => um.id === m.id) ? { ...m, isSynced: true } : m
            )
          }))
        } else {
          console.error('[ChatStore] Sync failed:', error)
        }
      }
    }),
    {
      name: 'f-sync-chat-v2',
      partialize: (s) => ({ messages: s.messages }),
    },
  ),
)
