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
  currencyCode: string
  outOfStock?: boolean
}

// شريط ثابت أسفل الشاشة على الجوال: السعر + أضف للسلة + اشترِ الآن
export default function StickyBuyBar({
  productId, name, price, thumbnail, maxQty, country, subdomain, storeId, currencyCode, outOfStock,
}: Props) {
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

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-gray-100 bg-white/95 px-4 py-3 backdrop-blur md:hidden dark:border-gray-800 dark:bg-gray-950/95" dir="rtl">
      <div className="mx-auto flex max-w-4xl items-center gap-3">
        <div className="shrink-0">
          <p className="text-[11px] text-gray-400 dark:text-gray-500">السعر</p>
          <p className="text-base font-bold text-gray-900 dark:text-white">
            {price.toLocaleString('ar-u-nu-latn')} {currencyCode}
          </p>
        </div>

        {outOfStock ? (
          <div className="flex-1 rounded-xl bg-gray-100 py-3 text-center text-sm font-medium text-gray-500 dark:bg-gray-800 dark:text-gray-400">
            نفد المخزون
          </div>
        ) : inCart ? (
          <div className="flex flex-1 items-center gap-2">
            <div className="flex items-center gap-2 rounded-xl bg-gray-50 px-2 py-1.5 dark:bg-gray-900">
              <button onClick={() => updateQty(productId, inCart.quantity - 1)}
                className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-lg shadow-sm dark:bg-gray-800 dark:text-white">−</button>
              <span className="min-w-[1.25rem] text-center text-sm font-semibold text-gray-900 dark:text-white">{inCart.quantity}</span>
              <button onClick={() => updateQty(productId, inCart.quantity + 1)}
                disabled={!!maxQty && inCart.quantity >= maxQty}
                className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-lg shadow-sm disabled:opacity-40 dark:bg-gray-800 dark:text-white">+</button>
            </div>
            <button onClick={handleBuyNow}
              className="flex-1 rounded-xl bg-gray-900 py-3 text-sm font-semibold text-white dark:bg-white dark:text-gray-900">
              ⚡ اشترِ الآن
            </button>
          </div>
        ) : (
          <div className="flex flex-1 gap-2">
            <button onClick={handleAdd}
              className={`flex-1 rounded-xl py-3 text-sm font-semibold transition ${
                added ? 'bg-emerald-500 text-white' : 'border border-gray-900 text-gray-900 dark:border-white dark:text-white'
              }`}>
              {added ? '✓ أُضيف' : '🛒 أضف للسلة'}
            </button>
            <button onClick={handleBuyNow}
              className="flex-1 rounded-xl bg-gray-900 py-3 text-sm font-semibold text-white dark:bg-white dark:text-gray-900">
              ⚡ اشترِ الآن
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
