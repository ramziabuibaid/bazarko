'use client'

import { useState, useEffect } from 'react'
import Sidebar from './Sidebar'
import DashboardTopbar, { type DashNotification } from './DashboardTopbar'
import MobileBottomNav from './MobileBottomNav'
import StaffActivityTracker from './StaffActivityTracker'
import { ToastProvider } from '@/components/ui/Toast'
import { ConfirmProvider } from '@/components/ui/Confirm'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { useSimpleDashboard } from '@/lib/dashboard/simple-metrics'
import SimpleSidebar from './simple/SimpleSidebar'
import SimpleTopbar from './simple/SimpleTopbar'
import styles from './simple/simple.module.css'

interface Store {
  id: string
  name: string
  subdomain: string
  country_code: string
  plan: string
  modules: Record<string, boolean>
  settings?: unknown
}

export default function DashboardShell({
  store,
  notifications = [],
  children,
}: {
  store: Store
  notifications?: DashNotification[]
  children: React.ReactNode
}) {
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const pathname = usePathname()
  const params = useSearchParams()
  const supportsSimple = useSimpleDashboard(store.plan, store.settings)
  const simple = supportsSimple && params.get('view') !== 'advanced'
  const light = simple && pathname === '/dashboard'
  const SidebarComponent = simple ? SimpleSidebar : Sidebar

  // Load user preference for sidebar collapse state from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem('bazarko_sidebar_collapsed')
      if (saved !== null) {
        setIsCollapsed(saved === 'true')
      }
    } catch {
      // ignore in SSR or restricted environments
    }
  }, [])

  const toggleCollapse = () => {
    setIsCollapsed(prev => {
      const next = !prev
      try {
        localStorage.setItem('bazarko_sidebar_collapsed', String(next))
      } catch {}
      return next
    })
  }

  // Keyboard shortcut: Cmd/Ctrl + B to toggle sidebar
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault()
        if (window.innerWidth < 1024) {
          setMobileOpen(m => !m)
        } else {
          toggleCollapse()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  return (
    <ToastProvider>
    <ConfirmProvider>
    <StaffActivityTracker storeId={store.id} />
    <div className={`flex h-screen overflow-hidden bg-slate-950 text-white ${light ? styles.simpleRoot : ''}`} dir="rtl">
      {/* طبقة خلفية للموبايل عند فتح السايدبار */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/60 backdrop-blur-sm lg:hidden transition-opacity"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <SidebarComponent
        store={store}
        isCollapsed={isCollapsed}
        onToggleCollapse={toggleCollapse}
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
      />

      <div className="flex flex-1 flex-col overflow-hidden min-w-0 transition-all duration-300">
        {/* شريط علوي — بحث + إشعارات (كل الأحجام) */}
        <header className={`flex h-14 shrink-0 items-center gap-3 border-b border-white/5 bg-slate-900 px-4 ${light ? styles.lightHeader : ''}`}>
          <button
            onClick={() => {
              if (window.innerWidth < 1024) {
                setMobileOpen(s => !s)
              } else {
                toggleCollapse()
              }
            }}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-white/5 hover:text-white transition-colors"
            aria-label="تبديل القائمة الجانبية"
            title="تبديل القائمة الجانبية (Ctrl+B)"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <line x1="3" y1="5" x2="17" y2="5" />
              <line x1="3" y1="10" x2="17" y2="10" />
              <line x1="3" y1="15" x2="17" y2="15" />
            </svg>
          </button>
          {light ? <SimpleTopbar name={store.name} notifications={notifications} /> : <DashboardTopbar storeId={store.id} plan={store.plan} notifications={notifications} />}
          {supportsSimple && !simple && <Link href="/dashboard" className="shrink-0 text-xs text-cyan-300">العرض المبسط</Link>}
        </header>

        <main className={`flex-1 overflow-y-auto pb-16 lg:pb-0 ${light ? styles.lightMain : ''}`}>
          {children}
        </main>
      </div>

      {/* شريط تنقّل سفلي — موبايل فقط (إحساس تطبيق) */}
      <MobileBottomNav simple={simple} onMore={() => setMobileOpen(true)} />
    </div>
    </ConfirmProvider>
    </ToastProvider>
  )
}
