'use client'

import { useState } from 'react'

interface UpgradeRequestCardProps {
  store: {
    id: string
    name: string
    subdomain: string
    plan: string
    phone?: string | null
  }
  userEmail?: string | null
}

export default function UpgradeRequestCard({ store, userEmail }: UpgradeRequestCardProps) {
  const [submitted, setSubmitted] = useState(false)
  const [phoneInput, setPhoneInput] = useState(store.phone || '')
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)

  const whatsappMessage = encodeURIComponent(
    `مرحباً فريق بزاركو / شركة المنار،\nأرغب في ترقية متجري (${store.name}) إلى النسخة الكاملة من Bazarko ERP.\nرابط المتجر: https://${store.subdomain}.bazarko.app\nالبريد: ${userEmail || ''}`
  )

  const whatsappUrl = `https://wa.me/970599000000?text=${whatsappMessage}`

  async function handleSendRequest(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    // Simulate or log support ticket
    setTimeout(() => {
      setSubmitted(true)
      setLoading(false)
    }, 600)
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      {/* ── Direct Instant WhatsApp Contact ── */}
      <div className="flex flex-col justify-between rounded-3xl border border-emerald-500/30 bg-gradient-to-br from-emerald-950/30 via-slate-900 to-slate-950 p-6 sm:p-8 shadow-xl">
        <div className="space-y-4">
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-bold text-emerald-400">
            <span>💬</span>
            <span>تفعيل سريع ومباشر</span>
          </div>

          <h2 className="text-xl sm:text-2xl font-black text-white">
            تواصل مباشرة عبر واتساب مع فريق المنار
          </h2>

          <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
            فريق الدعم الفني والمبيعات في شركة المنار / بزاركو متاح لمساعدتك في تفعيل النسخة الكاملة فوراً، وتقديم الدعم والتدريب المحاسبي المطلوب لفريق عملك.
          </p>

          <div className="space-y-2 rounded-2xl bg-slate-950/60 p-4 border border-white/5 text-xs">
            <div className="flex items-center justify-between text-slate-300">
              <span className="text-slate-500">الجهة المطورة:</span>
              <strong className="text-white">شركة المنار لتكنولوجيا المعلومات & بزاركو</strong>
            </div>
            <div className="flex items-center justify-between text-slate-300">
              <span className="text-slate-500">مركز الدعم:</span>
              <span>فلسطين • خدمات سحابية مدارة</span>
            </div>
            <div className="flex items-center justify-between text-slate-300">
              <span className="text-slate-500">البريد المعتمد:</span>
              <span className="font-mono text-sky-400" dir="ltr">support@bazarko.app</span>
            </div>
          </div>
        </div>

        <div className="pt-6">
          <a
            href={whatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-500 py-3.5 px-6 text-sm font-bold text-slate-950 shadow-lg shadow-emerald-500/25 transition-all hover:bg-emerald-400 hover:scale-[1.02]"
          >
            <span className="text-lg">💬</span>
            <span>محادثة فورية عبر واتساب لطلب التفعيل</span>
          </a>
        </div>
      </div>

      {/* ── Form: Request Activation ── */}
      <div className="rounded-3xl border border-sky-500/20 bg-slate-900 p-6 sm:p-8 shadow-xl flex flex-col justify-between">
        <div>
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-sky-500/30 bg-sky-500/10 px-3 py-1 text-xs font-bold text-sky-400">
            <span>📝</span>
            <span>طلب ترقية من داخل النظام</span>
          </div>

          <h2 className="text-xl font-bold text-white mb-2">إرسال طلب اشتراك وتفعيل</h2>
          <p className="text-xs text-slate-400 mb-5 leading-relaxed">
            أدخل بيانات التواصل وسيقوم مستشار الحسابات بالتواصل معك لتفعيل الخطة واستكمال الإجراءات.
          </p>

          {submitted ? (
            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-6 text-center space-y-3">
              <span className="text-3xl block">🎉</span>
              <h3 className="text-base font-bold text-emerald-300">تم استلام طلب الترقية بنجاح!</h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                شكراً لك. سيتواصل معك أحد مسؤولي خدمة عملاء المنار / بزاركو عبر الهاتف أو الواتساب خلال ساعات العمل لتأكيد التفعيل.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSendRequest} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">اسم المتجر / المنشأة</label>
                <input
                  type="text"
                  disabled
                  value={store.name}
                  className="w-full rounded-xl border border-white/10 bg-slate-800/60 px-3.5 py-2.5 text-xs text-slate-300"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">رقم الهاتف للتواصل المباشر *</label>
                <input
                  type="tel"
                  required
                  dir="ltr"
                  placeholder="0599123456"
                  value={phoneInput}
                  onChange={e => setPhoneInput(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-slate-800 px-3.5 py-2.5 text-xs text-white font-mono placeholder-slate-500 outline-none focus:border-sky-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">ملاحظات أو استفسار إضافي</label>
                <textarea
                  rows={3}
                  placeholder="مثال: نرغب أيضاً بتدريب موظفي المبيعات على نقاط البيع POS والشيكات..."
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-slate-800 px-3.5 py-2.5 text-xs text-white placeholder-slate-500 outline-none focus:border-sky-500 resize-none"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-xl bg-gradient-to-r from-sky-500 to-indigo-600 py-3 text-xs font-bold text-white shadow-lg shadow-sky-500/20 transition hover:from-sky-400 hover:to-indigo-500 disabled:opacity-50"
              >
                {loading ? 'جاري الإرسال...' : 'إرسال طلب الترقية الآن 🚀'}
              </button>
            </form>
          )}
        </div>

        <div className="mt-4 text-center text-[11px] text-slate-500">
          أو اتصل مباشرة بالرقم: <strong className="text-slate-300 font-mono" dir="ltr">+970 59-900-0000</strong>
        </div>
      </div>
    </div>
  )
}
