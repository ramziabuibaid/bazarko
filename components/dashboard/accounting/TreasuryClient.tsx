'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  recordManualMovement,
  setOpeningBalance,
  closeDailySession,
  createCashBox,
  updateCashBox,
  getStoreMembersForPermissions,
  getUserCashBoxPermissions,
  saveUserCashBoxPermissions,
} from '@/app/dashboard/accounting/treasury/actions'

export type CashBoxType =
  | 'cash'
  | 'bank'
  | 'wallet'
  | 'personal'
  | 'checks_collection'
  | 'checks_received'
  | 'checks_issued'
  | 'checks_returned'

export const BOX_TYPE_OPTIONS: { value: CashBoxType; label: string; icon: string }[] = [
  { value: 'cash', label: 'نقد (صندوق رئيسي / فرعي)', icon: '💵' },
  { value: 'bank', label: 'حساب بنكي', icon: '🏦' },
  { value: 'personal', label: 'شخصي (عهد / مسحوبات شخصية)', icon: '👤' },
  { value: 'checks_collection', label: 'تحصيل شيكات برسم التحصيل', icon: '🧾' },
  { value: 'checks_received', label: 'شيكات مقبوضة (محفظة الشيكات)', icon: '📥' },
  { value: 'checks_returned', label: 'شيكات راجعة (محفظة الشيكات المرتجعة)', icon: '↩️' },
  { value: 'checks_issued', label: 'شيكات صادرة للموردين', icon: '📤' },
  { value: 'wallet', label: 'محفظة إلكترونية / سداد رقمي', icon: '📱' },
]

type Modal = null | 'in' | 'out' | 'opening' | 'close' | 'new_box' | 'edit_box' | 'permissions'

interface AccountOption {
  id: string
  code: string
  name: string
  type?: string
}

interface CurrentBox {
  id: string
  name: string
  type: string
  opening_balance: number
  account_id?: string | null
  is_default?: boolean
}

interface CashBoxSummary {
  id: string
  name: string
  type: string
}

interface MemberOption {
  id: string
  user_id: string
  role: string
  name: string
  email: string
  phone: string
}

