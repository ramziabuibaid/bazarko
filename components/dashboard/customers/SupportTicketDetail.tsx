'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

interface Ticket {
  id: string
  ticket_number: string
  customer_id: string | null
  customer_name: string | null
  customer_phone: string | null
  subject: string
  category: string
  status: string
  priority: string
  channel: string
  assigned_to: string | null
  created_at: string
  resolved_at: string | null
}
interface Message { id: string; sender: string; body: string; created_at: string }

const STATUS_META: Record<string, { label: string; cls: string }> = {
  open:        { label: 'مفتوحة',       cls: 'bg-sky-500/15 text-sky-400' },
  in_progress: { label: 'قيد المعالجة', cls: 'bg-amber-500/15 text-amber-400' },
  resolved:    { label: 'محلولة',       cls: 'bg-emerald-500/15 text-emerald-400' },
  closed:      { label: 'مغلقة',        cls: 'bg-slate-500/15 text-slate-400' },
}
const CATEGORY_LABELS: Record<string, string> = {
  inquiry: 'استفسار', complaint: 'شكوى', return: 'إرجاع', warranty: 'ضمان', other: 'أخرى',
}
const CHANNEL_LABELS: Record<string, string> = {
  store: 'المتجر', whatsapp: 'واتساب', phone: 'هاتف', email: 'بريد', other: 'أخرى',
}
const STATUS_ORDER = ['open', 'in_progress', 'resolved', 'closed']

export default function SupportTicketDetail({
  ticket, messages, userId,
}: {
  ticket: Ticket
  messages: Message[]
  userId: string
}) {
  const router = useRouter()
  const supabase = createClient()
  const [status, setStatus] = useState(ticket.status)
  const [busy, setBusy] = useState(false)
  const [reply, setReply] = useState('')
  const [sender, setSender] = useState<'staff' | 'customer'>('staff')
  const [sending, setSending] = useState(false)

  const sm = STATUS_META[status] ?? { label: status, cls: 'bg-white/5 text-white' }

  async function changeStatus(next: string) {
    if (next === status) return
    setBusy(true)
    const updates: Record<string, string | null> = { status: next, updated_at: new Date().toISOString() }
    if (next === 'resolved' || next === 'closed') updates.resolved_at = new Date().toISOString()
    await supabase.from('support_tickets').update(updates).eq('id', ticket.id)
    setStatus(next)
    setBusy(false)
    router.refresh()
  }

  async function sendReply(e: React.FormEvent) {
    e.preventDefault()
    if (!reply.trim()) return
    setSending(true)
    await supabase.from('support_ticket_messages').insert({
      ticket_id: ticket.id, sender, body: reply.trim(), created_by: userId,
    })
    // أول رد من الموظف ينقلها لقيد المعالجة تلقائياً
    if (sender === 'staff' && status === 'open') {
      await supabase.from('support_tickets').update({ status: 'in_progress', updated_at: new Date().toISOString() }).eq('id', ticket.id)
      setStatus('in_progress')
    }
    setReply('')
    setSending(false)
    router.refresh()
  }

  const waUrl = ticket.customer_phone
    ? `https://wa.me/${ticket.customer_phone.replace(/[^\d]/g, '')}`
    : null

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
      {/* المحادثة */}
      <div className="space-y-4 lg:col-span-2">
        <div className="rounded-2xl border border-white/5 bg-slate-900 p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-white">
                {ticket.priority === 'urgent' && <span className="ml-1 text-red-400">🔴</span>}
                {ticket.subject}
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                {CATEGORY_LABELS[ticket.category]} · {CHANNEL_LABELS[ticket.channel]} · {new Date(ticket.created_at).toLocaleString('ar')}
              </p>
            </div>
            <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${sm.cls}`}>{sm.label}</span>
          </div>
        </div>

        {/* الرسائل */}
        <div className="space-y-3">
          {messages.length === 0 ? (
            <p className="rounded-2xl border border-white/5 bg-slate-900 p-6 text-center text-sm text-slate-500">لا رسائل بعد — ابدأ المحادثة</p>
          ) : messages.map(m => (
            <div key={m.id} className={`flex ${m.sender === 'staff' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 ${
                m.sender === 'staff' ? 'bg-sky-500/15 text-sky-100' : 'bg-white/5 text-slate-200'
              }`}>
                <p className="text-[10px] font-semibold text-slate-400">{m.sender === 'staff' ? 'الموظف' : 'الزبون'}</p>
                <p className="mt-0.5 whitespace-pre-wrap text-sm">{m.body}</p>
                <p className="mt-1 text-[10px] text-slate-500" dir="ltr">{new Date(m.created_at).toLocaleString('ar')}</p>
              </div>
            </div>
          ))}
        </div>

        {/* صندوق الرد */}
        {status !== 'closed' && (
          <form onSubmit={sendReply} className="rounded-2xl border border-white/5 bg-slate-900 p-4">
            <div className="mb-2 flex gap-1 text-xs">
              <button type="button" onClick={() => setSender('staff')}
                className={`rounded-lg px-3 py-1.5 ${sender === 'staff' ? 'bg-sky-500/20 text-sky-400' : 'text-slate-400 hover:text-white'}`}>رد الموظف</button>
              <button type="button" onClick={() => setSender('customer')}
                className={`rounded-lg px-3 py-1.5 ${sender === 'customer' ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-white'}`}>رسالة الزبون</button>
            </div>
            <textarea value={reply} onChange={e => setReply(e.target.value)} rows={3}
              placeholder="اكتب الرد..." className="w-full rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-white" />
            <div className="mt-2 flex justify-end">
              <button type="submit" disabled={sending}
                className="rounded-xl bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50">
                {sending ? '...' : 'إرسال'}
              </button>
            </div>
          </form>
        )}
      </div>

      {/* الشريط الجانبي */}
      <div className="space-y-4">
        <div className="rounded-2xl border border-white/5 bg-slate-900 p-5">
          <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-slate-500">الزبون</p>
          <p className="font-medium text-white">{ticket.customer_name ?? '—'}</p>
          {ticket.customer_phone && <p className="mt-0.5 text-sm text-slate-400" dir="ltr">{ticket.customer_phone}</p>}
          <div className="mt-3 flex gap-2">
            {ticket.customer_id && (
              <Link href={`/dashboard/customers/${ticket.customer_id}`}
                className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/5">ملف الزبون</Link>
            )}
            {waUrl && (
              <a href={waUrl} target="_blank" rel="noopener noreferrer"
                className="rounded-lg border border-emerald-500/20 px-3 py-1.5 text-xs text-emerald-400 hover:bg-emerald-500/10">واتساب</a>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-white/5 bg-slate-900 p-5">
          <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-slate-500">تغيير الحالة</p>
          <div className="grid grid-cols-2 gap-2">
            {STATUS_ORDER.map(s => (
              <button key={s} onClick={() => changeStatus(s)} disabled={busy || s === status}
                className={`rounded-lg px-3 py-2 text-xs font-medium transition-colors disabled:opacity-100 ${
                  s === status ? `${STATUS_META[s].cls} ring-1 ring-white/20` : 'bg-white/5 text-slate-300 hover:bg-white/10'
                }`}>
                {STATUS_META[s].label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
