'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  AccountingPeriod,
  createAccountingPeriod,
  closePeriod,
  reopenPeriod,
} from './period-actions'

interface Props {
  storeId: string
  storeName: string
  initialPeriods: AccountingPeriod[]
}

export default function PeriodsClient({ storeId, storeName, initialPeriods }: Props) {
  const router = useRouter()
  const [periods, setPeriods] = useState<AccountingPeriod[]>(initialPeriods)
  const [showModal, setShowModal] = useState(false)
  const [loading, setLoading] = useState(false)
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  // Form State
  const [periodName, setPeriodName] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [notes, setNotes] = useState('')

  // Stats
  const totalCount = periods.length
  const closedCount = periods.filter(p => p.is_closed).length
  const openCount = totalCount - closedCount

  // Quick Preset Helper
  const applyPreset = (preset: 'current_month' | 'prev_month' | 'current_quarter' | 'current_year') => {
    const now = new Date()
    const y = now.getFullYear()
    const m = now.getMonth() // 0-indexed

    if (preset === 'current_month') {
      const start = new Date(y, m, 1)
      const end = new Date(y, m + 1, 0)
      const monthNames = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر']
      setPeriodName(`شهر ${monthNames[m]} ${y}`)
      setStartDate(start.toISOString().slice(0, 10))
      setEndDate(end.toISOString().slice(0, 10))
    } else if (preset === 'prev_month') {
      const prevM = m === 0 ? 11 : m - 1
      const prevY = m === 0 ? y - 1 : y
      const start = new Date(prevY, prevM, 1)
      const end = new Date(prevY, prevM + 1, 0)
      const monthNames = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر']
      setPeriodName(`شهر ${monthNames[prevM]} ${prevY}`)
      setStartDate(start.toISOString().slice(0, 10))
      setEndDate(end.toISOString().slice(0, 10))
    } else if (preset === 'current_quarter') {
      const q = Math.floor(m / 3) + 1
      const qStartMonth = (q - 1) * 3
      const start = new Date(y, qStartMonth, 1)
      const end = new Date(y, qStartMonth + 3, 0)
      setPeriodName(`الربع ${q === 1 ? 'الأول' : q === 2 ? 'الثاني' : q === 3 ? 'الثالث' : 'الرابع'} ${y}`)
      setStartDate(start.toISOString().slice(0, 10))
      setEndDate(end.toISOString().slice(0, 10))
    } else if (preset === 'current_year') {
      setPeriodName(`السنة المالية ${y}`)
      setStartDate(`${y}-01-01`)
      setEndDate(`${y}-12-31`)
    }
  }

  // Handle Create Period
  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSuccessMsg('')
    setLoading(true)

    try {
      const res = await createAccountingPeriod({
        period_name: periodName,
        start_date: startDate,
        end_date: endDate,
        notes: notes.trim() || undefined,
      })

      if (!res.success) {
        setError(res.error || 'حدث خطأ أثناء إنشاء الفترة')
      } else {
        setSuccessMsg(`تم إنشاء الفترة المحاسبية "${periodName}" بنجاح`)
        setShowModal(false)
        setPeriodName('')
        setStartDate('')
        setEndDate('')
        setNotes('')
        router.refresh()
      }
    } catch (err: any) {
      setError(err.message || 'حدث خطأ غير متوقع')
    } finally {
      setLoading(false)
    }
  }

  // Handle Close Period
  const handleClosePeriod = async (p: AccountingPeriod) => {
    const confirmMsg = `هل أنت متأكد من قفل الفترة المحاسبية "${p.period_name}"؟\n\nتنبيه: بعد الإقفال لن يتمكن أي مستخدم من إنشاء، تعديل، أو حذف فواتير أو سندات أو قيود ضمن تاريخ هذه الفترة (${p.start_date} إلى ${p.end_date}).`
    if (!window.confirm(confirmMsg)) return

    setActionLoadingId(p.id)
    setError('')
    setSuccessMsg('')

    try {
      const res = await closePeriod(p.id, 'تم الإقفال بواسطة إدارة النظام')
      if (!res.success) {
        setError(res.error || 'فشل إغلاق الفترة')
      } else {
        setSuccessMsg(`تم إغلاق الفترة "${p.period_name}" وقفل كافة العمليات بنجاح`)
        setPeriods(prev =>
          prev.map(item =>
            item.id === p.id ? { ...item, is_closed: true, closed_at: new Date().toISOString() } : item
          )
        )
        router.refresh()
      }
    } catch (err: any) {
      setError(err.message || 'حدث خطأ')
    } finally {
      setActionLoadingId(null)
    }
  }

  // Handle Reopen Period
  const handleReopenPeriod = async (p: AccountingPeriod) => {
    const confirmMsg = `هل أنت متأكد من إعادة فتح الفترة المحاسبية "${p.period_name}"؟\n\nسيسمح ذلك بتسجيل أو تعديل العمليات المالية الواقعة ضمن نطاقها.`
    if (!window.confirm(confirmMsg)) return

    setActionLoadingId(p.id)
    setError('')
    setSuccessMsg('')

    try {
      const reason = window.prompt('سبب إعادة فتح الفترة المحاسبية:')
      if (!reason?.trim()) return
      const res = await reopenPeriod(p.id, reason)
      if (!res.success) {
        setError(res.error || 'فشل إعادة فتح الفترة')
      } else {
        setSuccessMsg(`تم إعادة فتح الفترة "${p.period_name}" بنجاح`)
        setPeriods(prev =>
          prev.map(item =>
            item.id === p.id ? { ...item, is_closed: false, closed_at: null } : item
          )
        )
        router.refresh()
      }
    } catch (err: any) {
      setError(err.message || 'حدث خطأ')
    } finally {
      setActionLoadingId(null)
    }
  }

  return (
    <div className="space-y-6">
      {/* ── Top Header ── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-black text-white flex items-center gap-2.5">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-500/20 text-xl border border-cyan-500/30">
              🔒
            </span>
            إقفال الفترات المحاسبية (Accounting Period Closing)
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            قفل الفترات والشهور المالية لمنع التعديل أو الحذف وحماية الدفاتر المحاسبية من أي تلاعب
          </p>
        </div>

        <button
          onClick={() => {
            setShowModal(true)
            applyPreset('current_month')
          }}
          className="flex items-center gap-2 rounded-xl bg-cyan-500 px-4 py-2.5 text-xs font-black text-slate-950 hover:bg-cyan-400 transition shadow-lg shadow-cyan-500/20"
        >
          <span>⊕</span> إضافة فترة محاسبية جديدة
        </button>
      </div>

      {/* ── Notification Banners ── */}
      {error && (
        <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-4 text-xs font-bold text-rose-400">
          ⚠️ {error}
        </div>
      )}
      {successMsg && (
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-xs font-bold text-emerald-400">
          ✅ {successMsg}
        </div>
      )}

      {/* ── Stats Summary ── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-white/10 bg-slate-900 p-5 shadow-sm">
          <p className="text-xs font-semibold text-slate-400">إجمالي الفترات المحاسبية</p>
          <p className="mt-2 text-2xl font-black text-white font-mono">{totalCount}</p>
          <p className="mt-1 text-xs text-slate-500">مسجلة في سجل النظام</p>
        </div>

        <div className="rounded-2xl border border-rose-500/20 bg-gradient-to-br from-rose-500/10 to-slate-900 p-5 shadow-sm">
          <p className="text-xs font-semibold text-rose-300">الفترات المقفلة 🔒</p>
          <p className="mt-2 text-2xl font-black text-rose-400 font-mono">{closedCount}</p>
          <p className="mt-1 text-xs text-slate-400">محمية من التعديل أو الحذف</p>
        </div>

        <div className="rounded-2xl border border-emerald-500/20 bg-gradient-to-br from-emerald-500/10 to-slate-900 p-5 shadow-sm">
          <p className="text-xs font-semibold text-emerald-300">الفترات المفتوحة 🟢</p>
          <p className="mt-2 text-2xl font-black text-emerald-400 font-mono">{openCount}</p>
          <p className="mt-1 text-xs text-slate-400">جاهزة للتسجيل والقيود اليومية</p>
        </div>
      </div>

      {/* ── Policy Explainer Box ── */}
      <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-4 text-xs text-cyan-200/90 leading-relaxed flex items-start gap-3">
        <span className="text-lg">🛡️</span>
        <div>
          <p className="font-bold text-cyan-300 text-sm mb-0.5">قاعدة الإقفال المحاسبي الصارمة:</p>
          <p>
            عند إقفال فترة محاسبية (مثلاً: شهر آب 2026)، يفرض النظام قفلاً برمجياً على قاعدة البيانات يمنع تماماً تسجيل، تعديل، أو حذف أي فاتورة مبيعات، سند قبض أو صرف، أو قيد يومية يقع تاريخه ضمن نطاق الفترة. وفي حال رغبة الإدارة بالتعديل، يجب إعادة فتح الفترة صراحة لتوثيق فك القفل في سجل التدقيق المالي.
          </p>
        </div>
      </div>

      {/* ── Periods Table ── */}
      <div className="overflow-hidden rounded-2xl border border-white/10 bg-slate-900 shadow-xl">
        <div className="border-b border-white/5 bg-slate-800/60 px-5 py-3.5 text-xs font-bold text-slate-300">
          جدول الفترات المحاسبية المسجلة
        </div>

        {periods.length === 0 ? (
          <div className="p-12 text-center text-slate-500">
            <p className="text-4xl mb-3">📅</p>
            <p className="text-base font-bold text-white">لا توجد فترات محاسبية مسجلة بعد</p>
            <p className="mt-1 text-xs text-slate-400">
              قم بإضافة الفترات المالية (شهرية، ربع سنوية، سنوية) للتحكم في الإقفال المالي
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead>
                <tr className="border-b border-white/5 text-[11px] text-slate-400 bg-slate-800/30">
                  <th className="px-5 py-3 font-semibold">اسم الفترة</th>
                  <th className="px-5 py-3 font-semibold">تاريخ البداية</th>
                  <th className="px-5 py-3 font-semibold">تاريخ النهاية</th>
                  <th className="px-5 py-3 font-semibold">الحالة</th>
                  <th className="px-5 py-3 font-semibold">تاريخ الإقفال</th>
                  <th className="px-5 py-3 font-semibold">ملاحظات</th>
                  <th className="px-5 py-3 font-semibold text-center">الإجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 text-slate-300">
                {periods.map(p => {
                  const isClosed = p.is_closed
                  const isLoading = actionLoadingId === p.id

                  return (
                    <tr key={p.id} className="hover:bg-slate-800/30 transition">
                      <td className="px-5 py-3 font-bold text-white flex items-center gap-2">
                        <span>{isClosed ? '🔒' : '🟢'}</span>
                        {p.period_name}
                      </td>
                      <td className="px-5 py-3 font-mono text-slate-300">{p.start_date}</td>
                      <td className="px-5 py-3 font-mono text-slate-300">{p.end_date}</td>
                      <td className="px-5 py-3">
                        {isClosed ? (
                          <span className="inline-flex items-center gap-1 rounded-full border border-rose-500/30 bg-rose-500/10 px-2.5 py-0.5 text-[11px] font-bold text-rose-400">
                            🔒 مقفلة ومحمية
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-bold text-emerald-400">
                            🟢 مفتوحة ونشطة
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3 font-mono text-slate-400 text-[11px]">
                        {p.closed_at ? new Date(p.closed_at).toLocaleString('en-GB') : '—'}
                      </td>
                      <td className="px-5 py-3 text-slate-400 max-w-xs truncate">{p.notes || '—'}</td>
                      <td className="px-5 py-3 text-center">
                        {isClosed ? (
                          <button
                            onClick={() => handleReopenPeriod(p)}
                            disabled={isLoading}
                            className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-[11px] font-bold text-amber-400 hover:bg-amber-500/20 transition disabled:opacity-50"
                          >
                            {isLoading ? 'جاري الفتح...' : '🔓 إعادة فتح الفترة'}
                          </button>
                        ) : (
                          <button
                            onClick={() => handleClosePeriod(p)}
                            disabled={isLoading}
                            className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-[11px] font-bold text-rose-400 hover:bg-rose-500/20 transition disabled:opacity-50"
                          >
                            {isLoading ? 'جاري القفل...' : '🔒 إقفال الفترة'}
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Create Period Modal ── */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-white/10 bg-slate-900 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 bg-slate-800/60 px-6 py-4">
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <span>➕</span> إضافة فترة محاسبية جديدة
              </h2>
              <button
                onClick={() => setShowModal(false)}
                className="text-slate-400 hover:text-white transition"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreate} className="p-6 space-y-4">
              {/* Presets */}
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">
                  نماذج سريعة للإعداد:
                </label>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => applyPreset('current_month')}
                    className="rounded-lg border border-white/10 bg-slate-800 px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-700"
                  >
                    الشهر الحالي
                  </button>
                  <button
                    type="button"
                    onClick={() => applyPreset('prev_month')}
                    className="rounded-lg border border-white/10 bg-slate-800 px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-700"
                  >
                    الشهر السابق
                  </button>
                  <button
                    type="button"
                    onClick={() => applyPreset('current_quarter')}
                    className="rounded-lg border border-white/10 bg-slate-800 px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-700"
                  >
                    الربع الحالي
                  </button>
                  <button
                    type="button"
                    onClick={() => applyPreset('current_year')}
                    className="rounded-lg border border-white/10 bg-slate-800 px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-700"
                  >
                    السنة الحالية
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  اسم الفترة المحاسبية *
                </label>
                <input
                  type="text"
                  required
                  value={periodName}
                  onChange={e => setPeriodName(e.target.value)}
                  placeholder="مثال: شهر أغسطس 2026"
                  className="w-full rounded-xl border border-white/10 bg-slate-800 p-2.5 text-xs text-white outline-none focus:border-cyan-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    تاريخ البداية *
                  </label>
                  <input
                    type="date"
                    required
                    value={startDate}
                    onChange={e => setStartDate(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-slate-800 p-2.5 text-xs text-white outline-none focus:border-cyan-500 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    تاريخ النهاية *
                  </label>
                  <input
                    type="date"
                    required
                    value={endDate}
                    onChange={e => setEndDate(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-slate-800 p-2.5 text-xs text-white outline-none focus:border-cyan-500 font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  ملاحظات أو تعليمات الإقفال
                </label>
                <textarea
                  rows={2}
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="أي ملاحظات تخص هذه الفترة..."
                  className="w-full rounded-xl border border-white/10 bg-slate-800 p-2.5 text-xs text-white outline-none focus:border-cyan-500 resize-none"
                />
              </div>

              <div className="mt-6 flex items-center justify-end gap-3 pt-3 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="rounded-xl border border-white/10 bg-slate-800 px-4 py-2 text-xs font-bold text-slate-300 hover:bg-slate-700"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="rounded-xl bg-cyan-500 px-5 py-2 text-xs font-black text-slate-950 hover:bg-cyan-400 disabled:opacity-50"
                >
                  {loading ? 'جاري الحفظ...' : 'حفظ الفترة'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
