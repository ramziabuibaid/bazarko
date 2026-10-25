'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { updatePurchaseInvoice } from '@/app/dashboard/purchases/purchase-actions'
import styles from '@/components/dashboard/accounting/new-invoice.module.css'

interface Supplier {
  id: string
  name: string
  phone: string | null
  balance: number
}

interface Product {
  id: string
  name: string
  sku?: string | null
  barcode?: string | null
  cost_price: number | null
  stock_quantity: number
  price: number
}

interface ItemRow {
  product_id: string
  product_name: string
  quantity: string
  unit_price: string
  notes?: string
}

interface Props {
  store: { id: string; name: string; currency_code: string }
  purchase: {
    id: string
    invoice_number: string
    supplier_invoice_number: string | null
    supplier_id: string
    invoice_date: string
    due_date: string | null
    discount: number
    notes: string | null
    status: string
    paid_amount: number
    total_amount: number
  }
  initialItems: {
    id?: string
    product_id: string
    product_name: string
    quantity: number
    unit_price: number
    notes?: string | null
  }[]
  suppliers: Supplier[]
  products: Product[]
}

export default function EditPurchaseForm({
  store,
  purchase,
  initialItems,
  suppliers,
  products,
}: Props) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [date, setDate] = useState(purchase.invoice_date || '')
  const [dueDate, setDueDate] = useState(purchase.due_date || '')
  const [supplier, setSupplier] = useState(purchase.supplier_id || '')
  const [supplierNumber, setSupplierNumber] = useState(purchase.supplier_invoice_number || '')
  const [discount, setDiscount] = useState(String(purchase.discount || 0))
  const [notes, setNotes] = useState(purchase.notes || '')
  const [items, setItems] = useState<ItemRow[]>(
    initialItems.map((i) => ({
      product_id: i.product_id,
      product_name: i.product_name,
      quantity: String(i.quantity),
      unit_price: String(i.unit_price),
      notes: i.notes || '',
    }))
  )
  const [search, setSearch] = useState('')

  const currency = store.currency_code || 'ILS'
  const money = (n: number) =>
    Number.isFinite(n)
      ? `${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`
      : '—'

  const subtotal = items.reduce(
    (s, i) => s + (parseFloat(i.quantity) || 0) * (parseFloat(i.unit_price) || 0),
    0
  )
  const discountVal = Math.max(0, parseFloat(discount) || 0)
  const total = Math.max(0, subtotal - discountVal)
  const paid = Number(purchase.paid_amount || 0)
  const remaining = Math.max(0, total - paid)

  const results = search.trim()
    ? products
        .filter((p) =>
          `${p.name} ${p.sku || ''} ${p.barcode || ''}`
            .toLowerCase()
            .includes(search.trim().toLowerCase())
        )
        .slice(0, 10)
    : []

  function addItem(p: Product) {
    setError('')
    setItems((rs) => {
      const found = rs.find((r) => r.product_id === p.id)
      if (found) {
        return rs.map((r) =>
          r.product_id === p.id
            ? { ...r, quantity: String((parseFloat(r.quantity) || 0) + 1) }
            : r
        )
      }
      return [
        ...rs,
        {
          product_id: p.id,
          product_name: p.name,
          quantity: '1',
          unit_price: String(p.cost_price ?? 0),
        },
      ]
    })
    setSearch('')
  }

  function updateItem(id: string, field: 'quantity' | 'unit_price', value: string) {
    setError('')
    setItems((rs) => rs.map((r) => (r.product_id === id ? { ...r, [field]: value } : r)))
  }

  function removeItem(id: string) {
    setError('')
    if (items.length <= 1) {
      setError('يجب الإبقاء على بند واحد على الأقل للفاتورة')
      return
    }
    setItems((rs) => rs.filter((r) => r.product_id !== id))
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (!supplier) {
      setError('يرجى اختيار المورد')
      return
    }
    if (!date) {
      setError('يرجى تحديد تاريخ الفاتورة')
      return
    }
    if (dueDate && dueDate < date) {
      setError('تاريخ الاستحقاق لا يمكن أن يكون قبل تاريخ الفاتورة')
      return
    }
    if (!items.length) {
      setError('يجب إضافة بند واحد على الأقل')
      return
    }
    for (const it of items) {
      const q = parseFloat(it.quantity)
      const p = parseFloat(it.unit_price)
      if (!q || q <= 0) {
        setError(`الكمية غير صحيحة للصنف: ${it.product_name}`)
        return
      }
      if (isNaN(p) || p < 0) {
        setError(`سعر التكلفة لا يمكن أن يكون سالباً للصنف: ${it.product_name}`)
        return
      }
    }
    if (discountVal > subtotal) {
      setError('الخصم لا يمكن أن يتجاوز قيمة الفاتورة')
      return
    }
    if (total < paid) {
      setError(
        `لا يمكن تخفيض إجمالي الفاتورة (${money(total)}) ليصبح أقل من المبلغ المسدد مسبقاً (${money(paid)}). يرجى مراجعة الدفعات أولاً.`
      )
      return
    }

    setSaving(true)
    try {
      const res = await updatePurchaseInvoice(purchase.id, {
        invoice_date: date,
        due_date: dueDate || null,
        supplier_id: supplier,
        supplier_number: supplierNumber.trim() || null,
        discount: discountVal,
        notes: notes.trim() || null,
        items: items.map((i) => ({
          product_id: i.product_id,
          quantity: parseFloat(i.quantity) || 0,
          unit_price: parseFloat(i.unit_price) || 0,
          notes: i.notes || null,
        })),
      })

      if (!res.ok) {
        setError(res.error || 'فشل حفظ تعديل الفاتورة')
        return
      }

      router.push(`/dashboard/purchases/${purchase.id}`)
      router.refresh()
    } catch (err: any) {
      console.error(err)
      setError(err?.message || 'حدث خطأ أثناء حفظ الفاتورة')
    } finally {
      setSaving(false)
    }
  }

  const inputClass = 'w-full min-w-0 bg-slate-800 border border-slate-600 rounded-xl p-3 mt-2 text-sm text-white'
  const supplierInfo = suppliers.find((s) => s.id === supplier)

  return (
    <main dir="rtl" className="text-slate-100 space-y-6">
      <Link href={`/dashboard/purchases/${purchase.id}`} className="text-slate-400 text-sm hover:text-white transition">
        ← العودة لتفاصيل الفاتورة #{purchase.invoice_number}
      </Link>

      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-slate-400">المشتريات / تعديل فاتورة</p>
          <h1 className="text-2xl font-bold mt-1">تعديل فاتورة مشتريات #{purchase.invoice_number}</h1>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`px-3 py-1 rounded-full text-xs font-bold ${
              purchase.status === 'completed'
                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
            }`}
          >
            {purchase.status === 'completed' ? 'معتمدة ومرحّلة' : 'مسودة'}
          </span>
        </div>
      </header>

      {purchase.status === 'completed' && (
        <div className="rounded-xl border border-sky-500/20 bg-sky-500/5 p-4 text-sm text-sky-200">
          ℹ️ هذه الفاتورة معتمدة ومرحّلة. حفظ التعديلات سيقوم تلقائياً بتحديث المخزون وتكلفة الأصناف، وتعديل حركة ذمة المورد، وتحديث القيد المحاسبي المرتبط وسجل التدقيق.
        </div>
      )}

      {error && (
        <div role="alert" className="rounded-xl border border-rose-500/30 bg-rose-950/60 p-4 text-sm font-semibold text-rose-300">
          ⚠️ {error}
        </div>
      )}

      <form onSubmit={handleSave} className={styles.form}>
        <div className={styles.main}>
          {/* Supplier and dates */}
          <section className={styles.panel}>
            <h2 className="font-bold mb-4 text-white">معلومات المورد وتاريخ الفاتورة</h2>
            <div className="grid sm:grid-cols-2 gap-4">
              <label className="text-sm text-slate-300">
                رقم الفاتورة بالنظام
                <input disabled className={`${inputClass} opacity-60 cursor-not-allowed`} value={purchase.invoice_number} />
              </label>
              <label className="text-sm text-slate-300">
                رقم فاتورة المورد الورقية
                <input
                  className={inputClass}
                  maxLength={100}
                  value={supplierNumber}
                  onChange={(e) => setSupplierNumber(e.target.value)}
                  placeholder="مثال: INV-9942"
                />
              </label>
              <label className="text-sm text-slate-300">
                تاريخ الفاتورة *
                <input
                  type="date"
                  className={inputClass}
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  required
                />
              </label>
              <label className="text-sm text-slate-300">
                تاريخ الاستحقاق
                <input
                  type="date"
                  className={inputClass}
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </label>
              <label className="sm:col-span-2 text-sm text-slate-300">
                المورد *
                <select
                  className={inputClass}
                  value={supplier}
                  onChange={(e) => setSupplier(e.target.value)}
                  required
                >
                  <option value="">اختر المورد</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} {s.phone ? `(${s.phone})` : ''}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {supplierInfo && (
              <p className="text-xs text-slate-400 mt-3">
                رصيد المورد الإجمالي الحالي: <span className="font-mono text-slate-200">{money(Number(supplierInfo.balance))}</span>
              </p>
            )}
          </section>

          {/* Items */}
          <section className={styles.panel}>
            <h2 className="font-bold mb-4 text-white">أصناف الفاتورة</h2>
            <label className="text-sm text-sky-300 block mb-2">
              إضافة صنف جديد (البحث بالاسم أو الكود أو الباركود):
              <input
                className={inputClass}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    if (results.length === 1) addItem(results[0])
                  }
                }}
                placeholder="اكتب اسم الصنف أو امسح الباركود..."
              />
            </label>

            {search.trim() && (
              <div className="max-h-52 overflow-auto border border-slate-700 rounded-xl mb-4 bg-slate-900">
                {results.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => addItem(p)}
                    className="w-full flex flex-wrap justify-between gap-2 text-right p-3 hover:bg-sky-950 transition border-b border-slate-800 last:border-0"
                  >
                    <span>
                      {p.name} <small className="text-slate-400 font-mono">{p.sku || p.barcode}</small>
                    </span>
                    <span className="text-sky-300 text-xs font-mono">
                      تكلفة سابقة: {money(p.cost_price ?? 0)} · إضافة ＋
                    </span>
                  </button>
                ))}
                {!results.length && <p className="p-4 text-sm text-slate-400">لا توجد أصناف مطابقة.</p>}
              </div>
            )}

            <div className="overflow-x-auto mt-4">
              <table className="w-full text-sm">
                <thead className="text-slate-400 border-b border-slate-700 text-xs">
                  <tr>
                    <th className="p-3 text-right">الصنف</th>
                    <th className="p-3 text-center w-28">الكمية</th>
                    <th className="p-3 text-center w-32">تكلفة الوحدة ({currency})</th>
                    <th className="p-3 text-left w-32">الإجمالي</th>
                    <th className="p-3 text-center w-16">حذف</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((r) => {
                    const lineTotal = (parseFloat(r.quantity) || 0) * (parseFloat(r.unit_price) || 0)
                    return (
                      <tr key={r.product_id} className="border-b border-slate-800 hover:bg-slate-800/40">
                        <td className="p-3 font-medium text-white">{r.product_name}</td>
                        <td className="p-2 text-center">
                          <input
                            type="number"
                            min="0.01"
                            step="0.01"
                            value={r.quantity}
                            onChange={(e) => updateItem(r.product_id, 'quantity', e.target.value)}
                            className="w-24 bg-slate-900 border border-slate-700 rounded-lg p-2 text-center text-white"
                          />
                        </td>
                        <td className="p-2 text-center">
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={r.unit_price}
                            onChange={(e) => updateItem(r.product_id, 'unit_price', e.target.value)}
                            className="w-28 bg-slate-900 border border-slate-700 rounded-lg p-2 text-center text-white font-mono"
                          />
                        </td>
                        <td className="p-3 text-left font-mono font-semibold text-sky-300 whitespace-nowrap" dir="ltr">
                          {money(lineTotal)}
                        </td>
                        <td className="p-2 text-center">
                          <button
                            type="button"
                            onClick={() => removeItem(r.product_id)}
                            className="text-rose-400 hover:text-rose-300 text-lg px-2 py-1 rounded"
                            title="حذف الصنف"
                          >
                            ×
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        {/* Sidebar summary */}
        <aside className={styles.side}>
          <section className={styles.panel}>
            <h2 className="font-bold mb-3 text-white">ملخص الفاتورة</h2>
            <div className={styles.summary}>
              <span>عدد الأصناف</span>
              <span className="font-mono">{items.length}</span>
            </div>
            <div className={styles.summary}>
              <span>المجموع الفرعي</span>
              <span className="font-mono">{money(subtotal)}</span>
            </div>

            <label className="block mt-4 text-sm text-slate-300">
              الخصم ({currency})
              <input
                type="number"
                min="0"
                step="0.01"
                className={inputClass}
                value={discount}
                onChange={(e) => setDiscount(e.target.value)}
              />
            </label>

            <div className={`${styles.summary} mt-4 pt-3 border-t border-slate-700 font-bold text-base`}>
              <span>الإجمالي الكلي المحدث</span>
              <strong className="text-sky-300 font-mono">{money(total)}</strong>
            </div>

            {paid > 0 && (
              <div className="mt-3 pt-3 border-t border-slate-700 space-y-1.5 text-xs">
                <div className="flex justify-between text-slate-400">
                  <span>المدفوع مسبقاً (سندات صرف):</span>
                  <span className="font-mono text-emerald-400">{money(paid)}</span>
                </div>
                <div className="flex justify-between text-slate-400">
                  <span>المتبقي على ذمة المورد:</span>
                  <span className="font-mono font-bold text-white">{money(remaining)}</span>
                </div>
              </div>
            )}
          </section>

          <section className={styles.panel}>
            <label className="block text-sm text-slate-300">
              ملاحظات الفاتورة
              <textarea
                maxLength={2000}
                rows={3}
                className={inputClass}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="أضف ملاحظات على الفاتورة..."
              />
            </label>
          </section>

          <div className={styles.actions}>
            <button
              type="submit"
              disabled={saving}
              className="w-full bg-sky-600 hover:bg-sky-500 text-white font-bold py-3 rounded-xl transition disabled:opacity-50"
            >
              {saving ? 'جارٍ حفظ التعديلات وتحديث الحسابات...' : 'حفظ تعديل الفاتورة'}
            </button>
            <Link
              href={`/dashboard/purchases/${purchase.id}`}
              className="block text-center text-slate-400 hover:text-slate-300 p-2 text-sm"
            >
              إلغاء والعودة
            </Link>
          </div>
        </aside>
      </form>
    </main>
  )
}
