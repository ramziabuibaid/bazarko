'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import { emailInvoice } from '@/app/dashboard/accounting/invoices/invoice-actions'

interface InvoiceItem {
  id: string
  name: string
  sku: string | null
  quantity: number
  unit_price: number
  total: number
}

interface Invoice {
  id: string
  invoice_number: string
  customer_name: string | null
  customer_phone: string | null
  customer_address: string | null
  customer_id: string | null
  issue_date: string
  due_date: string | null
  status: string
  subtotal: number
  discount_amount: number
  total: number
  amount_paid: number
  notes: string | null
  created_at: string
}

interface Props {
  invoice: Invoice
  items: InvoiceItem[]
  storeName: string
  storePhone: string | null
  currencyCode: string
  linkedOrder: { id: string; order_number: string } | null
  storeId: string
  userId: string
}

const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  draft:     { label: 'مسودة',  cls: 'bg-slate-500/15 text-slate-300' },
  sent:      { label: 'مُرسلة', cls: 'bg-blue-500/15 text-blue-300' },
  paid:      { label: 'مدفوعة', cls: 'bg-emerald-500/15 text-emerald-300' },
  cancelled: { label: 'ملغاة',  cls: 'bg-red-500/15 text-red-300' },
}

const STATUS_FLOW: Record<string, string | null> = {
  draft:     'sent',
  sent:      'paid',
  paid:      null,
  cancelled: null,
}

const STATUS_NEXT_LABEL: Record<string, string> = {
  draft: 'تحديد كـ مُرسلة',
  sent:  'تحديد كـ مدفوعة',
}

