'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState, useEffect, useRef, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import BazarkoLogo from '@/components/ui/BazarkoLogo'
import { isRouteAllowed } from '@/lib/plans'

interface Store {
  id: string
  name: string
  subdomain: string
  country_code: string
  plan: string
  modules: Record<string, boolean>
}

interface NavItem {
  href: string
  label: string
  icon: string
  badge?: string
}

interface NavGroup {
  id: string
  title: string
  icon: string
  module?: string
  items: NavItem[]
}

const navGroups: NavGroup[] = [
  {
    id: 'overview',
    title: 'نظرة عامة',
    icon: '📊',
    items: [
      { href: '/dashboard', label: 'لوحة المؤشرات العامة', icon: '📊' },
    ],
  },
  {
    id: 'sales',
    title: 'إدارة المبيعات',
    icon: '📈',
    items: [
      { href: '/dashboard/sales', label: 'لوحة المبيعات (Hub)', icon: '📈' },
      { href: '/dashboard/pos', label: 'نقطة البيع (POS)', icon: '⚡' },
      { href: '/dashboard/accounting/invoices', label: 'فواتير المبيعات', icon: '🧾' },
      { href: '/dashboard/invoices/returns', label: 'مردودات المبيعات', icon: '↩️' },
      { href: '/dashboard/quotations', label: 'عروض الأسعار', icon: '📑' },
      { href: '/dashboard/customers', label: 'دليل وحسابات العملاء', icon: '👥' },
    ],
  },
  {
    id: 'purchases',
    title: 'إدارة المشتريات',
    icon: '🏬',
    items: [
      { href: '/dashboard/purchases-hub', label: 'لوحة المشتريات (Hub)', icon: '🏬' },
      { href: '/dashboard/purchases', label: 'فواتير المشتريات', icon: '🛒' },
      { href: '/dashboard/purchases/returns', label: 'مردودات المشتريات', icon: '🔁' },
      { href: '/dashboard/suppliers', label: 'دليل الموردين', icon: '🏭' },
    ],
  },
  {
    id: 'banking',
    title: 'الشيكات والبنوك',
    icon: '🏦',
    items: [
      { href: '/dashboard/cheques', label: 'محفظة الشيكات', icon: '🏦' },
      { href: '/dashboard/banks', label: 'الحسابات البنكية', icon: '🏛️' },
      { href: '/dashboard/banks/statement', label: 'كشف حساب بنكي', icon: '📜' },
    ],
  },
  {
    id: 'accounting',
    title: 'المالية والمحاسبة',
    icon: '⚖️',
    items: [
      { href: '/dashboard/finance', label: 'لوحة الإدارة المالية', icon: '💵' },
      { href: '/dashboard/accounting-hub', label: 'لوحة المحاسبة والتقارير', icon: '⚖️' },
      { href: '/dashboard/accounting/accounts', label: 'شجرة الحسابات (دليل)', icon: '🌳' },
      { href: '/dashboard/accounting/statement', label: 'كشف حساب محاسبي', icon: '📜' },
      { href: '/dashboard/accounting/journal', label: 'قيود اليومية العامة', icon: '⚖️' },
      { href: '/dashboard/accounting/reports', label: 'التقارير المالية والختامية', icon: '📊' },
      { href: '/dashboard/accounting/receipts', label: 'سندات القبض', icon: '📥' },
      { href: '/dashboard/accounting/payments', label: 'سندات الصرف', icon: '📤' },
      { href: '/dashboard/accounting/treasury', label: 'الصندوق والخزينة', icon: '💼' },
      { href: '/dashboard/accounting/shamel', label: 'مستورد الشامل ERP', icon: '🔄' },
      { href: '/dashboard/accounting/audit', label: 'سجل العمليات والرقابة', icon: '🛡️' },
    ],
  },
  {
    id: 'inventory',
    title: 'المخزون والمنتجات',
    icon: '📦',
    items: [
      { href: '/dashboard/inventory-hub', label: 'لوحة المخزون (Hub)', icon: '📦' },
      { href: '/dashboard/products', label: 'قائمة المنتجات', icon: '🛍️' },
      { href: '/dashboard/inventory/statement', label: 'كشف حركات صنف', icon: '🔍' },
      { href: '/dashboard/inventory/brands', label: 'الماركات والبراندات', icon: '🏷️' },
      { href: '/dashboard/categories', label: 'الفئات والتصنيفات', icon: '📂' },
      { href: '/dashboard/inventory', label: 'إدارة المخزون والمستودع', icon: '📉' },
      { href: '/dashboard/inventory/movements', label: 'حركة المخزون الشاملة', icon: '🔄' },
      { href: '/dashboard/inventory/sync', label: 'مزامنة وربط المخزون', icon: '⚡' },
      { href: '/dashboard/inventory/alerts', label: 'تنبيهات النواقص', icon: '⚠️' },
    ],
  },
  {
    id: 'store',
    title: 'المتجر الإلكتروني',
    icon: '🌐',
    items: [
      { href: '/dashboard/store-hub', label: 'لوحة المتجر (Hub)', icon: '🌐' },
      { href: '/dashboard/orders', label: 'طلبيات المتجر', icon: '📦' },
      { href: '/dashboard/offers', label: 'العروض الحصرية', icon: '🎁' },
      { href: '/dashboard/marketing/ads', label: 'إعلانات وحملات WhatsApp', icon: '📢' },
      { href: '/dashboard/attributes', label: 'الخصائص والمواصفات', icon: '🎚️' },
      { href: '/dashboard/reviews', label: 'تقييمات الزبائن', icon: '⭐' },
      { href: '/dashboard/delivery', label: 'مناطق ورسوم التوصيل', icon: '🚚' },
      { href: '/dashboard/analytics', label: 'تحليلات وحركة الزوار', icon: '📡' },
    ],
  },
  {
    id: 'maintenance',
    title: 'الصيانة والورشة',
    icon: '🔧',
    module: 'maintenance',
    items: [
      { href: '/dashboard/maintenance', label: 'لوحة الصيانة', icon: '🔧' },
      { href: '/dashboard/maintenance/new', label: 'استلام جهاز جديد', icon: '➕' },
    ],
  },
  {
    id: 'settings',
    title: 'الإعدادات والمستخدمون',
    icon: '⚙️',
    items: [
      { href: '/dashboard/settings', label: 'إعدادات وهوية المتجر', icon: '⚙️' },
      { href: '/dashboard/settings/team', label: 'فريق العمل والمستخدمين', icon: '👥' },
    ],
  },
]

