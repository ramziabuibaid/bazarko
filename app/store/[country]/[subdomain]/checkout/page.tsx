'use client'

import { useCart } from '@/lib/store/cart'
import { createClient } from '@/lib/supabase/client'
import { useParams, useRouter } from 'next/navigation'
import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'

interface ShippingMethod {
  id: string
  name: string
  cost: number
  min_days: number | null
  max_days: number | null
  is_active: boolean
}

interface Zone {
  id: string
  name: string
  cost: number           // تكلفة افتراضية إذا لا توجد أنواع شحن
  estimated_days: string | null
  shipping_methods: ShippingMethod[]
}

interface StoreInfo {
  id: string
  name: string
  currency_code: string
  country_code: string
  delivery_enabled: boolean
  free_delivery_threshold: number | null
}

export default function CheckoutPage() {
  const { items, total, clearCart } = useCart()
  const params    = useParams()
  const router    = useRouter()
  const country   = params.country as string
  const subdomain = params.subdomain as string

  const [store,          setStore]          = useState<StoreInfo | null>(null)
  const [zones,          setZones]          = useState<Zone[]>([])
  const [loading,        setLoading]        = useState(false)
  const [successOrderId, setSuccessOrderId] = useState<string | null>(null)
  const [error,          setError]          = useState('')

  const [form, setForm] = useState({
    name:           '',
    phone:          '',
    city:           '',
    address:        '',
    notes:          '',
    payment_method: 'cash' as 'cash' | 'bank_transfer',
  })

  const [selectedZoneId,   setSelectedZoneId]   = useState<string>('')
  const [selectedMethodId, setSelectedMethodId] = useState<string>('')

  // جلب بيانات المتجر والمناطق
  useEffect(() => {
    const supabase = createClient()
    Promise.all([
      supabase
        .from('stores')
        .select('id, name, currency_code, country_code, delivery_enabled, free_delivery_threshold')
        .eq('subdomain', subdomain)
        .eq('country_code', country.toUpperCase())
        .single(),
      supabase
        .from('delivery_zones')
        .select('id, name, cost, estimated_days, shipping_methods(id, name, cost, min_days, max_days, is_active)')
        .eq('is_active', true)
        .order('sort_order', { ascending: true }),
    ]).then(([{ data: storeData }, { data: zonesData }]) => {
      if (storeData) {
        setStore(storeData as StoreInfo)
        // فلتر المناطق حسب المتجر (تأتي كلها بسياسة anon لكن نحتاج تصفية)
        // نجلب مع store_id لاحقاً — حالياً نجلب كل المناطق النشطة
      }
      setZones((zonesData ?? []) as Zone[])
    })
  }, [subdomain, country])

  // إعادة جلب مناطق المتجر فقط بعد معرفة store.id
  useEffect(() => {
    if (!store?.id) return
    const supabase = createClient()
    supabase
      .from('delivery_zones')
      .select('id, name, cost, estimated_days, shipping_methods(id, name, cost, min_days, max_days, is_active)')
      .eq('store_id', store.id)
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .then(({ data }) => {
        if (data) setZones(data as Zone[])
      })
  }, [store?.id])

  function update(field: string, value: string) {
    setForm(f => ({ ...f, [field]: value }))
    setError('')
  }

  // ── حساب الشحن ─────────────────────────────────────────

  const selectedZone   = zones.find(z => z.id === selectedZoneId)
  const zoneMethods    = useMemo(
    () => (selectedZone?.shipping_methods ?? []).filter(m => m.is_active),
    [selectedZone]
  )
  const selectedMethod = zoneMethods.find(m => m.id === selectedMethodId)

  // عند اختيار منطقة جديدة → إعادة تعيين نوع الشحن
  function handleZoneChange(zoneId: string) {
    setSelectedZoneId(zoneId)
    setSelectedMethodId('')
  }

  // عند اختيار منطقة بنوع شحن واحد فقط → اختره تلقائياً
  useEffect(() => {
    if (zoneMethods.length === 1) setSelectedMethodId(zoneMethods[0].id)
  }, [zoneMethods])

  const subtotal = total()

  const rawShippingCost = useMemo(() => {
    if (!selectedZone) return 0
    if (selectedMethod) return selectedMethod.cost
    // لا توجد أنواع شحن → استخدم التكلفة الافتراضية للمنطقة
    if (zoneMethods.length === 0) return selectedZone.cost
    return 0 // توجد أنواع لكن لم يختر بعد
  }, [selectedZone, selectedMethod, zoneMethods])

  const freeThreshold   = store?.free_delivery_threshold ?? 0
  const isFreeShipping  = freeThreshold > 0 && subtotal >= freeThreshold
  const shippingCost    = isFreeShipping ? 0 : rawShippingCost
  const grandTotal      = subtotal + shippingCost

  // وقت التوصيل للعرض
  const deliveryTime = useMemo(() => {
    if (selectedMethod?.min_days && selectedMethod?.max_days)
      return `${selectedMethod.min_days}–${selectedMethod.max_days} أيام`
    if (selectedMethod?.min_days)
      return `${selectedMethod.min_days} أيام`
    if (selectedZone?.estimated_days)
      return `${selectedZone.estimated_days} أيام`
    return null
  }, [selectedMethod, selectedZone])

  // ── إرسال الطلب ───────────────────────────────────────────

  async function submitOrder(e: React.FormEvent) {
    e.preventDefault()
    if (!store || !items.length) return
    if (!form.name.trim() || !form.phone.trim()) {
      setError('الاسم والهاتف مطلوبان'); return
    }
    if (store.delivery_enabled && zones.length > 0 && !selectedZoneId) {
      setError('اختر المحافظة'); return
    }
    if (store.delivery_enabled && selectedZoneId && zoneMethods.length > 0 && !selectedMethodId) {
      setError('اختر نوع الشحن'); return
    }

    setLoading(true)
    const supabase = createClient()

    // تثبيت الأسعار من DB
    const productIds = items.map(i => i.productId)
    const nowIso     = new Date().toISOString()
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
      if (existing === undefined || oi.offer_price < existing)
        offerPriceMap.set(oi.product_id, oi.offer_price)
    }

    const pricedItems = items.map(item => ({
      ...item,
      finalPrice:   offerPriceMap.get(item.productId) ?? priceMap.get(item.productId) ?? item.price,
      isOfferPrice: offerPriceMap.has(item.productId),
    }))

    const { data: orderNum } = await supabase.rpc('generate_sequence_number', {
      p_store_id: store.id,
      p_prefix:   `ORD-${new Date().getFullYear()}-`,
    })

    const calcSubtotal = pricedItems.reduce((sum, i) => sum + i.finalPrice * i.quantity, 0)
    const finalTotal   = calcSubtotal + shippingCost

    const { data: order, error: orderErr } = await supabase
      .from('orders')
      .insert({
        store_id:             store.id,
        order_number:         orderNum ?? `ORD-${Date.now()}`,
        status:               'pending',
        payment_method:       form.payment_method,
        subtotal:             calcSubtotal,
        total_amount:         finalTotal,
        shipping_cost:        shippingCost,
        shipping_zone_id:     selectedZoneId || null,
        shipping_method_id:   selectedMethodId || null,
        shipping_zone_name:   selectedZone?.name ?? null,
        shipping_method_name: selectedMethod?.name ?? null,
        customer_name:        form.name,
        customer_phone:       form.phone,
        shipping_address:     form.address,
        shipping_city:        form.city || selectedZone?.name || null,
        customer_notes:       form.notes,
        source:               'store',
      })
      .select('id')
      .single()

    if (orderErr || !order) {
      setError('حدث خطأ، حاول مجدداً')
      setLoading(false)
      return
    }

    const orderItems = pricedItems.map(item => ({
      order_id:     order.id,
      product_id:   item.productId,
      product_name: item.name,
      quantity:     item.quantity,
      unit_price:   item.finalPrice,
      total_price:  item.finalPrice * item.quantity,
    }))
    await supabase.from('order_items').insert(orderItems)

    await Promise.all(
      pricedItems
        .filter(i => i.isOfferPrice)
        .map(i => supabase.rpc('record_offer_sale', {
          p_store_id:  store.id,
          p_product_id: i.productId,
          p_qty:        i.quantity,
        }))
    )

    clearCart()
    setSuccessOrderId(order.id)
    setLoading(false)
  }

  // ── شاشة السلة الفارغة ──────────────────────────────────

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

  // ── شاشة النجاح ──────────────────────────────────────────

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
        <Link href={`/store/${country}/${subdomain}`} className="mt-3 text-sm text-gray-400 hover:text-gray-600">
          العودة للمتجر
        </Link>
      </div>
    )
  }

  const currencyCode = store?.currency_code ?? ''
  const showShipping = store?.delivery_enabled !== false

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950" dir="rtl">
      <header className="border-b border-gray-100 bg-white dark:border-gray-800 dark:bg-gray-900 px-4 py-4">
        <div className="mx-auto flex max-w-2xl items-center justify-between">
          <Link href={`/store/${country}/${subdomain}/cart`} className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400">
            → العودة للسلة
          </Link>
          <h1 className="font-semibold text-gray-900 dark:text-white">إتمام الطلب</h1>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-6">
        <form onSubmit={submitOrder} className="space-y-4">

          {/* بيانات الزبون */}
          <Card title="بيانات التواصل">
            <div className="space-y-3">
              <Field label="الاسم الكامل *">
                <input value={form.name} onChange={e => update('name', e.target.value)}
                  placeholder="محمد علي" required
                  className={inp} />
              </Field>
              <Field label="رقم الهاتف *">
                <input value={form.phone} onChange={e => update('phone', e.target.value)}
                  placeholder="0591234567" required type="tel" dir="ltr"
                  className={inp} />
              </Field>
            </div>
          </Card>

          {/* قسم الشحن */}
          {showShipping && (
            <Card title="الشحن والتوصيل">
              {zones.length === 0 ? (
                <div className="rounded-xl bg-gray-50 dark:bg-gray-800 px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                  🚚 التوصيل متاح — سيتواصل معك المتجر لتحديد التفاصيل
                </div>
              ) : (
                <div className="space-y-4">
                  {/* شريط الشحن المجاني */}
                  {freeThreshold > 0 && (
                    <div className={`flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm ${
                      isFreeShipping
                        ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400'
                        : 'bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-400'
                    }`}>
                      {isFreeShipping ? (
                        <><span>🎉</span> أهلاً! طلبيتك تستحق شحناً مجانياً</>
                      ) : (
                        <><span>🚚</span> أضف {(freeThreshold - subtotal).toLocaleString('ar')} {currencyCode} للحصول على شحن مجاني</>
                      )}
                    </div>
                  )}

                  {/* اختيار المحافظة */}
                  <Field label="المحافظة *">
                    <select
                      value={selectedZoneId}
                      onChange={e => handleZoneChange(e.target.value)}
                      className={`${inp} cursor-pointer`}
                      required={zones.length > 0}
                    >
                      <option value="">— اختر المحافظة —</option>
                      {zones.map(z => (
                        <option key={z.id} value={z.id}>{z.name}</option>
                      ))}
                    </select>
                  </Field>

                  {/* اختيار نوع الشحن */}
                  {selectedZoneId && zoneMethods.length > 0 && (
                    <Field label="نوع الشحن *">
                      <div className="space-y-2">
                        {zoneMethods.map(m => {
                          const cost         = isFreeShipping ? 0 : m.cost
                          const isSelected   = selectedMethodId === m.id
                          const daysLabel    = m.min_days && m.max_days ? `${m.min_days}–${m.max_days} أيام` : m.min_days ? `${m.min_days} أيام` : ''
                          return (
                            <label key={m.id} className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3.5 transition ${
                              isSelected
                                ? 'border-gray-900 bg-gray-50 dark:border-sky-500 dark:bg-sky-500/10'
                                : 'border-gray-100 bg-white hover:border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:hover:border-gray-600'
                            }`}>
                              <input type="radio" name="shipping_method" value={m.id}
                                checked={isSelected}
                                onChange={() => setSelectedMethodId(m.id)}
                                className="accent-gray-900 dark:accent-sky-400 shrink-0" />
                              <div className="flex-1">
                                <p className="text-sm font-medium text-gray-900 dark:text-white">{m.name}</p>
                                {daysLabel && (
                                  <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">{daysLabel}</p>
                                )}
                              </div>
                              <span className={`text-sm font-semibold ${cost === 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-900 dark:text-white'}`}>
                                {cost === 0 ? 'مجاني' : `${cost.toLocaleString('ar')} ${currencyCode}`}
                              </span>
                            </label>
                          )
                        })}
                      </div>
                    </Field>
                  )}

                  {/* تكلفة الشحن الافتراضية (بدون أنواع) */}
                  {selectedZoneId && zoneMethods.length === 0 && selectedZone && (
                    <div className="flex items-center justify-between rounded-xl border border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-3">
                      <div>
                        <p className="text-sm font-medium text-gray-900 dark:text-white">تكلفة التوصيل</p>
                        {selectedZone.estimated_days && (
                          <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">{selectedZone.estimated_days} أيام</p>
                        )}
                      </div>
                      <span className={`text-sm font-semibold ${shippingCost === 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-900 dark:text-white'}`}>
                        {shippingCost === 0 ? 'مجاني' : `${shippingCost.toLocaleString('ar')} ${currencyCode}`}
                      </span>
                    </div>
                  )}

                  {/* المدينة / العنوان */}
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="المدينة أو المنطقة">
                      <input value={form.city} onChange={e => update('city', e.target.value)}
                        placeholder="رام الله، البيرة..." className={inp} />
                    </Field>
                    <Field label="العنوان التفصيلي">
                      <input value={form.address} onChange={e => update('address', e.target.value)}
                        placeholder="شارع النهضة، رقم 5" className={inp} />
                    </Field>
                  </div>
                </div>
              )}

              {/* ملاحظات */}
              <div className="mt-3">
                <Field label="ملاحظات إضافية">
                  <textarea value={form.notes} onChange={e => update('notes', e.target.value)}
                    placeholder="أي تعليمات خاصة للتوصيل..."
                    rows={2}
                    className={`${inp} resize-none`} />
                </Field>
              </div>
            </Card>
          )}

          {/* طريقة الدفع */}
          <Card title="طريقة الدفع">
            <div className="space-y-2">
              {[
                { value: 'cash',          label: 'نقداً عند الاستلام', icon: '💵' },
                { value: 'bank_transfer', label: 'تحويل بنكي',         icon: '🏦' },
              ].map(opt => (
                <label key={opt.value} className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3.5 transition ${
                  form.payment_method === opt.value
                    ? 'border-gray-900 bg-gray-50 dark:border-sky-500 dark:bg-sky-500/10'
                    : 'border-gray-100 bg-white hover:border-gray-200 dark:border-gray-700 dark:bg-gray-800'
                }`}>
                  <input type="radio" name="payment" value={opt.value}
                    checked={form.payment_method === opt.value}
                    onChange={() => update('payment_method', opt.value)}
                    className="accent-gray-900 dark:accent-sky-400" />
                  <span>{opt.icon}</span>
                  <span className="text-sm font-medium text-gray-900 dark:text-white">{opt.label}</span>
                </label>
              ))}
            </div>
          </Card>

          {/* ملخص الطلب */}
          <div className="rounded-2xl bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 p-5">
            <h2 className="mb-3 font-semibold text-gray-900 dark:text-white">ملخص الطلب</h2>
            <div className="space-y-1.5">
              {items.map(item => (
                <div key={item.productId} className="flex justify-between text-sm text-gray-600 dark:text-gray-400">
                  <span>{item.name} × {item.quantity}</span>
                  <span dir="ltr">{(item.price * item.quantity).toLocaleString('ar')} {currencyCode}</span>
                </div>
              ))}
            </div>

            <div className="mt-3 space-y-2 border-t border-gray-100 dark:border-gray-800 pt-3">
              <div className="flex justify-between text-sm text-gray-600 dark:text-gray-400">
                <span>المجموع الفرعي</span>
                <span dir="ltr">{subtotal.toLocaleString('ar')} {currencyCode}</span>
              </div>
              {showShipping && (selectedZoneId || zones.length === 0) && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600 dark:text-gray-400">
                    الشحن
                    {selectedZone && <span className="mr-1 text-gray-400">({selectedZone.name})</span>}
                    {selectedMethod && <span className="mr-1 text-gray-400">— {selectedMethod.name}</span>}
                  </span>
                  <span className={`font-medium ${shippingCost === 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-900 dark:text-white'}`}>
                    {zones.length === 0
                      ? 'يحدد لاحقاً'
                      : shippingCost === 0
                        ? 'مجاني'
                        : `${shippingCost.toLocaleString('ar')} ${currencyCode}`}
                  </span>
                </div>
              )}
              {deliveryTime && (
                <p className="text-xs text-gray-400 dark:text-gray-500">
                  🕐 وقت التوصيل المتوقع: {deliveryTime}
                </p>
              )}
              <div className="flex justify-between border-t border-gray-100 dark:border-gray-800 pt-2 font-semibold text-gray-900 dark:text-white">
                <span>الإجمالي</span>
                <span dir="ltr">{grandTotal.toLocaleString('ar')} {currencyCode}</span>
              </div>
            </div>
          </div>

          {error && (
            <p className="rounded-xl bg-red-50 dark:bg-red-500/10 px-4 py-3 text-sm text-red-500 dark:text-red-400">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-gray-900 py-4 text-sm font-semibold text-white hover:bg-gray-700 dark:bg-sky-500 dark:hover:bg-sky-400 dark:text-white disabled:opacity-50 transition-colors"
          >
            {loading ? 'جاري الإرسال...' : `تأكيد الطلب — ${grandTotal.toLocaleString('ar')} ${currencyCode}`}
          </button>
        </form>
      </main>
    </div>
  )
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white dark:border-gray-800 dark:bg-gray-900 p-5">
      <h2 className="mb-4 font-semibold text-gray-900 dark:text-white">{title}</h2>
      {children}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-sm text-gray-600 dark:text-gray-400">{label}</label>
      {children}
    </div>
  )
}

const inp = 'w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-900 outline-none focus:border-gray-400 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:focus:border-sky-500'
