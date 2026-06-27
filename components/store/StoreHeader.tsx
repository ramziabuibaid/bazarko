'use client'

import { useState, useRef, useEffect } from 'react'
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
  const btnRef = useRef<HTMLButtonElement>(null)
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null)

  // حساب موضع القائمة (fixed) من موضع الزر — يضمن ظهورها فوق أي عنصر مهما كان overflow الأب
  function computePos() {
    const r = btnRef.current?.getBoundingClientRect()
    if (r) setPos({ top: r.bottom + 8, right: window.innerWidth - r.right })
  }
  function toggleMenu() {
    if (!menuOpen) computePos()
    setMenuOpen(o => !o)
  }
  useEffect(() => {
    if (!menuOpen) return
    const onChange = () => computePos()
    window.addEventListener('resize', onChange)
    window.addEventListener('scroll', onChange, true)
    return () => {
      window.removeEventListener('resize', onChange)
      window.removeEventListener('scroll', onChange, true)
    }
  }, [menuOpen])

  return (
    <header
      className={`sticky top-0 z-40 ${theme.header} relative`}
    >
      {/* طبقة اللمعان — معزولة بـ overflow-hidden حتى لا تقصّ القائمة المنبثقة */}
      {theme.shine && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-0 overflow-hidden animate-header-shine"
        />
      )}
      <div className="relative z-10 mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <Link href={`/store/${country}/${subdomain}`} className="flex items-center gap-2.5">
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
            href={`/store/${country}/${subdomain}/cart`}
            className={`relative flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition ${theme.cartBtn}`}
          >
            🛒 السلة
            {count > 0 && (
              <span className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[11px] font-bold text-white shadow">
                {count}
              </span>
            )}
          </Link>

          {/* قائمة منسدلة لبقية الإجراءات (تبسيط الهيدر) */}
          <div className="relative">
            <button
              ref={btnRef}
              type="button"
              onClick={toggleMenu}
              aria-label="المزيد"
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

            {menuOpen && pos && (
              <>
                <div className="fixed inset-0 z-[55]" onClick={() => setMenuOpen(false)} />
                <div
                  className="fixed z-[60] w-52 overflow-hidden rounded-2xl border border-gray-100 bg-white py-1 shadow-xl dark:border-gray-800 dark:bg-gray-900"
                  style={{ top: pos.top, right: pos.right }}
                  dir="rtl"
                >
                  <Link
                    href={`/store/${country}/${subdomain}/wishlist`}
                    onClick={() => setMenuOpen(false)}
                    className="flex items-center justify-between px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-800"
                  >
                    <span className="flex items-center gap-2">❤️ المفضلة</span>
                    {wishlistCount > 0 && (
                      <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[11px] font-bold text-white">{wishlistCount}</span>
                    )}
                  </Link>

                  {store.whatsapp && (
                    <a
                      href={`https://wa.me/${store.whatsapp.replace(/\D/g, '')}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => setMenuOpen(false)}
                      className="flex items-center gap-2 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-800"
                    >
                      <span className="text-green-600 dark:text-green-400"><WhatsAppIcon /></span> تواصل عبر واتساب
                    </a>
                  )}

                  <div className="flex items-center justify-between border-t border-gray-100 px-4 py-2.5 dark:border-gray-800">
                    <span className="text-sm text-gray-700 dark:text-gray-200">🌙 الوضع الليلي</span>
                    <ThemeToggle className="rounded-lg bg-gray-100 p-1.5 text-gray-700 dark:bg-gray-800 dark:text-gray-200" />
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </header>
  )
}

function WhatsAppIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  )
}