export interface RailHub {
  id: string
  href: string
  label: string
  icon: string
  subroutes: string[]
}

export const railMainHubs: RailHub[] = [
  {
    id: 'sales',
    href: '/dashboard/sales',
    label: 'لوحة المبيعات',
    icon: '📈',
    subroutes: [
      '/dashboard/sales',
      '/dashboard/pos',
      '/dashboard/accounting/invoices',
      '/dashboard/invoices',
      '/dashboard/quotations',
      '/dashboard/customers',
    ],
  },
  {
    id: 'purchases',
    href: '/dashboard/purchases-hub',
    label: 'لوحة المشتريات',
    icon: '🏬',
    subroutes: [
      '/dashboard/purchases-hub',
      '/dashboard/purchases',
      '/dashboard/suppliers',
    ],
  },
  {
    id: 'finance',
    href: '/dashboard/finance',
    label: 'لوحة الإدارة المالية',
    icon: '💵',
    subroutes: [
      '/dashboard/finance',
      '/dashboard/cheques',
      '/dashboard/banks',
    ],
  },
  {
    id: 'inventory',
    href: '/dashboard/inventory-hub',
    label: 'لوحة المخزون',
    icon: '📦',
    subroutes: [
      '/dashboard/inventory-hub',
      '/dashboard/inventory',
      '/dashboard/products',
      '/dashboard/categories',
      '/dashboard/attributes',
    ],
  },
  {
    id: 'store',
    href: '/dashboard/store-hub',
    label: 'لوحة المتجر الإلكتروني',
    icon: '🌐',
    subroutes: [
      '/dashboard/store-hub',
      '/dashboard/orders',
      '/dashboard/offers',
      '/dashboard/marketing',
      '/dashboard/reviews',
      '/dashboard/delivery',
      '/dashboard/analytics',
    ],
  },
  {
    id: 'accounting',
    href: '/dashboard/accounting-hub',
    label: 'المحاسبة والتقارير',
    icon: '⚖️',
    subroutes: [
      '/dashboard/accounting-hub',
      '/dashboard/accounting',
    ],
  },
]

