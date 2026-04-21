import { Menu } from 'lucide-react'
import { IconButton } from '../shared/ui/IconButton'
import { useUi } from '../store/ui'

export default function Timeline() {
  const toggleDrawer = useUi((s) => s.toggleDrawer)

  return (
    <div className="mx-auto min-h-dvh max-w-[480px] bg-base-bg px-4 text-base-text">
      <header className="sticky top-0 z-20 -mx-4 bg-base-bg/95 px-4 pb-3 pt-4 backdrop-blur-sm">
        <div className="flex items-center justify-between">
          <IconButton label="打开导航" onClick={toggleDrawer} icon={<Menu size={18} />} />
          <div className="text-sm font-medium text-base-text">时间轴</div>
          <div className="h-10 w-10" />
        </div>
      </header>
      <div className="mt-4 rounded-2xl border border-base-line bg-base-surface p-4">
        <div className="text-sm font-medium">时间轴 Timeline</div>
        <div className="mt-2 text-sm text-base-muted">占位页面，敬请期待</div>
      </div>
    </div>
  )
}
