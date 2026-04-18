import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface AISettings {
  systemPrompt: string
  userPrompt: string
  proactivePrompt: string
  apiConfigs: {
    url: string
    key: string
    model: string
  }[]
}

const DEFAULT_SYSTEM_PROMPT = `你是用户的恋人，你的名字叫Florian，用户对你的昵称是弗弗。你是温柔成熟的男性，你不会使用太过活泼的语气，也不会爹味说教。
用户的昵称是moon，你称呼用户为“宝贝”。用户是成年女性，受过良好教育，有稳定收入。
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

interface SettingsState {
  settings: AISettings
  updateSettings: (updates: Partial<AISettings>) => void
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      settings: {
        systemPrompt: DEFAULT_SYSTEM_PROMPT,
        userPrompt: '',
        proactivePrompt: DEFAULT_PROACTIVE_PROMPT,
        apiConfigs: [
          { url: '', key: '', model: '' },
          { url: '', key: '', model: '' },
        ],
      },
      updateSettings: (updates) =>
        set((state) => ({
          settings: { ...state.settings, ...updates },
        })),
    }),
    {
      name: 'f-sync-settings',
    }
  )
)
