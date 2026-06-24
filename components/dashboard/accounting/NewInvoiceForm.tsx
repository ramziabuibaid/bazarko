'use client'

import { useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { recordAuditEvent } from '@/app/dashboard/accounting/audit-actions'

interface Product {
  id: string
  name: string
  sku: string | null
  price: number
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
}

interface Prefill {
  orderId: string
  orderNumber: string
  customerId: string | null
  customerName: string
  customerPhone: string
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
      ? prefill.items.map(i => ({ key: keySeq++, product_id: i.product_id, name: i.name, sku: i.sku, quantity: i.quantity, unit_price: i.unit_price }))
      : [{ key: keySeq++, product_id: null, name: '', sku: '', quantity: 1, unit_price: 0 }]
  )

  // ── الإجماليات ────────────────────────────────────────────────
  const [discountAmount, setDiscountAmount] = useState(0)
  const [issueDate, setIssueDate]           = useState(new Date().toISOString().slice(0, 10))
  const [dueDate, setDueDate]               = useState('')
  const [notes, setNotes]                   = useState('')
  const [amountPaid, setAmountPaid]         = useState(0)
  const [saving, setSaving]                 = useState(false)
  const [error, setError]                   = useState('')

  const subtotal = items.reduce((s, i) => s + i.quantity * i.unit_price, 0)
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
      .select('id, name, sku, price, thumbnail_url')
      .eq('store_id', storeId)
      .eq('is_active', true)
      .ilike('name', `%${q}%`)
      .limit(6)
    setProductResults((data as Product[] | null) ?? [])
  }, 250)

  // ── البنود ───────────────────────────────────────────────────

  function addProductToItems(p: Product) {
    setItems(prev => [...prev, { key: keySeq++, product_id: p.id, name: p.name, sku: p.sku ?? '', quantity: 1, unit_price: p.price }])
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

    setSaving(true)

    const { count } = await supabase
      .from('invoices')
      .select('*', { count: 'exact', head: true })
      .eq('store_id', storeId)

    const invoiceNumber = `INV-${String((count ?? 0) + 1).padStart(4, '0')}`

    const { data: inv, error: invErr } = await supabase
      .from('invoices')
      .insert({
        store_id:         storeId,
        invoice_number:   invoiceNumber,
        order_id:         prefill?.orderId ?? null,
        customer_id:      selectedCustomer?.id ?? null,
        customer_name:    (selectedCustomer?.name ?? (customerMode === 'manual' ? customerName.trim() : null)) || null,
        customer_phone:   activePhone || null,
        customer_address: customerAddress.trim() || null,
        issue_date:       issueDate,
        due_date:         dueDate || null,
        status:           amountPaid >= total ? 'paid' : amountPaid > 0 ? 'partial' : 'draft',
        paid_at:          amountPaid >= total ? new Date().toISOString() : null,
        subtotal,
        discount_amount:  discountAmount,
        total,
        amount_paid:      amountPaid,
        notes:            notes.trim() || null,
        created_by:       userId,
      })
      .select('id')
      .single()

    if (invErr || !inv) {
      setSaving(false)
      setError('حدث خطأ أثناء الحفظ')
      return
    }

    await supabase.from('invoice_items').insert(
      items.map(i => ({
        invoice_id: inv.id,
        product_id: i.product_id,
        name:       i.name,
        sku:        i.sku || null,
        quantity:   i.quantity,
        unit_price: i.unit_price,
        total:      i.quantity * i.unit_price,
      }))
    )

    if (selectedCustomer) {
      const { data: custData } = await supabase
        .from('customers')
        .select('balance, total_invoiced, total_paid')
        .eq('id', selectedCustomer.id)
        .single()

      const currentBalance  = custData?.balance ?? 0
      const currentInvoiced = custData?.total_invoiced ?? 0
      const currentPaid     = custData?.total_paid ?? 0
      const balanceAfter    = currentBalance + total

      await supabase.from('customer_ledger').insert({
        store_id: storeId, customer_id: selectedCustomer.id,
        type: 'invoice', date: issueDate,
        description: `فاتورة ${invoiceNumber}`,
        debit: total, credit: 0, balance: balanceAfter,
        reference_id: inv.id, reference_type: 'invoice', created_by: userId,
      })

      let finalBalance = balanceAfter
      let finalPaid    = currentPaid

      if (amountPaid > 0) {
        finalBalance = balanceAfter - amountPaid
        finalPaid    = currentPaid + amountPaid
        await supabase.from('customer_ledger').insert({
          store_id: storeId, customer_id: selectedCustomer.id,
          type: 'payment', date: issueDate,
          description: `دفعة على فاتورة ${invoiceNumber}`,
          debit: 0, credit: amountPaid, balance: finalBalance,
          reference_id: inv.id, reference_type: 'invoice', created_by: userId,
        })
      }

      await supabase.from('customers').update({
        balance:        finalBalance,
        total_invoiced: currentInvoiced + total,
        total_paid:     finalPaid,
      }).eq('id', selectedCustomer.id)
    }

    await recordAuditEvent({
      entityType: 'invoice', entityId: inv.id, entityLabel: invoiceNumber,
      action: 'create',
      details: { total, amountPaid, items: items.length, customer: selectedCustomer?.name ?? null },
    })

    router.push(`/dashboard/accounting/invoices/${inv.id}`)
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
            </div>
          ))}
          {items.length === 0 && (
            <p className="py-4 text-center text-sm text-slate-500">لا توجد بنود — ابحث عن منتج أو أضف بنداً يدوياً</p>
          )}
        </div>

        {/* ── جدول البنود (ديسكتوب) ── */}
        <div className="hidden md:block overflow-x-auto rounded-xl border border-white/5">
          <table className="w-full min-w-[500px] text-sm">
            <thead>
              <tr className="border-b border-white/5 bg-white/3">
                <th className="px-3 py-2.5 text-right text-xs text-slate-400">الوصف</th>
                <th className="w-20 px-3 py-2.5 text-center text-xs text-slate-400">الكمية</th>
                <th className="w-28 px-3 py-2.5 text-left text-xs text-slate-400">السعر</th>
                <th className="w-28 px-3 py-2.5 text-left text-xs text-slate-400">الإجمالي</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {items.map(item => (
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
                  <td className="px-3 py-2 text-center">
                    <input
                      type="number" min="1" step="1"
                      value={item.quantity}
                      onChange={e => updateItem(item.key, 'quantity', Math.max(1, parseInt(e.target.value) || 1))}
                      dir="ltr"
                      className="w-16 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-center text-sm text-white outline-none focus:border-sky-500/50"
                    />
                  </td>
                  <td className="px-3 py-2 text-left">
                    <input
                      type="number" min="0" step="0.01"
                      value={item.unit_price || ''}
                      onChange={e => updateItem(item.key, 'unit_price', Math.max(0, parseFloat(e.target.value) || 0))}
                      placeholder="0"
                      dir="ltr"
                      className="w-24 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-left text-sm text-white outline-none focus:border-sky-500/50"
                    />
                  </td>
                  <td className="px-3 py-2 text-left text-sm font-semibold text-white" dir="ltr">
                    {fmt(item.quantity * item.unit_price)}
                  </td>
                  <td className="px-3 py-2">
                    <button type="button" onClick={() => removeItem(item.key)}
                      className="text-slate-600 hover:text-red-400 transition-colors text-xs">✕</button>
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-sm text-slate-500">
                    لا توجد بنود
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <button
          type="button"
          onClick={() => setItems(prev => [...prev, { key: keySeq++, product_id: null, name: '', sku: '', quantity: 1, unit_price: 0 }])}
          className="w-full rounded-xl border border-dashed border-white/10 py-2.5 text-sm text-slate-400 transition-colors hover:border-sky-500/30 hover:text-sky-400"
        >
          + إضافة بند يدوي
        </button>
      </div>

      {/* ── الإجماليات ── */}
      <div className="rounded-2xl border border-white/5 bg-slate-900 p-5 space-y-3">
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-400">المجموع الفرعي</span>
          <span className="text-white" dir="ltr">{fmt(subtotal)} {currencyCode}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-400">خصم</span>
          <input
            type="number" min="0" max={subtotal} step="0.01"
            value={discountAmount || ''}
            onChange={e => setDiscountAmount(Math.max(0, parseFloat(e.target.value) || 0))}
            placeholder="0"
            dir="ltr"
            className="w-28 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-left text-sm text-white outline-none focus:border-sky-500/50"
          />
        </div>
        <div className="flex items-center justify-between border-t border-white/5 pt-3 text-base font-bold">
          <span className="text-white">الإجمالي</span>
          <span className="text-emerald-400" dir="ltr">{fmt(total)} {currencyCode}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-400">المبلغ المدفوع</span>
          <input
            type="number" min="0" step="0.01" max={total}
            value={amountPaid || ''}
            onChange={e => setAmountPaid(Math.min(total, Math.max(0, parseFloat(e.target.value) || 0)))}
            placeholder="0"
            dir="ltr"
            className="w-28 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-left text-sm text-white outline-none focus:border-sky-500/50"
          />
        </div>
        {amountPaid > 0 && amountPaid < total && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-yellow-400">متبقي</span>
            <span className="font-semibold text-yellow-400" dir="ltr">{fmt(total - amountPaid)} {currencyCode}</span>
          </div>
        )}
        {amountPaid >= total && total > 0 && (
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
