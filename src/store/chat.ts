import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { supabase } from '../supabaseClient'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  createdAt: number
  isSynced?: boolean
  images?: string[] // base64 data URLs, only on user messages, not synced to cloud
}

type ChatState = {
  messages: ChatMessage[]
  isLoading: boolean
  hasMore: boolean
  addMessage: (msg: Omit<ChatMessage, 'id'>) => string
  updateMessage: (id: string, updates: Partial<ChatMessage>) => void
  deleteMessage: (id: string) => Promise<void>
  setLoading: (v: boolean) => void
  setHasMore: (v: boolean) => void
  clearMessages: () => void
  syncMessages: () => Promise<void>
  upsertMessage: (msg: ChatMessage) => void
}

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      messages: [],
      isLoading: false,
      hasMore: false,

      upsertMessage: (msg) => {
        set((s) => {
          const exists = s.messages.some(m => m.id === msg.id)
          if (exists) {
            return {
              messages: s.messages.map(m => m.id === msg.id ? msg : m)
            }
          }
          const next = [...s.messages, msg]
          next.sort((a, b) => a.createdAt - b.createdAt)
          return { messages: next }
        })
      },

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

      deleteMessage: async (id) => {
        set((s) => ({ messages: s.messages.filter((m) => m.id !== id) }))

        const client = supabase
        if (!client) return

        // client_id is text, safe for any string
        await client.from('chat_messages').delete().eq('client_id', id)

        // also try by actual UUID if the id looks like one
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
          await client.from('chat_messages').delete().eq('id', id)
        }
      },

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
