import type { ReactNode } from 'react'

type Props = {
  label: string
  onClick?: () => void
  icon: ReactNode
}

export function IconButton({ label, onClick, icon }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-base-line bg-base-surface text-base-text active:opacity-70"
    >
      <span className="sr-only">{label}</span>
      {icon}
    </button>
  )
}

