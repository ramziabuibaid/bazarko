import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { runFinancialAudit, type AuditSeverity } from '@/lib/accounting/financial-audit-engine'

interface SearchParams {
  tab?: 'audit' | 'log'
  entity?: string
  action?: string
}

const ENTITY_LABELS: Record<string, string> = {
  invoice: 'فاتورة',
  check: 'شيك',
  voucher: 'سند',
  cash_movement: 'حركة صندوق',
  cash_session: 'إغلاق صندوق',
}

const ACTION_META: Record<string, { label: string; icon: string; cls: string }> = {
  create: { label: 'إنشاء', icon: '➕', cls: 'bg-emerald-500/15 text-emerald-400' },
  update: { label: 'تعديل', icon: '✏️', cls: 'bg-sky-500/15 text-sky-400' },
  delete: { label: 'حذف', icon: '🗑️', cls: 'bg-red-500/15 text-red-400' },
  status_change: { label: 'تغيير حالة', icon: '🔄', cls: 'bg-amber-500/15 text-amber-400' },
  payment: { label: 'دفعة', icon: '💵', cls: 'bg-emerald-500/15 text-emerald-400' },
  cancel: { label: 'إلغاء', icon: '🚫', cls: 'bg-red-500/15 text-red-400' },
}

const SEVERITY_BADGES: Record<
  AuditSeverity,
  { label: string; icon: string; cls: string; borderCls: string; bgCls: string }
> = {
  critical: {
    label: 'حرج (تفاوت مباشر)',
    icon: '🔴',
    cls: 'text-red-400 bg-red-500/15 border-red-500/30',
    borderCls: 'border-red-500/30',
    bgCls: 'bg-red-950/20',
  },
  warning: {
    label: 'تنبيه (مراجعة مطلوبة)',
    icon: '🟠',
    cls: 'text-amber-400 bg-amber-500/15 border-amber-500/30',
    borderCls: 'border-amber-500/30',
    bgCls: 'bg-amber-950/20',
  },
  notice: {
    label: 'إشعار تدقيق',
    icon: '🟡',
    cls: 'text-yellow-400 bg-yellow-500/15 border-yellow-500/30',
    borderCls: 'border-yellow-500/30',
    bgCls: 'bg-yellow-950/10',
  },
  healthy: {
    label: 'متطابق وسليم',
    icon: '🟢',
    cls: 'text-emerald-400 bg-emerald-500/15 border-emerald-500/30',
    borderCls: 'border-emerald-500/30',
    bgCls: 'bg-emerald-950/20',
  },
}

function describeDetails(action: string, details: Record<string, unknown>): string {
  if (!details) return ''
  if (action === 'payment') return `مبلغ ${details.amount} · ${details.method ?? ''} → ${details.newStatus ?? ''}`
  if (action === 'status_change') return `${details.from ?? ''} ← ${details.to ?? ''}`
  if (action === 'create' && details.type)
    return `${details.type === 'receipt' ? 'قبض' : 'صرف'} ${details.amount ?? ''}`
  if (action === 'create' && details.total != null) return `إجمالي ${details.total}`
  if (action === 'cancel' && details.total != null) return `إجمالي ${details.total}`
  return ''
}

