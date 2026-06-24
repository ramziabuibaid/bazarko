'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { recordManualMovement, setOpeningBalance, closeDailySession } from '@/app/dashboard/accounting/treasury/actions'

type Modal = null | 'in' | 'out' | 'opening' | 'close'

export default function TreasuryClient({
  currencyCode, openingBalance, systemBalance,
}: {
  currencyCode: string
  openingBalance: number
  systemBalance: number
}) {
  const router = useRouter()
  const [modal, setModal] = useState<Modal>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // حقول
  const [amount, setAmount] = useState('')
  const [desc, setDesc] = useState('')
  const [method, setMethod] = useState<'cash' | 'bank' | 'card' | 'transfer'>('cash')
  const [counted, setCounted] = useState('')
  const [notes, setNotes] = useState('')
  const [adjust, setAdjust] = useState(false)

  function reset() {
    setAmount(''); setDesc(''); setMethod('cash'); setCounted(''); setNotes(''); setAdjust(false); setError('')
  }
  function open(m: Modal) { reset(); setModal(m) }
  function close() { setModal(null); reset() }

  const fmt = (n: number) => n.toLocaleString('ar-u-nu-latn', { maximumFractionDigits: 2 })
  const variance = (parseFloat(counted) || 0) - systemBalance

  async function submit() {
    setBusy(true); setError('')
    let res: { ok: boolean; error?: string }

    if (modal === 'in' || modal === 'out') {
      res = await recordManualMovement(modal, parseFloat(amount) || 0, desc, method)
    } else if (modal === 'opening') {
      res = await setOpeningBalance(parseFloat(amount) || 0)
    } else if (modal === 'close') {
      res = await closeDailySession(parseFloat(counted) || 0, notes, adjust)
    } else {
      res = { ok: false }
    }

    setBusy(false)
    if (res.ok) { close(); router.refresh() }
    else setError(res.error ?? 'حدث خطأ')
  }

  return (
    <>
      <div className="mt-4 flex flex-wrap gap-2">
        <button onClick={() => open('in')} className="rounded-xl bg-emerald-500/15 px-4 py-2 text-sm font-semibold text-emerald-400 hover:bg-emerald-500/25">
          📥 إيداع
        </button>
        <button onClick={() => open('out')} className="rounded-xl bg-red-500/15 px-4 py-2 text-sm font-semibold text-red-400 hover:bg-red-500/25">
          📤 سحب
        </button>
        <button onClick={() => open('close')} className="rounded-xl bg-sky-500/15 px-4 py-2 text-sm font-semibold text-sky-400 hover:bg-sky-500/25">
          🔒 إغلاق اليومية
        </button>
        <button onClick={() => open('opening')} className="rounded-xl border border-white/10 px-4 py-2 text-sm font-medium text-slate-400 hover:text-white">
          ⚙️ رصيد افتتاحي
        </button>
      </div>

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={close}>
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-slate-900 p-5" onClick={e => e.stopPropagation()}>
            <h3 className="mb-4 text-lg font-semibold text-white">
              {modal === 'in' && '📥 إيداع نقد في الصندوق'}
              {modal === 'out' && '📤 سحب نقد من الصندوق'}
              {modal === 'opening' && '⚙️ تعديل الرصيد الافتتاحي'}
              {modal === 'close' && '🔒 إغلاق اليومية ومطابقة الرصيد'}
            </h3>

            {/* إيداع / سحب */}
            {(modal === 'in' || modal === 'out') && (
              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-xs text-slate-400">المبلغ ({currencyCode})</label>
                  <input type="number" value={amount} onChange={e => setAmount(e.target.value)} dir="ltr"
                    className="w-full rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-white" autoFocus />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-400">الوصف</label>
                  <input value={desc} onChange={e => setDesc(e.target.value)}
                    placeholder={modal === 'in' ? 'مثلاً: إيداع نقدي افتتاحي' : 'مثلاً: مصروف نثري'}
                    className="w-full rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-white" />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-400">طريقة الدفع</label>
                  <select value={method} onChange={e => setMethod(e.target.value as typeof method)}
                    className="w-full rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-white">
                    <option value="cash">نقدي</option>
                    <option value="bank">بنك</option>
                    <option value="card">بطاقة</option>
                    <option value="transfer">تحويل</option>
                  </select>
                </div>
              </div>
            )}

            {/* رصيد افتتاحي */}
            {modal === 'opening' && (
              <div className="space-y-3">
                <p className="text-xs text-slate-500">الرصيد الافتتاحي الحالي: {fmt(openingBalance)} {currencyCode}</p>
                <input type="number" value={amount} onChange={e => setAmount(e.target.value)} dir="ltr"
                  placeholder={String(openingBalance)}
                  className="w-full rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-white" autoFocus />
              </div>
            )}

            {/* إغلاق اليومية */}
            {modal === 'close' && (
              <div className="space-y-3">
                <div className="rounded-xl bg-slate-800 p-3 text-sm">
                  <div className="flex justify-between"><span className="text-slate-400">رصيد النظام</span><span className="font-bold text-white" dir="ltr">{fmt(systemBalance)} {currencyCode}</span></div>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-400">المبلغ الفعلي المعدود ({currencyCode})</label>
                  <input type="number" value={counted} onChange={e => setCounted(e.target.value)} dir="ltr"
                    className="w-full rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-white" autoFocus />
                </div>
                {counted !== '' && (
                  <div className={`rounded-xl p-3 text-sm font-bold ${
                    Math.abs(variance) < 0.001 ? 'bg-slate-800 text-slate-300'
                    : variance > 0 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'
                  }`} dir="ltr">
                    الفرق: {variance > 0 ? '+' : ''}{fmt(variance)} {currencyCode}
                    <span className="mr-2 text-xs font-normal">
                      {Math.abs(variance) < 0.001 ? '(مطابق)' : variance > 0 ? '(فائض)' : '(عجز)'}
                    </span>
                  </div>
                )}
                <div>
                  <label className="mb-1 block text-xs text-slate-400">ملاحظات (اختياري)</label>
                  <input value={notes} onChange={e => setNotes(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-white" />
                </div>
                <label className="flex items-center gap-2 text-sm text-slate-300">
                  <input type="checkbox" checked={adjust} onChange={e => setAdjust(e.target.checked)} />
                  تسوية الفرق في النظام (حركة تصحيح تجعل الدفتر = الفعلي)
                </label>
              </div>
            )}

            {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

            <div className="mt-5 flex gap-2">
              <button onClick={submit} disabled={busy}
                className="flex-1 rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sky-400 disabled:opacity-50">
                {busy ? '...' : 'تأكيد'}
              </button>
              <button onClick={close} className="rounded-xl border border-white/10 px-4 py-2.5 text-sm text-slate-400 hover:text-white">
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