export interface SidebarProps {
  store: Store
  // Desktop collapsed mode state
  isCollapsed?: boolean
  onToggleCollapse?: () => void
  // Mobile drawer state
  mobileOpen?: boolean
  onMobileClose?: () => void
  // Backward compatibility
  isOpen?: boolean
  onClose?: () => void
  onToggle?: () => void
}

export default function Sidebar({
  store,
  isCollapsed = false,
  onToggleCollapse,
  mobileOpen,
  onMobileClose,
  isOpen,
  onClose,
  onToggle,
}: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()

  // Support legacy props if new props not supplied
  const effectiveCollapsed = isCollapsed ?? (isOpen !== undefined ? !isOpen : false)
  const effectiveToggle = onToggleCollapse ?? onToggle
  const effectiveMobileOpen = mobileOpen ?? (isOpen !== undefined ? isOpen : false)
  const effectiveMobileClose = onMobileClose ?? onClose ?? (() => {})

  const isPro = store.plan === 'pro' || store.plan === 'basic'
  const storeUrl = `${store.subdomain}.${process.env.NEXT_PUBLIC_DOMAIN ?? 'bazarko.app'}`

  const [copied, setCopied] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({})

  // Tooltip & Popover state for Collapsed Rail Mode
  const [hoveredItem, setHoveredItem] = useState<{
    item: NavItem
    groupTitle: string
    top: number
    isActive: boolean
  } | null>(null)

  function copyStoreUrl() {
    navigator.clipboard.writeText(`https://${storeUrl}`)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function signOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  function isActive(href: string) {
    if (href === '/dashboard') return pathname === '/dashboard'
    return pathname.startsWith(href)
  }

  function isRailHubActive(hub: RailHub) {
    if (pathname === hub.href) return true
    if (hub.id === 'accounting') {
      return (
        pathname.startsWith('/dashboard/accounting-hub') ||
        (pathname.startsWith('/dashboard/accounting') && !pathname.startsWith('/dashboard/accounting/invoices'))
      )
    }
    return hub.subroutes.some(route => pathname.startsWith(route))
  }

  // Toggle group accordion in expanded mode
  function toggleGroup(groupId: string) {
    setCollapsedGroups(prev => ({
      ...prev,
      [groupId]: !prev[groupId],
    }))
  }

  // Filter items when user types in search
  const filteredGroups = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return navGroups
      .filter(group => !group.module || store.modules?.[group.module])
      .map(group => {
        const allowedItems = group.items.filter(
          item => isPro || isRouteAllowed(item.href, store.plan)
        )
        if (!q) {
          return { ...group, items: allowedItems }
        }
        const matched = allowedItems.filter(
          item =>
            item.label.toLowerCase().includes(q) ||
            group.title.toLowerCase().includes(q)
        )
        return { ...group, items: matched }
      })
      .filter(group => group.items.length > 0)
  }, [searchQuery, isPro, store.plan, store.modules])

  // Total matching count for live filter
  const totalMatches = useMemo(() => {
    return filteredGroups.reduce((acc, g) => acc + g.items.length, 0)
  }, [filteredGroups])

  // Content for navigation (shared between Desktop & Mobile)
  const renderNavContent = (isRail: boolean, onNavClick?: () => void) => {
    return (
      <div className="flex h-full flex-col select-none">
        {/* ─── Header ─── */}
        <div
          className={`flex items-center border-b border-white/[0.08] transition-all duration-300 ${
            isRail ? 'h-16 px-2 justify-center' : 'p-3.5 justify-between'
          }`}
        >
          {isRail ? (
            /* Mini Logo in Collapsed Mode */
            <div className="flex flex-col items-center gap-2">
              <Link
                href="/dashboard"
                onClick={onNavClick}
                className="group relative flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-500/20 via-sky-600/10 to-transparent p-1.5 ring-1 ring-sky-500/30 transition-all duration-300 hover:scale-105 hover:ring-sky-400 shadow-md shadow-sky-500/10"
                title="الرئيسية - Bazarko"
              >
                <BazarkoLogo size="xs" variant="image" showText={false} href={null} />
              </Link>
            </div>
          ) : (
            /* Full Header in Expanded Mode */
            <div className="flex w-full items-start justify-between gap-2 min-w-0">
              <div className="min-w-0 flex-1">
                <div className="mb-2">
                  <BazarkoLogo size="xs" variant="image" subtitle="نظام الـ ERP المتكامل" href="/dashboard" />
                </div>
                <div className="flex items-center gap-2">
                  <h2 className="truncate font-bold text-white text-sm tracking-tight">{store.name}</h2>
                  {isPro ? (
                    <span className="shrink-0 rounded-md bg-gradient-to-r from-amber-500/20 to-orange-500/20 px-1.5 py-0.5 text-[10px] font-black text-amber-300 ring-1 ring-amber-500/30">
                      PRO 👑
                    </span>
                  ) : (
                    <span className="shrink-0 rounded-md bg-slate-800 px-1.5 py-0.5 text-[10px] font-medium text-slate-400">
                      مجاني
                    </span>
                  )}
                </div>

                <div className="mt-1 flex items-center gap-1.5">
                  <a
                    href={`https://${storeUrl}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="min-w-0 truncate text-[11px] font-mono text-slate-400 hover:text-sky-300 transition-colors"
                    dir="ltr"
                    title={storeUrl}
                  >
                    {storeUrl}
                  </a>
                  <button
                    onClick={copyStoreUrl}
                    title="نسخ رابط المتجر"
                    className={`shrink-0 flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium transition-all ${
                      copied
                        ? 'bg-emerald-500/20 text-emerald-400'
                        : 'bg-white/5 text-slate-400 hover:bg-white/10 hover:text-white'
                    }`}
                  >
                    {copied ? '✓ تم' : 'نسخ'}
                  </button>
                </div>
              </div>

              {/* Header Toggle / Close Button */}
              <div className="flex items-center gap-1">
                {effectiveToggle && (
                  <button
                    onClick={effectiveToggle}
                    className="hidden lg:flex h-8 w-8 items-center justify-center rounded-xl text-slate-400 hover:bg-white/10 hover:text-white transition-colors"
                    title="طي القائمة الجانبية (Ctrl+B)"
                    aria-label="طي القائمة الجانبية"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect width="18" height="18" x="3" y="3" rx="2" />
                      <path d="M15 3v18" />
                      <path d="m10 15-3-3 3-3" />
                    </svg>
                  </button>
                )}

                {/* Mobile Close Button */}
                <button
                  onClick={effectiveMobileClose}
                  className="flex lg:hidden h-8 w-8 items-center justify-center rounded-xl text-slate-400 hover:bg-white/10 hover:text-white transition-colors"
                  aria-label="إغلاق القائمة"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ─── Search / Filter (Expanded Mode Only) ─── */}
        {!isRail && (
          <div className="px-3 pt-3 pb-1">
            <div className="relative flex items-center rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 transition-all focus-within:border-sky-500/50 focus-within:bg-white/[0.06] focus-within:ring-1 focus-within:ring-sky-500/30">
              <span className="text-slate-400 text-xs">🔍</span>
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="بحث سريع في القوائم..."
                className="w-full bg-transparent px-2 text-xs text-white placeholder-slate-500 outline-none"
              />
              {searchQuery ? (
                <button
                  onClick={() => setSearchQuery('')}
                  className="text-slate-400 hover:text-white text-xs font-bold px-1"
                >
                  ✕
                </button>
              ) : (
                <span className="text-[10px] font-mono text-slate-600 bg-white/5 px-1.5 py-0.5 rounded">
                  ⌘B
                </span>
              )}
            </div>
            {searchQuery && (
              <p className="mt-1.5 px-1 text-[11px] font-medium text-sky-400">
                نتائج البحث: {totalMatches} {totalMatches === 1 ? 'عنصر' : 'عناصر'}
              </p>
            )}
          </div>
        )}

        {/* ─── Main Navigation Items ─── */}
        <nav className="flex-1 overflow-y-auto px-2 py-3 scrollbar-none [&::-webkit-scrollbar]:hidden">
          {isRail ? (
            /* Collapsed Rail Mode: Only show the 6 main hubs requested */
            <ul className="flex flex-col items-center space-y-2 pt-1">
              {railMainHubs.map(hub => {
                const active = isRailHubActive(hub)

                return (
                  <li key={hub.href} className="w-full flex justify-center">
                    <Link
                      href={hub.href}
                      onClick={onNavClick}
                      onMouseEnter={e => {
                        const rect = e.currentTarget.getBoundingClientRect()
                        setHoveredItem({
                          item: { href: hub.href, label: hub.label, icon: hub.icon },
                          groupTitle: 'اللوحة الرئيسية',
                          top: rect.top,
                          isActive: active,
                        })
                      }}
                      onMouseLeave={() => setHoveredItem(null)}
                      className={`group relative flex h-11 w-11 items-center justify-center rounded-2xl transition-all duration-200 ${
                        active
                          ? 'bg-gradient-to-br from-sky-500/25 to-sky-600/10 text-sky-300 ring-1 ring-sky-500/40 shadow-lg shadow-sky-500/15'
                          : 'text-slate-400 hover:bg-white/[0.08] hover:text-white hover:scale-105 active:scale-95'
                      }`}
                      aria-label={hub.label}
                    >
                      <span className="text-xl leading-none transition-transform duration-200 group-hover:scale-110">
                        {hub.icon}
                      </span>
                      {active && (
                        <span className="absolute right-0 top-2.5 bottom-2.5 w-1 rounded-l-full bg-sky-400 shadow-[0_0_8px_rgba(56,189,248,0.8)]" />
                      )}
                    </Link>
                  </li>
                )
              })}
            </ul>
          ) : (
            /* Expanded Mode: Full Group Accordions */
            <div className="space-y-4">
              {filteredGroups.map(group => {
                const isGroupOpen = !collapsedGroups[group.id] || searchQuery.length > 0

                return (
                  <div key={group.id} className="relative">
                    {group.title && (
                      <button
                        type="button"
                        onClick={() => toggleGroup(group.id)}
                        className="group/btn mb-1.5 flex w-full items-center justify-between px-2.5 py-1 text-right text-[11px] font-bold uppercase tracking-wider text-slate-500 hover:text-slate-300 transition-colors"
                      >
                        <span className="flex items-center gap-1.5">
                          <span className="text-xs opacity-70">{group.icon}</span>
                          <span>{group.title}</span>
                        </span>
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className={`transition-transform duration-200 text-slate-600 group-hover/btn:text-slate-400 ${
                            isGroupOpen ? 'rotate-0' : '-rotate-90'
                          }`}
                        >
                          <polyline points="6 9 12 15 18 9" />
                        </svg>
                      </button>
                    )}

                    {isGroupOpen && (
                      <ul className="space-y-1">
                        {group.items.map(item => {
                          const active = isActive(item.href)

                          return (
                            <li key={item.href}>
                              <Link
                                href={item.href}
                                onClick={onNavClick}
                                className={`group flex items-center justify-between rounded-xl px-3 py-2 text-xs font-medium transition-all duration-150 ${
                                  active
                                    ? 'bg-gradient-to-r from-sky-500/20 via-sky-500/10 to-transparent text-sky-300 font-bold border-r-2 border-sky-400 shadow-sm shadow-sky-500/10'
                                    : 'text-slate-400 hover:bg-white/[0.06] hover:text-white hover:translate-x-[-2px]'
                                }`}
                              >
                                <div className="flex items-center gap-2.5 min-w-0">
                                  <span className="text-base leading-none transition-transform duration-200 group-hover:scale-110">
                                    {item.icon}
                                  </span>
                                  <span className="truncate">{item.label}</span>
                                </div>
                                {active && (
                                  <span className="h-1.5 w-1.5 rounded-full bg-sky-400 shadow-[0_0_6px_rgba(56,189,248,0.8)]" />
                                )}
                              </Link>
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </nav>

        {/* ─── Footer / Account Section ─── */}
        <div
          className={`border-t border-white/[0.08] bg-slate-950/40 transition-all duration-300 ${
            isRail ? 'p-2 flex flex-col items-center gap-2' : 'p-3 space-y-1.5'
          }`}
        >
          {/* Upgrade Banner for Free Plan */}
          {!isPro && !isRail && (
            <Link
              href="/dashboard/upgrade"
              onClick={onNavClick}
              className="mb-2 flex items-center justify-between gap-2 rounded-xl border border-amber-500/40 bg-gradient-to-r from-amber-500/20 via-orange-500/15 to-amber-500/10 px-3 py-2 text-xs font-bold text-amber-300 shadow-md transition hover:border-amber-400 hover:bg-amber-500/25"
            >
              <div className="flex items-center gap-1.5">
                <span>👑</span>
                <span>ترقية للنسخة الكاملة</span>
              </div>
              <span className="rounded bg-amber-500/30 px-1.5 py-0.5 text-[10px] font-black">
                ⚡ PRO
              </span>
            </Link>
          )}

          {isRail ? (
            /* Mini Footer Actions in Rail Mode */
            <div className="flex flex-col items-center gap-1 w-full">
              <Link
                href="/dashboard/settings"
                onClick={onNavClick}
                title="الإعدادات"
                className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-400 hover:bg-white/10 hover:text-white transition-all"
              >
                <span className="text-base">⚙️</span>
              </Link>
              <a
                href={`https://${storeUrl}`}
                target="_blank"
                rel="noopener noreferrer"
                title="معاينة المتجر"
                className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-400 hover:bg-white/10 hover:text-white transition-all"
              >
                <span className="text-base">👁️</span>
              </a>
              <button
                onClick={signOut}
                title="تسجيل الخروج"
                className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-400 hover:bg-red-500/15 hover:text-red-400 transition-all"
              >
                <span className="text-base">🚪</span>
              </button>

              {/* Bottom Expand Button */}
              {effectiveToggle && (
                <button
                  onClick={effectiveToggle}
                  title="توسيع القائمة الجانبية (Ctrl+B)"
                  className="mt-1 flex h-10 w-10 items-center justify-center rounded-xl bg-sky-500/10 text-sky-400 hover:bg-sky-500/20 hover:text-sky-300 transition-all border border-sky-500/20"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect width="18" height="18" x="3" y="3" rx="2" />
                    <path d="M9 3v18" />
                    <path d="m14 9 3 3-3 3" />
                  </svg>
                </button>
              )}
            </div>
          ) : (
            /* Full Footer in Expanded Mode */
            <>
              {/* Store Profile Strip */}
              <div className="flex items-center gap-2.5 rounded-xl bg-white/[0.04] p-2 border border-white/[0.06]">
                <div className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-tr from-sky-500 to-indigo-600 text-xs font-bold text-white shadow">
                  {store.name.slice(0, 1).toUpperCase()}
                  <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-slate-900">
                    <span className="block h-full w-full rounded-full bg-emerald-400 animate-ping opacity-75" />
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold text-white">{store.name}</p>
                  <p className="text-[10px] text-emerald-400 flex items-center gap-1 font-medium">
                    متصل الآن • {isPro ? 'الخطة الاحترافية' : 'الخطة المجانية'}
                  </p>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="grid grid-cols-3 gap-1 pt-1">
                <Link
                  href="/dashboard/settings"
                  onClick={onNavClick}
                  className="flex items-center justify-center gap-1 rounded-lg py-1.5 text-xs text-slate-400 hover:bg-white/10 hover:text-white transition-colors"
                  title="الإعدادات"
                >
                  <span>⚙️</span>
                  <span className="text-[11px]">الإعدادات</span>
                </Link>
                <a
                  href={`https://${storeUrl}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-1 rounded-lg py-1.5 text-xs text-slate-400 hover:bg-white/10 hover:text-white transition-colors"
                  title="معاينة المتجر"
                >
                  <span>👁️</span>
                  <span className="text-[11px]">المتجر</span>
                </a>
                <button
                  onClick={signOut}
                  className="flex items-center justify-center gap-1 rounded-lg py-1.5 text-xs text-slate-400 hover:bg-red-500/15 hover:text-red-400 transition-colors"
                  title="تسجيل الخروج"
                >
                  <span>🚪</span>
                  <span className="text-[11px]">خروج</span>
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <>
      {/* ─── Desktop Aside (Either Expanded w-72 or Collapsed Rail w-[76px]) ─── */}
      <aside
        className={`hidden lg:flex shrink-0 flex-col border-l border-white/[0.08] bg-slate-900/95 backdrop-blur-md relative transition-[width] duration-300 ease-in-out ${
          effectiveCollapsed ? 'w-[76px]' : 'w-72'
        }`}
      >
        {renderNavContent(effectiveCollapsed)}

        {/* Floating Toggle Pill on Border */}
        {effectiveToggle && (
          <button
            onClick={effectiveToggle}
            className="group absolute -left-3.5 top-18 z-30 flex h-7 w-7 items-center justify-center rounded-full border border-white/15 bg-slate-900 text-slate-400 shadow-xl transition-all duration-200 hover:scale-110 hover:border-sky-500/50 hover:bg-slate-800 hover:text-sky-300"
            title={effectiveCollapsed ? 'توسيع القائمة (Ctrl+B)' : 'طي القائمة (Ctrl+B)'}
            aria-label={effectiveCollapsed ? 'توسيع القائمة' : 'طي القائمة'}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={`transition-transform duration-300 ${
                effectiveCollapsed ? 'rotate-180' : 'rotate-0'
              }`}
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        )}
      </aside>

      {/* ─── Mobile Slide-Over Drawer ─── */}
      <aside
        className={`lg:hidden fixed inset-y-0 right-0 z-30 flex w-72 flex-col border-l border-white/[0.08] bg-slate-900 shadow-2xl transform transition-transform duration-300 ease-in-out ${
          effectiveMobileOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {renderNavContent(false, effectiveMobileClose)}
      </aside>

      {/* ─── Floating Tooltip / Popover for Rail Mode (Fixed coords to prevent clipping) ─── */}
      {hoveredItem && effectiveCollapsed && (
        <div
          className="fixed z-50 pointer-events-none transition-all duration-150"
          style={{
            top: Math.max(12, Math.min(typeof window !== 'undefined' ? window.innerHeight - 80 : 500, hoveredItem.top)),
            right: '84px', // 76px sidebar width + 8px gap
          }}
        >
          <div className="relative flex items-center gap-3 rounded-2xl border border-white/10 bg-slate-900/95 px-4 py-2.5 shadow-2xl backdrop-blur-xl ring-1 ring-white/10 animate-in fade-in zoom-in-95 duration-150">
            {/* Little arrow indicator pointing towards the icon */}
            <div className="absolute -right-1.5 top-1/2 -translate-y-1/2 h-3 w-3 rotate-45 border-t border-r border-white/10 bg-slate-900/95" />

            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/5 text-xl shadow-inner">
              {hoveredItem.item.icon}
            </div>
            <div className="min-w-[120px] text-right">
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-white text-sm whitespace-nowrap">
                  {hoveredItem.item.label}
                </span>
                {hoveredItem.item.badge && (
                  <span className="rounded bg-sky-500/20 px-1.5 py-0.5 text-[9px] font-bold text-sky-300">
                    {hoveredItem.item.badge}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-400 font-medium">
                {hoveredItem.groupTitle}
              </p>
              {hoveredItem.isActive && (
                <div className="mt-1 flex items-center gap-1 text-[10px] font-semibold text-emerald-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  الصفحة الحالية
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

