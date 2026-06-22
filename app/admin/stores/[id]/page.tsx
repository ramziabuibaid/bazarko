import { createAdminClient } from '@/lib/supabase/admin'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import StoreActions from './StoreActions'

interface Props { params: { id: string } }

type ActivityEvent = {
  type: string
  label: string
  sub?: string
  time: string
  color: string
  icon: string
}

export default async function AdminStoreDetailPage({ params }: Props) {
  const supabase = createAdminClient()

  const { data: store } = await supabase
    .from('stores')
    .select(`
      id, name, subdomain, country_code, phone, plan, is_active,
      created_at, suspended_at, suspended_reason, plan_expires_at,
      currency_code,
      profiles!stores_owner_id_fkey(full_name, id)
    `)
    .eq('id', params.id)
    .single()

  if (!store) notFound()

  const s = store as unknown as {
    id: string; name: string; subdomain: string; country_code: string
    phone: string | null; plan: string; is_active: boolean; currency_code: string
    created_at: string; suspended_at: string | null; suspended_reason: string | null
    plan_expires_at: string | null
    profiles: { full_name: string | null; id: string } | null
  }

  const ownerId = s.profiles?.id ?? ''

  const [
    { count: productCount },
    { count: orderCount },
    { data: revenueData },
    { count: repairCount },
    { count: customerCount },
    { data: recentOrders },
    { data: recentProducts },
    { data: recentCustomers },
    { data: recentRepairs },
  ] = await Promise.all([
    supabase.from('products').select('*', { count: 'exact', head: true }).eq('store_id', s.id),
    supabase.from('orders').select('*', { count: 'exact', head: true }).eq('store_id', s.id),
    supabase.from('orders').select('total_amount').eq('store_id', s.id).eq('payment_status', 'paid'),
    supabase.from('repair_jobs').select('*', { count: 'exact', head: true }).eq('store_id', s.id),
    supabase.from('customers').select('*', { count: 'exact', head: true }).eq('store_id', s.id),
    supabase.from('orders')
      .select('id, order_number, total_amount, status, payment_status, created_at, customer_name')
      .eq('store_id', s.id)
      .order('created_at', { ascending: false })
      .limit(30),
    supabase.from('products')
      .select('id, name, price, stock_quantity, is_active, created_at')
      .eq('store_id', s.id)
      .order('created_at', { ascending: false })
      .limit(20),
    supabase.from('customers')
      .select('id, name, phone, created_at')
      .eq('store_id', s.id)
      .order('created_at', { ascending: false })
      .limit(15),
    supabase.from('repair_jobs')
      .select('id, job_number, device_type, status, priority, customer_name, created_at')
      .eq('store_id', s.id)
      .order('created_at', { ascending: false })
      .limit(15),
  ])

  // Get owner auth info via admin API
  let ownerLastSignIn: string | null = null
  let ownerEmail: string | null = null
  if (ownerId) {
    const { data: authUser } = await supabase.auth.admin.getUserById(ownerId)
    ownerLastSignIn = authUser?.user?.last_sign_in_at ?? null
    ownerEmail = authUser?.user?.email ?? null
  }

  const revenue = (revenueData ?? []).reduce((acc: number, o: { total_amount: number | null }) => acc + (o.total_amount ?? 0), 0)
  const fmt = (n: number) => n.toLocaleString('ar-SA', { maximumFractionDigits: 0 })

  const PLAN_LABELS: Record<string, string> = { free: 'مجاني', basic: 'أساسي', pro: 'احترافي' }
  const ORDER_STATUS: Record<string, string> = {
    pending: 'قيد الانتظار', confirmed: 'مؤكدة', processing: 'بالتجهيز',
    ready: 'جاهزة', shipped: 'مشحونة', delivered: 'مسلّمة', cancelled: 'ملغاة',
  }
  const REPAIR_STATUS: Record<string, string> = {
    received: 'استُلم', diagnosing: 'تشخيص', in_repair: 'بالإصلاح',
    waiting_parts: 'انتظار قطع', ready: 'جاهز', delivered: 'سُلِّم', cancelled: 'ملغى',
  }

  // Build unified activity timeline
  const activityEvents: ActivityEvent[] = []

  if (ownerLastSignIn) {
    activityEvents.push({
      type: 'login', icon: '🔐', color: 'text-sky-400',
      label: 'آخر تسجيل دخول',
      sub: ownerEmail ?? undefined,
      time: ownerLastSignIn,
    })
  }

  for (const o of (recentOrders ?? []) as Array<{ id: string; order_number: string | null; total_amount: number | null; status: string; created_at: string; customer_name: string | null }>) {
    activityEvents.push({
      type: 'order', icon: '🛒', color: 'text-emerald-400',
      label: `طلبية ${o.order_number ?? '#' + o.id.slice(0, 6)} — ${fmt(o.total_amount ?? 0)} ${s.currency_code}`,
      sub: `${ORDER_STATUS[o.status] ?? o.status}${o.customer_name ? ' · ' + o.customer_name : ''}`,
      time: o.created_at,
    })
  }

  for (const p of (recentProducts ?? []) as Array<{ id: string; name: string; price: number; stock_quantity: number; is_active: boolean; created_at: string }>) {
    activityEvents.push({
      type: 'product', icon: '📦', color: 'text-violet-400',
      label: `منتج جديد: ${p.name}`,
      sub: `${fmt(p.price)} ${s.currency_code} · مخزون: ${p.stock_quantity}${!p.is_active ? ' · مخفي' : ''}`,
      time: p.created_at,
    })
  }

  for (const c of (recentCustomers ?? []) as Array<{ id: string; name: string; phone: string | null; created_at: string }>) {
    activityEvents.push({
      type: 'customer', icon: '👤', color: 'text-orange-400',
      label: `زبون جديد: ${c.name}`,
      sub: c.phone ?? undefined,
      time: c.created_at,
    })
  }

  for (const r of (recentRepairs ?? []) as Array<{ id: string; job_number: string | null; device_type: string; status: string; priority: string; customer_name: string | null; created_at: string }>) {
    activityEvents.push({
      type: 'repair', icon: '🔧', color: 'text-rose-400',
      label: `صيانة ${r.job_number ?? '#' + r.id.slice(0, 6)} — ${r.device_type}`,
      sub: `${REPAIR_STATUS[r.status] ?? r.status}${r.priority === 'urgent' ? ' · عاجل' : ''}${r.customer_name ? ' · ' + r.customer_name : ''}`,
      time: r.created_at,
    })
  }

  activityEvents.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())

  const formatTime = (iso: string) =>
    new Date(iso).toLocaleString('ar', {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })

  return (
    <div className="p-6 space-y-6 max-w-6xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link href="/admin/stores" className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-slate-400 hover:text-white">
            ← المتاجر
          </Link>
          <div>
            <h1 className="text-xl font-semibold text-white">{s.name}</h1>
            <p className="text-sm text-slate-400" dir="ltr">
              {s.subdomain}.{s.country_code.toLowerCase()}.bazarko.app · {s.country_code}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-3 py-1 text-xs font-medium ${s.is_active ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
            {s.is_active ? 'نشط' : 'معلّق'}
          </span>
          <span className="rounded-full bg-sky-500/10 border border-sky-500/20 px-3 py-1 text-xs font-medium text-sky-400">
            {PLAN_LABELS[s.plan] ?? s.plan}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left: Store Info + Stats + Activity */}
        <div className="lg:col-span-2 space-y-4">

          {/* Suspension Notice */}
          {!s.is_active && s.suspended_reason && (
            <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4">
              <p className="text-xs text-red-400 font-medium mb-1">سبب التعليق</p>
              <p className="text-sm text-red-300">{s.suspended_reason}</p>
              {s.suspended_at && (
                <p className="text-xs text-slate-500 mt-1">
                  {new Date(s.suspended_at).toLocaleDateString('ar', { year: 'numeric', month: 'long', day: 'numeric' })}
                </p>
              )}
            </div>
          )}

          {/* Stats */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {[
              { label: 'المنتجات',     value: productCount ?? 0,  cls: 'text-white' },
              { label: 'الطلبيات',     value: orderCount ?? 0,    cls: 'text-sky-400' },
              { label: 'الزبائن',      value: customerCount ?? 0, cls: 'text-purple-400' },
              { label: 'طلبات صيانة', value: repairCount ?? 0,   cls: 'text-orange-400' },
              { label: 'الإيرادات',    value: `${fmt(revenue)} ${s.currency_code}`, cls: 'text-emerald-400', isText: true },
            ].map(stat => (
              <div key={stat.label} className="rounded-xl border border-white/5 bg-slate-900 p-4 text-center">
                <p className="text-xs text-slate-500 mb-1">{stat.label}</p>
                <p className={`text-xl font-bold ${stat.cls}`} dir={stat.isText ? 'ltr' : undefined}>{stat.value}</p>
              </div>
            ))}
          </div>

          {/* Info Card */}
          <div className="rounded-2xl border border-white/5 bg-slate-900 p-5">
            <h2 className="text-sm font-semibold text-white mb-4">معلومات المتجر</h2>
            <dl className="space-y-3 text-sm">
              {[
                { label: 'المالك',           value: s.profiles?.full_name ?? '—' },
                { label: 'الإيميل',          value: ownerEmail ?? '—' },
                { label: 'رقم الهاتف',       value: s.phone ?? '—' },
                { label: 'العملة',           value: s.currency_code },
                { label: 'تاريخ الانضمام',   value: new Date(s.created_at).toLocaleDateString('ar', { year: 'numeric', month: 'long', day: 'numeric' }) },
                {
                  label: 'آخر دخول',
                  value: ownerLastSignIn
                    ? new Date(ownerLastSignIn).toLocaleString('ar', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                    : 'لم يسجّل دخول بعد',
                },
                { label: 'انتهاء الاشتراك',  value: s.plan_expires_at ? new Date(s.plan_expires_at).toLocaleDateString('ar', { year: 'numeric', month: 'long', day: 'numeric' }) : 'غير محدد' },
              ].map(row => (
                <div key={row.label} className="flex justify-between gap-4">
                  <dt className="text-slate-500 shrink-0">{row.label}</dt>
                  <dd className="text-slate-200 text-left truncate max-w-xs">{row.value}</dd>
                </div>
              ))}
            </dl>

            <div className="mt-4 pt-4 border-t border-white/5">
              <a href={`/store/${s.country_code.toLowerCase()}/${s.subdomain}`}
                target="_blank" rel="noopener noreferrer"
                className="text-xs text-sky-400 hover:text-sky-300 flex items-center gap-1.5">
                🔗 زيارة المتجر الإلكتروني
              </a>
            </div>
          </div>

          {/* Activity Log */}
          <div className="rounded-2xl border border-white/5 bg-slate-900 overflow-hidden">
            <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-white">سجل النشاط</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  {activityEvents.length} حدث — طلبيات، منتجات، زبائن، صيانة، دخول
                </p>
              </div>
              <Link
                href={`/admin/stores/${params.id}/activity`}
                className="rounded-lg bg-sky-500/15 px-3 py-1.5 text-xs font-medium text-sky-400 hover:bg-sky-500/25 transition-colors"
              >
                ⏱️ تقرير وقت وتحركات الموظفين ←
              </Link>
            </div>

            {activityEvents.length === 0 ? (
              <div className="px-5 py-12 text-center text-slate-600 text-sm">لا يوجد نشاط مسجّل بعد</div>
            ) : (
              <div className="divide-y divide-white/5 max-h-[560px] overflow-y-auto">
                {activityEvents.map((ev, i) => (
                  <div key={i} className="flex items-start gap-3 px-5 py-3 hover:bg-white/[0.02] transition-colors">
                    <span className="text-base mt-0.5 shrink-0">{ev.icon}</span>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium truncate ${ev.color}`}>{ev.label}</p>
                      {ev.sub && <p className="text-xs text-slate-500 mt-0.5 truncate">{ev.sub}</p>}
                    </div>
                    <time className="text-xs text-slate-600 shrink-0 whitespace-nowrap" dir="ltr">
                      {formatTime(ev.time)}
                    </time>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>

        {/* Right: Actions */}
        <div>
          <StoreActions
            storeId={s.id}
            ownerId={ownerId}
            isActive={s.is_active}
            currentPlan={s.plan}
            planExpiresAt={s.plan_expires_at}
            currentSubdomain={s.subdomain}
            countryCode={s.country_code}
          />
        </div>
      </div>
    </div>
  )
}
