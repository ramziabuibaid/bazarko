'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

interface Store {
  id: string
  name: string
  subdomain: string
  country_code: string
  plan: string
  modules: Record<string, boolean>
}

interface NavItem { href: string; label: string; icon: string }
interface NavGroup { title?: string; items: NavItem[] }

const navGroups: NavGroup[] = [
  {
    items: [
      { href: '/dashboard', label: 'نظرة عامة', icon: '📊' },
    ],
  },
  {
    title: 'المتجر الإلكتروني',
    items: [
      { href: '/dashboard/products', label: 'المنتجات', icon: '🛍️' },
      { href: '/dashboard/categories', label: 'الفئات', icon: '📂' },
      { href: '/dashboard/orders', label: 'الطلبيات', icon: '📦' },
      { href: '/dashboard/delivery', label: 'التوصيل', icon: '🚚' },
    ],
  },
  {
    title: 'المحاسبة والمالية',
    items: [
      { href: '/dashboard/accounting', label: 'نظرة مالية', icon: '💰' },
      { href: '/dashboard/accounting/invoices', label: 'الفواتير', icon: '📋' },
      { href: '/dashboard/accounting/receipts', label: 'سندات القبض', icon: '💵' },
      { href: '/dashboard/accounting/payments', label: 'سندات الصرف', icon: '💸' },
      { href: '/dashboard/accounting/reports', label: 'التقارير', icon: '📈' },
    ],
  },
  {
    title: 'الزبائن',
    items: [
      { href: '/dashboard/customers', label: 'قائمة الزبائن', icon: '👥' },
      { href: '/dashboard/customers/ledger', label: 'ذمم الزبائن', icon: '💳' },
    ],
  },
  {
    title: 'المخزون',
    items: [
      { href: '/dashboard/inventory', label: 'إدارة المخزون', icon: '📉' },
      { href: '/dashboard/inventory/movements', label: 'حركة المخزون', icon: '🔄' },
      { href: '/dashboard/inventory/alerts', label: 'تنبيهات النفاد', icon: '⚠️' },
    ],
  },
  {
    title: 'الصيانة',
    items: [
      { href: '/dashboard/maintenance', label: 'لوحة الصيانة', icon: '🔧' },
      { href: '/dashboard/maintenance/new', label: 'استلام جهاز جديد', icon: '➕' },
    ],
  },
]

function NavContent({
  store,
  pathname,
  onNavClick,
  onClose,
  onSignOut,
  showClose,
}: {
  store: Store
  pathname: string
  onNavClick?: () => void
  onClose: () => void
  onSignOut: () => void
  showClose?: boolean
}) {
  const storeUrl = `${store.subdomain}.${process.env.NEXT_PUBLIC_DOMAIN ?? 'bazarko.app'}`

  function isActive(href: string) {
    if (href === '/dashboard') return pathname === '/dashboard'
    return pathname.startsWith(href)
  }

  return (
    <>
      {/* رأس السايدبار */}
      <div className="flex items-start justify-between border-b border-white/5 px-4 py-4">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-sky-400">Bazarko</p>
          <h2 className="mt-1 truncate font-semibold text-white">{store.name}</h2>
          <a
            href={`https://${storeUrl}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-0.5 block truncate text-xs text-slate-500 hover:text-sky-400 transition-colors"
            dir="ltr"
          >
            {storeUrl}
          </a>
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

      {/* القائمة الرئيسية */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {navGroups.map((group, gi) => (
          <div key={gi} className={gi > 0 ? 'mt-6' : ''}>
            {group.title && (
              <p className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-widest text-slate-600">
                {group.title}
              </p>
            )}
            <ul className="space-y-0.5">
              {group.items.map(item => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavClick}
                    className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all ${
                      isActive(item.href)
                        ? 'bg-sky-500/15 text-sky-400'
                        : 'text-slate-400 hover:bg-white/5 hover:text-white'
                    }`}
                  >
                    <span className="text-base leading-none">{item.icon}</span>
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      {/* أسفل السايدبار */}
      <div className="border-t border-white/5 px-3 py-3 space-y-0.5">
        <Link
          href="/dashboard/settings"
          onClick={onNavClick}
          className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-400 hover:bg-white/5 hover:text-white transition-colors"
        >
          <span>⚙️</span> الإعدادات
        </Link>
        <a
          href={`https://${storeUrl}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-400 hover:bg-white/5 hover:text-white transition-colors"
        >
          <span>👁️</span> معاينة المتجر
        </a>
        <button
          onClick={onSignOut}
          className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-400 hover:bg-red-500/10 hover:text-red-400 transition-colors"
        >
          <span>🚪</span> تسجيل الخروج
        </button>
      </div>
    </>
  )
}

export default function Sidebar({
  store,
  isOpen,
  onClose,
}: {
  store: Store
  isOpen: boolean
  onClose: () => void
}) {
  const pathname = usePathname()
  const router = useRouter()

  async function signOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  const sharedProps = { store, pathname, onClose, onSignOut: signOut }

  return (
    <>
      {/* ديسكتوب: جزء من الـ layout العادي — يظهر/يختفي حسب الحالة */}
      {isOpen && (
        <aside className="hidden lg:flex w-64 shrink-0 flex-col border-l border-white/5 bg-slate-900">
          <NavContent {...sharedProps} showClose={false} />
        </aside>
      )}

      {/* موبايل: overlay ثابت يظهر من اليمين */}
      <aside
        className={`lg:hidden fixed inset-y-0 right-0 z-30 flex w-72 flex-col border-l border-white/5 bg-slate-900 transform transition-transform duration-300 ease-in-out ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <NavContent
          {...sharedProps}
          onNavClick={onClose}
          showClose
        />
      </aside>
    </>
  )
}
