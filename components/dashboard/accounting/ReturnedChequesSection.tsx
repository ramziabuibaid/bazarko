'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'

export interface ReturnedCheckItem {
  id: string
  check_number: string
  bank_name: string
  bank_code?: string | null
  branch_name?: string | null
  branch_code?: string | null
  account_number?: string | null
  drawer_name?: string | null
  amount: number
  currency: string
  due_date: string
  issue_date?: string
  status: string
  notes?: string | null
  return_reason?: string | null
  return_date?: string | null
  cashbox_id?: string | null
  customer?: { id: string; name: string; phone?: string | null } | null
  voucher?: { id: string; voucher_number: string; date?: string } | null
  operations?: Array<{
    id: string
    operation_type: string
    operation_date: string
    notes?: string | null
    created_at?: string
  }> | null
}

const STATUS_LABELS: Record<string, { label: string; badgeCls: string }> = {
  bounced: { label: 'شيك راجع (مرتد)', badgeCls: 'bg-rose-500/15 text-rose-300 border-rose-500/30' },
  returned: { label: 'شيك راجع', badgeCls: 'bg-rose-500/15 text-rose-300 border-rose-500/30' },
  returned_to_customer: { label: 'معاد للزبون (للمصدر)', badgeCls: 'bg-amber-500/15 text-amber-300 border-amber-500/30' },
  returned_to_drawer: { label: 'معاد للساحب', badgeCls: 'bg-amber-500/15 text-amber-300 border-amber-500/30' },
  supplier_returned: { label: 'معاد من مورد', badgeCls: 'bg-orange-500/15 text-orange-300 border-orange-500/30' },
}

