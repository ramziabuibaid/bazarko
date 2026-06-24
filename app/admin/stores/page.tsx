import { createAdminClient } from '@/lib/supabase/admin'
import Link from 'next/link'

const PLAN_COLORS: Record<string, string> = {
  free:  'text-slate-400 bg-slate-400/10 border-slate-400/20',
  basic: 'text-sky-400 bg-sky-400/10 border-sky-400/20',
  pro:   'text-purple-400 bg-purple-400/10 border-purple-400/20',
}
const PLAN_LABELS: Record<string, string> = { free: 'مجاني', basic: 'أساسي', pro: 'احترافي' }
const COUNTRY_LABELS: Record<string, string> = { PS: '🇵🇸 فلسطين', SY: '🇸🇾 سوريا', JO: '🇯🇴 الأردن', SA: '🇸🇦 السعودية' }

interface SearchParams { plan?: string; country?: string; status?: string }

export default async function AdminStoresPage({ searchParams }: { searchParams: SearchParams }) {
  const supabase = createAdminClient()

  let query = supabase
    .from('stores')
    .select(`
      id, name, subdomain, country_code, plan, is_active,
      created_at, suspended_at, suspended_reason, plan_expires_at,
      profiles!stores_owner_id_fkey(full_name, id)
    `)
    .order('created_at', { ascending: false })

  if (searchParams.plan)    query = query.eq('plan', searchParams.plan)
  if (searchParams.country) query = query.eq('country_code', searchParams.country)
  if (searchParams.status === 'active')    query = query.eq('is_active', true)
  if (searchParams.status === 'suspended') query = query.eq('is_active', false)

  const { data: stores } = await query

  const storesList = (stores ?? []) as unknown as Array<{
    id: string; name: string; subdomain: string; country_code: string
    plan: string; is_active: boolean; created_at: string
    suspended_at: string | null; suspended_reason: string | null
    plan_expires_at: string | null
    profiles: { full_name: string | null; id: string } | null
  }>

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white">المتاجر</h1>
          <p className="text-sm text-slate-400">{storesList.length} متجر</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        {/* Status */}
        {[
          { label: 'الكل', value: '' },
          { label: 'نشط', value: 'active' },
          { label: 'معلّق', value: 'suspended' },
        ].map(f => (
          <Link key={f.value} href={`/admin/stores?status=${f.value}${searchParams.plan ? `&plan=${searchParams.plan}` : ''}${searchParams.country ? `&country=${searchParams.country}` : ''}`}
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
              (searchParams.status ?? '') === f.value
                ? 'border-sky-500/50 bg-sky-500/10 text-sky-400'
                : 'border-white/10 text-slate-400 hover:text-white'
            }`}>
            {f.label}
          </Link>
        ))}
        <div className="w-px bg-white/10" />
        {/* Plan */}
        {[
          { label: 'كل الخطط', value: '' },
          { label: 'مجاني', value: 'free' },
          { label: 'أساسي', value: 'basic' },
          { label: 'احترافي', value: 'pro' },
        ].map(f => (
          <Link key={f.value} href={`/admin/stores?plan=${f.value}${searchParams.status ? `&status=${searchParams.status}` : ''}${searchParams.country ? `&country=${searchParams.country}` : ''}`}
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
              (searchParams.plan ?? '') === f.value
                ? 'border-purple-500/50 bg-purple-500/10 text-purple-400'
                : 'border-white/10 text-slate-400 hover:text-white'
            }`}>
            {f.label}
          </Link>
        ))}
        <div className="w-px bg-white/10" />
        {/* Country */}
        {[
          { label: 'كل البلدان', value: '' },
          { label: '🇵🇸 PS', value: 'PS' },
          { label: '🇸🇾 SY', value: 'SY' },
        ].map(f => (
          <Link key={f.value} href={`/admin/stores?country=${f.value}${searchParams.status ? `&status=${searchParams.status}` : ''}${searchParams.plan ? `&plan=${searchParams.plan}` : ''}`}
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
              (searchParams.country ?? '') === f.value
                ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400'
                : 'border-white/10 text-slate-400 hover:text-white'
            }`}>
            {f.label}
          </Link>
        ))}
      </div>

      {/* Table */}
      <div className="rounded-2xl border border-white/5 bg-slate-900 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/5 text-xs text-slate-500">
              <th className="px-4 py-3 text-right font-medium">المتجر</th>
              <th className="px-4 py-3 text-right font-medium">المالك</th>
              <th className="px-4 py-3 text-right font-medium">البلد</th>
              <th className="px-4 py-3 text-right font-medium">الخطة</th>
              <th className="px-4 py-3 text-right font-medium">الحالة</th>
              <th className="px-4 py-3 text-right font-medium">تاريخ الانضمام</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {storesList.map(store => (
              <tr key={store.id} className="hover:bg-white/3 transition-colors">
                <td className="px-4 py-3">
                  <p className="font-medium text-white">{store.name}</p>
                  <p className="text-xs text-slate-500" dir="ltr">{store.subdomain}.bazarko.app</p>
                </td>
                <td className="px-4 py-3 text-slate-300">
                  {store.profiles?.full_name ?? '—'}
                </td>
                <td className="px-4 py-3 text-slate-400">
                  {COUNTRY_LABELS[store.country_code] ?? store.country_code}
                </td>
                <td className="px-4 py-3">
                  <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${PLAN_COLORS[store.plan] ?? PLAN_COLORS.free}`}>
                    {PLAN_LABELS[store.plan] ?? store.plan}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {store.is_active ? (
                    <span className="flex items-center gap-1.5 text-emerald-400 text-xs">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> نشط
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5 text-red-400 text-xs">
                      <span className="h-1.5 w-1.5 rounded-full bg-red-500" /> معلّق
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-slate-500 text-xs">
                  {new Date(store.created_at).toLocaleDateString('ar-u-nu-latn', { year: 'numeric', month: 'short', day: 'numeric' })}
                </td>
                <td className="px-4 py-3">
                  <Link href={`/admin/stores/${store.id}`}
                    className="rounded-lg border border-white/10 px-2.5 py-1 text-xs text-slate-400 hover:text-white hover:border-white/20 transition-colors">
                    إدارة
                  </Link>
                </td>
              </tr>
            ))}
            {storesList.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-slate-600">لا توجد متاجر</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
