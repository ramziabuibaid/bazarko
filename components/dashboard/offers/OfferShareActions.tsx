'use client'

import { useState } from 'react'
import { sendOfferToCustomers } from '@/app/dashboard/offers/[id]/actions'

interface Props {
  offerId: string
  offerTitle: string
  publicUrl: string   // رابط كامل https://...
}

export default function OfferShareActions({ offerId, offerTitle, publicUrl }: Props) {
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [copied, setCopied] = useState(false)

  async function handleSend() {
    if (!confirm('إرسال هذا العرض بالإيميل لكل زبائنك الذين لديهم بريد إلكتروني؟')) return
    setSending(true)
    setResult(null)
    const res = await sendOfferToCustomers(offerId)
    setSending(false)
    setResult(res.ok
      ? { ok: true, message: `✅ أُرسل العرض لـ ${res.sent} من أصل ${res.total} زبون` }
      : { ok: false, message: res.error ?? 'فشل الإرسال' }
    )
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(publicUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const whatsappText = encodeURIComponent(`🔥 ${offerTitle}\nعرض حصري لفترة محدودة — تسوق الآن:\n${publicUrl}`)

  return (
    <div className="rounded-2xl border border-white/5 bg-slate-900 p-5">
      <h2 className="mb-4 font-semibold text-white">📣 سوّق العرض</h2>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handleSend}
          disabled={sending}
          className="rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-medium text-slate-950 hover:bg-sky-400 disabled:opacity-50"
        >
          {sending ? 'جارٍ الإرسال...' : '✉️ أرسل لزبائنك بالإيميل'}
        </button>
        <a
          href={`https://wa.me/?text=${whatsappText}`}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-xl border border-green-500/30 px-4 py-2.5 text-sm font-medium text-green-400 hover:bg-green-500/10"
        >
          📱 شارك عبر واتساب
        </a>
        <button
          type="button"
          onClick={handleCopy}
          className="rounded-xl border border-white/10 px-4 py-2.5 text-sm text-slate-300 hover:bg-white/5"
        >
          {copied ? '✓ نُسخ' : '🔗 انسخ الرابط'}
        </button>
      </div>
      {result && (
        <p className={`mt-3 text-sm ${result.ok ? 'text-emerald-400' : 'text-red-400'}`}>
          {result.message}
        </p>
      )}
    </div>
  )
}
