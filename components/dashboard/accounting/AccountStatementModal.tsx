'use client'

import { useState, useEffect } from 'react'
import { getAccountStatement } from '@/app/dashboard/accounting/accounts/account-actions'
import { generateAndPrintPdf } from '@/lib/pdf/printPdf'

interface Props {
  account: {
    id: string
    code: string
    name: string
    type: string
    normal_balance?: string
    currency?: string
    is_group?: boolean
  }
  currencyCode: string
  onClose: () => void
}

export default function AccountStatementModal({ account, currencyCode, onClose }: Props) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [statementData, setStatementData] = useState<any>(null)
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [printing, setPrinting] = useState(false)

  const fetchStatement = async () => {
    setLoading(true)
    setError('')
    const res = await getAccountStatement(account.id, fromDate || undefined, toDate || undefined)
    if (!res.success) {
      setError(res.error || 'فشل تحميل كشف الحساب')
    } else {
      setStatementData(res)
    }
    setLoading(false)
  }

  useEffect(() => {
    fetchStatement()
  }, [account.id])

  const handlePrint = async () => {
    setPrinting(true)
    try {
      await generateAndPrintPdf({
        elementId: 'account-statement-canvas',
        filename: `كشف-حساب-${account.code}-${account.name}.pdf`,
        format: 'a4',
      })
    } catch (err) {
      console.error(err)
    } finally {
      setPrinting(false)
    }
  }

  const fmt = (n: number) =>
    Number(n || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
      <div className="relative flex max-h-[92vh] w-full max-w-4xl flex-col rounded-2xl border border-white/10 bg-slate-900 shadow-2xl overflow-hidden">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 p-5 bg-slate-800/60">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xl">📜</span>
              <h2 className="text-lg font-bold text-white">كشف حساب: {account.name}</h2>
              <span className="rounded-md bg-sky-500/10 px-2.5 py-0.5 font-mono text-xs font-bold text-sky-400 border border-sky-500/20" dir="ltr">
                {account.code}
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-400">
              طبيعة الحساب: {account.normal_balance === 'debit' ? 'مدين بطبيعته' : 'دائن بطبيعته'} | العملة: {account.currency || currencyCode}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              disabled={printing || loading || !statementData?.rows?.length}
              className="flex items-center gap-1.5 rounded-xl bg-sky-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-sky-500 transition disabled:opacity-50"
            >
              <span>🖨️</span>
              <span>{printing ? 'جاري التحضير...' : 'طباعة / PDF'}</span>
            </button>
            <button
              onClick={onClose}
              className="rounded-xl border border-white/10 p-2 text-slate-400 hover:text-white hover:bg-slate-800 transition"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Filter Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/5 bg-slate-950/40 px-5 py-3 text-xs">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="text-slate-400">من تاريخ:</span>
              <input
                type="date"
                value={fromDate}
                onChange={e => setFromDate(e.target.value)}
                className="rounded-lg border border-white/10 bg-slate-800 px-2.5 py-1 text-white outline-none focus:border-sky-500"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-slate-400">إلى تاريخ:</span>
              <input
                type="date"
                value={toDate}
                onChange={e => setToDate(e.target.value)}
                className="rounded-lg border border-white/10 bg-slate-800 px-2.5 py-1 text-white outline-none focus:border-sky-500"
              />
            </div>
            <button
              onClick={fetchStatement}
              className="rounded-lg bg-slate-800 px-3 py-1 font-bold text-slate-200 hover:bg-slate-700 transition"
            >
              تطبيق الفلتر
            </button>
            {(fromDate || toDate) && (
              <button
                onClick={() => { setFromDate(''); setToDate(''); setTimeout(fetchStatement, 50) }}
                className="text-slate-400 hover:text-white text-xs underline"
              >
                إلغاء الفلتر
              </button>
            )}
          </div>

          {statementData?.summary && (
            <div className="flex items-center gap-4 text-xs font-mono">
              <span className="text-slate-400">الحركات: <strong className="text-white">{statementData.summary.movementsCount}</strong></span>
              <span className="text-slate-400">الرصيد النهائي: <strong className="text-emerald-400" dir="ltr">{fmt(statementData.summary.currentBalance)} {account.currency || currencyCode}</strong></span>
            </div>
          )}
        </div>

        {/* Statement Content */}
        <div className="flex-1 overflow-y-auto p-5">
          {loading ? (
            <div className="py-16 text-center text-slate-400">
              <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-sky-400 border-t-transparent mb-2" />
              <p className="text-xs">جارٍ جلب قيود وحركات الحساب...</p>
            </div>
          ) : error ? (
            <div className="rounded-xl bg-rose-500/10 border border-rose-500/20 p-4 text-xs text-rose-400 text-center">
              {error}
            </div>
          ) : !statementData?.rows?.length ? (
            <div className="py-16 text-center text-slate-500">
              <span className="text-4xl">📂</span>
              <p className="mt-2 text-sm font-semibold text-slate-400">لا توجد حركات أو قيود مسجلة على هذا الحساب بعد</p>
              <p className="mt-1 text-xs text-slate-500">الحساب جاهز لاستقبال القيود والعمليات المحاسبية اليومية</p>
            </div>
          ) : (
            <div id="account-statement-canvas" className="space-y-4 bg-slate-900 p-2">
              {/* Summary KPIs */}
              <div className="grid grid-cols-4 gap-3">
                <div className="rounded-xl border border-white/5 bg-slate-800/60 p-3">
                  <span className="text-[11px] text-slate-400">إجمالي المدين</span>
                  <p className="mt-1 font-mono text-sm font-bold text-sky-400" dir="ltr">
                    {fmt(statementData.summary.totalDebit)} {account.currency || currencyCode}
                  </p>
                </div>
                <div className="rounded-xl border border-white/5 bg-slate-800/60 p-3">
                  <span className="text-[11px] text-slate-400">إجمالي الدائن</span>
                  <p className="mt-1 font-mono text-sm font-bold text-amber-400" dir="ltr">
                    {fmt(statementData.summary.totalCredit)} {account.currency || currencyCode}
                  </p>
                </div>
                <div className="rounded-xl border border-white/5 bg-slate-800/60 p-3">
                  <span className="text-[11px] text-slate-400">الرصيد الدفتري</span>
                  <p className="mt-1 font-mono text-sm font-bold text-emerald-400" dir="ltr">
                    {fmt(statementData.summary.currentBalance)} {account.currency || currencyCode}
                  </p>
                </div>
                <div className="rounded-xl border border-white/5 bg-slate-800/60 p-3">
                  <span className="text-[11px] text-slate-400">آخر حركة مسجلة</span>
                  <p className="mt-1 font-mono text-xs font-semibold text-slate-300">
                    {statementData.summary.lastMovementDate || '—'}
                  </p>
                </div>
              </div>

              {/* Transactions Table */}
              <div className="overflow-hidden rounded-xl border border-white/10">
                <table className="w-full text-right text-xs">
                  <thead>
                    <tr className="border-b border-white/10 bg-slate-800/90 text-slate-400 font-bold">
                      <th className="p-3">التاريخ</th>
                      <th className="p-3">رقم القيد</th>
                      <th className="p-3">البيان / الشرح</th>
                      <th className="p-3 text-sky-400">مدين (+)</th>
                      <th className="p-3 text-amber-400">دائن (-)</th>
                      <th className="p-3 text-emerald-400">الرصيد بعد الحركة</th>
                      <th className="p-3 text-center">المصدر</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 text-slate-200">
                    {statementData.rows.map((row: any) => (
                      <tr key={row.id} className="hover:bg-slate-800/40 transition">
                        <td className="p-3 font-mono text-slate-400 whitespace-nowrap">{row.date}</td>
                        <td className="p-3 font-mono font-bold text-sky-400 whitespace-nowrap">{row.entry_number}</td>
                        <td className="p-3 font-medium text-slate-200">{row.description}</td>
                        <td className="p-3 font-mono font-bold text-sky-300 whitespace-nowrap" dir="ltr">
                          {row.debit > 0 ? fmt(row.debit) : '—'}
                        </td>
                        <td className="p-3 font-mono font-bold text-amber-300 whitespace-nowrap" dir="ltr">
                          {row.credit > 0 ? fmt(row.credit) : '—'}
                        </td>
                        <td className="p-3 font-mono font-bold text-emerald-400 whitespace-nowrap" dir="ltr">
                          {fmt(row.balance)}
                        </td>
                        <td className="p-3 text-center whitespace-nowrap">
                          <span className="rounded-md bg-white/5 px-2 py-0.5 text-[10px] text-slate-400">
                            {row.source === 'manual' ? 'قيد يدوي' : row.source}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-white/10 p-4 bg-slate-800/40 flex justify-end">
          <button
            onClick={onClose}
            className="rounded-xl border border-white/10 px-5 py-2 text-xs font-bold text-slate-300 hover:text-white hover:bg-slate-800 transition"
          >
            إغلاق
          </button>
        </div>
      </div>
    </div>
  )
}
