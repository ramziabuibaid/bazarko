'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

const NAV = [
  { href: '/admin',        label: 'نظرة عامة', icon: '📊' },
  { href: '/admin/stores', label: 'المتاجر',   icon: '🏪' },
  { href: '/admin/plans',  label: 'الخطط',     icon: '💳' },
]

function AdminSidebarContent({
  fullName,
  email,
  onNavClick,
  onClose,
  showClose,
}: {
  fullName?: string | null
  email?: string
  onNavClick?: () => void
  onClose: () => void
  showClose?: boolean
}) {
  const pathname = usePathname()
  const router = useRouter()

  function isActive(href: string) {
    if (href === '/admin') return pathname === '/admin'
    return pathname.startsWith(href)
  }

  async function signOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <>
      {/* رأس السايدبار */}
      <div className="flex items-start justify-between border-b border-white/5 px-4 py-4">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-red-400">Bazarko</p>
          <p className="mt-1 font-semibold text-white">لوحة الإدارة</p>
          <span className="mt-1 inline-flex items-center rounded-full bg-red-500/10 border border-red-500/20 px-2 py-0.5 text-[10px] font-semibold text-red-400">
            Super Admin
          </span>
        </div>

        {showClose && (
          <button
            onClick={onClose}
            className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-white/5 hover:text-white transition-colors"
            aria-label="إغلاق القائمة"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M3 3l10 10M13 3L3 13" />
            </svg>
          </button>
        )}
      </div>

      {/* القائمة */}
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {NAV.map(item => (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavClick}
            className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all ${
              isActive(item.href)
                ? 'bg-red-500/10 text-red-400'
                : 'text-slate-400 hover:bg-white/5 hover:text-white'
            }`}
          >
            <span className="text-base leading-none">{item.icon}</span>
            {item.label}
          </Link>
        ))}
      </nav>

      {/* أسفل السايدبار */}
      <div className="border-t border-white/5 px-3 py-3 space-y-0.5">
        <Link
          href="/dashboard"
          onClick={onNavClick}
          className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-500 hover:bg-white/5 hover:text-white transition-colors"
        >
          <span>↩</span> العودة للداشبورد
        </Link>
        <button
          onClick={signOut}
          className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-400 hover:bg-red-500/10 hover:text-red-400 transition-colors"
        >
          <span>🚪</span> تسجيل الخروج
        </button>
      </div>
    </>
  )
}

export default function AdminShell({
  fullName,
  email,
  children,
}: {
  fullName?: string | null
  email?: string
  children: React.ReactNode
}) {
  const [sidebarOpen, setSidebarOpen] = useState(true)

  useEffect(() => {
    if (window.innerWidth < 1024) setSidebarOpen(false)
  }, [])

  const sidebarProps = { fullName, email, onClose: () => setSidebarOpen(false) }

  return (
    <div className="flex h-screen overflow-hidden bg-slate-950 text-white" dir="rtl">
      {/* طبقة خلفية للموبايل */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* ديسكتوب sidebar */}
      {sidebarOpen && (
        <aside className="hidden lg:flex w-56 shrink-0 flex-col border-l border-white/5 bg-slate-900">
          <AdminSidebarContent {...sidebarProps} showClose={false} />
        </aside>
      )}

      {/* موبايل overlay sidebar */}
      <aside
        className={`lg:hidden fixed inset-y-0 right-0 z-30 flex w-72 flex-col border-l border-white/5 bg-slate-900 transform transition-transform duration-300 ease-in-out ${
          sidebarOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <AdminSidebarContent
          {...sidebarProps}
          onNavClick={() => setSidebarOpen(false)}
          showClose
        />
      </aside>

      {/* المحتوى الرئيسي */}
      <div className="flex flex-1 flex-col overflow-hidden min-w-0">
        {/* شريط علوي */}
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

          <span className="lg:hidden text-sm font-semibold text-white">لوحة الإدارة</span>

          <div className="flex-1" />

          <p className="hidden lg:block text-xs text-slate-500">{fullName ?? email}</p>
          <span className="rounded-full bg-red-500/10 border border-red-500/20 px-2 py-0.5 text-[10px] font-semibold text-red-400">
            Super Admin
          </span>
        </header>

        <main className="flex-1 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  )
}
