type Props = {
  value: 'need' | 'want'
  onChange: (v: 'need' | 'want') => void
}

export function SegmentToggle({ value, onChange }: Props) {
  return (
    <div className="inline-flex items-center rounded-full border border-base-line bg-base-surface p-1">
      <button
        type="button"
        onClick={() => onChange('need')}
        className={`rounded-full px-3 py-1 text-xs ${
          value === 'need' ? 'bg-pastel-mint text-base-text' : 'text-base-muted'
        }`}
      >
        必需
      </button>
      <button
        type="button"
        onClick={() => onChange('want')}
        className={`rounded-full px-3 py-1 text-xs ${
          value === 'want' ? 'bg-pastel-peach text-base-text' : 'text-base-muted'
        }`}
      >
        非必需
      </button>
    </div>
  )
}

