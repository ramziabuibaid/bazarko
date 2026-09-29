'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import BackToDashboardButton from '@/components/dashboard/BackToDashboardButton'
import { updateJournalEntryAction } from '../../journal-actions'

interface Account {
  id: string
  code: string
  name: string
  type: string
  normal_balance?: string
}

interface LineItem {
  id: string
  account_id: string
  description: string
  currency: string
  exchange_rate: number
  original_debit: string
  original_credit: string
  debit: number
  credit: number
}

interface Props {
  entry: any
  linkedVoucher?: any
  accounts: Account[]
}

const SUPPORTED_CURRENCIES = [
  { code: 'ILS', symbol: '₪', defaultRate: 1.0, label: 'شيكل (ILS)' },
  { code: 'USD', symbol: '$', defaultRate: 3.65, label: 'دولار (USD)' },
  { code: 'JOD', symbol: 'JD', defaultRate: 5.15, label: 'دينار أردني (JOD)' },
  { code: 'EUR', symbol: '€', defaultRate: 4.00, label: 'يورو (EUR)' },
]

export default function EditJournalClient({ entry, linkedVoucher, accounts }: Props) {
  const router = useRouter()

  const [date, setDate] = useState<string>(() => {
    if (!entry.date) return new Date().toISOString().slice(0, 10)
    if (typeof entry.date === 'string') return entry.date.slice(0, 10)
    return new Date(entry.date).toISOString().slice(0, 10)
  })

  const [description, setDescription] = useState(entry.description || '')

  const [lines, setLines] = useState<LineItem[]>(() => {
    if (entry.lines && entry.lines.length > 0) {
      const sorted = [...entry.lines].sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0))
      return sorted.map((l: any, idx: number) => ({
        id: l.id || String(idx + 1),
        account_id: l.account_id || accounts[0]?.id || '',
        description: l.description || '',
        currency: l.currency || 'ILS',
        exchange_rate: Number(l.exchange_rate) || 1.0,
        original_debit: Number(l.original_debit || l.debit || 0) > 0 ? String(l.original_debit || l.debit) : '',
        original_credit: Number(l.original_credit || l.credit || 0) > 0 ? String(l.original_credit || l.credit) : '',
        debit: Number(l.debit || 0),
        credit: Number(l.credit || 0),
      }))
    }
    return [
      {
        id: '1',
        account_id: accounts[0]?.id || '',
        description: '',
        currency: 'ILS',
        exchange_rate: 1.0,
        original_debit: '',
        original_credit: '',
        debit: 0,
        credit: 0,
      },
      {
        id: '2',
        account_id: accounts[1]?.id || '',
        description: '',
        currency: 'ILS',
        exchange_rate: 1.0,
        original_debit: '',
        original_credit: '',
        debit: 0,
        credit: 0,
      },
    ]
  })

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  // Line helpers
  const addLine = () => {
    setLines(prev => [
      ...prev,
      {
        id: String(Date.now()),
        account_id: accounts[0]?.id || '',
        description: '',
        currency: 'ILS',
        exchange_rate: 1.0,
        original_debit: '',
        original_credit: '',
        debit: 0,
        credit: 0,
      },
    ])
  }

  const removeLine = (index: number) => {
    if (lines.length <= 2) return
    setLines(prev => prev.filter((_, idx) => idx !== index))
  }

  const updateLine = (index: number, field: keyof LineItem, val: any) => {
    setLines(prev =>
      prev.map((line, idx) => {
        if (idx !== index) return line

        const updated = { ...line, [field]: val }

        if (field === 'currency') {
          const cur = SUPPORTED_CURRENCIES.find(c => c.code === val)
          if (cur) updated.exchange_rate = cur.defaultRate
        }

        const oDebit = parseFloat(updated.original_debit) || 0
        const oCredit = parseFloat(updated.original_credit) || 0
        const rate = Number(updated.exchange_rate) || 1.0

        if (field === 'original_debit' && oDebit > 0) {
          updated.original_credit = ''
          updated.credit = 0
        } else if (field === 'original_credit' && oCredit > 0) {
          updated.original_debit = ''
          updated.debit = 0
        }

        updated.debit = Math.round((parseFloat(updated.original_debit) || 0) * rate * 100) / 100
        updated.credit = Math.round((parseFloat(updated.original_credit) || 0) * rate * 100) / 100

        return updated
      })
    )
  }

  // Calculate totals in base ILS currency
  const totalDebit = lines.reduce((sum, l) => sum + (l.debit || 0), 0)
  const totalCredit = lines.reduce((sum, l) => sum + (l.credit || 0), 0)
  const difference = Math.abs(totalDebit - totalCredit)
  const isBalanced = difference < 0.01 && totalDebit > 0

  const fmt = (n: number) => Number(n || 0).toLocaleString('ar-u-nu-latn', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!isBalanced) {
      setError('لا يمكن حفظ التعديل: القيد غير متوازن! يجب أن يتساوى إجمالي المدين مع إجمالي الدائن بالشيكل تماماً')
      return
    }
    if (!description.trim()) {
      setError('يرجى كتابة بيان القيد العام')
      return
    }

    setLoading(true)
    setError('')
    setSuccessMsg('')

    try {
      const payloadLines = lines.map(l => ({
        account_id: l.account_id,
        debit: l.debit,
        credit: l.credit,
        description: l.description.trim() || description.trim(),
        currency: l.currency,
        exchange_rate: Number(l.exchange_rate) || 1.0,
        original_debit: parseFloat(l.original_debit) || 0,
        original_credit: parseFloat(l.original_credit) || 0,
      }))

      const res = await updateJournalEntryAction({
        entryId: entry.id,
        date,
        description: description.trim(),
        lines: payloadLines,
      })

      if (!res.success) {
        throw new Error(res.error || 'فشل تعديل القيد المحاسبي')
      }

      setSuccessMsg('تم حفظ التعديلات وعكس الأثر القديم وتحديث الأرصدة والمستندات المرتبطة بنجاح!')
      setTimeout(() => {
        router.push('/dashboard/accounting/journal')
        router.refresh()
      }, 1200)
    } catch (err: any) {
      setError(err.message || 'حدث خطأ أثناء تعديل القيد')
    } finally {
      setLoading(false)
    }
  }

  const SOURCE_LABELS: Record<string, string> = {
    manual: 'قيد يدوي',
    invoice: 'فاتورة مبيعات',
    purchase: 'فاتورة مشتريات',
    sales_return: 'مرتجع مبيعات',
    purchase_return: 'مردود مشتريات',
    voucher: 'سند مالي',
    check_op: 'حركة شيكات',
    opening: 'قيد افتتاحي',
    closing: 'قيد إقفال',
    system: 'نظام آلي',
  }

  return (
    <div className="space-y-6 max-w-6xl mx-auto" dir="rtl">
      {/* ── Back button ── */}
      <div>
        <BackToDashboardButton href="/dashboard/accounting/journal" label="العودة إلى دفتر قيود اليومية" />
      </div>

      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-black text-white flex items-center gap-2">
              <span>✏️</span> تعديل القيد المحاسبي
            </h1>
            <span className="font-mono text-sm px-3 py-1 rounded-lg bg-sky-500/10 border border-sky-500/20 text-sky-400 font-bold">
              {entry.entry_number}
            </span>
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-white/10 font-semibold">
              {SOURCE_LABELS[entry.source] || entry.source}
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-400">
            تعديل الحسابات والمبالغ والبيان والتاريخ مع المزامنة العكسية الكاملة لدفتر الأستاذ العام
          </p>
        </div>
      </div>

      {/* ── Linked Document Alert ── */}
      {linkedVoucher && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5 text-amber-200">
          <div className="flex items-start gap-3">
            <span className="text-2xl">🔗</span>
            <div className="space-y-1">
              <p className="font-bold text-white text-base">
                مزامنة تشغيلية مرتبطة: هذا القيد ناتج عن {linkedVoucher.type === 'receipt' ? 'سند قبض' : 'سند صرف'} #{linkedVoucher.voucher_number}
              </p>
              <p className="text-xs text-amber-300/90 leading-relaxed">
                الطرف: <strong>{linkedVoucher.party_name || 'غير محدد'}</strong> — طريقة الدفع: <strong>{linkedVoucher.payment_method === 'cash' ? 'نقدي' : linkedVoucher.payment_method === 'check' ? 'شيكات' : linkedVoucher.payment_method}</strong>
              </p>
              <p className="text-xs text-slate-300 mt-2">
                ⚡ <strong>تأكيد المزامنة:</strong> عند تعديل الحسابات أو المبالغ، سيقوم النظام تلقائياً بإلغاء وعكس الأثر القديم وتحديث السند وحركة الخزينة وكشف حساب العميل بالتزامن المزدوج الكامل وبدون أي تعارض في البيانات.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── Status Messages ── */}
      {error && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-xs font-bold text-rose-300 flex items-center gap-2">
          <span>❌</span>
          <span>{error}</span>
        </div>
      )}

      {successMsg && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-xs font-bold text-emerald-300 flex items-center gap-2">
          <span>✅</span>
          <span>{successMsg}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* ── Basic Info Card ── */}
        <div className="rounded-2xl border border-white/10 bg-slate-900 p-6 space-y-4">
          <h2 className="text-sm font-bold text-white flex items-center gap-2">
            <span>📅</span> البيانات العامة للقيد
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1.5">
                رقم القيد
              </label>
              <input
                type="text"
                disabled
                value={entry.entry_number}
                className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-4 py-2.5 text-xs text-slate-400 font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1.5">
                تاريخ القيد <span className="text-rose-400">*</span>
              </label>
              <input
                type="date"
                required
                value={date}
                onChange={e => setDate(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-slate-950 px-4 py-2.5 text-xs text-white focus:border-sky-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1.5">
                البيان العام للقيد <span className="text-rose-400">*</span>
              </label>
              <input
                type="text"
                required
                placeholder="شرح موجز لعملية القيد المحاسبي..."
                value={description}
                onChange={e => setDescription(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-slate-950 px-4 py-2.5 text-xs text-white focus:border-sky-500 focus:outline-none"
              />
            </div>
          </div>
        </div>

        {/* ── Lines Table Card ── */}
        <div className="rounded-2xl border border-white/10 bg-slate-900 overflow-hidden">
          <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between">
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <span>📊</span> أطراف وسطور القيد المحاسبي
            </h2>
            <span className="text-xs text-slate-400">
              يجب أن يتطابق مجموع المدين مع مجموع الدائن
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead>
                <tr className="border-b border-white/10 bg-slate-950 text-slate-400">
                  <th className="px-4 py-3 font-semibold w-12 text-center">#</th>
                  <th className="px-4 py-3 font-semibold min-w-[260px]">الحساب المحاسبي</th>
                  <th className="px-4 py-3 font-semibold min-w-[180px]">البيان التحليلي للسطر</th>
                  <th className="px-4 py-3 font-semibold w-28">العملة</th>
                  <th className="px-4 py-3 font-semibold w-36 text-emerald-400">مدين (Debit)</th>
                  <th className="px-4 py-3 font-semibold w-36 text-rose-400">دائن (Credit)</th>
                  <th className="px-4 py-3 font-semibold w-12 text-center">إجراء</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {lines.map((line, idx) => (
                  <tr key={line.id} className="hover:bg-slate-800/40 transition">
                    <td className="px-4 py-3 text-center text-slate-500 font-mono">{idx + 1}</td>

                    <td className="px-4 py-3">
                      <select
                        value={line.account_id}
                        onChange={e => updateLine(idx, 'account_id', e.target.value)}
                        className="w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-xs text-white focus:border-sky-500 focus:outline-none"
                      >
                        {accounts.map(acc => (
                          <option key={acc.id} value={acc.id}>
                            {acc.code} — {acc.name} ({acc.type === 'asset' ? 'أصول' : acc.type === 'liability' ? 'خصوم' : acc.type === 'equity' ? 'حقوق ملكية' : acc.type === 'revenue' ? 'إيرادات' : 'مصروفات'})
                          </option>
                        ))}
                      </select>
                    </td>

                    <td className="px-4 py-3">
                      <input
                        type="text"
                        placeholder="اختياري - يتبع البيان العام"
                        value={line.description}
                        onChange={e => updateLine(idx, 'description', e.target.value)}
                        className="w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-xs text-white focus:border-sky-500 focus:outline-none"
                      >
                      </input>
                    </td>

                    <td className="px-4 py-3">
                      <select
                        value={line.currency}
                        onChange={e => updateLine(idx, 'currency', e.target.value)}
                        className="w-full rounded-lg border border-white/10 bg-slate-950 px-2 py-2 text-xs text-white focus:border-sky-500 focus:outline-none"
                      >
                        {SUPPORTED_CURRENCIES.map(c => (
                          <option key={c.code} value={c.code}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                    </td>

                    <td className="px-4 py-3">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="0.00"
                        value={line.original_debit}
                        onChange={e => updateLine(idx, 'original_debit', e.target.value)}
                        className="w-full rounded-lg border border-emerald-500/20 bg-slate-950 px-3 py-2 text-xs font-mono font-bold text-emerald-400 focus:border-emerald-500 focus:outline-none"
                      />
                    </td>

                    <td className="px-4 py-3">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="0.00"
                        value={line.original_credit}
                        onChange={e => updateLine(idx, 'original_credit', e.target.value)}
                        className="w-full rounded-lg border border-rose-500/20 bg-slate-950 px-3 py-2 text-xs font-mono font-bold text-rose-400 focus:border-rose-500 focus:outline-none"
                      />
                    </td>

                    <td className="px-4 py-3 text-center">
                      <button
                        type="button"
                        onClick={() => removeLine(idx)}
                        disabled={lines.length <= 2}
                        className="rounded-lg p-1.5 text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition disabled:opacity-20 disabled:hover:bg-transparent"
                        title="حذف السطر"
                      >
                        🗑️
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* زر إضافة سطر */}
        <button
          type="button"
          onClick={addLine}
          className="rounded-xl border border-dashed border-white/20 bg-slate-800/40 px-4 py-2.5 text-xs font-bold text-sky-400 hover:bg-slate-800 transition cursor-pointer"
        >
          ➕ إضافة طرف / سطر جديد للقيد
        </button>

        {/* شريط التحقق من توازن القيد بالشيكل الأساسي */}
        <div className="rounded-xl border border-white/10 bg-slate-950 p-4 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-6 text-xs font-mono">
            <div>
              <span className="text-slate-400">إجمالي المدين (ILS): </span>
              <span className="font-bold text-emerald-400 text-sm">
                {fmt(totalDebit)} ₪
              </span>
            </div>
            <div>
              <span className="text-slate-400">إجمالي الدائن (ILS): </span>
              <span className="font-bold text-rose-400 text-sm">
                {fmt(totalCredit)} ₪
              </span>
            </div>
            <div>
              <span className="text-slate-400">فرق التوازن: </span>
              <span className={`font-bold text-sm ${difference > 0.01 ? 'text-rose-400' : 'text-emerald-400'}`}>
                {fmt(difference)} ₪
              </span>
            </div>
          </div>

          <div>
            {isBalanced ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 px-3 py-1 text-xs font-bold text-emerald-400">
                ✅ القيد متوازن محاسبياً بالشيكل
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-500/10 border border-rose-500/20 px-3 py-1 text-xs font-bold text-rose-400">
                ⚠️ القيد غير متوازن (فرق: {fmt(difference)} ₪)
              </span>
            )}
          </div>
        </div>

        {/* أزرار الحفظ والإلغاء */}
        <div className="flex gap-4 pt-2">
          <Link
            href="/dashboard/accounting/journal"
            className="flex-1 rounded-xl border border-white/10 py-3 text-center text-xs font-bold text-slate-400 hover:bg-slate-800 transition"
          >
            إلغاء والعودة
          </Link>
          <button
            type="submit"
            disabled={!isBalanced || loading}
            className="flex-1 rounded-xl bg-gradient-to-r from-sky-500 to-blue-600 py-3 text-xs font-black text-slate-950 hover:from-sky-400 hover:to-blue-500 transition disabled:opacity-40 shadow-lg shadow-sky-500/20 cursor-pointer"
          >
            {loading ? 'جارٍ عكس الأثر القديم وتطبيق التعديلات...' : '💾 حفظ وتطبيق التعديلات المحاسبية'}
          </button>
        </div>
      </form>
    </div>
  )
}
