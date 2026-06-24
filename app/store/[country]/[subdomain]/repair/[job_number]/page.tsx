import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'

interface Props {
  params: { country: string; subdomain: string; job_number: string }
}

const STATUS_STEPS = [
  { key: 'received',      label: 'استُلم الجهاز',     icon: '📥' },
  { key: 'diagnosing',    label: 'التشخيص',             icon: '🔍' },
  { key: 'in_repair',     label: 'قيد الإصلاح',        icon: '🔧' },
  { key: 'ready',         label: 'جاهز للاستلام',      icon: '✅' },
  { key: 'delivered',     label: 'تم التسليم',          icon: '📤' },
]

const STATUS_META: Record<string, { label: string; desc: string; color: string }> = {
  received:      { label: 'استُلم',          desc: 'تم استلام جهازك وسيبدأ التشخيص قريباً',          color: 'text-amber-400' },
  diagnosing:    { label: 'يُشخَّص الآن',    desc: 'الفني يقوم بتشخيص المشكلة',                       color: 'text-blue-400' },
  in_repair:     { label: 'قيد الإصلاح',    desc: 'جهازك تحت الإصلاح الآن',                          color: 'text-purple-400' },
  waiting_parts: { label: 'انتظار قطع',      desc: 'في انتظار وصول قطع الغيار اللازمة',              color: 'text-orange-400' },
  ready:         { label: 'جاهز للاستلام',  desc: 'جهازك جاهز! يمكنك المجيء لاستلامه',              color: 'text-emerald-400' },
  delivered:     { label: 'تم التسليم',      desc: 'تم تسليم الجهاز بنجاح. شكراً لثقتكم!',           color: 'text-slate-400' },
  cancelled:     { label: 'ملغي',            desc: 'تم إلغاء طلب الصيانة. تواصل مع المحل للتفاصيل.', color: 'text-red-400' },
}

const DEVICE_ICONS: Record<string, string> = {
  phone: '📱', laptop: '💻', tablet: '📟', tv: '📺',
  printer: '🖨️', camera: '📷', appliance: '🔌', other: '🔧',
}

