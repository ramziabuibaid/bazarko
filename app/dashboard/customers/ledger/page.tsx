import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import { redirect } from 'next/navigation'
import Link from 'next/link'

export default async function CustomerLedgerPage() {
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

  // زبائن لديهم ذمة (balance > 0) مرتبة من الأعلى
  const { data: debtors } = await supabase
    .from('customers')
    .select('id, name, phone, city, balance, total_orders, last_order_at, customer_type')
    .eq('store_id', store.id)
    .gt('balance', 0)
    .order('balance', { ascending: false })

  // زبائن مسددون (balance = 0 أو أقل) كانت لديهم ذمة (total_invoiced > 0)
  const { data: cleared } = await supabase
    .from('customers')
    .select('id, name, phone, city, balance, total_orders, total_paid, customer_type')
    .eq('store_id', store.id)
    .lte('balance', 0)
    .gt('total_orders', 0)
    .order('total_paid', { ascending: false })
    .limit(20)

  const totalDebt = (debtors ?? []).reduce((s, c) => s + c.balance, 0)

  const TYPE_COLORS: Record<string, string> = {
    retail:    'bg-slate-500/15 text-slate-400',
    wholesale: 'bg-blue-500/15 text-blue-400',
    vip:       'bg-amber-500/15 text-amber-400',
  }
  const TYPE_LABELS: Record<string, string> = {
    retail: 'تجزئة', wholesale: 'جملة', vip: 'VIP',
  }

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white">ذمم الزبائن</h1>
          <p className="mt-1 text-sm text-slate-400">
            {debtors?.length ?? 0} زبون لديه ذمة مستحقة
          </p>
        </div>
        <Link
          href="/dashboard/customers"
          className="rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-400 hover:text-white"
        >
          قائمة الزبائن
        </Link>
      </div>

      {/* إحصائيات */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-2xl border border-white/5 bg-slate-900 p-4">
          <p className="text-xs text-slate-400">💳 إجمالي الذمم</p>
          <p className="mt-1.5 text-xl font-bold text-red-400" dir="ltr">
            {totalDebt.toLocaleString('ar-u-nu-latn')} {store.currency_code}
          </p>
        </div>
        <div className="rounded-2xl border border-white/5 bg-slate-900 p-4">
          <p className="text-xs text-slate-400">📒 عدد المدينين</p>
          <p className="mt-1.5 text-xl font-bold text-white">{debtors?.length ?? 0}</p>
        </div>
        <div className="rounded-2xl border border-white/5 bg-slate-900 p-4">
          <p className="text-xs text-slate-400">✅ مسددون (آخر 20)</p>
          <p className="mt-1.5 text-xl font-bold text-emerald-400">{cleared?.length ?? 0}</p>
        </div>
      </div>

      {/* جدول المدينين */}
      {(debtors?.length ?? 0) === 0 ? (
        <div className="rounded-2xl border border-white/5 bg-white/3 py-16 text-center">
          <p className="text-4xl">🎉</p>
          <p className="mt-3 font-semibold text-white">لا توجد ذمم مستحقة</p>
          <p className="mt-1 text-sm text-slate-400">كل الزبائن مسددون</p>
        </div>
      ) : (
        <div>
          <h2 className="mb-3 font-semibold text-white">الزبائن المدينون</h2>
          <div className="overflow-x-auto rounded-2xl border border-white/5">
            <table className="min-w-[680px] w-full text-sm">
              <thead>
                <tr className="border-b border-white/5 bg-white/3">
                  <th className="px-4 py-3 text-right text-xs font-medium text-slate-400">الزبون</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-slate-400">الهاتف</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-slate-400">النوع</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-slate-400">الطلبيات</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-red-400">الذمة</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {(debtors ?? []).map(c => (
                  <tr key={c.id} className="hover:bg-white/3 transition-colors">
                    <td className="px-4 py-3">
                      <p className="font-medium text-white">{c.name}</p>
                      {c.city && <p className="text-xs text-slate-500">{c.city}</p>}
                    </td>
                    <td className="px-4 py-3 text-slate-300" dir="ltr">
                      {c.phone ? (
                        <div className="flex items-center gap-2">
                          <a href={`tel:${c.phone}`} className="hover:text-white">{c.phone}</a>
                          <a
                            href={`https://wa.me/${c.phone.replace(/\D/g, '')}`}
                            target="_blank" rel="noopener noreferrer"
                            className="text-emerald-400 hover:text-emerald-300 text-xs"
                          >
                            💬
                          </a>
                        </div>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${TYPE_COLORS[c.customer_type] ?? TYPE_COLORS.retail}`}>
                        {TYPE_LABELS[c.customer_type] ?? c.customer_type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-300">{c.total_orders}</td>
                    <td className="px-4 py-3 text-left">
                      <span className="font-semibold text-red-400" dir="ltr">
                        {c.balance.toLocaleString('ar-u-nu-latn')} {store.currency_code}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/dashboard/customers/${c.id}`}
                        className="rounded-lg bg-white/5 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/10 hover:text-white"
                      >
                        الملف
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-white/10 bg-white/3">
                  <td colSpan={4} className="px-4 py-3 font-bold text-white">الإجمالي</td>
                  <td className="px-4 py-3 text-left font-bold text-red-400 text-base" dir="ltr">
                    {totalDebt.toLocaleString('ar-u-nu-latn')} {store.currency_code}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* جدول المسددين الأخيرين */}
      {(cleared?.length ?? 0) > 0 && (
        <div>
          <h2 className="mb-3 font-semibold text-slate-400">مسددون مؤخراً (آخر 20)</h2>
          <div className="overflow-x-auto rounded-2xl border border-white/5">
            <table className="min-w-[680px] w-full text-sm">
              <thead>
                <tr className="border-b border-white/5 bg-white/3">
                  <th className="px-4 py-3 text-right text-xs font-medium text-slate-400">الزبون</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-slate-400">النوع</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-slate-400">الطلبيات</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-emerald-400">إجمالي المدفوع</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {(cleared ?? []).map(c => (
                  <tr key={c.id} className="hover:bg-white/3 transition-colors">
                    <td className="px-4 py-3">
                      <p className="font-medium text-white">{c.name}</p>
                      {c.city && <p className="text-xs text-slate-500">{c.city}</p>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${TYPE_COLORS[c.customer_type] ?? TYPE_COLORS.retail}`}>
                        {TYPE_LABELS[c.customer_type] ?? c.customer_type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-300">{c.total_orders}</td>
                    <td className="px-4 py-3 text-left text-emerald-400" dir="ltr">
                      {(c.total_paid ?? 0).toLocaleString('ar-u-nu-latn')} {store.currency_code}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/dashboard/customers/${c.id}`}
                        className="rounded-lg bg-white/5 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/10 hover:text-white"
                      >
                        الملف
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
