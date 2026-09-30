'use client'

import { useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { requestKey, completeRequest } from '@/lib/client/idempotency'

interface Product {
  id: string
  name: string
  sku: string | null
  price: number
  cost_price?: number | null
  thumbnail_url: string | null
}

interface Customer {
  id: string
  name: string
  phone: string | null
  balance: number
}

interface LineItem {
  key: number
  product_id: string | null
  name: string
  sku: string
  quantity: number
  unit_price: number
  cost_price?: number
}

let keySeq = 0

function useDebounce<T extends (...args: Parameters<T>) => void>(fn: T, ms: number) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  return useCallback((...args: Parameters<T>) => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => fn(...args), ms)
  }, [fn, ms])
}

interface PrefillItem {
  product_id: string | null
  name: string
  sku: string
  quantity: number
  unit_price: number
  cost_price?: number
}

interface Prefill {
  orderId?: string
  orderNumber?: string
  quotationId?: string
  quotationNumber?: string
  customerId: string | null
  customerName: string
  customerPhone: string
  discountAmount?: number
  notes?: string
  items: PrefillItem[]
}

interface Props {
  storeId: string
  userId: string
  currencyCode: string
  storeName: string
  prefill?: Prefill
}

type CustomerMode = 'search' | 'manual' | null

