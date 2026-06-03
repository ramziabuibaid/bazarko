'use client'
import { useState } from 'react'
import { suspendStore, activateStore, updateStorePlan, updateStoreDomain, resetUserPassword } from './actions'

interface Props {
  storeId: string
  ownerId: string
  isActive: boolean
  currentPlan: string
  planExpiresAt: string | null
  currentSubdomain: string
  countryCode: string
}

export default function StoreActions({
  storeId, ownerId, isActive, currentPlan, planExpiresAt, currentSubdomain, countryCode,
}: Props) {
  const [suspendReason, setSuspendReason] = useState('')
  const [showSuspendForm, setShowSuspendForm] = useState(false)
  const [plan, setPlan] = useState(currentPlan)
  const [expiresAt, setExpiresAt] = useState(planExpiresAt ?? '')
  const [saving, setSaving] = useState(false)
  const [planSaved, setPlanSaved] = useState(false)

  // Domain state
  const [subdomain, setSubdomain] = useState(currentSubdomain)
  const [domainError, setDomainError] = useState('')
  const [domainSaved, setDomainSaved] = useState(false)
  const [domainSaving, setDomainSaving] = useState(false)

  // Password state
  const [newPassword, setNewPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [passwordError, setPasswordError] = useState('')
  const [passwordSaved, setPasswordSaved] = useState(false)
  const [passwordSaving, setPasswordSaving] = useState(false)

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

  async function handleDomainSave() {
    setDomainError('')
    if (!subdomain || subdomain.length < 3) { setDomainError('يجب أن يكون 3 أحرف على الأقل'); return }
    if (!confirm(`هل أنت متأكد من تغيير الـ subdomain إلى "${subdomain}"؟\nسيتغير رابط المتجر فوراً.`)) return
    setDomainSaving(true)
    try {
      await updateStoreDomain(storeId, subdomain)
      setDomainSaved(true)
      setTimeout(() => setDomainSaved(false), 2500)
    } catch (e: unknown) {
      setDomainError(e instanceof Error ? e.message : 'خطأ غير متوقع')
    } finally {
      setDomainSaving(false)
    }
  }

  async function handlePasswordReset() {
    setPasswordError('')
    if (newPassword.length < 8) { setPasswordError('يجب أن تكون 8 أحرف على الأقل'); return }
    if (!confirm('هل أنت متأكد من تغيير كلمة السر لصاحب هذا المتجر؟')) return
    setPasswordSaving(true)
    try {
      await resetUserPassword(ownerId, newPassword)
      setPasswordSaved(true)
      setNewPassword('')
      setTimeout(() => setPasswordSaved(false), 2500)
    } catch (e: unknown) {
      setPasswordError(e instanceof Error ? e.message : 'خطأ غير متوقع')
    } finally {
      setPasswordSaving(false)
    }
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

      {/* Domain control */}
      <div className="rounded-2xl border border-amber-500/10 bg-slate-900 p-5">
        <h2 className="text-sm font-semibold text-white mb-1">🌐 تعديل الـ Domain</h2>
        <p className="text-xs text-slate-500 mb-4">تغيير رابط المتجر — يؤثر فوراً على الزبائن</p>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-slate-400 mb-1 block">الـ Subdomain</label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={subdomain}
                onChange={e => { setSubdomain(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '')); setDomainError('') }}
                placeholder="mystore"
                dir="ltr"
                className="flex-1 min-w-0 rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-violet-500/50"
              />
            </div>
            <p className="text-xs text-slate-600 mt-1" dir="ltr">{subdomain || '...'}.{countryCode.toLowerCase()}.bazarko.app</p>
          </div>
          {domainError && <p className="text-xs text-red-400">{domainError}</p>}
          <button
            onClick={handleDomainSave}
            disabled={domainSaving || subdomain === currentSubdomain || !subdomain}
            className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-40 transition-colors">
            {domainSaved ? '✓ تم تغيير الـ Domain' : domainSaving ? '...' : 'حفظ الـ Domain'}
          </button>
        </div>
      </div>

      {/* Password reset */}
      <div className="rounded-2xl border border-amber-500/10 bg-slate-900 p-5">
        <h2 className="text-sm font-semibold text-white mb-1">🔑 تغيير كلمة السر</h2>
        <p className="text-xs text-slate-500 mb-4">تعيين كلمة سر جديدة لصاحب المتجر</p>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-slate-400 mb-1 block">كلمة السر الجديدة</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={newPassword}
                onChange={e => { setNewPassword(e.target.value); setPasswordError('') }}
                placeholder="8 أحرف على الأقل"
                dir="ltr"
                className="w-full rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-amber-500/50"
              />
              <button
                type="button"
                onClick={() => setShowPassword(v => !v)}
                className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 text-xs px-1 transition-colors">
                {showPassword ? 'إخفاء' : 'إظهار'}
              </button>
            </div>
          </div>
          {passwordError && <p className="text-xs text-red-400">{passwordError}</p>}
          <button
            onClick={handlePasswordReset}
            disabled={passwordSaving || !newPassword}
            className="rounded-xl bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-500 disabled:opacity-40 transition-colors">
            {passwordSaved ? '✓ تم تغيير كلمة السر' : passwordSaving ? '...' : 'تعيين كلمة السر'}
          </button>
        </div>
      </div>
    </div>
  )
}
