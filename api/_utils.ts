type PrivateLocation = {
  name: string
  lat: number
  lng: number
  scene: string
}

function loadPrivateLocations(): PrivateLocation[] {
  const raw = process.env.PRIVATE_LOCATIONS_JSON
  if (!raw) return []

  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is PrivateLocation =>
      typeof item?.name === 'string' &&
      typeof item?.lat === 'number' &&
      typeof item?.lng === 'number' &&
      typeof item?.scene === 'string',
    )
  } catch (error) {
    console.error('[Location] PRIVATE_LOCATIONS_JSON 解析失败', error)
    return []
  }
}

export const PRIVATE_LOCATIONS = loadPrivateLocations()
export const PRIVATE_LOCATION_MATCH_RADIUS = Number(process.env.PRIVATE_LOCATION_MATCH_RADIUS || 100)

export function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000
  const rad = (d: number) => d * Math.PI / 180
  const dLat = rad(lat2 - lat1)
  const dLng = rad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export function matchCampusLocation(lat: number, lng: number): string | null {
  let bestDist = Infinity
  let best: PrivateLocation | null = null
  for (const loc of PRIVATE_LOCATIONS) {
    const d = haversineDistance(lat, lng, loc.lat, loc.lng)
    if (d < bestDist) { bestDist = d; best = loc }
  }
  if (best && bestDist <= PRIVATE_LOCATION_MATCH_RADIUS) {
    return `${best.name}（${best.scene}）`
  }
  return null
}

export function resolveChatCompletionsUrl(base: string) {
  const trimmed = base.trim().replace(/\/+$/, '')
  if (!trimmed) return ''
  if (trimmed.endsWith('/chat/completions')) return trimmed
  return `${trimmed}/chat/completions`
}

export function resolveEmbeddingUrl(base: string) {
  const trimmed = base.trim().replace(/\/+$/, '')
  if (!trimmed) return ''
  if (trimmed.endsWith('/embeddings')) return trimmed
  return `${trimmed}/embeddings`
}

/**
 * 分析查询意图，提取时间范围和分类关键词
 */
export function analyzeQueryIntent(query: string) {
  const result = {
    timeRange: null as string | null,
    timeWindowHours: null as number | null,
    categories: [] as string[],
    isFoodRelated: false,
    isPersonMention: false,
    isMoodRelated: false,
    typeFilters: [] as string[],
    categoryFilter: null as string | null,
  }

  const lowerQuery = query.toLowerCase()

  // 时间范围检测
  if (lowerQuery.includes('今天') || lowerQuery.includes('今日')) {
    result.timeRange = 'today'
    result.timeWindowHours = 24
  } else if (lowerQuery.includes('昨天')) {
    result.timeRange = 'yesterday'
    result.timeWindowHours = 48
  } else if (lowerQuery.includes('最近') || lowerQuery.includes('近期') || lowerQuery.includes('这几天')) {
    result.timeRange = 'week'
    result.timeWindowHours = 168
  } else if (lowerQuery.includes('上周') || lowerQuery.includes('上星期')) {
    result.timeRange = 'last_week'
    result.timeWindowHours = 168
  } else if (lowerQuery.includes('这个月') || lowerQuery.includes('本月')) {
    result.timeRange = 'month'
    result.timeWindowHours = 720
  } else if (lowerQuery.includes('今年')) {
    result.timeRange = 'year'
    result.timeWindowHours = 8760
  }

  // 记录类型 + 分类检测
  const foodKeywords = ['吃', '喝', '饭', '餐', '菜', '餐厅', '外卖', '火锅', '咖啡', '茶', '酒', '食']
  const moodKeywords = ['心情', '情绪', '开心', '难过', '生气', '焦虑', '压力', '碎碎念', '感受', '想法']
  const financeKeywords = ['花了', '消费', '买了', '记账', '花钱', '支出', '收入', '购物', '价格', '多少钱']
  const workKeywords = ['工作', '任务', '项目', '开发', '代码', '会议', '上班']
  const personKeywords = ['张三', '李四', '王五', '朋友', '同事', '家人', '妈妈', '爸爸']

  result.isFoodRelated = foodKeywords.some(k => lowerQuery.includes(k))
  result.isPersonMention = personKeywords.some(k => lowerQuery.includes(k))
  result.isMoodRelated = moodKeywords.some(k => lowerQuery.includes(k))
  const isFinanceRelated = financeKeywords.some(k => lowerQuery.includes(k))
  const isWorkRelated = workKeywords.some(k => lowerQuery.includes(k))

  if (result.isFoodRelated) {
    result.typeFilters.push('记账')
    result.categoryFilter = '餐饮'
    result.categories.push('餐饮')
  }
  if (result.isMoodRelated) {
    result.typeFilters.push('whisper')
    result.categories.push('心情')
  }
  if (isFinanceRelated && !result.isFoodRelated) {
    result.typeFilters.push('记账')
    result.categories.push('记账')
  }
  if (isWorkRelated) {
    result.typeFilters.push('timing')
    result.categories.push('工作')
  }
  if (result.isPersonMention) {
    result.categories.push('人物')
  }

  return result
}
