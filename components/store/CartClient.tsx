'use client'

import { useCart } from '@/lib/store/cart'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

interface Props {
  country: string
  subdomain: string
  currencyCode: string
  secondaryCurrencyCode: string | null
  exchangeRate: number | null
  preferSecondary: boolean
}

export default function CartClient({
  country, subdomain,
  currencyCode, secondaryCurrencyCode, exchangeRate, preferSecondary,
}: Props) {
  const { items, updateQty, removeItem, total, clearCart } = useCart()
  const router = useRouter()
  const base = `/store/${country}/${subdomain}`

  // السعر الثانوي لمنتج معين
  function secondaryPrice(price: number): number | null {
    if (!secondaryCurrencyCode || !exchangeRate) return null
    return Math.round(price * exchangeRate)
  }

  // عرض سعر منتج واحد — السطر الكبير والسطر الصغير
  function PriceDisplay({ price, className = '' }: { price: number; className?: string }) {
    const sec = secondaryPrice(price)
    if (preferSecondary && sec !== null) {
      return (
        <span className={className}>
          <span>{sec.toLocaleString('ar-u-nu-latn')} {secondaryCurrencyCode}</span>
          <span className="block text-xs text-gray-400 dark:text-gray-500">
            ≈ {price.toLocaleString('ar-u-nu-latn')} {currencyCode}
          </span>
        </span>
      )
    }
    return (
      <span className={className}>
        <span>{price.toLocaleString('ar-u-nu-latn')} {currencyCode}</span>
        {sec !== null && (
          <span className="block text-xs text-gray-400 dark:text-gray-500">
            ≈ {sec.toLocaleString('ar-u-nu-latn')} {secondaryCurrencyCode}
          </span>
        )}
      </span>
    )
  }

  const totalPrimary = total()
  const totalSecondary = secondaryPrice(totalPrimary)

  if (!items.length) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-white px-4 text-center dark:bg-gray-950" dir="rtl">
        <p className="text-5xl">🛒</p>
        <h2 className="mt-4 text-xl font-semibold text-gray-900 dark:text-white">السلة فارغة</h2>
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">لم تضف أي منتجات بعد</p>
        <Link href={base} className="mt-6 rounded-xl bg-gray-900 px-6 py-2.5 text-sm font-medium text-white dark:bg-white dark:text-gray-900">
          تصفح المنتجات
        </Link>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-white dark:bg-gray-950" dir="rtl">
      <header className="border-b border-gray-100 px-4 py-4 dark:border-gray-800">
        <div className="mx-auto flex max-w-2xl items-center justify-between">
          <Link href={base} className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
            → متابعة التسوق
          </Link>
          <h1 className="font-semibold text-gray-900 dark:text-white">سلة التسوق</h1>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-6">
        <div className="space-y-3">
          {items.map(item => {
            const lineTotal = item.price * item.quantity
            const lineSecondary = secondaryPrice(lineTotal)

            return (
              <div key={item.productId} className="flex items-center gap-4 rounded-2xl border border-gray-100 p-4 dark:border-gray-800">
                {/* الصورة */}
                <div className="h-16 w-16 flex-shrink-0 overflow-hidden rounded-xl bg-gray-50 dark:bg-gray-800">
                  {item.thumbnail ? (
                    <img src={item.thumbnail} alt={item.name} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-2xl">🛍️</div>
                  )}
                </div>

                {/* الاسم والسعر */}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-gray-900 dark:text-white">{item.name}</p>

                  {/* سعر القطعة */}
                  <div className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
                    {preferSecondary && secondaryPrice(item.price) !== null ? (
                      <>
                        <span>{secondaryPrice(item.price)!.toLocaleString('ar-u-nu-latn')} {secondaryCurrencyCode}</span>
                        <span className="mx-1 text-gray-300 dark:text-gray-600">·</span>
                        <span className="text-xs text-gray-400 dark:text-gray-500">
                          {item.price.toLocaleString('ar-u-nu-latn')} {currencyCode}
                        </span>
                      </>
                    ) : (
                      <>
                        <span>{item.price.toLocaleString('ar-u-nu-latn')} {currencyCode}</span>
                        {secondaryPrice(item.price) !== null && (
                          <>
                            <span className="mx-1 text-gray-300 dark:text-gray-600">·</span>
                            <span className="text-xs text-gray-400 dark:text-gray-500">
                              {secondaryPrice(item.price)!.toLocaleString('ar-u-nu-latn')} {secondaryCurrencyCode}
                            </span>
                          </>
                        )}
                      </>
                    )}
                    <span className="mx-1 text-gray-300 dark:text-gray-600">×</span>
                    <span>{item.quantity}</span>
                  </div>

                  {/* المجموع لهذا المنتج */}
                  <div className="mt-1">
                    {preferSecondary && lineSecondary !== null ? (
                      <>
                        <span className="text-sm font-semibold text-gray-900 dark:text-white">
                          {lineSecondary.toLocaleString('ar-u-nu-latn')} {secondaryCurrencyCode}
                        </span>
                        <span className="mr-1.5 text-xs text-gray-400 dark:text-gray-500">
                          ≈ {lineTotal.toLocaleString('ar-u-nu-latn')} {currencyCode}
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="text-sm font-semibold text-gray-900 dark:text-white">
                          {lineTotal.toLocaleString('ar-u-nu-latn')} {currencyCode}
                        </span>
                        {lineSecondary !== null && (
                          <span className="mr-1.5 text-xs text-gray-400 dark:text-gray-500">
                            ≈ {lineSecondary.toLocaleString('ar-u-nu-latn')} {secondaryCurrencyCode}
                          </span>
                        )}
                      </>
                    )}
                  </div>
                </div>

                {/* التحكم بالكمية */}
                <div className="flex items-center gap-2">
                  <button onClick={() => updateQty(item.productId, item.quantity - 1)}
                    className="flex h-7 w-7 items-center justify-center rounded-full border border-gray-200 text-sm hover:bg-gray-50 dark:border-gray-700 dark:text-white dark:hover:bg-gray-800">
                    −
                  </button>
                  <span className="w-6 text-center text-sm font-medium dark:text-white">{item.quantity}</span>
                  <button onClick={() => updateQty(item.productId, item.quantity + 1)}
                    disabled={!!item.max && item.quantity >= item.max}
                    className="flex h-7 w-7 items-center justify-center rounded-full border border-gray-200 text-sm hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:text-white dark:hover:bg-gray-800">
                    +
                  </button>
                  <button onClick={() => removeItem(item.productId)}
                    className="mr-1 text-gray-300 hover:text-red-400 dark:text-gray-600">
                    🗑️
                  </button>
                </div>
              </div>
            )
          })}
        </div>

        {/* الملخص */}
        <div className="mt-6 rounded-2xl bg-gray-50 p-5 dark:bg-gray-900">
          <div className="flex items-center justify-between text-sm text-gray-600 dark:text-gray-400">
            <span>المجموع الجزئي</span>
            <div className="text-right">
              {preferSecondary && totalSecondary !== null ? (
                <>
                  <p className="font-medium text-gray-900 dark:text-white">
                    {totalSecondary.toLocaleString('ar-u-nu-latn')} {secondaryCurrencyCode}
                  </p>
                  <p className="text-xs text-gray-400 dark:text-gray-500">
                    ≈ {totalPrimary.toLocaleString('ar-u-nu-latn')} {currencyCode}
                  </p>
                </>
              ) : (
                <>
                  <p className="font-medium text-gray-900 dark:text-white">
                    {totalPrimary.toLocaleString('ar-u-nu-latn')} {currencyCode}
                  </p>
                  {totalSecondary !== null && (
                    <p className="text-xs text-gray-400 dark:text-gray-500">
                      ≈ {totalSecondary.toLocaleString('ar-u-nu-latn')} {secondaryCurrencyCode}
                    </p>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="mt-2 flex items-center justify-between text-sm text-gray-600 dark:text-gray-400">
            <span>الشحن</span>
            <span className="text-gray-400 dark:text-gray-500">يُحدد لاحقاً</span>
          </div>

          <div className="mt-3 border-t border-gray-200 pt-3 dark:border-gray-700">
            <div className="flex items-start justify-between font-semibold">
              <span className="text-gray-900 dark:text-white">الإجمالي</span>
              <div className="text-right">
                {preferSecondary && totalSecondary !== null ? (
                  <>
                    <p className="text-lg text-gray-900 dark:text-white">
                      {totalSecondary.toLocaleString('ar-u-nu-latn')} {secondaryCurrencyCode}
                    </p>
                    <p className="text-sm font-normal text-gray-400 dark:text-gray-500">
                      ≈ {totalPrimary.toLocaleString('ar-u-nu-latn')} {currencyCode}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-lg text-gray-900 dark:text-white">
                      {totalPrimary.toLocaleString('ar-u-nu-latn')} {currencyCode}
                    </p>
                    {totalSecondary !== null && (
                      <p className="text-sm font-normal text-gray-400 dark:text-gray-500">
                        ≈ {totalSecondary.toLocaleString('ar-u-nu-latn')} {secondaryCurrencyCode}
                      </p>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        <button
          onClick={() => router.push(`${base}/checkout`)}
          className="mt-4 w-full rounded-xl bg-gray-900 py-3.5 text-sm font-semibold text-white hover:bg-gray-700 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-200"
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
