'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

interface Customer {
  id: string
  name: string
  phone: string | null
}

interface Voucher {
  id: string
  voucher_number: string
  type: string
  date: string
  amount: number
  party_name: string | null
  customer_id: string | null
  payment_method: string
  category: string | null
  description: string
  reference: string | null
}

interface Props {
  vouchers: Voucher[]
  type: 'receipt' | 'payment'
  storeId: string
  userId: string
  currencyCode: string
  customers: Customer[]
}

const PAYMENT_METHODS = [
  { value: 'cash',     label: 'نقداً' },
  { value: 'bank',     label: 'تحويل بنكي' },
  { value: 'card',     label: 'بطاقة' },
  { value: 'transfer', label: 'تحويل إلكتروني' },
]

const RECEIPT_CATEGORIES  = ['مبيعات', 'دفعة زبون', 'استرداد', 'إيرادات أخرى']
const PAYMENT_CATEGORIES  = ['مشتريات', 'إيجار', 'رواتب', 'مصاريف تشغيل', 'فواتير', 'توصيل', 'تسويق', 'أخرى']

export default function VouchersTable({ vouchers, type, storeId, userId, currencyCode, customers }: Props) {
  const router = useRouter()
  const supabase = createClient()

  const [showModal, setShowModal] = useState(false)
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [amount, setAmount] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [category, setCategory] = useState('')
  const [description, setDescription] = useState('')
  const [reference, setReference] = useState('')
  const [selectedCustomer, setSelectedCustomer] = useState('')
  const [partyName, setPartyName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const categories = type === 'receipt' ? RECEIPT_CATEGORIES : PAYMENT_CATEGORIES
  const fmt = (n: number) => n.toLocaleString('ar-SA', { maximumFractionDigits: 2 })

  const totalAmount = vouchers.reduce((s, v) => s + v.amount, 0)

  function resetForm() {
    setDate(new Date().toISOString().slice(0, 10))
    setAmount(''); setPaymentMethod('cash'); setCategory('')
    setDescription(''); setReference(''); setSelectedCustomer(''); setPartyName('')
    setError('')
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const amt = parseFloat(amount)
    if (!amt || amt <= 0) { setError('أدخل مبلغاً صحيحاً'); return }
    if (!description.trim()) { setError('أدخل وصفاً للسند'); return }

    setSaving(true)
    setError('')

    const { count } = await supabase
      .from('vouchers')
      .select('*', { count: 'exact', head: true })
      .eq('store_id', storeId)
      .eq('type', type)

    const prefix = type === 'receipt' ? 'RCP' : 'PMT'
    const voucherNumber = `${prefix}-${String((count ?? 0) + 1).padStart(4, '0')}`

    const customer = customers.find(c => c.id === selectedCustomer)

    const { error: err } = await supabase.from('vouchers').insert({
      store_id: storeId,
      voucher_number: voucherNumber,
      type,
      date,
      amount: amt,
      customer_id: selectedCustomer || null,
      party_name: (customer?.name ?? partyName.trim()) || null,
      payment_method: paymentMethod,
      category: category || null,
      description: description.trim(),
      reference: reference.trim() || null,
      created_by: userId,
    })

    setSaving(false)
    if (err) { setError('حدث خطأ أثناء الحفظ'); return }

    setShowModal(false)
    resetForm()
    router.refresh()
  }

  const isReceipt = type === 'receipt'
  const accentColor = isReceipt ? 'sky' : 'red'
  const icon = isReceipt ? '💵' : '💸'

  return (
    <div className="space-y-5">
      {/* رأس */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-slate-400">{icon} إجمالي {isReceipt ? 'المقبوضات' : 'المدفوعات'}</p>
          <p className={`text-2xl font-bold ${isReceipt ? 'text-sky-400' : 'text-red-400'}`} dir="ltr">
            {fmt(totalAmount)} {currencyCode}
          </p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className={`rounded-xl px-4 py-2 text-sm font-medium text-white ${isReceipt ? 'bg-sky-600 hover:bg-sky-500' : 'bg-red-700 hover:bg-red-600'}`}
        >
          ➕ سند {isReceipt ? 'قبض' : 'صرف'} جديد
        </button>
      </div>

      {/* الجدول */}
      {vouchers.length === 0 ? (
        <div className="rounded-2xl border border-white/5 bg-white/3 py-16 text-center">
          <p className="text-4xl">{icon}</p>
          <p className="mt-3 text-slate-400">لا توجد سندات مسجّلة</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-white/5">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5 bg-white/3">
                <th className="px-4 py-3 text-right text-xs font-medium text-slate-400">رقم السند</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-slate-400">التاريخ</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-slate-400">الطرف</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-slate-400">الوصف</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-slate-400">التصنيف</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-slate-400">طريقة الدفع</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">المبلغ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {vouchers.map((v: Voucher) => (
                <tr key={v.id} className="hover:bg-white/3 transition-colors">
                  <td className="px-4 py-3 font-mono text-xs text-slate-400" dir="ltr">{v.voucher_number}</td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    {new Date(v.date).toLocaleDateString('ar', { year: 'numeric', month: 'short', day: 'numeric' })}
                  </td>
                  <td className="px-4 py-3 text-sm text-white">{v.party_name ?? '—'}</td>
                  <td className="px-4 py-3 text-sm text-slate-300 max-w-[200px] truncate">{v.description}</td>
                  <td className="px-4 py-3">
                    {v.category && (
                      <span className="rounded-full bg-white/5 px-2 py-0.5 text-xs text-slate-400">{v.category}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className="text-xs text-slate-400">
                      {PAYMENT_METHODS.find(m => m.value === v.payment_method)?.label ?? v.payment_method}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-left">
                    <span className={`font-semibold ${isReceipt ? 'text-emerald-400' : 'text-red-400'}`} dir="ltr">
                      {isReceipt ? '+' : '−'}{fmt(v.amount)} {currencyCode}
                    </span>
                    {v.reference && <p className="text-xs text-slate-600" dir="ltr">{v.reference}</p>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal إضافة سند */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => { setShowModal(false); resetForm() }}>
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-slate-900 p-6" onClick={e => e.stopPropagation()}>
            <h2 className="mb-5 text-lg font-semibold text-white">
              {icon} سند {isReceipt ? 'قبض' : 'صرف'} جديد
            </h2>

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* التاريخ والمبلغ */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs text-slate-400">التاريخ *</label>
                  <input type="date" value={date} onChange={e => setDate(e.target.value)} required
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white outline-none focus:border-sky-500/50" />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-400">المبلغ *</label>
                  <input type="number" min="0.01" step="0.01"
                    value={amount} onChange={e => setAmount(e.target.value)}
                    placeholder="0.00" dir="ltr" required
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white outline-none focus:border-sky-500/50" />
                </div>
              </div>

              {/* الطرف */}
              {isReceipt ? (
                <div>
                  <label className="mb-1 block text-xs text-slate-400">الزبون (اختياري)</label>
                  <select value={selectedCustomer} onChange={e => setSelectedCustomer(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white outline-none focus:border-sky-500/50">
                    <option value="">اختر زبوناً أو اكتب يدوياً...</option>
                    {customers.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                  {!selectedCustomer && (
                    <input value={partyName} onChange={e => setPartyName(e.target.value)}
                      placeholder="أو اكتب اسم الجهة..."
                      className="mt-2 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-sky-500/50" />
                  )}
                </div>
              ) : (
                <div>
                  <label className="mb-1 block text-xs text-slate-400">الجهة المدفوع لها</label>
                  <input value={partyName} onChange={e => setPartyName(e.target.value)}
                    placeholder="مورد، موظف، جهة..."
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-sky-500/50" />
                </div>
              )}

              {/* الوصف */}
              <div>
                <label className="mb-1 block text-xs text-slate-400">الوصف / السبب *</label>
                <input value={description} onChange={e => setDescription(e.target.value)}
                  placeholder={isReceipt ? 'دفعة فاتورة رقم 42...' : 'إيجار الشهر، رواتب...'}
                  required
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-sky-500/50" />
              </div>

              {/* التصنيف وطريقة الدفع */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs text-slate-400">التصنيف</label>
                  <select value={category} onChange={e => setCategory(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white outline-none focus:border-sky-500/50">
                    <option value="">بدون تصنيف</option>
                    {categories.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-400">طريقة الدفع</label>
                  <select value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white outline-none focus:border-sky-500/50">
                    {PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                </div>
              </div>

              {/* مرجع */}
              <div>
                <label className="mb-1 block text-xs text-slate-400">رقم مرجعي (اختياري)</label>
                <input value={reference} onChange={e => setReference(e.target.value)}
                  placeholder="رقم الفاتورة، رقم الطلبية..." dir="ltr"
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-sky-500/50" />
              </div>

              {error && <p className="text-sm text-red-400">{error}</p>}

              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => { setShowModal(false); resetForm() }}
                  className="flex-1 rounded-xl border border-white/10 py-2.5 text-sm text-slate-400 hover:text-white">
                  إلغاء
                </button>
                <button type="submit" disabled={saving}
                  className={`flex-1 rounded-xl py-2.5 text-sm font-semibold text-white disabled:opacity-50 ${isReceipt ? 'bg-sky-600 hover:bg-sky-500' : 'bg-red-700 hover:bg-red-600'}`}>
                  {saving ? 'جاري الحفظ...' : 'حفظ السند'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
