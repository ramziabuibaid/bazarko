'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  createStoreUser,
  updateStoreUserPassword,
  updateStoreUserRole,
  removeStoreUser,
  StoreMemberRole,
} from '@/app/dashboard/settings/team/actions'

export interface MemberItem {
  id: string
  store_id: string
  profile_id: string
  role: StoreMemberRole
  is_active: boolean
  joined_at: string | null
  created_at: string
  email: string
  full_name: string
  phone: string | null
}

interface Props {
  storeId: string
  members: MemberItem[]
  currentUserId: string
}

const ROLE_INFO: Record<StoreMemberRole, { label: string; desc: string; badge: string }> = {
  owner: {
    label: 'مالك المتجر (Owner)',
    desc: 'صلاحيات كاملة شاملة إعدادات الحساب وحذف المتجر',
    badge: 'bg-purple-500/15 text-purple-300 border-purple-500/30',
  },
  admin: {
    label: 'مدير المتجر (Admin)',
    desc: 'إدارة العمليات، المنتجات، الموظفين، والتقارير المالية',
    badge: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  },
  accountant: {
    label: 'محاسب (Accountant)',
    desc: 'الوصول للدفاتر المحاسبية، السندات، القيود، والفواتير',
    badge: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  },
  staff: {
    label: 'موظف مبيعات / فريق (Staff)',
    desc: 'إدخال الفواتير، نقطة البيع (POS)، والطلبات والزبائن',
    badge: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  },
  viewer: {
    label: 'مشاهد فقط (Viewer)',
    desc: 'مشاهدة البيانات والتقارير فقط دون حق التعديل أو الحذف',
    badge: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
  },
}

