'use client'

import { useState, useEffect, useTransition } from 'react'
import Link from 'next/link'
import {
  TrialBalanceReport,
  IncomeStatementReport,
  BalanceSheetReport,
  CashFlowReport,
  SystemIntegrityReport,
  getTrialBalance,
  getIncomeStatement,
  getBalanceSheet,
  getCashFlowStatement,
  validateAccountingIntegrity,
  getAccountDrillDown,
} from '@/lib/accounting/reports-engine'
import { generateAndPrintPdf } from '@/lib/pdf/printPdf'
import BackToDashboardButton from '@/components/dashboard/BackToDashboardButton'

interface Props {
  storeId: string
  storeName: string
  currencyCode: string
  initialFromDate: string
  initialToDate: string
}

export default function FinancialReportsClient({
  storeId,
  storeName,
  currencyCode,
  initialFromDate,
  initialToDate,
}: Props) {
  const [activeTab, setActiveTab] = useState<'trial_balance' | 'income_statement' | 'balance_sheet' | 'cash_flow'>('trial_balance')
  const [fromDate, setFromDate] = useState(initialFromDate)
  const [toDate, setToDate] = useState(initialToDate)
  const [asOfDate, setAsOfDate] = useState(initialToDate)

  const [trialBalance, setTrialBalance] = useState<TrialBalanceReport | null>(null)
  const [incomeStatement, setIncomeStatement] = useState<IncomeStatementReport | null>(null)
  const [balanceSheet, setBalanceSheet] = useState<BalanceSheetReport | null>(null)
  const [cashFlow, setCashFlow] = useState<CashFlowReport | null>(null)
  const [integrityReport, setIntegrityReport] = useState<SystemIntegrityReport | null>(null)

  const [loading, setLoading] = useState(true)
  const [reportError, setReportError] = useState<string | null>(null)
  const [showIntegrityDetails, setShowIntegrityDetails] = useState(false)

  // Drill-down Modal State
  const [drillDownData, setDrillDownData] = useState<{ account: any; rows: any[] } | null>(null)
  const [drillDownLoading, setDrillDownLoading] = useState(false)

  // Fetch all reports
  const fetchReports = async (from = fromDate, to = toDate, asOf = asOfDate) => {
    setLoading(true)
    setReportError(null)
    try {
      const [tb, pnl, bs, cf, val] = await Promise.all([
        getTrialBalance(storeId, from, to),
        getIncomeStatement(storeId, from, to),
        getBalanceSheet(storeId, asOf),
        getCashFlowStatement(storeId, from, to),
        validateAccountingIntegrity(storeId, asOf),
      ])

      setTrialBalance(tb)
      setIncomeStatement(pnl)
      setBalanceSheet(bs)
      setCashFlow(cf)
      setIntegrityReport(val)
    } catch (err) {
      setTrialBalance(null)
      setIncomeStatement(null)
      setBalanceSheet(null)
      setCashFlow(null)
      setIntegrityReport(null)
      setReportError(err instanceof Error ? err.message : 'تعذر إكمال قراءة التقارير')
      console.error('Error fetching financial reports:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchReports()
  }, [])

  // Presets
  const applyPreset = (preset: 'current_month' | 'prev_month' | 'current_quarter' | 'current_year') => {
    const now = new Date()
    const y = now.getFullYear()
    const m = now.getMonth()

    let newFrom = ''
    let newTo = ''

    if (preset === 'current_month') {
      newFrom = new Date(y, m, 1).toISOString().slice(0, 10)
      newTo = new Date(y, m + 1, 0).toISOString().slice(0, 10)
    } else if (preset === 'prev_month') {
      const prevM = m === 0 ? 11 : m - 1
      const prevY = m === 0 ? y - 1 : y
      newFrom = new Date(prevY, prevM, 1).toISOString().slice(0, 10)
      newTo = new Date(prevY, prevM + 1, 0).toISOString().slice(0, 10)
    } else if (preset === 'current_quarter') {
      const q = Math.floor(m / 3)
      newFrom = new Date(y, q * 3, 1).toISOString().slice(0, 10)
      newTo = new Date(y, q * 3 + 3, 0).toISOString().slice(0, 10)
    } else if (preset === 'current_year') {
      newFrom = `${y}-01-01`
      newTo = `${y}-12-31`
    }

    setFromDate(newFrom)
    setToDate(newTo)
    setAsOfDate(newTo)
    fetchReports(newFrom, newTo, newTo)
  }

  // Drill Down Handler
  const handleAccountClick = async (accountId: string) => {
    setDrillDownLoading(true)
    try {
      const res = await getAccountDrillDown(storeId, accountId, fromDate, toDate)
      if (res) {
        setDrillDownData(res)
      }
    } catch (err) {
      console.error('Error opening drill down:', err)
    } finally {
      setDrillDownLoading(false)
    }
  }

  // PDF Print
  const handlePrint = () => {
    const reportTitles: Record<string, string> = {
      trial_balance: 'ميزان_المراجعة',
      income_statement: 'الأرباح_والخسائر',
      balance_sheet: 'الميزانية_العمومية',
      cash_flow: 'التدفقات_النقدية',
    }
    generateAndPrintPdf({
      elementId: 'printable-report-container',
      filename: `${reportTitles[activeTab]}_${toDate}.pdf`,
    })
  }

  const fmt = (n: number) =>
    Number(n || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  return (
    <div className="space-y-6">
      {/* ── Back to Hub ── */}
      <div>
        <BackToDashboardButton href="/dashboard/accounting-hub" label="العودة إلى لوحة الإدارة المالية والمحاسبية" />
      </div>

      {/* ── Header ── */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs text-slate-400 mb-1">
            <Link href="/dashboard" className="hover:text-white transition">الرئيسية</Link>
            <span>/</span>
            <Link href="/dashboard/accounting-hub" className="hover:text-white transition">المحاسبة</Link>
            <span>/</span>
            <span className="text-sky-400">القوائم والتقارير المالية</span>
          </div>
          <h1 className="text-2xl font-black text-white flex items-center gap-2.5">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/20 text-xl border border-indigo-500/30">
              📊
            </span>
            منظومة التقارير والقوائم المالية (General Ledger Reports)
          </h1>
          <p className="mt-1 text-xs text-slate-400">
            مصدر مركزي موحد: كافة التقارير تقرأ حصراً من قيود دفتر الأستاذ العام المعتمدة والمرحّلة (Posted Entries)
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={handlePrint}
            className="flex items-center gap-2 rounded-xl bg-slate-800 border border-white/10 px-4 py-2 text-xs font-bold text-white hover:bg-slate-700 transition"
          >
            <span>🖨️</span> طباعة / تصدير PDF
          </button>
        </div>
      </div>

      {/* ── شريط فحص السلامة والرقابة المحاسبية (8 Health Checks) ── */}
      {integrityReport && (
        <div className="rounded-2xl border border-white/10 bg-slate-900 p-4 shadow-xl">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <span className={`flex h-8 w-8 items-center justify-center rounded-lg text-base ${
                integrityReport.all_passed ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'
              }`}>
                {integrityReport.all_passed ? '🛡️' : '⚠️'}
              </span>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold text-white">فحص السلامة والرقابة المحاسبية (System Integrity)</h3>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                    integrityReport.all_passed
                      ? 'border border-emerald-500/30 bg-emerald-500/15 text-emerald-400'
                      : 'border border-rose-500/30 bg-rose-500/15 text-rose-400'
                  }`}>
                    {integrityReport.all_passed ? '✓ 8/8 فحوصات سليمة' : 'تنبيهات محاسبية'}
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  التحقق التلقائي من توازن القيود، سلامة الحسابات، قفل الفترات، وتطابق القوائم المالية
                </p>
              </div>
            </div>

            <button
              onClick={() => setShowIntegrityDetails(prev => !prev)}
              className="text-xs font-bold text-sky-400 hover:underline self-start sm:self-auto"
            >
              {showIntegrityDetails ? 'إخفاء التفاصيل ▲' : 'عرض الفحوصات الثمانية ▼'}
            </button>
          </div>

          {showIntegrityDetails && (
            <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 pt-3 border-t border-white/5">
              {integrityReport.checks.map(c => (
                <div
                  key={c.code}
                  className={`flex items-start gap-2.5 rounded-xl border p-2.5 text-xs ${
                    c.passed
                      ? 'border-emerald-500/20 bg-emerald-500/5 text-slate-300'
                      : 'border-rose-500/30 bg-rose-500/10 text-rose-300'
                  }`}
                >
                  <span className="text-sm">{c.passed ? '✅' : '❌'}</span>
                  <div className="min-w-0">
                    <p className="font-bold text-white text-[11px]">{c.title}</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">{c.details}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── فلترة الفترات الزمنية ── */}
      <div className="rounded-2xl border border-white/10 bg-slate-900 p-4 shadow-sm space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-slate-400">الفترة السريعة:</span>
            <button
              onClick={() => applyPreset('current_month')}
              className="rounded-lg border border-white/10 bg-slate-800 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-700"
            >
              الشهر الحالي
            </button>
            <button
              onClick={() => applyPreset('prev_month')}
              className="rounded-lg border border-white/10 bg-slate-800 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-700"
            >
              الشهر السابق
            </button>
            <button
              onClick={() => applyPreset('current_quarter')}
              className="rounded-lg border border-white/10 bg-slate-800 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-700"
            >
              الربع الحالي
            </button>
            <button
              onClick={() => applyPreset('current_year')}
              className="rounded-lg border border-white/10 bg-slate-800 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-700"
            >
              السنة المالية الحالية
            </button>
          </div>

          <div className="flex items-center gap-3">
            {activeTab !== 'balance_sheet' ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">من:</span>
                <input
                  type="date"
                  value={fromDate}
                  onChange={e => {
                    setFromDate(e.target.value)
                    fetchReports(e.target.value, toDate, asOfDate)
                  }}
                  className="rounded-xl border border-white/10 bg-slate-800 px-3 py-1.5 text-xs text-white outline-none font-mono"
                />
                <span className="text-xs text-slate-400">إلى:</span>
                <input
                  type="date"
                  value={toDate}
                  onChange={e => {
                    setToDate(e.target.value)
                    fetchReports(fromDate, e.target.value, asOfDate)
                  }}
                  className="rounded-xl border border-white/10 bg-slate-800 px-3 py-1.5 text-xs text-white outline-none font-mono"
                />
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">المركز المالي كما في:</span>
                <input
                  type="date"
                  value={asOfDate}
                  onChange={e => {
                    setAsOfDate(e.target.value)
                    fetchReports(fromDate, toDate, e.target.value)
                  }}
                  className="rounded-xl border border-white/10 bg-slate-800 px-3 py-1.5 text-xs text-white outline-none font-mono"
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── التبويبات الأربعة بالترتيب المحاسبي المعتمد ── */}
      <div className="flex flex-wrap border-b border-white/10">
        <button
          onClick={() => setActiveTab('trial_balance')}
          className={`flex items-center gap-2 border-b-2 px-5 py-3 text-xs font-bold transition ${
            activeTab === 'trial_balance'
              ? 'border-sky-500 text-sky-400 bg-sky-500/5'
              : 'border-transparent text-slate-400 hover:text-white'
          }`}
        >
          <span>⚖️</span> 1. ميزان المراجعة (Trial Balance)
        </button>

        <button
          onClick={() => setActiveTab('income_statement')}
          className={`flex items-center gap-2 border-b-2 px-5 py-3 text-xs font-bold transition ${
            activeTab === 'income_statement'
              ? 'border-emerald-500 text-emerald-400 bg-emerald-500/5'
              : 'border-transparent text-slate-400 hover:text-white'
          }`}
        >
          <span>📊</span> 2. الأرباح والخسائر (Income Statement)
        </button>

        <button
          onClick={() => setActiveTab('balance_sheet')}
          className={`flex items-center gap-2 border-b-2 px-5 py-3 text-xs font-bold transition ${
            activeTab === 'balance_sheet'
              ? 'border-indigo-500 text-indigo-400 bg-indigo-500/5'
              : 'border-transparent text-slate-400 hover:text-white'
          }`}
        >
          <span>🏛️</span> 3. الميزانية العمومية (Balance Sheet)
        </button>

        <button
          onClick={() => setActiveTab('cash_flow')}
          className={`flex items-center gap-2 border-b-2 px-5 py-3 text-xs font-bold transition ${
            activeTab === 'cash_flow'
              ? 'border-amber-500 text-amber-400 bg-amber-500/5'
              : 'border-transparent text-slate-400 hover:text-white'
          }`}
        >
          <span>💸</span> 4. التدفقات النقدية (Cash Flow)
        </button>
      </div>

      {/* ── محتوى التقارير القابل للطباعة ── */}
      <div id="printable-report-container" className="space-y-6 bg-slate-950 p-1 rounded-2xl">
        {reportError ? (
          <div role="alert" className="rounded-xl border border-rose-500/40 bg-rose-950/30 p-5 text-rose-200">التقرير غير مكتمل: {reportError}</div>
        ) : loading ? (
          <div className="p-16 text-center text-slate-400">
            <span className="text-3xl animate-spin inline-block mb-3">⌛</span>
            <p className="text-sm font-bold text-white">جاري احتساب وتوليد التقرير المالي من دفتر الأستاذ...</p>
          </div>
        ) : (
          <>
            {/* ══════════════════════════════════════════════════════════════
                1. ميزان المراجعة (Trial Balance)
            ══════════════════════════════════════════════════════════════ */}
            {activeTab === 'trial_balance' && trialBalance && (
              <div className="space-y-4">
                <div className="rounded-2xl border border-white/10 bg-slate-900 p-5 shadow-xl">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-white/10 pb-4 mb-4">
                    <div>
                      <h2 className="text-lg font-black text-white">ميزان المراجعة (Trial Balance)</h2>
                      <p className="text-xs text-slate-400 mt-0.5">
                        الفترة من <span className="font-mono text-slate-200">{fromDate}</span> إلى <span className="font-mono text-slate-200">{toDate}</span>
                      </p>
                    </div>

                    <div className="flex items-center gap-3">
                      <span className={`rounded-xl px-3 py-1.5 text-xs font-bold ${
                        trialBalance.is_balanced
                          ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                          : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                      }`}>
                        {trialBalance.is_balanced ? '✅ متوازن تماماً (الفرق = 0)' : `⚠️ غير متوازن بفارق ${fmt(trialBalance.difference)}`}
                      </span>
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-right text-xs">
                      <thead>
                        <tr className="border-b border-white/10 bg-slate-800/60 text-slate-300">
                          <th className="p-3 font-bold" rowSpan={2}>كود</th>
                          <th className="p-3 font-bold" rowSpan={2}>اسم الحساب</th>
                          <th className="p-2 font-bold text-center border-x border-white/5" colSpan={2}>الرصيد الافتتاحي</th>
                          <th className="p-2 font-bold text-center border-x border-white/5" colSpan={2}>حركة الفترة</th>
                          <th className="p-2 font-bold text-center border-r border-white/5" colSpan={2}>الرصيد الختامي</th>
                        </tr>
                        <tr className="border-b border-white/10 bg-slate-800/40 text-[11px] text-slate-400">
                          <th className="p-2 text-center text-emerald-400">مدين</th>
                          <th className="p-2 text-center text-rose-400 border-l border-white/5">دائن</th>
                          <th className="p-2 text-center text-emerald-400">مدين</th>
                          <th className="p-2 text-center text-rose-400 border-l border-white/5">دائن</th>
                          <th className="p-2 text-center text-emerald-400">مدين</th>
                          <th className="p-2 text-center text-rose-400">دائن</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5 text-slate-300 font-mono">
                        {trialBalance.items.map(i => (
                          <tr
                            key={i.account_id}
                            onClick={() => handleAccountClick(i.account_id)}
                            className="hover:bg-slate-800/50 cursor-pointer transition"
                            title="اضغط للانتقال لكشف الحساب والقيود الأصلية (Drill Down)"
                          >
                            <td className="p-3 font-bold text-sky-400">{i.code}</td>
                            <td className="p-3 font-sans font-semibold text-white">
                              {i.name}
                              <span className="mr-2 text-[10px] text-slate-500 font-normal">({i.type})</span>
                            </td>
                            <td className="p-2 text-center text-emerald-300">{i.opening_debit > 0 ? fmt(i.opening_debit) : '—'}</td>
                            <td className="p-2 text-center text-rose-300 border-l border-white/5">{i.opening_credit > 0 ? fmt(i.opening_credit) : '—'}</td>
                            <td className="p-2 text-center text-emerald-300">{i.period_debit > 0 ? fmt(i.period_debit) : '—'}</td>
                            <td className="p-2 text-center text-rose-300 border-l border-white/5">{i.period_credit > 0 ? fmt(i.period_credit) : '—'}</td>
                            <td className="p-2 text-center text-emerald-400 font-bold bg-emerald-500/5">{i.closing_debit > 0 ? fmt(i.closing_debit) : '—'}</td>
                            <td className="p-2 text-center text-rose-400 font-bold bg-rose-500/5">{i.closing_credit > 0 ? fmt(i.closing_credit) : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t-2 border-white/20 bg-slate-800/90 text-xs font-black text-white font-mono">
                          <td className="p-3 font-sans" colSpan={2}>الإجمالي العام</td>
                          <td className="p-3 text-center text-emerald-400">{fmt(trialBalance.total_opening_debit)}</td>
                          <td className="p-3 text-center text-rose-400 border-l border-white/10">{fmt(trialBalance.total_opening_credit)}</td>
                          <td className="p-3 text-center text-emerald-400">{fmt(trialBalance.total_period_debit)}</td>
                          <td className="p-3 text-center text-rose-400 border-l border-white/10">{fmt(trialBalance.total_period_credit)}</td>
                          <td className="p-3 text-center text-emerald-400 bg-emerald-500/10">{fmt(trialBalance.total_closing_debit)}</td>
                          <td className="p-3 text-center text-rose-400 bg-rose-500/10">{fmt(trialBalance.total_closing_credit)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* ══════════════════════════════════════════════════════════════
                2. قائمة الأرباح والخسائر (Income Statement / P&L)
            ══════════════════════════════════════════════════════════════ */}
            {activeTab === 'income_statement' && incomeStatement && (
              <div className="space-y-4">
                <div className="rounded-2xl border border-white/10 bg-slate-900 p-6 shadow-xl space-y-6">
                  <div className="border-b border-white/10 pb-4">
                    <h2 className="text-lg font-black text-white">قائمة الأرباح والخسائر (Income Statement / P&L)</h2>
                    <p className="text-xs text-slate-400 mt-0.5">
                      الأداء المالي عن الفترة من <span className="font-mono text-slate-200">{fromDate}</span> إلى <span className="font-mono text-slate-200">{toDate}</span>
                    </p>
                  </div>

                  {/* 1. الإيرادات وصافي المبيعات */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between font-bold text-sm text-sky-400 border-b border-white/5 pb-2">
                      <span>1. إيرادات المبيعات والخدمات (Revenues)</span>
                      <span className="font-mono">{fmt(incomeStatement.gross_sales)} {currencyCode}</span>
                    </div>

                    <div className="pr-4 space-y-1 text-xs">
                      {incomeStatement.sales_items.map(i => (
                        <div
                          key={i.account_id}
                          onClick={() => handleAccountClick(i.account_id)}
                          className="flex items-center justify-between text-slate-300 hover:text-white cursor-pointer py-1 hover:bg-white/5 rounded px-2"
                        >
                          <span>{i.code} — {i.name}</span>
                          <span className="font-mono">{fmt(i.amount)}</span>
                        </div>
                      ))}

                      {incomeStatement.contra_items.map(i => (
                        <div
                          key={i.account_id}
                          onClick={() => handleAccountClick(i.account_id)}
                          className="flex items-center justify-between text-rose-400 hover:text-rose-300 cursor-pointer py-1 hover:bg-white/5 rounded px-2"
                        >
                          <span>(-) {i.code} — {i.name}</span>
                          <span className="font-mono">({fmt(i.amount)})</span>
                        </div>
                      ))}
                    </div>

                    <div className="flex items-center justify-between font-bold text-xs text-white bg-slate-800/60 p-2.5 rounded-xl">
                      <span>صافي إيرادات المبيعات (Net Sales)</span>
                      <span className="font-mono text-sky-400">{fmt(incomeStatement.net_sales)} {currencyCode}</span>
                    </div>
                  </div>

                  {/* 2. تكلفة المبيعات ومجمل الربح */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between font-bold text-sm text-amber-400 border-b border-white/5 pb-2">
                      <span>2. تكلفة البضاعة المباعة (Cost of Goods Sold - COGS)</span>
                      <span className="font-mono text-rose-400">({fmt(incomeStatement.cogs)}) {currencyCode}</span>
                    </div>

                    <div className="pr-4 space-y-1 text-xs">
                      {incomeStatement.cogs_items.map(i => (
                        <div
                          key={i.account_id}
                          onClick={() => handleAccountClick(i.account_id)}
                          className="flex items-center justify-between text-slate-300 hover:text-white cursor-pointer py-1 hover:bg-white/5 rounded px-2"
                        >
                          <span>{i.code} — {i.name}</span>
                          <span className="font-mono">{fmt(i.amount)}</span>
                        </div>
                      ))}
                    </div>

                    <div className="flex items-center justify-between font-black text-sm text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 p-3 rounded-xl">
                      <span>مجمل الربح التجاري (Gross Profit)</span>
                      <span className="font-mono">{fmt(incomeStatement.gross_profit)} {currencyCode}</span>
                    </div>
                  </div>

                  {/* 3. المصروفات التشغيلية */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between font-bold text-sm text-rose-400 border-b border-white/5 pb-2">
                      <span>3. المصروفات التشغيلية والإدارية (Operating Expenses)</span>
                      <span className="font-mono text-rose-400">({fmt(incomeStatement.operating_expenses)}) {currencyCode}</span>
                    </div>

                    <div className="pr-4 space-y-1 text-xs">
                      {incomeStatement.expense_items.map(i => (
                        <div
                          key={i.account_id}
                          onClick={() => handleAccountClick(i.account_id)}
                          className="flex items-center justify-between text-slate-300 hover:text-white cursor-pointer py-1 hover:bg-white/5 rounded px-2"
                        >
                          <span>{i.code} — {i.name}</span>
                          <span className="font-mono">{fmt(i.amount)}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* 4. صافي نتيجة النشاط */}
                  <div className={`p-5 rounded-2xl border flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 ${
                    incomeStatement.net_profit >= 0
                      ? 'border-emerald-500/30 bg-gradient-to-r from-emerald-500/20 via-slate-900 to-slate-900'
                      : 'border-rose-500/30 bg-gradient-to-r from-rose-500/20 via-slate-900 to-slate-900'
                  }`}>
                    <div>
                      <h3 className="text-base font-black text-white">
                        {incomeStatement.net_profit >= 0 ? 'صافي الربح للفترة (Net Profit)' : 'صافي الخسارة للفترة (Net Loss)'}
                      </h3>
                      <p className="text-xs text-slate-400 mt-0.5">
                        مجمل الربح - المصروفات التشغيلية ± الإيرادات والمصاريف الأخرى
                      </p>
                    </div>

                    <div className="font-mono text-2xl font-black">
                      <span className={incomeStatement.net_profit >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                        {incomeStatement.net_profit >= 0 ? '+' : ''}{fmt(incomeStatement.net_profit)}
                      </span>{' '}
                      <span className="text-sm font-bold text-white">{currencyCode}</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ══════════════════════════════════════════════════════════════
                3. الميزانية العمومية (Balance Sheet / المركز المالي)
            ══════════════════════════════════════════════════════════════ */}
            {activeTab === 'balance_sheet' && balanceSheet && (
              <div className="space-y-4">
                <div className="rounded-2xl border border-white/10 bg-slate-900 p-6 shadow-xl space-y-6">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-white/10 pb-4">
                    <div>
                      <h2 className="text-lg font-black text-white">الميزانية العمومية / قائمة المركز المالي</h2>
                      <p className="text-xs text-slate-400 mt-0.5">
                        الوضع المالي التراكمي كما في تاريخ <span className="font-mono text-slate-200">{asOfDate}</span>
                      </p>
                    </div>

                    <span className={`rounded-xl px-3 py-1.5 text-xs font-bold ${
                      balanceSheet.is_balanced
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                        : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                    }`}>
                      {balanceSheet.is_balanced ? '✅ الأصول = الالتزامات + حقوق الملكية' : `⚠️ عدم توازن بفارق: ${fmt(balanceSheet.difference)}`}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* الجانب الأيمن: الأصول */}
                    <div className="space-y-5 rounded-2xl border border-white/10 bg-slate-900/60 p-5">
                      <h3 className="text-sm font-black text-emerald-400 border-b border-white/10 pb-2 flex items-center justify-between">
                        <span>أولاً: الأصول (Assets)</span>
                        <span className="font-mono text-white">{fmt(balanceSheet.total_assets)} {currencyCode}</span>
                      </h3>

                      {/* أصول متداولة */}
                      <div className="space-y-2">
                        <p className="text-xs font-bold text-slate-300">الأصول المتداولة (Current Assets)</p>
                        <div className="pr-3 space-y-1 text-xs">
                          {balanceSheet.current_assets.items.map(i => (
                            <div
                              key={i.account_id}
                              onClick={() => handleAccountClick(i.account_id)}
                              className="flex items-center justify-between text-slate-300 hover:text-white cursor-pointer py-1 hover:bg-white/5 rounded px-2"
                            >
                              <span>{i.code} — {i.name}</span>
                              <span className="font-mono">{fmt(i.amount)}</span>
                            </div>
                          ))}
                        </div>
                        <div className="flex items-center justify-between text-xs font-bold text-slate-400 bg-slate-800/40 p-2 rounded-lg">
                          <span>إجمالي الأصول المتداولة</span>
                          <span className="font-mono text-white">{fmt(balanceSheet.current_assets.total)}</span>
                        </div>
                      </div>

                      {/* أصول غير متداولة */}
                      {balanceSheet.non_current_assets.items.length > 0 && (
                        <div className="space-y-2">
                          <p className="text-xs font-bold text-slate-300">الأصول الثابتة وغير المتداولة</p>
                          <div className="pr-3 space-y-1 text-xs">
                            {balanceSheet.non_current_assets.items.map(i => (
                              <div
                                key={i.account_id}
                                onClick={() => handleAccountClick(i.account_id)}
                                className="flex items-center justify-between text-slate-300 hover:text-white cursor-pointer py-1 hover:bg-white/5 rounded px-2"
                              >
                                <span>{i.code} — {i.name}</span>
                                <span className="font-mono">{fmt(i.amount)}</span>
                              </div>
                            ))}
                          </div>
                          <div className="flex items-center justify-between text-xs font-bold text-slate-400 bg-slate-800/40 p-2 rounded-lg">
                            <span>إجمالي الأصول الثابتة</span>
                            <span className="font-mono text-white">{fmt(balanceSheet.non_current_assets.total)}</span>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* الجانب الأيسر: الالتزامات وحقوق الملكية */}
                    <div className="space-y-5 rounded-2xl border border-white/10 bg-slate-900/60 p-5">
                      <h3 className="text-sm font-black text-indigo-400 border-b border-white/10 pb-2 flex items-center justify-between">
                        <span>ثانياً: الالتزامات والملكية (Liabilities & Equity)</span>
                        <span className="font-mono text-white">{fmt(balanceSheet.total_liabilities + balanceSheet.total_equity)} {currencyCode}</span>
                      </h3>

                      {/* الالتزامات */}
                      <div className="space-y-2">
                        <p className="text-xs font-bold text-slate-300">الالتزامات (Liabilities)</p>
                        <div className="pr-3 space-y-1 text-xs">
                          {balanceSheet.current_liabilities.items.map(i => (
                            <div
                              key={i.account_id}
                              onClick={() => handleAccountClick(i.account_id)}
                              className="flex items-center justify-between text-slate-300 hover:text-white cursor-pointer py-1 hover:bg-white/5 rounded px-2"
                            >
                              <span>{i.code} — {i.name}</span>
                              <span className="font-mono">{fmt(i.amount)}</span>
                            </div>
                          ))}
                        </div>
                        <div className="flex items-center justify-between text-xs font-bold text-slate-400 bg-slate-800/40 p-2 rounded-lg">
                          <span>إجمالي الالتزامات</span>
                          <span className="font-mono text-white">{fmt(balanceSheet.total_liabilities)}</span>
                        </div>
                      </div>

                      {/* حقوق الملكية */}
                      <div className="space-y-2">
                        <p className="text-xs font-bold text-slate-300">حقوق الملكية (Owner’s Equity)</p>
                        <div className="pr-3 space-y-1 text-xs">
                          {balanceSheet.equity.items.map(i => (
                            <div
                              key={i.account_id}
                              onClick={() => handleAccountClick(i.account_id)}
                              className="flex items-center justify-between text-slate-300 hover:text-white cursor-pointer py-1 hover:bg-white/5 rounded px-2"
                            >
                              <span>{i.code} — {i.name}</span>
                              <span className="font-mono">{fmt(i.amount)}</span>
                            </div>
                          ))}

                          {/* صافي ربح الفترة مرتبط تلقائياً */}
                          <div className="flex items-center justify-between text-emerald-400 font-bold py-1 bg-emerald-500/5 rounded px-2">
                            <span>صافي أرباح/خسائر الفترة حتى تاريخه</span>
                            <span className="font-mono">{fmt(balanceSheet.period_net_profit)}</span>
                          </div>
                        </div>
                        <div className="flex items-center justify-between text-xs font-bold text-slate-400 bg-slate-800/40 p-2 rounded-lg">
                          <span>إجمالي حقوق الملكية</span>
                          <span className="font-mono text-white">{fmt(balanceSheet.total_equity)}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ══════════════════════════════════════════════════════════════
                4. قائمة التدفقات النقدية (Cash Flow Statement)
            ══════════════════════════════════════════════════════════════ */}
            {activeTab === 'cash_flow' && cashFlow && (
              <div className="space-y-4">
                <div className="rounded-2xl border border-white/10 bg-slate-900 p-6 shadow-xl space-y-6">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-white/10 pb-4">
                    <div>
                      <h2 className="text-lg font-black text-white">قائمة التدفقات النقدية (Cash Flow Statement)</h2>
                      <p className="text-xs text-slate-400 mt-0.5">
                        حركة السيولة النقدية الفعلية للفترة من <span className="font-mono text-slate-200">{fromDate}</span> إلى <span className="font-mono text-slate-200">{toDate}</span>
                      </p>
                    </div>

                    <span className={`rounded-xl px-3 py-1.5 text-xs font-bold ${
                      cashFlow.is_reconciled
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                        : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                    }`}>
                      {cashFlow.is_reconciled ? '✅ النقد مطابق تماماً للميزانية' : '⚠️ فارق طفيف في مطابقة رصيد النقد'}
                    </span>
                  </div>

                  <div className="space-y-4 text-xs">
                    {/* 1. الأنشطة التشغيلية */}
                    <div className="rounded-xl border border-white/5 bg-slate-800/40 p-4 space-y-2">
                      <div className="flex items-center justify-between font-bold text-sm text-sky-400">
                        <span>1. التدفقات النقدية من الأنشطة التشغيلية</span>
                        <span className="font-mono">{fmt(cashFlow.operating_activities.net_operating_flow)} {currencyCode}</span>
                      </div>
                      <div className="pr-4 space-y-1 text-slate-300">
                        <div className="flex justify-between py-0.5">
                          <span>(+) المقبوضات النقدية من العملاء (مبيعات وسندات قبض)</span>
                          <span className="font-mono text-emerald-400">+{fmt(cashFlow.operating_activities.customer_collections)}</span>
                        </div>
                        <div className="flex justify-between py-0.5">
                          <span>(-) المدفوعات النقدية للموردين (مشتريات وسداد فواتير)</span>
                          <span className="font-mono text-rose-400">-{fmt(cashFlow.operating_activities.supplier_payments)}</span>
                        </div>
                        <div className="flex justify-between py-0.5">
                          <span>(-) المصروفات التشغيلية والمصاريف النقدية</span>
                          <span className="font-mono text-rose-400">-{fmt(cashFlow.operating_activities.operating_expenses)}</span>
                        </div>
                      </div>
                    </div>

                    {/* 2. الأنشطة الاستثمارية */}
                    <div className="rounded-xl border border-white/5 bg-slate-800/40 p-4 space-y-2">
                      <div className="flex items-center justify-between font-bold text-sm text-indigo-400">
                        <span>2. التدفقات النقدية من الأنشطة الاستثمارية</span>
                        <span className="font-mono">{fmt(cashFlow.investing_activities.net_investing_flow)} {currencyCode}</span>
                      </div>
                      <div className="pr-4 space-y-1 text-slate-300">
                        <div className="flex justify-between py-0.5">
                          <span>(-) شراء أصول ومعدات ثابتة</span>
                          <span className="font-mono text-rose-400">-{fmt(cashFlow.investing_activities.fixed_assets_purchases)}</span>
                        </div>
                        <div className="flex justify-between py-0.5">
                          <span>(+) بيع أصول ثابتة</span>
                          <span className="font-mono text-emerald-400">+{fmt(cashFlow.investing_activities.fixed_assets_sales)}</span>
                        </div>
                      </div>
                    </div>

                    {/* 3. الأنشطة التمويلية */}
                    <div className="rounded-xl border border-white/5 bg-slate-800/40 p-4 space-y-2">
                      <div className="flex items-center justify-between font-bold text-sm text-purple-400">
                        <span>3. التدفقات النقدية من الأنشطة التمويلية</span>
                        <span className="font-mono">{fmt(cashFlow.financing_activities.net_financing_flow)} {currencyCode}</span>
                      </div>
                      <div className="pr-4 space-y-1 text-slate-300">
                        <div className="flex justify-between py-0.5">
                          <span>(+) إيداعات رأس المال وزيادة الحصة</span>
                          <span className="font-mono text-emerald-400">+{fmt(cashFlow.financing_activities.capital_injections)}</span>
                        </div>
                        <div className="flex justify-between py-0.5">
                          <span>(-) مسحوبات المالك والشركاء</span>
                          <span className="font-mono text-rose-400">-{fmt(cashFlow.financing_activities.drawings)}</span>
                        </div>
                      </div>
                    </div>

                    {/* الخلاصة والمطابقة */}
                    <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-5 space-y-3">
                      <div className="flex justify-between text-sm font-bold text-white">
                        <span>صافي التغير في النقد خلال الفترة</span>
                        <span className="font-mono text-amber-400">{fmt(cashFlow.net_change_in_cash)} {currencyCode}</span>
                      </div>
                      <div className="flex justify-between text-xs text-slate-300">
                        <span>(+) رصيد النقد في بداية الفترة</span>
                        <span className="font-mono">{fmt(cashFlow.opening_cash)} {currencyCode}</span>
                      </div>
                      <div className="flex justify-between text-base font-black text-emerald-400 border-t border-white/10 pt-3">
                        <span>(=) رصيد النقد في نهاية الفترة</span>
                        <span className="font-mono">{fmt(cashFlow.closing_cash)} {currencyCode}</span>
                      </div>
                      <div className="flex justify-between text-[11px] text-slate-400 border-t border-white/5 pt-2">
                        <span>رصيد النقد والبنوك وفق الميزانية العمومية:</span>
                        <span className="font-mono font-bold text-slate-200">{fmt(cashFlow.balance_sheet_cash)} {currencyCode}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── نافذة الانتقال من التقرير إلى المصدر (Drill Down Modal) ── */}
      {drillDownData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-slate-900 shadow-2xl">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-white/10 bg-slate-800/80 px-6 py-4">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <span>📜</span> كشف حساب تفصيلي (Drill-Down): {drillDownData.account.name}
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  كود الحساب: <span className="font-mono text-sky-400">{drillDownData.account.code}</span> · النوع: <span className="text-slate-200">{drillDownData.account.type}</span>
                </p>
              </div>
              <button
                onClick={() => setDrillDownData(null)}
                className="text-slate-400 hover:text-white transition text-lg"
              >
                ✕
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {drillDownData.rows.length === 0 ? (
                <p className="text-center py-12 text-slate-500 text-xs">لا توجد حركات مسجلة على هذا الحساب في الفترة المحددة</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-right text-xs">
                    <thead>
                      <tr className="border-b border-white/10 bg-slate-800/40 text-slate-400 text-[11px]">
                        <th className="p-2.5">التاريخ</th>
                        <th className="p-2.5">رقم القيد</th>
                        <th className="p-2.5">المصدر</th>
                        <th className="p-2.5">البيان</th>
                        <th className="p-2.5 text-center text-emerald-400">مدين</th>
                        <th className="p-2.5 text-center text-rose-400">دائن</th>
                        <th className="p-2.5 text-center">المستند الأصلي</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5 text-slate-300 font-mono">
                      {drillDownData.rows.map(r => (
                        <tr key={r.line_id} className="hover:bg-slate-800/40 transition">
                          <td className="p-2.5">{r.date}</td>
                          <td className="p-2.5 font-bold text-sky-400">#{r.entry_number}</td>
                          <td className="p-2.5 font-sans">
                            <span className="rounded bg-white/5 px-2 py-0.5 text-[10px] text-slate-300 border border-white/10">
                              {r.source}
                            </span>
                          </td>
                          <td className="p-2.5 font-sans text-slate-300 max-w-xs truncate">{r.description}</td>
                          <td className="p-2.5 text-center text-emerald-400 font-bold">{r.debit > 0 ? fmt(r.debit) : '—'}</td>
                          <td className="p-2.5 text-center text-rose-400 font-bold">{r.credit > 0 ? fmt(r.credit) : '—'}</td>
                          <td className="p-2.5 text-center font-sans">
                            <div className="flex items-center justify-center gap-1.5">
                              <Link
                                href={`/dashboard/accounting/journal/print/${r.entry_id}`}
                                target="_blank"
                                className="rounded border border-white/10 bg-white/5 px-2 py-1 text-[10px] font-bold text-slate-300 hover:text-white"
                              >
                                القيد ↗
                              </Link>
                              {r.source === 'invoice' && r.ref_id && (
                                <Link
                                  href={`/dashboard/accounting/invoices/${r.ref_id}`}
                                  target="_blank"
                                  className="rounded border border-sky-500/30 bg-sky-500/10 px-2 py-1 text-[10px] font-bold text-sky-400 hover:bg-sky-500/20"
                                >
                                  الفاتورة ↗
                                </Link>
                              )}
                              {r.source === 'voucher' && r.ref_id && (
                                <Link
                                  href={`/dashboard/accounting/receipts/print/${r.ref_id}`}
                                  target="_blank"
                                  className="rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[10px] font-bold text-emerald-400 hover:bg-emerald-500/20"
                                >
                                  السند ↗
                                </Link>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="border-t border-white/10 bg-slate-800/40 px-6 py-3 flex justify-end">
              <button
                onClick={() => setDrillDownData(null)}
                className="rounded-xl border border-white/10 bg-slate-800 px-4 py-1.5 text-xs font-bold text-slate-300 hover:bg-slate-700"
              >
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
