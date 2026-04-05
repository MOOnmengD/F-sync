import { useEffect, useRef } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { X } from 'lucide-react'
import { useUi } from '../store/ui'
import { IconButton } from '../shared/ui/IconButton'

const linkBase =
  'flex items-center rounded-2xl px-4 py-3 text-sm border border-base-line bg-base-surface text-base-text'

function Item({ to, label }: { to: string; label: string }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `${linkBase} ${isActive ? 'bg-pastel-baby' : ''}`.trim()
      }
    >
      {label}
    </NavLink>
  )
}

export function DrawerNav() {
  const open = useUi((s) => s.drawerOpen)
  const setOpen = useUi((s) => s.setDrawerOpen)
  const { pathname } = useLocation()
  const openRef = useRef(open)

  useEffect(() => {
    openRef.current = open
  }, [open])

  useEffect(() => {
    if (!openRef.current) return
    setOpen(false)
  }, [pathname, setOpen])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50" onClick={() => setOpen(false)}>
      <button
        type="button"
        className="absolute inset-0 z-0 bg-black/20 backdrop-blur-sm"
        aria-label="关闭侧边栏"
      />
      <aside
        className="absolute left-0 top-0 z-10 h-dvh w-[78%] max-w-[320px] border-r border-base-line bg-[#FDFCFB] p-4 pt-[calc(env(safe-area-inset-top)+1rem)]"
        aria-label="全局导航"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative flex min-h-10 items-center justify-center">
          <div className="absolute left-0 top-1/2 -translate-y-1/2">
            <IconButton label="关闭" onClick={() => setOpen(false)} icon={<X size={18} />} />
          </div>
          <div className="text-sm font-medium text-base-text">F-Sync</div>
        </div>

        <nav className="mt-4 flex flex-col gap-3">
          <Item to="/" label="主页 Home" />
          <Item to="/finance" label="记账报表 Finance" />
          <Item to="/work" label="工作总结 Work" />
          <Item to="/vault" label="知识库 Vault" />
        </nav>
      </aside>
    </div>
  )
}
