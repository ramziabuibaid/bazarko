'use client'

import { useCart } from '@/lib/store/cart'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'

export default function CartPage() {
  const { items, updateQty, removeItem, total, clearCart } = useCart()
  const params = useParams()
  const router = useRouter()
  const country = params.country as string
  const subdomain = params.subdomain as string
  const base = `/store/${country}/${subdomain}`

  if (!items.length) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-white px-4 text-center" dir="rtl">
        <p className="text-5xl">🛒</p>
        <h2 className="mt-4 text-xl font-semibold text-gray-900">السلة فارغة</h2>
        <p className="mt-2 text-sm text-gray-500">لم تضف أي منتجات بعد</p>
        <Link
          href={base}
          className="mt-6 rounded-xl bg-gray-900 px-6 py-2.5 text-sm font-medium text-white"
        >
          تصفح المنتجات
        </Link>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-white" dir="rtl">
      <header className="border-b border-gray-100 px-4 py-4">
        <div className="mx-auto flex max-w-2xl items-center justify-between">
          <Link href={base} className="text-sm text-gray-500 hover:text-gray-700">→ متابعة التسوق</Link>
          <h1 className="font-semibold text-gray-900">سلة التسوق</h1>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-6">
        <div className="space-y-3">
          {items.map(item => (
            <div key={item.productId} className="flex items-center gap-4 rounded-2xl border border-gray-100 p-4">
              <div className="h-16 w-16 flex-shrink-0 overflow-hidden rounded-xl bg-gray-50">
                {item.thumbnail ? (
                  <img src={item.thumbnail} alt={item.name} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center text-2xl">🛍️</div>
                )}
              </div>

              <div className="flex-1 min-w-0">
                <p className="truncate font-medium text-gray-900">{item.name}</p>
                <p className="text-sm text-gray-500">
                  {item.price.toLocaleString('ar')} × {item.quantity}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => updateQty(item.productId, item.quantity - 1)}
                  className="flex h-7 w-7 items-center justify-center rounded-full border border-gray-200 text-sm hover:bg-gray-50"
                >
                  −
                </button>
                <span className="w-6 text-center text-sm font-medium">{item.quantity}</span>
                <button
                  onClick={() => updateQty(item.productId, item.quantity + 1)}
                  disabled={!!item.max && item.quantity >= item.max}
                  className="flex h-7 w-7 items-center justify-center rounded-full border border-gray-200 text-sm hover:bg-gray-50 disabled:opacity-40"
                >
                  +
                </button>
                <button
                  onClick={() => removeItem(item.productId)}
                  className="mr-1 text-gray-300 hover:text-red-400"
                >
                  🗑️
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* الملخص */}
        <div className="mt-6 rounded-2xl bg-gray-50 p-5">
          <div className="flex items-center justify-between text-sm text-gray-600">
            <span>المجموع الجزئي</span>
            <span>{total().toLocaleString('ar')}</span>
          </div>
          <div className="mt-2 flex items-center justify-between text-sm text-gray-600">
            <span>الشحن</span>
            <span className="text-gray-400">يُحدد لاحقاً</span>
          </div>
          <div className="mt-3 border-t border-gray-200 pt-3 flex items-center justify-between font-semibold text-gray-900">
            <span>الإجمالي</span>
            <span className="text-lg">{total().toLocaleString('ar')}</span>
          </div>
        </div>

        <button
          onClick={() => router.push(`${base}/checkout`)}
          className="mt-4 w-full rounded-xl bg-gray-900 py-3.5 text-sm font-semibold text-white hover:bg-gray-700"
        >
          المتابعة للدفع
        </button>

        <button
          onClick={clearCart}
          className="mt-2 w-full py-2 text-sm text-gray-400 hover:text-red-400"
        >
          مسح السلة
        </button>
      </main>
    </div>
  )
}
