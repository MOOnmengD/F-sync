import type { MockDb } from '../types/domain'

export const mockDb: MockDb = {
  itemsById: {
    item_a: { id: 'item_a', name: 'Item A', createdAt: '2026-03-31T09:20:00.000Z' },
    item_b: { id: 'item_b', name: 'Item B', createdAt: '2026-03-30T13:40:00.000Z' },
  },
  itemReviewsByItemId: {
    item_a: {
      itemId: 'item_a',
      updatedAt: '2026-03-31T10:01:00.000Z',
      rating: 4,
      comment: '轻便、好用，但颜色偏淡。',
    },
  },
  transactions: [
    {
      id: 'txn_001',
      createdAt: '2026-03-31T10:00:00.000Z',
      amountCents: 2590,
      currency: 'CNY',
      necessity: 'need',
      memo: '早餐',
      itemId: 'item_b',
    },
    {
      id: 'txn_002',
      createdAt: '2026-03-31T09:30:00.000Z',
      amountCents: 14900,
      currency: 'CNY',
      necessity: 'want',
      memo: 'Item A',
      itemId: 'item_a',
    },
  ],
  homeRecent: [
    {
      id: 'r_005',
      mode: 'note',
      createdAt: '2026-03-31T10:10:00.000Z',
      title: '碎碎念',
      detail: '今天有点累，但还在稳步推进。',
      mood: '😵‍💫',
      accent: 'baby',
    },
    {
      id: 'r_004',
      mode: 'finance',
      createdAt: '2026-03-31T10:00:00.000Z',
      title: '记账',
      detail: '¥25.90 · 必需 · 早餐',
      accent: 'mint',
    },
    {
      id: 'r_003',
      mode: 'review',
      createdAt: '2026-03-31T09:58:00.000Z',
      title: '点评',
      detail: 'Item A：4/5 · 轻便好用。',
      accent: 'peach',
    },
    {
      id: 'r_002',
      mode: 'save',
      createdAt: '2026-03-30T20:40:00.000Z',
      title: '收藏',
      detail: '把“阅读清单”存进 Vault。',
      accent: 'lavender',
    },
    {
      id: 'r_001',
      mode: 'work',
      createdAt: '2026-03-30T18:10:00.000Z',
      title: '工作',
      detail: '今日总结：推进到 UI 骨架。',
      accent: 'butter',
    },
  ],
}

