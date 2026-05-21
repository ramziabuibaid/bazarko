'use client'

import { useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

interface Customer { id: string; name: string; phone: string | null }

interface Props {
  storeId: string
  userId: string
  currencyCode: string
}

const DEVICE_TYPES = [
  { value: 'phone',     label: 'موبايل',          icon: '📱' },
  { value: 'laptop',    label: 'لابتوب',           icon: '💻' },
  { value: 'tablet',    label: 'تابلت',            icon: '📟' },
  { value: 'tv',        label: 'تلفاز',            icon: '📺' },
  { value: 'printer',   label: 'طابعة',            icon: '🖨️' },
  { value: 'camera',    label: 'كاميرا',           icon: '📷' },
  { value: 'appliance', label: 'جهاز كهربائي',    icon: '🔌' },
  { value: 'other',     label: 'أخرى',             icon: '🔧' },
]

function useDebounce<T extends (...args: Parameters<T>) => void>(fn: T, ms: number) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  return useCallback((...args: Parameters<T>) => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => fn(...args), ms)
  }, [fn, ms])
}

export default function RepairIntakeForm({ storeId, userId, currencyCode }: Props) {
  const router = useRouter()
  const supabase = createClient()

  // ── زبون ──────────────────────────────────────────
  const [customerSearch, setCustomerSearch]     = useState('')
  const [customerResults, setCustomerResults]   = useState<Customer[]>([])
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null)
  const [customerName, setCustomerName]         = useState('')
  const [customerPhone, setCustomerPhone]       = useState('')

  // ── جهاز ──────────────────────────────────────────
  const [deviceType, setDeviceType]         = useState('phone')
  const [brand, setBrand]                   = useState('')
  const [model, setModel]                   = useState('')
  const [color, setColor]                   = useState('')
  const [serialNumber, setSerialNumber]     = useState('')
  const [conditionNotes, setConditionNotes] = useState('')

  // ── العطل والعمل ───────────────────────────────────
  const [problemDesc, setProblemDesc]   = useState('')
  const [priority, setPriority]         = useState<'normal' | 'urgent'>('normal')
  const [assignedTo, setAssignedTo]     = useState('')
  const [estimatedCost, setEstimatedCost] = useState('')
  const [depositPaid, setDepositPaid]   = useState('')
  const [estimatedDone, setEstimatedDone] = useState('')
  const [internalNotes, setInternalNotes] = useState('')

  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')

  const searchCustomers = useDebounce(async (q: string) => {
    if (!q.trim()) { setCustomerResults([]); return }
    const { data } = await supabase
      .from('customers')
      .select('id, name, phone')
      .eq('store_id', storeId)
      .ilike('name', `%${q}%`)
      .limit(6)
    setCustomerResults((data as Customer[] | null) ?? [])
  }, 250)

  function selectCustomer(c: Customer) {
    setSelectedCustomer(c)
    setCustomerName(c.name)
    setCustomerPhone(c.phone ?? '')
    setCustomerSearch('')
    setCustomerResults([])
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const name = (selectedCustomer?.name ?? customerName).trim()
    if (!name) { setError('أدخل اسم الزبون'); return }
    if (!problemDesc.trim()) { setError('أدخل وصف العطل'); return }

    setSaving(true); setError('')

    // رقم الطلب
    const { count } = await supabase
      .from('repair_jobs')
      .select('*', { count: 'exact', head: true })
      .eq('store_id', storeId)
    const jobNumber = `REP-${String((count ?? 0) + 1).padStart(4, '0')}`

    const { data: job, error: jobErr } = await supabase
      .from('repair_jobs')
      .insert({
        store_id:        storeId,
        job_number:      jobNumber,
        customer_id:     selectedCustomer?.id ?? null,
        customer_name:   name,
        customer_phone:  (selectedCustomer?.phone ?? customerPhone).trim() || null,
        device_type:     deviceType,
        brand:           brand.trim() || null,
        model:           model.trim() || null,
        color:           color.trim() || null,
        serial_number:   serialNumber.trim() || null,
        condition_notes: conditionNotes.trim() || null,
        problem_desc:    problemDesc.trim(),
        priority,
        assigned_to:     assignedTo.trim() || null,
        estimated_cost:  estimatedCost ? parseFloat(estimatedCost) : null,
        deposit_paid:    depositPaid   ? parseFloat(depositPaid)   : 0,
        estimated_done:  estimatedDone || null,
        internal_notes:  internalNotes.trim() || null,
        status:          'received',
        created_by:      userId,
      })
      .select('id')
      .single()

    if (jobErr || !job) { setSaving(false); setError('حدث خطأ أثناء الحفظ'); return }

    // سجل الحالة الأولى
    await supabase.from('repair_job_history').insert({
      job_id:     job.id,
      from_status: null,
      to_status:  'received',
      note:       'تم استلام الجهاز',
      changed_by: userId,
    })

    router.push(`/dashboard/maintenance/${job.id}`)
  }

  const selectedDevice = DEVICE_TYPES.find(d => d.value === deviceType)

  return (
    <form onSubmit={handleSubmit} className="space-y-6">

      {/* ── الزبون ── */}
      <div className="rounded-2xl border border-white/5 bg-slate-900 p-5 space-y-4">
        <h2 className="text-sm font-semibold text-white">معلومات الزبون</h2>

        <div className="relative">
          <label className="mb-1 block text-xs text-slate-400">بحث عن زبون موجود</label>
          <input
            value={customerSearch}
            onChange={e => { setCustomerSearch(e.target.value); searchCustomers(e.target.value) }}
            placeholder="ابحث بالاسم..."
            className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-sky-500/50"
          />
          {customerResults.length > 0 && (
            <div className="absolute top-full mt-1 z-20 w-full rounded-xl border border-white/10 bg-slate-800 shadow-xl overflow-hidden">
              {customerResults.map(c => (
                <button key={c.id} type="button" onClick={() => selectCustomer(c)}
                  className="flex w-full items-center gap-3 px-4 py-3 hover:bg-white/5 text-right">
                  <div>
                    <p className="text-sm text-white">{c.name}</p>
                    {c.phone && <p className="text-xs text-slate-500" dir="ltr">{c.phone}</p>}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {selectedCustomer && (
          <div className="flex items-center justify-between rounded-xl border border-sky-500/20 bg-sky-500/5 px-4 py-2.5">
            <div>
              <p className="text-sm font-medium text-sky-300">{selectedCustomer.name}</p>
              {selectedCustomer.phone && <p className="text-xs text-slate-400" dir="ltr">{selectedCustomer.phone}</p>}
            </div>
            <button type="button" onClick={() => { setSelectedCustomer(null); setCustomerName(''); setCustomerPhone('') }}
              className="text-xs text-slate-500 hover:text-red-400">تغيير</button>
          </div>
        )}

        {!selectedCustomer && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-slate-400">الاسم *</label>
              <input value={customerName} onChange={e => setCustomerName(e.target.value)} required
                placeholder="اسم الزبون" className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white outline-none focus:border-sky-500/50" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-400">رقم الهاتف</label>
              <input value={customerPhone} onChange={e => setCustomerPhone(e.target.value)}
                placeholder="+963..." dir="ltr" className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white outline-none focus:border-sky-500/50" />
            </div>
          </div>
        )}
      </div>

      {/* ── الجهاز ── */}
      <div className="rounded-2xl border border-white/5 bg-slate-900 p-5 space-y-4">
        <h2 className="text-sm font-semibold text-white">معلومات الجهاز</h2>

        {/* نوع الجهاز */}
        <div>
          <label className="mb-2 block text-xs text-slate-400">نوع الجهاز *</label>
          <div className="grid grid-cols-4 gap-2">
            {DEVICE_TYPES.map(d => (
              <button key={d.value} type="button" onClick={() => setDeviceType(d.value)}
                className={`flex flex-col items-center gap-1 rounded-xl border py-3 text-xs transition-colors ${
                  deviceType === d.value
                    ? 'border-sky-500/50 bg-sky-500/10 text-sky-300'
                    : 'border-white/5 bg-white/3 text-slate-400 hover:bg-white/5'
                }`}>
                <span className="text-xl">{d.icon}</span>
                {d.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs text-slate-400">الماركة</label>
            <input value={brand} onChange={e => setBrand(e.target.value)}
              placeholder="Samsung، Apple، LG..." className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white outline-none focus:border-sky-500/50" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-400">الموديل</label>
            <input value={model} onChange={e => setModel(e.target.value)}
              placeholder="Galaxy S23, iPhone 14..." className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white outline-none focus:border-sky-500/50" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-400">اللون</label>
            <input value={color} onChange={e => setColor(e.target.value)}
              placeholder="أسود، أبيض..." className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white outline-none focus:border-sky-500/50" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-400">الرقم التسلسلي / IMEI</label>
            <input value={serialNumber} onChange={e => setSerialNumber(e.target.value)}
              dir="ltr" placeholder="S/N or IMEI" className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white outline-none focus:border-sky-500/50" />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs text-slate-400">حالة الجهاز عند الاستلام (خدوش، شقوق...)</label>
          <textarea value={conditionNotes} onChange={e => setConditionNotes(e.target.value)}
            rows={2} placeholder="شاشة مكسورة، خدش على الظهر، لا يوجد شاحن..."
            className="w-full resize-none rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-sky-500/50" />
        </div>
      </div>

      {/* ── العطل ── */}
      <div className="rounded-2xl border border-white/5 bg-slate-900 p-5 space-y-4">
        <h2 className="text-sm font-semibold text-white">وصف العطل والعمل</h2>

        <div>
          <label className="mb-1 block text-xs text-slate-400">وصف العطل (كما يصفه الزبون) *</label>
          <textarea value={problemDesc} onChange={e => setProblemDesc(e.target.value)}
            rows={3} required placeholder="الشاشة لا تعمل، الجهاز لا يشحن، بطيء جداً..."
            className="w-full resize-none rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-sky-500/50" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs text-slate-400">الأولوية</label>
            <div className="flex overflow-hidden rounded-xl border border-white/10">
              {([['normal','عادي'],['urgent','عاجل']] as const).map(([v, l]) => (
                <button key={v} type="button" onClick={() => setPriority(v)}
                  className={`flex-1 py-2.5 text-sm transition-colors ${
                    priority === v
                      ? v === 'urgent' ? 'bg-red-600 text-white' : 'bg-sky-600 text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}>{l}</button>
              ))}
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-400">الفني المسؤول</label>
            <input value={assignedTo} onChange={e => setAssignedTo(e.target.value)}
              placeholder="اسم الفني..." className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white outline-none focus:border-sky-500/50" />
          </div>
        </div>
      </div>

      {/* ── المالية والتواريخ ── */}
      <div className="rounded-2xl border border-white/5 bg-slate-900 p-5 space-y-4">
        <h2 className="text-sm font-semibold text-white">المالية والتواريخ</h2>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs text-slate-400">التكلفة التقديرية ({currencyCode})</label>
            <input type="number" min="0" step="0.01" value={estimatedCost} onChange={e => setEstimatedCost(e.target.value)}
              placeholder="0.00" dir="ltr" className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white outline-none focus:border-sky-500/50" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-400">العربون المستلم ({currencyCode})</label>
            <input type="number" min="0" step="0.01" value={depositPaid} onChange={e => setDepositPaid(e.target.value)}
              placeholder="0.00" dir="ltr" className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white outline-none focus:border-sky-500/50" />
          </div>
          <div className="col-span-2">
            <label className="mb-1 block text-xs text-slate-400">الموعد المتوقع للانتهاء</label>
            <input type="date" value={estimatedDone} onChange={e => setEstimatedDone(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white outline-none focus:border-sky-500/50" />
          </div>
        </div>
      </div>

      {/* ── ملاحظات داخلية ── */}
      <div className="rounded-2xl border border-white/5 bg-slate-900 p-5">
        <label className="mb-2 block text-xs text-slate-400">ملاحظات داخلية (لا تظهر للزبون)</label>
        <textarea value={internalNotes} onChange={e => setInternalNotes(e.target.value)}
          rows={2} placeholder="ملاحظات للفريق الداخلي..."
          className="w-full resize-none rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-sky-500/50" />
      </div>

      {error && <p className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</p>}

      <div className="flex gap-3">
        <button type="button" onClick={() => router.back()}
          className="flex-1 rounded-xl border border-white/10 py-3 text-sm text-slate-400 hover:text-white">
          إلغاء
        </button>
        <button type="submit" disabled={saving}
          className="flex-[2] rounded-xl bg-sky-600 py-3 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50">
          {saving ? 'جاري الحفظ...' : `✓ استلام ${selectedDevice?.icon ?? '🔧'} وإنشاء وصل`}
        </button>
      </div>
    </form>
  )
}
