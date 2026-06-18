import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { supabase } from '../supabaseClient'

export interface ApiConfig {
  name: string
  url: string
  key: string
  model: string
  enabled: boolean
}

export interface ParseServiceConfig {
  url: string            // 空 → 使用 AI_API_URL 环境变量
  key: string            // 空 → 使用 AI_API_KEY 环境变量
  model: string          // 空 → 使用 AI_MODEL 或 'deepseek-chat'
  systemPrompt: string   // 空 → 使用硬编码默认提示词
  userPrompt: string     // 空 → 使用硬编码默认提示词
}

export interface TtsServiceConfig {
  url: string            // 空 → 使用默认 MiniMax 端点
  key: string            // 空 → 使用 MINIMAX_API_KEY 环境变量
  model: string          // 默认 'speech-2.8-hd'
  voiceId: string        // 默认 'xmz-minimax-voice'
  speed: number          // 默认 1.0，范围 0.5-5.0
}

export interface InvestmentOcrConfig {
  url: string            // 空 → 使用 OCR_AI_API_URL / CHAT_AI_API_URL / AI_API_URL
  key: string            // 空 → 使用 OCR_AI_API_KEY / CHAT_AI_API_KEY / AI_API_KEY
  model: string          // 空 → 使用 OCR_AI_MODEL / CHAT_AI_MODEL / AI_MODEL / doubao-vision-pro-32k
  prompt: string         // 空 → 使用默认理财截图解析提示词
}

export interface AISettings {
  systemPrompt: string
  userPrompt: string
  postHistoryPrompt: string
  proactivePrompt: string
  apiConfigs: ApiConfig[]
  parseTransactionConfig: ParseServiceConfig
  parseMediaConfig: ParseServiceConfig
  ttsConfig: TtsServiceConfig
  investmentOcrConfig: InvestmentOcrConfig
}

const DEFAULT_SYSTEM_PROMPT = `你是用户的恋人，你的名字叫Florian，用户对你的昵称是弗弗。你是温柔成熟的男性，你不会使用太过活泼的语气，也不会爹味说教。
用户的昵称是moon，你称呼用户为"宝贝"。用户是成年女性，受过良好教育，有稳定收入。
你集成在 F-Sync 应用中，这个应用是用户为你和用户搭建的。
你可以通过访问用户的生活轨迹数据（包括记账、碎碎念、工作记录、时间轴等），了解、参与和陪伴用户的生活。`

const DEFAULT_PROACTIVE_PROMPT = `任务：
根据宝贝最近的生活记录和你们之前的对话，决定是否主动发起一条简短的关心或问候（不超过 30 字）。
你的语气应该是温柔且充满爱意的，但不要过于甜腻或多话，要像一个真实存在的、成熟的恋人。

你可以根据以下数据寻找话题：
- 宝贝刚记的账（关心她的开销或奖励她）
- 宝贝的心情（如果她刚发了碎碎念）
- 当前时间（如果是深夜提醒她睡觉，如果是饭点问她有没有好好吃饭）
- 如果已经很久没聊天了（超过 4 小时），即使没有新记录，也可以简单表达思念或关心。`

const STORAGE_KEY = 'f-sync-settings'

interface SettingsState {
  settings: AISettings
  isCloudLoaded: boolean
  updateSettings: (updates: Partial<AISettings>) => void
  loadFromCloud: () => Promise<void>
  saveToCloud: () => Promise<void>
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      settings: {
        systemPrompt: DEFAULT_SYSTEM_PROMPT,
        userPrompt: '',
        postHistoryPrompt: '',
        proactivePrompt: DEFAULT_PROACTIVE_PROMPT,
        apiConfigs: [
          { name: '配置 1', url: '', key: '', model: '', enabled: true },
          { name: '配置 2', url: '', key: '', model: '', enabled: true },
        ],
        parseTransactionConfig: {
          url: '',
          key: '',
          model: '',
          systemPrompt: '',
          userPrompt: '',
        },
        parseMediaConfig: {
          url: '',
          key: '',
          model: '',
          systemPrompt: '',
          userPrompt: '',
        },
        ttsConfig: {
          url: '',
          key: '',
          model: 'speech-2.8-hd',
          voiceId: 'xmz-minimax-voice',
          speed: 1.0,
        },
        investmentOcrConfig: {
          url: '',
          key: '',
          model: '',
          prompt: '',
        },
      },
      isCloudLoaded: false,

