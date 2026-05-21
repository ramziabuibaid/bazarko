import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import RepairKanban from '@/components/dashboard/maintenance/RepairKanban'

export default async function MaintenancePage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: store } = await supabase
    .from('stores')
    .select('id, currency_code')
    .eq('owner_id', user.id)
    .single()
  if (!store) redirect('/onboarding')

  // الطلبيات النشطة (غير مسلّمة وغير ملغاة)
  const { data: activeJobs } = await supabase
    .from('repair_jobs')
    .select('id, job_number, customer_name, customer_phone, device_type, brand, model, status, priority, received_at, estimated_done, assigned_to, estimated_cost, final_cost')
    .eq('store_id', store.id)
    .not('status', 'in', '("delivered","cancelled")')
    .order('priority', { ascending: false })  // urgent أولاً
    .order('received_at', { ascending: true }) // الأقدم أولاً

  // إحصاء المسلّمة هذا الشهر
  const monthStart = new Date()
  monthStart.setDate(1)
  const { count: deliveredCount } = await supabase
    .from('repair_jobs')
    .select('*', { count: 'exact', head: true })
    .eq('store_id', store.id)
    .eq('status', 'delivered')
    .gte('delivered_at', monthStart.toISOString().slice(0, 10))

  // إيرادات الصيانة هذا الشهر
  const { data: monthRevenue } = await supabase
    .from('repair_jobs')
    .select('final_cost')
    .eq('store_id', store.id)
    .eq('status', 'delivered')
    .gte('delivered_at', monthStart.toISOString().slice(0, 10))

  const revenue = (monthRevenue ?? []).reduce((s: number, j: { final_cost: number | null }) => s + (j.final_cost ?? 0), 0)
  const fmt = (n: number) => n.toLocaleString('ar-SA', { maximumFractionDigits: 0 })

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-white">لوحة الصيانة</h1>
          <p className="text-sm text-slate-400">{(activeJobs ?? []).length} طلب نشط حالياً</p>
        </div>
        <Link href="/dashboard/maintenance/new"
          className="rounded-xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sky-500">
          ➕ استلام جهاز جديد
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {[
          { label: 'طلبات نشطة',       value: (activeJobs ?? []).length,                                    cls: 'text-white' },
          { label: 'عاجل',              value: (activeJobs ?? []).filter((j: { priority: string }) => j.priority === 'urgent').length, cls: 'text-red-400' },
          { label: 'سُلِّم هذا الشهر', value: deliveredCount ?? 0,                                           cls: 'text-emerald-400' },
          { label: 'إيرادات الشهر',     value: `${fmt(revenue)} ${store.currency_code}`,                     cls: 'text-sky-400', isText: true },
        ].map(s => (
          <div key={s.label} className="rounded-2xl border border-white/5 bg-slate-900 p-4 text-center">
            <p className="text-xs text-slate-500 mb-1">{s.label}</p>
            <p className={`text-2xl font-bold ${s.cls}`} dir={s.isText ? 'ltr' : undefined}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Kanban Board */}
      <RepairKanban jobs={activeJobs ?? []} currencyCode={store.currency_code} />
    </div>
  )
}
