import { Coins, Star, MessageCircle, Briefcase, Archive, Clock } from 'lucide-react'
import type { QuickMode } from '../types/domain'

const MODE_CONFIG: Array<{
  mode: QuickMode
  icon: React.ReactNode
  label: string
  color: string
}> = [
  { mode: 'finance', icon: <Coins size={16} />, label: '记账', color: '#CFF3E5' },
  { mode: 'review', icon: <Star size={16} />, label: '点评', color: '#FAD9D2' },
  { mode: 'note', icon: <MessageCircle size={16} />, label: '碎碎念', color: '#D7E8FF' },
  { mode: 'work', icon: <Briefcase size={16} />, label: '工作', color: '#FFF1B8' },
  { mode: 'save', icon: <Archive size={16} />, label: '收藏', color: '#E9D9FF' },
  { mode: 'timeline', icon: <Clock size={16} />, label: '时间轴', color: '#F2DEBD' },
]

interface QuickRecordButtonBarProps {
  onSelect: (mode: QuickMode) => void
}

export function QuickRecordButtonBar({ onSelect }: QuickRecordButtonBarProps) {
  return (
    <div
      className="flex items-center justify-center gap-2 px-4 py-2 bg-base-bg"
      role="toolbar"
      aria-label="快速记录模式选择"
    >
      {MODE_CONFIG.map(({ mode, icon, label, color }) => (
        <button
          key={mode}
          type="button"
          onClick={() => onSelect(mode)}
          aria-label={label}
          title={label}
          className="flex items-center justify-center w-9 h-9 rounded-full border border-base-line text-base-text/60 transition-colors active:opacity-70 hover:border-base-text/30"
          style={{ backgroundColor: color }}
        >
          {icon}
        </button>
      ))}
    </div>
  )
}
