'use client'
import { useState } from 'react'
import { suspendStore, activateStore, updateStorePlan } from './actions'

interface Props {
  storeId: string
  isActive: boolean
  currentPlan: string
  planExpiresAt: string | null
}

export default function StoreActions({ storeId, isActive, currentPlan, planExpiresAt }: Props) {
  const [suspendReason, setSuspendReason] = useState('')
  const [showSuspendForm, setShowSuspendForm] = useState(false)
  const [plan, setPlan] = useState(currentPlan)
  const [expiresAt, setExpiresAt] = useState(planExpiresAt ?? '')
  const [saving, setSaving] = useState(false)
  const [planSaved, setPlanSaved] = useState(false)

  async function handleSuspend() {
    if (!confirm('هل أنت متأكد من تعليق هذا المتجر؟')) return
    setSaving(true)
    await suspendStore(storeId, suspendReason)
    setSaving(false)
    setShowSuspendForm(false)
  }

  async function handleActivate() {
    if (!confirm('هل تريد إعادة تفعيل هذا المتجر؟')) return
    setSaving(true)
    await activateStore(storeId)
    setSaving(false)
  }

  async function handlePlanSave() {
    setSaving(true)
    await updateStorePlan(storeId, plan, expiresAt || null)
    setSaving(false)
    setPlanSaved(true)
    setTimeout(() => setPlanSaved(false), 2000)
  }

  return (
    <div className="space-y-4">
      {/* Status control */}
      <div className="rounded-2xl border border-white/5 bg-slate-900 p-5">
        <h2 className="text-sm font-semibold text-white mb-4">حالة المتجر</h2>
        {isActive ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-emerald-400">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              <span className="text-sm font-medium">المتجر نشط</span>
            </div>
            {!showSuspendForm ? (
              <button onClick={() => setShowSuspendForm(true)}
                className="rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-2 text-sm text-red-400 hover:bg-red-500/10 transition-colors">
                🚫 تعليق المتجر
              </button>
            ) : (
              <div className="space-y-2">
                <textarea
                  value={suspendReason}
                  onChange={e => setSuspendReason(e.target.value)}
                  placeholder="سبب التعليق..."
                  rows={2}
                  className="w-full rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-sky-500/50 resize-none"
                />
                <div className="flex gap-2">
                  <button onClick={handleSuspend} disabled={saving}
                    className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-500 disabled:opacity-50">
                    {saving ? '...' : 'تأكيد التعليق'}
                  </button>
                  <button onClick={() => setShowSuspendForm(false)}
                    className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-400 hover:text-white">
                    إلغاء
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-red-400">
              <span className="h-2 w-2 rounded-full bg-red-500" />
              <span className="text-sm font-medium">المتجر معلّق</span>
            </div>
            <button onClick={handleActivate} disabled={saving}
              className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-4 py-2 text-sm text-emerald-400 hover:bg-emerald-500/10 transition-colors disabled:opacity-50">
              {saving ? '...' : '✅ إعادة تفعيل المتجر'}
            </button>
          </div>
        )}
      </div>

      {/* Plan control */}
      <div className="rounded-2xl border border-white/5 bg-slate-900 p-5">
        <h2 className="text-sm font-semibold text-white mb-4">الخطة والاشتراك</h2>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-slate-400 mb-1 block">الخطة</label>
            <select value={plan} onChange={e => setPlan(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-sm text-white focus:outline-none focus:border-sky-500/50">
              <option value="free">مجاني</option>
              <option value="basic">أساسي</option>
              <option value="pro">احترافي</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-400 mb-1 block">تاريخ انتهاء الاشتراك</label>
            <input type="date" value={expiresAt} onChange={e => setExpiresAt(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-sm text-white focus:outline-none focus:border-sky-500/50" />
          </div>
          <button onClick={handlePlanSave} disabled={saving}
            className="rounded-xl bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50 transition-colors">
            {planSaved ? '✓ تم الحفظ' : saving ? '...' : 'حفظ الخطة'}
          </button>
        </div>
      </div>
    </div>
  )
}
