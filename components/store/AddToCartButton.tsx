'use client'

import { useCart } from '@/lib/store/cart'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { trackEvent } from '@/components/store/StoreAnalyticsTracker'

interface Props {
  productId: string
  name: string
  price: number
  thumbnail: string | null
  maxQty: number | null
  country: string
  subdomain: string
  storeId?: string
}

export default function AddToCartButton({ productId, name, price, thumbnail, maxQty, country, subdomain, storeId }: Props) {
  const { items, addItem, updateQty } = useCart()
  const router = useRouter()
  const inCart = items.find(i => i.productId === productId)
  const [added, setAdded] = useState(false)

  function handleAdd() {
    addItem({ productId, name, price, thumbnail, max: maxQty })
    setAdded(true)
    setTimeout(() => setAdded(false), 1500)
    if (storeId) trackEvent(storeId, 'add_to_cart', { productId })
  }

  if (inCart) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between rounded-xl bg-gray-50 px-4 py-3 dark:bg-gray-900">
          <button
            onClick={() => updateQty(productId, inCart.quantity - 1)}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-lg shadow-sm hover:bg-gray-100 dark:bg-gray-800 dark:text-white dark:hover:bg-gray-700"
          >
            −
          </button>
          <span className="text-base font-semibold text-gray-900 dark:text-white">{inCart.quantity}</span>
          <button
            onClick={() => updateQty(productId, inCart.quantity + 1)}
            disabled={!!maxQty && inCart.quantity >= maxQty}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-lg shadow-sm hover:bg-gray-100 disabled:opacity-40 dark:bg-gray-800 dark:text-white dark:hover:bg-gray-700"
          >
            +
          </button>
        </div>
        <button
          onClick={() => router.push(`/store/${country}/${subdomain}/cart`)}
          className="w-full rounded-xl bg-gray-900 py-3 text-sm font-semibold text-white hover:bg-gray-700 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-200"
        >
          اذهب للسلة ({inCart.quantity} قطعة)
        </button>
      </div>
    )
  }

  return (
    <button
      onClick={handleAdd}
      className={`w-full rounded-xl py-3 text-sm font-semibold transition ${
        added ? 'bg-emerald-500 text-white' : 'bg-gray-900 text-white hover:bg-gray-700 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-200'
      }`}
    >
      {added ? '✓ أُضيف للسلة' : 'أضف للسلة'}
    </button>
  )
}
