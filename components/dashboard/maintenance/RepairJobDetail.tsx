'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { uploadRepairPhoto } from '@/lib/supabase/storage'

// ── Types ─────────────────────────────────────────────────────────────────────

interface RepairPhoto {
  stage: string
  url: string
  taken_at: string
}

interface RepairJob {
  id: string; job_number: string; store_id: string
  customer_id: string | null; customer_name: string; customer_phone: string | null
  device_type: string; brand: string | null; model: string | null
  color: string | null; serial_number: string | null; condition_notes: string | null
  problem_desc: string; diagnosis: string | null; work_done: string | null
  status: string; priority: string
  estimated_cost: number | null; final_cost: number; deposit_paid: number
  received_at: string; estimated_done: string | null; delivered_at: string | null
  assigned_to: string | null; invoice_id: string | null
  internal_notes: string | null; created_at: string
  photos: RepairPhoto[] | null
}

interface Part {
  id: string; product_id: string | null; name: string
  quantity: number; unit_cost: number; total: number
}

interface HistoryEntry {
  id: string; from_status: string | null; to_status: string
  note: string | null; changed_at: string
}

interface Product {
  id: string; name: string; sku: string | null; price: number
}

interface Props {
  job: RepairJob
  parts: Part[]
  history: HistoryEntry[]
  currencyCode: string
  userId: string
  storeName: string
  storeSubdomain: string
  storeCountryCode: string
  storePhone: string | null
  storeWhatsapp: string | null
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_META: Record<string, { label: string; icon: string; cls: string }> = {
  received:      { label: 'استُلم',          icon: '📥', cls: 'bg-amber-500/15 text-amber-300' },
  diagnosing:    { label: 'التشخيص',          icon: '🔍', cls: 'bg-blue-500/15 text-blue-300' },
  in_repair:     { label: 'قيد الإصلاح',     icon: '🔧', cls: 'bg-purple-500/15 text-purple-300' },
  waiting_parts: { label: 'انتظار قطع',       icon: '⏳', cls: 'bg-orange-500/15 text-orange-300' },
  ready:         { label: 'جاهز للاستلام',   icon: '✅', cls: 'bg-emerald-500/15 text-emerald-300' },
  delivered:     { label: 'سُلِّم',           icon: '📤', cls: 'bg-slate-500/15 text-slate-300' },
  cancelled:     { label: 'ملغي',             icon: '❌', cls: 'bg-red-500/15 text-red-300' },
}

const STATUS_FLOW: Record<string, string | null> = {
  received: 'diagnosing', diagnosing: 'in_repair',
  in_repair: 'ready', waiting_parts: 'in_repair',
  ready: 'delivered', delivered: null, cancelled: null,
}

const STATUS_NEXT_LABEL: Record<string, string> = {
  received: 'بدء التشخيص ←',
  diagnosing: 'بدء الإصلاح ←',
  in_repair: 'تحديد كـ جاهز ←',
  waiting_parts: 'القطع وصلت ← متابعة الإصلاح',
  ready: 'تسليم للزبون ←',
}

const DEVICE_ICONS: Record<string, string> = {
  phone: '📱', laptop: '💻', tablet: '📟', tv: '📺',
  printer: '🖨️', camera: '📷', appliance: '🔌', other: '🔧',
}

const PHOTO_STAGES = [
  { value: 'received',   label: 'عند الاستلام' },
  { value: 'diagnosing', label: 'عند التشخيص' },
  { value: 'in_repair',  label: 'أثناء الإصلاح' },
  { value: 'ready',      label: 'عند الجاهزية' },
  { value: 'delivered',  label: 'عند التسليم' },
]

const PHOTO_STAGE_LABEL: Record<string, string> = Object.fromEntries(
  PHOTO_STAGES.map(s => [s.value, s.label])
)

// ── Helpers ───────────────────────────────────────────────────────────────────

function useDebounce<T extends (...args: Parameters<T>) => void>(fn: T, ms: number) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  return useCallback((...args: Parameters<T>) => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => fn(...args), ms)
  }, [fn, ms])
}

