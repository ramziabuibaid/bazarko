'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import BackToDashboardButton from '@/components/dashboard/BackToDashboardButton'

interface Customer {
  id: string
  name: string
  phone: string | null
}

interface Product {
  id: string
  name: string
  price: number
  stock_quantity: number
}

interface QuoteItemRow {
  product_id: string
  product_name: string
  quantity: number
  unit_price: number
}

interface Props {
  store: { id: string; name: string; currency_code: string }
  customers: Customer[]
  products: Product[]
}

export default function CreateQuotationClient({ store, customers, products }: Props) {
  const router = useRouter()
  const supabase = createClient()

  const [quoteNumber, setQuoteNumber] = useState(`QT-${Date.now().toString().slice(-6)}`)
  const [issueDate, setIssueDate] = useState(new Date().toISOString().slice(0, 10))
  const [validUntil, setValidUntil] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() + 14)
    return d.toISOString().slice(0, 10)
  })
  const [customerId, setCustomerId] = useState(customers[0]?.id || '')
  const [notes, setNotes] = useState('')
  const [terms, setTerms] = useState('الأسعار شاملة ضريبة القيمة المضافة. العرض ساري لمدة 14 يوماً من تاريخه.')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [items, setItems] = useState<QuoteItemRow[]>([
    {
      product_id: products[0]?.id || '',
      product_name: products[0]?.name || '',
      quantity: 1,
      unit_price: products[0]?.price || 0,
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
        unit_price: firstProd?.price || 0,
      },
    ])
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
            product_name: selected?.name || item.product_name,
            unit_price: selected?.price || item.unit_price,
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
      // 1. Insert Quotation
      const { data: quote, error: quoteErr } = await supabase
        .from('quotations')
        .insert({
          store_id: store.id,
          quotation_number: quoteNumber.trim(),
          customer_id: customerId || null,
          issue_date: issueDate,
          valid_until: validUntil,
          subtotal: totalAmount,
          total_amount: totalAmount,
          currency: 'ILS',
          notes: notes.trim() || null,
          terms: terms.trim() || null,
          status: 'sent',
        })
        .select('id')
        .single()

      if (quoteErr) throw quoteErr

      // 2. Insert Items
      const itemPayloads = items.map((item, idx) => ({
        quotation_id: quote.id,
        product_id: item.product_id || null,
        product_name: item.product_name,
        quantity: Number(item.quantity),
        unit_price: Number(item.unit_price),
        total_price: Number(item.quantity) * Number(item.unit_price),
        sort_order: idx + 1,
      }))

      const { error: itemsErr } = await supabase.from('quotation_items').insert(itemPayloads)
      if (itemsErr) throw itemsErr

      router.push('/dashboard/quotations')
      router.refresh()
    } catch (err: any) {
      setError(err.message || 'فشل حفظ عرض السعر')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* ── Back to Sales Hub ── */}
      <div>
        <BackToDashboardButton href="/dashboard/sales" label="العودة إلى لوحة إدارة المبيعات" />
      </div>

      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <span>✍️</span> إنشاء عرض سعر جديد
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            تجهيز عرض سعر للعميل مع تحديد مدة الصلاحية والشروط
          </p>
        </div>

        <Link
          href="/dashboard/quotations"
          className="rounded-xl border border-white/10 bg-slate-800 px-4 py-2 text-xs font-bold text-slate-300 hover:bg-slate-700 transition"
        >
          ← العودة لعروض الأسعار
        </Link>
      </div>

      {error && <div className="rounded-xl bg-rose-500/10 border border-rose-500/20 p-4 text-xs font-bold text-rose-400">⚠️ {error}</div>}

      <form onSubmit={handleSubmit} className="rounded-2xl border border-white/10 bg-slate-900 p-6 shadow-xl space-y-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-300">رقم عرض السعر *</label>
            <input
              type="text"
              required
              value={quoteNumber}
              onChange={e => setQuoteNumber(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-slate-800 p-2.5 text-xs text-white outline-none focus:border-sky-500 font-mono font-bold"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-300">تاريخ الإصدار *</label>
            <input
              type="date"
              required
              value={issueDate}
              onChange={e => setIssueDate(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-slate-800 p-2.5 text-xs text-white outline-none focus:border-sky-500"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-300">ساري حتى تاريخ *</label>
            <input
              type="date"
              required
              value={validUntil}
              onChange={e => setValidUntil(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-slate-800 p-2.5 text-xs text-white outline-none focus:border-sky-500"
            />
          </div>
        </div>

        {/* Customer Selector */}
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-300">العميل المستهدف</label>
          <select
            value={customerId}
            onChange={e => setCustomerId(e.target.value)}
            className="w-full rounded-xl border border-white/10 bg-slate-800 p-2.5 text-xs text-white outline-none focus:border-sky-500 font-semibold"
          >
            {customers.map(c => (
              <option key={c.id} value={c.id}>
                {c.name} {c.phone ? `(${c.phone})` : ''}
              </option>
            ))}
          </select>
        </div>

        {/* Items Table */}
        <div className="space-y-2 border-t border-white/10 pt-4">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold text-white">الأصناف والأسعار المعروضة</label>
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
                    {p.name}
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
                  placeholder="السعر"
                  value={item.unit_price}
                  onChange={e => updateItemRow(idx, 'unit_price', Number(e.target.value))}
                  className="w-full rounded-lg border border-white/10 bg-slate-800 p-2 text-xs text-white outline-none font-mono text-center"
                />
              </div>

              <span className="w-28 text-left font-mono font-bold text-sky-400 text-xs">
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

        {/* Total Box */}
        <div className="rounded-xl border border-white/10 bg-slate-950 p-4 flex justify-between items-center text-xs">
          <span className="font-bold text-slate-300">الإجمالي الكلي لعرض السعر:</span>
          <span className="font-mono font-black text-2xl text-sky-400">
            {totalAmount.toLocaleString('en-GB', { minimumFractionDigits: 2 })} ₪
          </span>
        </div>

        {/* Terms & Notes */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-300">الشروط والأحكام</label>
            <textarea
              rows={2}
              value={terms}
              onChange={e => setTerms(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-slate-800 p-2.5 text-xs text-white outline-none focus:border-sky-500"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-300">ملاحظات إضافية</label>
            <textarea
              rows={2}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-slate-800 p-2.5 text-xs text-white outline-none focus:border-sky-500"
            />
          </div>
        </div>

        {/* Buttons */}
        <div className="flex gap-4 pt-2">
          <Link
            href="/dashboard/quotations"
            className="flex-1 rounded-xl border border-white/10 py-3 text-center text-xs font-bold text-slate-400 hover:bg-slate-800 transition"
          >
            إلغاء
          </Link>
          <button
            type="submit"
            disabled={loading}
            className="flex-1 rounded-xl bg-sky-500 py-3 text-xs font-bold text-slate-950 hover:bg-sky-400 transition disabled:opacity-50 shadow-lg shadow-sky-500/20"
          >
            {loading ? 'جارٍ الحفظ...' : 'حفظ وإصدار عرض السعر'}
          </button>
        </div>
      </form>
    </div>
  )
}
