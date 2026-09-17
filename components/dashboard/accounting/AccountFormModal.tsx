'use client'

import { useState, useEffect, useMemo } from 'react'
import { createAccount, updateAccount } from '@/app/dashboard/accounting/accounts/account-actions'

export interface AccountItem {
  id: string
  code: string
  name: string
  type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense'
  normal_balance?: 'debit' | 'credit'
  parent_id: string | null
  is_group: boolean
  is_active: boolean
  is_system?: boolean
  currency: string
  balance?: number
  description?: string | null
}

interface Props {
  mode: 'create' | 'edit'
  initialData?: AccountItem | null
  presetParentId?: string | null
  presetType?: AccountItem['type']
  accounts: AccountItem[]
  currencyCode: string
  onClose: () => void
  onSuccess: (savedAccount: AccountItem) => void
}

export default function AccountFormModal({
  mode,
  initialData,
  presetParentId,
  presetType,
  accounts,
  currencyCode,
  onClose,
  onSuccess,
}: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Selected parent
  const [parentId, setParentId] = useState<string>(
    mode === 'edit'
      ? (initialData?.parent_id || '')
      : (presetParentId || '')
  )

  const parentAccount = useMemo(() => accounts.find(a => a.id === parentId), [accounts, parentId])

  // Initial Type
  const defaultType = useMemo(() => {
    if (mode === 'edit' && initialData) return initialData.type
    if (parentAccount) return parentAccount.type
    if (presetType) return presetType
    return 'asset'
  }, [mode, initialData, parentAccount, presetType])

  const [type, setType] = useState<AccountItem['type']>(defaultType)

  // Default normal balance
  const defaultNormalBalance = useMemo<'debit' | 'credit'>(() => {
    if (mode === 'edit' && initialData?.normal_balance) return initialData.normal_balance
    return (type === 'asset' || type === 'expense') ? 'debit' : 'credit'
  }, [mode, initialData, type])

  const [normalBalance, setNormalBalance] = useState<'debit' | 'credit'>(defaultNormalBalance)

  // Smart code suggestion
  const suggestedCode = useMemo(() => {
    if (mode === 'edit') return initialData?.code || ''
    if (parentAccount) {
      // Find existing children under this parent
      const siblings = accounts.filter(a => a.parent_id === parentAccount.id)
      if (siblings.length === 0) {
        // First child: if parent code is 1 or 2 digits, pad e.g. "11" -> "1101"
        return parentAccount.code.length <= 2 ? `${parentAccount.code}01` : `${parentAccount.code}1`
      }
      // Get highest numeric suffix
      const siblingCodes = siblings.map(s => s.code).sort()
      const lastCode = siblingCodes[siblingCodes.length - 1]
      const num = parseInt(lastCode, 10)
      if (!isNaN(num)) {
        return String(num + 1)
      }
      return `${parentAccount.code}${siblings.length + 1}`
    }
    // If root level and presetType
    const rootsOfType = accounts.filter(a => !a.parent_id && a.type === type)
    if (rootsOfType.length > 0) {
      const lastCode = rootsOfType.map(r => r.code).sort().pop()!
      const num = parseInt(lastCode, 10)
      if (!isNaN(num)) return String(num + 1)
    }
    const typePrefixMap = { asset: '1', liability: '2', equity: '3', revenue: '4', expense: '5' }
    return `${typePrefixMap[type]}1`
  }, [mode, initialData, parentAccount, accounts, type])

  const [code, setCode] = useState(mode === 'edit' ? (initialData?.code || '') : suggestedCode)
  const [name, setName] = useState(initialData?.name || '')
  const [isGroup, setIsGroup] = useState(initialData ? initialData.is_group : false)
  const [isActive, setIsActive] = useState(initialData ? initialData.is_active : true)
  const [currency, setCurrency] = useState(initialData?.currency || currencyCode || 'ILS')
  const [description, setDescription] = useState(initialData?.description || '')

  // Keep type and normal_balance in sync when parent changes
  useEffect(() => {
    if (parentAccount && mode === 'create') {
      setType(parentAccount.type)
      setNormalBalance(parentAccount.normal_balance || (parentAccount.type === 'asset' || parentAccount.type === 'expense' ? 'debit' : 'credit'))
    }
  }, [parentAccount, mode])

  // Prevent selecting self or descendants as parent in edit mode
  const validParents = useMemo(() => {
    if (mode !== 'edit' || !initialData) {
      return accounts.filter(a => a.is_group || a.code.length <= 4)
    }

    // Recursively collect all descendant IDs of the edited account
    const descendantIds = new Set<string>([initialData.id])
    let added = true
    while (added) {
      added = false
      for (const a of accounts) {
        if (a.parent_id && descendantIds.has(a.parent_id) && !descendantIds.has(a.id)) {
          descendantIds.add(a.id)
          added = true
        }
      }
    }

    return accounts.filter(a => !descendantIds.has(a.id) && (a.is_group || a.code.length <= 4))
  }, [accounts, mode, initialData])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!code.trim() || !name.trim()) {
      setError('يرجى كتابة كود الحساب واسم الحساب')
      return
    }

    setLoading(true)
    setError('')

    try {
      if (mode === 'create') {
        const res = await createAccount({
          code: code.trim(),
          name: name.trim(),
          type,
          normal_balance: normalBalance,
          parent_id: parentId || null,
          is_group: isGroup,
          is_active: isActive,
          currency,
          description: description.trim() || null,
        })

        if (!res.success || !res.account) {
          throw new Error(res.error || 'فشل إنشاء الحساب')
        }

        onSuccess(res.account as any)
      } else {
        if (!initialData) return
        const res = await updateAccount({
          id: initialData.id,
          code: code.trim(),
          name: name.trim(),
          type,
          normal_balance: normalBalance,
          parent_id: parentId || null,
          is_group: isGroup,
          is_active: isActive,
          currency,
          description: description.trim() || null,
        })

        if (!res.success || !res.account) {
          throw new Error(res.error || 'فشل تحديث بيانات الحساب')
        }

        onSuccess(res.account as any)
      }
    } catch (err: any) {
      setError(err.message || 'حدث خطأ أثناء حفظ بيانات الحساب')
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
      <div className="relative max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-white/10 bg-slate-900 p-6 shadow-2xl">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 pb-4">
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <span>{mode === 'create' ? (parentId ? '⊕ إضافة حساب فرعي' : '➕ إضافة حساب جديد') : '✏️ تعديل بيانات الحساب'}</span>
            </h2>
            {parentAccount && mode === 'create' && (
              <p className="mt-1 text-xs text-sky-400">
                تابع للحساب الأب: <strong className="font-mono">{parentAccount.code}</strong> — {parentAccount.name}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="rounded-xl border border-white/10 p-2 text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            ✕
          </button>
        </div>

        {error && (
          <div className="mt-4 rounded-xl bg-rose-500/10 border border-rose-500/20 p-3 text-xs text-rose-400">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          
          {/* النوع ورقم الكود */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-300">نوع الحساب *</label>
              <select
                value={type}
                disabled={mode === 'edit' && initialData?.is_system}
                onChange={e => {
                  const newType = e.target.value as AccountItem['type']
                  setType(newType)
                  setNormalBalance((newType === 'asset' || newType === 'expense') ? 'debit' : 'credit')
                }}
                className="w-full rounded-xl border border-white/10 bg-slate-800 p-2.5 text-xs text-white outline-none focus:border-sky-500 disabled:opacity-50"
              >
                <option value="asset">1 — الأصول (Assets)</option>
                <option value="liability">2 — الالتزامات (Liabilities)</option>
                <option value="equity">3 — حقوق الملكية (Equity)</option>
                <option value="revenue">4 — الإيرادات (Revenue)</option>
                <option value="expense">5 — المصروفات (Expenses)</option>
              </select>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-semibold text-slate-300">رقم/كود الحساب *</label>
                {mode === 'create' && suggestedCode !== code && (
                  <button
                    type="button"
                    onClick={() => setCode(suggestedCode)}
                    className="text-[11px] text-sky-400 hover:underline"
                  >
                    استعادة المقترح ({suggestedCode})
                  </button>
                )}
              </div>
              <input
                type="text"
                required
                value={code}
                onChange={e => setCode(e.target.value)}
                placeholder="مثال: 1101"
                className="w-full rounded-xl border border-white/10 bg-slate-800 p-2.5 text-xs text-white outline-none focus:border-sky-500 font-mono font-bold text-left"
                dir="ltr"
              />
            </div>
          </div>

          {/* اسم الحساب */}
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-300">اسم الحساب الرسمي *</label>
            <input
              type="text"
              required
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="مثال: بنك فلسطين - الحساب الرئيسي"
              className="w-full rounded-xl border border-white/10 bg-slate-800 p-2.5 text-xs text-white outline-none focus:border-sky-500"
            />
          </div>

          {/* الحساب الأب وطبيعة الرصيد */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-300">الحساب الأب (الموقع في الشجرة)</label>
              <select
                value={parentId}
                onChange={e => setParentId(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-slate-800 p-2.5 text-xs text-white outline-none focus:border-sky-500"
              >
                <option value="">بدون حساب أب (حساب رئيسي في الشجرة)</option>
                {validParents.map(a => (
                  <option key={a.id} value={a.id}>
                    {a.code} — {a.name} ({a.is_group ? 'تجميعي' : 'فرعي'})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-300">طبيعة الحساب الدفترية</label>
              <select
                value={normalBalance}
                onChange={e => setNormalBalance(e.target.value as 'debit' | 'credit')}
                className="w-full rounded-xl border border-white/10 bg-slate-800 p-2.5 text-xs text-white outline-none focus:border-sky-500"
              >
                <option value="debit">مدين بطبيعته (Debit) — أصول / مصاريف</option>
                <option value="credit">دائن بطبيعته (Credit) — التزامات / حقوق / إيرادات</option>
              </select>
            </div>
          </div>

          {/* العملة وحالة التفعيل */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-300">عملة الحساب</label>
              <select
                value={currency}
                onChange={e => setCurrency(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-slate-800 p-2.5 text-xs text-white outline-none focus:border-sky-500 font-bold"
              >
                <option value="ILS">شيكل إسرائيلي (ILS ₪)</option>
                <option value="USD">دولار أمريكي (USD $)</option>
                <option value="JOD">دينار أردني (JOD JD)</option>
                <option value="EUR">يورو أوروبي (EUR €)</option>
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-300">حالة الحساب</label>
              <select
                value={isActive ? 'active' : 'inactive'}
                onChange={e => setIsActive(e.target.value === 'active')}
                className="w-full rounded-xl border border-white/10 bg-slate-800 p-2.5 text-xs text-white outline-none focus:border-sky-500 font-bold"
              >
                <option value="active">🟢 فعال ونشط</option>
                <option value="inactive">🔴 غير فعال (معطل عن القوائم الجديدة)</option>
              </select>
            </div>
          </div>

          {/* نوع الحساب: تجميعي أم تفصيلي حركات */}
          <div className="rounded-xl border border-white/10 bg-slate-800/40 p-3 space-y-2">
            <div className="flex items-start gap-2.5">
              <input
                type="checkbox"
                id="modal_is_group"
                checked={isGroup}
                onChange={e => setIsGroup(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-white/10 bg-slate-800 text-sky-500 focus:ring-sky-500"
              />
              <div>
                <label htmlFor="modal_is_group" className="text-xs font-bold text-white cursor-pointer flex items-center gap-1.5">
                  <span>📁</span> حساب تجميعي رئيسي (Group Account)
                </label>
                <p className="mt-0.5 text-[11px] text-slate-400">
                  الحساب التجميعي لا تقبل عليه القيود والحركات المحاسبية المباشرة، ويستخدم لتنظيم الحسابات الفرعية وتجميع أرصدتها تلقائياً في التقارير.
                </p>
              </div>
            </div>
          </div>

          {/* الوصف والملاحظات */}
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-300">وصف أو ملاحظات على الحساب (اختياري)</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="وصف للغرض المحاسبي من هذا الحساب..."
              rows={2}
              className="w-full rounded-xl border border-white/10 bg-slate-800 p-2.5 text-xs text-white outline-none focus:border-sky-500 resize-none"
            />
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-3 border-t border-white/10">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-xl border border-white/10 py-2.5 text-xs font-bold text-slate-400 hover:bg-slate-800 transition"
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 rounded-xl bg-sky-500 py-2.5 text-xs font-bold text-slate-950 hover:bg-sky-400 transition disabled:opacity-50"
            >
              {loading ? 'جارٍ الحفظ...' : (mode === 'create' ? 'إنشاء الحساب' : 'حفظ التعديلات')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
