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
  debit: string
  credit: string
}

interface Props {
  store: { id: string; name: string; currency_code: string }
  accounts: Account[]
}

export default function CreateJournalClient({ store, accounts }: Props) {
  const router = useRouter()
  const supabase = createClient()

  const [entryNumber, setEntryNumber] = useState(`JV-${Date.now().toString().slice(-6)}`)
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [description, setDescription] = useState('')
  const [lines, setLines] = useState<LineItem[]>([
    { id: '1', account_id: accounts[0]?.id || '', description: '', debit: '', credit: '' },
    { id: '2', account_id: accounts[1]?.id || '', description: '', debit: '', credit: '' },
  ])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Line helpers
  const addLine = () => {
    setLines(prev => [
      ...prev,
      { id: String(Date.now()), account_id: accounts[0]?.id || '', description: '', debit: '', credit: '' },
    ])
  }

  const removeLine = (index: number) => {
    if (lines.length <= 2) return
    setLines(prev => prev.filter((_, idx) => idx !== index))
  }

  const updateLine = (index: number, field: keyof LineItem, val: string) => {
    setLines(prev =>
      prev.map((line, idx) => {
        if (idx !== index) return line
        if (field === 'debit' && val) {
          return { ...line, debit: val, credit: '' }
        }
        if (field === 'credit' && val) {
          return { ...line, credit: val, debit: '' }
        }
        return { ...line, [field]: val }
      })
    )
  }

  // Calculate totals
  const totalDebit = lines.reduce((sum, l) => sum + (Number(l.debit) || 0), 0)
  const totalCredit = lines.reduce((sum, l) => sum + (Number(l.credit) || 0), 0)
  const difference = Math.abs(totalDebit - totalCredit)
  const isBalanced = difference < 0.001 && totalDebit > 0

  // Submit
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!isBalanced) {
      setError('لا يمكن حفظ القيد: القيد غير متوازن! يجب أن يتساوى المدين مع الدائن تماماً')
      return
    }
    if (!description.trim()) {
      setError('يرجى كتابة بيان القيد العام')
      return
    }

    setLoading(true)
    setError('')

    try {
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

      // 2. Insert Lines
      const linePayloads = lines.map((line, idx) => ({
        journal_entry_id: entry.id,
        account_id: line.account_id,
        debit: Number(line.debit) || 0,
        credit: Number(line.credit) || 0,
        currency: 'ILS',
        exchange_rate: 1.0,
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
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <span>✍️</span> إنشاء قيد يومية يدوي جديد
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            تسجيل حركة محاسبية مزدوجة مع التحقق الفوري من توازن القيد (المدين = الدائن)
          </p>
        </div>

        <Link
          href="/dashboard/accounting/journal"
          className="rounded-xl border border-white/10 bg-slate-800 px-4 py-2.5 text-xs font-bold text-slate-300 hover:bg-slate-700 transition"
        >
          ← العودة للقيود
        </Link>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-4 text-xs font-bold text-rose-400">
          ⚠️ {error}
        </div>
      )}

      {/* ── Form Card ── */}
      <form onSubmit={handleSubmit} className="rounded-2xl border border-white/10 bg-slate-900 p-6 shadow-xl space-y-6">
        {/* Top Metadata */}
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
              placeholder="مثال: إثبات مصاريف إيجار شهر 9 أو سحب شريك"
              value={description}
              onChange={e => setDescription(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-slate-800 p-2.5 text-xs text-white outline-none focus:border-sky-500"
            />
          </div>
        </div>

        {/* Lines Table */}
        <div className="overflow-hidden rounded-xl border border-white/10 bg-slate-950">
          <table className="w-full text-right text-xs">
            <thead>
              <tr className="border-b border-white/10 bg-slate-800/80 text-slate-400 font-bold">
                <th className="p-3 w-10 text-center">#</th>
                <th className="p-3 w-72">الحساب من الشجرة *</th>
                <th className="p-3">البيان الخاص بالطرف</th>
                <th className="p-3 w-36 text-emerald-400">مدين (Debit)</th>
                <th className="p-3 w-36 text-rose-400">دائن (Credit)</th>
                <th className="p-3 w-12 text-center" />
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {lines.map((line, idx) => (
                <tr key={line.id} className="hover:bg-slate-900/50">
                  <td className="p-3 text-center text-slate-500 font-mono">{idx + 1}</td>

                  <td className="p-2">
                    <select
                      required
                      value={line.account_id}
                      onChange={e => updateLine(idx, 'account_id', e.target.value)}
                      className="w-full rounded-lg border border-white/10 bg-slate-900 p-2 text-xs text-white outline-none focus:border-sky-500"
                    >
                      {accounts.map(a => (
                        <option key={a.id} value={a.id}>
                          {a.code} — {a.name}
                        </option>
                      ))}
                    </select>
                  </td>

                  <td className="p-2">
                    <input
                      type="text"
                      placeholder="بيان فرعي (اختياري)"
                      value={line.description}
                      onChange={e => updateLine(idx, 'description', e.target.value)}
                      className="w-full rounded-lg border border-white/10 bg-slate-900 p-2 text-xs text-white outline-none focus:border-sky-500"
                    />
                  </td>

                  <td className="p-2">
                    <input
                      type="number"
                      step="any"
                      placeholder="0.00"
                      value={line.debit}
                      onChange={e => updateLine(idx, 'debit', e.target.value)}
                      className="w-full rounded-lg border border-emerald-500/30 bg-slate-900 p-2 text-xs font-mono font-bold text-emerald-400 outline-none focus:border-emerald-500 text-left"
                    />
                  </td>

                  <td className="p-2">
                    <input
                      type="number"
                      step="any"
                      placeholder="0.00"
                      value={line.credit}
                      onChange={e => updateLine(idx, 'credit', e.target.value)}
                      className="w-full rounded-lg border border-rose-500/30 bg-slate-900 p-2 text-xs font-mono font-bold text-rose-400 outline-none focus:border-rose-500 text-left"
                    />
                  </td>

                  <td className="p-2 text-center">
                    {lines.length > 2 && (
                      <button
                        type="button"
                        onClick={() => removeLine(idx)}
                        className="text-slate-500 hover:text-rose-400 p-1 text-sm font-bold transition"
                        title="حذف السطر"
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

        {/* Add Line Button */}
        <button
          type="button"
          onClick={addLine}
          className="rounded-xl border border-dashed border-white/20 bg-slate-800/40 px-4 py-2 text-xs font-bold text-sky-400 hover:bg-slate-800 transition"
        >
          ➕ إضافة سطر جديد للقيد
        </button>

        {/* Balance Validation Summary Bar */}
        <div className="rounded-xl border border-white/10 bg-slate-950 p-4 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-6 text-xs font-mono">
            <div>
              <span className="text-slate-400">مجموع المدين: </span>
              <span className="font-bold text-emerald-400 text-sm">
                {totalDebit.toLocaleString('en-GB', { minimumFractionDigits: 2 })} ₪
              </span>
            </div>
            <div>
              <span className="text-slate-400">مجموع الدائن: </span>
              <span className="font-bold text-rose-400 text-sm">
                {totalCredit.toLocaleString('en-GB', { minimumFractionDigits: 2 })} ₪
              </span>
            </div>
            <div>
              <span className="text-slate-400">الفرق: </span>
              <span className={`font-bold text-sm ${difference > 0.001 ? 'text-rose-400' : 'text-emerald-400'}`}>
                {difference.toLocaleString('en-GB', { minimumFractionDigits: 2 })} ₪
              </span>
            </div>
          </div>

          <div>
            {isBalanced ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 px-3 py-1 text-xs font-bold text-emerald-400">
                ✅ القيد متوازن تماماً
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-500/10 border border-rose-500/20 px-3 py-1 text-xs font-bold text-rose-400">
                ⚠️ القيد غير متوازن
              </span>
            )}
          </div>
        </div>

        {/* Submit Buttons */}
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
            className="flex-1 rounded-xl bg-sky-500 py-3 text-xs font-bold text-slate-950 hover:bg-sky-400 transition disabled:opacity-40 shadow-lg shadow-sky-500/20"
          >
            {loading ? 'جارٍ الترحيل والحفظ...' : 'ترحيل وحفظ القيد المحاسبي'}
          </button>
        </div>
      </form>
    </div>
  )
}
