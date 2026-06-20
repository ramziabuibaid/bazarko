import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import { redirect } from 'next/navigation'
import Link from 'next/link'

interface Props { searchParams: { status?: string } }

const STATUS_META: Record<string, { label: string; cls: string }> = {
  open:        { label: 'مفتوحة',     cls: 'bg-sky-500/15 text-sky-400' },
  in_progress: { label: 'قيد المعالجة', cls: 'bg-amber-500/15 text-amber-400' },
  resolved:    { label: 'محلولة',     cls: 'bg-emerald-500/15 text-emerald-400' },
  closed:      { label: 'مغلقة',      cls: 'bg-slate-500/15 text-slate-400' },
}

const CATEGORY_LABELS: Record<string, string> = {
  inquiry: 'استفسار', complaint: 'شكوى', return: 'إرجاع', warranty: 'ضمان', other: 'أخرى',
}

export default async function SupportPage({ searchParams }: Props) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const storeId = await getStoreForUser(supabase, user!.id)
  if (!storeId) redirect('/onboarding')

  let query = supabase
    .from('support_tickets')
    .select('id, ticket_number, customer_name, subject, category, status, priority, created_at')
    .eq('store_id', storeId)
    .order('created_at', { ascending: false })

  if (searchParams.status) query = query.eq('status', searchParams.status)

  const { data: tickets } = await query

  const { data: all } = await supabase
    .from('support_tickets')
    .select('status, priority')
    .eq('store_id', storeId)

  const allT = (all ?? []) as { status: string; priority: string }[]
  const countOpen     = allT.filter(t => t.status === 'open').length
  const countProgress = allT.filter(t => t.status === 'in_progress').length
  const countUrgent   = allT.filter(t => t.priority === 'urgent' && t.status !== 'closed' && t.status !== 'resolved').length
  const countResolved = allT.filter(t => t.status === 'resolved').length

  const TABS = [
    { key: '',            label: 'الكل',        count: allT.length },
    { key: 'open',        label: 'مفتوحة',      count: countOpen },
    { key: 'in_progress', label: 'قيد المعالجة', count: countProgress },
    { key: 'resolved',    label: 'محلولة',      count: countResolved },
    { key: 'closed',      label: 'مغلقة',       count: allT.filter(t => t.status === 'closed').length },
  ]

  const stats = [
    { label: 'مفتوحة',       value: countOpen,     color: 'text-sky-400' },
    { label: 'قيد المعالجة', value: countProgress, color: 'text-amber-400' },
    { label: 'عاجلة نشطة',   value: countUrgent,   color: 'text-red-400' },
    { label: 'محلولة',       value: countResolved, color: 'text-emerald-400' },
  ]

  return (
    <div className="space-y-5 p-4 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/dashboard/customers" className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-slate-400 hover:text-white">
            ← الزبائن
          </Link>
          <h1 className="text-xl font-semibold text-white">🎫 دعم الزبائن</h1>
        </div>
        <Link href="/dashboard/customers/support/new"
          className="rounded-xl bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500">
          ➕ تذكرة جديدة
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map(s => (
          <div key={s.label} className="rounded-2xl border border-white/5 bg-slate-900 p-4">
            <p className="text-xs text-slate-400">{s.label}</p>
            <p className={`mt-1 text-2xl font-bold ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-1 border-b border-white/5 pb-0">
        {TABS.map(t => (
          <Link key={t.key} href={`/dashboard/customers/support${t.key ? `?status=${t.key}` : ''}`}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              (searchParams.status ?? '') === t.key ? 'border-sky-500 text-sky-400' : 'border-transparent text-slate-400 hover:text-white'
            }`}>
            {t.label}<span className="mr-1.5 text-xs opacity-60">({t.count})</span>
          </Link>
        ))}
      </div>

      {(!tickets || tickets.length === 0) ? (
        <div className="rounded-2xl border border-white/5 bg-white/3 py-16 text-center">
          <p className="text-4xl">🎫</p>
          <p className="mt-3 font-medium text-slate-300">لا توجد تذاكر</p>
          <p className="mt-1 text-sm text-slate-500">سجّل استفسارات وشكاوى الزبائن وتابع حلّها</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-white/5 bg-slate-900">
          <table className="w-full text-sm">
            <thead className="border-b border-white/5 text-xs text-slate-500">
              <tr>
                <th className="px-4 py-3 text-right font-medium">الرقم</th>
                <th className="px-4 py-3 text-right font-medium">الموضوع</th>
                <th className="px-4 py-3 text-right font-medium">الزبون</th>
                <th className="px-4 py-3 text-center font-medium">التصنيف</th>
                <th className="px-4 py-3 text-center font-medium">الحالة</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {tickets.map(t => {
                const sm = STATUS_META[t.status] ?? { label: t.status, cls: 'bg-white/5 text-white' }
                return (
                  <tr key={t.id} className="hover:bg-white/3">
                    <td className="px-4 py-3 font-mono text-xs text-sky-400" dir="ltr">{t.ticket_number}</td>
                    <td className="px-4 py-3 text-white">
                      {t.priority === 'urgent' && <span className="ml-1 text-red-400">🔴</span>}
                      {t.subject}
                    </td>
                    <td className="px-4 py-3 text-slate-400">{t.customer_name ?? '—'}</td>
                    <td className="px-4 py-3 text-center">
                      <span className="rounded-full bg-white/5 px-2 py-0.5 text-xs text-slate-400">{CATEGORY_LABELS[t.category] ?? t.category}</span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${sm.cls}`}>{sm.label}</span>
                    </td>
                    <td className="px-4 py-3">
                      <Link href={`/dashboard/customers/support/${t.id}`}
                        className="rounded-lg bg-white/5 px-3 py-1.5 text-xs text-slate-300 hover:bg-sky-500/15 hover:text-sky-400">فتح</Link>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
