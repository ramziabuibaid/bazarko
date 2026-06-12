'use client'

import { useCart } from '@/lib/store/cart'
import { createClient } from '@/lib/supabase/client'
import { useParams, useRouter } from 'next/navigation'
import { useState, useEffect } from 'react'
import Link from 'next/link'

interface StoreInfo {
  id: string
  name: string
  currency_code: string
  country_code: string
}

export default function CheckoutPage() {
  const { items, total, clearCart } = useCart()
  const params = useParams()
  const router = useRouter()
  const country = params.country as string
  const subdomain = params.subdomain as string

  const [store, setStore] = useState<StoreInfo | null>(null)
  const [loading, setLoading] = useState(false)
  const [successOrderId, setSuccessOrderId] = useState<string | null>(null)
  const [error, setError] = useState('')

  const [form, setForm] = useState({
    name: '',
    phone: '',
    address: '',
    city: '',
    notes: '',
    payment_method: 'cash' as 'cash' | 'bank_transfer',
  })

  useEffect(() => {
    createClient()
      .from('stores')
      .select('id, name, currency_code, country_code')
      .eq('subdomain', subdomain)
      .eq('country_code', country.toUpperCase())
      .single()
      .then(({ data }: { data: StoreInfo | null }) => setStore(data))
  }, [subdomain, country])

  function update(field: string, value: string) {
    setForm(f => ({ ...f, [field]: value }))
    setError('')
  }

  async function submitOrder(e: React.FormEvent) {
    e.preventDefault()
    if (!store || !items.length) return
    if (!form.name.trim() || !form.phone.trim()) {
      setError('الاسم والهاتف مطلوبان')
      return
    }

    setLoading(true)
    const supabase = createClient()

    // تثبيت الأسعار من قاعدة البيانات وقت الطلب:
    // السعر الحالي للمنتج، أو سعر العرض إن كان ضمن عرض جارٍ ولم تنفد كميته.
    // يحمي من سلة قديمة تحمل سعر عرض انتهى.
    const productIds = items.map(i => i.productId)
    const nowIso = new Date().toISOString()
    const [{ data: dbProducts }, { data: dbOfferItems }] = await Promise.all([
      supabase.from('products').select('id, price').in('id', productIds),
      supabase
        .from('offer_items')
        .select('product_id, offer_price, max_quantity, sold_quantity, offers!inner(store_id, is_active, starts_at, ends_at)')
        .in('product_id', productIds)
        .eq('offers.store_id', store.id)
        .eq('offers.is_active', true)
        .lte('offers.starts_at', nowIso)
        .gte('offers.ends_at', nowIso),
    ])

    const priceMap = new Map<string, number>(
      ((dbProducts ?? []) as { id: string; price: number }[]).map(p => [p.id, p.price])
    )
    const offerPriceMap = new Map<string, number>()
    for (const oi of (dbOfferItems ?? []) as { product_id: string; offer_price: number; max_quantity: number | null; sold_quantity: number }[]) {
      if (oi.max_quantity != null && oi.sold_quantity >= oi.max_quantity) continue
      const existing = offerPriceMap.get(oi.product_id)
      if (existing === undefined || oi.offer_price < existing) {
        offerPriceMap.set(oi.product_id, oi.offer_price)
      }
    }

    const pricedItems = items.map(item => ({
      ...item,
      finalPrice: offerPriceMap.get(item.productId) ?? priceMap.get(item.productId) ?? item.price,
      isOfferPrice: offerPriceMap.has(item.productId),
    }))

    // توليد رقم الطلبية
    const { data: orderNum } = await supabase.rpc('generate_sequence_number', {
      p_store_id: store.id,
      p_prefix: `ORD-${new Date().getFullYear()}-`,
    })

    const subtotal = pricedItems.reduce((sum, i) => sum + i.finalPrice * i.quantity, 0)
    const { data: order, error: orderErr } = await supabase
      .from('orders')
      .insert({
        store_id: store.id,
        order_number: orderNum ?? `ORD-${Date.now()}`,
        status: 'pending',
        payment_method: form.payment_method,
        subtotal,
        total_amount: subtotal,
        customer_name: form.name,
        customer_phone: form.phone,
        shipping_address: form.address,
        shipping_city: form.city,
        customer_notes: form.notes,
        source: 'store',
      })
      .select('id')
      .single()

    if (orderErr || !order) {
      setError('حدث خطأ، حاول مجدداً')
      setLoading(false)
      return
    }

    // إضافة عناصر الطلبية
    const orderItems = pricedItems.map(item => ({
      order_id: order.id,
      product_id: item.productId,
      product_name: item.name,
      quantity: item.quantity,
      unit_price: item.finalPrice,
      total_price: item.finalPrice * item.quantity,
    }))

    await supabase.from('order_items').insert(orderItems)

    // تسجيل مبيعات العرض (لشريط "تم بيع X%" وكمية العرض المحدودة)
    await Promise.all(
      pricedItems
        .filter(i => i.isOfferPrice)
        .map(i => supabase.rpc('record_offer_sale', {
          p_store_id: store.id,
          p_product_id: i.productId,
          p_qty: i.quantity,
        }))
    )

    clearCart()
    setSuccessOrderId(order.id)
    setLoading(false)
  }

  if (!items.length && !successOrderId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white" dir="rtl">
        <div className="text-center">
          <p className="text-gray-500">السلة فارغة</p>
          <Link href={`/store/${country}/${subdomain}`} className="mt-3 inline-block text-sm text-sky-500">
            العودة للمتجر
          </Link>
        </div>
      </div>
    )
  }

  if (successOrderId) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-white px-4 text-center" dir="rtl">
        <div className="text-6xl">✅</div>
        <h2 className="mt-4 text-2xl font-bold text-gray-900">تم استلام طلبيتك!</h2>
        <p className="mt-2 text-gray-500">سنتواصل معك قريباً لتأكيد الطلبية</p>
        <Link
          href={`/store/${country}/${subdomain}/order/${successOrderId}`}
          className="mt-6 rounded-xl bg-gray-900 px-6 py-2.5 text-sm font-semibold text-white"
        >
          تتبع طلبيتك →
        </Link>
        <Link
          href={`/store/${country}/${subdomain}`}
          className="mt-3 text-sm text-gray-400 hover:text-gray-600"
        >
          العودة للمتجر
        </Link>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-white" dir="rtl">
      <header className="border-b border-gray-100 px-4 py-4">
        <div className="mx-auto flex max-w-2xl items-center justify-between">
          <Link href={`/store/${country}/${subdomain}/cart`} className="text-sm text-gray-500">
            → العودة للسلة
          </Link>
          <h1 className="font-semibold text-gray-900">إتمام الطلب</h1>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-6">
        <form onSubmit={submitOrder} className="space-y-5">

          {/* بيانات الزبون */}
          <div className="rounded-2xl border border-gray-100 p-5">
            <h2 className="mb-4 font-semibold text-gray-900">بيانات التوصيل</h2>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-sm text-gray-600">الاسم الكامل *</label>
                <input
                  value={form.name}
                  onChange={e => update('name', e.target.value)}
                  placeholder="محمد علي"
                  required
                  className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm text-gray-900 outline-none focus:border-gray-400"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm text-gray-600">رقم الهاتف *</label>
                <input
                  value={form.phone}
                  onChange={e => update('phone', e.target.value)}
                  placeholder="0591234567"
                  required
                  type="tel"
                  dir="ltr"
                  className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm text-gray-900 outline-none focus:border-gray-400"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-sm text-gray-600">المدينة</label>
                  <input
                    value={form.city}
                    onChange={e => update('city', e.target.value)}
                    placeholder="رام الله"
                    className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm text-gray-900 outline-none focus:border-gray-400"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm text-gray-600">العنوان</label>
                  <input
                    value={form.address}
                    onChange={e => update('address', e.target.value)}
                    placeholder="شارع النهضة"
                    className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm text-gray-900 outline-none focus:border-gray-400"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-sm text-gray-600">ملاحظات إضافية</label>
                <textarea
                  value={form.notes}
                  onChange={e => update('notes', e.target.value)}
                  placeholder="أي تعليمات خاصة..."
                  rows={2}
                  className="w-full resize-none rounded-xl border border-gray-200 px-4 py-2.5 text-sm text-gray-900 outline-none focus:border-gray-400"
                />
              </div>
            </div>
          </div>

          {/* طريقة الدفع */}
          <div className="rounded-2xl border border-gray-100 p-5">
            <h2 className="mb-4 font-semibold text-gray-900">طريقة الدفع</h2>
            <div className="space-y-2">
              {[
                { value: 'cash', label: 'نقداً عند الاستلام', icon: '💵' },
                { value: 'bank_transfer', label: 'تحويل بنكي', icon: '🏦' },
              ].map(opt => (
                <label key={opt.value} className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3.5 transition ${
                  form.payment_method === opt.value ? 'border-gray-900 bg-gray-50' : 'border-gray-100 hover:border-gray-200'
                }`}>
                  <input
                    type="radio"
                    name="payment"
                    value={opt.value}
                    checked={form.payment_method === opt.value}
                    onChange={() => update('payment_method', opt.value)}
                    className="accent-gray-900"
                  />
                  <span>{opt.icon}</span>
                  <span className="text-sm font-medium text-gray-900">{opt.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* ملخص الطلب */}
          <div className="rounded-2xl bg-gray-50 p-5">
            <h2 className="mb-3 font-semibold text-gray-900">ملخص الطلب</h2>
            {items.map(item => (
              <div key={item.productId} className="flex justify-between py-1.5 text-sm text-gray-600">
                <span>{item.name} × {item.quantity}</span>
                <span>{(item.price * item.quantity).toLocaleString('ar')} {store?.currency_code}</span>
              </div>
            ))}
            <div className="mt-3 border-t border-gray-200 pt-3 flex justify-between font-semibold text-gray-900">
              <span>الإجمالي</span>
              <span>{total().toLocaleString('ar')} {store?.currency_code}</span>
            </div>
          </div>

          {error && (
            <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-500">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-gray-900 py-4 text-sm font-semibold text-white hover:bg-gray-700 disabled:opacity-50"
          >
            {loading ? 'جاري الإرسال...' : 'تأكيد الطلب'}
          </button>
        </form>
      </main>
    </div>
  )
}
