'use client'

import { useState, useEffect, useMemo } from 'react'
import { getAccountStatement } from '@/app/dashboard/accounting/accounts/account-actions'
import { generateAndPrintPdf } from '@/lib/pdf/printPdf'
import Link from 'next/link'

export interface AccountOption {
  id: string
  code: string
  name: string
  type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense'
  normal_balance?: string
  is_group?: boolean
  currency?: string
}

interface Props {
  accounts: AccountOption[]
  initialAccountId?: string
  currencyCode: string
  storeName: string
}

const TYPE_LABELS: Record<string, string> = {
  asset: 'الأصول (Assets)',
  liability: 'الالتزامات (Liabilities)',
  equity: 'حقوق الملكية (Equity)',
  revenue: 'الإيرادات (Revenue)',
  expense: 'المصروفات (Expenses)',
}

export default function AccountStatementClient({
  accounts,
  initialAccountId,
  currencyCode,
  storeName,
}: Props) {
  const [selectedAccountId, setSelectedAccountId] = useState<string>(
    initialAccountId || accounts[0]?.id || ''
  )
  const [fromDate, setFromDate] = useState<string>('')
  const [toDate, setToDate] = useState<string>('')
  const [loading, setLoading] = useState<boolean>(false)
  const [error, setError] = useState<string>('')
  const [statementData, setStatementData] = useState<any>(null)
  const [printing, setPrinting] = useState<boolean>(false)

  // Account search filter
  const [accountSearch, setAccountSearch] = useState('')

  const selectedAccount = useMemo(
    () => accounts.find(a => a.id === selectedAccountId),
    [accounts, selectedAccountId]
  )

  const filteredAccounts = useMemo(() => {
    if (!accountSearch.trim()) return accounts
    const q = accountSearch.toLowerCase().trim()
    return accounts.filter(
      a => a.code.toLowerCase().includes(q) || a.name.toLowerCase().includes(q)
    )
  }, [accounts, accountSearch])

  // Fetch statement on account or date change
  const fetchStatement = async (accId = selectedAccountId, from = fromDate, to = toDate) => {
    if (!accId) return
    setLoading(true)
    setError('')
    try {
      const res = await getAccountStatement(accId, from || undefined, to || undefined)
      if (!res.success) {
        setError(res.error || 'فشل تحميل بيانات كشف الحساب')
      } else {
        setStatementData(res)
      }
    } catch (e: any) {
      setError(e.message || 'حدث خطأ في جلب بيانات كشف الحساب')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (selectedAccountId) {
      fetchStatement(selectedAccountId, fromDate, toDate)
    }
  }, [selectedAccountId])

  const setDatePreset = (preset: 'today' | 'month' | 'quarter' | 'year' | 'all') => {
    const now = new Date()
    const todayStr = now.toISOString().slice(0, 10)

    if (preset === 'today') {
      setFromDate(todayStr)
      setToDate(todayStr)
      fetchStatement(selectedAccountId, todayStr, todayStr)
    } else if (preset === 'month') {
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10)
      setFromDate(firstDay)
      setToDate(todayStr)
      fetchStatement(selectedAccountId, firstDay, todayStr)
    } else if (preset === 'quarter') {
      const qMonth = Math.floor(now.getMonth() / 3) * 3
      const firstDay = new Date(now.getFullYear(), qMonth, 1).toISOString().slice(0, 10)
      setFromDate(firstDay)
      setToDate(todayStr)
      fetchStatement(selectedAccountId, firstDay, todayStr)
    } else if (preset === 'year') {
      const firstDay = new Date(now.getFullYear(), 0, 1).toISOString().slice(0, 10)
      setFromDate(firstDay)
      setToDate(todayStr)
      fetchStatement(selectedAccountId, firstDay, todayStr)
    } else {
      setFromDate('')
      setToDate('')
      fetchStatement(selectedAccountId, '', '')
    }
  }

  const handlePrint = async () => {
    if (!statementData?.account) return
    setPrinting(true)
    try {
      await generateAndPrintPdf({
        elementId: 'account-statement-canvas',
        filename: `كشف-حساب-${statementData.account.code}-${statementData.account.name}.pdf`,
        format: 'a4',
      })
    } catch (err) {
      console.error(err)
    } finally {
      setPrinting(false)
    }
  }

  const fmt = (n: number) =>
    Number(n || 0).toLocaleString('en-GB', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })

  const isDebitNature =
    selectedAccount?.normal_balance === 'debit' ||
    selectedAccount?.type === 'asset' ||
    selectedAccount?.type === 'expense'

  return (
    <div className="space-y-6" dir="rtl">
      {/* ── Top Header ── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-white/10 pb-4">
        <div>
          <div className="flex items-center gap-2 text-xs text-slate-400 mb-1">
            <Link href="/dashboard" className="hover:text-white transition">الرئيسية</Link>
            <span>/</span>
            <Link href="/dashboard/accounting" className="hover:text-white transition">المحاسبة والتقارير</Link>
            <span>/</span>
            <span className="text-sky-400">كشف حساب محاسبي</span>
          </div>
          <h1 className="text-2xl font-black text-white flex items-center gap-2.5">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-500/20 text-xl border border-sky-500/30">
              📜
            </span>
            كشف حساب محاسبي عام (Account Statement)
          </h1>
          <p className="mt-1 text-xs text-slate-400">
            عرض وتدقيق حركة أي حساب مالي في شجرة الحسابات، الأرصدة الافتتاحية والختامية، والقيود المحاسبية.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={handlePrint}
            disabled={printing || loading || !statementData?.rows?.length}
            className="flex items-center gap-2 rounded-xl bg-sky-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-sky-500 transition shadow-lg shadow-sky-900/30 disabled:opacity-50"
          >
            <span>🖨️</span>
            <span>{printing ? 'جاري التجهيز...' : 'طباعة كشف الحساب / PDF'}</span>
          </button>
        </div>
      </div>

      {/* ── Controls Section: Account Picker & Date Filters ── */}
      <div className="rounded-2xl border border-white/10 bg-slate-900/80 p-4 sm:p-5 shadow-xl space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
          
          {/* Account Selector */}
          <div className="md:col-span-6">
            <label className="mb-1.5 block text-xs font-bold text-slate-300">
              1. اختر الحساب المحاسبي من الشجرة *
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="بحث بالكود أو الاسم..."
                value={accountSearch}
                onChange={e => setAccountSearch(e.target.value)}
                className="w-1/3 rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-xs text-white outline-none focus:border-sky-500"
              />
              <select
                value={selectedAccountId}
                onChange={e => setSelectedAccountId(e.target.value)}
                className="w-2/3 rounded-xl border border-sky-500/30 bg-slate-800 px-3 py-2 text-xs text-white outline-none focus:border-sky-500 font-bold"
              >
                {filteredAccounts.map(acc => (
                  <option key={acc.id} value={acc.id} disabled={acc.is_group}>
                    {acc.code} — {acc.name} ({TYPE_LABELS[acc.type] || acc.type}) {acc.is_group ? '⚠️ [تجميعي]' : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Date Pickers */}
          <div className="md:col-span-4 grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1.5 block text-[11px] font-bold text-slate-300">من تاريخ</label>
              <input
                type="date"
                value={fromDate}
                onChange={e => setFromDate(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-xs text-white outline-none focus:border-sky-500 font-bold"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[11px] font-bold text-slate-300">إلى تاريخ</label>
              <input
                type="date"
                value={toDate}
                onChange={e => setToDate(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-xs text-white outline-none focus:border-sky-500 font-bold"
              />
            </div>
          </div>

          {/* Search Button */}
          <div className="md:col-span-2 flex gap-1.5">
            <button
              onClick={() => fetchStatement(selectedAccountId, fromDate, toDate)}
              disabled={loading}
              className="w-full rounded-xl bg-sky-600 px-3 py-2 text-xs font-bold text-white hover:bg-sky-500 transition shadow disabled:opacity-50"
            >
              {loading ? 'جارٍ الجلب...' : '🔍 عرض الكشف'}
            </button>
          </div>
        </div>

        {/* Date Presets */}
        <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-white/5 text-xs text-slate-400">
          <span className="font-semibold text-[11px]">فترات سريعة:</span>
          <button
            type="button"
            onClick={() => setDatePreset('today')}
            className="rounded-lg border border-white/10 bg-slate-800 px-2.5 py-1 hover:text-white transition"
          >
            اليوم
          </button>
          <button
            type="button"
            onClick={() => setDatePreset('month')}
            className="rounded-lg border border-white/10 bg-slate-800 px-2.5 py-1 hover:text-white transition"
          >
            هذا الشهر
          </button>
          <button
            type="button"
            onClick={() => setDatePreset('quarter')}
            className="rounded-lg border border-white/10 bg-slate-800 px-2.5 py-1 hover:text-white transition"
          >
            الربع الحالي
          </button>
          <button
            type="button"
            onClick={() => setDatePreset('year')}
            className="rounded-lg border border-white/10 bg-slate-800 px-2.5 py-1 hover:text-white transition"
          >
            هذا العام
          </button>
          <button
            type="button"
            onClick={() => setDatePreset('all')}
            className="rounded-lg border border-white/10 bg-slate-800 px-2.5 py-1 hover:text-white transition"
          >
            كافة الحركات
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-4 text-xs text-rose-300">
          {error}
        </div>
      )}

      {/* ── Summary Financial KPI Cards ── */}
      {statementData?.summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {/* Opening Balance */}
          <div className="rounded-2xl border border-white/10 bg-slate-900 p-4 shadow">
            <span className="text-xs font-semibold text-slate-400 block">الرصيد الافتتاحي ما قبل الفترة</span>
            <div className="mt-1 flex items-baseline gap-1.5 font-mono">
              <span className="text-lg font-black text-slate-200" dir="ltr">
                {fmt(statementData.summary.openingBalance)}
              </span>
              <span className="text-xs text-slate-400">{selectedAccount?.currency || currencyCode}</span>
            </div>
            <span className="mt-1 block text-[10px] text-slate-500">
              {fromDate ? `حتى تاريخ ${fromDate}` : 'رصيد بداية السجل'}
            </span>
          </div>

          {/* Total Debit */}
          <div className="rounded-2xl border border-sky-500/20 bg-sky-500/5 p-4 shadow">
            <span className="text-xs font-semibold text-sky-300 block">إجمالي الحركات المدينة (+)</span>
            <div className="mt-1 flex items-baseline gap-1.5 font-mono">
              <span className="text-lg font-black text-sky-400" dir="ltr">
                {fmt(statementData.summary.totalDebit)}
              </span>
              <span className="text-xs text-slate-400">{selectedAccount?.currency || currencyCode}</span>
            </div>
            <span className="mt-1 block text-[10px] text-slate-500">
              مجموع القيود في جانب المدين
            </span>
          </div>

          {/* Total Credit */}
          <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 shadow">
            <span className="text-xs font-semibold text-amber-300 block">إجمالي الحركات الدائنة (-)</span>
            <div className="mt-1 flex items-baseline gap-1.5 font-mono">
              <span className="text-lg font-black text-amber-400" dir="ltr">
                {fmt(statementData.summary.totalCredit)}
              </span>
              <span className="text-xs text-slate-400">{selectedAccount?.currency || currencyCode}</span>
            </div>
            <span className="mt-1 block text-[10px] text-slate-500">
              مجموع القيود في جانب الدائن
            </span>
          </div>

          {/* Closing Balance */}
          <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 shadow">
            <span className="text-xs font-bold text-emerald-300 block">الرصيد الختامي في نهاية الفترة</span>
            <div className="mt-1 flex items-baseline gap-1.5 font-mono">
              <span className="text-xl font-black text-emerald-400" dir="ltr">
                {fmt(statementData.summary.closingBalance)}
              </span>
              <span className="text-xs text-emerald-200">{selectedAccount?.currency || currencyCode}</span>
            </div>
            <span className="mt-1 block text-[10px] text-emerald-400 font-semibold">
              {statementData.summary.closingBalance >= 0
                ? (isDebitNature ? 'رصيد مدين طبيعي ✓' : 'رصيد دائن طبيعي ✓')
                : 'رصيد معاكس لطبيعة الحساب ⚠️'}
            </span>
          </div>
        </div>
      )}

      {/* ── Official Printable Ledger Canvas ── */}
      <div
        id="account-statement-canvas"
        className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 text-slate-900 shadow-xl print:border-none print:shadow-none print:p-2"
      >
        {/* Printable Header */}
        <div className="flex items-start justify-between border-b-2 border-slate-900 pb-4 mb-4">
          <div>
            <h2 className="text-2xl font-black text-slate-950">{storeName}</h2>
            <p className="text-xs text-slate-600 mt-0.5">نظام بازاركو المحاسبي — دفتر الأستاذ العام</p>
            <div className="mt-2 inline-flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-1 text-xs font-bold text-slate-900">
              <span>كشف حساب:</span>
              <span className="font-mono text-sky-800 font-black">[{selectedAccount?.code}]</span>
              <span>{selectedAccount?.name}</span>
            </div>
          </div>

          <div className="text-left text-xs space-y-1 font-sans">
            <div>طبيعة الحساب: <strong>{isDebitNature ? 'مدين بطبيعته' : 'دائن بطبيعته'}</strong></div>
            <div>العملة الرسمية: <strong className="font-mono">{selectedAccount?.currency || currencyCode}</strong></div>
            <div>تاريخ التقرير: <strong className="font-mono" dir="ltr">{new Date().toISOString().slice(0, 10)}</strong></div>
            {fromDate && toDate && (
              <div>الفترة: <strong className="font-mono" dir="ltr">{fromDate} إلى {toDate}</strong></div>
            )}
          </div>
        </div>

        {/* Transactions Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs border border-slate-300">
            <thead>
              <tr className="bg-slate-900 text-white border-b border-slate-900 text-[11px]">
                <th className="p-2.5 text-center w-10">#</th>
                <th className="p-2.5 w-24">التاريخ</th>
                <th className="p-2.5 w-28 text-center">رقم القيد</th>
                <th className="p-2.5">البيان والشرح المحاسبي</th>
                <th className="p-2.5 w-24 text-center">المصدر</th>
                <th className="p-2.5 w-24 text-left">مدين (+)</th>
                <th className="p-2.5 w-24 text-left">دائن (-)</th>
                <th className="p-2.5 w-28 text-left">الرصيد التراكمي</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {/* Opening Balance Row */}
              <tr className="bg-slate-50 font-bold text-slate-800">
                <td className="p-2.5 text-center text-slate-400 font-mono">—</td>
                <td className="p-2.5 font-mono">{fromDate || 'بداية السجل'}</td>
                <td className="p-2.5 text-center text-slate-400 font-mono">—</td>
                <td className="p-2.5 text-slate-700">الرصيد الافتتاحي السابق للفترة</td>
                <td className="p-2.5 text-center text-slate-500">افتتاحي</td>
                <td className="p-2.5 text-left font-mono">—</td>
                <td className="p-2.5 text-left font-mono">—</td>
                <td className="p-2.5 text-left font-mono font-black text-slate-950" dir="ltr">
                  {fmt(statementData?.summary?.openingBalance || 0)}
                </td>
              </tr>

              {loading ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
                    جارٍ جلب وتدقيق حركات الحساب...
                  </td>
                </tr>
              ) : !statementData?.rows?.length ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-slate-500">
                    لا توجد حركات مسجلة على هذا الحساب خلال الفترة المحددة.
                  </td>
                </tr>
              ) : (
                statementData.rows.map((row: any, idx: number) => (
                  <tr key={row.id || idx} className="hover:bg-slate-50/80 transition-colors">
                    <td className="p-2.5 text-center font-mono text-slate-400 text-[10px]">{idx + 1}</td>
                    <td className="p-2.5 font-mono text-slate-700 whitespace-nowrap">{row.date}</td>
                    <td className="p-2.5 text-center font-mono font-bold text-sky-900" dir="ltr">
                      {row.entry_number}
                    </td>
                    <td className="p-2.5 text-slate-900 font-medium leading-relaxed">
                      {row.description}
                    </td>
                    <td className="p-2.5 text-center">
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600 font-medium">
                        {row.source === 'invoice' ? 'فاتورة' :
                         row.source === 'voucher' ? 'سند' :
                         row.source === 'purchase' ? 'مشتريات' :
                         row.source === 'manual' ? 'قيد يدوي' : row.source}
                      </span>
                    </td>
                    <td className="p-2.5 text-left font-mono text-slate-900 font-bold" dir="ltr">
                      {row.debit > 0 ? fmt(row.debit) : '—'}
                    </td>
                    <td className="p-2.5 text-left font-mono text-slate-900 font-bold" dir="ltr">
                      {row.credit > 0 ? fmt(row.credit) : '—'}
                    </td>
                    <td className="p-2.5 text-left font-mono font-black text-slate-950" dir="ltr">
                      {fmt(row.balance)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {/* Totals Footer */}
            {statementData?.summary && (
              <tfoot>
                <tr className="bg-slate-900 text-white font-bold text-xs border-t-2 border-slate-900">
                  <td colSpan={5} className="p-3 text-right">
                    إجمالي حركات الفترة والرصيد الختامي:
                  </td>
                  <td className="p-3 text-left font-mono text-sky-300 font-black" dir="ltr">
                    {fmt(statementData.summary.totalDebit)}
                  </td>
                  <td className="p-3 text-left font-mono text-amber-300 font-black" dir="ltr">
                    {fmt(statementData.summary.totalCredit)}
                  </td>
                  <td className="p-3 text-left font-mono text-emerald-300 font-black text-sm" dir="ltr">
                    {fmt(statementData.summary.closingBalance)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        {/* Official Signatures */}
        <div className="mt-12 pt-6 border-t border-slate-300 grid grid-cols-3 gap-6 text-center text-xs font-bold text-slate-700 print:mt-8">
          <div>
            <p className="text-slate-500 mb-6">المحاسب المسؤول</p>
            <p className="border-t border-dashed border-slate-400 pt-1">التوقيع والختم</p>
          </div>
          <div>
            <p className="text-slate-500 mb-6">تدقيق الحسابات</p>
            <p className="border-t border-dashed border-slate-400 pt-1">التوقيع</p>
          </div>
          <div>
            <p className="text-slate-500 mb-6">إدارة المتجر / الاعتماد</p>
            <p className="border-t border-dashed border-slate-400 pt-1">الاعتماد الرسمي</p>
          </div>
        </div>
      </div>
    </div>
  )
}
