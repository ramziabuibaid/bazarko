'use client'

import { useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { recordAuditEvent } from '@/app/dashboard/accounting/audit-actions'
import { deleteInvoice } from '@/app/dashboard/accounting/invoices/invoice-actions'
import BackToDashboardButton from '@/components/dashboard/BackToDashboardButton'

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
  id?: string
  key: number
  product_id: string | null
  name: string
  sku: string
  quantity: number
  unit_price: number
}

interface InvoiceData {
  id: string
  invoice_number: string
  customer_id: string | null
  customer_name: string | null
  customer_phone: string | null
  customer_address: string | null
  issue_date: string
  due_date: string | null
  subtotal: number
  discount_type?: string | null
  discount_value?: number | null
  discount_amount: number
  total: number
  amount_paid: number
  payment_method?: string | null
  status: string
  notes: string | null
  items: {
    id: string
    product_id: string | null
    name: string
    sku: string | null
    quantity: number
    unit_price: number
    total: number
  }[]
}

interface Props {
  storeId: string
  userId: string
  currencyCode: string
  storeName: string
  invoice: InvoiceData
}

let keySeq = 1000

function useDebounce<T extends (...args: Parameters<T>) => void>(fn: T, ms: number) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  return useCallback((...args: Parameters<T>) => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => fn(...args), ms)
  }, [fn, ms])
}

