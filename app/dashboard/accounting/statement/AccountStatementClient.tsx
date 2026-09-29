'use client'

import { useState, useEffect, useMemo } from 'react'
import { getAccountStatement, getJournalEntryFullDetails } from '@/app/dashboard/accounting/accounts/account-actions'
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
  const [sourceFilter, setSourceFilter] = useState<string>('all')
  const [loading, setLoading] = useState<boolean>(false)
  const [error, setError] = useState<string>('')
  const [statementData, setStatementData] = useState<any>(null)
  const [printing, setPrinting] = useState<boolean>(false)

  // Account search filter
  const [accountSearch, setAccountSearch] = useState('')

  // Modal State for Inspecting Journal Entry & Its Originating Transaction
  const [inspectModalEntry, setInspectModalEntry] = useState<any | null>(null)
  const [inspectLoading, setInspectLoading] = useState<boolean>(false)
  const [inspectDetails, setInspectDetails] = useState<any | null>(null)

  const handleOpenEntryInspector = async (row: any) => {
    setInspectModalEntry(row)
    setInspectLoading(true)
    setInspectDetails(null)
    try {
      const res = await getJournalEntryFullDetails(row.entry_id)
      if (res.success) {
        setInspectDetails(res)
      }
    } catch (err) {
      console.error(err)
    } finally {
      setInspectLoading(false)
    }
  }

  const getSourceTypeLabel = (sourceType: string, isManual?: boolean) => {
    if (isManual || sourceType === 'manual') return 'قيد يدوي'
    switch (sourceType) {
      case 'receipt_voucher': return 'سند قبض'
      case 'payment_voucher': return 'سند صرف'
      case 'sales_invoice': return 'فاتورة مبيعات'
      case 'purchase_invoice': return 'فاتورة مشتريات'
      case 'sales_return': return 'مردود مبيعات'
      case 'purchase_return': return 'مردود مشتريات'
      case 'check_operation': return 'حركة شيك'
      case 'inventory_movement': return 'حركة مخزون'
      case 'treasury_transfer': return 'تحويل صناديق'
      default: return 'سند/عملية'
    }
  }

  const getSourceIcon = (sourceType: string, isManual?: boolean) => {
    if (isManual || sourceType === 'manual') return '✍️'
    switch (sourceType) {
      case 'receipt_voucher': return '💵'
      case 'payment_voucher': return '💸'
      case 'sales_invoice': return '🧾'
      case 'purchase_invoice': return '📦'
      case 'sales_return': return '🔄'
      case 'purchase_return': return '↩️'
      case 'check_operation': return '🏦'
      case 'inventory_movement': return '📊'
      case 'treasury_transfer': return '💼'
      default: return '🔗'
    }
  }

  const getSourceStyle = (sourceType: string, isManual?: boolean) => {
    if (isManual || sourceType === 'manual') {
      return { backgroundColor: 'rgba(168, 85, 247, 0.1)', borderColor: 'rgba(168, 85, 247, 0.3)', color: '#c084fc' }
    }
    switch (sourceType) {
      case 'receipt_voucher':
        return { backgroundColor: 'rgba(14, 165, 233, 0.12)', borderColor: 'rgba(14, 165, 233, 0.35)', color: '#38bdf8' }
      case 'payment_voucher':
        return { backgroundColor: 'rgba(239, 68, 68, 0.12)', borderColor: 'rgba(239, 68, 68, 0.35)', color: '#f87171' }
      case 'sales_invoice':
        return { backgroundColor: 'rgba(16, 185, 129, 0.12)', borderColor: 'rgba(16, 185, 129, 0.35)', color: '#34d399' }
      case 'purchase_invoice':
        return { backgroundColor: 'rgba(245, 158, 11, 0.12)', borderColor: 'rgba(245, 158, 11, 0.35)', color: '#fbbf24' }
      case 'sales_return':
        return { backgroundColor: 'rgba(236, 72, 153, 0.12)', borderColor: 'rgba(236, 72, 153, 0.35)', color: '#f472b6' }
      case 'purchase_return':
        return { backgroundColor: 'rgba(249, 115, 22, 0.12)', borderColor: 'rgba(249, 115, 22, 0.35)', color: '#fb923c' }
      case 'check_operation':
        return { backgroundColor: 'rgba(168, 85, 247, 0.12)', borderColor: 'rgba(168, 85, 247, 0.35)', color: '#c084fc' }
      case 'inventory_movement':
        return { backgroundColor: 'rgba(20, 184, 166, 0.12)', borderColor: 'rgba(20, 184, 166, 0.35)', color: '#2dd4bf' }
      case 'treasury_transfer':
        return { backgroundColor: 'rgba(99, 102, 241, 0.12)', borderColor: 'rgba(99, 102, 241, 0.35)', color: '#818cf8' }
      default:
        return { backgroundColor: 'rgba(148, 163, 184, 0.1)', borderColor: 'rgba(148, 163, 184, 0.3)', color: '#94a3b8' }
    }
  }

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
  const fetchStatement = async (accId = selectedAccountId, from = fromDate, to = toDate, src = sourceFilter) => {
    if (!accId) return
    setLoading(true)
    setError('')
    try {
      const res = await getAccountStatement(accId, from || undefined, to || undefined, src)
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
      fetchStatement(selectedAccountId, fromDate, toDate, sourceFilter)
    }
  }, [selectedAccountId, sourceFilter])

  const handleSourceChange = (newSource: string) => {
    setSourceFilter(newSource)
    fetchStatement(selectedAccountId, fromDate, toDate, newSource)
  }

  const setDatePreset = (preset: 'today' | 'month' | 'quarter' | 'year' | 'all') => {
    const now = new Date()
    const todayStr = now.toISOString().slice(0, 10)

    if (preset === 'today') {
      setFromDate(todayStr)
      setToDate(todayStr)
      fetchStatement(selectedAccountId, todayStr, todayStr, sourceFilter)
    } else if (preset === 'month') {
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10)
      setFromDate(firstDay)
      setToDate(todayStr)
      fetchStatement(selectedAccountId, firstDay, todayStr, sourceFilter)
    } else if (preset === 'quarter') {
      const qMonth = Math.floor(now.getMonth() / 3) * 3
      const firstDay = new Date(now.getFullYear(), qMonth, 1).toISOString().slice(0, 10)
      setFromDate(firstDay)
      setToDate(todayStr)
      fetchStatement(selectedAccountId, firstDay, todayStr, sourceFilter)
    } else if (preset === 'year') {
      const firstDay = new Date(now.getFullYear(), 0, 1).toISOString().slice(0, 10)
      setFromDate(firstDay)
      setToDate(todayStr)
      fetchStatement(selectedAccountId, firstDay, todayStr, sourceFilter)
    } else {
      setFromDate('')
      setToDate('')
      fetchStatement(selectedAccountId, '', '', sourceFilter)
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

        {/* Operation Source Filter Tabs */}
        <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-white/5 text-xs">
          <span className="font-semibold text-slate-400 text-[11px]">نوع العملية:</span>
          <button
            type="button"
            onClick={() => handleSourceChange('all')}
            className={`rounded-lg px-2.5 py-1 font-bold transition ${
              sourceFilter === 'all'
                ? 'bg-sky-500 text-slate-950'
                : 'bg-slate-800 text-slate-300 hover:text-white'
            }`}
          >
            كافة العمليات
          </button>
          <button
            type="button"
            onClick={() => handleSourceChange('voucher')}
            className={`rounded-lg px-2.5 py-1 font-bold transition ${
              sourceFilter === 'voucher'
                ? 'bg-sky-500 text-slate-950'
                : 'bg-slate-800 text-slate-300 hover:text-white'
            }`}
          >
            💵 سندات قبض وصرف
          </button>
          <button
            type="button"
            onClick={() => handleSourceChange('invoice')}
            className={`rounded-lg px-2.5 py-1 font-bold transition ${
              sourceFilter === 'invoice'
                ? 'bg-emerald-500 text-slate-950'
                : 'bg-slate-800 text-slate-300 hover:text-white'
            }`}
          >
            🧾 فواتير مبيعات
          </button>
          <button
            type="button"
            onClick={() => handleSourceChange('purchase')}
            className={`rounded-lg px-2.5 py-1 font-bold transition ${
              sourceFilter === 'purchase'
                ? 'bg-amber-500 text-slate-950'
                : 'bg-slate-800 text-slate-300 hover:text-white'
            }`}
          >
            📦 فواتير مشتريات
          </button>
          <button
            type="button"
            onClick={() => handleSourceChange('manual')}
            className={`rounded-lg px-2.5 py-1 font-bold transition ${
              sourceFilter === 'manual'
                ? 'bg-purple-500 text-white'
                : 'bg-slate-800 text-slate-300 hover:text-white'
            }`}
          >
            ✍️ قيود يدوية
          </button>
          <button
            type="button"
            onClick={() => handleSourceChange('check_op')}
            className={`rounded-lg px-2.5 py-1 font-bold transition ${
              sourceFilter === 'check_op'
                ? 'bg-indigo-500 text-white'
                : 'bg-slate-800 text-slate-300 hover:text-white'
            }`}
          >
            📑 حركات شيكات
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

      {/* ── Native In-System Statement Table (Dark Theme) ── */}
      <div className="overflow-hidden rounded-2xl border border-white/10 bg-slate-900 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-slate-800/60 p-4">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm font-black text-sky-400">[{selectedAccount?.code}]</span>
            <span className="text-sm font-bold text-white">{selectedAccount?.name}</span>
            <span className="rounded bg-sky-500/10 border border-sky-500/20 px-2 py-0.5 text-[10px] text-sky-300 font-bold">
              {TYPE_LABELS[selectedAccount?.type || ''] || selectedAccount?.type}
            </span>
          </div>
          <div className="flex items-center gap-3 text-xs text-slate-400">
            <span>العملة: <strong className="font-mono text-slate-200">{selectedAccount?.currency || currencyCode}</strong></span>
            <span>•</span>
            <span>طبيعة الحساب: <strong className="text-slate-200">{isDebitNature ? 'مدين (+)' : 'دائن (-)'}</strong></span>
            {fromDate && toDate && (
              <>
                <span>•</span>
                <span className="font-mono" dir="ltr">{fromDate} → {toDate}</span>
              </>
            )}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead>
              <tr className="border-b border-white/10 bg-slate-800/80 text-slate-400 font-bold text-[11px]">
                <th className="p-3 text-center w-12">#</th>
                <th className="p-3 w-24">التاريخ</th>
                <th className="p-3 w-28 text-center">رقم القيد</th>
                <th className="p-3 w-36 text-center">نوع العملية / الحركة</th>
                <th className="p-3">البيان والشرح المحاسبي</th>
                <th className="p-3 w-28 text-left text-emerald-400">مدين (+)</th>
                <th className="p-3 w-28 text-left text-rose-400">دائن (-)</th>
                <th className="p-3 w-32 text-left text-white">الرصيد التراكمي</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 text-slate-200">
              {/* Opening Balance Row */}
              <tr className="bg-slate-800/30 font-bold text-slate-300">
                <td className="p-3 text-center text-slate-500 font-mono">—</td>
                <td className="p-3 font-mono text-slate-400">{fromDate || 'بداية السجل'}</td>
                <td className="p-3 text-center text-slate-500 font-mono">—</td>
                <td className="p-3 text-center">
                  <span className="rounded bg-white/5 border border-white/10 px-2 py-0.5 text-[10px] text-slate-400">
                    رصيد سابق
                  </span>
                </td>
                <td className="p-3 text-slate-300">الرصيد الافتتاحي ما قبل تاريخ الفترة المحددة</td>
                <td className="p-3 text-left font-mono text-slate-500">—</td>
                <td className="p-3 text-left font-mono text-slate-500">—</td>
                <td className="p-3 text-left font-mono font-bold text-slate-200" dir="ltr">
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
                  <td colSpan={8} className="py-10 text-center text-slate-500">
                    لا توجد حركات مسجلة على هذا الحساب خلال الفترة المحددة.
                  </td>
                </tr>
              ) : (
                statementData.rows.map((row: any, idx: number) => {
                  return (
                    <tr key={row.id || idx} className="hover:bg-slate-800/40 transition group">
                      <td className="p-3 text-center font-mono text-slate-500 text-[11px]">{idx + 1}</td>
                      <td className="p-3 font-mono text-slate-400 whitespace-nowrap">{row.date}</td>
                      
                      {/* رقم القيد: زر يفتح نافذة فحص القيد والحركة الأصلية */}
                      <td className="p-3 text-center font-mono font-bold">
                        <button
                          type="button"
                          onClick={() => handleOpenEntryInspector(row)}
                          title="اضغط لمعاينة وتدقيق القيد المحاسبي وحركته الأصلية"
                          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-sky-400 hover:bg-sky-500/10 hover:text-sky-300 hover:underline transition"
                          dir="ltr"
                        >
                          <span>#{row.entry_number}</span>
                          <span className="text-[10px] opacity-70">🔍</span>
                        </button>
                      </td>

                      {/* نوع العملية / الحركة الأصلية: رابط مباشر للحركة الأصلية */}
                      <td className="p-3 text-center">
                        {row.source_url ? (
                          <Link
                            href={row.source_url}
                            title={`فتح ${getSourceTypeLabel(row.source_type, row.is_manual)} ${row.source_number ? `(${row.source_number})` : ''} مباشرة`}
                            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-bold transition hover:scale-105 border shadow-sm"
                            style={getSourceStyle(row.source_type, row.is_manual)}
                          >
                            <span>{getSourceIcon(row.source_type, row.is_manual)}</span>
                            <span>
                              {getSourceTypeLabel(row.source_type, row.is_manual)}
                              {row.source_number ? ` (${row.source_number})` : ''}
                            </span>
                            <span className="text-[10px] opacity-75">↗</span>
                          </Link>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleOpenEntryInspector(row)}
                            className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-bold border transition"
                            style={getSourceStyle('manual', true)}
                          >
                            <span>✍️</span>
                            <span>قيد يدوي مباشر</span>
                          </button>
                        )}
                      </td>
                      <td className="p-3 text-slate-200 font-medium">
                        {row.description}
                      </td>
                      <td className="p-3 text-left font-mono font-bold text-emerald-400" dir="ltr">
                        {row.debit > 0 ? fmt(row.debit) : '—'}
                      </td>
                      <td className="p-3 text-left font-mono font-bold text-rose-400" dir="ltr">
                        {row.credit > 0 ? fmt(row.credit) : '—'}
                      </td>
                      <td className="p-3 text-left font-mono font-black text-white text-sm" dir="ltr">
                        {fmt(row.balance)}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
            {statementData?.summary && (
              <tfoot>
                <tr className="border-t-2 border-white/10 bg-slate-800/90 font-bold text-xs text-white">
                  <td colSpan={5} className="p-3 text-right">
                    إجمالي حركات الفترة والرصيد الختامي:
                  </td>
                  <td className="p-3 text-left font-mono text-emerald-400 font-black" dir="ltr">
                    {fmt(statementData.summary.totalDebit)}
                  </td>
                  <td className="p-3 text-left font-mono text-rose-400 font-black" dir="ltr">
                    {fmt(statementData.summary.totalCredit)}
                  </td>
                  <td className="p-3 text-left font-mono text-sky-400 font-black text-sm" dir="ltr">
                    {fmt(statementData.summary.closingBalance)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* ── Official Printable Ledger Canvas (Offscreen / Print) ── */}
      <div
        id="account-statement-canvas"
        style={{ position: 'absolute', left: '-9999px', top: '-9999px', width: '900px' }}
        className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 text-slate-900 shadow-xl print:static print:w-full print:border-none print:shadow-none print:p-2"
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

      {/* ── Entry & Origin Inspector Modal ── */}
      {inspectModalEntry && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm" dir="rtl">
          <div className="w-full max-w-2xl rounded-2xl border border-white/10 bg-slate-900 shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-white/10 p-4 sm:p-5 bg-slate-800/80">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-500/10 border border-sky-500/20 text-xl">
                  {getSourceIcon(inspectModalEntry.source_type, inspectModalEntry.is_manual)}
                </span>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold text-white">
                      قيد اليومية #{inspectModalEntry.entry_number}
                    </h3>
                    <span className="rounded-full bg-sky-500/10 border border-sky-500/20 px-2 py-0.5 text-[10px] font-bold text-sky-300">
                      {inspectModalEntry.status === 'posted' ? 'مرحّل معتمد ✓' : inspectModalEntry.status}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5 font-mono">
                    تاريخ العملية: {inspectModalEntry.date}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setInspectModalEntry(null)}
                className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white transition"
              >
                ✕
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-4 sm:p-5 overflow-y-auto space-y-4 text-xs">
              {/* Description */}
              <div className="rounded-xl border border-white/5 bg-slate-800/50 p-3">
                <span className="text-[11px] font-semibold text-slate-400 block mb-1">البيان والشرح المحاسبي للقيد:</span>
                <p className="text-sm font-semibold text-white">{inspectModalEntry.description}</p>
              </div>

              {/* Origin Section */}
              {inspectLoading ? (
                <div className="rounded-xl border border-white/10 bg-slate-800/30 p-6 text-center text-slate-400">
                  <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-sky-500 border-t-transparent mb-2"></div>
                  <p>جارٍ فحص وتحميل بيانات الحركة الأصلية المرتبطة...</p>
                </div>
              ) : inspectDetails?.origin ? (
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 space-y-3">
                  <div className="flex items-center justify-between border-b border-emerald-500/20 pb-2.5">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">{getSourceIcon(inspectModalEntry.source_type)}</span>
                      <span className="text-xs font-bold text-emerald-300">
                        الحركة التشغيلية الأصلية: {inspectDetails.origin.kind}
                      </span>
                      {inspectDetails.origin.number && (
                        <span className="font-mono font-bold text-white bg-white/10 px-2 py-0.5 rounded text-[11px]" dir="ltr">
                          #{inspectDetails.origin.number}
                        </span>
                      )}
                    </div>
                    {inspectDetails.origin.url && (
                      <Link
                        href={inspectDetails.origin.url}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-500 transition shadow-lg shadow-emerald-950/40"
                      >
                        <span>{inspectDetails.origin.actionLabel || 'فتح الحركة الأصلية مباشرة'}</span>
                        <span>↗</span>
                      </Link>
                    )}
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 pt-1 text-[11px]">
                    {inspectDetails.origin.party && (
                      <div>
                        <span className="text-slate-400 block">الطرف / العميل:</span>
                        <strong className="text-slate-200">{inspectDetails.origin.party}</strong>
                      </div>
                    )}
                    {inspectDetails.origin.amount !== undefined && (
                      <div>
                        <span className="text-slate-400 block">المبلغ الإجمالي:</span>
                        <strong className="text-emerald-400 font-mono" dir="ltr">{fmt(inspectDetails.origin.amount)} {currencyCode}</strong>
                      </div>
                    )}
                    {inspectDetails.origin.destination && (
                      <div>
                        <span className="text-slate-400 block">الصندوق / الحساب:</span>
                        <strong className="text-slate-200">{inspectDetails.origin.destination}</strong>
                      </div>
                    )}
                    {inspectDetails.origin.method && (
                      <div>
                        <span className="text-slate-400 block">طريقة الدفع:</span>
                        <strong className="text-slate-200">{inspectDetails.origin.method}</strong>
                      </div>
                    )}
                    {inspectDetails.origin.status && (
                      <div>
                        <span className="text-slate-400 block">حالة الحركة:</span>
                        <strong className="text-slate-200">{inspectDetails.origin.status}</strong>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-purple-500/20 bg-purple-500/5 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">✍️</span>
                    <div>
                      <h4 className="text-xs font-bold text-purple-300">قيد محاسبي يدوي مباشر</h4>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        تم إنشاء هذا القيد يدوياً في دفتر اليومية العامة ولا يرتبط بعملية تشغيلية وسيطة كالبيع أو القبض.
                      </p>
                    </div>
                  </div>
                  <Link
                    href={`/dashboard/accounting/journal/${inspectModalEntry.entry_id}/edit`}
                    className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-purple-500/30 bg-purple-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-purple-500 transition"
                  >
                    <span>تعديل القيد اليدوي</span>
                    <span>✏️</span>
                  </Link>
                </div>
              )}

              {/* Journal Lines Table */}
              <div>
                <h4 className="text-xs font-bold text-slate-300 mb-2 flex items-center gap-2">
                  <span>⚖️</span> أطراف القيد المحاسبي المزدوج (Double-Entry Lines)
                </h4>
                <div className="overflow-hidden rounded-xl border border-white/10 bg-slate-950/60">
                  <table className="w-full text-right text-xs">
                    <thead>
                      <tr className="border-b border-white/10 bg-slate-800/80 text-[11px] text-slate-400">
                        <th className="p-2.5 font-bold">كود الحساب</th>
                        <th className="p-2.5 font-bold">اسم الحساب</th>
                        <th className="p-2.5 font-bold">البيان التحليلي</th>
                        <th className="p-2.5 text-left font-bold text-emerald-400">مدين (+)</th>
                        <th className="p-2.5 text-left font-bold text-rose-400">دائن (-)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5 text-slate-300">
                      {(inspectDetails?.lines || []).map((line: any) => (
                        <tr key={line.id} className="hover:bg-slate-800/30">
                          <td className="p-2.5 font-mono text-sky-400 font-bold">{line.account?.code || '—'}</td>
                          <td className="p-2.5 font-bold text-white">{line.account?.name || 'حساب غير محدد'}</td>
                          <td className="p-2.5 text-slate-400">{line.description || inspectModalEntry.description}</td>
                          <td className="p-2.5 text-left font-mono font-bold text-emerald-400" dir="ltr">
                            {Number(line.debit) > 0 ? fmt(line.debit) : '—'}
                          </td>
                          <td className="p-2.5 text-left font-mono font-bold text-rose-400" dir="ltr">
                            {Number(line.credit) > 0 ? fmt(line.credit) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-between border-t border-white/10 p-4 bg-slate-800/60">
              <Link
                href={`/dashboard/accounting/journal/print/${inspectModalEntry.entry_id}`}
                target="_blank"
                className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-slate-800 px-3.5 py-2 text-xs font-bold text-slate-200 hover:bg-slate-700 transition"
              >
                <span>🖨️</span>
                <span>طباعة قيد اليومية (PDF)</span>
              </Link>
              <button
                type="button"
                onClick={() => setInspectModalEntry(null)}
                className="rounded-xl bg-slate-700 px-4 py-2 text-xs font-bold text-white hover:bg-slate-600 transition"
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
