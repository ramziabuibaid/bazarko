'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

interface Account {
  id: string
  code: string
  name: string
  type: string
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
  store: { id: string; name: string; currency_code: string; exchange_rate?: number | null }
  accounts: Account[]
}

const SUPPORTED_CURRENCIES = [
  { code: 'ILS', symbol: '₪', defaultRate: 1.0, label: 'شيكل (ILS)' },
  { code: 'USD', symbol: '$', defaultRate: 3.65, label: 'دولار (USD)' },
  { code: 'JOD', symbol: 'JD', defaultRate: 5.15, label: 'دينار أردني (JOD)' },
  { code: 'EUR', symbol: '€', defaultRate: 4.00, label: 'يورو (EUR)' },
]

export default function CreateJournalClient({ store, accounts }: Props) {
  const router = useRouter()
  const supabase = createClient()

  const [entryNumber, setEntryNumber] = useState(`JV-${Date.now().toString().slice(-6)}`)
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [description, setDescription] = useState('')
  const [lines, setLines] = useState<LineItem[]>([
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
  ])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

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

        // عند تغيير العملة، نحدث سعر الصرف الافتراضي
        if (field === 'currency') {
          const found = SUPPORTED_CURRENCIES.find(c => c.code === val)
          updated.exchange_rate = found?.defaultRate || 1.0
        }

        // عند إدخال مدين، نفرغ الدائن والعكس
        if (field === 'original_debit' && val) {
          updated.original_credit = ''
        } else if (field === 'original_credit' && val) {
          updated.original_debit = ''
        }

        // حساب المعادل بالشيكل الأساسي
        const rate = Number(updated.exchange_rate) || 1.0
        const oDebit = parseFloat(updated.original_debit) || 0
        const oCredit = parseFloat(updated.original_credit) || 0

        updated.debit = Math.round(oDebit * rate * 100) / 100
        updated.credit = Math.round(oCredit * rate * 100) / 100

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

  // Submit
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!isBalanced) {
      setError('لا يمكن حفظ القيد: القيد غير متوازن! يجب أن يتساوى إجمالي المدين مع إجمالي الدائن بالشيكل الأساسي تماماً')
      return
    }
    if (!description.trim()) {
      setError('يرجى كتابة بيان القيد العام')
      return
    }

    setLoading(true)
    setError('')

    try {
      // التحقق من قفل الفترة المحاسبية
      const { data: closedPeriod } = await supabase
        .from('accounting_periods')
        .select('period_name')
        .eq('store_id', store.id)
        .eq('is_closed', true)
        .lte('start_date', date)
        .gte('end_date', date)
        .maybeSingle()

      if (closedPeriod) {
        setError(`لا يمكن تسجيل قيد يومية في فترة محاسبية مقفلة (${closedPeriod.period_name})`)
        setLoading(false)
        return
      }

      // 1. Insert Journal Entry
      const { data: entry, error: entryErr } = await supabase
        .from('journal_entries')
        .insert({
          store_id: store.id,
          entry_number: entryNumber.trim(),
          date,
          description: description.trim(),
          source: 'manual',
          status: 'posted',
        })
        .select('id')
        .single()

      if (entryErr) throw entryErr

      // 2. Insert Lines with multi-currency tracking (Item 13)
      const linePayloads = lines.map((line, idx) => ({
        journal_entry_id: entry.id,
        account_id: line.account_id,
        debit: line.debit,
        credit: line.credit,
        original_debit: parseFloat(line.original_debit) || 0,
        original_credit: parseFloat(line.original_credit) || 0,
        currency: line.currency,
        exchange_rate: Number(line.exchange_rate) || 1.0,
        description: line.description.trim() || description.trim(),
        sort_order: idx + 1,
      }))

      const { error: linesErr } = await supabase.from('journal_lines').insert(linePayloads)
      if (linesErr) throw linesErr

      router.push('/dashboard/accounting/journal')
      router.refresh()
    } catch (err: any) {
      setError(err.message || 'فشل حفظ القيد')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6 max-w-6xl" dir="rtl">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-white flex items-center gap-2">
            <span>✍️</span> إنشاء قيد يومية متعدد العملات
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            تسجيل قيود يومية بالعملات المختلفة (شيكل، دولار، دينار، يورو) مع التحويل الآلي والتحقق من التوازن
          </p>
        </div>

        <Link
          href="/dashboard/accounting/journal"
          className="rounded-xl border border-white/10 bg-slate-800 px-4 py-2 text-xs font-bold text-slate-300 hover:bg-slate-700 hover:text-white transition"
        >
          ← العودة لدليل القيود
        </Link>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-4 text-xs font-bold text-rose-300">
          ⚠️ {error}
        </div>
      )}

      {/* ── Form Card ── */}
      <form onSubmit={handleSubmit} className="rounded-2xl border border-white/10 bg-slate-900 p-6 shadow-xl space-y-6">
        
        {/* بيانات القيد العامة */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-300">رقم القيد *</label>
            <input
              type="text"
              required
              value={entryNumber}
              onChange={e => setEntryNumber(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-slate-800 p-2.5 text-xs text-white outline-none focus:border-sky-500 font-mono font-bold"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-300">تاريخ القيد *</label>
            <input
              type="date"
              required
              value={date}
              onChange={e => setDate(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-slate-800 p-2.5 text-xs text-white outline-none focus:border-sky-500"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-300">بيان القيد العام *</label>
            <input
              type="text"
              required
              placeholder="مثال: إثبات حوالة بنكية بالدولار أو مصاريف تشغيل..."
              value={description}
              onChange={e => setDescription(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-slate-800 p-2.5 text-xs text-white outline-none focus:border-sky-500"
            />
          </div>
        </div>

        {/* ── جدول أطراف القيد (العملات وسعر الصرف) ── */}
        <div className="overflow-hidden rounded-xl border border-white/10 bg-slate-950">
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead>
                <tr className="border-b border-white/10 bg-slate-800/80 text-slate-400 font-bold">
                  <th className="p-3 w-8 text-center">#</th>
                  <th className="p-3 min-w-[200px]">الحساب من شجرة الحسابات *</th>
                  <th className="p-3 min-w-[140px]">البيان الفرعي</th>
                  <th className="p-3 w-28 text-center">العملة</th>
                  <th className="p-3 w-24 text-center">سعر الصرف</th>
                  <th className="p-3 w-36 text-emerald-400">مدين (Debit)</th>
                  <th className="p-3 w-36 text-rose-400">دائن (Credit)</th>
                  <th className="p-3 w-10 text-center" />
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {lines.map((line, idx) => (
                  <tr key={line.id} className="hover:bg-slate-900/50">
                    <td className="p-3 text-center text-slate-500 font-mono font-bold">{idx + 1}</td>

                    {/* الحساب */}
                    <td className="p-2">
                      <select
                        required
                        value={line.account_id}
                        onChange={e => updateLine(idx, 'account_id', e.target.value)}
                        className="w-full rounded-lg border border-white/10 bg-slate-900 p-2 text-xs text-white outline-none focus:border-sky-500 font-semibold"
                      >
                        {accounts.map(a => (
                          <option key={a.id} value={a.id}>
                            {a.code} — {a.name}
                          </option>
                        ))}
                      </select>
                    </td>

                    {/* البيان */}
                    <td className="p-2">
                      <input
                        type="text"
                        placeholder="شرح إضافي (اختياري)..."
                        value={line.description}
                        onChange={e => updateLine(idx, 'description', e.target.value)}
                        className="w-full rounded-lg border border-white/10 bg-slate-900 p-2 text-xs text-white outline-none focus:border-sky-500"
                      />
                    </td>

                    {/* محدد العملة (Item 13) */}
                    <td className="p-2">
                      <select
                        value={line.currency}
                        onChange={e => updateLine(idx, 'currency', e.target.value)}
                        className="w-full rounded-lg border border-white/10 bg-slate-900 p-2 text-xs text-white font-bold outline-none focus:border-sky-500 text-center"
                      >
                        {SUPPORTED_CURRENCIES.map(c => (
                          <option key={c.code} value={c.code}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                    </td>

                    {/* سعر الصرف */}
                    <td className="p-2">
                      <input
                        type="number"
                        step="0.0001"
                        min="0.0001"
                        disabled={line.currency === 'ILS'}
                        value={line.exchange_rate}
                        onChange={e => updateLine(idx, 'exchange_rate', parseFloat(e.target.value) || 1.0)}
                        className="w-full rounded-lg border border-white/10 bg-slate-900 p-2 text-xs font-mono font-bold text-center text-sky-400 outline-none focus:border-sky-500 disabled:opacity-40"
                      />
                    </td>

                    {/* المدين بالعملة الأجنبية والمعادل بالشيكل */}
                    <td className="p-2">
                      <input
                        type="number"
                        step="any"
                        placeholder="0.00"
                        value={line.original_debit}
                        onChange={e => updateLine(idx, 'original_debit', e.target.value)}
                        className="w-full rounded-lg border border-emerald-500/30 bg-slate-900 p-2 text-xs font-mono font-bold text-emerald-400 outline-none focus:border-emerald-500 text-left"
                      />
                      {line.currency !== 'ILS' && line.debit > 0 && (
                        <div className="text-[10px] text-emerald-400/80 font-mono text-left mt-0.5" dir="ltr">
                          ≈ {fmt(line.debit)} ₪
                        </div>
                      )}
                    </td>

                    {/* الدائن بالعملة الأجنبية والمعادل بالشيكل */}
                    <td className="p-2">
                      <input
                        type="number"
                        step="any"
                        placeholder="0.00"
                        value={line.original_credit}
                        onChange={e => updateLine(idx, 'original_credit', e.target.value)}
                        className="w-full rounded-lg border border-rose-500/30 bg-slate-900 p-2 text-xs font-mono font-bold text-rose-400 outline-none focus:border-rose-500 text-left"
                      />
                      {line.currency !== 'ILS' && line.credit > 0 && (
                        <div className="text-[10px] text-rose-400/80 font-mono text-left mt-0.5" dir="ltr">
                          ≈ {fmt(line.credit)} ₪
                        </div>
                      )}
                    </td>

                    {/* زر الحذف */}
                    <td className="p-2 text-center">
                      {lines.length > 2 && (
                        <button
                          type="button"
                          onClick={() => removeLine(idx)}
                          className="text-slate-500 hover:text-rose-400 p-1 text-sm font-bold transition"
                          title="حذف هذا السطر"
                        >
                          ✕
                        </button>
                      )}
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
          className="rounded-xl border border-dashed border-white/20 bg-slate-800/40 px-4 py-2 text-xs font-bold text-sky-400 hover:bg-slate-800 transition"
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
                ✅ القيد متوازن محاسبياً بالشيكل الأساسي
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-500/10 border border-rose-500/20 px-3 py-1 text-xs font-bold text-rose-400">
                ⚠️ القيد غير متوازن ({fmt(difference)} ₪)
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
            إلغاء وتراجع
          </Link>
          <button
            type="submit"
            disabled={!isBalanced || loading}
            className="flex-1 rounded-xl bg-gradient-to-r from-sky-500 to-blue-600 py-3 text-xs font-black text-slate-950 hover:from-sky-400 hover:to-blue-500 transition disabled:opacity-40 shadow-lg shadow-sky-500/20 cursor-pointer"
          >
            {loading ? 'جارٍ الترحيل والحفظ...' : '💾 ترحيل وحفظ القيد المحاسبي'}
          </button>
        </div>
      </form>
    </div>
  )
}
