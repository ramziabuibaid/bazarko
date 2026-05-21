'use client'

import Link from 'next/link'
import { useCart } from '@/lib/store/cart'
import { useState } from 'react'

interface Product {
  id: string
  name: string
  slug: string
  price: number
  compare_price: number | null
  thumbnail_url: string | null
  stock_available: number | null
}

interface Props {
  product: Product
  currencyCode: string
  storeId: string
  country: string
  subdomain: string
}

export default function ProductCard({ product, currencyCode, storeId, country, subdomain }: Props) {
  const addItem = useCart(s => s.addItem)
  const items = useCart(s => s.items)
  const updateQty = useCart(s => s.updateQty)
  const [added, setAdded] = useState(false)

  const inCart = items.find(i => i.productId === product.id)
  const outOfStock = (product.stock_available ?? 1) <= 0

  const discount = product.compare_price
    ? Math.round((1 - product.price / product.compare_price) * 100)
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
      className="group flex flex-col overflow-hidden rounded-2xl border border-gray-100 bg-white transition hover:shadow-md"
    >
      {/* الصورة */}
      <div className="relative aspect-square overflow-hidden bg-gray-50">
        {product.thumbnail_url ? (
          <img
            src={product.thumbnail_url}
            alt={product.name}
            className="h-full w-full object-cover transition group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-4xl text-gray-300">🛍️</div>
        )}
        {discount && (
          <span className="absolute right-2 top-2 rounded-full bg-red-500 px-2 py-0.5 text-xs font-bold text-white">
            -{discount}%
          </span>
        )}
        {outOfStock && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/80">
            <span className="text-sm font-medium text-gray-500">نفد المخزون</span>
          </div>
        )}
      </div>

      {/* المعلومات */}
      <div className="flex flex-1 flex-col p-3">
        <p className="line-clamp-2 text-sm font-medium text-gray-900">{product.name}</p>

        <div className="mt-2 flex items-center gap-2">
          <span className="font-semibold text-gray-900">
            {product.price.toLocaleString('ar')} {currencyCode}
          </span>
          {product.compare_price && (
            <span className="text-xs text-gray-400 line-through">
              {product.compare_price.toLocaleString('ar')}
            </span>
          )}
        </div>

        <button
          onClick={handleAdd}
          disabled={outOfStock}
          className={`mt-3 w-full rounded-xl py-2 text-sm font-medium transition ${
            outOfStock
              ? 'cursor-not-allowed bg-gray-100 text-gray-400'
              : inCart
                ? 'bg-emerald-50 text-emerald-700'
                : added
                  ? 'bg-emerald-500 text-white'
                  : 'bg-gray-900 text-white hover:bg-gray-700'
          }`}
        >
          {outOfStock ? 'نفد' : inCart ? `في السلة (${inCart.quantity})` : added ? '✓ أُضيف' : 'أضف للسلة'}
        </button>
      </div>
    </Link>
  )
}
