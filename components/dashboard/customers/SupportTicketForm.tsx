'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

interface Customer { id: string; name: string; phone: string | null }

const CATEGORIES = [
  { key: 'inquiry',   label: 'استفسار' },
  { key: 'complaint', label: 'شكوى' },
  { key: 'return',    label: 'إرجاع' },
  { key: 'warranty',  label: 'ضمان' },
  { key: 'other',     label: 'أخرى' },
]
const CHANNELS = [
  { key: 'store',    label: 'المتجر' },
  { key: 'whatsapp', label: 'واتساب' },
  { key: 'phone',    label: 'هاتف' },
  { key: 'email',    label: 'بريد' },
  { key: 'other',    label: 'أخرى' },
]

export default function SupportTicketForm({
  storeId, userId, customers,
}: {
  storeId: string
  userId: string
  customers: Customer[]
}) {
  const router = useRouter()
  const supabase = createClient()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [customerId, setCustomerId] = useState('')
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [subject, setSubject] = useState('')
  const [category, setCategory] = useState('inquiry')
  const [channel, setChannel] = useState('store')
  const [priority, setPriority] = useState<'normal' | 'urgent'>('normal')
  const [message, setMessage] = useState('')

  function pickCustomer(id: string) {
    setCustomerId(id)
    const c = customers.find(x => x.id === id)
    if (c) { setCustomerName(c.name); setCustomerPhone(c.phone ?? '') }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!subject.trim()) { setError('أدخل موضوع التذكرة'); return }
    setSaving(true); setError('')

    const { count } = await supabase
      .from('support_tickets')
      .select('*', { count: 'exact', head: true })
      .eq('store_id', storeId)
    const ticketNumber = `SUP-${String((count ?? 0) + 1).padStart(4, '0')}`

    const { data: ticket, error: err } = await supabase
      .from('support_tickets')
      .insert({
        store_id:       storeId,
        ticket_number:  ticketNumber,
        customer_id:    customerId || null,
        customer_name:  customerName.trim() || null,
        customer_phone: customerPhone.trim() || null,
        subject:        subject.trim(),
        category,
        channel,
        priority,
        status:         'open',
        created_by:     userId,
      })
      .select('id')
      .single()

    if (err || !ticket) { setSaving(false); setError('حدث خطأ أثناء الحفظ'); return }

    if (message.trim()) {
      await supabase.from('support_ticket_messages').insert({
        ticket_id: ticket.id, sender: 'customer', body: message.trim(), created_by: userId,
      })
    }

    router.push(`/dashboard/customers/support/${ticket.id}`)
  }

  return (
    <form onSubmit={submit} className="max-w-2xl space-y-4 rounded-2xl border border-white/5 bg-slate-900 p-5">
      {/* الزبون */}
      <div>
        <label className="mb-1 block text-xs text-slate-400">الزبون (اختياري — اختر من القائمة أو أدخل يدوياً)</label>
        <select value={customerId} onChange={e => pickCustomer(e.target.value)}
          className="mb-2 w-full rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-white">
          <option value="">— بدون ربط / إدخال يدوي —</option>
          {customers.map(c => <option key={c.id} value={c.id}>{c.name}{c.phone ? ` · ${c.phone}` : ''}</option>)}
        </select>
        <div className="grid grid-cols-2 gap-3">
          <input value={customerName} onChange={e => setCustomerName(e.target.value)} placeholder="اسم الزبون"
            className="w-full rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-white" />
          <input value={customerPhone} onChange={e => setCustomerPhone(e.target.value)} placeholder="الهاتف" dir="ltr"
            className="w-full rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-white" />
        </div>
      </div>

      <div>
        <label className="mb-1 block text-xs text-slate-400">الموضوع</label>
        <input value={subject} onChange={e => setSubject(e.target.value)} placeholder="مثلاً: المنتج وصل تالفاً"
          list="subject-suggestions"
          className="w-full rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-white" autoFocus />
        <datalist id="subject-suggestions">
          <option value="تأخر الطلب" />
          <option value="مشكلة بالدفع" />
          <option value="تعديل العنوان" />
          <option value="منتج تالف" />
          <option value="منتج ناقص" />
        </datalist>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div>
          <label className="mb-1 block text-xs text-slate-400">التصنيف</label>
          <select value={category} onChange={e => setCategory(e.target.value)}
            className="w-full rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-white">
            {CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-400">القناة</label>
          <select value={channel} onChange={e => setChannel(e.target.value)}
            className="w-full rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-white">
            {CHANNELS.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-400">الأولوية</label>
          <select value={priority} onChange={e => setPriority(e.target.value as 'normal' | 'urgent')}
            className="w-full rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-white">
            <option value="normal">عادية</option>
            <option value="urgent">عاجلة</option>
          </select>
        </div>
      </div>

      <div>
        <label className="mb-1 block text-xs text-slate-400">تفاصيل الطلب / رسالة الزبون (اختياري)</label>
        <textarea value={message} onChange={e => setMessage(e.target.value)} rows={4}
          className="w-full rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-white" />
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="flex gap-2">
        <button type="submit" disabled={saving}
          className="rounded-xl bg-sky-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50">
          {saving ? '...' : 'إنشاء التذكرة'}
        </button>
      </div>
    </form>
  )
}
