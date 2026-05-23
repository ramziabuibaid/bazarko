import { createAdminClient } from '@/lib/supabase/admin'
import Link from 'next/link'

export default async function AdminPlansPage() {
  const supabase = createAdminClient()

  const { data: stores } = await supabase
    .from('stores')
    .select('id, name, subdomain, plan, is_active, plan_expires_at, created_at')
    .order('plan')

  const storesList = (stores ?? []) as Array<{
    id: string; name: string; subdomain: string
    plan: string; is_active: boolean; plan_expires_at: string | null; created_at: string
  }>

  const byPlan = {
    free:  storesList.filter(s => s.plan === 'free'),
    basic: storesList.filter(s => s.plan === 'basic'),
    pro:   storesList.filter(s => s.plan === 'pro'),
  }

  const PLANS = [
    {
      key: 'free', label: 'مجاني', price: '0',
      color: 'text-slate-300', border: 'border-slate-500/30', bg: 'bg-slate-500/5',
      features: ['منتجات غير محدودة', 'متجر إلكتروني', 'إدارة الطلبيات'],
    },
    {
      key: 'basic', label: 'أساسي', price: '29',
      color: 'text-sky-300', border: 'border-sky-500/30', bg: 'bg-sky-500/5',
      features: ['كل مزايا المجاني', 'المحاسبة والفواتير', 'الزبائن والذمم', 'إدارة المخزون'],
    },
    {
      key: 'pro', label: 'احترافي', price: '79',
      color: 'text-purple-300', border: 'border-purple-500/30', bg: 'bg-purple-500/5',
      features: ['كل مزايا الأساسي', 'نظام الصيانة', 'تقارير متقدمة', 'دعم أولوية'],
    },
  ]

  const expiringSoon = storesList.filter(s => {
    if (!s.plan_expires_at || s.plan === 'free') return false
    const days = (new Date(s.plan_expires_at).getTime() - Date.now()) / 86400000
    return days <= 14 && days >= 0
  })

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-white">الخطط والاشتراكات</h1>
        <p className="text-sm text-slate-400">{storesList.length} متجر إجمالاً</p>
      </div>

      {/* Plan cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {PLANS.map(p => (
          <div key={p.key} className={`rounded-2xl border ${p.border} ${p.bg} p-5`}>
            <div className="flex items-end justify-between mb-3">
              <div>
                <p className={`text-lg font-bold ${p.color}`}>{p.label}</p>
                <p className="text-2xl font-bold text-white">${p.price}<span className="text-sm text-slate-500">/شهر</span></p>
              </div>
              <span className="text-3xl font-bold text-white/10">{byPlan[p.key as keyof typeof byPlan].length}</span>
            </div>
            <ul className="space-y-1 text-xs text-slate-400">
              {p.features.map(f => <li key={f}>✓ {f}</li>)}
            </ul>
          </div>
        ))}
      </div>

      {/* Expiring soon */}
      {expiringSoon.length > 0 && (
        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-5">
          <h2 className="text-sm font-semibold text-amber-400 mb-3">⚠️ اشتراكات تنتهي قريباً (خلال 14 يوم)</h2>
          <div className="space-y-2">
            {expiringSoon.map(s => {
              const days = Math.ceil((new Date(s.plan_expires_at!).getTime() - Date.now()) / 86400000)
              return (
                <div key={s.id} className="flex items-center justify-between text-sm">
                  <Link href={`/admin/stores/${s.id}`} className="text-white hover:text-sky-400">
                    {s.name}
                  </Link>
                  <span className="text-amber-400">{days} يوم</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Per-plan store lists */}
      {PLANS.map(p => (
        <div key={p.key} className="rounded-2xl border border-white/5 bg-slate-900">
          <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between">
            <h2 className={`text-sm font-semibold ${p.color}`}>{p.label} — {byPlan[p.key as keyof typeof byPlan].length} متجر</h2>
          </div>
          {byPlan[p.key as keyof typeof byPlan].length === 0 ? (
            <p className="px-5 py-6 text-sm text-slate-600 text-center">لا توجد متاجر على هذه الخطة</p>
          ) : (
            <div className="divide-y divide-white/5">
              {byPlan[p.key as keyof typeof byPlan].map(s => (
                <div key={s.id} className="flex items-center justify-between px-5 py-3">
                  <div className="flex items-center gap-2.5">
                    <span className={`h-1.5 w-1.5 rounded-full ${s.is_active ? 'bg-emerald-500' : 'bg-red-500'}`} />
                    <div>
                      <p className="text-sm text-white">{s.name}</p>
                      <p className="text-xs text-slate-500" dir="ltr">{s.subdomain}.bazarko.app</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-slate-500">
                    {s.plan_expires_at && (
                      <span>ينتهي {new Date(s.plan_expires_at).toLocaleDateString('ar', { month: 'short', day: 'numeric' })}</span>
                    )}
                    <Link href={`/admin/stores/${s.id}`} className="text-slate-400 hover:text-white">إدارة</Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
