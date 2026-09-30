'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import BackToDashboardButton from '@/components/dashboard/BackToDashboardButton'
import { requestKey, completeRequest } from '@/lib/client/idempotency'

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

  const [supplierInvoiceNumber, setSupplierInvoiceNumber] = useState('')
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10))
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id || '')
  const [paymentMethod, setPaymentMethod] = useState('credit')
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [productSearch, setProductSearch] = useState('')

  // البدء بصف فارغ تماماً بدون اختيار تلقائي لأي صنف
  const [items, setItems] = useState<PurchaseItemRow[]>([
    {
      product_id: '',
      product_name: '',
      quantity: 1,
      unit_price: 0,
    },
  ])

  const addItemRow = () => {
    setItems(prev => [
      ...prev,
      {
        product_id: '',
        product_name: '',
        quantity: 1,
        unit_price: 0,
      },
    ])
  }

  const handleQuickAddProduct = (prod: Product) => {
    setItems(prev => {
      if (prev.length === 1 && !prev[0].product_id) {
        return [{
          product_id: prod.id,
          product_name: prod.name,
          quantity: 1,
          unit_price: prod.cost_price || prod.price || 0,
        }]
      }
      return [
        ...prev,
        {
          product_id: prod.id,
          product_name: prod.name,
          quantity: 1,
          unit_price: prod.cost_price || prod.price || 0,
        },
      ]
    })
    setProductSearch('')
  }

  const removeItemRow = (idx: number) => {
    if (items.length <= 1) return
    setItems(prev => prev.filter((_, i) => i !== idx))
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
            product_name: selected?.name || '',
            unit_price: selected?.cost_price || selected?.price || 0,
          }
        }
        return { ...item, [field]: val }
      }),
    )
  }

  const validItems = items.filter(item => item.product_id && Number(item.quantity) > 0)
  const totalAmount = validItems.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.unit_price || 0), 0)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (validItems.length === 0 || totalAmount <= 0) {
      setError('يرجى اختيار صنف واحد على الأقل وتحديد الكمية وسعر التكلفة')
      return
    }

    setLoading(true)
    setError('')

    try {
      const payload = {
        supplierId,
        supplierInvoiceNumber: supplierInvoiceNumber.trim(),
        invoiceDate,
        paymentMethod,
        notes: notes.trim(),
        items: validItems.map(item => ({ productId: item.product_id, quantity: Number(item.quantity), unitPrice: Number(item.unit_price) })),
      }
      const key = await requestKey(`purchase-invoice:${store.id}`, payload)
      const { data, error: saveError } = await supabase.rpc('create_purchase_invoice_atomic', { p_store: store.id, p_payload: payload, p_key: key })
      if (saveError) throw saveError
      if (!data?.invoiceId) throw new Error('لم يرجع رقم فاتورة الشراء من الخادم')
      await completeRequest(`purchase-invoice:${store.id}`, payload)

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
      {/* ── Back to Purchases Hub ── */}
      <div>
        <BackToDashboardButton href="/dashboard/purchases-hub" label="العودة إلى لوحة إدارة المشتريات" />
      </div>

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
          ← فواتير المشتريات
        </Link>
      </div>

      {error && <div className="rounded-xl bg-rose-500/10 border border-rose-500/20 p-4 text-xs font-bold text-rose-400">⚠️ {error}</div>}

      <form onSubmit={handleSubmit} className="rounded-2xl border border-white/10 bg-slate-900 p-6 shadow-xl space-y-6">
        {/* Top Metadata */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-300">رقم الفاتورة بالنظام</label>
            <div className="w-full rounded-xl border border-white/10 bg-slate-800 p-2.5 text-xs text-slate-400">يولّد تلقائياً عند الحفظ</div>
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

        {/* Quick Search & Select by Name or Barcode */}
        <div className="rounded-xl border border-sky-500/20 bg-sky-500/5 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold text-sky-300">
              🔍 البحث اليدوي عن صنف وإضافته (بالاسم أو الكود / الباركود):
            </label>
            {productSearch && (
              <button
                type="button"
                onClick={() => setProductSearch('')}
                className="text-[11px] text-slate-400 hover:text-white"
              >
                مسح البحث ✕
              </button>
            )}
          </div>
          <input
            type="text"
            placeholder="اكتب اسم الصنف أو الباركود أو SKU..."
            value={productSearch}
            onChange={e => setProductSearch(e.target.value)}
            className="w-full rounded-lg border border-white/10 bg-slate-800 p-2 text-xs text-white placeholder:text-slate-500 outline-none focus:border-sky-500"
          />
          {productSearch.trim() && (
            <div className="max-h-40 overflow-y-auto rounded-lg border border-white/10 bg-slate-900 divide-y divide-white/5">
              {products
                .filter(p =>
                  p.name.toLowerCase().includes(productSearch.toLowerCase()) ||
                  (p.sku && p.sku.toLowerCase().includes(productSearch.toLowerCase())) ||
                  (p.barcode && p.barcode.toLowerCase().includes(productSearch.toLowerCase()))
                )
                .slice(0, 10)
                .map(p => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => handleQuickAddProduct(p)}
                    className="w-full flex items-center justify-between p-2 text-xs text-right text-slate-200 hover:bg-sky-500/20 hover:text-white transition"
                  >
                    <div>
                      <span className="font-bold">{p.name}</span>
                      {(p.sku || p.barcode) && (
                        <span className="mr-2 font-mono text-[10px] text-sky-400">
                          [{p.sku || p.barcode}]
                        </span>
                      )}
                    </div>
                    <span className="text-[11px] text-slate-400">
                      تكلفة: {p.cost_price || p.price || 0} ₪ | مخزون: {p.stock_quantity}
                    </span>
                  </button>
                ))}
            </div>
          )}
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
                <option value="">-- ابحث أو اختر الصنف بالاسم أو الكود --</option>
                {products.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name} {p.sku || p.barcode ? `[${p.sku || p.barcode}]` : ''} (المخزون الحالي: {p.stock_quantity})
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
