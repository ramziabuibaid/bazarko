import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import StoreHeader from '@/components/store/StoreHeader'

interface Props {
  params: { country: string; subdomain: string; id: string }
}

const STATUS_STEPS = [
  { key: 'pending',    label: 'تم الاستلام',     icon: '📥' },
  { key: 'confirmed',  label: 'مؤكد',            icon: '✅' },
  { key: 'processing', label: 'قيد التجهيز',     icon: '⚙️' },
  { key: 'ready',      label: 'جاهز للشحن',      icon: '📦' },
  { key: 'shipped',    label: 'في الطريق إليك',  icon: '🚚' },
  { key: 'delivered',  label: 'تم التسليم',      icon: '🎉' },
]

const STATUS_ORDER = ['pending', 'confirmed', 'processing', 'ready', 'shipped', 'delivered']

const PAYMENT_LABELS: Record<string, string> = {
  cash: 'نقداً عند الاستلام',
  bank_transfer: 'تحويل بنكي',
  check: 'شيك',
  credit: 'آجل',
}

export default async function OrderTrackingPage({ params }: Props) {
  const supabase = createClient()

  const { data: store } = await supabase
    .from('stores')
    .select('id, name, logo_url, phone, whatsapp, currency_code, header_theme')
    .eq('subdomain', params.subdomain)
    .eq('country_code', params.country.toUpperCase())
    .eq('status', 'active')
    .single()

  if (!store) notFound()

  const { data: order } = await supabase
    .from('orders')
    .select('id, order_number, status, payment_method, subtotal, total_amount, shipping_city, customer_name, customer_notes, created_at')
    .eq('id', params.id)
    .eq('store_id', store.id)
    .single()

  if (!order) notFound()

  const { data: items } = await supabase
    .from('order_items')
    .select('id, product_name, quantity, unit_price, total_price')
    .eq('order_id', order.id)

  const currentStep = STATUS_ORDER.indexOf(order.status)
  const isCancelled = order.status === 'cancelled'

  return (
    <div className="min-h-screen bg-white" dir="rtl">
      <StoreHeader store={store} country={params.country} subdomain={params.subdomain} />

      <main className="mx-auto max-w-2xl px-4 py-8">
        <div className="mb-2 text-sm text-gray-400">تتبع طلبيتك</div>
        <h1 className="font-mono text-xl font-bold text-gray-900" dir="ltr">
          {order.order_number}
        </h1>
        {order.customer_name && (
          <p className="mt-1 text-sm text-gray-500">أهلاً، {order.customer_name}</p>
        )}

        {/* شريط التقدم */}
        {!isCancelled ? (
          <div className="mt-8">
            <div className="relative">
              {/* الخط الواصل */}
              <div className="absolute top-5 right-5 left-5 h-0.5 bg-gray-100" />
              <div
                className="absolute top-5 right-5 h-0.5 bg-emerald-500 transition-all"
                style={{ width: currentStep <= 0 ? '0%' : `${(currentStep / (STATUS_STEPS.length - 1)) * 100}%` }}
              />

              <div className="relative flex justify-between">
                {STATUS_STEPS.map((step, idx) => {
                  const done = idx <= currentStep
                  const active = idx === currentStep
                  return (
                    <div key={step.key} className="flex flex-col items-center gap-2">
                      <div className={`flex h-10 w-10 items-center justify-center rounded-full border-2 text-lg transition-all ${
                        done
                          ? 'border-emerald-500 bg-emerald-500 text-white'
                          : 'border-gray-200 bg-white text-gray-300'
                      } ${active ? 'scale-110 shadow-lg shadow-emerald-500/20' : ''}`}>
                        {step.icon}
                      </div>
                      <span className={`text-center text-xs font-medium leading-tight ${
                        done ? 'text-emerald-600' : 'text-gray-400'
                      }`} style={{ maxWidth: 60 }}>
                        {step.label}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-6 rounded-2xl bg-red-50 p-4 text-center">
            <p className="text-lg">❌</p>
            <p className="mt-1 font-semibold text-red-700">تم إلغاء الطلبية</p>
          </div>
        )}

        {/* تفاصيل الطلب */}
        <div className="mt-8 space-y-4">
          <div className="overflow-hidden rounded-2xl border border-gray-100">
            <div className="border-b border-gray-100 bg-gray-50 px-5 py-3">
              <h2 className="text-sm font-semibold text-gray-700">عناصر الطلب</h2>
            </div>
            <div className="divide-y divide-gray-50">
              {(items ?? []).map((item: { id: string; product_name: string; quantity: number; unit_price: number; total_price: number }) => (
                <div key={item.id} className="flex items-center justify-between px-5 py-3">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{item.product_name}</p>
                    <p className="text-xs text-gray-400">
                      {item.unit_price.toLocaleString('ar-u-nu-latn')} × {item.quantity}
                    </p>
                  </div>
                  <span className="text-sm font-semibold text-gray-900">
                    {item.total_price.toLocaleString('ar-u-nu-latn')} {store.currency_code}
                  </span>
                </div>
              ))}
              <div className="flex justify-between px-5 py-3 font-bold text-gray-900">
                <span>الإجمالي</span>
                <span>{order.total_amount.toLocaleString('ar-u-nu-latn')} {store.currency_code}</span>
              </div>
            </div>
          </div>

          {/* معلومات إضافية */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-gray-100 px-4 py-3">
              <p className="text-xs text-gray-400">طريقة الدفع</p>
              <p className="mt-0.5 text-sm font-medium text-gray-900">
                {PAYMENT_LABELS[order.payment_method] ?? order.payment_method}
              </p>
            </div>
            {order.shipping_city && (
              <div className="rounded-2xl border border-gray-100 px-4 py-3">
                <p className="text-xs text-gray-400">المدينة</p>
                <p className="mt-0.5 text-sm font-medium text-gray-900">{order.shipping_city}</p>
              </div>
            )}
          </div>

          {order.customer_notes && (
            <div className="rounded-2xl border border-gray-100 px-4 py-3">
              <p className="text-xs text-gray-400">ملاحظاتك</p>
              <p className="mt-0.5 text-sm text-gray-700">{order.customer_notes}</p>
            </div>
          )}
        </div>

        {/* واتساب */}
        {store.whatsapp && (
          <a
            href={`https://wa.me/${store.whatsapp.replace(/\D/g, '')}?text=${encodeURIComponent(`مرحباً، أريد الاستفسار عن طلبيتي رقم ${order.order_number}`)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl border border-green-200 py-3 text-sm font-medium text-green-700 hover:bg-green-50"
          >
            <span>📱</span> تواصل معنا عبر واتساب
          </a>
        )}

        <div className="mt-6 text-center">
          <Link
            href={`/store/${params.country}/${params.subdomain}`}
            className="text-sm text-sky-500 hover:underline"
          >
            العودة للمتجر
          </Link>
        </div>
      </main>
    </div>
  )
}
