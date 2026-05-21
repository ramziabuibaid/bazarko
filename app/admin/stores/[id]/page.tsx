import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import StoreActions from './StoreActions'

interface Props { params: { id: string } }

export default async function AdminStoreDetailPage({ params }: Props) {
  const supabase = createClient()

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

  const s = store as {
    id: string; name: string; subdomain: string; country_code: string
    phone: string | null; plan: string; is_active: boolean; currency_code: string
    created_at: string; suspended_at: string | null; suspended_reason: string | null
    plan_expires_at: string | null
    profiles: { full_name: string | null; id: string } | null
  }

  const [
    { count: productCount },
    { count: orderCount },
    { data: revenueData },
    { count: repairCount },
    { count: customerCount },
  ] = await Promise.all([
    supabase.from('products').select('*', { count: 'exact', head: true }).eq('store_id', s.id),
    supabase.from('orders').select('*', { count: 'exact', head: true }).eq('store_id', s.id),
    supabase.from('orders').select('total_amount').eq('store_id', s.id).eq('payment_status', 'paid'),
    supabase.from('repair_jobs').select('*', { count: 'exact', head: true }).eq('store_id', s.id),
    supabase.from('customers').select('*', { count: 'exact', head: true }).eq('store_id', s.id),
  ])

  const revenue = (revenueData ?? []).reduce((acc: number, o: { total_amount: number | null }) => acc + (o.total_amount ?? 0), 0)
  const fmt = (n: number) => n.toLocaleString('ar-SA', { maximumFractionDigits: 0 })

  const PLAN_LABELS: Record<string, string> = { free: 'مجاني', basic: 'أساسي', pro: 'احترافي' }

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link href="/admin/stores" className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-slate-400 hover:text-white">
            ← المتاجر
          </Link>
          <div>
            <h1 className="text-xl font-semibold text-white">{s.name}</h1>
            <p className="text-sm text-slate-400" dir="ltr">{s.subdomain}.bazarko.com · {s.country_code}</p>
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

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        {/* Left: Store Info + Stats */}
        <div className="md:col-span-2 space-y-4">

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
                { label: 'رقم الهاتف',       value: s.phone ?? '—' },
                { label: 'العملة',           value: s.currency_code },
                { label: 'تاريخ الانضمام',   value: new Date(s.created_at).toLocaleDateString('ar', { year: 'numeric', month: 'long', day: 'numeric' }) },
                { label: 'انتهاء الاشتراك',  value: s.plan_expires_at ? new Date(s.plan_expires_at).toLocaleDateString('ar', { year: 'numeric', month: 'long', day: 'numeric' }) : 'غير محدد' },
              ].map(row => (
                <div key={row.label} className="flex justify-between gap-4">
                  <dt className="text-slate-500">{row.label}</dt>
                  <dd className="text-slate-200 text-left">{row.value}</dd>
                </div>
              ))}
            </dl>

            {/* Storefront Link */}
            <div className="mt-4 pt-4 border-t border-white/5">
              <a href={`/store/${s.country_code.toLowerCase()}/${s.subdomain}`}
                target="_blank" rel="noopener noreferrer"
                className="text-xs text-sky-400 hover:text-sky-300 flex items-center gap-1.5">
                🔗 زيارة المتجر الإلكتروني
              </a>
            </div>
          </div>
        </div>

        {/* Right: Actions */}
        <div>
          <StoreActions
            storeId={s.id}
            isActive={s.is_active}
            currentPlan={s.plan}
            planExpiresAt={s.plan_expires_at}
          />
        </div>
      </div>
    </div>
  )
}
