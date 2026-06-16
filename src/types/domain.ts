export type ISODateTime = string

export type ItemId = string
export type TransactionId = string
export type NoteId = string

export type Item = {
  id: ItemId
  name: string
  createdAt: ISODateTime
}

export type Transaction = {
  id: TransactionId
  createdAt: ISODateTime
  amountCents: number
  currency: 'CNY'
  necessity: 'need' | 'want'
  memo: string
  itemId?: ItemId
}

export type ItemReview = {
  itemId: ItemId
  updatedAt: ISODateTime
  rating: 1 | 2 | 3 | 4 | 5
  comment: string
}

export type Mood = string

export type QuickMode = 'finance' | 'review' | 'note' | 'work' | 'save' | 'timeline' | 'invest'

export type HomeRecord =
  | {
      id: string
      mode: 'finance'
      createdAt: ISODateTime
      title: string
      detail: string
      accent: 'peach' | 'mint' | 'baby' | 'butter' | 'lavender'
    }
  | {
      id: string
      mode: 'note'
      createdAt: ISODateTime
      title: string
      detail: string
      mood: Mood
      accent: 'peach' | 'mint' | 'baby' | 'butter' | 'lavender'
    }
  | {
      id: string
      mode: 'review' | 'work' | 'save'
      createdAt: ISODateTime
      title: string
      detail: string
      accent: 'peach' | 'mint' | 'baby' | 'butter' | 'lavender'
    }

export type MediaType = 'book' | 'movie'
export type MediaStatus = 'want_to_consume' | 'consuming' | 'consumed'

export type MediaItem = {
  id: string
  userId: string
  title: string
  mediaType: MediaType
  status: MediaStatus
  review: string | null
  createdAt: string
  updatedAt: string
}

export type MockDb = {
  itemsById: Record<ItemId, Item>
  itemReviewsByItemId: Record<ItemId, ItemReview>
  transactions: Transaction[]
  homeRecent: HomeRecord[]
}
