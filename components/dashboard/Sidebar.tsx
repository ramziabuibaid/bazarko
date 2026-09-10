'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState } from 'react'
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
interface NavGroup { title?: string; items: NavItem[]; module?: string }

const navGroups: NavGroup[] = [
  {
    items: [
      { href: '/dashboard', label: 'لوحة المؤشرات العامة', icon: '📊' },
    ],
  },
  {
    title: 'المبيعات والعملاء',
    items: [
      { href: '/dashboard/accounting/invoices', label: 'فواتير المبيعات', icon: '🧾' },
      { href: '/dashboard/invoices/returns', label: 'مردودات المبيعات', icon: '↩️' },
      { href: '/dashboard/quotations', label: 'عروض الأسعار', icon: '📑' },
      { href: '/dashboard/customers', label: 'دليل الزبائن والعملاء', icon: '👥' },
      { href: '/dashboard/customers/ledger', label: 'كشوف حسابات العملاء', icon: '📋' },
    ],
  },
  {
    title: 'المشتريات والموردين',
    items: [
      { href: '/dashboard/purchases', label: 'فواتير المشتريات', icon: '🛒' },
      { href: '/dashboard/purchases/returns', label: 'مردودات المشتريات', icon: '🔁' },
      { href: '/dashboard/suppliers', label: 'دليل الموردين', icon: '🏭' },
    ],
  },
  {
    title: 'الشيكات والبنوك',
    items: [
      { href: '/dashboard/cheques', label: 'محفظة الشيكات', icon: '🏦' },
      { href: '/dashboard/banks', label: 'الحسابات البنكية', icon: '🏛️' },
      { href: '/dashboard/banks/statement', label: 'كشف حساب بنكي', icon: '📜' },
    ],
  },
  {
    title: 'المحاسبة والمالية',
    items: [
      { href: '/dashboard/accounting', label: 'اللوحة المالية', icon: '💰' },
      { href: '/dashboard/accounting/accounts', label: 'شجرة الحسابات (دليل)', icon: '🌳' },
      { href: '/dashboard/accounting/journal', label: 'قيود اليومية العامة', icon: '⚖️' },
      { href: '/dashboard/accounting/receipts', label: 'سندات القبض', icon: '📥' },
      { href: '/dashboard/accounting/payments', label: 'سندات الصرف', icon: '📤' },
      { href: '/dashboard/accounting/treasury', label: 'الصندوق والخزينة', icon: '💼' },
      { href: '/dashboard/accounting/expenses', label: 'المصروفات', icon: '💸' },
      { href: '/dashboard/accounting/reports', label: 'التقارير المالية', icon: '📈' },
      { href: '/dashboard/accounting/audit', label: 'سجل العمليات والرقابة', icon: '🛡️' },
    ],
  },
  {
    title: 'المخزون والمنتجات',
    items: [
      { href: '/dashboard/products', label: 'قائمة المنتجات', icon: '🛍️' },
      { href: '/dashboard/inventory/statement', label: 'كشف حركات صنف', icon: '🔍' },
      { href: '/dashboard/inventory/brands', label: 'الماركات والبراندات', icon: '🏷️' },
      { href: '/dashboard/categories', label: 'الفئات والتصنيفات', icon: '📂' },
      { href: '/dashboard/inventory', label: 'إدارة المخزون والمستودع', icon: '📉' },
      { href: '/dashboard/inventory/movements', label: 'حركة المخزون الشاملة', icon: '🔄' },
      { href: '/dashboard/inventory/alerts', label: 'تنبيهات النواقص', icon: '⚠️' },
    ],
  },
  {
    title: 'المتجر الإلكتروني',
    items: [
      { href: '/dashboard/orders', label: 'طلبيات المتجر', icon: '📦' },
      { href: '/dashboard/offers', label: 'العروض الحصرية', icon: '🎁' },
      { href: '/dashboard/attributes', label: 'الخصائص والمواصفات', icon: '🎚️' },
      { href: '/dashboard/reviews', label: 'تقييمات الزبائن', icon: '⭐' },
      { href: '/dashboard/delivery', label: 'مناطق ورسوم التوصيل', icon: '🚚' },
      { href: '/dashboard/analytics', label: 'تحليلات وحركة الزوار', icon: '📡' },
    ],
  },
  {
    title: 'الصيانة والورشة',
    module: 'maintenance',
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
  onToggle,
  onSignOut,
  showClose,
  showToggle,
}: {
  store: Store
  pathname: string
  onNavClick?: () => void
  onClose: () => void
  onToggle?: () => void
  onSignOut: () => void
  showClose?: boolean
  showToggle?: boolean
}) {
  const storeUrl = `${store.subdomain}.${process.env.NEXT_PUBLIC_DOMAIN ?? 'bazarko.app'}`
  const [copied, setCopied] = useState(false)

  function copyStoreUrl() {
    navigator.clipboard.writeText(`https://${storeUrl}`)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

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
          <div className="mt-0.5 flex items-center gap-1">
            <a
              href={`https://${storeUrl}`}
              target="_blank"
              rel="noopener noreferrer"
              className="min-w-0 truncate text-xs text-slate-500 hover:text-sky-400 transition-colors"
              dir="ltr"
            >
              {storeUrl}
            </a>
            <button
              onClick={copyStoreUrl}
              title="نسخ رابط المتجر"
              className={`shrink-0 flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium transition-all ${
                copied
                  ? 'bg-emerald-500/20 text-emerald-400'
                  : 'bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/25'
              }`}
            >
              {copied ? (
                <>
                  <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 8 6.5 12 13 4" />
                  </svg>
                  تم
                </>
              ) : (
                <>
                  <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="5" y="5" width="9" height="9" rx="1.5" />
                    <path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2H3.5A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5" />
                  </svg>
                  نسخ
                </>
              )}
            </button>
          </div>
        </div>

        {/* زر الإغلاق على الموبايل */}
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

        {/* زر الطي على الديسكتوب */}
        {showToggle && (
          <button
            onClick={onToggle}
            className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-white/5 hover:text-white transition-colors"
            aria-label="طي القائمة"
            title="طي القائمة الجانبية"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M10 3l-5 5 5 5" />
            </svg>
          </button>
        )}
      </div>

      {/* القائمة الرئيسية */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {navGroups
          .filter(group => !group.module || store.modules?.[group.module])
          .map((group, gi) => (
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
  onToggle,
}: {
  store: Store
  isOpen: boolean
  onClose: () => void
  onToggle?: () => void
}) {
  const pathname = usePathname()
  const router = useRouter()

  async function signOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  const sharedProps = { store, pathname, onClose, onToggle, onSignOut: signOut }

  return (
    <>
      {/* ديسكتوب: جزء من الـ layout العادي — يظهر/يختفي حسب الحالة */}
      {isOpen && (
        <aside className="hidden lg:flex w-64 shrink-0 flex-col border-l border-white/5 bg-slate-900">
          <NavContent {...sharedProps} showClose={false} showToggle />
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
