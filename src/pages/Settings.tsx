import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ChevronDown, ChevronUp, Eye, EyeOff, Copy, ClipboardPaste, Check,
  Save, RotateCcw, ArrowRight, ArrowLeft,
} from 'lucide-react'
import { useSettingsStore, type ParseServiceConfig, type TtsServiceConfig } from '../store/settings'
import { IconButton } from '../shared/ui/IconButton'
import {
  DEFAULT_PARSE_TRANSACTION_SYSTEM_PROMPT,
  DEFAULT_PARSE_TRANSACTION_USER_PROMPT_TEMPLATE,
  DEFAULT_PARSE_MEDIA_SYSTEM_PROMPT,
  DEFAULT_PARSE_MEDIA_USER_PROMPT_TEMPLATE,
} from '../../api/_prompt-defaults'

// ===== 折叠卡片组件 =====
function AccordionCard({
  title,
  subtitle,
  expanded,
  onToggle,
  saved,
  onSave,
  children,
}: {
  title: string
  subtitle?: string
  expanded: boolean
  onToggle: () => void
  saved: boolean
  onSave: () => void
  children: React.ReactNode
}) {
  return (
    <div className="border rounded-2xl border-base-line bg-[#F7F5F2] overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center gap-2 px-4 py-3 cursor-pointer select-none"
        onClick={onToggle}
      >
        {/* Expand/collapse */}
        <button
          className="shrink-0 p-0.5 text-base-text/25 hover:text-base-text/60 transition-colors"
          title={expanded ? '收起' : '展开'}
        >
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>

        {/* Title */}
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium text-base-text">{title}</span>
          {subtitle && (
            <span className="ml-2 text-xs text-base-muted font-mono">{subtitle}</span>
          )}
        </div>

        {/* Save button */}
        <button
          onClick={(e) => { e.stopPropagation(); onSave() }}
          className="flex items-center gap-1 text-xs font-bold transition-all shrink-0"
          style={{ color: saved ? '#86C8A8' : '#B4AEE8' }}
        >
          {saved ? <Check size={14} /> : <Save size={14} />}
          {saved ? '已保存' : '保存'}
        </button>
      </div>

      {/* Body */}
      {expanded && (
        <div className="px-5 pb-4 space-y-3">
          {children}
        </div>
      )}
    </div>
  )
}

// ===== Key 输入框（带显示/隐藏、粘贴、复制） =====
function KeyInput({
  value,
  onChange,
  placeholder = 'API Key',
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  const [show, setShow] = useState(false)

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText()
      onChange(text)
    } catch {
      const text = prompt('请输入 API Key:')
      if (text) onChange(text)
    }
  }

  const handleCopy = () => {
    if (value) navigator.clipboard.writeText(value)
  }

  return (
    <div className="relative group/key">
      <input
        className="w-full p-2 pr-20 text-xs bg-white border border-base-line rounded-lg outline-none focus:border-[#B4AEE8]"
        type={show ? 'text' : 'password'}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="off"
      />
      <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
        <button
          type="button"
          className="p-1.5 text-base-text/40 hover:text-[#B4AEE8] transition-colors"
          onClick={() => setShow(!show)}
          title={show ? '隐藏' : '显示'}
        >
          {show ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
        <button
          type="button"
          className="p-1.5 text-base-text/40 hover:text-[#B4AEE8] transition-colors"
          onClick={handlePaste}
          title="粘贴"
        >
          <ClipboardPaste size={14} />
        </button>
        <button
          type="button"
          className="p-1.5 text-base-text/40 hover:text-[#B4AEE8] transition-colors"
          onClick={handleCopy}
          title="复制"
        >
          <Copy size={14} />
        </button>
      </div>
    </div>
  )
}

