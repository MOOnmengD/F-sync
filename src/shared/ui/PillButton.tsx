type Props = {
  label: string
  active?: boolean
  onClick?: () => void
  accent: 'peach' | 'mint' | 'baby' | 'butter' | 'lavender' | 'timeline'
}

const accentHex: Record<Props['accent'], string> = {
  peach: '#FAD9D2',
  mint: '#CFF3E5',
  baby: '#D7E8FF',
  butter: '#FFF1B8',
  lavender: '#E9D9FF',
  timeline: '#F2DEBD',
}

export function PillButton({ label, active, onClick, accent }: Props) {
  const base =
    'rounded-full px-4 py-2 text-sm tracking-wide border border-base-line active:opacity-70'
  const idleCls = 'bg-base-surface text-base-muted'

  return (
    <button
      type="button"
      onClick={onClick}
      className={`${base} ${active ? 'text-base-text' : idleCls}`}
      style={active ? { backgroundColor: accentHex[accent] } : undefined}
    >
      {label}
    </button>
  )
}
