'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

interface Tab { href: string; label: string; icon: string; match: (p: string) => boolean }

const TABS: Tab[] = [
  { href: '/dashboard', label: 'الرئيسية', icon: '🏠', match: p => p === '/dashboard' },
  { href: '/dashboard/orders', label: 'الطلبيات', icon: '📦', match: p => p.startsWith('/dashboard/orders') },
  { href: '/dashboard/accounting', label: 'المالية', icon: '💰', match: p => p.startsWith('/dashboard/accounting') },
  { href: '/dashboard/products', label: 'المنتجات', icon: '🛍️', match: p => p.startsWith('/dashboard/products') },
]

export default function MobileBottomNav({ onMore }: { onMore: () => void }) {
  const pathname = usePathname()

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 flex items-stretch border-t border-white/10 bg-slate-900/95 backdrop-blur-md lg:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {TABS.map(t => {
        const active = t.match(pathname)
        return (
          <Link key={t.href} href={t.href}
            className={`flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium transition-colors ${
              active ? 'text-sky-400' : 'text-slate-400'
            }`}>
            <span className="text-lg leading-none">{t.icon}</span>
            {t.label}
          </Link>
        )
      })}
      <button onClick={onMore}
        className="flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium text-slate-400 transition-colors active:text-white">
        <span className="text-lg leading-none">☰</span>
        المزيد
      </button>
    </nav>
  )
}