function buildNotificationMsg(job: { customer_name: string; brand: string | null; model: string | null; device_type: string; job_number: string; status: string }, trackingUrl: string): string {
  const device = [job.brand, job.model].filter(Boolean).join(' ') || job.device_type
  const statusLabel = STATUS_META[job.status]?.label ?? job.status
  const lines = [
    `مرحباً ${job.customer_name} 👋`,
    `جهازك "${device}" — ${job.job_number}`,
    `الحالة: ${statusLabel}`,
  ]
  if (job.status === 'ready')         lines.push('✅ جهازك جاهز للاستلام!')
  else if (job.status === 'waiting_parts') lines.push('⏳ بانتظار وصول قطع الغيار.')
  lines.push(`\nتابع جهازك: ${trackingUrl}`)
  return lines.join('\n')
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function RepairJobDetail({
  job, parts: initialParts, history, currencyCode, userId,
  storeName, storeSubdomain, storeCountryCode,
}: Props) {
  const router   = useRouter()
  const supabase = createClient()

  const [status,   setStatus]   = useState(job.status)
  const [priority, setPriority] = useState(job.priority)

  const [diagnosis,     setDiagnosis]     = useState(job.diagnosis ?? '')
  const [workDone,      setWorkDone]      = useState(job.work_done ?? '')
  const [internalNotes, setInternalNotes] = useState(job.internal_notes ?? '')
  const [assignedTo,    setAssignedTo]    = useState(job.assigned_to ?? '')
  const [estimatedCost, setEstimatedCost] = useState(String(job.estimated_cost ?? ''))
  const [finalCost,     setFinalCost]     = useState(String(job.final_cost))
  const [depositPaid,   setDepositPaid]   = useState(String(job.deposit_paid))
  const [estimatedDone, setEstimatedDone] = useState(job.estimated_done ?? '')

  const [parts,       setParts]       = useState<Part[]>(initialParts)
  const [partSearch,  setPartSearch]  = useState('')
  const [partResults, setPartResults] = useState<Product[]>([])
  const [newPartName, setNewPartName] = useState('')
  const [newPartQty,  setNewPartQty]  = useState('1')
  const [newPartCost, setNewPartCost] = useState('')

  const [photos,         setPhotos]         = useState<RepairPhoto[]>(job.photos ?? [])
  const [photoStage,     setPhotoStage]     = useState('received')
  const [uploadingPhoto, setUploadingPhoto] = useState(false)

  const [smsCopied, setSmsCopied] = useState(false)
  const [saving,    setSaving]    = useState(false)
  const [advancing, setAdvancing] = useState(false)
  const [savingPart, setSavingPart] = useState(false)

  const [trackingUrl, setTrackingUrl] = useState('')
  useEffect(() => {
    setTrackingUrl(
      `${window.location.origin}/store/${storeCountryCode}/${storeSubdomain}/repair/${job.job_number}`
    )
  }, [storeCountryCode, storeSubdomain, job.job_number])

  const fmt          = (n: number) => n.toLocaleString('ar-SA', { maximumFractionDigits: 0 })
  const nextStatus   = STATUS_FLOW[status]
  const sm           = STATUS_META[status] ?? STATUS_META.received
  const partsTotal   = parts.reduce((s, p) => s + p.total, 0)
  const finalCostNum = parseFloat(finalCost) || 0
  const depositNum   = parseFloat(depositPaid) || 0
  const balance      = finalCostNum - depositNum

  const qrUrl = trackingUrl
    ? `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(trackingUrl)}`
    : ''

  const cleanPhone      = (job.customer_phone ?? '').replace(/\D/g, '')
  const notificationMsg = buildNotificationMsg({ ...job, status }, trackingUrl)

  // ── Search parts ────────────────────────────────────────────────────────────
  const searchParts = useDebounce(async (q: string) => {
    if (!q.trim()) { setPartResults([]); return }
    const { data } = await supabase
      .from('products').select('id, name, sku, price')
      .eq('store_id', job.store_id).ilike('name', `%${q}%`).limit(6)
    setPartResults((data as Product[] | null) ?? [])
  }, 250)

  function fillPartFromProduct(p: Product) {
    setNewPartName(p.name); setNewPartCost(String(p.price))
    setPartSearch(''); setPartResults([])
  }

  // ── Save work fields ────────────────────────────────────────────────────────
  async function saveWorkFields() {
    setSaving(true)
    await supabase.from('repair_jobs').update({
      diagnosis:      diagnosis.trim() || null,
      work_done:      workDone.trim() || null,
      internal_notes: internalNotes.trim() || null,
      assigned_to:    assignedTo.trim() || null,
      estimated_cost: estimatedCost ? parseFloat(estimatedCost) : null,
      final_cost:     parseFloat(finalCost) || 0,
      deposit_paid:   parseFloat(depositPaid) || 0,
      estimated_done: estimatedDone || null,
      priority,
      updated_at:     new Date().toISOString(),
    }).eq('id', job.id)
    setSaving(false)
    router.refresh()
  }

  // ── Advance status ──────────────────────────────────────────────────────────
  async function advanceStatus() {
    if (!nextStatus) return
    setAdvancing(true)
    const updates: Record<string, string | null> = { status: nextStatus, updated_at: new Date().toISOString() }
    if (nextStatus === 'delivered') updates.delivered_at = new Date().toISOString().slice(0, 10)
    await supabase.from('repair_jobs').update(updates).eq('id', job.id)
    await supabase.from('repair_job_history').insert({
      job_id: job.id, from_status: status, to_status: nextStatus,
      note: STATUS_NEXT_LABEL[status] ?? null, changed_by: userId,
    })
    setStatus(nextStatus)
    setAdvancing(false)
    router.refresh()
  }

  // ── Set waiting_parts ───────────────────────────────────────────────────────
  async function setWaitingParts() {
    setAdvancing(true)
    await supabase.from('repair_jobs').update({ status: 'waiting_parts', updated_at: new Date().toISOString() }).eq('id', job.id)
    await supabase.from('repair_job_history').insert({
      job_id: job.id, from_status: status, to_status: 'waiting_parts',
      note: 'في انتظار وصول قطع الغيار', changed_by: userId,
    })
    setStatus('waiting_parts')
    setAdvancing(false)
    router.refresh()
  }

  // ── Cancel ──────────────────────────────────────────────────────────────────
  async function cancelJob() {
    if (!confirm('هل تريد إلغاء طلب الصيانة هذا؟')) return
    await supabase.from('repair_jobs').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('id', job.id)
    await supabase.from('repair_job_history').insert({
      job_id: job.id, from_status: status, to_status: 'cancelled',
      note: 'تم إلغاء الطلب', changed_by: userId,
    })
    setStatus('cancelled')
    router.refresh()
  }

  // ── Parts ───────────────────────────────────────────────────────────────────
  async function addPart() {
    if (!newPartName.trim()) return
    const qty  = parseFloat(newPartQty) || 1
    const cost = parseFloat(newPartCost) || 0
    setSavingPart(true)
    const { data: p } = await supabase.from('repair_job_parts').insert({
      job_id: job.id, product_id: null,
      name: newPartName.trim(), quantity: qty, unit_cost: cost, total: qty * cost,
    }).select('id, product_id, name, quantity, unit_cost, total').single()
    if (p) setParts(prev => [...prev, p as Part])
    setNewPartName(''); setNewPartQty('1'); setNewPartCost(''); setSavingPart(false)
  }

  async function removePart(partId: string) {
    await supabase.from('repair_job_parts').delete().eq('id', partId)
    setParts(prev => prev.filter(p => p.id !== partId))
  }

  // ── Photos ──────────────────────────────────────────────────────────────────
  async function handlePhotoCapture(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingPhoto(true)
    try {
      const url     = await uploadRepairPhoto(job.store_id, job.id, file)
      const newPhoto: RepairPhoto = { stage: photoStage, url, taken_at: new Date().toISOString() }
      const updated = [...photos, newPhoto]
      await supabase.from('repair_jobs').update({ photos: updated as unknown[] }).eq('id', job.id)
      setPhotos(updated)
    } catch { /* silent */ }
    setUploadingPhoto(false)
    e.target.value = ''
  }

  // ── Notifications ───────────────────────────────────────────────────────────
  async function copySmsText() {
    await navigator.clipboard.writeText(notificationMsg)
    setSmsCopied(true)
    setTimeout(() => setSmsCopied(false), 2000)
  }

  // ── Create invoice ──────────────────────────────────────────────────────────
  function goCreateInvoice() {
    router.push(`/dashboard/accounting/invoices/new?from_repair=${job.id}`)
  }

  // ── Progress steps ──────────────────────────────────────────────────────────
  const STEPS = ['received', 'diagnosing', 'in_repair', 'ready', 'delivered']
  const currentStep = STEPS.indexOf(status === 'waiting_parts' ? 'in_repair' : status)

  return (
    <div className="space-y-6" dir="rtl">

      {/* ── رأس الصفحة ── */}
      <div className="flex flex-wrap items-start gap-3 print:hidden">
        <Link href="/dashboard/maintenance" className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-slate-400 hover:text-white">
          ← لوحة الصيانة
        </Link>
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <h1 className="font-mono text-lg font-semibold text-white" dir="ltr">{job.job_number}</h1>
          <span className={`rounded-full px-3 py-1 text-xs font-medium ${sm.cls}`}>{sm.icon} {sm.label}</span>
          {job.priority === 'urgent' && (
            <span className="rounded-full bg-red-500/20 px-3 py-1 text-xs font-medium text-red-400">🔴 عاجل</span>
          )}
        </div>
        <div className="flex gap-2">
          {job.invoice_id ? (
            <Link href={`/dashboard/accounting/invoices/${job.invoice_id}`}
              className="rounded-xl border border-sky-500/30 bg-sky-500/10 px-4 py-2 text-sm text-sky-300 hover:bg-sky-500/20">
              📋 الفاتورة
            </Link>
          ) : (status === 'ready' || status === 'delivered') ? (
            <button onClick={goCreateInvoice}
              className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-300 hover:bg-emerald-500/20">
              📋 إنشاء فاتورة
            </button>
          ) : null}
          <button onClick={() => window.print()}
            className="rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/5">
            🖨️ طباعة الوصل
          </button>
        </div>
      </div>

      {/* ── شريط تقدم الحالة ── */}
      {status !== 'cancelled' && (
        <div className="rounded-2xl border border-white/5 bg-slate-900 p-4 print:hidden">
          <div className="flex items-center gap-0">
            {STEPS.map((step, i) => {
              const meta   = STATUS_META[step]
              const done   = i < currentStep
              const active = i === currentStep
              const last   = i === STEPS.length - 1
              return (
                <div key={step} className="flex flex-1 items-center">
                  <div className="flex flex-col items-center gap-1">
                    <div className={`flex h-8 w-8 items-center justify-center rounded-full text-sm transition-all ${
                      done   ? 'bg-emerald-500 text-white' :
                      active ? 'bg-sky-600 text-white ring-2 ring-sky-500/50 ring-offset-1 ring-offset-slate-900' :
                               'bg-white/5 text-slate-500'
                    }`}>
                      {done ? '✓' : meta.icon}
                    </div>
                    <span className={`text-[10px] whitespace-nowrap ${active ? 'text-sky-400' : done ? 'text-emerald-400' : 'text-slate-600'}`}>
                      {meta.label}
                    </span>
                  </div>
                  {!last && <div className={`mx-1 h-0.5 flex-1 rounded ${i < currentStep ? 'bg-emerald-500/50' : 'bg-white/5'}`} />}
                </div>
              )
            })}
          </div>
          {status === 'waiting_parts' && (
            <p className="mt-3 text-center text-xs text-orange-400">⏳ في انتظار وصول قطع الغيار</p>
          )}
        </div>
      )}

      {/* ── أزرار تغيير الحالة ── */}
      {status !== 'cancelled' && status !== 'delivered' && (
        <div className="flex flex-wrap gap-3 print:hidden">
          {nextStatus && (
            <button onClick={advanceStatus} disabled={advancing}
              className="rounded-xl bg-sky-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50">
              {advancing ? '...' : STATUS_NEXT_LABEL[status]}
            </button>
          )}
          {status === 'in_repair' && (
            <button onClick={setWaitingParts} disabled={advancing}
              className="rounded-xl border border-orange-500/30 bg-orange-500/10 px-5 py-2.5 text-sm text-orange-300 hover:bg-orange-500/20 disabled:opacity-50">
              ⏳ انتظار قطع غيار
            </button>
          )}
          <button onClick={cancelJob}
            className="rounded-xl border border-red-500/20 px-5 py-2.5 text-sm text-red-400 hover:bg-red-500/10">
            إلغاء الطلب
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">

        {/* ── العمود الأيسر ── */}
        <div className="space-y-5 lg:col-span-1">

          {/* معلومات الجهاز */}
          <div className="rounded-2xl border border-white/5 bg-slate-900 p-5">
            <h2 className="mb-4 text-sm font-semibold text-white">معلومات الجهاز</h2>
            <div className="flex items-start gap-3 mb-4">
              <span className="text-3xl">{DEVICE_ICONS[job.device_type] ?? '🔧'}</span>
              <div>
                <p className="font-semibold text-white">{[job.brand, job.model].filter(Boolean).join(' ') || 'غير محدد'}</p>
                {job.color && <p className="text-xs text-slate-400">{job.color}</p>}
                {job.serial_number && <p className="text-xs text-slate-500 font-mono" dir="ltr">S/N: {job.serial_number}</p>}
              </div>
            </div>
            {job.condition_notes && (
              <div className="rounded-xl bg-white/3 p-3">
                <p className="text-xs text-slate-500 mb-1">حالة الاستلام</p>
                <p className="text-sm text-slate-300">{job.condition_notes}</p>
              </div>
            )}
          </div>

          {/* الزبون + QR + إشعارات */}
          <div className="rounded-2xl border border-white/5 bg-slate-900 p-5 print:hidden">
            <h2 className="mb-3 text-sm font-semibold text-white">الزبون</h2>
            <p className="font-medium text-white">{job.customer_name}</p>
            {job.customer_phone && (
              <a href={`https://wa.me/${cleanPhone}`} target="_blank" rel="noopener noreferrer"
                className="mt-1 flex items-center gap-1.5 text-sm text-green-400 hover:text-green-300" dir="ltr">
                <span>💬</span> {job.customer_phone}
              </a>
            )}

            {/* QR + إشعارات */}
            <div className="mt-4 pt-4 border-t border-white/5">
              <p className="mb-3 text-xs text-slate-500">رابط التتبع وإشعارات الزبون</p>
              <div className="flex gap-3 items-start">
                {qrUrl ? (
                  <a href={trackingUrl} target="_blank" rel="noopener noreferrer" title="فتح صفحة التتبع" className="shrink-0">
                    <div className="rounded-xl border border-white/10 p-1.5 bg-white">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={qrUrl} alt="QR تتبع الجهاز" width={88} height={88} />
                    </div>
                  </a>
                ) : (
                  <div className="shrink-0 h-[104px] w-[104px] rounded-xl border border-white/5 bg-white/3 flex items-center justify-center">
                    <span className="text-xs text-slate-600">QR</span>
                  </div>
                )}
                <div className="flex-1 space-y-1.5 min-w-0">
                  {cleanPhone && (
                    <a href={`https://wa.me/${cleanPhone}?text=${encodeURIComponent(notificationMsg)}`}
                      target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-2 rounded-lg border border-green-500/20 bg-green-500/10 px-3 py-2 text-xs text-green-300 hover:bg-green-500/20 transition-colors">
                      💬 إرسال عبر واتساب
                    </a>
                  )}
                  <a href={`https://t.me/share/url?url=${encodeURIComponent(trackingUrl)}&text=${encodeURIComponent(notificationMsg)}`}
                    target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-2 rounded-lg border border-blue-500/20 bg-blue-500/10 px-3 py-2 text-xs text-blue-300 hover:bg-blue-500/20 transition-colors">
                    ✈️ مشاركة عبر تيليغرام
                  </a>
                  <button onClick={copySmsText}
                    className="flex w-full items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-400 hover:bg-white/10 transition-colors">
                    {smsCopied ? '✓ تم النسخ' : '📋 نسخ رسالة SMS'}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* وصف العطل */}
          <div className="rounded-2xl border border-white/5 bg-slate-900 p-5">
            <h2 className="mb-2 text-sm font-semibold text-white">وصف العطل</h2>
            <p className="text-sm text-slate-300 leading-relaxed">{job.problem_desc}</p>
          </div>

          {/* سجل التحديثات — timestamps بارزة */}
          <div className="rounded-2xl border border-white/5 bg-slate-900 p-5 print:hidden">
            <h2 className="mb-4 text-sm font-semibold text-white">سجل التحديثات</h2>
            {history.length === 0 ? (
              <p className="text-xs text-slate-600 text-center py-2">لا يوجد سجل بعد</p>
            ) : (
              <div className="space-y-0">
                {history.map((h, i) => {
                  const meta    = STATUS_META[h.to_status]
                  const date    = new Date(h.changed_at)
                  const timeStr = date.toLocaleTimeString('ar', { hour: '2-digit', minute: '2-digit', hour12: false })
                  const dateStr = date.toLocaleDateString('ar', { month: 'short', day: 'numeric' })
                  return (
                    <div key={h.id} className="flex gap-3">
                      {/* Timestamp column */}
                      <div className="flex w-14 shrink-0 flex-col items-end">
                        <span className="font-mono text-sm font-bold text-sky-400 leading-tight" dir="ltr">{timeStr}</span>
                        <span className="text-[10px] text-slate-600">{dateStr}</span>
                        {i < history.length - 1 && (
                          <div className="my-1 flex-1 w-px bg-white/5 self-center min-h-[16px]" />
                        )}
                      </div>
                      {/* Content */}
                      <div className="flex items-start gap-2 pb-4 flex-1">
                        <div className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs ${meta?.cls ?? 'bg-white/5 text-white'}`}>
                          {meta?.icon ?? '•'}
                        </div>
                        <div>
                          <p className="text-xs font-medium text-slate-300">{meta?.label ?? h.to_status}</p>
                          {h.note && <p className="text-xs text-slate-500 mt-0.5">{h.note}</p>}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* ── العمود الأيمن ── */}
        <div className="space-y-5 lg:col-span-2">

          {/* التشخيص والعمل */}
          <div className="rounded-2xl border border-white/5 bg-slate-900 p-5 print:hidden">
            <h2 className="mb-4 text-sm font-semibold text-white">التشخيص والعمل المنجز</h2>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs text-slate-400">تشخيص الفني</label>
                <textarea value={diagnosis} onChange={e => setDiagnosis(e.target.value)}
                  rows={2} placeholder="نتيجة التشخيص..."
                  className="w-full resize-none rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-slate-600 outline-none focus:border-sky-500/50" />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-400">العمل المنجز</label>
                <textarea value={workDone} onChange={e => setWorkDone(e.target.value)}
                  rows={2} placeholder="ما تم إصلاحه أو استبداله..."
                  className="w-full resize-none rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-slate-600 outline-none focus:border-sky-500/50" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs text-slate-400">الفني المسؤول</label>
                  <input value={assignedTo} onChange={e => setAssignedTo(e.target.value)}
                    placeholder="اسم الفني"
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white outline-none focus:border-sky-500/50" />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-400">الموعد المتوقع</label>
                  <input type="date" value={estimatedDone} onChange={e => setEstimatedDone(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white outline-none focus:border-sky-500/50" />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-400">أولوية</label>
                <select value={priority} onChange={e => setPriority(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white outline-none focus:border-sky-500/50">
                  <option value="normal">عادي</option>
                  <option value="urgent">عاجل</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-400">ملاحظات داخلية</label>
                <textarea value={internalNotes} onChange={e => setInternalNotes(e.target.value)}
                  rows={1} placeholder="ملاحظات للفريق..."
                  className="w-full resize-none rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-slate-600 outline-none focus:border-sky-500/50" />
              </div>
            </div>
          </div>

          {/* قطع الغيار */}
          <div className="rounded-2xl border border-white/5 bg-slate-900 p-5 print:hidden">
            <h2 className="mb-4 text-sm font-semibold text-white">قطع الغيار المستخدمة</h2>
            {parts.length > 0 && (
              <div className="mb-4 overflow-x-auto rounded-xl border border-white/5">
                <table className="min-w-[680px] w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/5 bg-white/3">
                      <th className="px-3 py-2 text-right text-xs text-slate-400">القطعة</th>
                      <th className="px-3 py-2 text-center text-xs text-slate-400 w-16">الكمية</th>
                      <th className="px-3 py-2 text-left text-xs text-slate-400 w-24">التكلفة</th>
                      <th className="w-8" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {parts.map(p => (
                      <tr key={p.id}>
                        <td className="px-3 py-2 text-sm text-white">{p.name}</td>
                        <td className="px-3 py-2 text-center text-xs text-slate-400">{p.quantity}</td>
                        <td className="px-3 py-2 text-left text-sm font-medium text-white" dir="ltr">{fmt(p.total)} {currencyCode}</td>
                        <td className="px-3 py-2">
                          <button onClick={() => removePart(p.id)} className="text-slate-600 hover:text-red-400 text-xs">✕</button>
                        </td>
                      </tr>
                    ))}
                    <tr className="bg-white/3">
                      <td colSpan={2} className="px-3 py-2 text-xs text-slate-400 text-left">إجمالي القطع</td>
                      <td className="px-3 py-2 text-left text-sm font-bold text-white" dir="ltr">{fmt(partsTotal)} {currencyCode}</td>
                      <td />
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
            <div className="space-y-2">
              <div className="relative">
                <input value={partSearch} onChange={e => { setPartSearch(e.target.value); searchParts(e.target.value) }}
                  placeholder="🔍 ابحث في المخزون لإضافة قطعة..."
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-sky-500/50" />
                {partResults.length > 0 && (
                  <div className="absolute top-full mt-1 z-10 w-full rounded-xl border border-white/10 bg-slate-800 shadow-xl overflow-hidden">
                    {partResults.map(p => (
                      <button key={p.id} type="button" onClick={() => fillPartFromProduct(p)}
                        className="flex w-full items-center justify-between px-4 py-3 hover:bg-white/5 text-right">
                        <span className="text-sm text-white">{p.name}</span>
                        <span className="text-sm text-sky-400" dir="ltr">{p.price} {currencyCode}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                <input value={newPartName} onChange={e => setNewPartName(e.target.value)}
                  placeholder="اسم القطعة *"
                  className="flex-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-sky-500/50" />
                <input type="number" min="1" step="1" value={newPartQty} onChange={e => setNewPartQty(e.target.value)}
                  placeholder="كمية" dir="ltr"
                  className="w-16 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-sky-500/50" />
                <input type="number" min="0" step="0.01" value={newPartCost} onChange={e => setNewPartCost(e.target.value)}
                  placeholder="سعر" dir="ltr"
                  className="w-24 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-sky-500/50" />
                <button type="button" onClick={addPart} disabled={savingPart || !newPartName.trim()}
                  className="rounded-xl bg-white/10 px-3 py-2 text-sm text-white hover:bg-white/15 disabled:opacity-40">+</button>
              </div>
            </div>
          </div>

          {/* صور الجهاز */}
          <div className="rounded-2xl border border-white/5 bg-slate-900 p-5 print:hidden">
            <h2 className="mb-4 text-sm font-semibold text-white">صور الجهاز</h2>
            {photos.length > 0 && (
              <div className="mb-4 grid grid-cols-3 gap-2">
                {photos.map((photo, i) => (
                  <div key={i} className="relative aspect-square overflow-hidden rounded-xl border border-white/10">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={photo.url} alt={PHOTO_STAGE_LABEL[photo.stage] ?? photo.stage}
                      className="h-full w-full object-cover" />
                    <div className="absolute inset-x-0 bottom-0 bg-black/60 px-2 py-1">
                      <p className="text-[10px] text-white leading-tight">{PHOTO_STAGE_LABEL[photo.stage] ?? photo.stage}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {photos.length === 0 && (
              <p className="mb-4 text-center text-sm text-slate-600 py-2">لا يوجد صور بعد</p>
            )}
            <div className="flex items-center gap-2">
              <select value={photoStage} onChange={e => setPhotoStage(e.target.value)}
                className="flex-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-sky-500/50">
                {PHOTO_STAGES.map(s => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
              <label className={`flex cursor-pointer items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white transition-colors hover:bg-white/10 ${uploadingPhoto ? 'opacity-50 cursor-not-allowed' : ''}`}>
                {uploadingPhoto ? '⏳ جاري الرفع...' : '📷 التقاط صورة'}
                <input type="file" accept="image/*" capture="environment" className="hidden"
                  onChange={handlePhotoCapture} disabled={uploadingPhoto} />
              </label>
            </div>
          </div>

          {/* الملخص المالي */}
          <div className="rounded-2xl border border-white/5 bg-slate-900 p-5">
            <h2 className="mb-4 text-sm font-semibold text-white">الملخص المالي</h2>
            <div className="space-y-3 print:hidden">
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="mb-1 block text-xs text-slate-400">تكلفة تقديرية</label>
                  <input type="number" min="0" step="0.01" value={estimatedCost} onChange={e => setEstimatedCost(e.target.value)}
                    dir="ltr" className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-sky-500/50" />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-400">التكلفة النهائية</label>
                  <input type="number" min="0" step="0.01" value={finalCost} onChange={e => setFinalCost(e.target.value)}
                    dir="ltr" className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-sky-500/50" />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-400">العربون المستلم</label>
                  <input type="number" min="0" step="0.01" value={depositPaid} onChange={e => setDepositPaid(e.target.value)}
                    dir="ltr" className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-sky-500/50" />
                </div>
              </div>
            </div>
            <div className="mt-4 space-y-2 border-t border-white/5 pt-4">
              {partsTotal > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">تكلفة القطع</span>
                  <span className="text-white" dir="ltr">{fmt(partsTotal)} {currencyCode}</span>
                </div>
              )}
              {finalCostNum > 0 && (
                <div className="flex justify-between text-base font-bold">
                  <span className="text-white">إجمالي الإصلاح</span>
                  <span className="text-emerald-400" dir="ltr">{fmt(finalCostNum)} {currencyCode}</span>
                </div>
              )}
              {depositNum > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">عربون مدفوع</span>
                  <span className="text-slate-300" dir="ltr">− {fmt(depositNum)} {currencyCode}</span>
                </div>
              )}
              {finalCostNum > 0 && (
                <div className={`flex justify-between border-t border-white/5 pt-2 text-sm font-semibold ${balance > 0 ? 'text-yellow-400' : 'text-emerald-400'}`}>
                  <span>{balance > 0 ? 'المبلغ المتبقي' : 'مكتمل الدفع'}</span>
                  <span dir="ltr">{fmt(Math.max(0, balance))} {currencyCode}</span>
                </div>
              )}
            </div>
          </div>

          {/* زر الحفظ */}
          <div className="flex justify-end print:hidden">
            <button onClick={saveWorkFields} disabled={saving}
              className="rounded-xl bg-sky-600 px-8 py-3 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50">
              {saving ? 'جاري الحفظ...' : '💾 حفظ التعديلات'}
            </button>
          </div>
        </div>
      </div>

      {/* ── وصل الاستلام للطباعة ── */}
      <div className="hidden print:block">
        <div className="border-2 border-black p-6 rounded">
          <div className="flex justify-between items-start mb-4">
            <div>
              <h1 className="text-2xl font-bold">{storeName} — وصل استلام جهاز</h1>
              <p className="text-lg font-mono mt-1">{job.job_number}</p>
            </div>
            <div className="text-left text-sm">
              <p>تاريخ الاستلام: {new Date(job.received_at).toLocaleDateString('ar')}</p>
              {job.estimated_done && <p>الموعد المتوقع: {new Date(job.estimated_done).toLocaleDateString('ar')}</p>}
            </div>
          </div>
          <hr className="border-black mb-4" />
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <p className="font-bold mb-1">معلومات الزبون</p>
              <p>{job.customer_name}</p>
              {job.customer_phone && <p dir="ltr">{job.customer_phone}</p>}
            </div>
            <div>
              <p className="font-bold mb-1">الجهاز</p>
              <p>{[job.brand, job.model].filter(Boolean).join(' ') || job.device_type}</p>
              {job.color && <p>اللون: {job.color}</p>}
              {job.serial_number && <p dir="ltr">S/N: {job.serial_number}</p>}
            </div>
          </div>
          {job.condition_notes && (
            <div className="mb-4 p-3 border border-gray-300 rounded">
              <p className="font-bold mb-1">حالة الجهاز عند الاستلام</p>
              <p className="text-sm">{job.condition_notes}</p>
            </div>
          )}
          <div className="mb-4 p-3 border border-gray-300 rounded">
            <p className="font-bold mb-1">وصف العطل</p>
            <p className="text-sm">{job.problem_desc}</p>
          </div>
          {job.estimated_cost && (
            <p className="mb-4 font-semibold">التكلفة التقديرية: {job.estimated_cost.toLocaleString()} {currencyCode}</p>
          )}
          <div className="grid grid-cols-2 gap-8 mt-8">
            <div className="text-center">
              <div className="border-t border-black pt-2 mt-8">توقيع الزبون</div>
            </div>
            <div className="text-center">
              <div className="border-t border-black pt-2 mt-8">توقيع المستلم</div>
            </div>
          </div>
        </div>
      </div>

    </div>
  )
}