export default function InvoiceView({ invoice, items, storeName, storePhone, currencyCode, linkedOrder, storeId, userId }: Props) {
  const router = useRouter()
  const supabase = createClient()
  const [status, setStatus] = useState(invoice.status)
  const [advancing, setAdvancing] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [showEmailForm, setShowEmailForm] = useState(false)
  const [emailTo, setEmailTo] = useState('')
  const [sending, setSending] = useState(false)
  const [emailResult, setEmailResult] = useState<'sent' | 'error' | null>(null)

  const fmt = (n: number) => n.toLocaleString('ar-SA', { maximumFractionDigits: 2 })
  const remaining = Math.max(0, invoice.total - invoice.amount_paid)
  const sl = STATUS_LABELS[status] ?? { label: status, cls: 'bg-white/5 text-white' }
  const nextStatus = STATUS_FLOW[status]

  async function advanceStatus() {
    if (!nextStatus) return
    setAdvancing(true)
    const updates: Record<string, string | number> = { status: nextStatus, updated_at: new Date().toISOString() }
    if (nextStatus === 'paid') updates.amount_paid = invoice.total
    await supabase.from('invoices').update(updates).eq('id', invoice.id)

    // تسجيل الدفعة في كشف حساب الزبون عند الإغلاق كـ "مدفوعة"
    if (nextStatus === 'paid' && invoice.customer_id && remaining > 0) {
      const { data: custData } = await supabase
        .from('customers')
        .select('balance, total_paid')
        .eq('id', invoice.customer_id)
        .single()

      const currentBalance = custData?.balance ?? 0
      const newBalance     = currentBalance - remaining

      await supabase.from('customer_ledger').insert({
        store_id:       storeId,
        customer_id:    invoice.customer_id,
        type:           'payment',
        date:           new Date().toISOString().slice(0, 10),
        description:    `دفعة على فاتورة ${invoice.invoice_number}`,
        debit:          0,
        credit:         remaining,
        balance:        newBalance,
        reference_id:   invoice.id,
        reference_type: 'invoice',
        created_by:     userId,
      })

      await supabase.from('customers').update({
        balance:    newBalance,
        total_paid: (custData?.total_paid ?? 0) + remaining,
      }).eq('id', invoice.customer_id)
    }

    setStatus(nextStatus)
    setAdvancing(false)
    router.refresh()
  }

  async function cancelInvoice() {
    if (!confirm('هل تريد إلغاء هذه الفاتورة؟')) return
    setCancelling(true)
    await supabase.from('invoices').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('id', invoice.id)

    // عكس تأثير الفاتورة على كشف حساب الزبون
    if (invoice.customer_id) {
      const { data: ledgerEntries } = await supabase
        .from('customer_ledger')
        .select('debit, credit')
        .eq('reference_id', invoice.id)
        .eq('reference_type', 'invoice')

      const netDebit = (ledgerEntries ?? []).reduce(
        (s: number, e: { debit: number; credit: number }) => s + e.debit - e.credit,
        0
      )

      if (netDebit > 0) {
        const { data: custData } = await supabase
          .from('customers')
          .select('balance, total_invoiced')
          .eq('id', invoice.customer_id)
          .single()

        const newBalance = (custData?.balance ?? 0) - netDebit

        await supabase.from('customer_ledger').insert({
          store_id:       storeId,
          customer_id:    invoice.customer_id,
          type:           'credit_note',
          date:           new Date().toISOString().slice(0, 10),
          description:    `إلغاء فاتورة ${invoice.invoice_number}`,
          debit:          0,
          credit:         netDebit,
          balance:        newBalance,
          reference_id:   invoice.id,
          reference_type: 'invoice',
          created_by:     userId,
        })

        await supabase.from('customers').update({
          balance:        newBalance,
          total_invoiced: Math.max(0, (custData?.total_invoiced ?? 0) - invoice.total),
        }).eq('id', invoice.customer_id)
      }
    }

    setStatus('cancelled')
    setCancelling(false)
    router.refresh()
  }

  async function handleSendEmail(e: React.FormEvent) {
    e.preventDefault()
    setSending(true)
    setEmailResult(null)
    const result = await emailInvoice(invoice.id, emailTo)
    setSending(false)
    setEmailResult(result.ok ? 'sent' : 'error')
    if (result.ok) {
      setTimeout(() => { setShowEmailForm(false); setEmailResult(null) }, 2500)
    }
  }

  return (
    <>
      {/* أدوات الصفحة — تختفي عند الطباعة */}
      <div className="mb-6 flex flex-wrap items-center gap-3 print:hidden">
        <Link href="/dashboard/accounting/invoices"
          className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-slate-400 hover:text-white">
          ← الفواتير
        </Link>
        <span className={`rounded-full px-3 py-1 text-xs font-medium ${sl.cls}`}>{sl.label}</span>
        {linkedOrder && (
          <Link
            href={`/dashboard/orders/${linkedOrder.id}`}
            className="flex items-center gap-1.5 rounded-full border border-sky-500/20 bg-sky-500/5 px-3 py-1 text-xs text-sky-400 hover:bg-sky-500/10"
          >
            🔗 <span dir="ltr">{linkedOrder.order_number}</span>
          </Link>
        )}
        <div className="flex-1" />
        {nextStatus && (
          <button onClick={advanceStatus} disabled={advancing}
            className="rounded-xl bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50">
            {advancing ? '...' : STATUS_NEXT_LABEL[status]}
          </button>
        )}
        {status !== 'cancelled' && status !== 'paid' && (
          <button onClick={cancelInvoice} disabled={cancelling}
            className="rounded-xl border border-red-500/20 px-4 py-2 text-sm text-red-400 hover:bg-red-500/10">
            إلغاء
          </button>
        )}
        <button onClick={() => setShowEmailForm(v => !v)}
          className="rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/5">
          📧 إرسال بالإيميل
        </button>
        <button onClick={() => window.print()}
          className="rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/5">
          🖨️ طباعة
        </button>
      </div>

      {/* فورم الإيميل */}
      {showEmailForm && (
        <form onSubmit={handleSendEmail}
          className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-sky-500/20 bg-sky-500/5 px-4 py-3 print:hidden">
          <span className="text-sm text-sky-300">📧 إرسال إلى:</span>
          <input
            type="email"
            required
            value={emailTo}
            onChange={e => setEmailTo(e.target.value)}
            placeholder="example@email.com"
            dir="ltr"
            className="flex-1 min-w-48 rounded-lg border border-white/10 bg-slate-800 px-3 py-1.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-sky-500/50"
          />
          <button type="submit" disabled={sending}
            className="rounded-lg bg-sky-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50">
            {sending ? 'جارٍ الإرسال...' : 'إرسال'}
          </button>
          <button type="button" onClick={() => setShowEmailForm(false)}
            className="text-xs text-slate-500 hover:text-white">
            إلغاء
          </button>
          {emailResult === 'sent'  && <span className="text-xs text-emerald-400">✓ تم الإرسال بنجاح</span>}
          {emailResult === 'error' && <span className="text-xs text-red-400">فشل الإرسال، حاول مرة أخرى</span>}
        </form>
      )}

      {/* الفاتورة — تُطبع */}
      <div id="invoice-print" className="rounded-2xl border border-white/5 bg-slate-900 p-8 print:bg-white print:text-black print:border-0 print:p-6 print:rounded-none">
        {/* رأس الفاتورة */}
        <div className="mb-8 flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-bold text-white print:text-black">فاتورة</h1>
            <p className="mt-1 font-mono text-sky-400 print:text-sky-700" dir="ltr">{invoice.invoice_number}</p>
          </div>
          <div className="text-left">
            <p className="text-lg font-semibold text-white print:text-black">{storeName}</p>
            {storePhone && <p className="text-sm text-slate-400 print:text-gray-500" dir="ltr">{storePhone}</p>}
          </div>
        </div>

        {/* معلومات الزبون والتواريخ */}
        <div className="mb-8 grid grid-cols-2 gap-8">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-500 print:text-gray-400">إلى</p>
            <p className="text-base font-semibold text-white print:text-black">{invoice.customer_name ?? '—'}</p>
            {invoice.customer_phone && <p className="text-sm text-slate-400 print:text-gray-500" dir="ltr">{invoice.customer_phone}</p>}
            {invoice.customer_address && <p className="text-sm text-slate-400 print:text-gray-500">{invoice.customer_address}</p>}
          </div>
          <div className="text-left">
            <div className="space-y-1 text-sm">
              <div className="flex justify-between gap-8">
                <span className="text-slate-400 print:text-gray-500">تاريخ الإصدار</span>
                <span className="text-white print:text-black">{new Date(invoice.issue_date).toLocaleDateString('ar', { year: 'numeric', month: 'long', day: 'numeric' })}</span>
              </div>
              {invoice.due_date && (
                <div className="flex justify-between gap-8">
                  <span className="text-slate-400 print:text-gray-500">تاريخ الاستحقاق</span>
                  <span className="text-white print:text-black">{new Date(invoice.due_date).toLocaleDateString('ar', { year: 'numeric', month: 'long', day: 'numeric' })}</span>
                </div>
              )}
              <div className="flex justify-between gap-8">
                <span className="text-slate-400 print:text-gray-500">الحالة</span>
                <span className={`font-medium ${status === 'paid' ? 'text-emerald-400 print:text-emerald-700' : 'text-yellow-400 print:text-yellow-700'}`}>
                  {sl.label}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* جدول البنود */}
        <table className="w-full mb-6 text-sm">
          <thead>
            <tr className="border-b-2 border-white/10 print:border-gray-300">
              <th className="pb-2 text-right text-xs font-semibold uppercase tracking-widest text-slate-400 print:text-gray-500">#</th>
              <th className="pb-2 text-right text-xs font-semibold uppercase tracking-widest text-slate-400 print:text-gray-500">الوصف</th>
              <th className="pb-2 text-center text-xs font-semibold uppercase tracking-widest text-slate-400 print:text-gray-500">الكمية</th>
              <th className="pb-2 text-left text-xs font-semibold uppercase tracking-widest text-slate-400 print:text-gray-500">السعر</th>
              <th className="pb-2 text-left text-xs font-semibold uppercase tracking-widest text-slate-400 print:text-gray-500">الإجمالي</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5 print:divide-gray-200">
            {items.map((item, i) => (
              <tr key={item.id}>
                <td className="py-3 text-slate-500 print:text-gray-400 text-xs">{i + 1}</td>
                <td className="py-3">
                  <p className="font-medium text-white print:text-black">{item.name}</p>
                  {item.sku && <p className="text-xs text-slate-500 print:text-gray-400" dir="ltr">{item.sku}</p>}
                </td>
                <td className="py-3 text-center text-slate-300 print:text-gray-600" dir="ltr">{item.quantity}</td>
                <td className="py-3 text-left text-slate-300 print:text-gray-600" dir="ltr">{fmt(item.unit_price)} {currencyCode}</td>
                <td className="py-3 text-left font-medium text-white print:text-black" dir="ltr">{fmt(item.total)} {currencyCode}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* الإجماليات */}
        <div className="flex justify-end">
          <div className="w-64 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-400 print:text-gray-500">المجموع الفرعي</span>
              <span className="text-white print:text-black" dir="ltr">{fmt(invoice.subtotal)} {currencyCode}</span>
            </div>
            {invoice.discount_amount > 0 && (
              <div className="flex justify-between">
                <span className="text-slate-400 print:text-gray-500">خصم</span>
                <span className="text-red-400 print:text-red-600" dir="ltr">- {fmt(invoice.discount_amount)} {currencyCode}</span>
              </div>
            )}
            <div className="flex justify-between border-t border-white/10 pt-2 text-base font-bold print:border-gray-300">
              <span className="text-white print:text-black">الإجمالي</span>
              <span className="text-white print:text-black" dir="ltr">{fmt(invoice.total)} {currencyCode}</span>
            </div>
            {invoice.amount_paid > 0 && (
              <>
                <div className="flex justify-between">
                  <span className="text-slate-400 print:text-gray-500">مدفوع</span>
                  <span className="text-emerald-400 print:text-emerald-700" dir="ltr">{fmt(invoice.amount_paid)} {currencyCode}</span>
                </div>
                {remaining > 0 && (
                  <div className="flex justify-between font-semibold">
                    <span className="text-yellow-400 print:text-yellow-700">المتبقي</span>
                    <span className="text-yellow-400 print:text-yellow-700" dir="ltr">{fmt(remaining)} {currencyCode}</span>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* ملاحظات */}
        {invoice.notes && (
          <div className="mt-8 rounded-xl border border-white/5 bg-white/3 p-4 print:border-gray-200 print:bg-gray-50">
            <p className="text-xs font-semibold text-slate-400 print:text-gray-500 mb-1">ملاحظات</p>
            <p className="text-sm text-slate-300 print:text-gray-600">{invoice.notes}</p>
          </div>
        )}

        {/* ختم الدفع للفواتير المدفوعة */}
        {status === 'paid' && (
          <div className="mt-8 flex justify-center print:block">
            <div className="inline-block rotate-[-15deg] rounded-xl border-4 border-emerald-500/40 px-6 py-3 print:border-emerald-600">
              <p className="text-2xl font-black text-emerald-400 print:text-emerald-700">مدفوعة ✓</p>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
