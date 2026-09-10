'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

interface PurchaseReturnItem {
  id: string
  product_id: string | null
  product_name: string
  quantity: number
  unit_price: number
  total_price: number
}

interface PurchaseReturn {
  id: string
  store_id: string
  supplier_id: string | null
  return_number: string
  status: string
  refund_method: string
  total_amount: number
  return_date: string
  reason: string | null
  notes: string | null
  supplier?: { id: string; name: string; phone: string | null } | null
  items?: PurchaseReturnItem[]
}

interface Supplier {
  id: string
  name: string
  phone: string | null
  balance: number
}

interface Product {
  id: string
  name: string
  cost_price: number | null
  price: number
  stock_quantity: number
}

interface Props {
  store: { id: string; name: string; currency_code: string }
  initialReturns: PurchaseReturn[]
  suppliers: Supplier[]
  products: Product[]
}

export default function PurchaseReturnsClient({
  store,
  initialReturns,
  suppliers,
  products,
}: Props) {
  const router = useRouter()
  const supabase = createClient()

  const [returns, setReturns] = useState<PurchaseReturn[]>(initialReturns)
  const [showAddModal, setShowAddModal] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [searchQuery, setSearchQuery] = useState('')

  const [formData, setFormData] = useState({
    return_number: `PRET-${Date.now().toString().slice(-6)}`,
    return_date: new Date().toISOString().slice(0, 10),
    supplier_id: suppliers[0]?.id || '',
    refund_method: 'credit',
    reason: 'إرجاع بضاعة غير مطابقة أو تالفة للمورد',
    notes: '',
    items: [{ product_id: products[0]?.id || '', product_name: products[0]?.name || '', quantity: 1, unit_price: products[0]?.cost_price || 0 }],
  })

  const addItemRow = () => {
    const firstProd = products[0]
    setFormData(prev => ({
      ...prev,
      items: [
        ...prev.items,
        {
          product_id: firstProd?.id || '',
          product_name: firstProd?.name || '',
          quantity: 1,
          unit_price: firstProd?.cost_price || 0,
        },
      ],
    }))
  }

  const removeItemRow = (idx: number) => {
    if (formData.items.length <= 1) return
    setFormData(prev => ({
      ...prev,
      items: prev.items.filter((_, i) => i !== idx),
    }))
  }

  const updateItemRow = (idx: number, field: string, val: any) => {
    setFormData(prev => ({
      ...prev,
      items: prev.items.map((item, i) => {
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
    }))
  }

  const returnTotal = formData.items.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.unit_price || 0), 0)

  const handleSubmitReturn = async (e: React.FormEvent) => {
    e.preventDefault()
    if (returnTotal <= 0) {
      setError('يرجى تحديد أصناف وكميات صحيحة للإرجاع')
      return
    }

    setLoading(true)
    setError('')

    try {
      const selectedSupplier = suppliers.find(s => s.id === formData.supplier_id)

      // 1. Insert Purchase Return
      const { data: returnRecord, error: returnErr } = await supabase
        .from('purchase_returns')
        .insert({
          store_id: store.id,
          return_number: formData.return_number.trim(),
          supplier_id: formData.supplier_id || null,
          refund_method: formData.refund_method,
          total_amount: returnTotal,
          return_date: formData.return_date,
          reason: formData.reason.trim(),
          notes: formData.notes.trim() || null,
          status: 'completed',
        })
        .select('*, supplier:suppliers(id, name, phone)')
        .single()

      if (returnErr) throw returnErr

      // 2. Insert Return Items
      const itemPayloads = formData.items.map(item => ({
        purchase_return_id: returnRecord.id,
        product_id: item.product_id || null,
        product_name: item.product_name,
        quantity: Number(item.quantity),
        unit_price: Number(item.unit_price),
        total_price: Number(item.quantity) * Number(item.unit_price),
      }))

      const { error: itemsErr } = await supabase.from('purchase_return_items').insert(itemPayloads)
      if (itemsErr) throw itemsErr

      // 3. Deduct from Inventory & Log Inventory Movements
      for (const item of formData.items) {
        if (item.product_id) {
          const prod = products.find(p => p.id === item.product_id)
          const newQty = Math.max(0, Number(prod?.stock_quantity || 0) - Number(item.quantity))

          await supabase.from('products').update({ stock_quantity: newQty }).eq('id', item.product_id)

          await supabase.from('inventory_movements').insert({
            store_id: store.id,
            product_id: item.product_id,
            movement_type: 'purchase_return',
            document_number: formData.return_number,
            document_type: 'مردودات مشتريات',
            ref_id: returnRecord.id,
            entity_name: selectedSupplier?.name || 'مورد عام',
            quantity_in: 0,
            quantity_out: Number(item.quantity),
            balance_after: newQty,
            unit_price: Number(item.unit_price),
            movement_date: formData.return_date,
          })
        }
      }

      // 4. Update Supplier balance (debit supplier - reduces balance owed)
      if (formData.supplier_id && formData.refund_method === 'credit') {
        const newBal = Number(selectedSupplier?.balance || 0) - returnTotal
        await supabase.from('suppliers').update({ balance: newBal }).eq('id', formData.supplier_id)
      }

      setReturns(prev => [{ ...returnRecord, items: itemPayloads }, ...prev])
      setShowAddModal(false)
      router.refresh()
    } catch (err: any) {
      setError(err.message || 'فشل حفظ مردود المشتريات')
    } finally {
      setLoading(false)
    }
  }

  const filteredReturns = returns.filter(r => {
    if (!searchQuery) return true
    const q = searchQuery.toLowerCase()
    return (
      r.return_number.toLowerCase().includes(q) ||
      (r.supplier?.name || '').toLowerCase().includes(q) ||
      (r.reason || '').toLowerCase().includes(q)
    )
  })

  const totalReturnAmount = returns.reduce((sum, r) => sum + Number(r.total_amount || 0), 0)

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <span>🔄</span> مردودات المشتريات للموردين (Purchase Returns)
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            إرجاع البضائع للموردين وخصمها من المخزون ومن رصيد المورد الدائن
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/dashboard/purchases"
            className="rounded-xl border border-white/10 bg-slate-800 px-4 py-2 text-xs font-bold text-slate-300 hover:bg-slate-700 transition"
          >
            ← فواتير المشتريات
          </Link>
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-1.5 rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-bold text-slate-950 hover:bg-sky-400 transition"
          >
            ➕ تسجيل مردود مشتريات جديد
          </button>
        </div>
      </div>

      {/* ── Summary Stats ── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-white/10 bg-slate-900 p-5">
          <p className="text-xs font-semibold text-slate-400">إجمالي مردودات الشراء</p>
          <p className="mt-2 text-2xl font-black text-white font-mono">
            {totalReturnAmount.toLocaleString('en-GB', { minimumFractionDigits: 2 })}{' '}
            <span className="text-xs text-sky-400">₪</span>
          </p>
          <p className="mt-1 text-xs text-slate-500">{returns.length} سند إرجاع مورد</p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-slate-900 p-5">
          <p className="text-xs font-semibold text-slate-400">خصم المخزون التلقائي</p>
          <p className="mt-2 text-base font-bold text-emerald-400">✅ إخراج فوري من المستودع</p>
          <p className="mt-1 text-xs text-slate-500">تسجيل حركة الصرف في كشف حركات الصنف</p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-slate-900 p-5">
          <p className="text-xs font-semibold text-slate-400">تسوية رصيد المورد</p>
          <p className="mt-2 text-base font-bold text-purple-400">خصم القيمة من المستحقات</p>
          <p className="mt-1 text-xs text-slate-500">تخفيض دين المورد أو استرداد نقدي</p>
        </div>
      </div>

      {/* ── Table ── */}
      <div className="overflow-hidden rounded-2xl border border-white/10 bg-slate-900 shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead>
              <tr className="border-b border-white/10 bg-slate-800/60 text-slate-400 font-bold">
                <th className="p-3.5">رقم السند</th>
                <th className="p-3.5">التاريخ</th>
                <th className="p-3.5">المورد</th>
                <th className="p-3.5">طريقة التسوية</th>
                <th className="p-3.5">سبب الإرجاع</th>
                <th className="p-3.5">المبلغ الإجمالي</th>
                <th className="p-3.5 text-center">الطباعة</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 text-slate-200">
              {filteredReturns.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-slate-500">
                    لا توجد مردودات مشتريات مسجلة بعد
                  </td>
                </tr>
              ) : (
                filteredReturns.map(ret => (
                  <tr key={ret.id} className="hover:bg-slate-800/40 transition">
                    <td className="p-3.5 font-mono font-bold text-sky-400">
                      <Link href={`/dashboard/purchases/returns/print/${ret.id}`} className="hover:underline">
                        #{ret.return_number}
                      </Link>
                    </td>

                    <td className="p-3.5 font-mono text-slate-300">
                      {new Date(ret.return_date).toLocaleDateString('en-GB')}
                    </td>

                    <td className="p-3.5">
                      <p className="font-semibold text-white">{ret.supplier?.name || 'مورد عام'}</p>
                      {ret.supplier?.phone && <p className="text-[10px] text-slate-500">{ret.supplier.phone}</p>}
                    </td>

                    <td className="p-3.5">
                      <span className="rounded-lg bg-slate-800 px-2.5 py-1 text-[11px] font-bold text-slate-300">
                        {ret.refund_method === 'credit' && 'خصم من رصيد المورد'}
                        {ret.refund_method === 'cash' && 'استرداد نقدي'}
                      </span>
                    </td>

                    <td className="p-3.5 text-slate-400">{ret.reason || '—'}</td>

                    <td className="p-3.5 font-mono font-bold text-white text-sm">
                      {Number(ret.total_amount).toLocaleString('en-GB', { minimumFractionDigits: 2 })} ₪
                    </td>

                    <td className="p-3.5 text-center">
                      <Link
                        href={`/dashboard/purchases/returns/print/${ret.id}`}
                        className="rounded-lg border border-white/10 bg-white/5 p-1.5 text-slate-400 hover:text-white transition"
                        title="طباعة سند المردود"
                      >
                        🖨️
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Modal: إنشاء مردود مشتريات جديد ── */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="relative max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-white/10 bg-slate-900 p-6 shadow-2xl">
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <span>🔄</span> تسجيل مردود مشتريات لمورد
            </h2>

            {error && <div className="mt-3 rounded-xl bg-rose-500/10 border border-rose-500/20 p-3 text-xs text-rose-400">{error}</div>}

            <form onSubmit={handleSubmitReturn} className="mt-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-300">رقم السند *</label>
                  <input
                    type="text"
                    required
                    value={formData.return_number}
                    onChange={e => setFormData({ ...formData, return_number: e.target.value })}
                    className="w-full rounded-xl border border-white/10 bg-slate-800 p-2.5 text-xs text-white outline-none focus:border-sky-500 font-mono font-bold"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-300">تاريخ الإرجاع *</label>
                  <input
                    type="date"
                    required
                    value={formData.return_date}
                    onChange={e => setFormData({ ...formData, return_date: e.target.value })}
                    className="w-full rounded-xl border border-white/10 bg-slate-800 p-2.5 text-xs text-white outline-none focus:border-sky-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-300">المورد *</label>
                  <select
                    value={formData.supplier_id}
                    onChange={e => setFormData({ ...formData, supplier_id: e.target.value })}
                    className="w-full rounded-xl border border-white/10 bg-slate-800 p-2.5 text-xs text-white outline-none focus:border-sky-500"
                  >
                    {suppliers.map(s => (
                      <option key={s.id} value={s.id}>
                        {s.name} {s.phone ? `(${s.phone})` : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-300">طريقة تسوية المردود</label>
                  <select
                    value={formData.refund_method}
                    onChange={e => setFormData({ ...formData, refund_method: e.target.value })}
                    className="w-full rounded-xl border border-white/10 bg-slate-800 p-2.5 text-xs text-white outline-none focus:border-sky-500 font-bold"
                  >
                    <option value="credit">خصم من رصيد المورد (تخفيض الدين)</option>
                    <option value="cash">استرداد نقدي للصندوق</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-300">سبب الإرجاع</label>
                <input
                  type="text"
                  value={formData.reason}
                  onChange={e => setFormData({ ...formData, reason: e.target.value })}
                  className="w-full rounded-xl border border-white/10 bg-slate-800 p-2.5 text-xs text-white outline-none focus:border-sky-500"
                />
              </div>

              {/* Items List */}
              <div className="space-y-2 border-t border-white/10 pt-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-white">الأصناف المرجعة للمورد</label>
                  <button
                    type="button"
                    onClick={addItemRow}
                    className="text-xs font-bold text-sky-400 hover:text-sky-300"
                  >
                    ➕ إضافة صنف آخر
                  </button>
                </div>

                {formData.items.map((item, idx) => (
                  <div key={idx} className="flex items-center gap-2 rounded-xl bg-slate-800/60 p-2.5">
                    <select
                      value={item.product_id}
                      onChange={e => updateItemRow(idx, 'product_id', e.target.value)}
                      className="flex-1 rounded-lg border border-white/10 bg-slate-800 p-2 text-xs text-white outline-none focus:border-sky-500"
                    >
                      {products.map(p => (
                        <option key={p.id} value={p.id}>
                          {p.name} (المخزون: {p.stock_quantity})
                        </option>
                      ))}
                    </select>

                    <input
                      type="number"
                      min="1"
                      placeholder="الكمية"
                      value={item.quantity}
                      onChange={e => updateItemRow(idx, 'quantity', Number(e.target.value))}
                      className="w-20 rounded-lg border border-white/10 bg-slate-800 p-2 text-xs text-white outline-none font-mono text-center"
                    />

                    <input
                      type="number"
                      step="any"
                      placeholder="السعر"
                      value={item.unit_price}
                      onChange={e => updateItemRow(idx, 'unit_price', Number(e.target.value))}
                      className="w-24 rounded-lg border border-white/10 bg-slate-800 p-2 text-xs text-white outline-none font-mono text-center"
                    />

                    <span className="w-24 text-left font-mono font-bold text-white text-xs">
                      {(item.quantity * item.unit_price).toLocaleString('en-GB', { minimumFractionDigits: 2 })} ₪
                    </span>

                    {formData.items.length > 1 && (
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

              {/* Total Summary */}
              <div className="rounded-xl bg-slate-950 p-3 flex justify-between items-center text-xs">
                <span className="font-bold text-slate-300">إجمالي قيمة المردود:</span>
                <span className="font-mono font-black text-lg text-emerald-400">
                  {returnTotal.toLocaleString('en-GB', { minimumFractionDigits: 2 })} ₪
                </span>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="flex-1 rounded-xl border border-white/10 py-2.5 text-xs font-bold text-slate-400 hover:bg-slate-800 transition"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 rounded-xl bg-sky-500 py-2.5 text-xs font-bold text-slate-950 hover:bg-sky-400 transition disabled:opacity-50"
                >
                  {loading ? 'جارٍ الحفظ...' : 'حفظ سند مردود الشراء'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