export default function TeamManagement({ storeId, members, currentUserId }: Props) {
  const router = useRouter()
  const [showAddModal, setShowAddModal] = useState(false)
  const [passwordModalMember, setPasswordModalMember] = useState<MemberItem | null>(null)
  const [deletingMember, setDeletingMember] = useState<MemberItem | null>(null)

  // Add User Form state
  const [formData, setFormData] = useState({
    fullName: '',
    email: '',
    password: '',
    phone: '',
    role: 'staff' as StoreMemberRole,
  })
  const [newPassword, setNewPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  async function handleAddUser(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setErrorMsg('')
    setSuccessMsg('')

    const res = await createStoreUser({
      storeId,
      fullName: formData.fullName,
      email: formData.email,
      password: formData.password,
      phone: formData.phone,
      role: formData.role,
    })

    setLoading(false)
    if (!res.success) {
      setErrorMsg(res.error || 'تعذر إضافة المستخدم')
      return
    }

    setSuccessMsg('تمت إضافة المستخدم بنجاح')
    setShowAddModal(false)
    setFormData({ fullName: '', email: '', password: '', phone: '', role: 'staff' })
    router.refresh()
  }

  async function handleUpdatePassword(e: React.FormEvent) {
    e.preventDefault()
    if (!passwordModalMember) return
    setLoading(true)
    setErrorMsg('')

    const res = await updateStoreUserPassword(storeId, passwordModalMember.profile_id, newPassword)
    setLoading(false)
    if (!res.success) {
      setErrorMsg(res.error || 'تعذر تغيير كلمة المرور')
      return
    }

    setPasswordModalMember(null)
    setNewPassword('')
    setSuccessMsg('تم تغيير كلمة المرور بنجاح')
  }

  async function handleRoleChange(member: MemberItem, newRole: StoreMemberRole) {
    const res = await updateStoreUserRole(storeId, member.id, newRole, member.is_active)
    if (!res.success) {
      alert(res.error || 'تعذر تغيير الصلاحية')
    } else {
      router.refresh()
    }
  }

  async function handleStatusToggle(member: MemberItem) {
    const res = await updateStoreUserRole(storeId, member.id, member.role, !member.is_active)
    if (!res.success) {
      alert(res.error || 'تعذر تعديل حالة المستخدم')
    } else {
      router.refresh()
    }
  }

  async function handleDeleteMember() {
    if (!deletingMember) return
    setLoading(true)
    const res = await removeStoreUser(storeId, deletingMember.id)
    setLoading(false)
    if (!res.success) {
      alert(res.error || 'تعذر حذف المستخدم')
    } else {
      setDeletingMember(null)
      router.refresh()
    }
  }

  return (
    <div className="space-y-6">
      {/* Header & Add Button */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-white">فريق العمل ومستخدمو المتجر</h2>
          <p className="text-xs sm:text-sm text-slate-400">
            إضافة مستخدمين، تعيين الأدوار والصلاحيات، وتعيين كلمات المرور للموظفين.
          </p>
        </div>
        <button
          onClick={() => {
            setErrorMsg('')
            setShowAddModal(true)
          }}
          className="flex items-center justify-center gap-2 rounded-xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sky-500 transition-colors shadow-lg shadow-sky-600/20"
        >
          <span className="text-base leading-none">+</span>
          <span>إضافة مستخدم جديد</span>
        </button>
      </div>

      {successMsg && (
        <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-400 text-xs sm:text-sm flex justify-between items-center">
          <span>✓ {successMsg}</span>
          <button onClick={() => setSuccessMsg('')} className="text-emerald-400 hover:text-white">✕</button>
        </div>
      )}

      {/* Members Table */}
      <div className="overflow-x-auto rounded-2xl border border-white/10 bg-slate-900/60 shadow-xl">
        <table className="min-w-[700px] w-full text-right text-sm">
          <thead>
            <tr className="border-b border-white/10 bg-white/[0.02] text-xs text-slate-400">
              <th className="px-5 py-3.5 font-medium">المستخدم</th>
              <th className="px-5 py-3.5 font-medium">البريد الإلكتروني</th>
              <th className="px-5 py-3.5 font-medium">الدور والصلاحية</th>
              <th className="px-5 py-3.5 font-medium">الحالة</th>
              <th className="px-5 py-3.5 font-medium text-left">إجراءات</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {members.map(m => {
              const roleInfo = ROLE_INFO[m.role] || ROLE_INFO.staff
              const isSelf = m.profile_id === currentUserId
              return (
                <tr key={m.id} className="hover:bg-white/[0.02] transition-colors">
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-tr from-sky-500/20 to-indigo-500/20 text-sky-400 font-bold border border-white/5">
                        {m.full_name ? m.full_name.slice(0, 1) : '👤'}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-white">{m.full_name || 'بدون اسم'}</span>
                          {isSelf && (
                            <span className="rounded bg-sky-500/10 px-1.5 py-0.5 text-[10px] text-sky-400 border border-sky-500/20">
                              أنت
                            </span>
                          )}
                        </div>
                        {m.phone && <p className="text-xs text-slate-400" dir="ltr">{m.phone}</p>}
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-4 text-slate-300 font-mono text-xs" dir="ltr">
                    {m.email}
                  </td>
                  <td className="px-5 py-4">
                    {m.role === 'owner' ? (
                      <span className={`inline-flex items-center rounded-lg border px-2.5 py-1 text-xs font-semibold ${roleInfo.badge}`}>
                        {roleInfo.label}
                      </span>
                    ) : (
                      <select
                        value={m.role}
                        disabled={isSelf}
                        onChange={e => handleRoleChange(m, e.target.value as StoreMemberRole)}
                        className="rounded-lg border border-white/10 bg-slate-800 px-2.5 py-1 text-xs text-slate-200 outline-none focus:border-sky-500"
                      >
                        <option value="admin">مدير المتجر (Admin)</option>
                        <option value="accountant">محاسب (Accountant)</option>
                        <option value="staff">موظف مبيعات (Staff)</option>
                        <option value="viewer">مشاهد فقط (Viewer)</option>
                      </select>
                    )}
                  </td>
                  <td className="px-5 py-4">
                    {m.role === 'owner' ? (
                      <span className="text-xs text-emerald-400 font-medium">نشط دائماً</span>
                    ) : (
                      <button
                        type="button"
                        disabled={isSelf}
                        onClick={() => handleStatusToggle(m)}
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium border transition-colors ${
                          m.is_active
                            ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/25'
                            : 'bg-red-500/15 text-red-300 border-red-500/30 hover:bg-red-500/25'
                        } ${isSelf ? 'opacity-60 cursor-not-allowed' : ''}`}
                      >
                        {m.is_active ? '● نشط' : '○ معطل'}
                      </button>
                    )}
                  </td>
                  <td className="px-5 py-4 text-left">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setErrorMsg('')
                          setPasswordModalMember(m)
                          setNewPassword('')
                        }}
                        className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-white/10 hover:text-white transition-colors"
                        title="تغيير كلمة المرور"
                      >
                        🔑 كلمة المرور
                      </button>

                      {!isSelf && m.role !== 'owner' && (
                        <button
                          type="button"
                          onClick={() => setDeletingMember(m)}
                          className="rounded-lg border border-red-500/20 bg-red-500/10 px-2.5 py-1.5 text-xs text-red-400 hover:bg-red-500/20 transition-colors"
                          title="حذف من المتجر"
                        >
                          🗑️
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Modal إضافة مستخدم جديد */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4" onClick={() => setShowAddModal(false)}>
          <div role="dialog" aria-modal="true" className="w-full max-w-md rounded-2xl border border-white/10 bg-slate-900 p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-white mb-1">إضافة مستخدم جديد للمتجر</h3>
            <p className="text-xs text-slate-400 mb-5">
              سيتمكن هذا المستخدم من تسجيل الدخول إلى لوحة التحكم بصلاحياته المحددة.
            </p>

            {errorMsg && (
              <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-xs">
                {errorMsg}
              </div>
            )}

            <form onSubmit={handleAddUser} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">الاسم الكامل *</label>
                <input
                  type="text"
                  required
                  placeholder="مثال: أحمد مصطفى"
                  value={formData.fullName}
                  onChange={e => setFormData({ ...formData, fullName: e.target.value })}
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-3.5 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-sky-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">البريد الإلكتروني (لتسجيل الدخول) *</label>
                <input
                  type="email"
                  required
                  placeholder="name@example.com"
                  value={formData.email}
                  onChange={e => setFormData({ ...formData, email: e.target.value })}
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-3.5 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-sky-500"
                  dir="ltr"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">كلمة المرور * (6 خانات على الأقل)</label>
                <input
                  type="password"
                  required
                  placeholder="••••••••"
                  value={formData.password}
                  onChange={e => setFormData({ ...formData, password: e.target.value })}
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-3.5 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-sky-500"
                  dir="ltr"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">رقم الهاتف (اختياري)</label>
                <input
                  type="text"
                  placeholder="059xxxxxxx"
                  value={formData.phone}
                  onChange={e => setFormData({ ...formData, phone: e.target.value })}
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-3.5 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-sky-500"
                  dir="ltr"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">الدور والصلاحية *</label>
                <select
                  value={formData.role}
                  onChange={e => setFormData({ ...formData, role: e.target.value as StoreMemberRole })}
                  className="w-full rounded-xl border border-white/10 bg-slate-800 px-3.5 py-2.5 text-sm text-white outline-none focus:border-sky-500"
                >
                  <option value="staff">موظف مبيعات / فريق (Staff) - فواتير ونقطة بيع</option>
                  <option value="accountant">محاسب (Accountant) - دفاتر وسندات وقيود</option>
                  <option value="admin">مدير المتجر (Admin) - كافة الصلاحيات التشغيلية</option>
                  <option value="viewer">مشاهد فقط (Viewer) - استعراض وتقارير فقط</option>
                </select>
                <p className="mt-1 text-[11px] text-slate-400">
                  {ROLE_INFO[formData.role]?.desc}
                </p>
              </div>

              <div className="flex justify-end gap-3 pt-3">
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => setShowAddModal(false)}
                  className="rounded-xl border border-white/10 px-4 py-2 text-xs text-slate-300 hover:bg-white/5"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="rounded-xl bg-sky-600 px-5 py-2 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
                >
                  {loading ? 'جاري الإضافة...' : 'إضافة المستخدم'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal تغيير كلمة المرور */}
      {passwordModalMember && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4" onClick={() => setPasswordModalMember(null)}>
          <div role="dialog" aria-modal="true" className="w-full max-w-sm rounded-2xl border border-white/10 bg-slate-900 p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-bold text-white mb-1">تعيين كلمة مرور جديدة</h3>
            <p className="text-xs text-slate-400 mb-4">
              للمستخدم: <strong className="text-white">{passwordModalMember.full_name}</strong> ({passwordModalMember.email})
            </p>

            {errorMsg && (
              <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-xs">
                {errorMsg}
              </div>
            )}

            <form onSubmit={handleUpdatePassword} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">كلمة المرور الجديدة *</label>
                <input
                  type="password"
                  required
                  placeholder="••••••••"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-3.5 py-2.5 text-sm text-white outline-none focus:border-sky-500"
                  dir="ltr"
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => setPasswordModalMember(null)}
                  className="rounded-xl border border-white/10 px-4 py-2 text-xs text-slate-300 hover:bg-white/5"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="rounded-xl bg-sky-600 px-5 py-2 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
                >
                  {loading ? 'جاري التحديث...' : 'تحديث كلمة المرور'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal تأكيد حذف مستخدم */}
      {deletingMember && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4" onClick={() => setDeletingMember(null)}>
          <div role="dialog" aria-modal="true" className="w-full max-w-sm rounded-2xl border border-white/10 bg-slate-900 p-6 shadow-2xl text-center" onClick={e => e.stopPropagation()}>
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-red-500/10 text-2xl text-red-400">
              ⚠️
            </div>
            <h3 className="text-base font-bold text-white mb-2">إزالة المستخدم من المتجر</h3>
            <p className="text-xs text-slate-400 mb-5 leading-relaxed">
              هل أنت متأكد من إزالة <strong>{deletingMember.full_name}</strong> من هذا المتجر؟ سيفقد العضو حق الوصول لكافة بيانات وعمليات المتجر.
            </p>
            <div className="flex justify-center gap-3">
              <button
                type="button"
                disabled={loading}
                onClick={() => setDeletingMember(null)}
                className="rounded-xl border border-white/10 px-4 py-2 text-xs text-slate-300 hover:bg-white/5"
              >
                تراجع
              </button>
              <button
                type="button"
                disabled={loading}
                onClick={handleDeleteMember}
                className="rounded-xl bg-red-600 px-5 py-2 text-xs font-semibold text-white hover:bg-red-500 disabled:opacity-50"
              >
                {loading ? 'جاري الحذف...' : 'نعم، إزالة'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
