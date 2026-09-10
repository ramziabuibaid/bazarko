'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

interface Supplier {
  id: string
  name: string
  phone: string | null
  balance: number
}

interface Product {
  id: string
  name: string
  price: number
  cost_price: number | null
  stock_quantity: number
}

interface PurchaseItemRow {
  product_id: string
  product_name: string
  quantity: number
  unit_price: number
}

interface Props {
  store: { id: string; name: string; currency_code: string }
  suppliers: Supplier[]
  products: Product[]
}

export default function CreatePurchaseClient({ store, suppliers, products }: Props) {
  const router = useRouter()
  const supabase = createClient()

  const [invoiceNumber, setInvoiceNumber] = useState(`PUR-${Date.now().toString().slice(-6)}`)
  const [supplierInvoiceNumber, setSupplierInvoiceNumber] = useState('')
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10))
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id || '')
  const [paymentMethod, setPaymentMethod] = useState('credit')
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [items, setItems] = useState<PurchaseItemRow[]>([
    {
      product_id: products[0]?.id || '',
      product_name: products[0]?.name || '',
      quantity: 1,
      unit_price: products[0]?.cost_price || products[0]?.price || 0,
    },
  ])

  const addItemRow = () => {
    const firstProd = products[0]
    setItems(prev => [
      ...prev,
      {
        product_id: firstProd?.id || '',
        product_name: firstProd?.name || '',
        quantity: 1,
        unit_price: firstProd?.cost_price || firstProd?.price || 0,
      },
    ])
  }

  const removeItemRow = (idx: number) => {
    if (items.length <= 1) return
    setItems(prev => prev.filter((_, i) => i !== idx),)
  }

  const updateItemRow = (idx: number, field: string, val: any) => {
    setItems(prev =>
      prev.map((item, i) => {
        if (i !== idx) return item
        if (field === 'product_id') {
          const selected = products.find(p => p.id === val)
          return {
            ...item,
            product_id: val,
            product_name: selected?.name || item.product_name,
            unit_price: selected?.cost_price || selected?.price || item.unit_price,
          }
        }
        return { ...item, [field]: val }
      }),
    )
  }

  const totalAmount = items.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.unit_price || 0), 0)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (totalAmount <= 0) {
      setError('يرجى إضافة أصناف ومبالغ صحيحة')
      return
    }

    setLoading(true)
    setError('')

    try {
      const selectedSupplier = suppliers.find(s => s.id === supplierId)

      // 1. Insert Purchase Invoice
      const { data: purchase, error: purchaseErr } = await supabase
        .from('purchase_invoices')
        .insert({
          store_id: store.id,
          invoice_number: invoiceNumber.trim(),
          supplier_invoice_number: supplierInvoiceNumber.trim() || null,
          supplier_id: supplierId || null,
          payment_method: paymentMethod,
          payment_status: paymentMethod === 'cash' ? 'paid' : 'unpaid',
          subtotal: totalAmount,
          total_amount: totalAmount,
          paid_amount: paymentMethod === 'cash' ? totalAmount : 0,
          currency: 'ILS',
          invoice_date: invoiceDate,
          notes: notes.trim() || null,
          status: 'completed',
        })
        .select('id')
        .single()

      if (purchaseErr) throw purchaseErr

      // 2. Insert Items
      const itemPayloads = items.map(item => ({
        purchase_invoice_id: purchase.id,
        product_id: item.product_id || null,
        product_name: item.product_name,
        quantity: Number(item.quantity),
        unit_price: Number(item.unit_price),
        total_price: Number(item.quantity) * Number(item.unit_price),
      }))

      const { error: itemsErr } = await supabase.from('purchase_items').insert(itemPayloads)
      if (itemsErr) throw itemsErr

      // 3. Update Product Stock & Log Inventory Movements
      for (const item of items) {
        if (item.product_id) {
          const prod = products.find(p => p.id === item.product_id)
          const newQty = Number(prod?.stock_quantity || 0) + Number(item.quantity)

          await supabase
            .from('products')
            .update({
              stock_quantity: newQty,
              cost_price: Number(item.unit_price),
            })
            .eq('id', item.product_id)

          await supabase.from('inventory_movements').insert({
            store_id: store.id,
            product_id: item.product_id,
            movement_type: 'purchase',
            document_number: invoiceNumber,
            document_type: 'فاتورة مشتريات',
            ref_id: purchase.id,
            entity_name: selectedSupplier?.name || 'مورد عام',
            quantity_in: Number(item.quantity),
            quantity_out: 0,
            balance_after: newQty,
            unit_price: Number(item.unit_price),
            movement_date: invoiceDate,
          })
        }
      }

      // 4. Update Supplier balance if credit
      if (supplierId && paymentMethod === 'credit') {
        const newBal = Number(selectedSupplier?.balance || 0) + totalAmount
        await supabase.from('suppliers').update({ balance: newBal }).eq('id', supplierId)
      }

      router.push('/dashboard/purchases')
      router.refresh()
    } catch (err: any) {
      setError(err.message || 'فشل حفظ فاتورة المشتريات')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <span>✍️</span> تسجيل فاتورة مشتريات جديدة
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            إدخال بضائع مشتراة من الموردين وتحديث الأرصدة والمخزون
          </p>
        </div>

        <Link
          href="/dashboard/purchases"
          className="rounded-xl border border-white/10 bg-slate-800 px-4 py-2 text-xs font-bold text-slate-300 hover:bg-slate-700 transition"
        >
          ← العودة للمشتريات
        </Link>
      </div>

      {error && <div className="rounded-xl bg-rose-500/10 border border-rose-500/20 p-4 text-xs font-bold text-rose-400">⚠️ {error}</div>}

      <form onSubmit={handleSubmit} className="rounded-2xl border border-white/10 bg-slate-900 p-6 shadow-xl space-y-6">
        {/* Top Metadata */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-300">رقم الفاتورة بالنظام *</label>
            <input
              type="text"
              required
              value={invoiceNumber}
              onChange={e => setInvoiceNumber(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-slate-800 p-2.5 text-xs text-white outline-none focus:border-sky-500 font-mono font-bold"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-300">رقم فاتورة المورد (الورقية)</label>
            <input
              type="text"
              placeholder="مثال: INV-9942"
              value={supplierInvoiceNumber}
              onChange={e => setSupplierInvoiceNumber(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-slate-800 p-2.5 text-xs text-white outline-none focus:border-sky-500 font-mono"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-300">تاريخ الفاتورة *</label>
            <input
              type="date"
              required
              value={invoiceDate}
              onChange={e => setInvoiceDate(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-slate-800 p-2.5 text-xs text-white outline-none focus:border-sky-500"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-300">طريقة الدفع *</label>
            <select
              value={paymentMethod}
              onChange={e => setPaymentMethod(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-slate-800 p-2.5 text-xs text-white outline-none focus:border-sky-500 font-bold"
            >
              <option value="credit">آجل بالذمة (حساب المورد)</option>
              <option value="cash">نقداً من الصندوق</option>
              <option value="check">شيك</option>
            </select>
          </div>
        </div>

        {/* Supplier Selector */}
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-300">المورد *</label>
          <select
            value={supplierId}
            onChange={e => setSupplierId(e.target.value)}
            className="w-full rounded-xl border border-white/10 bg-slate-800 p-2.5 text-xs text-white outline-none focus:border-sky-500 font-semibold"
          >
            {suppliers.map(s => (
              <option key={s.id} value={s.id}>
                {s.name} {s.phone ? `(${s.phone})` : ''} — رصيد سابق: {Number(s.balance || 0).toLocaleString('en-GB')} ₪
              </option>
            ))}
          </select>
        </div>

        {/* Items Table */}
        <div className="space-y-2 border-t border-white/10 pt-4">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold text-white">أصناف الفاتورة والكميات وأسعار التكلفة</label>
            <button
              type="button"
              onClick={addItemRow}
              className="text-xs font-bold text-sky-400 hover:text-sky-300 transition"
            >
              ➕ إضافة صنف آخر
            </button>
          </div>

          {items.map((item, idx) => (
            <div key={idx} className="flex items-center gap-3 rounded-xl bg-slate-800/60 p-3">
              <span className="text-slate-500 font-mono text-xs w-6 text-center">{idx + 1}</span>

              <select
                value={item.product_id}
                onChange={e => updateItemRow(idx, 'product_id', e.target.value)}
                className="flex-1 rounded-lg border border-white/10 bg-slate-800 p-2 text-xs text-white outline-none focus:border-sky-500"
              >
                {products.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name} (المخزون الحالي: {p.stock_quantity})
                  </option>
                ))}
              </select>

              <div className="w-28">
                <input
                  type="number"
                  min="1"
                  placeholder="الكمية"
                  value={item.quantity}
                  onChange={e => updateItemRow(idx, 'quantity', Number(e.target.value))}
                  className="w-full rounded-lg border border-white/10 bg-slate-800 p-2 text-xs text-white outline-none font-mono text-center"
                />
              </div>

              <div className="w-32">
                <input
                  type="number"
                  step="any"
                  placeholder="سعر التكلفة"
                  value={item.unit_price}
                  onChange={e => updateItemRow(idx, 'unit_price', Number(e.target.value))}
                  className="w-full rounded-lg border border-white/10 bg-slate-800 p-2 text-xs text-white outline-none font-mono text-center"
                />
              </div>

              <span className="w-28 text-left font-mono font-bold text-emerald-400 text-xs">
                {(item.quantity * item.unit_price).toLocaleString('en-GB', { minimumFractionDigits: 2 })} ₪
              </span>

              {items.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeItemRow(idx)}
                  className="text-slate-500 hover:text-rose-400 font-bold px-1"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>

        {/* Total & Summary Box */}
        <div className="rounded-xl border border-white/10 bg-slate-950 p-4 flex justify-between items-center text-xs">
          <span className="font-bold text-slate-300">الإجمالي الكلي لفاتورة الشراء:</span>
          <span className="font-mono font-black text-2xl text-emerald-400">
            {totalAmount.toLocaleString('en-GB', { minimumFractionDigits: 2 })} ₪
          </span>
        </div>

        {/* Notes */}
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-300">ملاحظات الفاتورة</label>
          <textarea
            rows={2}
            value={notes}
            onChange={e => setNotes(e.target.value)}
            className="w-full rounded-xl border border-white/10 bg-slate-800 p-2.5 text-xs text-white outline-none focus:border-sky-500"
          />
        </div>

        {/* Buttons */}
        <div className="flex gap-4 pt-2">
          <Link
            href="/dashboard/purchases"
            className="flex-1 rounded-xl border border-white/10 py-3 text-center text-xs font-bold text-slate-400 hover:bg-slate-800 transition"
          >
            إلغاء
          </Link>
          <button
            type="submit"
            disabled={loading}
            className="flex-1 rounded-xl bg-sky-500 py-3 text-xs font-bold text-slate-950 hover:bg-sky-400 transition disabled:opacity-50 shadow-lg shadow-sky-500/20"
          >
            {loading ? 'جارٍ الحفظ...' : 'حفظ وترحيل فاتورة المشتريات'}
          </button>
        </div>
      </form>
    </div>
  )
}
