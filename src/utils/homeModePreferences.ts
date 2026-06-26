import type { HomeModePreferences, QuickMode } from '../types/domain'

export const HOME_MODE_ORDER: readonly QuickMode[] = [
  'finance',
  'invest',
  'media',
  'review',
  'note',
  'work',
  'save',
  'timeline',
]

export const HOME_MODE_LABELS: Record<QuickMode, string> = {
  finance: '记账',
  invest: '理财',
  media: '书影',
  review: '点评',
  note: '碎碎念',
  work: '工作',
  save: '收藏',
  timeline: '时间轴',
}

export const MAX_PINNED_HOME_MODES = 3

export const DEFAULT_HOME_MODE_PREFERENCES: HomeModePreferences = {
  pinnedModes: ['finance', 'invest', 'media'],
  modeOrder: [...HOME_MODE_ORDER],
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function isQuickMode(value: unknown): value is QuickMode {
  return typeof value === 'string' && (HOME_MODE_ORDER as readonly string[]).includes(value)
}

function uniqueQuickModes(values: unknown[]): QuickMode[] {
  const seen = new Set<QuickMode>()
  const modes: QuickMode[] = []

  for (const value of values) {
    if (!isQuickMode(value) || seen.has(value)) continue
    seen.add(value)
    modes.push(value)
  }

  return modes
}

export function normalizeHomeModePreferences(value: unknown): HomeModePreferences {
  const input = isRecord(value) ? value : {}
  const rawOrder = Array.isArray(input.modeOrder)
    ? input.modeOrder
    : DEFAULT_HOME_MODE_PREFERENCES.modeOrder
  const rawPinned = Array.isArray(input.pinnedModes)
    ? input.pinnedModes
    : DEFAULT_HOME_MODE_PREFERENCES.pinnedModes

  const order = uniqueQuickModes(rawOrder)
  const completeOrder = [
    ...order,
    ...HOME_MODE_ORDER.filter((mode) => !order.includes(mode)),
  ]
  const pinnedSet = new Set(uniqueQuickModes(rawPinned))
  const pinnedModes = completeOrder
    .filter((mode) => pinnedSet.has(mode))
    .slice(0, MAX_PINNED_HOME_MODES)

  return {
    pinnedModes,
    modeOrder: completeOrder,
  }
}

export function getHomeModeDisplayGroups(value: unknown) {
  const preferences = normalizeHomeModePreferences(value)
  const pinnedSet = new Set(preferences.pinnedModes)

  return {
    pinnedModes: preferences.pinnedModes,
    scrollModes: preferences.modeOrder.filter((mode) => !pinnedSet.has(mode)),
  }
}
