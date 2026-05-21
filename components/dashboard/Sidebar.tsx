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
  full_subdomain: string
}

interface NavItem {
  href: string
  label: string
  icon: string
}

interface NavGroup {
  title?: string
  items: NavItem[]
}

export default function Sidebar({ store }: { store: Store }) {
  const pathname = usePathname()
  const router = useRouter()

  const modules = (store.modules || {}) as Record<string, boolean>

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

  async function signOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  function isActive(href: string) {
    if (href === '/dashboard') return pathname === '/dashboard'
    return pathname.startsWith(href)
  }

  return (
    <aside className="flex w-64 flex-shrink-0 flex-col border-l border-white/5 bg-slate-900">
      {/* رأس الـ Sidebar */}
      <div className="border-b border-white/5 px-4 py-4">
        <p className="text-xs text-sky-400 uppercase tracking-widest">Bazarko</p>
        <h2 className="mt-1 truncate font-semibold text-white">{store.name}</h2>
        <a
          href={`https://${store.full_subdomain}`}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-0.5 block truncate text-xs text-slate-500 hover:text-sky-400"
          dir="ltr"
        >
          {store.full_subdomain}
        </a>
      </div>

      {/* قائمة التنقل */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {navGroups.map((group, gi) => (
          <div key={gi} className={gi > 0 ? 'mt-6' : ''}>
            {group.title && (
              <p className="mb-1.5 px-2 text-xs font-medium text-slate-500">
                {group.title}
              </p>
            )}
            <ul className="space-y-0.5">
              {group.items.map(item => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
                      isActive(item.href)
                        ? 'bg-sky-500/10 text-sky-400'
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

      {/* أسفل الـ Sidebar */}
      <div className="border-t border-white/5 px-3 py-3 space-y-0.5">
        <Link
          href="/dashboard/settings"
          className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-slate-400 hover:bg-white/5 hover:text-white"
        >
          <span>⚙️</span> الإعدادات
        </Link>
        <a
          href={`https://${store.full_subdomain}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-slate-400 hover:bg-white/5 hover:text-white"
        >
          <span>👁️</span> معاينة المتجر
        </a>
        <button
          onClick={signOut}
          className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-slate-400 hover:bg-red-500/10 hover:text-red-400"
        >
          <span>🚪</span> تسجيل الخروج
        </button>
      </div>
    </aside>
  )
}
