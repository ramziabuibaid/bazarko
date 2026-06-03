import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getStoreForUser } from '@/lib/supabase/getStore'

export default async function DashboardPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const storeId = await getStoreForUser(supabase, user.id)
  if (!storeId) redirect('/onboarding')

  const { data: store } = await supabase
    .from('stores')
    .select('id, currency_code, is_active, suspended_at')
    .eq('id', storeId)
    .single()
  if (!store) redirect('/onboarding')

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const todayStr = today.toISOString()

  const [
    ordersRes, customersRes, productsRes, revenueRes,
    todayOrdersRes, todayRevenueRes,
  ] = await Promise.all([
    supabase.from('orders').select('id', { count: 'exact', head: true }).eq('store_id', storeId),
    supabase.from('customers').select('id', { count: 'exact', head: true }).eq('store_id', storeId),
    supabase.from('products').select('id', { count: 'exact', head: true }).eq('store_id', storeId).eq('is_active', true),
    supabase.from('orders').select('total_amount').eq('store_id', storeId).eq('payment_status', 'paid'),
    supabase.from('orders').select('id', { count: 'exact', head: true }).eq('store_id', storeId).gte('created_at', todayStr),
    supabase.from('orders').select('total_amount').eq('store_id', storeId).eq('payment_status', 'paid').gte('created_at', todayStr),
  ])

  const totalRevenue = (revenueRes.data ?? []).reduce((s: number, o: { total_amount: number | null }) => s + (o.total_amount ?? 0), 0)
  const todayRevenue = (todayRevenueRes.data ?? []).reduce((s: number, o: { total_amount: number | null }) => s + (o.total_amount ?? 0), 0)
  const todayOrders  = todayOrdersRes.count ?? 0
  const isActive     = store.is_active !== false

  return (
    <div className="space-y-8 p-6">

      {/* رأس الصفحة */}
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold text-white">نظرة عامة</h1>
          <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${
            isActive
              ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-400'
              : 'border-red-500/25 bg-red-500/10 text-red-400'
          }`}>
            <span className={`h-1.5 w-1.5 rounded-full ${isActive ? 'bg-emerald-400' : 'bg-red-400'}`} />
            {isActive ? 'المتجر نشط' : 'المتجر متوقف'}
          </span>
        </div>
        <p className="mt-1.5 text-sm text-slate-400">
          {new Date().toLocaleDateString('ar', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
        </p>
        {!isActive && store.suspended_at && (
          <p className="mt-2 text-xs text-red-400/80">
            متوقف منذ {new Date(store.suspended_at).toLocaleDateString('ar')}
          </p>
        )}
      </div>

      {/* إحصائيات اليوم */}
      <section>
        <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-slate-500">اليوم</h2>
        <div className="grid grid-cols-2 gap-4">
          <div className="rounded-2xl border border-white/5 bg-slate-900 p-5">
            <p className="text-xs font-medium text-slate-300">طلبيات اليوم</p>
            <p className="mt-2 text-3xl font-bold text-sky-400">{todayOrders}</p>
            <p className="mt-1 text-xs text-slate-500">
              {todayOrders === 0 ? 'لا طلبيات حتى الآن' : todayOrders === 1 ? 'طلبية واحدة' : `${todayOrders} طلبيات`}
            </p>
          </div>
          <div className="rounded-2xl border border-white/5 bg-slate-900 p-5">
            <p className="text-xs font-medium text-slate-300">إيرادات اليوم</p>
            <p className="mt-2 text-3xl font-bold text-emerald-400">
              {todayRevenue.toLocaleString('ar')}
              <span className="mr-1 text-sm font-normal text-slate-400">{store.currency_code}</span>
            </p>
            <p className="mt-1 text-xs text-slate-500">من الطلبيات المدفوعة</p>
          </div>
        </div>
      </section>

      {/* الإحصائيات الإجمالية */}
      <section>
        <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-slate-500">الإجمالي</h2>
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
          {[
            { label: 'إجمالي الطلبيات',  value: ordersRes.count ?? 0,             icon: '📦', color: 'text-sky-400' },
            { label: 'الزبائن',           value: customersRes.count ?? 0,          icon: '👥', color: 'text-violet-400' },
            { label: 'المنتجات النشطة',   value: productsRes.count ?? 0,           icon: '🛍️', color: 'text-emerald-400' },
            { label: 'إجمالي الإيرادات', value: totalRevenue.toLocaleString('ar'), icon: '💰', color: 'text-amber-400', suffix: store.currency_code },
          ].map(stat => (
            <div key={stat.label} className="rounded-2xl border border-white/5 bg-slate-900 p-5">
              <div className="flex items-start justify-between">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-slate-300">{stat.label}</p>
                  <p className={`mt-2 text-2xl font-bold ${stat.color}`}>
                    {stat.value}
                    {stat.suffix && <span className="mr-1 text-sm font-normal text-slate-400">{stat.suffix}</span>}
                  </p>
                </div>
                <span className="text-xl">{stat.icon}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* إجراءات سريعة */}
      <section>
        <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-slate-500">إجراءات سريعة</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { href: '/dashboard/orders/new',          label: 'طلبية جديدة', icon: '➕', desc: 'POS أو ذمة' },
            { href: '/dashboard/products/new',         label: 'منتج جديد',   icon: '📝', desc: 'أضف منتجاً للمتجر' },
            { href: '/dashboard/customers',            label: 'زبون جديد',   icon: '👤', desc: 'أضف زبوناً' },
            { href: '/dashboard/accounting/receipts',  label: 'سند قبض',     icon: '💵', desc: 'استلام دفعة' },
          ].map(action => (
            <a key={action.href} href={action.href}
              className="rounded-xl border border-white/5 bg-slate-900 p-4 transition-colors hover:border-sky-500/30 hover:bg-slate-800">
              <span className="text-2xl">{action.icon}</span>
              <p className="mt-2 text-sm font-semibold text-white">{action.label}</p>
              <p className="mt-0.5 text-xs text-slate-400">{action.desc}</p>
            </a>
          ))}
        </div>
      </section>

    </div>
  )
}