export default async function AuditPage({ searchParams }: { searchParams: SearchParams }) {
  const activeTab = searchParams.tab === 'log' ? 'log' : 'audit'

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const storeId = await getStoreForUser(supabase, user.id)
  if (!storeId) redirect('/onboarding')

  const { data: store } = await supabase
    .from('stores')
    .select('id, currency_code')
    .eq('id', storeId)
    .single()
  const cur = store?.currency_code || 'ILS'
  const fmt = (n: number) => n.toLocaleString('ar-u-nu-latn', { maximumFractionDigits: 2 })

  // تقرير الرقابة المالية الآلي
  const auditReport = await runFinancialAudit(storeId)

  // سجل العمليات التاريخي
  let logQuery = supabase
    .from('financial_audit_log')
    .select('id, entity_type, entity_id, entity_label, action, actor_name, details, created_at')
    .eq('store_id', storeId)
    .order('created_at', { ascending: false })
    .limit(200)

  if (searchParams.entity) logQuery = logQuery.eq('entity_type', searchParams.entity)
  if (searchParams.action) logQuery = logQuery.eq('action', searchParams.action)

  const { data: logs } = await logQuery

  const entityTabs = [
    { key: '', label: 'الكل' },
    { key: 'invoice', label: 'الفواتير' },
    { key: 'voucher', label: 'السندات' },
    { key: 'check', label: 'الشيكات' },
    { key: 'cash_movement', label: 'الصندوق' },
    { key: 'cash_session', label: 'الإغلاقات' },
  ]

  const overallBadge = SEVERITY_BADGES[auditReport.overallSeverity]

  return (
    <div className="space-y-6 p-4 sm:p-6">
      {/* الترويسة الرئيسية */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard/accounting"
            className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
          >
            ← المحاسبة
          </Link>
          <div>
            <h1 className="text-xl font-bold text-white flex items-center gap-2">
              🛡️ سجل العمليات المالية والرقابة الداخلية
            </h1>
            <p className="mt-0.5 text-xs text-slate-400">
              محرك التدقيق الآلي لمطابقة الأرصدة، فحص اتزان القيود، وسجل العمليات التاريخي
            </p>
          </div>
        </div>

        {/* التبديل بين الرقابة المالية وسجل العمليات */}
        <div className="flex rounded-xl bg-slate-900 p-1 border border-white/10 self-start sm:self-auto">
          <Link
            href="/dashboard/accounting/audit?tab=audit"
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'audit'
                ? 'bg-sky-500 text-white shadow-md'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <span>🛡️ فحص ومطابقة الرقابة المالية</span>
            <span
              className={`rounded-full px-1.5 py-0.2 text-[10px] font-bold ${
                auditReport.overallSeverity === 'critical'
                  ? 'bg-red-400 text-slate-950'
                  : auditReport.overallSeverity === 'warning'
                  ? 'bg-amber-400 text-slate-950'
                  : 'bg-emerald-400 text-slate-950'
              }`}
            >
              {auditReport.healthScore}%
            </span>
          </Link>
          <Link
            href="/dashboard/accounting/audit?tab=log"
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'log'
                ? 'bg-sky-500 text-white shadow-md'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <span>📜 سجل العمليات التاريخي</span>
            <span className="rounded-full bg-white/10 px-1.5 py-0.2 text-[10px] text-slate-300">
              {logs?.length || 0}
            </span>
          </Link>
        </div>
      </div>

      {/* ─── تبويب 1: فحص ومطابقة الرقابة المالية ─── */}
      {activeTab === 'audit' && (
        <div className="space-y-6">
          {/* بانر مؤشر السلامة الإجمالي */}
          <div
            className={`rounded-2xl border p-5 sm:p-6 transition-all ${overallBadge.borderCls} ${overallBadge.bgCls}`}
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-start gap-4">
                <span className="text-4xl">{overallBadge.icon}</span>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-bold ${overallBadge.cls}`}
                    >
                      {overallBadge.label}
                    </span>
                    <span className="text-xs text-slate-400">
                      آخر فحص:{' '}
                      {new Date(auditReport.timestamp).toLocaleTimeString('ar-u-nu-latn', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                  <h2 className="mt-1 text-xl font-bold text-white">
                    {auditReport.overallSeverity === 'healthy' &&
                      'النظام المالي والمحاسبي في حالة ممتازة ومتطابق 100%'}
                    {auditReport.overallSeverity === 'notice' &&
                      'توجد ملاحظات تدقيق روتينية لا تؤثر على توازن القوائم'}
                    {auditReport.overallSeverity === 'warning' &&
                      'تنبيهات محاسبية تتطلب المراجعة والمطابقة'}
                    {auditReport.overallSeverity === 'critical' &&
                      'تنبيه حرج: توجد قيود غير متزنة أو فروقات تستوجب التدخل الفوري'}
                  </h2>
                  <p className="mt-1 text-xs text-slate-400 max-w-2xl leading-relaxed">
                    يقوم محرك التدقيق بمطابقة مجموع كشوفات العملاء والموردين مع حسابات الأستاذ العام
                    (1121 و 2110)، والتأكد من اتزان كافة القيود اليومية (المدين = الدائن)، وفحص
                    محفظة الشيكات وسلامة كميات المخزون.
                  </p>
                </div>
              </div>

              {/* مؤشر النسبة المئوية */}
              <div className="flex items-center gap-3 bg-slate-950/60 border border-white/10 rounded-2xl p-4 self-start sm:self-auto">
                <div className="text-center">
                  <p className="text-[11px] text-slate-400 font-medium">مؤشر السلامة المالية</p>
                  <p
                    dir="ltr"
                    className={`text-3xl font-extrabold tabular-nums ${
                      auditReport.healthScore >= 90
                        ? 'text-emerald-400'
                        : auditReport.healthScore >= 70
                        ? 'text-amber-400'
                        : 'text-red-400'
                    }`}
                  >
                    {auditReport.healthScore}
                    <span className="text-sm font-normal text-slate-400">/100</span>
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* ملخص الإحصاءات الأربعة */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-2xl border border-red-500/20 bg-slate-900/90 p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs text-red-400 font-medium">🔴 حرج</span>
                <span className="text-xl font-bold tabular-nums text-white">
                  {auditReport.stats.criticalCount}
                </span>
              </div>
              <p className="mt-1 text-[11px] text-slate-500">يتطلب تصحيحاً عاجلاً</p>
            </div>

            <div className="rounded-2xl border border-amber-500/20 bg-slate-900/90 p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs text-amber-400 font-medium">🟠 تنبيهات</span>
                <span className="text-xl font-bold tabular-nums text-white">
                  {auditReport.stats.warningCount}
                </span>
              </div>
              <p className="mt-1 text-[11px] text-slate-500">فروقات غير مرحلة أو متأخرة</p>
            </div>

            <div className="rounded-2xl border border-yellow-500/20 bg-slate-900/90 p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs text-yellow-400 font-medium">🟡 إشعارات</span>
                <span className="text-xl font-bold tabular-nums text-white">
                  {auditReport.stats.noticeCount}
                </span>
              </div>
              <p className="mt-1 text-[11px] text-slate-500">ملاحظات تدقيق</p>
            </div>

            <div className="rounded-2xl border border-emerald-500/20 bg-slate-900/90 p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs text-emerald-400 font-medium">🟢 متطابق وسليم</span>
                <span className="text-xl font-bold tabular-nums text-white">
                  {auditReport.stats.healthyCount}
                </span>
              </div>
              <p className="mt-1 text-[11px] text-slate-500">فحوصات مجتازة بنجاح</p>
            </div>
          </div>

          {/* تفاصيل الفحوصات الخمسة */}
          <div className="space-y-4">
            <h2 className="text-sm font-bold text-white uppercase tracking-wider">
              نتائج الفحص والرقابة التفصيلية (5 محاور رقابية)
            </h2>

            {auditReport.checks.map(chk => {
              const b = SEVERITY_BADGES[chk.severity]

              return (
                <div
                  key={chk.id}
                  className={`rounded-2xl border p-5 bg-slate-900/90 transition-all ${
                    chk.severity === 'critical'
                      ? 'border-red-500/30 ring-1 ring-red-500/20'
                      : chk.severity === 'warning'
                      ? 'border-amber-500/30'
                      : 'border-white/10'
                  }`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/5 pb-3">
                    <div className="flex items-center gap-2.5">
                      <span className="text-xl">{b.icon}</span>
                      <div>
                        <h3 className="text-base font-bold text-white">{chk.title}</h3>
                        <p className="text-xs text-slate-400 mt-0.5">{chk.summary}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <span
                        className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${b.cls}`}
                      >
                        {b.label}
                      </span>
                    </div>
                  </div>

                  {/* المقارنة الرقمية إن وجدت */}
                  {(chk.actualValue !== undefined || chk.expectedValue !== undefined) && (
                    <div className="mt-3.5 grid grid-cols-1 sm:grid-cols-3 gap-3 bg-slate-950/60 p-3.5 rounded-xl border border-white/5">
                      <div>
                        <p className="text-[11px] text-slate-400">
                          {chk.category === 'customers' ? 'مجموع أرصدة كشوفات الزبائن' : 'مجموع كشوفات الموردين'}
                        </p>
                        <p dir="ltr" className="text-base font-bold text-white tabular-nums">
                          {fmt(chk.actualValue || 0)} <span className="text-xs text-slate-400">{cur}</span>
                        </p>
                      </div>

                      <div>
                        <p className="text-[11px] text-slate-400">
                          {chk.category === 'customers'
                            ? 'رصيد حساب المدينون بالأستاذ العام (1121)'
                            : 'رصيد حساب الدائنون بالأستاذ العام (2110)'}
                        </p>
                        <p dir="ltr" className="text-base font-bold text-white tabular-nums">
                          {fmt(chk.expectedValue || 0)} <span className="text-xs text-slate-400">{cur}</span>
                        </p>
                      </div>

                      <div>
                        <p className="text-[11px] text-slate-400">الفارق بين الدفاتر والأستاذ</p>
                        <p
                          dir="ltr"
                          className={`text-base font-bold tabular-nums ${
                            chk.discrepancy > 1 ? 'text-red-400' : 'text-emerald-400'
                          }`}
                        >
                          {fmt(chk.discrepancy)} <span className="text-xs text-slate-400">{cur}</span>
                        </p>
                      </div>
                    </div>
                  )}

                  {/* توصيات المدقق الآلي */}
                  {chk.recommendations.length > 0 && (
                    <div className="mt-3.5 rounded-xl bg-sky-500/5 border border-sky-500/20 p-3 text-xs space-y-1">
                      <p className="font-semibold text-sky-400 flex items-center gap-1.5">
                        <span>💡</span> توصيات المعالجة المحاسبية:
                      </p>
                      {chk.recommendations.map((rec, idx) => (
                        <p key={idx} className="text-slate-300 pr-5 leading-relaxed">
                          • {rec}
                        </p>
                      ))}
                    </div>
                  )}

                  {/* قائمة البنود المخالفة إن وجدت */}
                  {(chk.items ?? []).length > 0 && (
                    <div className="mt-4 border-t border-white/5 pt-3">
                      <p className="text-xs font-semibold text-slate-400 mb-2">
                        البنود المكتشفة التي تستلزم المراجعة ({chk.items!.length}):
                      </p>
                      <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                        {chk.items!.map(item => (
                          <div
                            key={item.id}
                            className="flex items-center justify-between rounded-lg bg-slate-950/80 border border-white/5 px-3 py-2 text-xs"
                          >
                            <div className="flex items-center gap-2">
                              {item.code && (
                                <span className="font-mono bg-white/5 px-1.5 py-0.5 rounded text-sky-300">
                                  {item.code}
                                </span>
                              )}
                              <span className="text-slate-200">{item.title}</span>
                              {item.extra && (
                                <span className="text-slate-400 text-[11px]">({item.extra})</span>
                              )}
                            </div>
                            {item.value !== undefined && (
                              <span dir="ltr" className="font-bold text-red-400 tabular-nums">
                                {fmt(item.value)} {cur}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ─── تبويب 2: سجل العمليات التاريخي ─── */}
      {activeTab === 'log' && (
        <div className="space-y-4">
          {/* فلتر الكيان */}
          <div className="flex flex-wrap gap-1 border-b border-white/5 pb-0">
            {entityTabs.map(t => (
              <Link
                key={t.key}
                href={`/dashboard/accounting/audit?tab=log${t.key ? `&entity=${t.key}` : ''}`}
                className={`px-4 py-2 text-xs font-semibold border-b-2 -mb-px transition-colors ${
                  (searchParams.entity ?? '') === t.key
                    ? 'border-sky-500 text-sky-400'
                    : 'border-transparent text-slate-400 hover:text-white'
                }`}
              >
                {t.label}
              </Link>
            ))}
          </div>

          {(!logs || logs.length === 0) ? (
            <div className="rounded-2xl border border-white/5 bg-slate-900/60 py-16 text-center">
              <p className="text-4xl">📜</p>
              <p className="mt-3 font-medium text-slate-300">لا توجد عمليات مسجّلة بعد</p>
              <p className="mt-1 text-xs text-slate-500">
                ستظهر هنا كل عمليات الفواتير والسندات والصندوق
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {logs.map(log => {
                const am = ACTION_META[log.action] ?? {
                  label: log.action,
                  icon: '•',
                  cls: 'bg-white/5 text-white',
                }
                const detail = describeDetails(
                  log.action,
                  (log.details ?? {}) as Record<string, unknown>,
                )
                return (
                  <div
                    key={log.id}
                    className="flex items-center gap-3 rounded-xl border border-white/5 bg-slate-900 px-4 py-3 hover:bg-slate-850 transition-colors"
                  >
                    <span className="text-lg">{am.icon}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${am.cls}`}
                        >
                          {am.label}
                        </span>
                        <span className="text-xs font-semibold text-slate-300">
                          {ENTITY_LABELS[log.entity_type] ?? log.entity_type}
                        </span>
                        {log.entity_label && (
                          <span className="font-mono text-xs text-sky-400" dir="ltr">
                            {log.entity_label}
                          </span>
                        )}
                        {detail && (
                          <span className="text-xs text-slate-400" dir="ltr">
                            — {detail}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-[11px] text-slate-500">
                        بواسطة: {log.actor_name ?? 'مستخدم'} ·{' '}
                        {new Date(log.created_at).toLocaleString('ar-u-nu-latn')}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
