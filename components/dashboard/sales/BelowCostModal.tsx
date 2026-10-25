'use client'

import React from 'react'
import { type BelowCostItemWarning } from '@/lib/sales/below-cost'

interface Props {
  isOpen: boolean
  currency?: string
  currencyCode?: string
  items: BelowCostItemWarning[]
  totalLoss: number
  canApprove: boolean
  userName?: string
  onBack?: () => void
  onClose?: () => void
  onApprove: (reason?: string) => void
}

export default function BelowCostModal({
  isOpen,
  currency,
  currencyCode,
  items,
  totalLoss,
  canApprove,
  userName,
  onBack,
  onClose,
  onApprove,
}: Props) {
  if (!isOpen) return null

  const activeCurrency = currencyCode || currency || '₪'
  const handleBack = onBack || onClose || (() => {})

  const money = (n: number) =>
    Number.isFinite(n)
      ? `${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${activeCurrency}`
      : '—'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-150"
      dir="rtl"
    >
      <div className="w-full max-w-2xl bg-slate-900 border border-amber-500/40 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="bg-gradient-to-r from-amber-950/70 via-slate-900 to-amber-950/70 border-b border-amber-500/30 p-5 flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 text-2xl shrink-0">
            ⚠️
          </div>
          <div className="flex-1">
            <h2 className="text-lg font-bold text-white">تنبيه: يوجد بيع بأقل من سعر التكلفة</h2>
            <p className="text-xs text-amber-300/90 mt-1">
              تتضمن هذه الفاتورة أصنافاً بأسعار بيع صافية أقل من تكلفة الوحدة المعتمدة في النظام بعد احتساب الخصومات.
            </p>
          </div>
        </div>

        {/* Content Table */}
        <div className="p-5 overflow-y-auto space-y-4 flex-1">
          <div className="border border-slate-700/80 rounded-xl overflow-hidden bg-slate-950/40">
            <table className="w-full text-xs text-right">
              <thead className="bg-slate-800/80 text-slate-300 font-bold border-b border-slate-700">
                <tr>
                  <th className="p-3">الصنف</th>
                  <th className="p-3 text-center">التكلفة</th>
                  <th className="p-3 text-center">صافي البيع</th>
                  <th className="p-3 text-center">الخسارة / وحدة</th>
                  <th className="p-3 text-center">الكمية</th>
                  <th className="p-3 text-left">إجمالي الخسارة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {items.map((it, idx) => (
                  <tr key={it.productId || idx} className="hover:bg-slate-800/30">
                    <td className="p-3 font-medium text-white">{it.name}</td>
                    <td className="p-3 text-center font-mono text-slate-300" dir="ltr">
                      {money(it.unitCost)}
                    </td>
                    <td className="p-3 text-center font-mono text-amber-300" dir="ltr">
                      {money(it.netUnitPrice)}
                    </td>
                    <td className="p-3 text-center font-mono text-rose-400 font-semibold" dir="ltr">
                      -{money(it.unitLoss)}
                    </td>
                    <td className="p-3 text-center font-mono text-slate-200">{it.quantity}</td>
                    <td className="p-3 text-left font-mono font-bold text-rose-400" dir="ltr">
                      -{money(it.totalLoss)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Loss Total Card */}
          <div className="rounded-xl border border-rose-500/30 bg-rose-950/30 p-4 flex items-center justify-between">
            <span className="text-sm font-bold text-rose-300">إجمالي الخسارة التقديرية في العملية:</span>
            <span className="text-base font-black font-mono text-rose-400" dir="ltr">
              -{money(totalLoss)}
            </span>
          </div>

          {/* Permission notice */}
          {canApprove ? (
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-950/20 p-3.5 text-xs text-emerald-300 flex items-center gap-2">
              <span>✓</span>
              <span>
                أنت تملك صلاحية اعتماد البيع بأقل من التكلفة. سيتم تسجيل موافقتك باسم{' '}
                <strong className="text-white">({userName || 'المستخدم الحالي'})</strong> وتاريخها في سجل التدقيق المالي.
              </span>
            </div>
          ) : (
            <div className="rounded-xl border border-rose-500/40 bg-rose-950/50 p-4 text-xs text-rose-300 flex items-start gap-2.5">
              <span className="text-base shrink-0">⛔</span>
              <div>
                <strong className="block text-white font-bold mb-1">صلاحية غير كافية للاعتماد</strong>
                لا تملك صلاحية البيع بأقل من التكلفة (<code className="text-amber-300 font-mono">sales.below_cost</code>).
                يلزم موافقة مسؤول أو مشرف متجر لاعتماد هذه الفاتورة، أو الرجوع لتعديل الأسعار والخصومات.
              </div>
            </div>
          )}
        </div>

        {/* Footer Buttons */}
        <div className="border-t border-slate-800 bg-slate-900/90 p-4 flex flex-wrap items-center justify-end gap-3">
          <button
            type="button"
            onClick={handleBack}
            className="px-5 py-2.5 rounded-xl border border-slate-600 bg-slate-800 hover:bg-slate-700 text-sm font-semibold text-slate-200 transition"
          >
            ← رجوع لتعديل السعر
          </button>

          <button
            type="button"
            disabled={!canApprove}
            onClick={() => onApprove()}
            className={`px-5 py-2.5 rounded-xl text-sm font-bold transition flex items-center gap-1.5 ${
              canApprove
                ? 'bg-amber-600 hover:bg-amber-500 text-white shadow-lg shadow-amber-950/50'
                : 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700'
            }`}
          >
            <span>✓</span> موافقة ومتابعة البيع
          </button>
        </div>
      </div>
    </div>
  )
}
