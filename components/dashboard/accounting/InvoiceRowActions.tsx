'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { recordInvoicePayment } from '@/app/dashboard/accounting/invoices/invoice-actions'
import { useToast } from '@/components/ui/Toast'
import { useConfirm } from '@/components/ui/Confirm'

interface Props {
  id: string
  invoiceNumber: string
  customerName: string | null
  customerPhone: string | null
  remaining: number
  status: string
  dueDate: string | null
  currencyCode: string
  storeName: string
}

export default function InvoiceRowActions({
  id, invoiceNumber, customerName, customerPhone, remaining, status, dueDate, currencyCode, storeName,
}: Props) {
  const router = useRouter()
  const toast = useToast()
  const confirm = useConfirm()
  const [busy, setBusy] = useState(false)

  const fmt = (n: number) => n.toLocaleString('ar-u-nu-latn', { maximumFractionDigits: 0 })
  const open = status !== 'paid' && status !== 'cancelled' && remaining > 0
  const phone = (customerPhone ?? '').replace(/[^\d]/g, '')

  function reminderUrl() {
    const msg = `مرحباً ${customerName ?? ''}،\nنذكّركم بفاتورة رقم ${invoiceNumber}.\nالمتبقّي: ${fmt(remaining)} ${currencyCode}` +
      (dueDate ? `\nتاريخ الاستحقاق: ${new Date(dueDate).toLocaleDateString('ar-u-nu-latn')}` : '') +
      `\n\n${storeName}`
    return `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`
  }

  async function markPaid() {
    const ok = await confirm({
      title: 'تحديد كمدفوعة',
      message: `تسجيل دفعة كاملة بمبلغ ${fmt(remaining)} ${currencyCode} على الفاتورة ${invoiceNumber}؟ سيُنشأ سند قبض ويُحدَّث كشف حساب الزبون.`,
      confirmLabel: 'تأكيد الدفع',
    })
    if (!ok) return
    setBusy(true)
    const res = await recordInvoicePayment(id, remaining, 'cash')
    setBusy(false)
    if (res.ok) { toast(`تم تسجيل دفع الفاتورة ${invoiceNumber}`); router.refresh() }
    else toast(res.error ?? 'فشل تسجيل الدفعة', 'error')
  }

  return (
    <div className="flex items-center justify-end gap-1">
      {open && phone && (
        <a href={reminderUrl()} target="_blank" rel="noopener noreferrer" title="تذكير عبر واتساب"
          className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-emerald-500/10 hover:text-emerald-400">📲</a>
      )}
      {open && (
        <button onClick={markPaid} disabled={busy} title="تحديد كمدفوعة"
          className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-emerald-500/10 hover:text-emerald-400 disabled:opacity-40">✅</button>
      )}
      <Link href={`/dashboard/accounting/invoices/${id}`} title="عرض"
        className="rounded-lg bg-white/5 px-3 py-1.5 text-xs text-slate-300 hover:bg-sky-500/15 hover:text-sky-400">عرض</Link>
    </div>
  )
}
