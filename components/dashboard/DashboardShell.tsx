'use client'

import { useState, useEffect } from 'react'
import Sidebar from './Sidebar'

interface Store {
  id: string
  name: string
  subdomain: string
  country_code: string
  plan: string
  modules: Record<string, boolean>
  full_subdomain: string
}

export default function DashboardShell({
  store,
  children,
}: {
  store: Store
  children: React.ReactNode
}) {
  const [sidebarOpen, setSidebarOpen] = useState(true)

  useEffect(() => {
    if (window.innerWidth < 1024) setSidebarOpen(false)
  }, [])

  return (
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
      />

      <div className="flex flex-1 flex-col overflow-hidden min-w-0">
        {/* شريط علوي ثابت */}
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

          {/* اسم المتجر على الموبايل */}
          <span className="lg:hidden text-sm font-semibold text-white truncate">{store.name}</span>

          <div className="flex-1" />

          {/* رابط المتجر على الديسكتوب */}
          <a
            href={`https://${store.full_subdomain}`}
            target="_blank"
            rel="noopener noreferrer"
            className="hidden lg:flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-slate-500 hover:bg-white/5 hover:text-sky-400 transition-colors"
            dir="ltr"
          >
            {store.full_subdomain}
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1.5 9.5L9.5 1.5M9.5 1.5H4M9.5 1.5V7" />
            </svg>
          </a>
        </header>

        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  )
}
