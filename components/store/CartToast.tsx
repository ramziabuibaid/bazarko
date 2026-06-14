'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useCart } from '@/lib/store/cart'

interface Props {
  country: string
  subdomain: string
}

export default function CartToast({ country, subdomain }: Props) {
  const lastAdded     = useCart(s => s.lastAdded)
  const clearLastAdded = useCart(s => s.clearLastAdded)
  const count          = useCart(s => s.count)
  const router         = useRouter()

  const [visible, setVisible]     = useState(false)
  const [mounted, setMounted]     = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => { setMounted(true) }, [])

  useEffect(() => {
    if (!lastAdded) return
    // أظهر الـ toast
    setVisible(true)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      setVisible(false)
      setTimeout(clearLastAdded, 300) // بعد انتهاء انيميشن الإخفاء
    }, 3000)
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [lastAdded])

  if (!mounted || !lastAdded) return null

  return (
    <div
      className={`fixed bottom-6 left-1/2 z-[9999] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 transition-all duration-300 ${
        visible ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0 pointer-events-none'
      }`}
    >
      <div className="flex items-center gap-3 rounded-2xl bg-gray-900 px-4 py-3 shadow-2xl ring-1 ring-white/10 dark:bg-gray-800">
        {/* صورة المنتج */}
        {lastAdded.thumbnail ? (
          <img
            src={lastAdded.thumbnail}
            alt={lastAdded.name}
            className="h-11 w-11 shrink-0 rounded-xl object-cover"
          />
        ) : (
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/10 text-xl">
            🛍️
          </div>
        )}

        {/* النص */}
        <div className="min-w-0 flex-1">
          <p className="text-xs text-emerald-400 font-medium">أُضيف للسلة</p>
          <p className="truncate text-sm font-semibold text-white">{lastAdded.name}</p>
        </div>

        {/* زر السلة */}
        <button
          onClick={() => {
            setVisible(false)
            clearLastAdded()
            router.push(`/store/${country}/${subdomain}/cart`)
          }}
          className="shrink-0 rounded-xl bg-white px-3 py-2 text-xs font-semibold text-gray-900 transition hover:bg-gray-100"
        >
          السلة ({count()})
        </button>

        {/* زر إغلاق */}
        <button
          onClick={() => { setVisible(false); setTimeout(clearLastAdded, 300) }}
          className="shrink-0 text-gray-500 hover:text-white"
          aria-label="إغلاق"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="2" y1="2" x2="12" y2="12" />
            <line x1="12" y1="2" x2="2" y2="12" />
          </svg>
        </button>
      </div>
    </div>
  )
}
