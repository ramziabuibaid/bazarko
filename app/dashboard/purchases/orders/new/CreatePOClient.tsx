'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import BackToDashboardButton from '@/components/dashboard/BackToDashboardButton'
import { createPurchaseOrder, POItemInput } from '../po-actions'

interface Supplier {
  id: string
  name: string
  phone: string | null
  balance?: number
}

interface Product {
  id: string
  name: string
  sku?: string | null
  price: number
  cost_price?: number
}

interface POFormItem {
  product_id: string | null
  item_name: string
  item_sku: string
  quantity: number
  unit_price: number
  discount_amount: number
}

interface Props {
  store: { id: string; name: string; currency_code: string }
  suppliers: Supplier[]
  products: Product[]
}

export default function CreatePOClient({ store, suppliers, products }: Props) {
  const router = useRouter()

  const [orderNumber, setOrderNumber] = useState(`PO-${Date.now().toString().slice(-6)}`)
  const [issueDate, setIssueDate] = useState(new Date().toISOString().slice(0, 10))
  const [expectedDate, setExpectedDate] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() + 7)
    return d.toISOString().slice(0, 10)
  })

  const [supplierId, setSupplierId] = useState(suppliers[0]?.id || '')
  const [supplierSearch, setSupplierSearch] = useState('')
  const [showSupplierDropdown, setShowSupplierDropdown] = useState(false)

  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const [items, setItems] = useState<POFormItem[]>([
    {
      product_id: products[0]?.id || null,
      item_name: products[0]?.name || '',
      item_sku: products[0]?.sku || '',
      quantity: 1,
      unit_price: products[0]?.cost_price || products[0]?.price || 0,
      discount_amount: 0,
    },
  ])

  const selectedSupplier = suppliers.find(s => s.id === supplierId)
  const filteredSuppliers = suppliers.filter(s => {
    if (!supplierSearch.trim()) return true
    const q = supplierSearch.toLowerCase()
    return s.name.toLowerCase().includes(q) || (s.phone && s.phone.includes(q))
  })

  const addItemRow = () => {
    const firstProd = products[0]
    setItems(prev => [
      ...prev,
      {
        product_id: firstProd?.id || null,
        item_name: firstProd?.name || '',
        item_sku: firstProd?.sku || '',
        quantity: 1,
        unit_price: firstProd?.cost_price || firstProd?.price || 0,
        discount_amount: 0,
      },
    ])
  }

  const removeItemRow = (idx: number) => {
    if (items.length <= 1) return
    setItems(prev => prev.filter((_, i) => i !== idx))
  }

  const updateItemRow = (idx: number, field: keyof POFormItem, val: any) => {
    setItems(prev =>
      prev.map((item, i) => {
        if (i !== idx) return item
        if (field === 'product_id') {
          const selected = products.find(p => p.id === val)
          return {
            ...item,
            product_id: val,
            item_name: selected?.name || item.item_name,
            item_sku: selected?.sku || item.item_sku,
            unit_price: selected?.cost_price || selected?.price || item.unit_price,
          }
        }
        return { ...item, [field]: val }
      }),
    )
  }

  const totalAmount = items.reduce(
    (sum, i) => sum + Number(i.quantity || 0) * Number(i.unit_price || 0) - Number(i.discount_amount || 0),
    0
  )

  const fmt = (n: number) => Number(n || 0).toLocaleString('ar-u-nu-latn', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const currency = store.currency_code || 'ILS'

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (totalAmount <= 0) {
      setError('يرجى إضافة أصناف ومبالغ صحيحة أكبر من الصفر')
      return
    }

    if (items.some(i => !i.item_name.trim())) {
      setError('يجب كتابة اسم الصنف لكل بند')
      return
    }

    setSubmitting(true)
    setError('')

    try {
      const res = await createPurchaseOrder({
        order_number: orderNumber,
        supplier_id: supplierId || null,
        issue_date: issueDate,
        expected_date: expectedDate || null,
        notes,
        items: items.map(i => ({
          product_id: i.product_id,
          item_name: i.item_name,
          item_sku: i.item_sku,
          quantity: i.quantity,
          unit_price: i.unit_price,
          discount_amount: i.discount_amount,
        })),
      })

      if (!res.ok) {
        setError(res.error || 'فشل حفظ أمر الشراء')
        return
      }

      router.push('/dashboard/purchases/orders')
      router.refresh()
    } catch {
      setError('حدث خطأ في الاتصال')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-6 max-w-5xl" dir="rtl">
      <div>
        <BackToDashboardButton href="/dashboard/purchases/orders" label="العودة إلى أوامر الشراء" />
      </div>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-white flex items-center gap-2">
            <span>➕</span> إنشاء أمر شراء جديد (Purchase Order)
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            تجهيز طلبية شراء رسمية للمورد وإرسالها للتوريد
          </p>
        </div>

        <Link
          href="/dashboard/purchases/orders"
          className="rounded-xl border border-white/10 bg-slate-800 px-4 py-2 text-xs font-bold text-slate-300 hover:bg-slate-700 transition"
        >
          ← قائمة أوامر الشراء
        </Link>
      </div>

      {error && (
        <div className="rounded-xl bg-rose-500/10 border border-rose-500/20 p-4 text-xs font-bold text-rose-300">
          ⚠️ {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6 rounded-2xl border border-white/10 bg-slate-900 p-6 shadow-xl">
        
        {/* بيانات أمر الشراء الأساسية */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-300">رقم أمر الشراء *</label>
            <input
              type="text"
              required
              value={orderNumber}
              onChange={e => setOrderNumber(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-slate-800 p-2.5 text-xs text-white outline-none focus:border-sky-500 font-mono font-bold"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-300">تاريخ الطلب *</label>
            <input
              type="date"
              required
              value={issueDate}
              onChange={e => setIssueDate(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-slate-800 p-2.5 text-xs text-white outline-none focus:border-sky-500"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-300">تاريخ التسليم المتوقع</label>
            <input
              type="date"
              value={expectedDate}
              onChange={e => setExpectedDate(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-slate-800 p-2.5 text-xs text-white outline-none focus:border-sky-500"
            />
          </div>
        </div>

        {/* اختيار المورد بالبحث الذكي */}
        <div className="relative">
          <label className="mb-1 block text-xs font-semibold text-slate-300">المورد *</label>
          {supplierId && selectedSupplier ? (
            <div className="flex items-center justify-between rounded-xl border border-indigo-500/30 bg-indigo-500/10 p-3 text-xs text-white">
              <div className="flex items-center gap-3">
                <span className="text-xl">🏭</span>
                <div>
                  <span className="font-bold text-sm">{selectedSupplier.name}</span>
                  {selectedSupplier.phone && (
                    <span className="text-slate-400 font-mono text-xs mr-2" dir="ltr">
                      ({selectedSupplier.phone})
                    </span>
                  )}
                  {selectedSupplier.balance !== undefined && (
                    <span className="text-amber-400 font-mono text-xs mr-3">
                      [الرصيد المستحق: {fmt(selectedSupplier.balance)} {currency}]
                    </span>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => { setSupplierId(''); setSupplierSearch('') }}
                className="text-xs text-rose-400 hover:text-rose-300 underline font-bold"
              >
                تغيير المورد
              </button>
            </div>
          ) : (
            <div>
              <input
                type="text"
                value={supplierSearch}
                onChange={e => { setSupplierSearch(e.target.value); setShowSupplierDropdown(true) }}
                onFocus={() => setShowSupplierDropdown(true)}
                placeholder="🔍 ابحث بالاسم أو رقم الهاتف لاختيار المورد..."
                className="w-full rounded-xl border border-white/10 bg-slate-800 p-3 text-xs text-white outline-none focus:border-indigo-500 placeholder-slate-500"
              />
              {showSupplierDropdown && (
                <div className="absolute z-30 mt-1 max-h-52 w-full overflow-y-auto rounded-xl border border-white/10 bg-slate-800 shadow-2xl">
                  <button
                    type="button"
                    onClick={() => { setSupplierId(''); setShowSupplierDropdown(false) }}
                    className="w-full text-right p-2.5 text-xs text-slate-300 hover:bg-white/5 border-b border-white/5 font-bold"
                  >
                    مورد عام (غير مسجل بالدليل)
                  </button>
                  {filteredSuppliers.map(s => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => {
                        setSupplierId(s.id)
                        setShowSupplierDropdown(false)
                        setSupplierSearch('')
                      }}
                      className="w-full flex items-center justify-between p-2.5 text-right text-xs text-white hover:bg-indigo-500/10 border-b border-white/5 last:border-0"
                    >
                      <div>
                        <p className="font-bold">{s.name}</p>
                        {s.phone && <p className="text-[10px] text-slate-400 font-mono" dir="ltr">{s.phone}</p>}
                      </div>
                      {s.balance !== undefined && (
                        <span className="font-mono text-amber-400 text-xs">{fmt(s.balance)} {currency}</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── جدول الأصناف والبنود ── */}
        <div className="space-y-3 border-t border-white/10 pt-4">
          <div className="flex items-center justify-between">
            <div>
              <label className="text-xs font-bold text-white block">الأصناف المطلوب شراؤها</label>
              <span className="text-[11px] text-slate-400">حدد الكميات وسعر الشراء المتفق عليه</span>
            </div>
            <button
              type="button"
              onClick={addItemRow}
              className="text-xs font-bold text-indigo-400 hover:text-indigo-300 bg-indigo-500/10 border border-indigo-500/20 px-3 py-1.5 rounded-xl transition"
            >
              ⊕ إضافة صنف آخر
            </button>
          </div>

          <div className="space-y-2.5">
            {items.map((item, idx) => (
              <div key={idx} className="flex flex-wrap items-center gap-2.5 rounded-xl bg-slate-800/60 p-3 border border-white/5">
                <span className="text-slate-500 font-mono text-xs w-5 text-center font-bold">{idx + 1}</span>

                {/* اختيار الصنف من الدليل أو كتابة اسم حر */}
                <div className="flex-1 min-w-[200px]">
                  <select
                    value={item.product_id || ''}
                    onChange={e => updateItemRow(idx, 'product_id', e.target.value)}
                    className="w-full rounded-lg border border-white/10 bg-slate-900 p-2 text-xs text-white outline-none focus:border-indigo-500 font-semibold"
                  >
                    {products.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.name} {p.sku ? `(#${p.sku})` : ''} — سعر التكلفة: {fmt(p.cost_price || p.price)} {currency}
                      </option>
                    ))}
                  </select>
                </div>

                {/* الكمية */}
                <div className="w-24">
                  <input
                    type="number"
                    min="1"
                    placeholder="الكمية"
                    value={item.quantity}
                    onChange={e => updateItemRow(idx, 'quantity', Number(e.target.value))}
                    className="w-full rounded-lg border border-white/10 bg-slate-900 p-2 text-xs text-white outline-none font-mono text-center"
                  />
                </div>

                {/* سعر التكلفة المتفق عليه */}
                <div className="w-28">
                  <input
                    type="number"
                    step="any"
                    min="0"
                    placeholder="سعر التكلفة"
                    value={item.unit_price}
                    onChange={e => updateItemRow(idx, 'unit_price', Number(e.target.value))}
                    className="w-full rounded-lg border border-white/10 bg-slate-900 p-2 text-xs text-white outline-none font-mono text-center font-bold text-indigo-400"
                  />
                </div>

                {/* الخصم إن وجد */}
                <div className="w-24">
                  <input
                    type="number"
                    step="any"
                    min="0"
                    placeholder="خصم"
                    value={item.discount_amount || ''}
                    onChange={e => updateItemRow(idx, 'discount_amount', Number(e.target.value))}
                    className="w-full rounded-lg border border-white/10 bg-slate-900 p-2 text-xs text-white outline-none font-mono text-center text-rose-400"
                  />
                </div>

                {/* الإجمالي */}
                <div className="w-28 text-left font-mono font-black text-white text-xs" dir="ltr">
                  {fmt(item.quantity * item.unit_price - item.discount_amount)} {currency}
                </div>

                {/* حذف */}
                {items.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeItemRow(idx)}
                    className="text-slate-500 hover:text-rose-400 font-bold px-1 text-sm"
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* ملخص الإجمالي */}
        <div className="rounded-xl border border-white/10 bg-slate-950 p-4 flex justify-between items-center text-xs">
          <span className="font-bold text-slate-300">إجمالي أمر الشراء المتوقع:</span>
          <span className="font-mono font-black text-2xl text-indigo-400">
            {fmt(totalAmount)} <span className="text-sm">{currency}</span>
          </span>
        </div>

        {/* ملاحظات وشروط التوريد */}
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-300">ملاحظات وشروط التوريد للمورد</label>
          <textarea
            rows={2}
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="مثال: يرجى التوصيل للمستودع الرئيسي قبل الساعة 2 ظهراً، الدفع بشيك بعد الاستلام..."
            className="w-full resize-none rounded-xl border border-white/10 bg-slate-800 p-2.5 text-xs text-white outline-none focus:border-indigo-500"
          />
        </div>

        {/* زر الحفظ */}
        <div className="flex justify-end pt-2">
          <button
            type="submit"
            disabled={submitting}
            className="rounded-xl bg-gradient-to-r from-indigo-500 to-sky-600 px-6 py-3 text-xs font-black text-white hover:from-indigo-400 hover:to-sky-500 transition shadow-lg shadow-indigo-500/10 cursor-pointer disabled:opacity-40"
          >
            {submitting ? 'جاري حفظ أمر الشراء...' : '📋 حفظ وإصدار أمر الشراء'}
          </button>
        </div>
      </form>
    </div>
  )
}