export default async function RepairTrackingPage({ params }: Props) {
  const supabase = createClient()

  // جلب المتجر
  const { data: store } = await supabase
    .from('stores')
    .select('id, name, phone, currency_code')
    .eq('subdomain', params.subdomain)
    .eq('country_code', params.country.toUpperCase())
    .single()

  if (!store) notFound()

  // جلب طلب الصيانة
  const { data: job } = await supabase
    .from('repair_jobs')
    .select('id, job_number, customer_name, device_type, brand, model, color, problem_desc, work_done, status, priority, received_at, estimated_done, delivered_at, estimated_cost, final_cost, deposit_paid')
    .eq('store_id', store.id)
    .eq('job_number', params.job_number)
    .single()

  if (!job) notFound()

  const meta = STATUS_META[job.status] ?? STATUS_META.received
  const linearStatus = job.status === 'waiting_parts' ? 'in_repair' : job.status
  const currentStep  = STATUS_STEPS.findIndex(s => s.key === linearStatus)
  const isCancelled  = job.status === 'cancelled'
  const isReady      = job.status === 'ready'
  const balance      = Math.max(0, (job.final_cost ?? 0) - (job.deposit_paid ?? 0))
  const fmt          = (n: number) => n.toLocaleString('ar-u-nu-latn', { maximumFractionDigits: 0 })

  return (
    <div className="min-h-screen bg-slate-950 text-white" dir="rtl">
      {/* Header */}
      <div className="border-b border-white/5 bg-slate-900 px-4 py-4">
        <div className="mx-auto max-w-xl">
          <p className="text-xs text-sky-400">Bazarko · {store.name}</p>
          <h1 className="mt-0.5 text-lg font-bold text-white">تتبع طلب الصيانة</h1>
        </div>
      </div>

      <div className="mx-auto max-w-xl px-4 py-8 space-y-6">

        {/* رقم الطلب والحالة */}
        <div className="rounded-2xl border border-white/5 bg-slate-900 p-6 text-center">
          <p className="text-xs text-slate-500 mb-1">رقم الطلب</p>
          <p className="font-mono text-3xl font-bold text-white" dir="ltr">{job.job_number}</p>
          <p className={`mt-3 text-xl font-semibold ${meta.color}`}>{meta.label}</p>
          <p className="mt-1 text-sm text-slate-400">{meta.desc}</p>

          {isReady && (
            <div className="mt-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 p-3">
              <p className="text-emerald-300 font-semibold">🎉 جهازك جاهز للاستلام!</p>
              {balance > 0 && (
                <p className="mt-1 text-sm text-emerald-400">المبلغ المتبقي: {fmt(balance)} {store.currency_code}</p>
              )}
            </div>
          )}
        </div>

        {/* شريط التقدم */}
        {!isCancelled && (
          <div className="rounded-2xl border border-white/5 bg-slate-900 p-5">
            <div className="space-y-4">
              {STATUS_STEPS.map((step, i) => {
                const done   = i < currentStep
                const active = i === currentStep
                const future = i > currentStep
                return (
                  <div key={step.key} className="flex items-start gap-4">
                    <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-base transition-all ${
                      done   ? 'bg-emerald-500 text-white' :
                      active ? 'bg-sky-600 text-white ring-2 ring-sky-500/40 ring-offset-2 ring-offset-slate-900' :
                               'bg-white/5 text-slate-600'
                    }`}>
                      {done ? '✓' : step.icon}
                    </div>
                    <div className="flex-1 pt-1">
                      <p className={`text-sm font-medium ${
                        done ? 'text-emerald-400' : active ? 'text-white' : 'text-slate-600'
                      }`}>{step.label}</p>
                      {active && job.status === 'waiting_parts' && (
                        <p className="text-xs text-orange-400 mt-0.5">⏳ في انتظار وصول قطع الغيار</p>
                      )}
                    </div>
                    {active && <span className="text-xs text-sky-400 mt-1">الحالة الحالية</span>}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {isCancelled && (
          <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-5 text-center">
            <p className="text-4xl mb-2">❌</p>
            <p className="text-red-400 font-semibold">تم إلغاء طلب الصيانة</p>
            <p className="text-sm text-slate-400 mt-1">تواصل مع المحل لمعرفة التفاصيل</p>
          </div>
        )}

        {/* معلومات الجهاز */}
        <div className="rounded-2xl border border-white/5 bg-slate-900 p-5">
          <h2 className="mb-4 text-sm font-semibold text-slate-400">الجهاز</h2>
          <div className="flex items-center gap-3">
            <span className="text-3xl">{DEVICE_ICONS[job.device_type] ?? '🔧'}</span>
            <div>
              <p className="font-medium text-white">
                {[job.brand, job.model].filter(Boolean).join(' ') || job.device_type}
              </p>
              {job.color && <p className="text-xs text-slate-400">{job.color}</p>}
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-white/5 text-sm">
            <p className="text-slate-400 mb-1">وصف العطل</p>
            <p className="text-slate-300">{job.problem_desc}</p>
          </div>
          {job.work_done && (
            <div className="mt-3 pt-3 border-t border-white/5 text-sm">
              <p className="text-slate-400 mb-1">العمل المنجز</p>
              <p className="text-slate-300">{job.work_done}</p>
            </div>
          )}
        </div>

        {/* التواريخ */}
        <div className="grid grid-cols-2 gap-4">
          <div className="rounded-xl border border-white/5 bg-slate-900 p-4 text-center">
            <p className="text-xs text-slate-500 mb-1">تاريخ الاستلام</p>
            <p className="text-sm font-medium text-white">
              {new Date(job.received_at).toLocaleDateString('ar-u-nu-latn', { year: 'numeric', month: 'long', day: 'numeric' })}
            </p>
          </div>
          {job.estimated_done && (
            <div className="rounded-xl border border-white/5 bg-slate-900 p-4 text-center">
              <p className="text-xs text-slate-500 mb-1">الموعد المتوقع</p>
              <p className="text-sm font-medium text-white">
                {new Date(job.estimated_done).toLocaleDateString('ar-u-nu-latn', { year: 'numeric', month: 'long', day: 'numeric' })}
              </p>
            </div>
          )}
        </div>

        {/* التواصل */}
        {store.phone && (
          <a href={`https://wa.me/${store.phone.replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer"
            className="flex items-center justify-center gap-3 rounded-2xl border border-green-500/20 bg-green-500/5 p-4 text-green-400 hover:bg-green-500/10">
            <span className="text-2xl">💬</span>
            <div>
              <p className="font-medium">تواصل مع المحل عبر واتساب</p>
              <p className="text-xs text-green-600" dir="ltr">{store.phone}</p>
            </div>
          </a>
        )}

        <p className="text-center text-xs text-slate-600">
          مدعوم بـ <span className="text-sky-600">Bazarko</span>
        </p>
      </div>
    </div>
  )
}
