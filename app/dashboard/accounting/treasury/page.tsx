import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import { getAllCashBoxesWithBalances, getCashBalance, type CashBox } from '@/lib/accounting/treasury'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import TreasuryClient from '@/components/dashboard/accounting/TreasuryClient'

const SOURCE_LABELS: Record<string, string> = {
  voucher: 'سند',
  order: 'طلبية',
  invoice: 'فاتورة',
  manual: 'يدوي',
  closing: 'تسوية',
  opening: 'افتتاحي',
  transfer: 'تحويل',
}

const BOX_TYPE_BADGES: Record<string, { label: string; icon: string; cls: string }> = {
  cash: { label: 'نقد', icon: '💵', cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
  bank: { label: 'بنك', icon: '🏦', cls: 'bg-blue-500/15 text-blue-400 border-blue-500/30' },
  personal: { label: 'شخصي', icon: '👤', cls: 'bg-purple-500/15 text-purple-400 border-purple-500/30' },
  checks_collection: { label: 'تحصيل شيكات', icon: '🧾', cls: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
  checks_received: { label: 'شيكات مقبوضة', icon: '📥', cls: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30' },
  checks_issued: { label: 'شيكات صادرة', icon: '📤', cls: 'bg-rose-500/15 text-rose-400 border-rose-500/30' },
  wallet: { label: 'محفظة إلكترونية', icon: '📱', cls: 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30' },
}

interface SearchParams {
  box_id?: string
}

export default async function TreasuryPage({ searchParams }: { searchParams: SearchParams }) {
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
  if (!store) redirect('/onboarding')

  // جلب كافة الصناديق والخزائن مع أرصدتها وحساباتها المرتبطة
  const boxes = await getAllCashBoxesWithBalances(supabase, store.id)
  if (!boxes || boxes.length === 0) {
    return <div className="p-4 sm:p-6 text-slate-400">تعذّر تجهيز الصناديق. أعد المحاولة.</div>
  }

  // جلب دليل وشجرة الحسابات لاختيار الربط
  const { data: accountsData } = await supabase
    .from('accounts')
    .select('id, code, name, type')
    .eq('store_id', store.id)
    .eq('is_active', true)
    .order('code', { ascending: true })

  const accounts = accountsData ?? []

  // الصندوق النشط المختار
  const currentBox: CashBox =
    boxes.find(b => b.id === searchParams?.box_id) ||
    boxes.find(b => b.is_default) ||
    boxes[0]

  const currentBalance = await getCashBalance(
    supabase,
    store.id,
    currentBox.id,
    currentBox.opening_balance,
  )

  const today = new Date().toISOString().split('T')[0]

  const [{ data: todayMovements }, { data: recentMovements }, { data: sessions }, { data: storeCustomers }] =
    await Promise.all([
      supabase
        .from('cash_movements')
        .select('direction, amount')
        .eq('store_id', store.id)
        .eq('cash_box_id', currentBox.id)
        .eq('date', today),
      supabase
        .from('cash_movements')
        .select('id, direction, amount, source, ref_id, party_name, payment_method, description, date, created_at')
        .eq('store_id', store.id)
        .eq('cash_box_id', currentBox.id)
        .order('created_at', { ascending: false })
        .limit(30),
      supabase
        .from('cash_sessions')
        .select('id, closed_at, system_total, counted_amount, variance, notes')
        .eq('store_id', store.id)
        .eq('cash_box_id', currentBox.id)
        .eq('status', 'closed')
        .order('closed_at', { ascending: false })
        .limit(5),
      supabase
        .from('customers')
        .select('id, name')
        .eq('store_id', store.id),
    ])

  // Map customer names to their IDs for quick lookup
  const customerMap = new Map<string, string>()
  for (const c of storeCustomers ?? []) {
    if (c.name) customerMap.set(c.name.trim().toLowerCase(), c.id)
  }

  const todayIn = (todayMovements ?? [])
    .filter(m => m.direction === 'in')
    .reduce((s, m) => s + m.amount, 0)
  const todayOut = (todayMovements ?? [])
    .filter(m => m.direction === 'out')
    .reduce((s, m) => s + m.amount, 0)
  const todayNet = todayIn - todayOut

  // الإجماليات عبر كامل الصناديق
  const totalTreasuryBalance = boxes.reduce((acc, b) => acc + (b.balance ?? 0), 0)
  const unlinkedBoxesCount = boxes.filter(b => !b.account_id).length

  const cur = store.currency_code
  const fmt = (n: number) => n.toLocaleString('ar-u-nu-latn', { maximumFractionDigits: 2 })

  const currentTypeBadge = BOX_TYPE_BADGES[currentBox.type] ?? {
    label: currentBox.type,
    icon: '💰',
    cls: 'bg-white/10 text-white border-white/20',
  }

  return (
    <div className="space-y-6 p-4 sm:p-6">
      {/* العنوان والتوجيه */}
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
              🏦 الصناديق والخزينة
            </h1>
            <p className="mt-0.5 text-xs text-slate-400">
              إدارة الخزائن النقدية، البنوك، الشيكات، وحسابات العهد وربطها بدليل الحسابات
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/dashboard/accounting/accounts"
            className="rounded-xl border border-white/10 bg-slate-900 px-3.5 py-2 text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
          >
            🌳 دليل الحسابات
          </Link>
        </div>
      </div>

      {/* بطاقات المؤشرات العامة لجميع الصناديق */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-emerald-400">إجمالي سيولة الخزائن والصناديق</p>
            <p dir="ltr" className="mt-1 text-2xl font-bold tabular-nums text-white">
              {fmt(totalTreasuryBalance)} <span className="text-xs font-normal text-slate-400">{cur}</span>
            </p>
          </div>
          <span className="text-3xl opacity-80">💎</span>
        </div>

        <div className="rounded-2xl border border-white/10 bg-slate-900/80 p-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-slate-400">عدد الصناديق والخزائن</p>
            <p dir="ltr" className="mt-1 text-2xl font-bold tabular-nums text-white">
              {boxes.length} <span className="text-xs font-normal text-slate-400">صناديق مسجلة</span>
            </p>
          </div>
          <span className="text-3xl opacity-80">🏦</span>
        </div>

        <div
          className={`rounded-2xl border p-4 flex items-center justify-between ${
            unlinkedBoxesCount > 0
              ? 'border-amber-500/30 bg-amber-500/10'
              : 'border-white/10 bg-slate-900/80'
          }`}
        >
          <div>
            <p
              className={`text-xs font-semibold ${
                unlinkedBoxesCount > 0 ? 'text-amber-400' : 'text-slate-400'
              }`}
            >
              ربط شجرة الحسابات
            </p>
            <p dir="ltr" className="mt-1 text-base font-bold tabular-nums text-white">
              {unlinkedBoxesCount === 0 ? (
                <span className="text-emerald-400 text-sm">✓ جميع الصناديق مربوطة دفترياً</span>
              ) : (
                <span className="text-amber-400 text-sm">
                  ⚠️ {unlinkedBoxesCount} صندوق يحتاج ربطاً محاسبياً
                </span>
              )}
            </p>
          </div>
          <span className="text-3xl opacity-80">{unlinkedBoxesCount > 0 ? '⚠️' : '✅'}</span>
        </div>
      </div>

      {/* قائمة الصناديق المتوفرة والتبديل بينها */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            اختر الصندوق أو الخزينة للعرض والإدارة ({boxes.length})
          </h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {boxes.map(b => {
            const isSelected = b.id === currentBox.id
            const badge = BOX_TYPE_BADGES[b.type] ?? {
              label: b.type,
              icon: '💰',
              cls: 'bg-white/10 text-white border-white/20',
            }
            const boxBal = b.balance ?? 0

            return (
              <Link
                key={b.id}
                href={`/dashboard/accounting/treasury?box_id=${b.id}`}
                className={`relative rounded-2xl border p-4 transition-all block text-right group ${
                  isSelected
                    ? 'border-sky-500 bg-sky-950/20 ring-1 ring-sky-500/40 shadow-lg shadow-sky-500/5'
                    : 'border-white/5 bg-slate-900/90 hover:border-white/20 hover:bg-slate-850'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-bold text-white text-sm truncate">{b.name}</span>
                      {b.is_default && (
                        <span className="rounded bg-sky-500/20 border border-sky-500/40 px-1.5 py-0.2 text-[10px] font-bold text-sky-300">
                          افتراضي
                        </span>
                      )}
                    </div>

                    <div className="mt-2 flex items-center gap-1.5">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${badge.cls}`}
                      >
                        <span>{badge.icon}</span>
                        <span>{badge.label}</span>
                      </span>
                    </div>
                  </div>

                  <span className="text-xl group-hover:scale-110 transition-transform">
                    {badge.icon}
                  </span>
                </div>

                {/* الحساب الدفتري المرتبط */}
                <div className="mt-3 text-[11px] border-t border-white/5 pt-2 truncate">
                  {b.account ? (
                    <span className="text-slate-300 flex items-center gap-1">
                      <span className="text-sky-400">🔗</span>
                      <span className="font-mono text-slate-400">{b.account.code}</span> -{' '}
                      <span className="truncate">{b.account.name}</span>
                    </span>
                  ) : (
                    <span className="text-amber-400/90 flex items-center gap-1">
                      <span>⚠️</span> غير مربوط بحساب
                    </span>
                  )}
                </div>

                {/* الرصيد */}
                <div className="mt-3 flex items-baseline justify-between border-t border-white/5 pt-2">
                  <span className="text-[11px] text-slate-500">الرصيد:</span>
                  <span
                    dir="ltr"
                    className={`text-base font-bold tabular-nums ${
                      boxBal > 0
                        ? 'text-emerald-400'
                        : boxBal < 0
                        ? 'text-red-400'
                        : 'text-slate-300'
                    }`}
                  >
                    {fmt(boxBal)} <span className="text-xs font-normal text-slate-400">{cur}</span>
                  </span>
                </div>
              </Link>
            )
          })}
        </div>
      </div>

      {/* بطاقة تفاصيل وإدارة الصندوق المختار */}
      <div
        className={`rounded-2xl border p-5 sm:p-6 transition-all ${
          currentBalance > 0
            ? 'border-emerald-500/20 bg-gradient-to-b from-emerald-500/5 to-transparent'
            : currentBalance < 0
            ? 'border-red-500/20 bg-gradient-to-b from-red-500/5 to-transparent'
            : 'border-white/10 bg-slate-900'
        }`}
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-semibold uppercase tracking-widest text-slate-500">
                الصندوق المحدد حالياً
              </span>
              <span
                className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${currentTypeBadge.cls}`}
              >
                <span>{currentTypeBadge.icon}</span>
                <span>{currentTypeBadge.label}</span>
              </span>
              {currentBox.is_default && (
                <span className="rounded bg-sky-500/20 border border-sky-500/40 px-2 py-0.5 text-xs font-bold text-sky-300">
                  الصندوق الافتراضي للمبيعات
                </span>
              )}
            </div>

            <h2 className="mt-1 text-2xl font-bold text-white flex items-center gap-2">
              {currentBox.name}
            </h2>

            {currentBox.account ? (
              <p className="mt-1 text-xs text-sky-400 flex items-center gap-1.5">
                <span>🔗 الحساب الدفتري المرتبط:</span>
                <span className="font-mono bg-sky-500/10 px-1.5 py-0.5 rounded border border-sky-500/20 text-sky-300">
                  {currentBox.account.code} - {currentBox.account.name}
                </span>
              </p>
            ) : (
              <p className="mt-1 text-xs text-amber-400 flex items-center gap-1.5">
                <span>⚠️ غير مربوط بشجرة الحسابات — انقر على &quot;ربط بشجرة الحسابات&quot; لتوجيهه</span>
              </p>
            )}
          </div>

          <div className="text-left sm:text-right">
            <p className="text-xs text-slate-400">الرصيد الدفتري الحالي</p>
            <p
              dir="ltr"
              className={`text-4xl sm:text-5xl font-extrabold tabular-nums tracking-tight ${
                currentBalance > 0
                  ? 'text-emerald-400'
                  : currentBalance < 0
                  ? 'text-red-400'
                  : 'text-slate-200'
              }`}
            >
              {fmt(currentBalance)}
              <span className="mr-2 text-base sm:text-lg font-normal text-slate-400">{cur}</span>
            </p>
            <p className="mt-0.5 text-xs text-slate-500">
              الافتتاحي: {fmt(currentBox.opening_balance)} {cur}
            </p>
          </div>
        </div>

        {/* أزرار العمليات والإدارة من TreasuryClient */}
        <TreasuryClient
          currencyCode={cur}
          currentBox={currentBox}
          systemBalance={currentBalance}
          accounts={accounts}
          allBoxes={boxes.map(b => ({ id: b.id, name: b.name, type: b.type }))}
        />
      </div>

      {/* ملخص اليوم للصندوق المحدد */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-2xl border border-emerald-500/15 bg-slate-900/90 p-4">
          <p className="text-xs text-slate-400">📥 داخل اليوم ({currentBox.name})</p>
          <p dir="ltr" className="mt-2 text-xl font-bold tabular-nums text-emerald-400 sm:text-2xl">
            {fmt(todayIn)}
          </p>
        </div>
        <div className="rounded-2xl border border-red-500/15 bg-slate-900/90 p-4">
          <p className="text-xs text-slate-400">📤 خارج اليوم ({currentBox.name})</p>
          <p dir="ltr" className="mt-2 text-xl font-bold tabular-nums text-red-400 sm:text-2xl">
            {fmt(todayOut)}
          </p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-slate-900/90 p-4">
          <p className="text-xs text-slate-400">💵 صافي حركة اليوم</p>
          <p
            dir="ltr"
            className={`mt-2 text-xl font-bold tabular-nums sm:text-2xl ${
              todayNet >= 0 ? 'text-emerald-400' : 'text-red-400'
            }`}
          >
            {todayNet >= 0 ? '+' : ''}
            {fmt(todayNet)}
          </p>
        </div>
      </div>

      {/* آخر عمليات الإغلاق للصندوق */}
      {(sessions ?? []).length > 0 && (
        <div>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
            آخر عمليات الإغلاق والمطابقة لـ ({currentBox.name})
          </h2>
          <div className="space-y-2">
            {(sessions ?? []).map(s => (
              <div
                key={s.id}
                className="flex items-center justify-between rounded-xl border border-white/5 bg-slate-900 px-4 py-3 text-sm"
              >
                <div>
                  <p className="text-slate-300 font-medium">
                    {s.closed_at
                      ? new Date(s.closed_at).toLocaleString('ar-u-nu-latn')
                      : '—'}
                  </p>
                  {s.notes && <p className="mt-0.5 text-xs text-slate-500">{s.notes}</p>}
                </div>
                <div className="flex items-center gap-4 text-xs" dir="ltr">
                  <span className="text-slate-400">نظام {fmt(s.system_total)}</span>
                  <span className="text-slate-400">فعلي {fmt(s.counted_amount ?? 0)}</span>
                  <span
                    className={`font-bold ${
                      (s.variance ?? 0) === 0
                        ? 'text-slate-400'
                        : (s.variance ?? 0) > 0
                        ? 'text-emerald-400'
                        : 'text-red-400'
                    }`}
                  >
                    {(s.variance ?? 0) > 0 ? '+' : ''}
                    {fmt(s.variance ?? 0)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* آخر الحركات للصندوق المحدد */}
      <div>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
          آخر حركات ({currentBox.name})
        </h2>
        {(recentMovements ?? []).length === 0 ? (
          <p className="rounded-2xl border border-white/5 bg-slate-900 p-8 text-center text-sm text-slate-500">
            لا توجد حركات مسجلة لهذا الصندوق بعد
          </p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-white/5 bg-slate-900">
            <table className="min-w-[680px] w-full text-sm">
              <thead className="border-b border-white/5 text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-3 text-right font-medium">الوصف</th>
                  <th className="px-4 py-3 text-right font-medium">المصدر</th>
                  <th className="px-4 py-3 text-right font-medium">التاريخ</th>
                  <th className="px-4 py-3 text-left font-medium">المبلغ ({cur})</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {(recentMovements ?? []).map(m => {
                  const customerId = m.party_name ? customerMap.get(m.party_name.trim().toLowerCase()) : null
                  return (
                    <tr key={m.id} className="hover:bg-white/2 transition-colors">
                      <td className="px-4 py-3 text-slate-300">
                        {m.description}
                        {m.party_name && (
                          <span className="mr-1.5 text-xs text-slate-400">
                            ·{' '}
                            {customerId ? (
                              <Link
                                href={`/dashboard/customers/${customerId}`}
                                className="text-sky-400 hover:underline font-medium"
                              >
                                {m.party_name}
                              </Link>
                            ) : (
                              m.party_name
                            )}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-400">
                        <span className="rounded bg-white/5 px-2 py-0.5">
                          {SOURCE_LABELS[m.source] ?? m.source}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-400 font-mono" dir="ltr">
                        {m.date}
                      </td>
                      <td
                        dir="ltr"
                        className={`px-4 py-3 text-left font-bold tabular-nums ${
                          m.direction === 'in' ? 'text-emerald-400' : 'text-red-400'
                        }`}
                      >
                        {m.direction === 'in' ? '+' : '−'}
                        {fmt(m.amount)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