export default function ReturnedChequesSection({
  returnedChecks,
  storeCurrency = 'ILS',
}: {
  returnedChecks: ReturnedCheckItem[]
  storeCurrency?: string
}) {
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedBank, setSelectedBank] = useState('all')
  const [selectedStatus, setSelectedStatus] = useState('all')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')

  // Unique banks for filter
  const bankOptions = useMemo(() => {
    const set = new Set<string>()
    returnedChecks.forEach(c => {
      if (c.bank_name) set.add(c.bank_name)
    })
    return Array.from(set).sort()
  }, [returnedChecks])

  // Filtered checks
  const filteredChecks = useMemo(() => {
    return returnedChecks.filter(c => {
      // Status filter
      if (selectedStatus !== 'all' && c.status !== selectedStatus) return false

      // Bank filter
      if (selectedBank !== 'all' && c.bank_name !== selectedBank) return false

      // Return date filter
      const rDate = c.return_date || c.operations?.[0]?.operation_date || ''
      if (fromDate && rDate && rDate < fromDate) return false
      if (toDate && rDate && rDate > toDate) return false

      // Text search
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase()
        const matchNum = c.check_number.toLowerCase().includes(q)
        const matchCust = (c.customer?.name || '').toLowerCase().includes(q)
        const matchDrawer = (c.drawer_name || '').toLowerCase().includes(q)
        const matchBank = c.bank_name.toLowerCase().includes(q)
        const matchBankCode = (c.bank_code || '').toLowerCase().includes(q)
        const matchBranchCode = (c.branch_code || '').toLowerCase().includes(q)
        const matchReason = (c.return_reason || c.notes || '').toLowerCase().includes(q)
        const matchVoucher = (c.voucher?.voucher_number || '').toLowerCase().includes(q)
        if (!matchNum && !matchCust && !matchDrawer && !matchBank && !matchBankCode && !matchBranchCode && !matchReason && !matchVoucher) {
          return false
        }
      }

      return true
    })
  }, [returnedChecks, selectedStatus, selectedBank, fromDate, toDate, searchQuery])

  // Summary by currency (Separated totals without mixing currencies)
  const totalsByCurrency = useMemo(() => {
    const map: Record<string, { count: number; total: number }> = {}
    for (const c of returnedChecks) {
      const cur = c.currency || storeCurrency
      if (!map[cur]) map[cur] = { count: 0, total: 0 }
      map[cur].count += 1
      map[cur].total += Number(c.amount || 0)
    }
    return map
  }, [returnedChecks, storeCurrency])

  const currenciesList = Object.keys(totalsByCurrency)

  return (
    <div className="space-y-6">
      {/* ── البطاقات الإحصائية العلوية بالشيكات الراجعة ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* إجمالي عدد الشيكات الراجعة */}
        <div className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-rose-400">إجمالي الشيكات الراجعة</p>
            <p dir="ltr" className="mt-1 text-2xl font-bold tabular-nums text-white">
              {returnedChecks.length}{' '}
              <span className="text-xs font-normal text-slate-400">شيك راجع</span>
            </p>
          </div>
          <span className="text-3xl opacity-80">↩️</span>
        </div>

        {/* مجاميع الشيكات الراجعة مفصولة حسب العملة */}
        {currenciesList.length > 0 ? (
          currenciesList.map(cur => (
            <div
              key={cur}
              className="rounded-2xl border border-white/10 bg-slate-900/90 p-4 flex items-center justify-between"
            >
              <div>
                <p className="text-xs font-semibold text-slate-400">
                  إجمالي الراجع ({cur}) · {totalsByCurrency[cur].count} شيك
                </p>
                <p dir="ltr" className="mt-1 text-2xl font-bold tabular-nums text-rose-400">
                  {totalsByCurrency[cur].total.toLocaleString('ar-u-nu-latn', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}{' '}
                  <span className="text-xs font-normal text-slate-400">{cur}</span>
                </p>
              </div>
              <span className="text-3xl opacity-80">🏷️</span>
            </div>
          ))
        ) : (
          <div className="rounded-2xl border border-white/10 bg-slate-900/90 p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-slate-400">المجموع المالي للراجع</p>
              <p dir="ltr" className="mt-1 text-2xl font-bold tabular-nums text-emerald-400">
                0.00 <span className="text-xs font-normal text-slate-400">{storeCurrency}</span>
              </p>
            </div>
            <span className="text-3xl opacity-80">✅</span>
          </div>
        )}
      </div>

      {/* ── شريط البحث والتصفية ── */}
      <div className="rounded-2xl border border-white/10 bg-slate-900/80 p-4 space-y-3">
        <div className="flex flex-col md:flex-row gap-3">
          {/* حقل البحث السريع */}
          <div className="flex-1">
            <label className="block text-xs font-medium text-slate-400 mb-1">
              بحث برقم الشيك أو العميل أو البنك أو سبب الإرجاع:
            </label>
            <div className="relative">
              <input
                type="text"
                placeholder="ابحث برقم الشيك، اسم العميل، البنك، سبب الارتداد، أو رقم السند..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-slate-800 p-2.5 pr-9 text-xs text-white placeholder-slate-500 outline-none focus:border-rose-500 transition"
              />
              <span className="absolute right-3 top-2.5 text-slate-400 text-sm">🔍</span>
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute left-3 top-2.5 text-slate-400 hover:text-white text-xs"
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          {/* تصفية البنك */}
          <div className="w-full md:w-56">
            <label className="block text-xs font-medium text-slate-400 mb-1">البنك المسحوب عليه:</label>
            <select
              value={selectedBank}
              onChange={e => setSelectedBank(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-slate-800 p-2.5 text-xs text-white outline-none focus:border-rose-500"
            >
              <option value="all">جميع البنوك ({bankOptions.length})</option>
              {bankOptions.map(b => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </div>

          {/* تصفية الحالة */}
          <div className="w-full md:w-48">
            <label className="block text-xs font-medium text-slate-400 mb-1">حالة الشيك:</label>
            <select
              value={selectedStatus}
              onChange={e => setSelectedStatus(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-slate-800 p-2.5 text-xs text-white outline-none focus:border-rose-500"
            >
              <option value="all">جميع الحالات</option>
              <option value="bounced">شيك راجع (مرتد)</option>
              <option value="returned">شيك راجع</option>
              <option value="returned_to_customer">معاد للزبون (للمصدر)</option>
              <option value="supplier_returned">معاد من مورد</option>
            </select>
          </div>
        </div>

        {/* نطاق التاريخ */}
        <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-white/5 text-xs">
          <span className="text-slate-400">تاريخ الإرجاع من:</span>
          <input
            type="date"
            value={fromDate}
            onChange={e => setFromDate(e.target.value)}
            className="rounded-lg border border-white/10 bg-slate-800 px-2 py-1 text-white text-xs"
          />
          <span className="text-slate-400">إلى:</span>
          <input
            type="date"
            value={toDate}
            onChange={e => setToDate(e.target.value)}
            className="rounded-lg border border-white/10 bg-slate-800 px-2 py-1 text-white text-xs"
          />
          {(fromDate || toDate || selectedBank !== 'all' || selectedStatus !== 'all' || searchQuery) && (
            <button
              type="button"
              onClick={() => {
                setFromDate('')
                setToDate('')
                setSelectedBank('all')
                setSelectedStatus('all')
                setSearchQuery('')
              }}
              className="text-xs text-rose-400 hover:underline mr-auto"
            >
              إعادة ضبط الفلاتر
            </button>
          )}
        </div>
      </div>

      {/* ── جدول الشيكات الراجعة ── */}
      <div className="rounded-2xl border border-white/10 bg-slate-900 overflow-hidden shadow-xl">
        <div className="p-4 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-rose-400 text-lg">↩️</span>
            <h3 className="font-bold text-white text-sm">
              سجل الشيكات الراجعة المسجلة بالخزينة
            </h3>
            <span className="rounded-full bg-rose-500/15 border border-rose-500/30 px-2 py-0.5 text-xs font-bold text-rose-300">
              {filteredChecks.length} من أصل {returnedChecks.length}
            </span>
          </div>

          <Link
            href="/dashboard/cheques"
            className="text-xs text-sky-400 hover:text-sky-300 transition hover:underline"
          >
            فتح محفظة الشيكات الكاملة ←
          </Link>
        </div>

        {filteredChecks.length === 0 ? (
          <div className="p-12 text-center text-slate-400 space-y-3">
            <span className="text-5xl block">🎉</span>
            <p className="text-base font-bold text-slate-300">
              {returnedChecks.length === 0
                ? 'لا توجد أي شيكات راجعة مسجلة في هذا المتجر حالياً.'
                : 'لا توجد شيكات راجعة مطابقة لمعايير البحث والتصفية المحددة.'}
            </p>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              عند إرجاع أي شيك مستلم من محفظة الشيكات باختيار صندوق الشيكات الراجعة، سينتقل تلقائياً إلى هذا القسم مع كامل تفاصيله وقيده المحاسبي.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead className="bg-slate-800/80 text-slate-400 border-b border-white/10">
                <tr>
                  <th className="p-3 font-semibold">رقم الشيك</th>
                  <th className="p-3 font-semibold">العميل / الساحب</th>
                  <th className="p-3 font-semibold">البنك المسحوب عليه</th>
                  <th className="p-3 font-semibold text-center">كود البنك / الفرع</th>
                  <th className="p-3 font-semibold">قيمة الشيك</th>
                  <th className="p-3 font-semibold">تاريخ الاستحقاق</th>
                  <th className="p-3 font-semibold">تاريخ الإرجاع</th>
                  <th className="p-3 font-semibold">سبب الإرجاع</th>
                  <th className="p-3 font-semibold">سند القبض الأصلي</th>
                  <th className="p-3 font-semibold text-center">الحالة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 text-slate-300">
                {filteredChecks.map(chk => {
                  const statusInfo = STATUS_LABELS[chk.status] ?? {
                    label: chk.status,
                    badgeCls: 'bg-slate-500/10 text-slate-400 border-slate-500/20',
                  }
                  const rDate =
                    chk.return_date ||
                    chk.operations?.[0]?.operation_date ||
                    '—'
                  const rReason =
                    chk.return_reason ||
                    chk.notes ||
                    chk.operations?.[0]?.notes ||
                    'غير محدد'

                  return (
                    <tr key={chk.id} className="hover:bg-slate-850/60 transition-colors">
                      {/* 1. رقم الشيك مع رابط تفاصيل */}
                      <td className="p-3">
                        <Link
                          href={`/dashboard/cheques/print/${chk.id}`}
                          className="font-mono font-bold text-white hover:text-sky-400 hover:underline inline-flex items-center gap-1"
                          title="عرض وطباعة بطاقة الشيك"
                        >
                          <span>#{chk.check_number}</span>
                          <span className="text-[10px] text-slate-500">↗</span>
                        </Link>
                      </td>

                      {/* 2. اسم العميل */}
                      <td className="p-3 font-medium text-white">
                        {chk.customer?.name || chk.drawer_name || '—'}
                        {chk.customer?.phone && (
                          <span className="text-[10px] text-slate-400 block font-mono" dir="ltr">
                            {chk.customer.phone}
                          </span>
                        )}
                      </td>

                      {/* 3. البنك المسحوب عليه */}
                      <td className="p-3">
                        <span className="font-semibold text-white">{chk.bank_name}</span>
                        {chk.branch_name && (
                          <span className="text-[11px] text-slate-400 block">
                            {chk.branch_name}
                          </span>
                        )}
                      </td>

                      {/* 4. رقم البنك ورقم الفرع */}
                      <td className="p-3 text-center">
                        <div className="inline-flex items-center gap-1 font-mono text-[11px]" dir="ltr">
                          {chk.bank_code ? (
                            <span className="rounded bg-slate-800 border border-slate-700 px-1.5 py-0.5 text-emerald-400 font-bold" title="كود البنك">
                              {chk.bank_code}
                            </span>
                          ) : (
                            <span className="text-slate-500">—</span>
                          )}
                          <span className="text-slate-600">/</span>
                          {chk.branch_code ? (
                            <span className="rounded bg-slate-800 border border-slate-700 px-1.5 py-0.5 text-sky-400 font-medium" title="كود الفرع">
                              {chk.branch_code}
                            </span>
                          ) : (
                            <span className="text-slate-500">—</span>
                          )}
                        </div>
                      </td>

                      {/* 5. قيمة الشيك والعملة */}
                      <td className="p-3 font-bold text-white">
                        <span className="tabular-nums" dir="ltr">
                          {Number(chk.amount).toLocaleString('ar-u-nu-latn', {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </span>{' '}
                        <span className="text-slate-400 text-[11px] font-normal">{chk.currency}</span>
                      </td>

                      {/* 6. تاريخ الاستحقاق */}
                      <td className="p-3 font-mono text-slate-300">
                        {chk.due_date}
                      </td>

                      {/* 7. تاريخ الإرجاع */}
                      <td className="p-3 font-mono text-rose-300 font-semibold">
                        {rDate}
                      </td>

                      {/* 8. سبب الإرجاع */}
                      <td className="p-3 max-w-xs">
                        <span className="rounded-lg bg-rose-500/10 border border-rose-500/20 px-2 py-0.5 text-[11px] text-rose-300 block truncate" title={rReason}>
                          {rReason}
                        </span>
                      </td>

                      {/* 9. رقم سند القبض الأصلي */}
                      <td className="p-3">
                        {chk.voucher?.id ? (
                          <Link
                            href={`/dashboard/accounting/receipts/print/${chk.voucher.id}`}
                            className="font-mono text-sky-400 hover:text-sky-300 hover:underline inline-flex items-center gap-1 text-[11px]"
                            title="عرض سند القبض الأصلي"
                          >
                            <span>#{chk.voucher.voucher_number}</span>
                            <span className="text-[10px]">↗</span>
                          </Link>
                        ) : (
                          <span className="text-slate-500">—</span>
                        )}
                      </td>

                      {/* 10. الحالة الحالية للشيك */}
                      <td className="p-3 text-center">
                        <span
                          className={`inline-block rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${statusInfo.badgeCls}`}
                        >
                          {statusInfo.label}
                        </span>
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
