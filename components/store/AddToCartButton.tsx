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

  function ensureInCart() {
    if (!inCart) {
      addItem({ productId, name, price, thumbnail, max: maxQty })
      if (storeId) trackEvent(storeId, 'add_to_cart', { productId })
    }
  }

  function handleAdd() {
    ensureInCart()
    setAdded(true)
    setTimeout(() => setAdded(false), 1500)
  }

  function handleBuyNow() {
    ensureInCart()
    router.push(`/store/${country}/${subdomain}/checkout`)
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
        <div className="flex gap-2">
          <button
            onClick={() => router.push(`/store/${country}/${subdomain}/cart`)}
            className="flex-1 rounded-xl bg-gray-100 py-3 text-sm font-semibold text-gray-900 transition hover:bg-gray-200 dark:bg-gray-800 dark:text-white dark:hover:bg-gray-700"
          >
            السلة ({inCart.quantity})
          </button>
          <button
            onClick={handleBuyNow}
            className="flex-1 rounded-xl bg-gray-900 py-3 text-sm font-semibold text-white transition hover:bg-gray-800 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
          >
            ⚡ اشترِ الآن
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex gap-2 w-full">
      <button
        onClick={handleAdd}
        className={`flex flex-1 items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold transition ${
          added
            ? 'bg-emerald-500 text-white'
            : 'bg-gray-100 text-gray-900 hover:bg-gray-200 dark:bg-gray-800 dark:text-white dark:hover:bg-gray-700'
        }`}
      >
        {added ? (
          <>✓ أُضيف</>
        ) : (
          <>
            <CartIcon />
            أضف للسلة
          </>
        )}
      </button>
      <button
        onClick={handleBuyNow}
        className="flex-1 rounded-xl bg-gray-900 py-3 text-sm font-semibold text-white transition hover:bg-gray-800 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
      >
        ⚡ اشترِ الآن
      </button>
    </div>
  )
}

function CartIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="9" cy="21" r="1" />
      <circle cx="20" cy="21" r="1" />
      <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
    </svg>
  )
}
