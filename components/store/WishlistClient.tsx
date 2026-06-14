'use client'

import { useWishlist } from '@/lib/store/wishlist'
import { useCart } from '@/lib/store/cart'
import Link from 'next/link'
import { useState, useEffect } from 'react'
import WishlistButton from './WishlistButton'

interface Props {
  country: string
  subdomain: string
  currencyCode: string
  secondaryCurrencyCode: string | null
  exchangeRate: number | null
  preferSecondary: boolean
}

export default function WishlistClient({
  country, subdomain,
  currencyCode, secondaryCurrencyCode, exchangeRate, preferSecondary,
}: Props) {
  const items   = useWishlist(s => s.items)
  const clear   = useWishlist(s => s.clear)
  const addItem = useCart(s => s.addItem)
  const cartItems = useCart(s => s.items)
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const base = `/store/${country}/${subdomain}`

  function secondaryPrice(price: number): number | null {
    if (!secondaryCurrencyCode || !exchangeRate) return null
    return Math.round(price * exchangeRate)
  }

  if (!mounted) return null

  if (!items.length) {
    return (
      <main className="flex flex-col items-center justify-center px-4 py-24 text-center">
        <span className="text-6xl">🤍</span>
        <h2 className="mt-4 text-xl font-semibold text-gray-900 dark:text-white">المفضلة فارغة</h2>
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">احفظ المنتجات التي تعجبك هنا</p>
        <Link
          href={base}
          className="mt-6 rounded-xl bg-gray-900 px-6 py-2.5 text-sm font-medium text-white dark:bg-white dark:text-gray-900"
        >
          تصفح المنتجات
        </Link>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900 dark:text-white">
          المفضلة
          <span className="mr-2 text-sm font-normal text-gray-400">({items.length})</span>
        </h1>
        <button
          onClick={clear}
          className="text-sm text-gray-400 hover:text-red-400 transition-colors"
        >
          مسح الكل
        </button>
      </div>

      <div className="space-y-3">
        {items.map(item => {
          const sec = secondaryPrice(item.price)
          const inCart = cartItems.some(c => c.productId === item.productId)

          return (
            <div key={item.productId}
              className="flex items-center gap-4 rounded-2xl border border-gray-100 p-4 dark:border-gray-800">
              {/* الصورة */}
              <Link href={`${base}/product/${item.slug}`} className="shrink-0">
                <div className="h-16 w-16 overflow-hidden rounded-xl bg-gray-50 dark:bg-gray-800">
                  {item.thumbnail ? (
                    <img src={item.thumbnail} alt={item.name} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-2xl">🛍️</div>
                  )}
                </div>
              </Link>

              {/* الاسم والسعر */}
              <div className="min-w-0 flex-1">
                <Link href={`${base}/product/${item.slug}`}>
                  <p className="truncate font-medium text-gray-900 hover:text-gray-700 dark:text-white dark:hover:text-gray-300">
                    {item.name}
                  </p>
                </Link>
                <div className="mt-0.5">
                  {preferSecondary && sec !== null ? (
                    <>
                      <span className="text-sm font-semibold text-gray-900 dark:text-white">
                        {sec.toLocaleString('ar')} {secondaryCurrencyCode}
                      </span>
                      <span className="mr-1.5 text-xs text-gray-400 dark:text-gray-500">
                        ≈ {item.price.toLocaleString('ar')} {currencyCode}
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="text-sm font-semibold text-gray-900 dark:text-white">
                        {item.price.toLocaleString('ar')} {currencyCode}
                      </span>
                      {sec !== null && (
                        <span className="mr-1.5 text-xs text-gray-400 dark:text-gray-500">
                          ≈ {sec.toLocaleString('ar')} {secondaryCurrencyCode}
                        </span>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* الأزرار */}
              <div className="flex shrink-0 items-center gap-2">
                <button
                  onClick={() => addItem({ productId: item.productId, name: item.name, price: item.price, thumbnail: item.thumbnail, max: null })}
                  className={`rounded-xl px-3 py-2 text-sm font-medium transition ${
                    inCart
                      ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400'
                      : 'bg-gray-900 text-white hover:bg-gray-700 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-200'
                  }`}
                >
                  {inCart ? '✓ في السلة' : 'أضف للسلة'}
                </button>
                <WishlistButton
                  size="sm"
                  item={{ productId: item.productId, name: item.name, price: item.price, price_secondary: item.price_secondary, thumbnail: item.thumbnail, slug: item.slug }}
                />
              </div>
            </div>
          )
        })}
      </div>

      <div className="mt-6 rounded-2xl border border-gray-100 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-900">
        <p className="text-center text-sm text-gray-500 dark:text-gray-400">
          {items.length} منتج في المفضلة
        </p>
        <Link
          href={base}
          className="mt-3 flex w-full items-center justify-center rounded-xl border border-gray-200 py-2.5 text-sm font-medium text-gray-600 transition hover:bg-gray-100 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800"
        >
          متابعة التسوق
        </Link>
      </div>
    </main>
  )
}