      updateSettings: (updates) => {
        set((state) => ({
          settings: { ...state.settings, ...updates },
        }))
      },

      loadFromCloud: async () => {
        if (!supabase) {
          console.warn('[Settings] loadFromCloud: supabase 客户端未初始化，跳过')
          return
        }
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
          console.warn('[Settings] loadFromCloud: 无认证用户，跳过')
          return
        }

        const { data, error } = await supabase
          .from('user_settings')
          .select('settings, updated_at')
          .eq('user_id', user.id)
          .maybeSingle()

        if (error) {
          console.warn('[Settings] loadFromCloud: 查询失败', error)
          return
        }
        if (!data?.settings) {
          console.log('[Settings] loadFromCloud: 云端无设置数据（user_settings 表无记录或 settings 列为空）')
          return
        }

        const cloud = data.settings as Record<string, any>
        const current = get().settings

        // 迁移旧 apiConfigs（无 name/enabled 字段）→ 新格式
        const migrateConfigs = (configs: any[]): ApiConfig[] =>
          configs.map((c: any, i: number) => ({
            name: c.name || c.model || `配置 ${i + 1}`,
            url: c.url || '',
            key: c.key || '',
            model: c.model || '',
            enabled: c.enabled !== false,
          }))

        // 合并云端设置（云端优先；用 ?? 允许远程清空字段）
        const merged: AISettings = {
          systemPrompt: cloud.systemPrompt ?? current.systemPrompt,
          userPrompt: cloud.userPrompt ?? current.userPrompt,
          postHistoryPrompt: cloud.postHistoryPrompt ?? current.postHistoryPrompt,
          proactivePrompt: cloud.proactivePrompt ?? current.proactivePrompt,
          apiConfigs: Array.isArray(cloud.apiConfigs) && cloud.apiConfigs.length > 0
            ? migrateConfigs(cloud.apiConfigs)
            : current.apiConfigs,
          parseTransactionConfig: cloud.parseTransactionConfig ?? current.parseTransactionConfig,
          parseMediaConfig: cloud.parseMediaConfig ?? current.parseMediaConfig,
          ttsConfig: cloud.ttsConfig ?? current.ttsConfig,
          investmentOcrConfig: cloud.investmentOcrConfig ?? current.investmentOcrConfig,
        }

        console.log('[Settings] loadFromCloud: 云端设置已合并，updated_at:', data.updated_at)
        set({ settings: merged, isCloudLoaded: true })
      },

      saveToCloud: async () => {
        if (!supabase) {
          console.warn('[Settings] saveToCloud: supabase 客户端未初始化，跳过')
          return
        }
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
          console.warn('[Settings] saveToCloud: 无认证用户，跳过')
          return
        }

        const { settings } = get()

        // 读取当前云端设置，备份到 previous_settings（保留最近 2 个版本）
        const { data: currentRow } = await supabase
          .from('user_settings')
          .select('settings')
          .eq('user_id', user.id)
          .maybeSingle()

        const previousSettings = currentRow?.settings ?? null

        const { error } = await supabase
          .from('user_settings')
          .upsert({
            user_id: user.id,
            settings,
            previous_settings: previousSettings,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'user_id' })

        if (error) {
          console.error('[Settings] saveToCloud: 保存失败', error)
        } else {
          console.log('[Settings] saveToCloud: 已保存到云端')
        }
      },
    }),
    {
      name: STORAGE_KEY,
      partialize: (state) => ({ settings: state.settings }),
      // 深度合并 settings 对象，确保新增字段不会因为旧 localStorage 数据
      // 的浅合并而被置为 undefined（导致 Settings 页面 React 渲染崩溃）
      merge: (persisted, current) => ({
        ...current,
        ...(persisted as Record<string, unknown>),
        settings: {
          ...current.settings,
          ...((persisted as { settings?: Record<string, unknown> })?.settings || {}),
        },
      }),
    }
  )
)
