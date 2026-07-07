import { DEFAULT_CHAT_VISION_PROMPT } from './_prompt-defaults.js'
import { resolveChatCompletionsUrl } from './_utils.js'

type ApiConfig = {
  url: string
  key: string
  model: string
  enabled?: boolean
  name?: string
}

type ChatImageMode = 'direct' | 'vision_summary'

type ChatVisionConfigResolved = {
  url: string
  key: string
  model: string
  prompt: string
}

export type ChatVisionResult = {
  messageId?: string
  messageCreatedAt?: number | string
  model: string
  summary: string
}

const MAX_IMAGE_SUMMARY_CHARS = 3000

function getChatImageMode(settings: any): ChatImageMode {
  return settings?.chatVisionConfig?.mode === 'vision_summary'
    ? 'vision_summary'
    : 'direct'
}

function firstAvailableApiConfig(apiConfigs: ApiConfig[]): ApiConfig | undefined {
  return apiConfigs.find((config) => config?.url && config?.key)
}

function resolveChatVisionConfig(params: {
  settings: any
  apiConfigs: ApiConfig[]
}): ChatVisionConfigResolved {
  const { settings, apiConfigs } = params
  const config = settings?.chatVisionConfig || {}
  const fallbackConfig = firstAvailableApiConfig(apiConfigs)

  const url =
    (typeof config.url === 'string' && config.url.trim()) ||
    process.env.CHAT_VISION_AI_API_URL ||
    fallbackConfig?.url ||
    ''
  const key =
    (typeof config.key === 'string' && config.key.trim()) ||
    process.env.CHAT_VISION_AI_API_KEY ||
    fallbackConfig?.key ||
    ''
  const model =
    (typeof config.model === 'string' && config.model.trim()) ||
    process.env.CHAT_VISION_AI_MODEL ||
    ''
  const prompt =
    (typeof config.prompt === 'string' && config.prompt.trim()) ||
    DEFAULT_CHAT_VISION_PROMPT

  if (!url || !key) {
    throw new Error('聊天识图模型未配置 API URL/Key，请在 Chat 设置中填写，或配置 CHAT_VISION_AI_API_URL / CHAT_VISION_AI_API_KEY')
  }
  if (!model) {
    throw new Error('聊天识图模型未配置模型名，请填写视觉模型（例如 glm-4.6v），或配置 CHAT_VISION_AI_MODEL')
  }

  return { url, key, model, prompt }
}

function normalizeMessageContent(content: any): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => {
      if (typeof part === 'string') return part
      if (part?.type === 'text' && typeof part.text === 'string') return part.text
      return ''
    })
    .filter(Boolean)
    .join('\n')
}

function normalizeAssistantContent(content: any): string {
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => {
      if (typeof part === 'string') return part
      if (typeof part?.text === 'string') return part.text
      return ''
    })
    .filter(Boolean)
    .join('\n')
    .trim()
}

function trimSummary(summary: string): string {
  const text = summary.trim()
  if (text.length <= MAX_IMAGE_SUMMARY_CHARS) return text
  return `${text.slice(0, MAX_IMAGE_SUMMARY_CHARS)}\n（图片理解结果过长，已截断）`
}

function buildVisionPrompt(basePrompt: string, userText: string, imageCount: number): string {
  const parts = [
    basePrompt.trim(),
    '',
    `本次共有 ${imageCount} 张图片。`,
  ]
  if (userText.trim()) {
    parts.push('', `用户随图片发送的文字：${userText.trim()}`)
  }
  return parts.join('\n')
}

function appendImageSummary(content: string, summary: string): string {
  const block = [
    '[图片理解结果]',
    summary.trim(),
    '以上结果由独立视觉模型生成，可能存在误读；回答时请结合用户文字，并在必要时保留不确定性。',
  ].join('\n')
  return content.trim() ? `${content.trim()}\n\n${block}` : block
}

async function describeChatImages(params: {
  config: ChatVisionConfigResolved
  userText: string
  images: string[]
}): Promise<string> {
  const { config, userText, images } = params
  const validImages = images.filter((url) => typeof url === 'string' && url.startsWith('data:image/'))
  if (validImages.length === 0) {
    throw new Error('聊天识图失败：未找到有效的图片 data URL')
  }

  const endpoint = resolveChatCompletionsUrl(config.url)
  const content = [
    { type: 'text', text: buildVisionPrompt(config.prompt, userText, validImages.length) },
    ...validImages.map((url) => ({ type: 'image_url', image_url: { url } })),
  ]

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.key}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages: [{ role: 'user', content }],
      temperature: 0.1,
      max_tokens: 2048,
      stream: false,
    }),
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`聊天识图模型调用失败：${response.status}${detail ? ` ${detail.slice(0, 180)}` : ''}`)
  }

  const data = await response.json()
  const summary = normalizeAssistantContent(data?.choices?.[0]?.message?.content)
  if (!summary) {
    throw new Error('聊天识图模型返回为空，无法生成图片理解结果')
  }

  return trimSummary(summary)
}

export async function prepareChatVisionMessages(params: {
  messages: any[]
  settings: any
  apiConfigs: ApiConfig[]
}): Promise<{
  messages: any[]
  imageUnderstanding: ChatVisionResult[]
}> {
  const { messages, settings, apiConfigs } = params
  if (getChatImageMode(settings) !== 'vision_summary') {
    return { messages, imageUnderstanding: [] }
  }

  const imageUnderstanding: ChatVisionResult[] = []
  let resolvedConfig: ChatVisionConfigResolved | null = null

  const nextMessages = []
  for (const message of messages) {
    const images = Array.isArray(message?.images) ? message.images : []
    const cachedSummary =
      typeof message?.imageSummary === 'string' && message.imageSummary.trim()
        ? trimSummary(message.imageSummary)
        : ''

    if (message?.role !== 'user' || (images.length === 0 && !cachedSummary)) {
      nextMessages.push(message)
      continue
    }

    let summary = cachedSummary
    let model = typeof message?.imageSummaryModel === 'string' ? message.imageSummaryModel : ''

    if (!summary && images.length > 0) {
      if (!resolvedConfig) {
        resolvedConfig = resolveChatVisionConfig({ settings, apiConfigs })
      }
      summary = await describeChatImages({
        config: resolvedConfig,
        userText: normalizeMessageContent(message.content),
        images,
      })
      model = resolvedConfig.model
      imageUnderstanding.push({
        messageId: typeof message.id === 'string' ? message.id : undefined,
        messageCreatedAt: message.createdAt,
        model,
        summary,
      })
    }

    nextMessages.push({
      ...message,
      content: appendImageSummary(normalizeMessageContent(message.content), summary),
      images: undefined,
      imageSummary: summary,
      imageSummaryModel: model,
    })
  }

  return { messages: nextMessages, imageUnderstanding }
}
