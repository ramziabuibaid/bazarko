'use client'

import { useEffect, useState } from 'react'
import { useWishlist, WishlistItem } from '@/lib/store/wishlist'
import { trackEvent } from '@/components/store/StoreAnalyticsTracker'

interface Props {
  item: WishlistItem
  size?: 'sm' | 'md'
  className?: string
  storeId?: string
}

export default function WishlistButton({ item, size = 'md', className = '', storeId }: Props) {
  const toggle  = useWishlist(s => s.toggle)
  const has     = useWishlist(s => s.has)
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const active = mounted && has(item.productId)
  const s = size === 'sm' ? 'h-7 w-7' : 'h-9 w-9'
  const icon = size === 'sm' ? 14 : 18

  function handleToggle(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    const wasActive = has(item.productId)
    toggle(item)
    if (!wasActive && storeId) {
      trackEvent(storeId, 'add_to_wishlist', { productId: item.productId })
    }
  }

  return (
    <button
      onClick={handleToggle}
      aria-label={active ? 'إزالة من المفضلة' : 'إضافة للمفضلة'}
      className={`flex items-center justify-center rounded-full transition ${s} ${
        active
          ? 'bg-red-500 text-white shadow-lg shadow-red-500/30'
          : 'bg-white/90 text-gray-400 hover:text-red-400 backdrop-blur-sm dark:bg-gray-900/90 dark:text-gray-500'
      } ${className}`}
    >
      <svg width={icon} height={icon} viewBox="0 0 24 24"
        fill={active ? 'currentColor' : 'none'}
        stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" />
      </svg>
    </button>
  )
}
