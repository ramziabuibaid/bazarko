'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import Image from 'next/image'
import { emailInvoice, recordInvoicePayment, deleteInvoice } from '@/app/dashboard/accounting/invoices/invoice-actions'
import { recordAuditEvent } from '@/app/dashboard/accounting/audit-actions'
import { useToast } from '@/components/ui/Toast'
import { useConfirm } from '@/components/ui/Confirm'
import PrintButton from '@/components/dashboard/PrintButton'
import BackToDashboardButton from '@/components/dashboard/BackToDashboardButton'

interface InvoiceItem {
  id: string
  name: string
  sku: string | null
  quantity: number
  unit_price: number
  total: number
  cost_price?: number
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
  discount_type?: 'amount' | 'percentage' | null
  discount_value?: number | null
  discount_amount: number
  total: number
  amount_paid: number
  payment_method?: string | null
  notes: string | null
  created_at: string
}

interface Props {
  invoice: Invoice
  items: InvoiceItem[]
  storeName: string
  storePhone: string | null
  storeLogo?: string | null
  currencyCode: string
  linkedOrder: { id: string; order_number: string } | null
  storeId: string
  userId: string
}

const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  draft:     { label: 'غير مدفوعة',      cls: 'bg-amber-500/15 text-amber-300 border border-amber-500/30' },
  sent:      { label: 'مُرسلة (غير مدفوعة)', cls: 'bg-blue-500/15 text-blue-300 border border-blue-500/30' },
  partial:   { label: 'مدفوعة جزئياً',  cls: 'bg-yellow-500/15 text-yellow-300 border border-yellow-500/30' },
  paid:      { label: 'مدفوعة بالكامل', cls: 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30' },
  cancelled: { label: 'ملغاة',          cls: 'bg-red-500/15 text-red-300 border border-red-500/30' },
}

