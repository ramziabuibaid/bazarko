'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { recordAuditEvent } from '@/app/dashboard/accounting/audit-actions'

const CATEGORIES = [
  'إيجار', 'رواتب', 'كهرباء وماء', 'إنترنت واتصالات', 'صيانة',
  'نقل وشحن', 'تسويق وإعلان', 'مستلزمات', 'ضرائب ورسوم', 'أخرى',
]

export default function ExpenseQuickAdd({
  storeId, userId, currencyCode,
}: {
  storeId: string
  userId: string
  currencyCode: string
}) {
  const router = useRouter()
  const supabase = createClient()
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [amount, setAmount] = useState('')
  const [category, setCategory] = useState(CATEGORIES[0])
  const [description, setDescription] = useState('')
  const [party, setParty] = useState('')
  const [method, setMethod] = useState<'cash' | 'bank' | 'card' | 'transfer'>('cash')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))

  function reset() {
    setAmount(''); setCategory(CATEGORIES[0]); setDescription(''); setParty('')
    setMethod('cash'); setDate(new Date().toISOString().slice(0, 10)); setError('')
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const amt = parseFloat(amount)
    if (!amt || amt <= 0) { setError('أدخل مبلغاً صحيحاً'); return }
    if (!description.trim()) { setError('أدخل بياناً للمصروف'); return }

    setSaving(true); setError('')

    const { count } = await supabase
      .from('vouchers')
      .select('*', { count: 'exact', head: true })
      .eq('store_id', storeId)
      .eq('type', 'payment')
    const voucherNumber = `PMT-${String((count ?? 0) + 1).padStart(4, '0')}`

    const { error: err } = await supabase.from('vouchers').insert({
      store_id:       storeId,
      voucher_number: voucherNumber,
      type:           'payment',
      date,
      amount:         amt,
      party_name:     party.trim() || null,
      payment_method: method,
      category,
      description:    description.trim(),
      created_by:     userId,
    })

    if (err) { setSaving(false); setError('حدث خطأ أثناء الحفظ'); return }

    await recordAuditEvent({
      entityType: 'voucher', entityLabel: voucherNumber, action: 'create',
      details: { type: 'payment', amount: amt, category, method },
    })

    setSaving(false)
    setOpen(false)
    reset()
    router.refresh()
  }

  return (
    <>
      <button onClick={() => { reset(); setOpen(true) }}
        className="rounded-xl bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500">
        ➕ مصروف جديد
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setOpen(false)}>
          <form onSubmit={submit} onClick={e => e.stopPropagation()}
            className="w-full max-w-md space-y-3 rounded-2xl border border-white/10 bg-slate-900 p-5">
            <h3 className="text-lg font-semibold text-white">💸 تسجيل مصروف</h3>
            <p className="text-xs text-slate-500">سيُنشأ سند صرف ويخرج المبلغ من الصندوق تلقائياً</p>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs text-slate-400">المبلغ ({currencyCode})</label>
                <input type="number" step="any" value={amount} onChange={e => setAmount(e.target.value)} dir="ltr" autoFocus
                  className="w-full rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-white" />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-400">التاريخ</label>
                <input type="date" value={date} onChange={e => setDate(e.target.value)} dir="ltr"
                  className="w-full rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-white" />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs text-slate-400">التصنيف</label>
              <select value={category} onChange={e => setCategory(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-white">
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs text-slate-400">البيان</label>
              <input value={description} onChange={e => setDescription(e.target.value)}
                placeholder="مثلاً: فاتورة كهرباء شهر يونيو"
                className="w-full rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-white" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs text-slate-400">المستفيد (اختياري)</label>
                <input value={party} onChange={e => setParty(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-white" />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-400">طريقة الدفع</label>
                <select value={method} onChange={e => setMethod(e.target.value as typeof method)}
                  className="w-full rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-white">
                  <option value="cash">نقدي</option>
                  <option value="bank">بنك</option>
                  <option value="card">بطاقة</option>
                  <option value="transfer">تحويل</option>
                </select>
              </div>
            </div>

            {error && <p className="text-sm text-red-400">{error}</p>}

            <div className="flex gap-2 pt-1">
              <button type="submit" disabled={saving}
                className="flex-1 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50">
                {saving ? '...' : 'حفظ المصروف'}
              </button>
              <button type="button" onClick={() => setOpen(false)}
                className="rounded-xl border border-white/10 px-4 py-2.5 text-sm text-slate-400 hover:text-white">إلغاء</button>
            </div>
          </form>
        </div>
      )}
    </>
  )
}
