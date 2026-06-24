import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import RepairKanban from '@/components/dashboard/maintenance/RepairKanban'

const DEVICE_ICONS: Record<string, string> = {
  phone: '📱', laptop: '💻', tablet: '📟', tv: '📺',
  printer: '🖨️', camera: '📷', appliance: '🔌', other: '🔧',
}

const STATUS_LABELS: Record<string, string> = {
  received: 'استُلم', diagnosing: 'التشخيص', in_repair: 'قيد الإصلاح',
  waiting_parts: 'انتظار قطع', ready: 'جاهز', delivered: 'سُلِّم', cancelled: 'ملغي',
}

export default async function MaintenancePage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const storeId = await getStoreForUser(supabase, user!.id)
  if (!storeId) redirect('/onboarding')

  const { data: store } = await supabase
    .from('stores')
    .select('id, currency_code')
    .eq('id', storeId)
    .single()
  if (!store) redirect('/onboarding')

  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

  const [
    activeJobsRes,
    deliveredCountRes,
    monthRevenueRes,
    recentReceivedRes,
  ] = await Promise.all([
    // الطلبيات النشطة (غير مسلّمة وغير ملغاة)
    supabase
      .from('repair_jobs')
      .select('id, job_number, customer_name, customer_phone, device_type, brand, model, status, priority, received_at, estimated_done, assigned_to, estimated_cost, final_cost')
      .eq('store_id', store.id)
      .not('status', 'in', '("delivered","cancelled")')
      .order('priority', { ascending: false })
      .order('received_at', { ascending: true }),

    // المسلّمة هذا الشهر
    supabase
      .from('repair_jobs')
      .select('*', { count: 'exact', head: true })
      .eq('store_id', store.id)
      .eq('status', 'delivered')
      .gte('delivered_at', monthStart.toISOString().slice(0, 10)),

    // إيرادات الشهر
    supabase
      .from('repair_jobs')
      .select('final_cost')
      .eq('store_id', store.id)
      .eq('status', 'delivered')
      .gte('delivered_at', monthStart.toISOString().slice(0, 10)),

    // آخر 5 أجهزة تم استقبالها
    supabase
      .from('repair_jobs')
      .select('id, job_number, customer_name, device_type, brand, model, status, received_at, priority')
      .eq('store_id', store.id)
      .order('received_at', { ascending: false })
      .limit(5),
  ])

  const activeJobs     = activeJobsRes.data ?? []
  const revenue        = (monthRevenueRes.data ?? []).reduce((s: number, j: { final_cost: number | null }) => s + (j.final_cost ?? 0), 0)
  const recentReceived = recentReceivedRes.data ?? []
  const fmt = (n: number) => n.toLocaleString('ar-u-nu-latn', { maximumFractionDigits: 0 })

  // الأجهزة المتأخرة عن موعد التسليم
  const overdueJobs = activeJobs.filter(j => j.estimated_done && new Date(j.estimated_done) < now)

  return (
    <div className="p-4 sm:p-6 space-y-6">

      {/* ── Header ── */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-white">لوحة الصيانة</h1>
          <p className="text-sm text-slate-400">{activeJobs.length} طلب نشط حالياً</p>
        </div>
        <Link href="/dashboard/maintenance/new"
          className="rounded-xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sky-500">
          ➕ استلام جهاز جديد
        </Link>
      </div>

      {/* ── Stats ── */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {[
          { label: 'طلبات نشطة',       value: activeJobs.length,                                                              cls: 'text-white' },
          { label: 'عاجل',              value: activeJobs.filter((j: { priority: string }) => j.priority === 'urgent').length, cls: 'text-red-400' },
          { label: 'سُلِّم هذا الشهر', value: deliveredCountRes.count ?? 0,                                                   cls: 'text-emerald-400' },
          { label: 'إيرادات الشهر',     value: `${fmt(revenue)} ${store.currency_code}`,                                      cls: 'text-sky-400', isText: true },
        ].map(s => (
          <div key={s.label} className="rounded-2xl border border-white/5 bg-slate-900 p-4 text-center">
            <p className="text-xs text-slate-500 mb-1">{s.label}</p>
            <p className={`text-2xl font-bold ${s.cls}`} dir={s.isText ? 'ltr' : undefined}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* ── تنبيه الأجهزة المتأخرة ── */}
      {overdueJobs.length > 0 && (
        <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-5">
          <div className="mb-3 flex items-center gap-2">
            <span className="text-lg">⚠️</span>
            <h2 className="text-sm font-semibold text-red-300">
              {overdueJobs.length} {overdueJobs.length === 1 ? 'جهاز متأخر' : 'أجهزة متأخرة'} عن موعد التسليم
            </h2>
          </div>
          <div className="space-y-2">
            {overdueJobs.map(job => {
              const daysLate = Math.floor((now.getTime() - new Date(job.estimated_done!).getTime()) / 86_400_000)
              return (
                <Link key={job.id} href={`/dashboard/maintenance/${job.id}`}
                  className="flex items-center gap-3 rounded-xl border border-red-500/10 bg-red-500/5 px-4 py-3 hover:bg-red-500/10 transition-colors">
                  <span className="text-xl">{DEVICE_ICONS[job.device_type] ?? '🔧'}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-white">
                      {[job.brand, job.model].filter(Boolean).join(' ') || job.device_type}
                    </p>
                    <p className="text-xs text-slate-400">{job.customer_name}</p>
                  </div>
                  <div className="text-left flex-shrink-0">
                    <p className="text-xs font-mono text-slate-400" dir="ltr">{job.job_number}</p>
                    <p className="text-xs text-red-400">{daysLate === 0 ? 'اليوم' : `متأخر ${daysLate} يوم`}</p>
                  </div>
                </Link>
              )
            })}
          </div>
        </div>
      )}

      {/* ── آخر 5 أجهزة مستقبَلة ── */}
      <div className="rounded-2xl border border-white/5 bg-slate-900 p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">آخر الأجهزة المستقبَلة</h2>
          <span className="text-xs text-slate-500">آخر 5 أجهزة</span>
        </div>
        {recentReceived.length === 0 ? (
          <p className="text-center text-sm text-slate-500 py-4">لا يوجد أجهزة بعد</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-white/5">
            <table className="min-w-[680px] w-full">
              <thead>
                <tr className="border-b border-white/5 bg-white/3">
                  <th className="px-4 py-2.5 text-right text-xs text-slate-400">رقم الطلب</th>
                  <th className="px-4 py-2.5 text-right text-xs text-slate-400">الجهاز</th>
                  <th className="px-4 py-2.5 text-right text-xs text-slate-400">الزبون</th>
                  <th className="px-4 py-2.5 text-right text-xs text-slate-400 hidden sm:table-cell">تاريخ الاستلام</th>
                  <th className="px-4 py-2.5 text-right text-xs text-slate-400">الحالة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {recentReceived.map(job => (
                  <tr key={job.id} className="hover:bg-white/3 transition-colors">
                    <td className="px-4 py-3">
                      <Link href={`/dashboard/maintenance/${job.id}`}
                        className="font-mono text-xs text-sky-400 hover:underline" dir="ltr">
                        {job.job_number}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span>{DEVICE_ICONS[job.device_type] ?? '🔧'}</span>
                        <span className="text-sm text-white">
                          {[job.brand, job.model].filter(Boolean).join(' ') || job.device_type}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-300">{job.customer_name}</td>
                    <td className="px-4 py-3 text-xs text-slate-500 hidden sm:table-cell">
                      {new Date(job.received_at).toLocaleDateString('ar-u-nu-latn', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded-full bg-white/5 px-2 py-0.5 text-xs text-slate-300">
                        {STATUS_LABELS[job.status] ?? job.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Kanban Board ── */}
      <RepairKanban jobs={activeJobs} currencyCode={store.currency_code} />
    </div>
  )
}
