'use client'

import { useState, useEffect } from 'react'
import Sidebar from './Sidebar'
import DashboardTopbar, { type DashNotification } from './DashboardTopbar'
import MobileBottomNav from './MobileBottomNav'
import StaffActivityTracker from './StaffActivityTracker'
import { ToastProvider } from '@/components/ui/Toast'
import { ConfirmProvider } from '@/components/ui/Confirm'

interface Store {
  id: string
  name: string
  subdomain: string
  country_code: string
  plan: string
  modules: Record<string, boolean>
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
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const storeUrl = `${store.subdomain}.${process.env.NEXT_PUBLIC_DOMAIN ?? 'bazarko.app'}`

  useEffect(() => {
    if (window.innerWidth < 1024) setSidebarOpen(false)
  }, [])

  return (
    <ToastProvider>
    <ConfirmProvider>
    <StaffActivityTracker storeId={store.id} />
    <div className="flex h-screen overflow-hidden bg-slate-950 text-white" dir="rtl">
      {/* طبقة خلفية للموبايل عند فتح السايدبار */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <Sidebar
        store={store}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onToggle={() => setSidebarOpen(s => !s)}
      />

      <div className="flex flex-1 flex-col overflow-hidden min-w-0">
        {/* شريط علوي — بحث + إشعارات (كل الأحجام) */}
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-white/5 bg-slate-900 px-4">
          <button
            onClick={() => setSidebarOpen(s => !s)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-white/5 hover:text-white transition-colors"
            aria-label="تبديل القائمة الجانبية"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <line x1="3" y1="5" x2="17" y2="5" />
              <line x1="3" y1="10" x2="17" y2="10" />
              <line x1="3" y1="15" x2="17" y2="15" />
            </svg>
          </button>
          <DashboardTopbar storeId={store.id} notifications={notifications} />
        </header>

        <main className="flex-1 overflow-y-auto pb-16 lg:pb-0">
          {children}
        </main>
      </div>

      {/* شريط تنقّل سفلي — موبايل فقط (إحساس تطبيق) */}
      <MobileBottomNav onMore={() => setSidebarOpen(true)} />
    </div>
    </ConfirmProvider>
    </ToastProvider>
  )
}
