import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import { redirect } from 'next/navigation'
import Link from 'next/link'

interface SearchParams { entity?: string; action?: string }

const ENTITY_LABELS: Record<string, string> = {
  invoice: 'فاتورة', voucher: 'سند', cash_movement: 'حركة صندوق', cash_session: 'إغلاق صندوق',
}

const ACTION_META: Record<string, { label: string; icon: string; cls: string }> = {
  create:        { label: 'إنشاء',        icon: '➕', cls: 'bg-emerald-500/15 text-emerald-400' },
  update:        { label: 'تعديل',        icon: '✏️', cls: 'bg-sky-500/15 text-sky-400' },
  delete:        { label: 'حذف',          icon: '🗑️', cls: 'bg-red-500/15 text-red-400' },
  status_change: { label: 'تغيير حالة',   icon: '🔄', cls: 'bg-amber-500/15 text-amber-400' },
  payment:       { label: 'دفعة',         icon: '💵', cls: 'bg-emerald-500/15 text-emerald-400' },
  cancel:        { label: 'إلغاء',        icon: '🚫', cls: 'bg-red-500/15 text-red-400' },
}

function describeDetails(action: string, details: Record<string, unknown>): string {
  if (!details) return ''
  if (action === 'payment') return `مبلغ ${details.amount} · ${details.method ?? ''} → ${details.newStatus ?? ''}`
  if (action === 'status_change') return `${details.from ?? ''} ← ${details.to ?? ''}`
  if (action === 'create' && details.type) return `${details.type === 'receipt' ? 'قبض' : 'صرف'} ${details.amount ?? ''}`
  if (action === 'create' && details.total != null) return `إجمالي ${details.total}`
  if (action === 'cancel' && details.total != null) return `إجمالي ${details.total}`
  return ''
}

export default async function AuditPage({ searchParams }: { searchParams: SearchParams }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const storeId = await getStoreForUser(supabase, user!.id)
  if (!storeId) redirect('/onboarding')

  let query = supabase
    .from('financial_audit_log')
    .select('id, entity_type, entity_id, entity_label, action, actor_name, details, created_at')
    .eq('store_id', storeId)
    .order('created_at', { ascending: false })
    .limit(200)

  if (searchParams.entity) query = query.eq('entity_type', searchParams.entity)
  if (searchParams.action) query = query.eq('action', searchParams.action)

  const { data: logs } = await query

  const entityTabs = [
    { key: '',              label: 'الكل' },
    { key: 'invoice',       label: 'الفواتير' },
    { key: 'voucher',       label: 'السندات' },
    { key: 'cash_movement', label: 'الصندوق' },
    { key: 'cash_session',  label: 'الإغلاقات' },
  ]

  return (
    <div className="space-y-5 p-4 sm:p-6">
      <div className="flex items-center gap-3">
        <Link href="/dashboard/accounting" className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-slate-400 hover:text-white">
          ← المحاسبة
        </Link>
        <div>
          <h1 className="text-xl font-semibold text-white">📜 سجل العمليات المالية</h1>
          <p className="mt-0.5 text-sm text-slate-400">من أنشأ/عدّل/ألغى كل عملية ومتى</p>
        </div>
      </div>

      {/* فلتر الكيان */}
      <div className="flex flex-wrap gap-1 border-b border-white/5 pb-0">
        {entityTabs.map(t => (
          <Link key={t.key}
            href={`/dashboard/accounting/audit${t.key ? `?entity=${t.key}` : ''}`}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              (searchParams.entity ?? '') === t.key
                ? 'border-sky-500 text-sky-400'
                : 'border-transparent text-slate-400 hover:text-white'
            }`}>
            {t.label}
          </Link>
        ))}
      </div>

      {(!logs || logs.length === 0) ? (
        <div className="rounded-2xl border border-white/5 bg-white/3 py-16 text-center">
          <p className="text-4xl">📜</p>
          <p className="mt-3 font-medium text-slate-300">لا توجد عمليات مسجّلة بعد</p>
          <p className="mt-1 text-sm text-slate-500">ستظهر هنا كل عمليات الفواتير والسندات والصندوق</p>
        </div>
      ) : (
        <div className="space-y-2">
          {logs.map(log => {
            const am = ACTION_META[log.action] ?? { label: log.action, icon: '•', cls: 'bg-white/5 text-white' }
            const detail = describeDetails(log.action, (log.details ?? {}) as Record<string, unknown>)
            return (
              <div key={log.id} className="flex items-center gap-3 rounded-xl border border-white/5 bg-slate-900 px-4 py-3">
                <span className="text-lg">{am.icon}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${am.cls}`}>{am.label}</span>
                    <span className="text-sm text-slate-300">{ENTITY_LABELS[log.entity_type] ?? log.entity_type}</span>
                    {log.entity_label && <span className="font-mono text-xs text-sky-400" dir="ltr">{log.entity_label}</span>}
                    {detail && <span className="text-xs text-slate-500" dir="ltr">— {detail}</span>}
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {log.actor_name ?? 'مستخدم'} · {new Date(log.created_at).toLocaleString('ar')}
                  </p>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