export default function EditInvoiceForm({ storeId, userId, currencyCode, storeName, invoice }: Props) {
  const router = useRouter()
  const supabase = createClient()

  // ── حالة الزبون ──────────────────────────────────────────────
  const [customerName, setCustomerName] = useState(invoice.customer_name || '')
  const [customerPhone, setCustomerPhone] = useState(invoice.customer_phone || '')
  const [customerAddress, setCustomerAddress] = useState(invoice.customer_address || '')
  const [customerId, setCustomerId] = useState<string | null>(invoice.customer_id)

  const [customerSearch, setCustomerSearch] = useState('')
  const [customerResults, setCustomerResults] = useState<Customer[]>([])
  const [showCustomerSearch, setShowCustomerSearch] = useState(false)

  // ── البنود ───────────────────────────────────────────────────
  const [items, setItems] = useState<LineItem[]>(
    invoice.items.map(i => ({
      id: i.id,
      key: keySeq++,
      product_id: i.product_id,
      name: i.name,
      sku: i.sku || '',
      quantity: Number(i.quantity),
      unit_price: Number(i.unit_price),
    }))
  )

  // ── طريقة الدفع ──────────────────────────────────────────────
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'credit' | 'bank' | 'check' | 'card'>(
    (invoice.payment_method as any) || (invoice.amount_paid >= invoice.total ? 'cash' : 'credit')
  )

  // ── الخصم: نوعين (مبلغ ثابت ₪ / نسبة مئوية %) ────────────────
  const [discountType, setDiscountType] = useState<'amount' | 'percent'>(
    (invoice.discount_type as any) || 'amount'
  )
  const [discountValue, setDiscountValue] = useState<number>(
    invoice.discount_value !== undefined && invoice.discount_value !== null
      ? Number(invoice.discount_value)
      : Number(invoice.discount_amount || 0)
  )

  // ── التواريخ والملاحظات ────────────────────────────────────────
  const [issueDate, setIssueDate] = useState(invoice.issue_date || new Date().toISOString().slice(0, 10))
  const [dueDate, setDueDate] = useState(invoice.due_date || '')
  const [notes, setNotes] = useState(invoice.notes || '')
  const [amountPaid, setAmountPaid] = useState<number>(Number(invoice.amount_paid || 0))
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')

  async function handleDeleteInvoice() {
    if (saving || deleting) return
    if (!window.confirm(`هل أنت متأكد من رغبتك في حذف الفاتورة #${invoice.invoice_number} نهائياً؟\nسيتم استرجاع كميات المخزون للأصناف وعكس أي ذمم مسجلة على الزبون وإلغاء القيد المحاسبي المرتبط.`)) {
      return
    }

    setDeleting(true)
    setError('')
    try {
      const res = await deleteInvoice(invoice.id)
      if (res.ok) {
        router.push('/dashboard/accounting/invoices')
        router.refresh()
      } else {
        setError(res.error || 'تعذر حذف الفاتورة')
      }
    } catch (err: any) {
      console.error(err)
      setError(err?.message || 'حدث خطأ أثناء حذف الفاتورة')
    } finally {
      setDeleting(false)
    }
  }

  // ── بحث المنتجات ─────────────────────────────────────────────
  const [productSearch, setProductSearch] = useState('')
  const [productResults, setProductResults] = useState<Product[]>([])

  // ── العمليات الحسابية ────────────────────────────────────────
  const subtotal = items.reduce((s, i) => s + (Number(i.quantity) || 0) * (Number(i.unit_price) || 0), 0)

  const computedDiscount = discountType === 'percent'
    ? (subtotal * (Number(discountValue) || 0)) / 100
    : (Number(discountValue) || 0)

  const finalDiscount = Math.min(subtotal, Math.max(0, computedDiscount))
  const total = Math.max(0, subtotal - finalDiscount)

  const fmt = (n: number) => n.toLocaleString('ar-u-nu-latn', { maximumFractionDigits: 2 })

  // ── Debounced searches ────────────────────────────────────────
  const searchCustomers = useDebounce(async (q: string) => {
    const raw = q.trim()
    if (!raw) { setCustomerResults([]); return }
    const tokens = raw.split(/\s+/).filter(Boolean)
    if (tokens.length === 0) { setCustomerResults([]); return }

    let query = supabase
      .from('customers')
      .select('id, name, phone, balance')
      .eq('store_id', storeId)

    for (const t of tokens) {
      const safe = t.replace(/[,()%]/g, '')
      if (safe) {
        query = query.or(`name.ilike.%${safe}%,phone.ilike.%${safe}%`)
      }
    }

    const { data } = await query.limit(8)
    setCustomerResults((data as Customer[] | null) ?? [])
  }, 200)

  const searchProducts = useDebounce(async (q: string) => {
    const raw = q.trim()
    if (!raw) { setProductResults([]); return }
    const tokens = raw.split(/\s+/).filter(Boolean)
    if (tokens.length === 0) { setProductResults([]); return }

    let query = supabase
      .from('products')
      .select('id, name, sku, price, thumbnail_url')
      .eq('store_id', storeId)
      .eq('is_active', true)

    for (const t of tokens) {
      const safe = t.replace(/[,()%]/g, '')
      if (safe) {
        query = query.or(`name.ilike.%${safe}%,sku.ilike.%${safe}%`)
      }
    }

    const { data } = await query.limit(8)
    setProductResults((data as Product[] | null) ?? [])
  }, 200)

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
      },
    ])
    setProductSearch('')
    setProductResults([])
  }

  function addEmptyItem() {
    setItems(prev => [
      ...prev,
      {
        key: keySeq++,
        product_id: null,
        name: '',
        sku: '',
        quantity: 1,
        unit_price: 0,
      },
    ])
  }

  function updateItem(key: number, field: keyof LineItem, value: any) {
    setItems(prev => prev.map(i => (i.key === key ? { ...i, [field]: value } : i)))
  }

  function removeItem(key: number) {
    if (items.length <= 1) return
    setItems(prev => prev.filter(i => i.key !== key))
  }

  // ── الحفظ ومعالجة الأثر المحاسبي والمخزني ───────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (items.length === 0) { setError('يجب إضافة بند واحد على الأقل'); return }
    if (items.some(i => !i.name.trim())) { setError('جميع البنود يجب أن تحتوي على اسم أو وصف'); return }
    if (items.some(i => i.unit_price < 0)) { setError('السعر لا يمكن أن يكون سالباً'); return }
    if (items.some(i => i.quantity < 1)) { setError('الكمية يجب أن تكون 1 على الأقل'); return }

    setSaving(true)

    try {
      // التحقق من قفل الفترة المحاسبية لتاريخ الفاتورة
      const { data: closedPeriod } = await supabase
        .from('accounting_periods')
        .select('period_name')
        .eq('store_id', storeId)
        .eq('is_closed', true)
        .lte('start_date', issueDate)
        .gte('end_date', issueDate)
        .maybeSingle()

      if (closedPeriod) {
        setSaving(false)
        setError(`لا يمكن تعديل فاتورة تقع ضمن فترة محاسبية مقفلة (${closedPeriod.period_name})`)
        return
      }

      // 1. حساب حالة السداد والمبلغ المدفوع بناءً على طريقة الدفع
      let effectivePaid = amountPaid
      let effectiveStatus = 'draft'

      if (paymentMethod === 'credit') {
        // آجل / على الحساب: لا يعتبر مدفوعاً
        effectivePaid = Math.min(amountPaid, total - 0.01 > 0 ? total - 0.01 : 0)
        effectiveStatus = effectivePaid > 0 ? 'partial' : 'draft'
      } else if (paymentMethod === 'cash') {
        // نقداً
        effectivePaid = total
        effectiveStatus = 'paid'
      } else {
        effectiveStatus = effectivePaid >= total ? 'paid' : effectivePaid > 0 ? 'partial' : 'draft'
      }

      // 2. إدارة المخزون: عكس الكميات السابقة أولاً لتجنب التكرار
      for (const oldItem of invoice.items) {
        if (oldItem.product_id) {
          const { data: p } = await supabase.from('products').select('stock_quantity').eq('id', oldItem.product_id).single()
          if (p) {
            const restoredStock = Number(p.stock_quantity || 0) + Number(oldItem.quantity)
            await supabase.from('products').update({ stock_quantity: restoredStock }).eq('id', oldItem.product_id)
          }
        }
      }

      // حذف حركات المخزون السابقة للفاتورة
      await supabase.from('inventory_movements').delete().eq('ref_id', invoice.id)

      // خصم الكميات الجديدة وتسجيل حركات المخزون المحدثة
      for (const newItem of items) {
        if (newItem.product_id) {
          const { data: p } = await supabase.from('products').select('stock_quantity').eq('id', newItem.product_id).single()
          if (p) {
            const newStock = Math.max(0, Number(p.stock_quantity || 0) - Number(newItem.quantity))
            await supabase.from('products').update({ stock_quantity: newStock }).eq('id', newItem.product_id)

            await supabase.from('inventory_movements').insert({
              store_id: storeId,
              product_id: newItem.product_id,
              movement_type: 'sale',
              document_number: invoice.invoice_number,
              document_type: 'فاتورة مبيعات (معدلة)',
              ref_id: invoice.id,
              entity_name: customerName || 'عميل نقدي',
              quantity_in: 0,
              quantity_out: Number(newItem.quantity),
              balance_after: newStock,
              unit_price: Number(newItem.unit_price),
              movement_date: issueDate,
            })
          }
        }
      }

      // 3. إدارة كشف حساب العميل والذمم: عكس الأثر المالي السابق وتطبيق الجديد
      if (invoice.customer_id) {
        const { data: prevCust } = await supabase.from('customers').select('balance, total_invoiced, total_paid').eq('id', invoice.customer_id).single()
        if (prevCust) {
          const prevNetDebt = Math.max(0, Number(invoice.total || 0) - Number(invoice.amount_paid || 0))
          await supabase.from('customers').update({
            balance: Math.max(0, Number(prevCust.balance || 0) - prevNetDebt),
            total_invoiced: Math.max(0, Number(prevCust.total_invoiced || 0) - Number(invoice.total || 0)),
            total_paid: Math.max(0, Number(prevCust.total_paid || 0) - Number(invoice.amount_paid || 0)),
          }).eq('id', invoice.customer_id)
        }
        // مسح قيود كشف الحساب السابقة للفاتورة
        await supabase.from('customer_ledger').delete().eq('reference_id', invoice.id).eq('reference_type', 'invoice')
      }

      // تطبيق الذمة للعميل المحدث
      if (customerId) {
        const { data: currCust } = await supabase.from('customers').select('balance, total_invoiced, total_paid').eq('id', customerId).single()
        if (currCust) {
          const currentBal = Number(currCust.balance || 0)
          const newBalAfterInv = currentBal + total
          const finalBal = newBalAfterInv - effectivePaid

          await supabase.from('customer_ledger').insert({
            store_id: storeId,
            customer_id: customerId,
            type: 'invoice',
            date: issueDate,
            description: `فاتورة مبيعات معدلة ${invoice.invoice_number}`,
            debit: total,
            credit: 0,
            balance: newBalAfterInv,
            reference_id: invoice.id,
            reference_type: 'invoice',
            created_by: userId,
          })

          if (effectivePaid > 0) {
            await supabase.from('customer_ledger').insert({
              store_id: storeId,
              customer_id: customerId,
              type: 'payment',
              date: issueDate,
              description: `دفعة مسددة على فاتورة ${invoice.invoice_number}`,
              debit: 0,
              credit: effectivePaid,
              balance: finalBal,
              reference_id: invoice.id,
              reference_type: 'invoice',
              created_by: userId,
            })
          }

          await supabase.from('customers').update({
            balance: finalBal,
            total_invoiced: Number(currCust.total_invoiced || 0) + total,
            total_paid: Number(currCust.total_paid || 0) + effectivePaid,
          }).eq('id', customerId)
        }
      }

      // 4. تحديث سجل الفاتورة نفسه
      const { error: updateErr } = await supabase
        .from('invoices')
        .update({
          customer_id: customerId || null,
          customer_name: customerName.trim() || null,
          customer_phone: customerPhone.trim() || null,
          customer_address: customerAddress.trim() || null,
          issue_date: issueDate,
          due_date: dueDate || null,
          payment_method: paymentMethod,
          subtotal,
          discount_type: discountType,
          discount_value: Number(discountValue) || 0,
          discount_amount: finalDiscount,
          total,
          amount_paid: effectivePaid,
          status: effectiveStatus,
          notes: notes.trim() || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', invoice.id)

      if (updateErr) throw updateErr

      // 5. حذف بنود الفاتورة القديمة وإدراج الجديدة
      await supabase.from('invoice_items').delete().eq('invoice_id', invoice.id)

      await supabase.from('invoice_items').insert(
        items.map(i => ({
          invoice_id: invoice.id,
          product_id: i.product_id || null,
          name: i.name,
          sku: i.sku || null,
          quantity: Number(i.quantity),
          unit_price: Number(i.unit_price),
          total: Number(i.quantity) * Number(i.unit_price),
        }))
      )

      // 6. توثيق التعديل في سجل الرقابة
      await recordAuditEvent({
        entityType: 'invoice',
        entityId: invoice.id,
        entityLabel: invoice.invoice_number,
        action: 'update',
        details: { total, effectivePaid, paymentMethod, itemsCount: items.length },
      })

      router.push(`/dashboard/accounting/invoices/${invoice.id}`)
      router.refresh()
    } catch (err: any) {
      console.error(err)
      setError(err.message || 'حدث خطأ أثناء تعديل الفاتورة')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6" dir="rtl">
      {/* Top Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <BackToDashboardButton href="/dashboard/sales" label="العودة إلى لوحة إدارة المبيعات" />
          <h1 className="text-xl font-black text-white flex items-center gap-2">
            <span>✏️</span> تعديل فاتورة المبيعات #{invoice.invoice_number}
          </h1>
        </div>
        <button
          type="button"
          disabled={saving || deleting}
          onClick={handleDeleteInvoice}
          className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-xs font-bold text-rose-400 hover:bg-rose-500/20 disabled:opacity-50 transition flex items-center gap-1.5"
        >
          <span>🗑️</span>
          <span>{deleting ? 'جارٍ حذف الفاتورة...' : 'حذف الفاتورة نهائياً'}</span>
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-xs font-bold text-red-400">
          ⚠️ {error}
        </div>
      )}

      {/* Customer & Dates Section */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Customer Box */}
        <div className="rounded-2xl border border-white/10 bg-slate-900 p-5 space-y-4 lg:col-span-2">
          <div className="flex items-center justify-between border-b border-white/5 pb-3">
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <span>👤</span> بيانات العميل / المشتري
            </h2>
            <button
              type="button"
              onClick={() => setShowCustomerSearch(s => !s)}
              className="text-xs font-bold text-sky-400 hover:text-sky-300 transition"
            >
              {showCustomerSearch ? 'إخفاء البحث بالدليل' : '🔍 اختيار من دليل العملاء'}
            </button>
          </div>

          {showCustomerSearch && (
            <div className="relative">
              <input
                type="text"
                placeholder="ابحث بالاسم أو رقم الهاتف..."
                value={customerSearch}
                onChange={e => {
                  setCustomerSearch(e.target.value)
                  searchCustomers(e.target.value)
                }}
                className="w-full rounded-xl border border-white/10 bg-slate-800 p-2.5 text-xs text-white outline-none focus:border-sky-500"
              />
              {customerResults.length > 0 && (
                <div className="absolute z-20 mt-1 w-full rounded-xl border border-white/10 bg-slate-800 shadow-2xl overflow-hidden divide-y divide-white/5">
                  {customerResults.map(c => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        setCustomerId(c.id)
                        setCustomerName(c.name)
                        setCustomerPhone(c.phone || '')
                        setShowCustomerSearch(false)
                        setCustomerResults([])
                      }}
                      className="flex w-full items-center justify-between p-2.5 text-right text-xs hover:bg-slate-700 transition text-white"
                    >
                      <span className="font-bold">{c.name}</span>
                      <span className="font-mono text-slate-400">{c.phone || '—'}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-300">اسم العميل *</label>
              <input
                type="text"
                required
                value={customerName}
                onChange={e => setCustomerName(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-slate-800 p-2.5 text-xs text-white outline-none focus:border-sky-500"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-300">رقم الهاتف</label>
              <input
                type="text"
                value={customerPhone}
                onChange={e => setCustomerPhone(e.target.value)}
                placeholder="059xxxxxxx"
                className="w-full rounded-xl border border-white/10 bg-slate-800 p-2.5 text-xs text-white outline-none focus:border-sky-500 font-mono"
                dir="ltr"
              />
            </div>
          </div>
        </div>

        {/* Invoice Meta Box */}
        <div className="rounded-2xl border border-white/10 bg-slate-900 p-5 space-y-3">
          <h2 className="text-sm font-bold text-white border-b border-white/5 pb-3">بيانات الفاتورة</h2>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-300">طريقة الدفع *</label>
            <select
              value={paymentMethod}
              onChange={e => setPaymentMethod(e.target.value as any)}
              className="w-full rounded-xl border border-white/10 bg-slate-800 p-2.5 text-xs text-white outline-none focus:border-sky-500 font-bold"
            >
              <option value="cash">نقداً (مدفوعة كاش بالكامل)</option>
              <option value="credit">على الحساب (بيع آجل / ذمة عميل)</option>
              <option value="bank">تحويل بنكي</option>
              <option value="check">شيك</option>
              <option value="card">بطاقة دفع</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-300">تاريخ الإصدار *</label>
            <input
              type="date"
              required
              value={issueDate}
              onChange={e => setIssueDate(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-slate-800 p-2 text-xs text-white outline-none focus:border-sky-500"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-300">تاريخ الاستحقاق (للآجل)</label>
            <input
              type="date"
              value={dueDate}
              onChange={e => setDueDate(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-slate-800 p-2 text-xs text-white outline-none focus:border-sky-500"
            />
          </div>
        </div>
      </div>

      {/* Items Section */}
      <div className="rounded-2xl border border-white/10 bg-slate-900 p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/5 pb-3">
          <h2 className="text-sm font-bold text-white flex items-center gap-2">
            <span>📦</span> أصناف وبنود الفاتورة
          </h2>

          <div className="flex items-center gap-2">
            {/* Search and add product */}
            <div className="relative w-64">
              <input
                type="text"
                placeholder="إضافة صنف من المخزون..."
                value={productSearch}
                onChange={e => {
                  setProductSearch(e.target.value)
                  searchProducts(e.target.value)
                }}
                className="w-full rounded-xl border border-white/10 bg-slate-800 px-3 py-1.5 text-xs text-white outline-none focus:border-sky-500"
              />
              {productResults.length > 0 && (
                <div className="absolute z-20 mt-1 w-full rounded-xl border border-white/10 bg-slate-800 shadow-2xl overflow-hidden divide-y divide-white/5">
                  {productResults.map(p => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => addProductToItems(p)}
                      className="flex w-full items-center justify-between p-2 text-right text-xs hover:bg-slate-700 transition text-white"
                    >
                      <span className="font-semibold">{p.name}</span>
                      <span className="font-mono text-emerald-400">{fmt(p.price)} {currencyCode}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={addEmptyItem}
              className="rounded-xl border border-white/10 bg-slate-800 px-3 py-1.5 text-xs font-bold text-sky-400 hover:text-white transition"
            >
              ➕ بند يدوي
            </button>
          </div>
        </div>

        {/* Items Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead>
              <tr className="border-b border-white/10 text-slate-400 font-bold">
                <th className="pb-3 w-8">#</th>
                <th className="pb-3 min-w-[200px]">اسم الصنف / البيان</th>
                <th className="pb-3 w-28 text-center">الكمية</th>
                <th className="pb-3 w-32 text-center">سعر الوحدة</th>
                <th className="pb-3 w-28 text-left">الإجمالي</th>
                <th className="pb-3 w-10 text-center"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {items.map((item, idx) => (
                <tr key={item.key} className="group hover:bg-slate-800/40 transition">
                  <td className="py-2.5 font-mono text-slate-500">{idx + 1}</td>
                  <td className="py-2.5 pl-2">
                    <input
                      type="text"
                      required
                      value={item.name}
                      onChange={e => updateItem(item.key, 'name', e.target.value)}
                      placeholder="اسم المنتج أو الخدمة..."
                      className="w-full rounded-lg border border-white/10 bg-slate-800 p-2 text-xs text-white outline-none focus:border-sky-500"
                    />
                  </td>
                  <td className="py-2.5 px-2">
                    <input
                      type="number"
                      min="1"
                      required
                      value={item.quantity}
                      onFocus={e => e.target.select()}
                      onClick={e => (e.target as HTMLInputElement).select()}
                      onChange={e => updateItem(item.key, 'quantity', Number(e.target.value))}
                      className="w-full rounded-lg border border-white/10 bg-slate-800 p-2 text-xs text-white text-center font-mono outline-none focus:border-sky-500"
                    />
                  </td>
                  <td className="py-2.5 px-2">
                    <input
                      type="number"
                      step="any"
                      min="0"
                      required
                      value={item.unit_price}
                      onFocus={e => e.target.select()}
                      onClick={e => (e.target as HTMLInputElement).select()}
                      onChange={e => updateItem(item.key, 'unit_price', Number(e.target.value))}
                      className="w-full rounded-lg border border-white/10 bg-slate-800 p-2 text-xs text-white text-center font-mono outline-none focus:border-sky-500"
                    />
                  </td>
                  <td className="py-2.5 font-mono font-bold text-left text-white">
                    {fmt((Number(item.quantity) || 0) * (Number(item.unit_price) || 0))} {currencyCode}
                  </td>
                  <td className="py-2.5 text-center">
                    {items.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeItem(item.key)}
                        className="text-slate-500 hover:text-rose-400 font-bold transition p-1"
                        title="حذف البند"
                      >
                        ✕
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Summary & Discount Section */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Notes */}
        <div className="rounded-2xl border border-white/10 bg-slate-900 p-5">
          <label className="mb-2 block text-xs font-bold text-white">ملاحظات وشروط الفاتورة</label>
          <textarea
            rows={4}
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="ملاحظات تظهر أسفل الفاتورة للعميل..."
            className="w-full rounded-xl border border-white/10 bg-slate-800 p-3 text-xs text-white outline-none focus:border-sky-500 resize-none leading-relaxed"
          />
        </div>

        {/* Calculation Box */}
        <div className="rounded-2xl border border-white/10 bg-slate-900 p-5 space-y-3 font-mono text-xs">
          <div className="flex justify-between text-slate-300 font-sans">
            <span>المجموع الفرعي:</span>
            <span className="font-mono font-bold text-white text-sm">{fmt(subtotal)} {currencyCode}</span>
          </div>

          {/* Discount Mode: Percentage or Fixed Amount */}
          <div className="rounded-xl border border-white/10 bg-slate-800/80 p-3 font-sans space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-slate-300">الخصم التجاري الممنوح:</span>
              <div className="flex rounded-lg bg-slate-900 p-0.5 text-[11px]">
                <button
                  type="button"
                  onClick={() => setDiscountType('amount')}
                  className={`rounded px-2 py-0.5 font-bold transition ${
                    discountType === 'amount' ? 'bg-sky-500 text-slate-950' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  مبلغ ثابت ({currencyCode})
                </button>
                <button
                  type="button"
                  onClick={() => setDiscountType('percent')}
                  className={`rounded px-2 py-0.5 font-bold transition ${
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
                step="any"
                min="0"
                value={discountValue}
                onChange={e => setDiscountValue(Number(e.target.value))}
                placeholder={discountType === 'percent' ? 'مثال: 5%' : `مثال: 50 ${currencyCode}`}
                className="flex-1 rounded-lg border border-white/10 bg-slate-900 p-2 text-xs text-white font-mono outline-none focus:border-sky-500"
              />
              <span className="text-amber-400 font-mono font-bold">
                - {fmt(finalDiscount)} {currencyCode}
              </span>
            </div>
          </div>

          <div className="flex justify-between text-base font-black text-white border-t border-white/10 pt-3">
            <span className="font-sans">الإجمالي النهائي المستحق:</span>
            <span className="text-emerald-400 text-lg">{fmt(total)} {currencyCode}</span>
          </div>

          {paymentMethod === 'credit' && (
            <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-2 text-center text-amber-300 font-sans text-xs">
              ⚠️ بيع آجل — يُسجل المبلغ كاملاً كذمة مدينة على العميل دون قبض بالصندوق
            </div>
          )}

          <div className="pt-4 flex flex-col sm:flex-row gap-3">
            <button
              type="submit"
              disabled={saving || deleting}
              className="flex-1 rounded-xl bg-sky-600 px-5 py-3 text-sm font-bold text-white hover:bg-sky-500 disabled:opacity-50 transition shadow-lg shadow-sky-900/40"
            >
              {saving ? 'جارٍ حفظ التعديلات...' : '💾 حفظ التعديلات'}
            </button>
            <button
              type="button"
              disabled={saving || deleting}
              onClick={handleDeleteInvoice}
              className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm font-bold text-rose-400 hover:bg-rose-500/20 disabled:opacity-50 transition flex items-center justify-center gap-1.5"
            >
              <span>🗑️</span>
              <span>{deleting ? 'جارٍ الحذف...' : 'حذف الفاتورة'}</span>
            </button>
            <button
              type="button"
              onClick={() => router.back()}
              className="rounded-xl border border-white/10 bg-slate-800 px-5 py-3 text-sm font-bold text-slate-300 hover:text-white transition"
            >
              إلغاء
            </button>
          </div>
        </div>
      </div>
    </form>
  )
}
