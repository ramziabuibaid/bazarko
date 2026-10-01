'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import Icon from './simple/Icons'

interface Tab { href: string; label: string; icon: string; match: (p: string) => boolean }

const TABS: Tab[] = [
  { href: '/dashboard', label: 'الرئيسية', icon: '🏠', match: p => p === '/dashboard' },
  { href: '/dashboard/orders', label: 'الطلبيات', icon: '📦', match: p => p.startsWith('/dashboard/orders') },
  { href: '/dashboard/accounting', label: 'المالية', icon: '💰', match: p => p.startsWith('/dashboard/accounting') },
  { href: '/dashboard/products', label: 'المنتجات', icon: '🛍️', match: p => p.startsWith('/dashboard/products') },
]

export default function MobileBottomNav({ onMore, simple = false }: { onMore: () => void; simple?: boolean }) {
  const pathname = usePathname()
  const tabs = simple ? TABS.map(t => t.href === '/dashboard/accounting' ? { ...t, href: '/dashboard/accounting/payments', label: 'المصاريف', match: (p: string) => p.startsWith('/dashboard/accounting/payments') } : t) : TABS

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 flex items-stretch border-t border-white/10 bg-slate-900/95 backdrop-blur-md lg:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {tabs.map((t, index) => {
        const active = t.match(pathname)
        return (
          <Link key={t.href} href={t.href}
            className={`flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium transition-colors ${
              active ? 'text-sky-400' : 'text-slate-400'
            }`}>
            <span className="text-lg leading-none">{simple ? <span className="block h-5 w-5 [&>svg]:h-5 [&>svg]:w-5"><Icon name={index === 0 ? 'home' : index === 1 ? 'orders' : index === 2 ? 'expense' : 'box'} /></span> : t.icon}</span>
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
