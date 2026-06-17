/**
 * /api/text-to-speech
 *
 * 代理 MiniMax 同步 TTS API（speech-2.8-hd），将 AI 回复文本转为语音。
 * 前端传入原始 Markdown 文本，本端点负责清理 Markdown 后调用 TTS。
 */

// Markdown 语法标记的正则模式
const MARKDOWN_PATTERNS: Array<[RegExp, string | ((m: string, g1: string) => string)]> = [
  // 代码块（保留内部内容，去除围栏标记）
  [/```[\s\S]*?```/g, (m: string) => {
    const inner = m.replace(/^```\w*\n?/gm, '').replace(/```\n?$/gm, '')
    return inner.trim() ? inner.trim() + '\n' : ''
  }],
  // 图片（完全移除）
  [/!\[.*?\]\(.*?\)/g, ''],
  // 链接 [text](url) → text
  [/\[([^\]]*?)\]\([^)]*?\)/g, '$1'],
  // 粗体（先处理，避免与斜体冲突）
  [/\*\*(.+?)\*\*/g, '$1'],
  [/__(.+?)__/g, '$1'],
  // 斜体
  [/\*(.+?)\*/g, '$1'],
  [/_([^_\n]+?)_/g, '$1'],
  // 删除线
  [/~~(.+?)~~/g, '$1'],
  // 行内代码
  [/`([^`\n]+?)`/g, '$1'],
  // 标题
  [/^#{1,6}\s+/gm, ''],
  // 引用
  [/^>\s?/gm, ''],
  // 无序列表
  [/^[\t ]*[-*+]\s+/gm, ''],
  // 有序列表
  [/^[\t ]*\d+\.\s+/gm, ''],
  // 水平线
  [/^[-*_]{3,}\s*$/gm, ''],
  // HTML 标签
  [/<[^>]*>/g, ''],
]

function stripMarkdown(text: string): string {
  let result = text

  for (const [pattern, replacement] of MARKDOWN_PATTERNS) {
    result = result.replace(pattern, replacement as string)
  }

  // 压缩多余空行：3+ 换行 → 2 换行
  result = result.replace(/\n{3,}/g, '\n\n')
  // 去除首尾空白
  result = result.trim()

  return result
}

const MAX_CHARS = 10000
const TTS_ENDPOINT = 'https://api.minimax.chat/v1/t2a_v2'

interface TTSResponse {
  audioDataUrl: string
}

export default async function handler(req: any, res: any) {
  // 1. 仅接受 POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // 2. 校验输入
  const { text, url, key, model, voiceId, speed } = req.body || {}
  if (!text || typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'Missing or empty text' })
  }

  // 3. 文本预处理
  let cleanText = stripMarkdown(text)
  if (cleanText.length > MAX_CHARS) {
    cleanText = cleanText.slice(0, MAX_CHARS)
  }

  // 4. 解析参数：body 优先 → 硬编码默认值
  const ttsEndpoint = (typeof url === 'string' && url.trim())
    ? url.trim()
    : TTS_ENDPOINT
  const apiKey = (typeof key === 'string' && key.trim())
    ? key.trim()
    : process.env.MINIMAX_API_KEY
  if (!apiKey) {
    console.error('[TTS] MINIMAX_API_KEY not configured')
    return res.status(500).json({ error: 'Server configuration error' })
  }
  const ttsModel = (typeof model === 'string' && model.trim())
    ? model.trim()
    : 'speech-2.8-hd'
  const voiceIdValue = (typeof voiceId === 'string' && voiceId.trim())
    ? voiceId.trim()
    : 'xmz-minimax-voice'
  const speedValue = (typeof speed === 'number' && speed > 0 && speed <= 5)
    ? speed
    : 1.0

  // 5. 调用 MiniMax 同步 TTS API
  let ttsResponse: Response
  try {
    ttsResponse = await fetch(ttsEndpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: ttsModel,
        text: cleanText,
        voice_setting: {
          voice_id: voiceIdValue,
          speed: speedValue,
        },
        output_format: 'hex',
        audio_setting: {
          format: 'mp3',
          audio_sample_rate: 32000,
          bitrate: 128000,
          channel: 2,
        },
      }),
    })
  } catch (err: any) {
    console.error('[TTS] Fetch error:', err?.message || err)
    return res.status(500).json({ error: 'TTS service unavailable' })
  }

  if (!ttsResponse.ok) {
    const errorText = await ttsResponse.text().catch(() => '')
    console.error(`[TTS] MiniMax returned ${ttsResponse.status}: ${errorText.slice(0, 300)}`)
    return res.status(500).json({ error: `TTS failed (${ttsResponse.status})` })
  }

  // 6. 处理响应：可能是 JSON（含 base64）或直接是二进制
  const contentType = ttsResponse.headers.get('content-type') || ''
  let audioBase64: string

  if (contentType.includes('application/json')) {
    const json = await ttsResponse.json()
    // MiniMax 返回 { data: { audio: "<hex>" } }，audio 为 hex 编码的音频数据
    const hexAudio: string = json.data?.audio || json.audio || ''
    if (!hexAudio || typeof hexAudio !== 'string' || hexAudio.length < 10) {
      console.error('[TTS] Unexpected JSON response:', JSON.stringify(json).slice(0, 300))
      return res.status(500).json({ error: 'Unexpected TTS response format' })
    }
    // 将 hex 编码转换为 base64
    audioBase64 = Buffer.from(hexAudio, 'hex').toString('base64')
  } else {
    // 二进制音频数据
    const arrayBuffer = await ttsResponse.arrayBuffer()
    audioBase64 = Buffer.from(arrayBuffer).toString('base64')
  }

  const audioDataUrl = `data:audio/mp3;base64,${audioBase64}`

  return res.status(200).json({ audioDataUrl } satisfies TTSResponse)
}
