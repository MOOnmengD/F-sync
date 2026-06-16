import { create } from 'zustand'
import type { MediaStatus, MediaType, QuickMode } from '../types/domain'

export type FinanceCategory = '衣' | '食' | '住' | '行' | '其他'

type UiState = {
  drawerOpen: boolean
  setDrawerOpen: (open: boolean) => void
  toggleDrawer: () => void
  homeMode: QuickMode
  setHomeMode: (mode: QuickMode) => void
  financeCategory: FinanceCategory | null
  setFinanceCategory: (v: FinanceCategory | null) => void
  financeNecessity: 'need' | 'want' | null
  setFinanceNecessity: (v: 'need' | 'want' | null) => void
  noteMood: string
  setNoteMood: (m: string) => void
  mediaType: MediaType | null
  setMediaType: (v: MediaType | null) => void
  mediaStatus: MediaStatus | null
  setMediaStatus: (v: MediaStatus | null) => void
}

export const useUi = create<UiState>((set) => ({
  drawerOpen: false,
  setDrawerOpen: (open) => set({ drawerOpen: open }),
  toggleDrawer: () => set((s) => ({ drawerOpen: !s.drawerOpen })),
  homeMode: 'finance',
  setHomeMode: (mode) => set({ homeMode: mode }),
  financeCategory: null,
  setFinanceCategory: (v) => set({ financeCategory: v }),
  financeNecessity: null,
  setFinanceNecessity: (v) => set({ financeNecessity: v }),
  noteMood: '😐',
  setNoteMood: (m) => set({ noteMood: m }),
  mediaType: null,
  setMediaType: (v) => set({ mediaType: v }),
  mediaStatus: null,
  setMediaStatus: (v) => set({ mediaStatus: v }),
}))
