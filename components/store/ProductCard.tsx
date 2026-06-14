'use client'

import Link from 'next/link'
import { useCart } from '@/lib/store/cart'
import { useState } from 'react'
import WishlistButton from './WishlistButton'

interface Product {
  id: string
  name: string
  slug: string
  price: number
  compare_price: number | null
  price_secondary?: number | null
  thumbnail_url: string | null
  stock_available: number | null
}

interface Props {
  product: Product
  currencyCode: string
  storeId: string
  country: string
  subdomain: string
  secondaryCurrencyCode?: string | null
  exchangeRate?: number | null
  preferSecondary?: boolean
  offerSold?: { sold: number; max: number } | null
}

export default function ProductCard({ product, currencyCode, storeId, country, subdomain, secondaryCurrencyCode, exchangeRate, preferSecondary, offerSold }: Props) {
  const addItem = useCart(s => s.addItem)
  const items = useCart(s => s.items)
  const updateQty = useCart(s => s.updateQty)
  const [added, setAdded] = useState(false)

  const inCart = items.find(i => i.productId === product.id)
  const outOfStock = (product.stock_available ?? 1) <= 0

  const discount = product.compare_price
    ? Math.round((1 - product.price / product.compare_price) * 100)
    : null

  const secondaryPrice = secondaryCurrencyCode
    ? (product.price_secondary ?? (exchangeRate ? Math.round(product.price * exchangeRate) : null))
    : null

  function handleAdd(e: React.MouseEvent) {
    e.preventDefault()
    if (outOfStock) return
    addItem({
      productId: product.id,
      name: product.name,
      price: product.price,
      thumbnail: product.thumbnail_url,
      max: product.stock_available,
    })
    setAdded(true)
    setTimeout(() => setAdded(false), 1500)
  }

  return (
    <Link
      href={`/store/${country}/${subdomain}/product/${product.slug}`}
      className="group flex flex-col overflow-hidden rounded-2xl border border-gray-100 bg-white transition hover:shadow-md dark:border-gray-800 dark:bg-gray-900 dark:hover:border-gray-700"
    >
      {/* الصورة */}
      <div className="relative aspect-square overflow-hidden bg-gray-50 dark:bg-gray-800">
        {product.thumbnail_url ? (
          <img
            src={product.thumbnail_url}
            alt={product.name}
            className="h-full w-full object-cover transition group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-4xl text-gray-300 dark:text-gray-600">🛍️</div>
        )}
        {discount && (
          <span className="absolute right-2 top-2 rounded-full bg-red-500 px-2 py-0.5 text-xs font-bold text-white">
            -{discount}%
          </span>
        )}
        <WishlistButton
          size="sm"
          className="absolute left-2 top-2 opacity-0 transition-opacity group-hover:opacity-100"
          item={{
            productId: product.id,
            name: product.name,
            price: product.price,
            price_secondary: product.price_secondary ?? null,
            thumbnail: product.thumbnail_url,
            slug: product.slug,
          }}
        />
        {outOfStock && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/80 dark:bg-gray-900/80">
            <span className="text-sm font-medium text-gray-500 dark:text-gray-400">نفد المخزون</span>
          </div>
        )}
      </div>

      {/* المعلومات */}
      <div className="flex flex-1 flex-col p-3">
        <p className="line-clamp-2 text-sm font-medium text-gray-900 dark:text-gray-100">{product.name}</p>

        <div className="mt-2">
          {preferSecondary && secondaryPrice !== null ? (
            <>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-gray-900 dark:text-white">
                  {secondaryPrice.toLocaleString('ar')} {secondaryCurrencyCode}
                </span>
                {product.compare_price && (
                  <span className="text-xs text-gray-400 line-through dark:text-gray-500">
                    {product.compare_price.toLocaleString('ar')}
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">
                ≈ {product.price.toLocaleString('ar')} {currencyCode}
              </p>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-gray-900 dark:text-white">
                  {product.price.toLocaleString('ar')} {currencyCode}
                </span>
                {product.compare_price && (
                  <span className="text-xs text-gray-400 line-through dark:text-gray-500">
                    {product.compare_price.toLocaleString('ar')}
                  </span>
                )}
              </div>
              {secondaryPrice !== null && (
                <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">
                  ≈ {secondaryPrice.toLocaleString('ar')} {secondaryCurrencyCode}
                </p>
              )}
            </>
          )}
        </div>

        {offerSold && offerSold.max > 0 && (() => {
          const pct = Math.min(100, Math.round((offerSold.sold / offerSold.max) * 100))
          const remaining = Math.max(0, offerSold.max - offerSold.sold)
          return (
            <div className="mt-2">
              <div className="h-1.5 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                <div
                  className={`h-full rounded-full ${pct >= 80 ? 'bg-red-500' : 'bg-orange-400'}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <p className={`mt-1 text-[11px] ${remaining <= 5 ? 'font-semibold text-red-600 dark:text-red-400' : 'text-gray-500 dark:text-gray-400'}`}>
                {remaining <= 0
                  ? 'نفدت كمية العرض'
                  : remaining <= 5
                    ? `🔥 بقي ${remaining} فقط!`
                    : `تم بيع ${pct}% من كمية العرض`}
              </p>
            </div>
          )
        })()}

        <button
          onClick={handleAdd}
          disabled={outOfStock}
          className={`mt-3 w-full rounded-xl py-2 text-sm font-medium transition ${
            outOfStock
              ? 'cursor-not-allowed bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-600'
              : inCart
                ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400'
                : added
                  ? 'bg-emerald-500 text-white'
                  : 'bg-gray-900 text-white hover:bg-gray-700 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-200'
          }`}
        >
          {outOfStock ? 'نفد' : inCart ? `في السلة (${inCart.quantity})` : added ? '✓ أُضيف' : 'أضف للسلة'}
        </button>
      </div>
    </Link>
  )
}