export default function InvoiceView({ invoice, items, storeName, storePhone, storeLogo, currencyCode, linkedOrder, storeId, userId }: Props) {
  const router = useRouter()
  const supabase = createClient()
  const toast = useToast()
  const confirm = useConfirm()
  const [status, setStatus] = useState(invoice.status)
  const [advancing, setAdvancing] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [showEmailForm, setShowEmailForm] = useState(false)
  const [emailTo, setEmailTo] = useState('')
  const [sending, setSending] = useState(false)
  const [emailResult, setEmailResult] = useState<'sent' | 'error' | null>(null)

  // نافذة تسجيل الدفعة
  const [showPay, setShowPay] = useState(false)
  const [payAmount, setPayAmount] = useState('')
  const [payMethod, setPayMethod] = useState<'cash' | 'bank' | 'card' | 'transfer'>('cash')
  const [paying, setPaying] = useState(false)
  const [payError, setPayError] = useState('')

  const fmt = (n: number) => n.toLocaleString('ar-u-nu-latn', { maximumFractionDigits: 2 })
  const remaining = Math.max(0, invoice.total - invoice.amount_paid)

  const computedStatus = (invoice.amount_paid >= invoice.total && invoice.total > 0)
    ? 'paid'
    : (invoice.amount_paid > 0 ? 'partial' : status)
  const sl = STATUS_LABELS[computedStatus] ?? { label: computedStatus, cls: 'bg-white/5 text-white' }

  // متأخرة: تجاوزت تاريخ الاستحقاق وما زال عليها متبقٍّ
  const isOverdue = !!invoice.due_date
    && remaining > 0
    && ['draft', 'sent', 'partial'].includes(status)
    && new Date(invoice.due_date) < new Date(new Date().toDateString())

  const paidPct = invoice.total > 0 ? Math.min(100, Math.round((invoice.amount_paid / invoice.total) * 100)) : 0
  const canPay  = remaining > 0 && status !== 'cancelled'

  async function advanceStatus() {
    if (status !== 'draft') return
    setAdvancing(true)
    await supabase.from('invoices').update({ status: 'sent', updated_at: new Date().toISOString() }).eq('id', invoice.id)
    await recordAuditEvent({
      entityType: 'invoice', entityId: invoice.id, entityLabel: invoice.invoice_number,
      action: 'status_change', details: { from: 'draft', to: 'sent' },
    })
    setStatus('sent')
    setAdvancing(false)
    router.refresh()
  }

  async function submitPayment(e: React.FormEvent) {
    e.preventDefault()
    setPaying(true); setPayError('')
    const res = await recordInvoicePayment(invoice.id, parseFloat(payAmount) || 0, payMethod)
    setPaying(false)
    if (res.ok) { setShowPay(false); setPayAmount(''); toast('تم تسجيل الدفعة بنجاح'); router.refresh() }
    else { setPayError(res.error ?? 'فشل تسجيل الدفعة'); toast(res.error ?? 'فشل تسجيل الدفعة', 'error') }
  }

  // إشعار دفع عبر واتساب
  function paymentReminderUrl() {
    const phone = (invoice.customer_phone ?? '').replace(/[^\d]/g, '')
    const msg = `مرحباً ${invoice.customer_name ?? ''}،\nنذكّركم بفاتورة رقم ${invoice.invoice_number}.\nالمتبقّي: ${fmt(remaining)} ${currencyCode}` +
      (invoice.due_date ? `\nتاريخ الاستحقاق: ${new Date(invoice.due_date).toLocaleDateString('ar-u-nu-latn')}` : '') +
      `\n\n${storeName}`
    return `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`
  }

  async function cancelInvoice() {
    const ok = await confirm({
      title: 'إلغاء الفاتورة',
      message: `هل تريد إلغاء الفاتورة ${invoice.invoice_number}؟ سيُعكَس أثرها على كشف حساب الزبون.`,
      confirmLabel: 'إلغاء الفاتورة',
      cancelLabel: 'تراجع',
      danger: true,
    })
    if (!ok) return
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

    await recordAuditEvent({
      entityType: 'invoice', entityId: invoice.id, entityLabel: invoice.invoice_number,
      action: 'cancel', details: { total: invoice.total },
    })

    setStatus('cancelled')
    setCancelling(false)
    toast(`تم إلغاء الفاتورة ${invoice.invoice_number}`)
    router.refresh()
  }

  async function handleDeleteInvoice() {
    const ok = await confirm({
      title: 'حذف الفاتورة نهائياً',
      message: `هل أنت متأكد من حذف الفاتورة ${invoice.invoice_number}؟ سيتم إعادة الكميات للمخزون وعكس أثر الفاتورة من كشف حساب العميل وحذف سندات القبض المرتبطة بها. لا يمكن التراجع عن هذا الإجراء!`,
      confirmLabel: 'نعم، حذف الفاتورة',
      cancelLabel: 'إلغاء',
      danger: true,
    })
    if (!ok) return
    setDeleting(true)
    try {
      const res = await deleteInvoice(invoice.id)
      if (res.ok) {
        toast('تم حذف الفاتورة بنجاح وإعادة المخزون')
        router.push('/dashboard/accounting/invoices')
        router.refresh()
      } else {
        toast(res.error || 'فشل حذف الفاتورة', 'error')
      }
    } catch (err: any) {
      toast(err.message || 'خطأ أثناء حذف الفاتورة', 'error')
    } finally {
      setDeleting(false)
    }
  }

  async function handleSendEmail(e: React.FormEvent) {
    e.preventDefault()
    setSending(true)
    setEmailResult(null)
    const result = await emailInvoice(invoice.id, emailTo)
    setSending(false)
    setEmailResult(result.ok ? 'sent' : 'error')
    if (result.ok) {
      toast('تم إرسال الفاتورة بالإيميل')
      setTimeout(() => { setShowEmailForm(false); setEmailResult(null) }, 2500)
    } else {
      toast('فشل إرسال الإيميل', 'error')
    }
  }

  return (
    <>
      {/* زر العودة إلى لوحة إدارة المبيعات */}
      <div className="mb-4 print:hidden">
        <BackToDashboardButton href="/dashboard/sales" label="العودة إلى لوحة إدارة المبيعات" />
      </div>

      {/* أدوات الصفحة — تختفي عند الطباعة */}
      <div className="mb-6 flex flex-wrap items-center gap-3 print:hidden">
        <Link href="/dashboard/accounting/invoices"
          className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-slate-400 hover:text-white">
          ← الفواتير
        </Link>
        <span className={`rounded-full px-3 py-1 text-xs font-medium ${sl.cls}`}>{sl.label}</span>
        {isOverdue && (
          <span className="rounded-full bg-red-500/15 px-3 py-1 text-xs font-bold text-red-400">⏰ متأخرة</span>
        )}
        {linkedOrder && (
          <Link
            href={`/dashboard/orders/${linkedOrder.id}`}
            className="flex items-center gap-1.5 rounded-full border border-sky-500/20 bg-sky-500/5 px-3 py-1 text-xs text-sky-400 hover:bg-sky-500/10"
          >
            🔗 <span dir="ltr">{linkedOrder.order_number}</span>
          </Link>
        )}
        <div className="flex-1" />

        {/* تعديل الفاتورة */}
        <Link
          href={`/dashboard/accounting/invoices/${invoice.id}/edit`}
          className="rounded-xl border border-sky-500/30 bg-sky-500/10 px-3.5 py-2 text-sm font-medium text-sky-300 hover:bg-sky-500/20 transition"
        >
          ✏️ تعديل الفاتورة
        </Link>

        {/* حذف الفاتورة */}
        <button
          onClick={handleDeleteInvoice}
          disabled={deleting}
          className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2 text-sm font-medium text-rose-300 hover:bg-rose-500/20 disabled:opacity-50 transition"
        >
          🗑️ {deleting ? 'جارٍ الحذف...' : 'حذف'}
        </button>

        {status === 'draft' && (
          <button onClick={advanceStatus} disabled={advancing}
            className="rounded-xl bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50">
            {advancing ? '...' : 'تحديد كـ مُرسلة'}
          </button>
        )}
        {canPay && (
          <button onClick={() => { setPayAmount(String(remaining)); setShowPay(true) }}
            className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500">
            💵 تسجيل دفعة
          </button>
        )}
        {canPay && invoice.customer_phone && (
          <a href={paymentReminderUrl()} target="_blank" rel="noopener noreferrer"
            className="rounded-xl border border-emerald-500/20 px-4 py-2 text-sm text-emerald-400 hover:bg-emerald-500/10">
            📨 إشعار دفع
          </a>
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

        {/* طباعة عبر محرك PDF المدمج */}
        <PrintButton
          elementId="invoice-print"
          filename={`invoice-${invoice.invoice_number}.pdf`}
          label="🖨️ طباعة (PDF)"
        />

        <Link
          href={`/dashboard/invoices/print/${invoice.id}`}
          target="_blank"
          className="rounded-xl border border-white/10 px-3 py-2 text-xs text-slate-400 hover:text-white transition"
        >
          📄 صفحة الطباعة الرسمية
        </Link>
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

      {/* نافذة تسجيل الدفعة */}
      {showPay && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 print:hidden" onClick={() => setShowPay(false)}>
          <form onSubmit={submitPayment} onClick={e => e.stopPropagation()}
            className="w-full max-w-sm rounded-2xl border border-white/10 bg-slate-900 p-5">
            <h3 className="mb-1 text-lg font-semibold text-white">💵 تسجيل دفعة</h3>
            <p className="mb-4 text-xs text-slate-500">المتبقّي: <span dir="ltr">{fmt(remaining)} {currencyCode}</span> — سيُنشأ سند قبض ويدخل الصندوق</p>
            <label className="mb-1 block text-xs text-slate-400">المبلغ ({currencyCode})</label>
            <input type="number" step="any" value={payAmount} onChange={e => setPayAmount(e.target.value)} dir="ltr" autoFocus
              className="mb-3 w-full rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-white" />
            <label className="mb-1 block text-xs text-slate-400">طريقة الدفع</label>
            <select value={payMethod} onChange={e => setPayMethod(e.target.value as typeof payMethod)}
              className="mb-3 w-full rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-white">
              <option value="cash">نقدي</option>
              <option value="bank">بنك</option>
              <option value="card">بطاقة</option>
              <option value="transfer">تحويل</option>
            </select>
            {payError && <p className="mb-2 text-sm text-red-400">{payError}</p>}
            <div className="flex gap-2">
              <button type="submit" disabled={paying}
                className="flex-1 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">
                {paying ? '...' : 'تأكيد الدفعة'}
              </button>
              <button type="button" onClick={() => setShowPay(false)}
                className="rounded-xl border border-white/10 px-4 py-2.5 text-sm text-slate-400 hover:text-white">إلغاء</button>
            </div>
          </form>
        </div>
      )}

      {/* الفاتورة — تُطبع */}
      <div id="invoice-print" className="rounded-2xl border border-white/5 bg-slate-900 p-8 print:bg-white print:text-black print:border-0 print:p-6 print:rounded-none">
        {/* رأس الفاتورة */}
        <div className="mb-8 flex items-start justify-between">
          <div className="flex items-center gap-4">
            {storeLogo && (
              <img
                src={storeLogo}
                alt={storeName}
                className="h-16 w-16 object-contain rounded-xl border border-white/10 bg-white/5 p-1 print:border-gray-300 print:bg-white"
              />
            )}
            <div>
              <h1 className="text-3xl font-bold text-white print:text-black">
                {invoice.payment_method === 'credit' ? 'فاتورة مبيعات آجلة' : 'فاتورة مبيعات'}
              </h1>
              <p className="mt-1 font-mono text-sky-400 print:text-sky-700" dir="ltr">{invoice.invoice_number}</p>
            </div>
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
                <span className="text-white print:text-black">{new Date(invoice.issue_date).toLocaleDateString('ar-u-nu-latn', { year: 'numeric', month: 'long', day: 'numeric' })}</span>
              </div>
              {invoice.due_date && (
                <div className="flex justify-between gap-8">
                  <span className="text-slate-400 print:text-gray-500">تاريخ الاستحقاق</span>
                  <span className="text-white print:text-black">{new Date(invoice.due_date).toLocaleDateString('ar-u-nu-latn', { year: 'numeric', month: 'long', day: 'numeric' })}</span>
                </div>
              )}
              <div className="flex justify-between gap-8">
                <span className="text-slate-400 print:text-gray-500">طريقة الدفع</span>
                <span className="font-semibold text-white print:text-black">
                  {invoice.payment_method === 'credit'
                    ? 'آجل (على الحساب)'
                    : invoice.payment_method === 'check'
                    ? 'شيك بنكي'
                    : invoice.payment_method === 'card'
                    ? 'بطاقة دفع'
                    : invoice.payment_method === 'bank'
                    ? 'تحويل بنكي'
                    : 'نقداً'}
                </span>
              </div>
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
        <div className="-mx-2 mb-6 overflow-x-auto px-2 print:mx-0 print:overflow-visible print:px-0">
        <table className="w-full min-w-[460px] text-sm print:min-w-0">
          <thead>
            <tr className="border-b-2 border-white/10 print:border-gray-300">
              <th className="pb-2 text-right text-xs font-semibold uppercase tracking-widest text-slate-400 print:text-gray-500">#</th>
              <th className="pb-2 text-right text-xs font-semibold uppercase tracking-widest text-slate-400 print:text-gray-500">الوصف</th>
              <th className="pb-2 text-center text-xs font-semibold uppercase tracking-widest text-slate-400 print:text-gray-500">الكمية</th>
              {items.some(i => Number(i.cost_price || 0) > 0) && (
                <th className="pb-2 text-left text-xs font-semibold uppercase tracking-widest text-slate-400 print:hidden">التكلفة</th>
              )}
              <th className="pb-2 text-left text-xs font-semibold uppercase tracking-widest text-slate-400 print:text-gray-500">سعر البيع</th>
              <th className="pb-2 text-left text-xs font-semibold uppercase tracking-widest text-slate-400 print:text-gray-500">الإجمالي</th>
              {items.some(i => Number(i.cost_price || 0) > 0) && (
                <th className="pb-2 text-left text-xs font-semibold uppercase tracking-widest text-slate-400 print:hidden">الربح</th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5 print:divide-gray-200">
            {items.map((item, i) => {
              const hasCost = items.some(it => Number(it.cost_price || 0) > 0)
              const lineCost = Number(item.cost_price || 0) * item.quantity
              const lineProfit = item.total - lineCost
              return (
                <tr key={item.id}>
                  <td className="py-3 text-slate-500 print:text-gray-400 text-xs">{i + 1}</td>
                  <td className="py-3">
                    <p className="font-medium text-white print:text-black">{item.name}</p>
                    {item.sku && <p className="text-xs text-slate-500 print:text-gray-400" dir="ltr">{item.sku}</p>}
                  </td>
                  <td className="py-3 text-center text-slate-300 print:text-gray-600" dir="ltr">{item.quantity}</td>
                  {hasCost && (
                    <td className="py-3 text-left text-slate-400 font-mono text-xs print:hidden" dir="ltr">
                      {Number(item.cost_price || 0) > 0 ? `${fmt(item.cost_price!)} ${currencyCode}` : '—'}
                    </td>
                  )}
                  <td className="py-3 text-left text-slate-300 print:text-gray-600" dir="ltr">{fmt(item.unit_price)} {currencyCode}</td>
                  <td className="py-3 text-left font-medium text-white print:text-black" dir="ltr">{fmt(item.total)} {currencyCode}</td>
                  {hasCost && (
                    <td className={`py-3 text-left font-mono text-xs font-semibold print:hidden ${lineProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`} dir="ltr">
                      {fmt(lineProfit)} {currencyCode}
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
        </div>

        {/* ملخص التكلفة والربح الإداري (داخلي فقط وغير مطبوع) */}
        {items.some(i => Number(i.cost_price || 0) > 0) && (() => {
          const totCost = items.reduce((s, i) => s + (Number(i.quantity || 0) * Number(i.cost_price || 0)), 0)
          const gProfit = invoice.total - totCost
          return (
            <div className="mb-6 rounded-xl border border-sky-500/20 bg-sky-500/5 p-4 print:hidden">
              <div className="flex items-center justify-between text-xs font-bold text-sky-400 mb-2">
                <span>📊 تحليل التكلفة وهوامش الربح للفاتورة (عرض إداري داخلي):</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <div className="rounded-lg bg-slate-800/80 p-2.5">
                  <span className="text-slate-400 block text-[11px]">إجمالي تكلفة البضاعة:</span>
                  <span className="font-mono font-bold text-slate-200 text-sm" dir="ltr">{fmt(totCost)} {currencyCode}</span>
                </div>
                <div className="rounded-lg bg-slate-800/80 p-2.5">
                  <span className="text-slate-400 block text-[11px]">مجمل الربح التقديري:</span>
                  <span className={`font-mono font-bold text-sm ${gProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`} dir="ltr">
                    {fmt(gProfit)} {currencyCode}
                  </span>
                </div>
                <div className="rounded-lg bg-slate-800/80 p-2.5">
                  <span className="text-slate-400 block text-[11px]">نسبة هامش الربح:</span>
                  <span className="font-mono font-bold text-emerald-400 text-sm" dir="ltr">
                    {invoice.total > 0 ? `${((gProfit / invoice.total) * 100).toFixed(1)}%` : '0%'}
                  </span>
                </div>
              </div>
            </div>
          )
        })()}

        {/* الإجماليات */}
        <div className="flex justify-end">
          <div className="w-64 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-400 print:text-gray-500">المجموع الفرعي</span>
              <span className="text-white print:text-black" dir="ltr">{fmt(invoice.subtotal)} {currencyCode}</span>
            </div>
            {invoice.discount_amount > 0 && (
              <div className="flex justify-between">
                <span className="text-slate-400 print:text-gray-500">
                  خصم {invoice.discount_type === 'percentage' && invoice.discount_value ? `(${invoice.discount_value}%)` : ''}
                </span>
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
                {/* شريط تقدم الدفع */}
                <div className="pt-1">
                  <div className="h-2 w-full overflow-hidden rounded-full bg-white/10 print:bg-gray-200">
                    <div className={`h-full rounded-full ${paidPct >= 100 ? 'bg-emerald-500' : 'bg-amber-500'}`} style={{ width: `${paidPct}%` }} />
                  </div>
                  <p className="mt-1 text-left text-xs text-slate-500 print:text-gray-400" dir="ltr">{paidPct}%</p>
                </div>
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
