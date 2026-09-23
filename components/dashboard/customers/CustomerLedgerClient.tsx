'use client'

import { useState, useMemo, useEffect, useTransition } from 'react'
import Link from 'next/link'
import { getCustomerStatement, CustomerStatementResult, CustomerStatementRow } from '@/app/dashboard/customers/ledger/customer-statement-actions'
import { useToast } from '@/components/ui/Toast'

export interface CustomerItem {
  id: string
  name: string
  phone: string | null
  city: string | null
  balance: number
  total_orders?: number
  customer_type: string
  credit_limit?: number
  total_paid?: number
}

interface Props {
  customers: CustomerItem[]
  currencyCode: string
  storeName: string
  initialCustomerId?: string
}

const TYPE_COLORS: Record<string, string> = {
  retail: 'bg-slate-500/15 text-slate-400 border border-slate-500/20',
  wholesale: 'bg-blue-500/15 text-blue-400 border border-blue-500/20',
  vip: 'bg-amber-500/15 text-amber-400 border border-amber-500/20',
}

const TYPE_LABELS: Record<string, string> = {
  retail: 'تجزئة',
  wholesale: 'جملة',
  vip: 'VIP',
}

export default function CustomerLedgerClient({
  customers,
  currencyCode,
  storeName,
  initialCustomerId,
}: Props) {
  const toast = useToast()
  const [isPending, startTransition] = useTransition()

  // فلاتر قائمة العملاء
  const [search, setSearch] = useState('')
  const [balanceFilter, setBalanceFilter] = useState<'all' | 'debtors' | 'cleared' | 'creditors'>('all')

  // العميل المختار لكشف الحساب
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>(initialCustomerId || '')
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerItem | null>(null)

  // فلاتر الفترة المحاسبية للكشف
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')

  // بيانات كشف الحساب
  const [statementData, setStatementData] = useState<CustomerStatementResult | null>(null)
  const [loadingStatement, setLoadingStatement] = useState(false)

  const fmt = (n: number) =>
    Number(n || 0).toLocaleString('ar-u-nu-latn', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })

  // تصفية العملاء
  const filteredCustomers = useMemo(() => {
    return customers.filter(c => {
      const matchSearch =
        !search ||
        c.name.toLowerCase().includes(search.toLowerCase()) ||
        (c.phone && c.phone.includes(search)) ||
        (c.city && c.city.toLowerCase().includes(search.toLowerCase()))

      if (!matchSearch) return false

      if (balanceFilter === 'debtors') return (c.balance || 0) > 0.001
      if (balanceFilter === 'cleared') return Math.abs(c.balance || 0) <= 0.001
      if (balanceFilter === 'creditors') return (c.balance || 0) < -0.001
      return true
    })
  }, [customers, search, balanceFilter])

  // إحصائيات عامة
  const stats = useMemo(() => {
    let totalDebt = 0
    let totalCredit = 0
    let debtorsCount = 0
    let clearedCount = 0
    let creditorsCount = 0

    customers.forEach(c => {
      const b = c.balance || 0
      if (b > 0.001) {
        totalDebt += b
        debtorsCount++
      } else if (b < -0.001) {
        totalCredit += Math.abs(b)
        creditorsCount++
      } else {
        clearedCount++
      }
    })

    return { totalDebt, totalCredit, debtorsCount, clearedCount, creditorsCount, totalCount: customers.length }
  }, [customers])

  // ضبط العميل الافتراضي عند فتح الصفحة
  useEffect(() => {
    if (initialCustomerId) {
      const found = customers.find(c => c.id === initialCustomerId)
      if (found) {
        selectCustomer(found)
      }
    }
  }, [initialCustomerId, customers])

  function selectCustomer(cust: CustomerItem) {
    setSelectedCustomerId(cust.id)
    setSelectedCustomer(cust)
    loadStatement(cust.id, fromDate, toDate)
  }

  function loadStatement(custId: string, from: string, to: string) {
    setLoadingStatement(true)
    startTransition(async () => {
      const res = await getCustomerStatement(custId, from || undefined, to || undefined)
      if (!res.success) {
        toast(res.error || 'فشل تحميل كشف الحساب', 'error')
      }
      setStatementData(res)
      setLoadingStatement(false)
    })
  }

  function handleFilterDates(from: string, to: string) {
    setFromDate(from)
    setToDate(to)
    if (selectedCustomerId) {
      loadStatement(selectedCustomerId, from, to)
    }
  }

  function setPresetRange(preset: 'today' | 'week' | 'month' | 'quarter' | 'year' | 'all') {
    const today = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    const toStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`

    if (preset === 'all') {
      handleFilterDates('', '')
      return
    }

    if (preset === 'today') {
      handleFilterDates(toStr, toStr)
      return
    }

    if (preset === 'week') {
      const d = new Date()
      d.setDate(d.getDate() - 7)
      const fromStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
      handleFilterDates(fromStr, toStr)
      return
    }

    if (preset === 'month') {
      const fromStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-01`
      handleFilterDates(fromStr, toStr)
      return
    }

    if (preset === 'quarter') {
      const currentMonth = today.getMonth()
      const quarterStartMonth = Math.floor(currentMonth / 3) * 3
      const fromStr = `${today.getFullYear()}-${pad(quarterStartMonth + 1)}-01`
      handleFilterDates(fromStr, toStr)
      return
    }

    if (preset === 'year') {
      const fromStr = `${today.getFullYear()}-01-01`
      handleFilterDates(fromStr, toStr)
      return
    }
  }

  // رابط واتساب برسمي احترافي
  function getWhatsAppShareUrl(customer: CustomerItem, statement?: CustomerStatementResult | null) {
    if (!customer.phone) return null
    const cleanPhone = customer.phone.replace(/\D/g, '')
    if (!cleanPhone) return null

    const opening = statement ? fmt(statement.openingBalance) : '0.00'
    const debits = statement ? fmt(statement.totalDebit) : '0.00'
    const credits = statement ? fmt(statement.totalCredit) : '0.00'
    const closing = statement ? fmt(statement.closingBalance) : fmt(customer.balance)

    const dateNotice = fromDate || toDate
      ? `📅 الفترة: من ${fromDate || 'البداية'} إلى ${toDate || 'تاريخه'}\n`
      : `📅 تاريخ الكشف: ${new Date().toISOString().slice(0, 10)}\n`

    const printUrl = typeof window !== 'undefined'
      ? `${window.location.origin}/dashboard/customers/${customer.id}/statement/print${fromDate || toDate ? `?from=${fromDate}&to=${toDate}` : ''}`
      : `/dashboard/customers/${customer.id}/statement/print`

    const text = `مرحباً أخي الكريم / السادة: *${customer.name}* المحترمين،\n` +
      `نرفق لكم ملخص كشف الحساب المالي لدى *${storeName}*:\n\n` +
      dateNotice +
      `📌 الرصيد الافتتاحي: ${opening} ${currencyCode}\n` +
      `➕ إجمالي المبيعات (مدين): ${debits} ${currencyCode}\n` +
      `➖ إجمالي المسدد (دائن): ${credits} ${currencyCode}\n` +
      `━━━━━━━━━━━━━━━\n` +
      `⚖️ *صافي الرصيد المستحق: ${closing} ${currencyCode}*\n` +
      `━━━━━━━━━━━━━━━\n\n` +
      `📄 للاطلاع على تفاصيل الفواتير والسندات:\n` +
      `${printUrl}\n\n` +
      `شاكرين ومقدرين حسن تعاونكم معنا 🙏`

    return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(text)}`
  }

  return (
    <div className="space-y-6">
      {/* ── البطاقات الإحصائية العلوية ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-4 relative overflow-hidden">
          <p className="text-xs font-semibold text-rose-400">إجمالي الذمم المطلوبة (المدينين)</p>
          <p className="mt-2 text-2xl font-black font-mono text-rose-300" dir="ltr">
            {fmt(stats.totalDebt)} {currencyCode}
          </p>
          <div className="mt-1 flex items-center justify-between text-xs text-rose-400/80">
            <span>{stats.debtorsCount} عميل مدين</span>
            <span>ذمم نشطة ⚠️</span>
          </div>
        </div>

        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4 relative overflow-hidden">
          <p className="text-xs font-semibold text-emerald-400">العملاء المسددون (رصيد 0)</p>
          <p className="mt-2 text-2xl font-black font-mono text-emerald-300">
            {stats.clearedCount}
          </p>
          <div className="mt-1 text-xs text-emerald-400/80">
            تم تسوية كامل الحسابات ✅
          </div>
        </div>

        <div className="rounded-2xl border border-sky-500/20 bg-sky-500/5 p-4 relative overflow-hidden">
          <p className="text-xs font-semibold text-sky-400">أرصدة دائنة للعملاء (لهم لدينا)</p>
          <p className="mt-2 text-2xl font-black font-mono text-sky-300" dir="ltr">
            {fmt(stats.totalCredit)} {currencyCode}
          </p>
          <div className="mt-1 text-xs text-sky-400/80">
            {stats.creditorsCount} عميل لديه رصيد دائن
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-slate-900/90 p-4 relative overflow-hidden">
          <p className="text-xs font-semibold text-slate-400">إجمالي قاعدة العملاء المسجلة</p>
          <p className="mt-2 text-2xl font-black font-mono text-white">
            {stats.totalCount}
          </p>
          <div className="mt-1 text-xs text-slate-400">
            شامل كافة الأصناف والأرصدة
          </div>
        </div>
      </div>

      {/* ── لوحة الفحص السريع والبحث عن عميل ── */}
      <div className="rounded-2xl border border-white/10 bg-slate-900/90 p-4 sm:p-5 shadow-sm space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <span>📋</span>
              <span>مستكشف كشوف حسابات العملاء</span>
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              اختر أي زبون لعرض كشف حسابه التراكمي، حساب الرصيد الافتتاحي، والطباعة الرسمية A4 أو المشاركة عبر واتساب.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href="/dashboard/accounting/receipts?new=1"
              className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 px-3.5 py-2 text-xs font-bold text-white shadow-sm transition"
            >
              <span>+</span>
              <span>سند قبض جديد</span>
            </Link>
            <Link
              href="/dashboard/customers/new"
              className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 px-3.5 py-2 text-xs font-medium text-slate-300 transition"
            >
              <span>+</span>
              <span>إضافة زبون</span>
            </Link>
          </div>
        </div>

        {/* حقل البحث السريع والفلاتر */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <div className="relative flex-1">
            <span className="absolute right-3.5 top-2.5 text-slate-500">🔍</span>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="ابحث باسم الزبون، رقم الهاتف، أو المدينة..."
              className="w-full rounded-xl border border-white/10 bg-slate-800/80 py-2.5 pr-10 pl-4 text-sm text-white placeholder-slate-500 focus:border-sky-500 focus:outline-none transition"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute left-3 top-2.5 text-xs text-slate-400 hover:text-white"
              >
                ✕
              </button>
            )}
          </div>

          <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-slate-800/50 p-1">
            {([
              { key: 'all', label: `الكل (${customers.length})` },
              { key: 'debtors', label: `مدين (${stats.debtorsCount})` },
              { key: 'cleared', label: `مسدد (${stats.clearedCount})` },
              { key: 'creditors', label: `دائن (${stats.creditorsCount})` },
            ] as const).map(f => (
              <button
                key={f.key}
                onClick={() => setBalanceFilter(f.key)}
                className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${
                  balanceFilter === f.key
                    ? 'bg-sky-500 text-slate-950 font-bold shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── قسم كشف الحساب التفصيلي للعميل المختار ── */}
      {selectedCustomer && (
        <div className="rounded-2xl border border-sky-500/30 bg-slate-900/95 p-4 sm:p-6 shadow-xl space-y-6">
          {/* ترويسة العميل المختار */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/10 pb-5">
            <div className="space-y-1">
              <div className="flex items-center gap-3">
                <span className="text-2xl">👤</span>
                <h3 className="text-xl font-bold text-white">{selectedCustomer.name}</h3>
                <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${TYPE_COLORS[selectedCustomer.customer_type] || TYPE_COLORS.retail}`}>
                  {TYPE_LABELS[selectedCustomer.customer_type] || selectedCustomer.customer_type}
                </span>
                <button
                  onClick={() => {
                    setSelectedCustomer(null)
                    setSelectedCustomerId('')
                    setStatementData(null)
                  }}
                  className="text-xs text-slate-400 hover:text-rose-400 transition"
                  title="إغلاق كشف هذا العميل"
                >
                  ✕ إغلاق
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-4 text-xs text-slate-400 pt-1">
                {selectedCustomer.phone && (
                  <span className="flex items-center gap-1 font-mono" dir="ltr">
                    📞 {selectedCustomer.phone}
                  </span>
                )}
                {selectedCustomer.city && (
                  <span className="flex items-center gap-1">
                    📍 {selectedCustomer.city}
                  </span>
                )}
                <Link
                  href={`/dashboard/customers/${selectedCustomer.id}`}
                  className="text-sky-400 hover:underline"
                >
                  عرض ملف العميل الكامل ←
                </Link>
              </div>
            </div>

            {/* بطاقة الرصيد الفوري وأزرار الإجراءات */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              <div className="rounded-xl border border-white/10 bg-slate-800/80 px-4 py-2.5 text-right sm:text-left">
                <span className="text-[11px] text-slate-400 block">صافي الرصيد الحالي:</span>
                <span
                  className={`text-lg font-black font-mono tracking-tight ${
                    selectedCustomer.balance > 0.001
                      ? 'text-rose-400'
                      : selectedCustomer.balance < -0.001
                      ? 'text-sky-400'
                      : 'text-emerald-400'
                  }`}
                  dir="ltr"
                >
                  {fmt(Math.abs(selectedCustomer.balance))} {currencyCode}
                  <span className="text-xs mr-1 font-sans">
                    {selectedCustomer.balance > 0.001 ? '(مدين / عليه)' : selectedCustomer.balance < -0.001 ? '(دائن / له)' : '(مسدد)'}
                  </span>
                </span>
              </div>

              {/* أزرار الطباعة والواتساب وسند القبض */}
              <div className="flex items-center gap-2">
                <Link
                  href={`/dashboard/customers/${selectedCustomer.id}/statement/print${fromDate || toDate ? `?from=${fromDate}&to=${toDate}` : ''}`}
                  target="_blank"
                  className="flex items-center gap-1.5 rounded-xl bg-sky-500 hover:bg-sky-400 px-3.5 py-2 text-xs font-bold text-slate-950 shadow transition"
                >
                  <span>🖨️</span>
                  <span>طباعة A4 رسمية</span>
                </Link>

                {selectedCustomer.phone && (
                  <a
                    href={getWhatsAppShareUrl(selectedCustomer, statementData) || '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 px-3.5 py-2 text-xs font-bold text-white shadow transition"
                  >
                    <span>💬</span>
                    <span>إرسال واتساب</span>
                  </a>
                )}

                <Link
                  href={`/dashboard/accounting/receipts?new=1&customer_id=${selectedCustomer.id}`}
                  className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 px-3 py-2 text-xs font-medium text-slate-300 transition"
                >
                  <span>💵</span>
                  <span>قبض دفعة</span>
                </Link>
              </div>
            </div>
          </div>

          {/* فلاتر الفترة الزمنية مع أزرار سريعة */}
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 bg-slate-800/40 p-3.5 rounded-xl border border-white/5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-slate-400">الفترة الزمنية:</span>
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-slate-500">من:</span>
                <input
                  type="date"
                  value={fromDate}
                  onChange={e => handleFilterDates(e.target.value, toDate)}
                  className="rounded-lg border border-white/10 bg-slate-900 px-2.5 py-1 text-xs text-white focus:border-sky-500 focus:outline-none"
                />
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-slate-500">إلى:</span>
                <input
                  type="date"
                  value={toDate}
                  onChange={e => handleFilterDates(fromDate, e.target.value)}
                  className="rounded-lg border border-white/10 bg-slate-900 px-2.5 py-1 text-xs text-white focus:border-sky-500 focus:outline-none"
                />
              </div>
              {(fromDate || toDate) && (
                <button
                  onClick={() => handleFilterDates('', '')}
                  className="text-xs text-slate-400 hover:text-white px-1.5 py-0.5"
                >
                  إلغاء التحديد ✕
                </button>
              )}
            </div>

            {/* الأزرار السريعة للفترة */}
            <div className="flex flex-wrap items-center gap-1">
              {[
                { id: 'today', label: 'اليوم' },
                { id: 'week', label: 'هذا الأسبوع' },
                { id: 'month', label: 'هذا الشهر' },
                { id: 'quarter', label: 'هذا الربع' },
                { id: 'year', label: 'هذه السنة' },
                { id: 'all', label: 'كافة الحركات' },
              ].map(p => (
                <button
                  key={p.id}
                  onClick={() => setPresetRange(p.id as any)}
                  className="rounded-lg border border-white/5 bg-slate-900/80 px-2.5 py-1 text-xs text-slate-400 hover:bg-slate-700 hover:text-white transition"
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* جدول الحركات التراكمي */}
          {loadingStatement ? (
            <div className="py-16 text-center text-slate-400 space-y-2">
              <div className="inline-block h-8 w-8 animate-spin rounded-full border-2 border-sky-400 border-t-transparent" />
              <p className="text-sm">جاري تحميل حركات الحساب والرصيد التراكمي...</p>
            </div>
          ) : !statementData || statementData.rows.length === 0 ? (
            <div className="rounded-xl border border-white/5 bg-slate-800/30 py-12 text-center text-slate-400">
              <p className="text-2xl mb-2">📜</p>
              <p className="text-sm font-semibold text-white">لا توجد حركات مسجلة لهذا العميل في هذه الفترة</p>
              {statementData && statementData.openingBalance !== 0 && (
                <p className="text-xs text-slate-400 mt-1">
                  الرصيد السابق قبل الفترة: <span className="font-mono font-bold text-white">{fmt(statementData.openingBalance)} {currencyCode}</span>
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="overflow-x-auto rounded-xl border border-white/10">
                <table className="w-full min-w-[700px] text-right text-xs">
                  <thead>
                    <tr className="border-b border-white/10 bg-slate-800/90 text-slate-300">
                      <th className="p-3 text-center">التاريخ</th>
                      <th className="p-3">نوع الحركة</th>
                      <th className="p-3 text-center">رقم المستند</th>
                      <th className="p-3">البيان / التفاصيل</th>
                      <th className="p-3 text-left text-rose-400">مدين (+)</th>
                      <th className="p-3 text-left text-emerald-400">دائن (-)</th>
                      <th className="p-3 text-left text-sky-400 bg-slate-800">الرصيد التراكمي</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 text-slate-300">
                    {/* سطر الرصيد الافتتاحي */}
                    {fromDate && (
                      <tr className="bg-amber-500/10 font-bold border-b border-amber-500/20 text-amber-300">
                        <td className="p-3 text-center font-mono text-xs">{fromDate}</td>
                        <td className="p-3" colSpan={3}>
                          📌 الرصيد الافتتاحي السابق (ما قبل {fromDate})
                        </td>
                        <td className="p-3 text-left font-mono" dir="ltr">
                          {statementData.openingBalance > 0 ? fmt(statementData.openingBalance) : '—'}
                        </td>
                        <td className="p-3 text-left font-mono" dir="ltr">
                          {statementData.openingBalance < 0 ? fmt(Math.abs(statementData.openingBalance)) : '—'}
                        </td>
                        <td className="p-3 text-left font-mono font-black text-amber-200 bg-amber-500/15" dir="ltr">
                          {fmt(statementData.openingBalance)} {currencyCode}
                        </td>
                      </tr>
                    )}

                    {statementData.rows.map(row => (
                      <tr key={row.id} className="hover:bg-white/5 transition">
                        <td className="p-3 text-center font-mono text-slate-400">{row.date}</td>
                        <td className="p-3 font-semibold text-white">{row.type}</td>
                        <td className="p-3 text-center font-mono text-sky-400" dir="ltr">
                          {row.doc_no}
                        </td>
                        <td className="p-3 text-slate-300 max-w-xs truncate" title={row.description}>
                          {row.description || '—'}
                        </td>
                        <td className="p-3 text-left font-mono font-bold text-rose-300" dir="ltr">
                          {row.debit > 0 ? fmt(row.debit) : '—'}
                        </td>
                        <td className="p-3 text-left font-mono font-bold text-emerald-400" dir="ltr">
                          {row.credit > 0 ? fmt(row.credit) : '—'}
                        </td>
                        <td className="p-3 text-left font-mono font-black text-white bg-slate-800/40" dir="ltr">
                          {fmt(row.balance)} {currencyCode}
                        </td>
                      </tr>
                    ))}
                  </tbody>

                  {/* تذييل الجدول والإجماليات */}
                  <tfoot className="border-t-2 border-white/20 bg-slate-800 font-bold text-white text-xs">
                    <tr>
                      <td colSpan={4} className="p-3.5 text-right font-black">
                        إجمالي حركات الفترة المحددة:
                      </td>
                      <td className="p-3.5 text-left font-mono text-rose-400 font-black" dir="ltr">
                        {fmt(statementData.totalDebit)} {currencyCode}
                      </td>
                      <td className="p-3.5 text-left font-mono text-emerald-400 font-black" dir="ltr">
                        {fmt(statementData.totalCredit)} {currencyCode}
                      </td>
                      <td className="p-3.5 text-left font-mono text-sky-300 font-black text-sm bg-slate-900" dir="ltr">
                        {fmt(statementData.closingBalance)} {currencyCode}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── جدول قائمة جميع العملاء (عرض شامل بدون استثناء حتى رصيد 0) ── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-white flex items-center gap-2">
            <span>👥</span>
            <span>قائمة حسابات العملاء ({filteredCustomers.length})</span>
          </h3>
          <span className="text-xs text-slate-400">
            انقر على أي زبون لعرض تفاصيل كشف حسابه مباشرة
          </span>
        </div>

        {filteredCustomers.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-slate-900/60 py-14 text-center">
            <p className="text-3xl mb-2">🔍</p>
            <p className="text-sm font-semibold text-white">لم يتم العثور على أي زبون يطابق البحث</p>
            <p className="text-xs text-slate-400 mt-1">جرب تغيير كلمات البحث أو فلتر الرصيد</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-white/10">
            <table className="w-full min-w-[760px] text-sm text-right">
              <thead>
                <tr className="border-b border-white/10 bg-slate-800/80 text-xs font-semibold text-slate-400">
                  <th className="p-3.5">الزبون / الاسم</th>
                  <th className="p-3.5">الهاتف والتواصل</th>
                  <th className="p-3.5">المدينة</th>
                  <th className="p-3.5">النوع</th>
                  <th className="p-3.5 text-left">الرصيد الحالي</th>
                  <th className="p-3.5 text-center">إجراءات كشف الحساب</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 text-slate-300">
                {filteredCustomers.map(c => {
                  const isSelected = selectedCustomerId === c.id
                  const b = c.balance || 0
                  return (
                    <tr
                      key={c.id}
                      className={`hover:bg-white/5 transition cursor-pointer ${
                        isSelected ? 'bg-sky-500/10 border-r-4 border-r-sky-500' : ''
                      }`}
                      onClick={() => selectCustomer(c)}
                    >
                      <td className="p-3.5">
                        <p className="font-bold text-white text-sm">{c.name}</p>
                        {c.credit_limit ? (
                          <p className="text-[11px] text-slate-500">سقف الائتمان: {fmt(c.credit_limit)} {currencyCode}</p>
                        ) : null}
                      </td>

                      <td className="p-3.5 text-xs" dir="ltr" onClick={e => e.stopPropagation()}>
                        {c.phone ? (
                          <div className="flex items-center gap-2 justify-end">
                            <a
                              href={`tel:${c.phone}`}
                              className="text-slate-300 hover:text-white font-mono"
                            >
                              {c.phone}
                            </a>
                            <a
                              href={getWhatsAppShareUrl(c) || '#'}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 rounded-md bg-emerald-500/15 px-2 py-1 text-emerald-400 hover:bg-emerald-500/25 transition text-xs font-medium"
                              title="إرسال كشف ومطالبة عبر واتساب"
                            >
                              <span>💬</span>
                            </a>
                          </div>
                        ) : (
                          <span className="text-slate-500">—</span>
                        )}
                      </td>

                      <td className="p-3.5 text-xs text-slate-300">{c.city || '—'}</td>

                      <td className="p-3.5">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${TYPE_COLORS[c.customer_type] || TYPE_COLORS.retail}`}>
                          {TYPE_LABELS[c.customer_type] || c.customer_type}
                        </span>
                      </td>

                      <td className="p-3.5 text-left font-mono font-bold" dir="ltr">
                        <span
                          className={`inline-block px-2.5 py-1 rounded-lg text-xs font-black ${
                            b > 0.001
                              ? 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                              : b < -0.001
                              ? 'bg-sky-500/15 text-sky-400 border border-sky-500/30'
                              : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                          }`}
                        >
                          {fmt(Math.abs(b))} {currencyCode}
                          <span className="text-[10px] mr-1 font-sans">
                            {b > 0.001 ? 'مدين' : b < -0.001 ? 'دائن' : 'مسدد'}
                          </span>
                        </span>
                      </td>

                      <td className="p-3.5 text-center" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            onClick={() => selectCustomer(c)}
                            className="rounded-lg bg-sky-500/15 hover:bg-sky-500/25 text-sky-400 px-2.5 py-1 text-xs font-bold transition"
                          >
                            📋 كشف الحساب
                          </button>
                          <Link
                            href={`/dashboard/customers/${c.id}/statement/print`}
                            target="_blank"
                            className="rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 px-2 py-1 text-xs transition"
                            title="طباعة كشف A4"
                          >
                            🖨️
                          </Link>
                          <Link
                            href={`/dashboard/customers/${c.id}`}
                            className="rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 px-2 py-1 text-xs transition"
                            title="الملف الشخصي"
                          >
                            👤
                          </Link>
                        </div>
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
