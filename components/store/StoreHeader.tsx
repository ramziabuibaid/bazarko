'use client'

import { useState, useEffect } from 'react'
import { useCart } from '@/lib/store/cart'
import { useWishlist } from '@/lib/store/wishlist'
import Link from 'next/link'
import { getHeaderTheme } from './headerThemes'
import { ThemeToggle } from './StoreTheme'

interface Store {
  id: string
  name: string
  logo_url: string | null
  phone: string | null
  whatsapp: string | null
  currency_code: string
  header_theme?: string | null
}

interface Props {
  store: Store
  country: string
  subdomain: string
}

export default function StoreHeader({ store, country, subdomain }: Props) {
  const count         = useCart(s => s.count())
  const wishlistCount = useWishlist(s => s.count())
  const theme = getHeaderTheme(store.header_theme)
  const [menuOpen, setMenuOpen] = useState(false)
  const base = `/store/${country}/${subdomain}`
  const close = () => setMenuOpen(false)

  // قفل تمرير الصفحة عند فتح القائمة الجانبية
  useEffect(() => {
    document.body.style.overflow = menuOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [menuOpen])

  return (
    <>
      <header className={`sticky top-0 z-40 ${theme.header} relative`}>
        {/* طبقة اللمعان — معزولة بـ overflow-hidden حتى لا تقصّ المحتوى */}
        {theme.shine && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 z-0 overflow-hidden animate-header-shine"
          />
        )}
        <div className="relative z-10 mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Link href={base} className="flex items-center gap-2.5">
            {store.logo_url ? (
              <img
                src={store.logo_url}
                alt={store.name}
                className={`h-9 w-9 rounded-full object-cover ${theme.logoRing}`}
              />
            ) : (
              <div className={`flex h-9 w-9 items-center justify-center rounded-full text-base font-bold ${theme.logoFallback} ${theme.logoRing}`}>
                {store.name[0]}
              </div>
            )}
            <span className={`text-lg ${theme.name}`}>{store.name}</span>
          </Link>

          <div className="flex items-center gap-2 sm:gap-3">
            {/* السلة — العنصر الأساسي، يبقى ظاهراً دائماً */}
            <Link
              href={`${base}/cart`}
              className={`relative flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition ${theme.cartBtn}`}
            >
              🛒 السلة
              {count > 0 && (
                <span className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[11px] font-bold text-white shadow">
                  {count}
                </span>
              )}
            </Link>

            {/* زر فتح القائمة الجانبية */}
            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              aria-label="القائمة"
              className={`relative flex h-10 w-10 items-center justify-center rounded-xl transition ${theme.cartBtn}`}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
              </svg>
              {wishlistCount > 0 && (
                <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
                  {wishlistCount}
                </span>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* ── القائمة الجانبية (drawer من اليمين) ── */}
      {/* الخلفية المعتمة */}
      <div
        onClick={close}
        aria-hidden="true"
        className={`fixed inset-0 z-[90] bg-black/40 backdrop-blur-sm transition-opacity duration-300 ${
          menuOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      />
      {/* اللوحة المنزلقة */}
      <aside
        dir="rtl"
        className={`fixed inset-y-0 right-0 z-[100] flex w-72 max-w-[82%] flex-col bg-white shadow-2xl transition-transform duration-300 ease-out dark:bg-gray-900 ${
          menuOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* رأس القائمة */}
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-4 dark:border-gray-800">
          <span className="flex items-center gap-2.5 font-bold text-gray-900 dark:text-white">
            {store.logo_url ? (
              <img src={store.logo_url} alt={store.name} className="h-8 w-8 rounded-full object-cover" />
            ) : (
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 text-sm dark:bg-gray-800">{store.name[0]}</span>
            )}
            <span className="truncate">{store.name}</span>
          </span>
          <button
            onClick={close}
            aria-label="إغلاق"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 transition hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto py-2">
          <p className="px-4 pb-1 pt-3 text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">المتجر</p>

          <DrawerLink href={base} onClick={close}>🏠 الرئيسية</DrawerLink>
          <DrawerLink href={`${base}#products`} onClick={close}>🛍️ جميع المنتجات</DrawerLink>
          <DrawerLink href={`${base}/cart`} onClick={close} badge={count}>🛒 سلة التسوق</DrawerLink>
          <DrawerLink href={`${base}/wishlist`} onClick={close} badge={wishlistCount}>❤️ المفضلة</DrawerLink>

          {store.whatsapp && (
            <>
              <div className="my-2 border-t border-gray-100 dark:border-gray-800" />
              <a
                href={`https://wa.me/${store.whatsapp.replace(/\D/g, '')}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={close}
                className="flex items-center gap-2 px-4 py-3 text-sm text-gray-700 transition hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-800"
              >
                <span className="text-green-600 dark:text-green-400"><WhatsAppIcon /></span> تواصل عبر واتساب
              </a>
            </>
          )}

          <div className="my-2 border-t border-gray-100 dark:border-gray-800" />
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-sm text-gray-700 dark:text-gray-200">🌙 الوضع الليلي</span>
            <ThemeToggle className="rounded-lg bg-gray-100 p-1.5 text-gray-700 dark:bg-gray-800 dark:text-gray-200" />
          </div>
        </nav>
      </aside>
    </>
  )
}

function DrawerLink({ href, onClick, badge, children }: {
  href: string
  onClick: () => void
  badge?: number
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className="flex items-center justify-between px-4 py-3 text-sm font-medium text-gray-700 transition hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-800"
    >
      <span className="flex items-center gap-2">{children}</span>
      {badge != null && badge > 0 && (
        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[11px] font-bold text-white">{badge}</span>
      )}
    </Link>
  )
}

function WhatsAppIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  )
}
