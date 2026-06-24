import { createAdminClient } from '@/lib/supabase/admin'
import Link from 'next/link'

export default async function AdminOverviewPage() {
  const supabase = createAdminClient()

  const monthStart = new Date()
  monthStart.setDate(1)
  const monthStr = monthStart.toISOString().slice(0, 10)

  const [
    { count: totalStores },
    { count: activeStores },
    { count: newStoresThisMonth },
    { count: totalOrders },
    { count: ordersThisMonth },
    { data: gmvData },
    { data: recentStores },
    { count: totalRepairJobs },
  ] = await Promise.all([
    supabase.from('stores').select('*', { count: 'exact', head: true }),
    supabase.from('stores').select('*', { count: 'exact', head: true }).eq('is_active', true),
    supabase.from('stores').select('*', { count: 'exact', head: true }).gte('created_at', monthStr),
    supabase.from('orders').select('*', { count: 'exact', head: true }),
    supabase.from('orders').select('*', { count: 'exact', head: true }).gte('created_at', monthStr),
    supabase.from('orders').select('total_amount').eq('payment_status', 'paid'),
    supabase.from('stores')
      .select('id, name, subdomain, country_code, plan, is_active, created_at')
      .order('created_at', { ascending: false })
      .limit(8),
    supabase.from('repair_jobs').select('*', { count: 'exact', head: true }),
  ])

  const gmv = (gmvData ?? []).reduce((s: number, o: { total_amount: number | null }) => s + (o.total_amount ?? 0), 0)
  const fmt = (n: number) => n.toLocaleString('ar-u-nu-latn', { maximumFractionDigits: 0 })

  const PLAN_COLORS: Record<string, string> = {
    free:  'text-slate-400 bg-slate-400/10 border-slate-400/20',
    basic: 'text-sky-400 bg-sky-400/10 border-sky-400/20',
    pro:   'text-purple-400 bg-purple-400/10 border-purple-400/20',
  }
  const PLAN_LABELS: Record<string, string> = { free: 'مجاني', basic: 'أساسي', pro: 'احترافي' }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold text-white">نظرة عامة على المنصة</h1>
        <p className="text-sm text-slate-400 mt-0.5">إحصائيات Bazarko الكاملة</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {[
          { label: 'إجمالي المتاجر',      value: totalStores ?? 0,        sub: `${activeStores ?? 0} نشط`,           cls: 'text-white' },
          { label: 'متاجر جديدة (الشهر)', value: newStoresThisMonth ?? 0, sub: 'هذا الشهر',                           cls: 'text-emerald-400' },
          { label: 'إجمالي الطلبيات',     value: totalOrders ?? 0,        sub: `${ordersThisMonth ?? 0} هذا الشهر`,   cls: 'text-sky-400' },
          { label: 'GMV المدفوع',          value: `${fmt(gmv)} `,          sub: 'إجمالي المبيعات',                     cls: 'text-yellow-400', isText: true },
        ].map(s => (
          <div key={s.label} className="rounded-2xl border border-white/5 bg-slate-900 p-4 text-center">
            <p className="text-xs text-slate-500 mb-1">{s.label}</p>
            <p className={`text-2xl font-bold ${s.cls}`} dir={s.isText ? 'ltr' : undefined}>{s.value}</p>
            <p className="text-xs text-slate-600 mt-1">{s.sub}</p>
          </div>
        ))}
      </div>

      {/* Second row */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
        {[
          { label: 'طلبات صيانة',  value: totalRepairJobs ?? 0, cls: 'text-orange-400' },
          { label: 'معدل التحويل', value: totalOrders && totalStores ? `${Math.round((totalOrders ?? 0) / Math.max(totalStores ?? 1, 1))}` : '—', sub: 'طلبية / متجر', cls: 'text-purple-400' },
          { label: 'المتاجر المعلّقة', value: (totalStores ?? 0) - (activeStores ?? 0), cls: 'text-red-400' },
        ].map(s => (
          <div key={s.label} className="rounded-2xl border border-white/5 bg-slate-900 p-4 text-center">
            <p className="text-xs text-slate-500 mb-1">{s.label}</p>
            <p className={`text-2xl font-bold ${s.cls}`}>{s.value}</p>
            {'sub' in s && <p className="text-xs text-slate-600 mt-1">{s.sub}</p>}
          </div>
        ))}
      </div>

      {/* Recent Stores */}
      <div className="rounded-2xl border border-white/5 bg-slate-900">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
          <h2 className="text-sm font-semibold text-white">آخر المتاجر المنضمة</h2>
          <Link href="/admin/stores" className="text-xs text-sky-400 hover:text-sky-300">عرض الكل ←</Link>
        </div>
        <div className="divide-y divide-white/5">
          {(recentStores ?? []).map((store: {
            id: string; name: string; subdomain: string; country_code: string;
            plan: string; is_active: boolean; created_at: string
          }) => (
            <Link key={store.id} href={`/admin/stores/${store.id}`}
              className="flex items-center justify-between px-5 py-3 hover:bg-white/3 transition-colors">
              <div className="flex items-center gap-3">
                <div className={`h-2 w-2 rounded-full ${store.is_active ? 'bg-emerald-500' : 'bg-red-500'}`} />
                <div>
                  <p className="text-sm font-medium text-white">{store.name}</p>
                  <p className="text-xs text-slate-500" dir="ltr">{store.subdomain}.bazarko.app · {store.country_code}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${PLAN_COLORS[store.plan] ?? PLAN_COLORS.free}`}>
                  {PLAN_LABELS[store.plan] ?? store.plan}
                </span>
                <span className="text-xs text-slate-600">
                  {new Date(store.created_at).toLocaleDateString('ar-u-nu-latn', { month: 'short', day: 'numeric' })}
                </span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