export default function NewInvoiceForm({ storeId, userId, currencyCode, storeName, prefill }: Props) {
  const router  = useRouter()
  const supabase = createClient()

  // ── حالة الزبون ──────────────────────────────────────────────
  const [customerMode, setCustomerMode] = useState<CustomerMode>(
    prefill?.customerId ? 'search' : null
  )
  const [customerSearch, setCustomerSearch]   = useState('')
  const [customerResults, setCustomerResults] = useState<Customer[]>([])
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(
    prefill?.customerId
      ? { id: prefill.customerId, name: prefill.customerName, phone: prefill.customerPhone || null, balance: 0 }
      : null
  )
  const [customerName, setCustomerName]       = useState(prefill?.customerName ?? '')
  const [customerPhone, setCustomerPhone]     = useState(prefill?.customerPhone ?? '')
  const [customerAddress, setCustomerAddress] = useState('')

  // ── بحث المنتجات ─────────────────────────────────────────────
  const [productSearch, setProductSearch]     = useState('')
  const [productResults, setProductResults]   = useState<Product[]>([])

  // ── البنود ───────────────────────────────────────────────────
  const [items, setItems] = useState<LineItem[]>(
    prefill?.items.length
      ? prefill.items.map(i => ({ key: keySeq++, product_id: i.product_id, name: i.name, sku: i.sku, quantity: i.quantity, unit_price: i.unit_price, cost_price: Number(i.cost_price || 0) }))
      : [{ key: keySeq++, product_id: null, name: '', sku: '', quantity: 1, unit_price: 0, cost_price: 0 }]
  )

  // ── طريقة الدفع ──────────────────────────────────────────────
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'credit'>('cash')

  // ── الخصم: نوعين (مبلغ ثابت ₪ / نسبة مئوية %) ────────────────
  const [discountType, setDiscountType]   = useState<'amount' | 'percent'>('amount')
  const [discountValue, setDiscountValue] = useState<number>(prefill?.discountAmount || 0)

  // ── الإجماليات ────────────────────────────────────────────────
  const [issueDate, setIssueDate]           = useState(new Date().toISOString().slice(0, 10))
  const [dueDate, setDueDate]               = useState('')
  const [notes, setNotes]                   = useState(prefill?.notes || '')
  const [saving, setSaving]                 = useState(false)
  const [error, setError]                   = useState('')

  const subtotal = items.reduce((s, i) => s + (Number(i.quantity) || 0) * (Number(i.unit_price) || 0), 0)
  const totalCost = items.reduce((s, i) => s + (Number(i.quantity) || 0) * (Number(i.cost_price) || 0), 0)
  const computedDiscount = discountType === 'percent'
    ? (subtotal * (Number(discountValue) || 0)) / 100
    : (Number(discountValue) || 0)
  const discountAmount = Math.min(subtotal, Math.max(0, computedDiscount))
  const total    = Math.max(0, subtotal - discountAmount)
  const fmt      = (n: number) => n.toLocaleString('ar-u-nu-latn', { maximumFractionDigits: 2 })

  // ── Debounced searches ────────────────────────────────────────

  const searchCustomers = useDebounce(async (q: string) => {
    if (!q.trim()) { setCustomerResults([]); return }
    const { data } = await supabase
      .from('customers')
      .select('id, name, phone, balance')
      .eq('store_id', storeId)
      .ilike('name', `%${q}%`)
      .limit(6)
    setCustomerResults((data as Customer[] | null) ?? [])
  }, 250)

  const searchProducts = useDebounce(async (q: string) => {
    if (!q.trim()) { setProductResults([]); return }
    const { data } = await supabase
      .from('products')
      .select('id, name, sku, price, cost_price, thumbnail_url')
      .eq('store_id', storeId)
      .eq('is_active', true)
      .ilike('name', `%${q}%`)
      .limit(6)
    setProductResults((data as Product[] | null) ?? [])
  }, 250)

  // ── البنود ───────────────────────────────────────────────────

  function addProductToItems(p: Product) {
    setItems(prev => [
      ...prev,
      {
        key: keySeq++,
        product_id: p.id,
        name: p.name,
        sku: p.sku ?? '',
        quantity: 1,
        unit_price: p.price,
        cost_price: Number(p.cost_price || 0),
      },
    ])
    setProductSearch('')
    setProductResults([])
  }

  function updateItem(key: number, field: keyof LineItem, value: string | number) {
    setItems(prev => prev.map(i => i.key === key ? { ...i, [field]: value } : i))
  }

  function removeItem(key: number) {
    setItems(prev => prev.filter(i => i.key !== key))
  }

  function clearCustomer() {
    setSelectedCustomer(null)
    setCustomerSearch('')
    setCustomerResults([])
    setCustomerName('')
    setCustomerPhone('')
    setCustomerMode(null)
  }

  // ── الحفظ ────────────────────────────────────────────────────

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (items.length === 0) { setError('يجب إضافة بند واحد على الأقل'); return }
    if (items.some(i => !i.name.trim())) { setError('جميع البنود يجب أن تحتوي على اسم أو وصف'); return }
    if (items.some(i => i.unit_price < 0)) { setError('السعر لا يمكن أن يكون سالباً'); return }
    if (items.some(i => i.quantity < 1)) { setError('الكمية يجب أن تكون 1 على الأقل'); return }

    const activePhone = selectedCustomer?.phone ?? (customerMode === 'manual' ? customerPhone.trim() : '')
    if (activePhone && !/^\+?[\d\s\-()]{7,15}$/.test(activePhone)) {
      setError('رقم الهاتف غير صحيح (مثال: +970599123456)')
      return
    }

    const payload = {
      customerId: selectedCustomer?.id ?? null,
      customerName: selectedCustomer?.name ?? (customerMode === 'manual' ? customerName.trim() : ''),
      customerPhone: activePhone,
      customerAddress: customerAddress.trim(),
      orderId: prefill?.orderId ?? null,
      quotationId: prefill?.quotationId ?? null,
      issueDate,
      dueDate: dueDate || null,
      paymentMethod,
      discountType,
      discountValue: Number(discountValue) || 0,
      notes: notes.trim(),
      items: items.map(({ product_id, name, sku, quantity, unit_price }) => ({ product_id, name: name.trim(), sku, quantity: Number(quantity), unit_price: Number(unit_price) })),
    }
    setSaving(true)
    try {
      const key = await requestKey(`manual-invoice:${storeId}`, payload)
      const { data, error: saveError } = await supabase.rpc('create_sales_invoice_atomic', { p_store: storeId, p_payload: payload, p_key: key })
      if (saveError) throw saveError
      if (!data?.invoiceId) throw new Error('لم يرجع رقم الفاتورة من الخادم')
      await completeRequest(`manual-invoice:${storeId}`, payload)
      router.push(`/dashboard/accounting/invoices/${data.invoiceId}`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'تعذر إنشاء الفاتورة')
    } finally {
      setSaving(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────

  return (
    <form onSubmit={handleSubmit} className="space-y-6">

      {/* شارة الطلبية المرتبطة */}
      {prefill && (
        <div className="flex items-center gap-3 rounded-xl border border-sky-500/20 bg-sky-500/5 px-4 py-3">
          <span className="text-sky-400">🔗</span>
          <p className="text-sm text-sky-300">
            هذه الفاتورة مرتبطة بالطلبية{' '}
            <span className="font-mono font-semibold" dir="ltr">{prefill.orderNumber}</span>
          </p>
        </div>
      )}

      {/* ── معلومات الزبون ── */}
      <div className="rounded-2xl border border-white/5 bg-slate-900 p-5 space-y-4">
        <h2 className="text-sm font-semibold text-white">معلومات الزبون</h2>

        {/* اختيار الوضع */}
        {customerMode === null && (
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setCustomerMode('search')}
              className="flex flex-col items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 py-4 text-sm text-slate-300 transition-colors hover:border-sky-500/30 hover:bg-sky-500/5 hover:text-sky-400"
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <circle cx="8" cy="8" r="6" />
                <line x1="13" y1="13" x2="18" y2="18" />
              </svg>
              اختيار زبون موجود
            </button>
            <button
              type="button"
              onClick={() => setCustomerMode('manual')}
              className="flex flex-col items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 py-4 text-sm text-slate-300 transition-colors hover:border-emerald-500/30 hover:bg-emerald-500/5 hover:text-emerald-400"
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="10" cy="7" r="4" />
                <path d="M2 17c0-3.3 3.6-6 8-6s8 2.7 8 6" />
                <line x1="15" y1="11" x2="15" y2="17" />
                <line x1="12" y1="14" x2="18" y2="14" />
              </svg>
              إدخال بيانات جديدة
            </button>
          </div>
        )}

        {/* وضع البحث */}
        {customerMode === 'search' && !selectedCustomer && (
          <div>
            <div className="relative">
              <svg className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <circle cx="6" cy="6" r="4.5" />
                <line x1="9.5" y1="9.5" x2="13" y2="13" />
              </svg>
              <input
                value={customerSearch}
                onChange={e => { setCustomerSearch(e.target.value); searchCustomers(e.target.value) }}
                placeholder="ابحث باسم الزبون..."
                autoFocus
                className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 pr-10 text-sm text-white placeholder-slate-400 outline-none focus:border-sky-500/50"
              />
              {customerResults.length > 0 && (
                <div className="absolute top-full z-10 mt-1 w-full overflow-hidden rounded-xl border border-white/10 bg-slate-800 shadow-xl">
                  {customerResults.map(c => (
                    <button key={c.id} type="button"
                      onClick={() => {
                        setSelectedCustomer(c)
                        setCustomerSearch('')
                        setCustomerResults([])
                      }}
                      className="flex w-full items-center gap-3 px-4 py-3 text-right transition-colors hover:bg-white/5">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-white">{c.name}</p>
                        {c.phone && <p className="text-xs text-slate-400" dir="ltr">{c.phone}</p>}
                      </div>
                      {c.balance > 0 && (
                        <span className="shrink-0 text-xs text-yellow-400">{fmt(c.balance)} {currencyCode}</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button type="button" onClick={() => setCustomerMode(null)}
              className="mt-2 text-xs text-slate-500 hover:text-slate-300">
              ← رجوع
            </button>
          </div>
        )}

        {/* زبون محدد من البحث */}
        {customerMode === 'search' && selectedCustomer && (
          <div className="flex items-center justify-between rounded-xl border border-sky-500/20 bg-sky-500/8 px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-sky-400">{selectedCustomer.name}</p>
              {selectedCustomer.phone && (
                <p className="mt-0.5 text-xs text-slate-400" dir="ltr">{selectedCustomer.phone}</p>
              )}
            </div>
            <button type="button" onClick={clearCustomer}
              className="text-sm text-slate-500 hover:text-red-400 transition-colors">
              ✕ تغيير
            </button>
          </div>
        )}

        {/* وضع الإدخال اليدوي */}
        {customerMode === 'manual' && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs text-slate-400">اسم الزبون</label>
                <input
                  value={customerName}
                  onChange={e => setCustomerName(e.target.value)}
                  placeholder="الاسم الكامل..."
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-sky-500/50"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-400">رقم الهاتف</label>
                <input
                  value={customerPhone}
                  onChange={e => setCustomerPhone(e.target.value)}
                  placeholder="+970..."
                  dir="ltr"
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-sky-500/50"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs text-slate-400">العنوان</label>
                <input
                  value={customerAddress}
                  onChange={e => setCustomerAddress(e.target.value)}
                  placeholder="المدينة، الحي..."
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-sky-500/50"
                />
              </div>
            </div>
            <button type="button" onClick={() => setCustomerMode(null)}
              className="text-xs text-slate-500 hover:text-slate-300">
              ← رجوع
            </button>
          </div>
        )}
      </div>

      {/* ── تواريخ ── */}
      <div className="rounded-2xl border border-white/5 bg-slate-900 p-5">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="mb-1 block text-xs text-slate-400">تاريخ الإصدار *</label>
            <input type="date" value={issueDate} onChange={e => setIssueDate(e.target.value)} required
              className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white outline-none focus:border-sky-500/50 [color-scheme:dark]" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-400">تاريخ الاستحقاق</label>
            <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white outline-none focus:border-sky-500/50 [color-scheme:dark]" />
          </div>
        </div>
      </div>

      {/* ── بنود الفاتورة ── */}
      <div className="rounded-2xl border border-white/5 bg-slate-900 p-5 space-y-4">
        <h2 className="text-sm font-semibold text-white">بنود الفاتورة</h2>

        {/* بحث عن منتج */}
        <div className="relative">
          <svg className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <circle cx="6" cy="6" r="4.5" />
            <line x1="9.5" y1="9.5" x2="13" y2="13" />
          </svg>
          <input
            value={productSearch}
            onChange={e => { setProductSearch(e.target.value); searchProducts(e.target.value) }}
            placeholder="ابحث عن منتج لإضافته..."
            className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 pr-10 text-sm text-white placeholder-slate-400 outline-none focus:border-sky-500/50"
          />
          {productResults.length > 0 && (
            <div className="absolute top-full z-10 mt-1 w-full overflow-hidden rounded-xl border border-white/10 bg-slate-800 shadow-xl">
              {productResults.map(p => (
                <button key={p.id} type="button" onClick={() => addProductToItems(p)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-right transition-colors hover:bg-white/5">
                  <div className="h-8 w-8 shrink-0 overflow-hidden rounded-lg bg-white/5">
                    {p.thumbnail_url
                      ? <img src={p.thumbnail_url} alt="" className="h-full w-full object-cover" />
                      : <div className="flex h-full items-center justify-center text-xs">🛍️</div>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white">{p.name}</p>
                    {p.sku && <p className="text-xs text-slate-500" dir="ltr">{p.sku}</p>}
                  </div>
                  <span className="shrink-0 text-sm font-medium text-sky-400" dir="ltr">{fmt(p.price)}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ── بطاقات البنود (موبايل) ── */}
        <div className="md:hidden space-y-3">
          {items.map((item, idx) => (
            <div key={item.key} className="rounded-xl border border-white/8 bg-slate-800/60 p-3 space-y-3">
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <label className="text-[10px] font-medium text-slate-500">الوصف *</label>
                  <input
                    value={item.name}
                    onChange={e => updateItem(item.key, 'name', e.target.value)}
                    placeholder="اسم البند أو الخدمة..."
                    required
                    className="mt-0.5 w-full bg-transparent text-sm text-white outline-none placeholder-slate-500"
                  />
                  {item.sku && <p className="text-[10px] text-slate-600 mt-0.5" dir="ltr">{item.sku}</p>}
                </div>
                <button type="button" onClick={() => removeItem(item.key)}
                  className="shrink-0 mt-1 flex h-6 w-6 items-center justify-center rounded-full text-slate-600 hover:bg-red-500/10 hover:text-red-400 transition-colors text-xs">
                  ✕
                </button>
              </div>
              <div className="flex items-end gap-3">
                <div>
                  <label className="text-[10px] font-medium text-slate-500">الكمية</label>
                  <input
                    type="number" min="1" step="1"
                    value={item.quantity}
                    onChange={e => updateItem(item.key, 'quantity', Math.max(1, parseInt(e.target.value) || 1))}
                    dir="ltr"
                    className="mt-0.5 w-16 block rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-center text-sm text-white outline-none focus:border-sky-500/50"
                  />
                </div>
                <span className="mb-1.5 text-slate-600">×</span>
                <div className="flex-1">
                  <label className="text-[10px] font-medium text-slate-500">السعر ({currencyCode})</label>
                  <input
                    type="number" min="0" step="0.01"
                    value={item.unit_price || ''}
                    onChange={e => updateItem(item.key, 'unit_price', Math.max(0, parseFloat(e.target.value) || 0))}
                    placeholder="0"
                    dir="ltr"
                    className="mt-0.5 w-full block rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-white outline-none focus:border-sky-500/50"
                  />
                </div>
                <div className="text-right shrink-0">
                  <p className="text-[10px] font-medium text-slate-500">الإجمالي</p>
                  <p className="mt-0.5 text-sm font-bold text-emerald-400" dir="ltr">
                    {fmt(item.quantity * item.unit_price)}
                  </p>
                </div>
              </div>
              {Number(item.cost_price || 0) > 0 && (
                <div className="mt-2 flex items-center justify-between text-[11px] rounded bg-white/5 px-2 py-1 text-slate-400">
                  <span>التكلفة للوحدة: <span className="text-slate-200 font-mono" dir="ltr">{fmt(item.cost_price || 0)} {currencyCode}</span></span>
                  <span>الربح: <span className={`font-mono font-semibold ${((item.quantity * item.unit_price) - (item.quantity * (item.cost_price || 0))) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`} dir="ltr">
                    {fmt((item.quantity * item.unit_price) - (item.quantity * (item.cost_price || 0)))} {currencyCode}
                  </span></span>
                </div>
              )}
            </div>
          ))}
          {items.length === 0 && (
            <p className="py-4 text-center text-sm text-slate-500">لا توجد بنود — ابحث عن منتج أو أضف بنداً يدوياً</p>
          )}
        </div>

        {/* ── جدول البنود (ديسكتوب) ── */}
        <div className="hidden md:block overflow-x-auto rounded-xl border border-white/5">
          <table className="w-full min-w-[650px] text-sm">
            <thead>
              <tr className="border-b border-white/5 bg-white/3">
                <th className="px-3 py-2.5 text-right text-xs text-slate-400">الوصف</th>
                <th className="w-16 px-2 py-2.5 text-center text-xs text-slate-400">الكمية</th>
                <th className="w-24 px-2 py-2.5 text-left text-xs text-slate-400">التكلفة</th>
                <th className="w-24 px-2 py-2.5 text-left text-xs text-slate-400">سعر البيع</th>
                <th className="w-24 px-2 py-2.5 text-left text-xs text-slate-400">الإجمالي</th>
                <th className="w-24 px-2 py-2.5 text-left text-xs text-slate-400">الربح</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {items.map(item => {
                const lineTotal = item.quantity * item.unit_price
                const lineCost = item.quantity * Number(item.cost_price || 0)
                const lineProfit = lineTotal - lineCost
                return (
                  <tr key={item.key}>
                    <td className="px-3 py-2">
                      <input
                        value={item.name}
                        onChange={e => updateItem(item.key, 'name', e.target.value)}
                        placeholder="وصف البند *"
                        required
                        className="w-full bg-transparent text-sm text-white outline-none placeholder-slate-600"
                      />
                      {item.sku && <p className="text-xs text-slate-600" dir="ltr">{item.sku}</p>}
                    </td>
                    <td className="px-2 py-2 text-center">
                      <input
                        type="number" min="1" step="1"
                        value={item.quantity}
                        onChange={e => updateItem(item.key, 'quantity', Math.max(1, parseInt(e.target.value) || 1))}
                        dir="ltr"
                        className="w-14 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-center text-sm text-white outline-none focus:border-sky-500/50"
                      />
                    </td>
                    <td className="px-2 py-2 text-left">
                      <input
                        type="number" min="0" step="0.01"
                        value={item.cost_price || ''}
                        onChange={e => updateItem(item.key, 'cost_price', Math.max(0, parseFloat(e.target.value) || 0))}
                        placeholder="0"
                        dir="ltr"
                        className="w-20 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-left text-xs text-slate-300 font-mono outline-none focus:border-sky-500/50"
                      />
                    </td>
                    <td className="px-2 py-2 text-left">
                      <input
                        type="number" min="0" step="0.01"
                        value={item.unit_price || ''}
                        onChange={e => updateItem(item.key, 'unit_price', Math.max(0, parseFloat(e.target.value) || 0))}
                        placeholder="0"
                        dir="ltr"
                        className="w-20 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-left text-sm text-white font-mono outline-none focus:border-sky-500/50"
                      />
                    </td>
                    <td className="px-2 py-2 text-left text-sm font-semibold text-white font-mono" dir="ltr">
                      {fmt(lineTotal)}
                    </td>
                    <td className={`px-2 py-2 text-left text-xs font-mono font-semibold ${lineProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`} dir="ltr">
                      {fmt(lineProfit)}
                    </td>
                    <td className="px-3 py-2">
                      <button type="button" onClick={() => removeItem(item.key)}
                        className="text-slate-600 hover:text-red-400 transition-colors text-xs">✕</button>
                    </td>
                  </tr>
                )
              })}
              {items.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-sm text-slate-500">
                    لا توجد بنود
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <button
          type="button"
          onClick={() => setItems(prev => [...prev, { key: keySeq++, product_id: null, name: '', sku: '', quantity: 1, unit_price: 0, cost_price: 0 }])}
          className="w-full rounded-xl border border-dashed border-white/10 py-2.5 text-sm text-slate-400 transition-colors hover:border-sky-500/30 hover:text-sky-400"
        >
          + إضافة بند يدوي
        </button>
      </div>

      {/* ── طريقة الدفع والإجماليات ── */}
      <div className="rounded-2xl border border-white/5 bg-slate-900 p-5 space-y-4">
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-300">طريقة الدفع *</label>
          <select
            value={paymentMethod}
            onChange={e => setPaymentMethod(e.target.value as any)}
            className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white outline-none focus:border-sky-500 font-bold"
          >
            <option value="cash">نقداً (دفع فوري بالكامل)</option>
            <option value="credit">على الحساب (بيع آجل / ذمة عميل)</option>
          </select>
        </div>

        <div className="flex items-center justify-between text-sm border-t border-white/5 pt-3">
          <span className="text-slate-400">المجموع الفرعي</span>
          <span className="text-white font-mono font-bold" dir="ltr">{fmt(subtotal)} {currencyCode}</span>
        </div>

        {totalCost > 0 && (
          <div className="rounded-xl border border-sky-500/20 bg-sky-500/5 p-3 space-y-1.5 text-xs">
            <div className="flex items-center justify-between text-slate-300">
              <span>إجمالي التكلفة التقديرية للبضاعة:</span>
              <span className="font-mono font-bold text-slate-200" dir="ltr">{fmt(totalCost)} {currencyCode}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-300">مجمل الربح المتوقع:</span>
              <span className={`font-mono font-bold text-sm ${(total - totalCost) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`} dir="ltr">
                {fmt(total - totalCost)} {currencyCode}
                {total > 0 && (
                  <span className="text-[11px] font-normal mr-1 text-slate-400">
                    ({(((total - totalCost) / total) * 100).toFixed(1)}%)
                  </span>
                )}
              </span>
            </div>
          </div>
        )}

        {/* نوع وقيمة الخصم */}
        <div className="rounded-xl border border-white/10 bg-slate-800/60 p-3 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-bold text-slate-300">الخصم التجاري الممنوح:</span>
            <div className="flex rounded-lg bg-slate-900 p-0.5 text-[11px]">
              <button
                type="button"
                onClick={() => setDiscountType('amount')}
                className={`rounded px-2.5 py-0.5 font-bold transition ${
                  discountType === 'amount' ? 'bg-sky-500 text-slate-950' : 'text-slate-400 hover:text-white'
                }`}
              >
                مبلغ ثابت ({currencyCode})
              </button>
              <button
                type="button"
                onClick={() => setDiscountType('percent')}
                className={`rounded px-2.5 py-0.5 font-bold transition ${
                  discountType === 'percent' ? 'bg-sky-500 text-slate-950' : 'text-slate-400 hover:text-white'
                }`}
              >
                نسبة مئوية (%)
              </button>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <input
              type="number"
              min="0"
              step="any"
              value={discountValue || ''}
              onChange={e => setDiscountValue(Math.max(0, parseFloat(e.target.value) || 0))}
              placeholder={discountType === 'percent' ? 'مثال: 5%' : `مثال: 50 ${currencyCode}`}
              dir="ltr"
              className="flex-1 rounded-lg border border-white/10 bg-slate-900 px-3 py-1.5 text-sm text-white font-mono outline-none focus:border-sky-500/50"
            />
            <span className="text-amber-400 font-mono font-bold text-xs" dir="ltr">
              - {fmt(discountAmount)} {currencyCode}
            </span>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-white/5 pt-3 text-base font-bold">
          <span className="text-white">الإجمالي المستحق</span>
          <span className="text-emerald-400 font-mono text-lg" dir="ltr">{fmt(total)} {currencyCode}</span>
        </div>

        {paymentMethod === 'credit' ? (
          <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-2.5 text-center text-xs font-semibold text-amber-300">
            ⚠️ بيع آجل (على الدين): لن يتم تسجيل قبض بالصندوق، وسيتم تسجيل كامل المبلغ {fmt(total)} {currencyCode} كذمم مدينة على العميل.
          </div>
        ) : (
          <p className="text-xs text-emerald-400">✓ الفاتورة مدفوعة بالكامل</p>
        )}
      </div>

      {/* ── ملاحظات ── */}
      <div className="rounded-2xl border border-white/5 bg-slate-900 p-5">
        <label className="mb-2 block text-xs text-slate-400">ملاحظات (تظهر في الفاتورة)</label>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="شكراً لتعاملكم معنا..."
          rows={2}
          className="w-full resize-none rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-sky-500/50"
        />
      </div>

      {error && (
        <p className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </p>
      )}

      <div className="flex gap-3 pb-6">
        <button type="button" onClick={() => router.back()}
          className="flex-1 rounded-xl border border-white/10 py-3 text-sm text-slate-400 transition-colors hover:text-white">
          إلغاء
        </button>
        <button type="submit" disabled={saving}
          className="flex-[2] rounded-xl bg-sky-600 py-3 text-sm font-semibold text-white transition-colors hover:bg-sky-500 disabled:opacity-50">
          {saving ? 'جاري الحفظ...' : 'إنشاء الفاتورة'}
        </button>
      </div>
    </form>
  )
}