// ===== 复制到下拉菜单 =====
function CopyToDropdown({
  sourceKey,
  onCopy,
}: {
  sourceKey: string
  onCopy: (targetKey: string) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const targets = sourceKey === 'parseTransactionConfig'
    ? [{ label: '影音解析', key: 'parseMediaConfig' }]
    : [{ label: '记账解析', key: 'parseTransactionConfig' }]

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 text-xs text-base-muted hover:text-[#B4AEE8] transition-colors"
      >
        <Copy size={12} />
        复制到…
      </button>
      {open && (
        <div className="absolute left-0 bottom-full mb-1 bg-white border border-base-line rounded-xl shadow-lg z-10 py-1 min-w-[140px]">
          {targets.map((t) => (
            <button
              key={t.key}
              onClick={() => { onCopy(t.key); setOpen(false) }}
              className="block w-full px-3 py-2 text-xs text-left hover:bg-[#F7F5F2] transition-colors whitespace-nowrap"
            >
              复制到 → {t.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ===== 解析服务配置区域 =====
function ParseServiceSection({
  configKey,
  title,
  subtitle,
  defaultSystemPrompt,
  defaultUserPrompt,
}: {
  configKey: 'parseTransactionConfig' | 'parseMediaConfig'
  title: string
  subtitle: string
  defaultSystemPrompt: string
  defaultUserPrompt: string
}) {
  const { settings, updateSettings, saveToCloud } = useSettingsStore()
  const [expanded, setExpanded] = useState(false)
  const [saved, setSaved] = useState(false)
  const [local, setLocal] = useState<ParseServiceConfig>(settings[configKey])

  // 当 settings 从云端加载后同步本地状态
  useEffect(() => {
    setLocal(settings[configKey])
  }, [settings[configKey]])

  const markSaved = () => {
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleSave = () => {
    updateSettings({ [configKey]: local })
    saveToCloud()
    markSaved()
  }

  const handleResetPrompts = () => {
    setLocal({ ...local, systemPrompt: '', userPrompt: '' })
  }

  const handleCopyFrom = (sourceKey: string) => {
    const source = settings[sourceKey as keyof typeof settings] as ParseServiceConfig
    setLocal({
      ...local,
      url: source.url,
      key: source.key,
      model: source.model,
      // 不复制提示词，因为不同服务的提示词不同
    })
  }

  return (
    <AccordionCard
      title={title}
      subtitle={subtitle}
      expanded={expanded}
      onToggle={() => setExpanded(!expanded)}
      saved={saved}
      onSave={handleSave}
    >
      {/* API URL */}
      <div>
        <label className="text-[10px] text-base-muted uppercase tracking-wider mb-1 block">API URL</label>
        <input
          className="w-full p-2 text-xs bg-white border border-base-line rounded-lg outline-none focus:border-[#B4AEE8]"
          placeholder="留空使用环境变量默认值 (AI_API_URL)"
          value={local.url}
          onChange={(e) => setLocal({ ...local, url: e.target.value })}
          autoComplete="off"
          inputMode="url"
        />
      </div>

      {/* API Key */}
      <div>
        <label className="text-[10px] text-base-muted uppercase tracking-wider mb-1 block">API Key</label>
        <KeyInput
          value={local.key}
          onChange={(v) => setLocal({ ...local, key: v })}
          placeholder="留空使用环境变量中的密钥 (AI_API_KEY)"
        />
      </div>

      {/* Model */}
      <div>
        <label className="text-[10px] text-base-muted uppercase tracking-wider mb-1 block">模型</label>
        <input
          className="w-full p-2 text-xs bg-white border border-base-line rounded-lg outline-none focus:border-[#B4AEE8]"
          placeholder="留空使用默认模型 (AI_MODEL 或 deepseek-chat)"
          value={local.model}
          onChange={(e) => setLocal({ ...local, model: e.target.value })}
          autoComplete="off"
        />
      </div>

      {/* 提示词 */}
      <div className="pt-2 border-t border-base-line">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] text-base-muted uppercase tracking-wider">提示词（留空使用默认）</span>
          <button
            onClick={handleResetPrompts}
            className="flex items-center gap-1 text-xs text-base-muted hover:text-red-400 transition-colors"
          >
            <RotateCcw size={11} />
            重置为默认
          </button>
        </div>

        <div className="space-y-2">
          <div>
            <label className="text-[10px] text-base-muted mb-1 block">System Prompt</label>
            <textarea
              className="w-full h-32 p-2.5 text-xs font-mono bg-white border border-base-line rounded-xl focus:ring-2 focus:ring-[#B4AEE8]/20 focus:border-[#B4AEE8] transition-all resize-y outline-none leading-relaxed"
              placeholder={defaultSystemPrompt.slice(0, 80) + '…'}
              value={local.systemPrompt}
              onChange={(e) => setLocal({ ...local, systemPrompt: e.target.value })}
            />
          </div>
          <div>
            <label className="text-[10px] text-base-muted mb-1 block">User Prompt（用 {'{text}'} 表示用户输入）</label>
            <textarea
              className="w-full h-32 p-2.5 text-xs font-mono bg-white border border-base-line rounded-xl focus:ring-2 focus:ring-[#B4AEE8]/20 focus:border-[#B4AEE8] transition-all resize-y outline-none leading-relaxed"
              placeholder={defaultUserPrompt.slice(0, 80) + '…'}
              value={local.userPrompt}
              onChange={(e) => setLocal({ ...local, userPrompt: e.target.value })}
            />
          </div>
        </div>
      </div>

      {/* 复制到 */}
      <div className="flex items-center gap-2 pt-1">
        <CopyToDropdown
          sourceKey={configKey}
          onCopy={handleCopyFrom}
        />
      </div>
    </AccordionCard>
  )
}

// ===== TTS 配置区域 =====
function TtsServiceSection() {
  const { settings, updateSettings, saveToCloud } = useSettingsStore()
  const [expanded, setExpanded] = useState(false)
  const [saved, setSaved] = useState(false)
  const [local, setLocal] = useState<TtsServiceConfig>(settings.ttsConfig)

  useEffect(() => {
    setLocal(settings.ttsConfig)
  }, [settings.ttsConfig])

  const markSaved = () => {
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleSave = () => {
    updateSettings({ ttsConfig: local })
    saveToCloud()
    markSaved()
  }

  const handleReset = () => {
    setLocal({
      url: '',
      key: '',
      model: 'speech-2.8-hd',
      voiceId: 'xmz-minimax-voice',
      speed: 1.0,
    })
  }

  return (
    <AccordionCard
      title="TTS 语音合成"
      subtitle="MiniMax"
      expanded={expanded}
      onToggle={() => setExpanded(!expanded)}
      saved={saved}
      onSave={handleSave}
    >
      {/* API URL */}
      <div>
        <label className="text-[10px] text-base-muted uppercase tracking-wider mb-1 block">API URL</label>
        <input
          className="w-full p-2 text-xs bg-white border border-base-line rounded-lg outline-none focus:border-[#B4AEE8]"
          placeholder="留空使用 MiniMax 默认端点"
          value={local.url}
          onChange={(e) => setLocal({ ...local, url: e.target.value })}
          autoComplete="off"
          inputMode="url"
        />
      </div>

      {/* API Key */}
      <div>
        <label className="text-[10px] text-base-muted uppercase tracking-wider mb-1 block">API Key</label>
        <KeyInput
          value={local.key}
          onChange={(v) => setLocal({ ...local, key: v })}
          placeholder="留空使用 MINIMAX_API_KEY 环境变量"
        />
      </div>

      {/* Model */}
      <div>
        <label className="text-[10px] text-base-muted uppercase tracking-wider mb-1 block">模型</label>
        <input
          className="w-full p-2 text-xs bg-white border border-base-line rounded-lg outline-none focus:border-[#B4AEE8]"
          placeholder="speech-2.8-hd"
          value={local.model}
          onChange={(e) => setLocal({ ...local, model: e.target.value })}
          autoComplete="off"
        />
      </div>

      {/* Voice ID */}
      <div>
        <label className="text-[10px] text-base-muted uppercase tracking-wider mb-1 block">音色 ID</label>
        <input
          className="w-full p-2 text-xs bg-white border border-base-line rounded-lg outline-none focus:border-[#B4AEE8]"
          placeholder="xmz-minimax-voice"
          value={local.voiceId}
          onChange={(e) => setLocal({ ...local, voiceId: e.target.value })}
          autoComplete="off"
        />
      </div>

      {/* Speed slider */}
      <div>
        <label className="text-[10px] text-base-muted uppercase tracking-wider mb-1 block">语速</label>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min="0.5"
            max="5.0"
            step="0.1"
            value={local.speed}
            onChange={(e) => setLocal({ ...local, speed: parseFloat(e.target.value) })}
            className="flex-1 h-2 rounded-full appearance-none bg-base-line accent-[#B4AEE8] outline-none"
            style={{
              background: `linear-gradient(to right, #B4AEE8 0%, #B4AEE8 ${((local.speed - 0.5) / 4.5) * 100}%, #E7E5E4 ${((local.speed - 0.5) / 4.5) * 100}%, #E7E5E4 100%)`,
            }}
          />
          <span className="text-xs font-mono text-base-text w-10 text-right tabular-nums">
            {local.speed.toFixed(1)}x
          </span>
        </div>
        <div className="flex justify-between mt-0.5">
          <span className="text-[10px] text-base-muted">0.5x</span>
          <span className="text-[10px] text-base-muted">5.0x</span>
        </div>
      </div>

      {/* Reset */}
      <div className="pt-1">
        <button
          onClick={handleReset}
          className="flex items-center gap-1 text-xs text-base-muted hover:text-red-400 transition-colors"
        >
          <RotateCcw size={11} />
          重置为默认
        </button>
      </div>
    </AccordionCard>
  )
}

// ===== 主页面 =====
export default function Settings() {
  const { settings, isCloudLoaded } = useSettingsStore()
  const navigate = useNavigate()

  const apiConfigs = Array.isArray(settings.apiConfigs) ? settings.apiConfigs : []
  const enabledCount = apiConfigs.filter((c) => c.enabled).length
  const modelSummary = apiConfigs
    .map((c) => c.model)
    .filter(Boolean)
    .join(', ') || '（使用默认）'

  return (
    <div className="mx-auto min-h-dvh max-w-[480px] bg-base-bg px-4 pb-8 pt-[calc(env(safe-area-inset-top)+0.75rem)] text-base-text space-y-4">
      {/* 页头 */}
      <div className="relative flex min-h-10 items-center justify-center">
        <div className="absolute left-0 top-1/2 -translate-y-1/2">
          <IconButton label="返回主页" onClick={() => navigate('/')} icon={<ArrowLeft size={18} />} />
        </div>
        <h1 className="text-sm font-medium text-base-text">AI 设置</h1>
        {!isCloudLoaded && (
          <span className="absolute right-0 top-1/2 -translate-y-1/2 text-[10px] text-[#8D6E00] bg-[#FFF8E1] px-2 py-0.5 rounded-full">
            同步中…
          </span>
        )}
      </div>

      {/* 云端未加载提示 */}
      {!isCloudLoaded && (
        <div className="p-3 bg-[#FFF8E1] border border-[#FFE082] rounded-xl text-xs text-[#8D6E00] flex items-center gap-2">
          <span className="inline-block w-3 h-3 border-2 border-[#8D6E00] border-t-transparent rounded-full animate-spin" />
          正在从云端加载设置，请稍候再保存…
        </div>
      )}

      {/* 记账解析 */}
      <section className="space-y-3">
        <h2 className="text-sm font-bold text-base-text/70 uppercase tracking-wider">文本解析</h2>
        <ParseServiceSection
          configKey="parseTransactionConfig"
          title="记账解析"
          subtitle="parse-transaction"
          defaultSystemPrompt={DEFAULT_PARSE_TRANSACTION_SYSTEM_PROMPT}
          defaultUserPrompt={DEFAULT_PARSE_TRANSACTION_USER_PROMPT_TEMPLATE}
        />
        <ParseServiceSection
          configKey="parseMediaConfig"
          title="影音解析"
          subtitle="parse-media"
          defaultSystemPrompt={DEFAULT_PARSE_MEDIA_SYSTEM_PROMPT}
          defaultUserPrompt={DEFAULT_PARSE_MEDIA_USER_PROMPT_TEMPLATE}
        />
      </section>

      {/* TTS */}
      <section className="space-y-3">
        <h2 className="text-sm font-bold text-base-text/70 uppercase tracking-wider">语音合成</h2>
        <TtsServiceSection />
      </section>

      {/* 对话模型 */}
      <section className="space-y-3">
        <h2 className="text-sm font-bold text-base-text/70 uppercase tracking-wider">对话模型</h2>
        <div className="border rounded-2xl border-base-line bg-[#F7F5F2] p-4 space-y-3">
          <p className="text-sm text-base-muted">
            对话 AI 的 API 配置、角色设定 Prompt 等功能在 Chat 页面设置。此处仅展示当前配置摘要。
          </p>
          <div className="text-xs text-base-muted space-y-1 bg-white rounded-xl p-3 border border-base-line">
            <div className="flex justify-between">
              <span>已启用 API</span>
              <span className="font-medium text-base-text">{enabledCount} 个</span>
            </div>
            <div className="flex justify-between">
              <span>当前模型</span>
              <span className="font-medium text-base-text truncate max-w-[200px]">{modelSummary}</span>
            </div>
          </div>
          <button
            onClick={() => navigate('/chat')}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-[#B4AEE8] hover:underline transition-colors"
          >
            前往 Chat 页面设置
            <ArrowRight size={12} />
          </button>
        </div>
      </section>

      {/* 底部安全区 */}
      <div className="h-[env(safe-area-inset-bottom)]" />
    </div>
  )
}
