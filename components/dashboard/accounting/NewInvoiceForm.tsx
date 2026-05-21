'use client'

import { useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

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

export default function NewInvoiceForm({ storeId, userId, currencyCode, storeName, prefill }: Props) {
  const router = useRouter()
  const supabase = createClient()

  // customer
  const [customerSearch, setCustomerSearch] = useState('')
  const [customerResults, setCustomerResults] = useState<Customer[]>([])
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(
    prefill?.customerId
      ? { id: prefill.customerId, name: prefill.customerName, phone: prefill.customerPhone || null, balance: 0 }
      : null
  )
  const [customerName, setCustomerName] = useState(prefill?.customerName ?? '')
  const [customerPhone, setCustomerPhone] = useState(prefill?.customerPhone ?? '')
  const [customerAddress, setCustomerAddress] = useState('')

  // product search
  const [productSearch, setProductSearch] = useState('')
  const [productResults, setProductResults] = useState<Product[]>([])

  // line items
  const [items, setItems] = useState<LineItem[]>(
    prefill?.items.length
      ? prefill.items.map(i => ({ key: keySeq++, product_id: i.product_id, name: i.name, sku: i.sku, quantity: i.quantity, unit_price: i.unit_price }))
      : [{ key: keySeq++, product_id: null, name: '', sku: '', quantity: 1, unit_price: 0 }]
  )

  // invoice meta
  const [discountAmount, setDiscountAmount] = useState(0)
  const [issueDate, setIssueDate] = useState(new Date().toISOString().slice(0, 10))
  const [dueDate, setDueDate] = useState('')
  const [notes, setNotes] = useState('')
  const [amountPaid, setAmountPaid] = useState(0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const subtotal = items.reduce((s, i) => s + i.quantity * i.unit_price, 0)
  const total    = Math.max(0, subtotal - discountAmount)
  const fmt = (n: number) => n.toLocaleString('ar-SA', { maximumFractionDigits: 2 })

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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (items.length === 0) { setError('أضف بنداً واحداً على الأقل'); return }
    if (items.some(i => !i.name.trim())) { setError('جميع البنود يجب أن تحتوي على اسم'); return }

    setSaving(true)
    setError('')

    // توليد رقم الفاتورة
    const { count } = await supabase
      .from('invoices')
      .select('*', { count: 'exact', head: true })
      .eq('store_id', storeId)

    const invoiceNumber = `INV-${String((count ?? 0) + 1).padStart(4, '0')}`

    const { data: inv, error: invErr } = await supabase
      .from('invoices')
      .insert({
        store_id: storeId,
        invoice_number: invoiceNumber,
        order_id: prefill?.orderId ?? null,
        customer_id: selectedCustomer?.id ?? null,
        customer_name: (selectedCustomer?.name ?? customerName.trim()) || null,
        customer_phone: (selectedCustomer?.phone ?? customerPhone.trim()) || null,
        customer_address: customerAddress.trim() || null,
        issue_date: issueDate,
        due_date: dueDate || null,
        status: amountPaid >= total ? 'paid' : 'draft',
        subtotal,
        discount_amount: discountAmount,
        total,
        amount_paid: amountPaid,
        notes: notes.trim() || null,
        created_by: userId,
      })
      .select('id')
      .single()

    if (invErr || !inv) {
      setSaving(false)
      setError('حدث خطأ أثناء الحفظ')
      return
    }

    // حفظ البنود
    const itemRows = items.map(i => ({
      invoice_id: inv.id,
      product_id: i.product_id,
      name: i.name,
      sku: i.sku || null,
      quantity: i.quantity,
      unit_price: i.unit_price,
      total: i.quantity * i.unit_price,
    }))

    await supabase.from('invoice_items').insert(itemRows)

    // ربط الفاتورة بكشف حساب الزبون إذا كان مرتبطاً بزبون
    if (selectedCustomer) {
      const { data: custData } = await supabase
        .from('customers')
        .select('balance, total_invoiced, total_paid')
        .eq('id', selectedCustomer.id)
        .single()

      const currentBalance  = (custData?.balance ?? 0)
      const currentInvoiced = (custData?.total_invoiced ?? 0)
      const currentPaid     = (custData?.total_paid ?? 0)

      // حركة الدَّين (الفاتورة)
      const balanceAfterInvoice = currentBalance + total
      await supabase.from('customer_ledger').insert({
        store_id:       storeId,
        customer_id:    selectedCustomer.id,
        type:           'invoice',
        date:           issueDate,
        description:    `فاتورة ${invoiceNumber}`,
        debit:          total,
        credit:         0,
        balance:        balanceAfterInvoice,
        reference_id:   inv.id,
        reference_type: 'invoice',
        created_by:     userId,
      })

      let finalBalance = balanceAfterInvoice
      let finalPaid    = currentPaid

      // إذا دُفع مبلغ فوراً عند الإنشاء
      if (amountPaid > 0) {
        finalBalance = balanceAfterInvoice - amountPaid
        finalPaid    = currentPaid + amountPaid
        await supabase.from('customer_ledger').insert({
          store_id:       storeId,
          customer_id:    selectedCustomer.id,
          type:           'payment',
          date:           issueDate,
          description:    `دفعة على فاتورة ${invoiceNumber}`,
          debit:          0,
          credit:         amountPaid,
          balance:        finalBalance,
          reference_id:   inv.id,
          reference_type: 'invoice',
          created_by:     userId,
        })
      }

      // تحديث بيانات الزبون
      await supabase.from('customers').update({
        balance:        finalBalance,
        total_invoiced: currentInvoiced + total,
        total_paid:     finalPaid,
      }).eq('id', selectedCustomer.id)
    }

    router.push(`/dashboard/accounting/invoices/${inv.id}`)
  }

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

      {/* معلومات الزبون */}
      <div className="rounded-2xl border border-white/5 bg-slate-900 p-5 space-y-4">
        <h2 className="text-sm font-semibold text-white">معلومات الزبون</h2>

        {/* بحث عن زبون */}
        <div className="relative">
          <label className="mb-1 block text-xs text-slate-400">بحث عن زبون (اختياري)</label>
          <input
            value={customerSearch}
            onChange={e => { setCustomerSearch(e.target.value); searchCustomers(e.target.value) }}
            placeholder="اسم الزبون..."
            className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-sky-500/50"
          />
          {customerResults.length > 0 && (
            <div className="absolute top-full mt-1 z-10 w-full rounded-xl border border-white/10 bg-slate-800 shadow-xl overflow-hidden">
              {customerResults.map(c => (
                <button key={c.id} type="button"
                  onClick={() => { setSelectedCustomer(c); setCustomerName(c.name); setCustomerPhone(c.phone ?? ''); setCustomerSearch(''); setCustomerResults([]) }}
                  className="flex w-full items-center gap-3 px-4 py-3 hover:bg-white/5 text-right">
                  <div className="flex-1">
                    <p className="text-sm font-medium text-white">{c.name}</p>
                    {c.phone && <p className="text-xs text-slate-500" dir="ltr">{c.phone}</p>}
                  </div>
                  {c.balance > 0 && <span className="text-xs text-yellow-400">{fmt(c.balance)} {currencyCode}</span>}
                </button>
              ))}
            </div>
          )}
          {selectedCustomer && (
            <div className="mt-2 flex items-center gap-2 rounded-lg bg-sky-500/10 border border-sky-500/20 px-3 py-2">
              <span className="text-sm text-sky-400">{selectedCustomer.name}</span>
              <button type="button" onClick={() => { setSelectedCustomer(null); setCustomerName(''); setCustomerPhone('') }}
                className="text-xs text-slate-500 hover:text-red-400">✕</button>
            </div>
          )}
        </div>

        {/* أو إدخال يدوي */}
        {!selectedCustomer && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs text-slate-400">اسم الزبون</label>
              <input value={customerName} onChange={e => setCustomerName(e.target.value)}
                placeholder="اسم الزبون..."
                className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-sky-500/50" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-400">رقم الهاتف</label>
              <input value={customerPhone} onChange={e => setCustomerPhone(e.target.value)}
                placeholder="+970..." dir="ltr"
                className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-sky-500/50" />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs text-slate-400">العنوان</label>
              <input value={customerAddress} onChange={e => setCustomerAddress(e.target.value)}
                placeholder="المدينة، الحي، الشارع..."
                className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-sky-500/50" />
            </div>
          </div>
        )}
      </div>

      {/* تواريخ */}
      <div className="rounded-2xl border border-white/5 bg-slate-900 p-5">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="mb-1 block text-xs text-slate-400">تاريخ الإصدار *</label>
            <input type="date" value={issueDate} onChange={e => setIssueDate(e.target.value)} required
              className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white outline-none focus:border-sky-500/50" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-400">تاريخ الاستحقاق</label>
            <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white outline-none focus:border-sky-500/50" />
          </div>
        </div>
      </div>

      {/* البنود */}
      <div className="rounded-2xl border border-white/5 bg-slate-900 p-5 space-y-3">
        <h2 className="text-sm font-semibold text-white">بنود الفاتورة</h2>

        {/* بحث عن منتج لإضافته */}
        <div className="relative">
          <input
            value={productSearch}
            onChange={e => { setProductSearch(e.target.value); searchProducts(e.target.value) }}
            placeholder="🔍 ابحث عن منتج لإضافته..."
            className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-sky-500/50"
          />
          {productResults.length > 0 && (
            <div className="absolute top-full mt-1 z-10 w-full rounded-xl border border-white/10 bg-slate-800 shadow-xl overflow-hidden">
              {productResults.map(p => (
                <button key={p.id} type="button" onClick={() => addProductToItems(p)}
                  className="flex w-full items-center gap-3 px-4 py-3 hover:bg-white/5 text-right">
                  <div className="h-8 w-8 shrink-0 overflow-hidden rounded-lg bg-white/5">
                    {p.thumbnail_url ? <img src={p.thumbnail_url} alt="" className="h-full w-full object-cover" />
                      : <div className="flex h-full items-center justify-center text-xs">🛍️</div>}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm text-white">{p.name}</p>
                    {p.sku && <p className="text-xs text-slate-500" dir="ltr">{p.sku}</p>}
                  </div>
                  <span className="text-sm text-sky-400" dir="ltr">{fmt(p.price)}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* جدول البنود */}
        <div className="overflow-hidden rounded-xl border border-white/5">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5 bg-white/3">
                <th className="px-3 py-2 text-right text-xs text-slate-400">الوصف</th>
                <th className="px-3 py-2 text-center text-xs text-slate-400 w-20">الكمية</th>
                <th className="px-3 py-2 text-left text-xs text-slate-400 w-28">السعر</th>
                <th className="px-3 py-2 text-left text-xs text-slate-400 w-28">الإجمالي</th>
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
                      type="number" min="0.01" step="0.01"
                      value={item.quantity}
                      onChange={e => updateItem(item.key, 'quantity', parseFloat(e.target.value) || 0)}
                      dir="ltr"
                      className="w-16 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-center text-sm text-white outline-none focus:border-sky-500/50"
                    />
                  </td>
                  <td className="px-3 py-2 text-left">
                    <input
                      type="number" min="0" step="0.01"
                      value={item.unit_price}
                      onChange={e => updateItem(item.key, 'unit_price', parseFloat(e.target.value) || 0)}
                      dir="ltr"
                      className="w-24 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-left text-sm text-white outline-none focus:border-sky-500/50"
                    />
                  </td>
                  <td className="px-3 py-2 text-left text-sm font-medium text-white" dir="ltr">
                    {fmt(item.quantity * item.unit_price)}
                  </td>
                  <td className="px-3 py-2">
                    <button type="button" onClick={() => removeItem(item.key)}
                      className="text-slate-600 hover:text-red-400 text-xs">✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <button type="button"
          onClick={() => setItems(prev => [...prev, { key: keySeq++, product_id: null, name: '', sku: '', quantity: 1, unit_price: 0 }])}
          className="rounded-xl border border-dashed border-white/10 px-4 py-2 text-sm text-slate-400 hover:border-sky-500/30 hover:text-sky-400 w-full">
          + إضافة بند يدوي
        </button>
      </div>

      {/* الإجماليات */}
      <div className="rounded-2xl border border-white/5 bg-slate-900 p-5 space-y-3">
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-400">المجموع الفرعي</span>
          <span className="text-white" dir="ltr">{fmt(subtotal)} {currencyCode}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-400">خصم</span>
          <input
            type="number" min="0" step="0.01"
            value={discountAmount || ''}
            onChange={e => setDiscountAmount(parseFloat(e.target.value) || 0)}
            placeholder="0"
            dir="ltr"
            className="w-28 rounded-lg border border-white/10 bg-white/5 px-3 py-1 text-left text-sm text-white outline-none focus:border-sky-500/50"
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
            onChange={e => setAmountPaid(parseFloat(e.target.value) || 0)}
            placeholder="0"
            dir="ltr"
            className="w-28 rounded-lg border border-white/10 bg-white/5 px-3 py-1 text-left text-sm text-white outline-none focus:border-sky-500/50"
          />
        </div>
        {amountPaid > 0 && amountPaid < total && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-yellow-400">متبقي</span>
            <span className="font-semibold text-yellow-400" dir="ltr">{fmt(total - amountPaid)} {currencyCode}</span>
          </div>
        )}
      </div>

      {/* ملاحظات */}
      <div className="rounded-2xl border border-white/5 bg-slate-900 p-5">
        <label className="mb-2 block text-xs text-slate-400">ملاحظات (تظهر في الفاتورة)</label>
        <textarea
          value={notes} onChange={e => setNotes(e.target.value)}
          placeholder="شكراً لتعاملكم معنا..."
          rows={2}
          className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-sky-500/50 resize-none"
        />
      </div>

      {error && <p className="rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-400">{error}</p>}

      <div className="flex gap-3">
        <button type="button" onClick={() => router.back()}
          className="flex-1 rounded-xl border border-white/10 py-3 text-sm text-slate-400 hover:text-white">
          إلغاء
        </button>
        <button type="submit" disabled={saving}
          className="flex-2 flex-grow-[2] rounded-xl bg-sky-600 py-3 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50">
          {saving ? 'جاري الحفظ...' : 'إنشاء الفاتورة'}
        </button>
      </div>
    </form>
  )
}