export default function TreasuryClient({
  currencyCode,
  currentBox,
  systemBalance,
  accounts = [],
  allBoxes = [],
}: {
  currencyCode: string
  currentBox: CurrentBox
  systemBalance: number
  accounts: AccountOption[]
  allBoxes?: CashBoxSummary[]
}) {
  const router = useRouter()
  const [modal, setModal] = useState<Modal>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  // حقول حركات ونقدية
  const [amount, setAmount] = useState('')
  const [desc, setDesc] = useState('')
  const [method, setMethod] = useState<'cash' | 'bank' | 'card' | 'transfer'>('cash')
  const [counted, setCounted] = useState('')
  const [notes, setNotes] = useState('')
  const [adjust, setAdjust] = useState(false)

  // حقول إدارة الصناديق
  const [boxName, setBoxName] = useState('')
  const [boxType, setBoxType] = useState<CashBoxType>('cash')
  const [boxAccountId, setBoxAccountId] = useState('')
  const [boxOpeningBalance, setBoxOpeningBalance] = useState('')
  const [boxIsDefault, setBoxIsDefault] = useState(false)

  // حقول إدارة صلاحيات الصناديق للمستخدمين
  const [members, setMembers] = useState<MemberOption[]>([])
  const [selectedUserId, setSelectedUserId] = useState('')
  const [userPermsMap, setUserPermsMap] = useState<
    Record<string, { canReceipt: boolean; canPayment: boolean }>
  >({})
  const [hasCustomPerms, setHasCustomPerms] = useState(false)

  function reset() {
    setAmount('')
    setDesc('')
    setMethod('cash')
    setCounted('')
    setNotes('')
    setAdjust(false)
    setError('')
    setSuccessMsg('')
    setBoxName('')
    setBoxType('cash')
    setBoxAccountId('')
    setBoxOpeningBalance('')
    setBoxIsDefault(false)
  }

  async function open(m: Modal) {
    reset()
    if (m === 'edit_box') {
      setBoxName(currentBox.name)
      setBoxType((currentBox.type as CashBoxType) || 'cash')
      setBoxAccountId(currentBox.account_id || '')
      setBoxIsDefault(!!currentBox.is_default)
    } else if (m === 'permissions') {
      setBusy(true)
      try {
        const mems = await getStoreMembersForPermissions()
        setMembers(mems)
        if (mems.length > 0) {
          const firstUserId = mems[0].user_id
          setSelectedUserId(firstUserId)
          await loadUserPerms(firstUserId)
        }
      } catch {
        setError('فشل جلب أعضاء المتجر')
      } finally {
        setBusy(false)
      }
    }
    setModal(m)
  }

  async function loadUserPerms(userId: string) {
    const existing = await getUserCashBoxPermissions(userId)
    if (!existing || existing.length === 0) {
      setHasCustomPerms(false)
      // Default: all boxes checked
      const map: Record<string, { canReceipt: boolean; canPayment: boolean }> = {}
      for (const b of allBoxes) {
        map[b.id] = { canReceipt: true, canPayment: true }
      }
      setUserPermsMap(map)
    } else {
      setHasCustomPerms(true)
      const map: Record<string, { canReceipt: boolean; canPayment: boolean }> = {}
      for (const b of allBoxes) {
        const p = existing.find(e => e.cash_box_id === b.id)
        map[b.id] = {
          canReceipt: p ? !!p.can_receipt : false,
          canPayment: p ? !!p.can_payment : false,
        }
      }
      setUserPermsMap(map)
    }
  }

  function handleMemberChange(userId: string) {
    setSelectedUserId(userId)
    setError('')
    setSuccessMsg('')
    loadUserPerms(userId)
  }

  function togglePerm(boxId: string, type: 'canReceipt' | 'canPayment') {
    setHasCustomPerms(true)
    setUserPermsMap(prev => ({
      ...prev,
      [boxId]: {
        canReceipt: prev[boxId]?.canReceipt ?? false,
        canPayment: prev[boxId]?.canPayment ?? false,
        [type]: !prev[boxId]?.[type],
      },
    }))
  }

  function close() {
    setModal(null)
    reset()
  }

  const fmt = (n: number) => n.toLocaleString('ar-u-nu-latn', { maximumFractionDigits: 2 })
  const variance = (parseFloat(counted) || 0) - systemBalance

  async function submit() {
    setBusy(true)
    setError('')
    setSuccessMsg('')
    let res: { ok: boolean; error?: string }

    if (modal === 'in' || modal === 'out') {
      res = await recordManualMovement(modal, parseFloat(amount) || 0, desc, method, currentBox.id)
    } else if (modal === 'opening') {
      res = await setOpeningBalance(parseFloat(amount) || 0, currentBox.id)
    } else if (modal === 'close') {
      res = await closeDailySession(parseFloat(counted) || 0, notes, adjust, currentBox.id)
    } else if (modal === 'new_box') {
      res = await createCashBox({
        name: boxName,
        type: boxType,
        accountId: boxAccountId || null,
        openingBalance: parseFloat(boxOpeningBalance) || 0,
        isDefault: boxIsDefault,
      })
    } else if (modal === 'edit_box') {
      res = await updateCashBox({
        id: currentBox.id,
        name: boxName,
        type: boxType,
        accountId: boxAccountId || null,
        isDefault: boxIsDefault,
      })
    } else if (modal === 'permissions') {
      if (!selectedUserId) {
        setBusy(false)
        setError('يرجى تحديد المستخدم')
        return
      }

      // If user wants to grant all permissions without restriction:
      if (!hasCustomPerms) {
        res = await saveUserCashBoxPermissions(selectedUserId, [])
      } else {
        const permsArray = Object.entries(userPermsMap).map(([boxId, p]) => ({
          cashBoxId: boxId,
          canReceipt: p.canReceipt,
          canPayment: p.canPayment,
        }))
        res = await saveUserCashBoxPermissions(selectedUserId, permsArray)
      }

      if (res.ok) {
        setSuccessMsg('تم حفظ صلاحيات الصناديق للمستخدم بنجاح!')
        setTimeout(() => {
          close()
          router.refresh()
        }, 1200)
      }
    } else {
      res = { ok: false }
    }

    setBusy(false)
    if (res.ok && modal !== 'permissions') {
      close()
      router.refresh()
    } else if (!res.ok) {
      setError(res.error ?? 'حدث خطأ غير متوقع')
    }
  }

  return (
    <>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          onClick={() => open('in')}
          className="rounded-xl bg-emerald-500/15 px-3.5 py-2 text-sm font-semibold text-emerald-400 hover:bg-emerald-500/25 transition-all shadow-sm"
        >
          📥 إيداع نقد
        </button>
        <button
          onClick={() => open('out')}
          className="rounded-xl bg-red-500/15 px-3.5 py-2 text-sm font-semibold text-red-400 hover:bg-red-500/25 transition-all shadow-sm"
        >
          📤 سحب نقد
        </button>
        <button
          onClick={() => open('close')}
          className="rounded-xl bg-sky-500/15 px-3.5 py-2 text-sm font-semibold text-sky-400 hover:bg-sky-500/25 transition-all shadow-sm"
        >
          🔒 مطابقة وإغلاق اليومية
        </button>
        <button
          onClick={() => open('opening')}
          className="rounded-xl border border-white/10 px-3 py-2 text-sm font-medium text-slate-300 hover:text-white hover:bg-white/5 transition-all"
        >
          ⚙️ رصيد افتتاحي
        </button>
        <button
          onClick={() => open('edit_box')}
          className="rounded-xl border border-white/10 px-3 py-2 text-sm font-medium text-slate-300 hover:text-white hover:bg-white/5 transition-all"
        >
          🔗 ربط بشجرة الحسابات
        </button>
        <button
          onClick={() => open('permissions')}
          className="rounded-xl border border-purple-500/30 bg-purple-500/15 px-3.5 py-2 text-sm font-semibold text-purple-300 hover:bg-purple-500/25 transition-all shadow-sm"
        >
          👥 صلاحيات المستخدمين على الصناديق
        </button>
        <button
          onClick={() => open('new_box')}
          className="rounded-xl bg-indigo-500/15 border border-indigo-500/30 px-3.5 py-2 text-sm font-semibold text-indigo-300 hover:bg-indigo-500/25 transition-all mr-auto"
        >
          ➕ إضافة صندوق جديد
        </button>
      </div>

      {modal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in"
          onClick={close}
        >
          <div
            className="w-full max-w-lg rounded-2xl border border-white/10 bg-slate-900 p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                {modal === 'in' && '📥 إيداع نقد في الصندوق'}
                {modal === 'out' && '📤 سحب نقد من الصندوق'}
                {modal === 'opening' && '⚙️ تعديل الرصيد الافتتاحي للصندوق'}
                {modal === 'close' && '🔒 إغلاق اليومية ومطابقة الرصيد الفعلي'}
                {modal === 'new_box' && '➕ إضافة صندوق أو خزينة جديدة'}
                {modal === 'edit_box' && '🔗 تعديل الصندوق وربطه بالحساب'}
                {modal === 'permissions' && '👥 التحكم بصلاحيات الصناديق للمستخدمين'}
              </h3>
              <button onClick={close} className="text-slate-400 hover:text-white text-lg">
                ✕
              </button>
            </div>

            {/* إيداع / سحب */}
            {(modal === 'in' || modal === 'out') && (
              <div className="space-y-3">
                <p className="text-xs text-sky-400">
                  الصندوق المختار: <span className="font-bold">{currentBox.name}</span>
                </p>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-300">
                    المبلغ ({currencyCode}) <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="number"
                    value={amount}
                    onChange={e => setAmount(e.target.value)}
                    dir="ltr"
                    className="w-full rounded-xl border border-white/10 bg-slate-800 px-3.5 py-2.5 text-white focus:border-sky-500 focus:outline-none"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-300">
                    الوصف والبيان <span className="text-red-400">*</span>
                  </label>
                  <input
                    value={desc}
                    onChange={e => setDesc(e.target.value)}
                    placeholder={modal === 'in' ? 'مثلاً: إيداع نقدي إضافي' : 'مثلاً: مصاريف صيانة ونثريات'}
                    className="w-full rounded-xl border border-white/10 bg-slate-800 px-3.5 py-2.5 text-white focus:border-sky-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-300">طريقة الدفع</label>
                  <select
                    value={method}
                    onChange={e => setMethod(e.target.value as typeof method)}
                    className="w-full rounded-xl border border-white/10 bg-slate-800 px-3.5 py-2.5 text-white focus:border-sky-500 focus:outline-none"
                  >
                    <option value="cash">نقدي (Cash)</option>
                    <option value="bank">بنك (Bank Transfer)</option>
                    <option value="card">بطاقة (Card)</option>
                    <option value="transfer">تحويل (Transfer)</option>
                  </select>
                </div>
              </div>
            )}

            {/* رصيد افتتاحي */}
            {modal === 'opening' && (
              <div className="space-y-3">
                <p className="text-xs text-slate-400">
                  الرصيد الافتتاحي الحالي لـ {currentBox.name}:{' '}
                  <span className="font-bold text-white">
                    {fmt(currentBox.opening_balance)} {currencyCode}
                  </span>
                </p>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-300">
                    الرصيد الافتتاحي الجديد
                  </label>
                  <input
                    type="number"
                    value={amount}
                    onChange={e => setAmount(e.target.value)}
                    dir="ltr"
                    placeholder={String(currentBox.opening_balance)}
                    className="w-full rounded-xl border border-white/10 bg-slate-800 px-3.5 py-2.5 text-white focus:border-sky-500 focus:outline-none"
                    autoFocus
                  />
                </div>
              </div>
            )}

            {/* إغلاق اليومية */}
            {modal === 'close' && (
              <div className="space-y-3">
                <div className="rounded-xl bg-slate-800/80 border border-white/5 p-3.5 text-sm space-y-1">
                  <div className="flex justify-between">
                    <span className="text-slate-400">الصندوق:</span>
                    <span className="font-semibold text-white">{currentBox.name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">رصيد النظام الدفتري:</span>
                    <span className="font-bold text-white" dir="ltr">
                      {fmt(systemBalance)} {currencyCode}
                    </span>
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-300">
                    المبلغ الفعلي المعدود في الصندوق ({currencyCode}) <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="number"
                    value={counted}
                    onChange={e => setCounted(e.target.value)}
                    dir="ltr"
                    className="w-full rounded-xl border border-white/10 bg-slate-800 px-3.5 py-2.5 text-white focus:border-sky-500 focus:outline-none text-lg font-bold"
                    autoFocus
                  />
                </div>
                {counted !== '' && (
                  <div
                    className={`rounded-xl p-3 text-sm font-bold border ${
                      Math.abs(variance) < 0.001
                        ? 'bg-slate-800 text-slate-300 border-white/10'
                        : variance > 0
                        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                        : 'bg-red-500/10 text-red-400 border-red-500/20'
                    }`}
                    dir="ltr"
                  >
                    الفارق: {variance > 0 ? '+' : ''}
                    {fmt(variance)} {currencyCode}
                    <span className="mr-2 text-xs font-normal">
                      {Math.abs(variance) < 0.001
                        ? '(مطابق تماماً)'
                        : variance > 0
                        ? '(فائض نقدي)'
                        : '(عجز نقدي)'}
                    </span>
                  </div>
                )}
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-300">
                    ملاحظات الإغلاق (اختياري)
                  </label>
                  <input
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    placeholder="مثلاً: تم جرد النقد ومطابقة الإيراد اليومي"
                    className="w-full rounded-xl border border-white/10 bg-slate-800 px-3.5 py-2.5 text-white focus:border-sky-500 focus:outline-none"
                  />
                </div>
                <label className="flex items-center gap-2.5 text-sm text-slate-300 bg-slate-800/40 p-2.5 rounded-xl border border-white/5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={adjust}
                    onChange={e => setAdjust(e.target.checked)}
                    className="h-4 w-4 rounded border-white/20 bg-slate-700 text-sky-500 focus:ring-0"
                  />
                  <span>تسوية الفرق تلقائياً بحركة تصحيح ليتطابق رصيد الدفتر مع العدّ الفعلي</span>
                </label>
              </div>
            )}

            {/* إنشاء أو تعديل صندوق */}
            {(modal === 'new_box' || modal === 'edit_box') && (
              <div className="space-y-3.5">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-300">
                    اسم الصندوق / الخزينة <span className="text-red-400">*</span>
                  </label>
                  <input
                    value={boxName}
                    onChange={e => setBoxName(e.target.value)}
                    placeholder="مثلاً: صندوق المبيعات النقدي، خزينة الشيكات، صندوق العهد الشخصي..."
                    className="w-full rounded-xl border border-white/10 bg-slate-800 px-3.5 py-2.5 text-white focus:border-sky-500 focus:outline-none"
                    autoFocus
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-300">
                    نوع الصندوق <span className="text-red-400">*</span>
                  </label>
                  <select
                    value={boxType}
                    onChange={e => setBoxType(e.target.value as CashBoxType)}
                    className="w-full rounded-xl border border-white/10 bg-slate-800 px-3.5 py-2.5 text-white focus:border-sky-500 focus:outline-none"
                  >
                    {BOX_TYPE_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>
                        {opt.icon} {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-300">
                    الحساب المرتبط في شجرة الحسابات (Chart of Accounts)
                  </label>
                  <select
                    value={boxAccountId}
                    onChange={e => setBoxAccountId(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-slate-800 px-3.5 py-2.5 text-white focus:border-sky-500 focus:outline-none"
                  >
                    <option value="">-- غير مربوط بحساب (حدد حساباً للربط) --</option>
                    {accounts.map(acc => (
                      <option key={acc.id} value={acc.id}>
                        {acc.code} - {acc.name} {acc.type ? `(${acc.type})` : ''}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-[11px] text-slate-400">
                    ربط الصندوق بحساب دفتري يضمن انعكاس حركات الصندوق بدقة على ميزان المراجعة وقائمة
                    المركز المالي.
                  </p>
                </div>

                {modal === 'new_box' && (
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-300">
                      الرصيد الافتتاحي ({currencyCode})
                    </label>
                    <input
                      type="number"
                      value={boxOpeningBalance}
                      onChange={e => setBoxOpeningBalance(e.target.value)}
                      placeholder="0.00"
                      dir="ltr"
                      className="w-full rounded-xl border border-white/10 bg-slate-800 px-3.5 py-2.5 text-white focus:border-sky-500 focus:outline-none"
                    />
                  </div>
                )}

                <label className="flex items-center gap-2.5 text-sm text-slate-300 cursor-pointer pt-1">
                  <input
                    type="checkbox"
                    checked={boxIsDefault}
                    onChange={e => setBoxIsDefault(e.target.checked)}
                    className="h-4 w-4 rounded border-white/20 bg-slate-700 text-sky-500 focus:ring-0"
                  />
                  <span>تعيين كصندوق افتراضي للمتجر</span>
                </label>
              </div>
            )}

            {/* إدارة صلاحيات الصناديق للمستخدمين */}
            {modal === 'permissions' && (
              <div className="space-y-4">
                <p className="text-xs text-slate-400">
                  حدد المستخدم لتعيين الصناديق والخزائن المصرح له بالتعامل معها عند تسجيل سندات
                  القبض أو سندات الصرف.
                </p>

                <div>
                  <label className="mb-1 block text-xs font-bold text-white">اختر المستخدم / الموظف *</label>
                  <select
                    value={selectedUserId}
                    onChange={e => handleMemberChange(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-slate-800 px-3.5 py-2.5 text-xs text-white font-bold outline-none focus:border-sky-500"
                  >
                    {members.map(m => (
                      <option key={m.user_id} value={m.user_id}>
                        {m.name} ({m.email || m.phone || 'مستخدم'}) — {m.role}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center justify-between pt-1">
                  <label className="text-xs font-bold text-sky-400">
                    الصناديق المتاحة والصلاحيات الممنوحة ({allBoxes.length})
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setHasCustomPerms(false)
                      const map: Record<string, { canReceipt: boolean; canPayment: boolean }> = {}
                      for (const b of allBoxes) {
                        map[b.id] = { canReceipt: true, canPayment: true }
                      }
                      setUserPermsMap(map)
                    }}
                    className="text-[11px] text-slate-400 hover:text-white underline"
                  >
                    إتاحة كافة الصناديق بدون قيود
                  </button>
                </div>

                <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                  {allBoxes.map(b => {
                    const p = userPermsMap[b.id] || { canReceipt: true, canPayment: true }
                    return (
                      <div
                        key={b.id}
                        className="flex items-center justify-between p-3 rounded-xl border border-white/5 bg-slate-800/70 text-xs"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="font-bold text-white truncate">{b.name}</p>
                          <p className="text-[10px] text-slate-400">نوع: {b.type}</p>
                        </div>

                        <div className="flex items-center gap-4">
                          <label className="flex items-center gap-1.5 text-emerald-400 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={p.canReceipt}
                              onChange={() => togglePerm(b.id, 'canReceipt')}
                              className="h-4 w-4 rounded border-white/20 bg-slate-700 text-emerald-500 focus:ring-0"
                            />
                            <span>سند قبض</span>
                          </label>

                          <label className="flex items-center gap-1.5 text-red-400 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={p.canPayment}
                              onChange={() => togglePerm(b.id, 'canPayment')}
                              className="h-4 w-4 rounded border-white/20 bg-slate-700 text-red-500 focus:ring-0"
                            />
                            <span>سند صرف</span>
                          </label>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {error && (
              <div className="rounded-xl bg-red-500/10 border border-red-500/20 p-3 text-xs text-red-400">
                {error}
              </div>
            )}

            {successMsg && (
              <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/20 p-3 text-xs text-emerald-400">
                ✓ {successMsg}
              </div>
            )}

            <div className="mt-5 flex gap-2 pt-2 border-t border-white/10">
              <button
                onClick={submit}
                disabled={busy}
                className="flex-1 rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sky-400 disabled:opacity-50 transition-all shadow-md"
              >
                {busy ? 'جارٍ الحفظ...' : 'تأكيد وحفظ'}
              </button>
              <button
                onClick={close}
                className="rounded-xl border border-white/10 px-5 py-2.5 text-sm text-slate-400 hover:text-white hover:bg-white/5 transition-all"
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
