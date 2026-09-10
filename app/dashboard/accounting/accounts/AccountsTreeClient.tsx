'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

interface Account {
  id: string
  store_id: string
  code: string
  name: string
  type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense'
  parent_id: string | null
  is_group: boolean
  is_active: boolean
  currency: string
  balance: number
  sort_order: number
}

interface Props {
  store: { id: string; name: string; currency_code: string }
  initialAccounts: Account[]
}

const TYPE_CONFIG: Record<string, { label: string; color: string; bg: string; icon: string }> = {
  asset: { label: 'أصول (Assets)', color: 'text-sky-400', bg: 'bg-sky-500/10', icon: '🏛️' },
  liability: { label: 'التزامات (Liabilities)', color: 'text-rose-400', bg: 'bg-rose-500/10', icon: '💳' },
  equity: { label: 'حقوق ملكية (Equity)', color: 'text-purple-400', bg: 'bg-purple-500/10', icon: '🛡️' },
  revenue: { label: 'إيرادات (Revenue)', color: 'text-emerald-400', bg: 'bg-emerald-500/10', icon: '📈' },
  expense: { label: 'مصروفات (Expenses)', color: 'text-amber-400', bg: 'bg-amber-500/10', icon: '📉' },
}

export default function AccountsTreeClient({ store, initialAccounts }: Props) {
  const router = useRouter()
  const supabase = createClient()

  const [accounts, setAccounts] = useState<Account[]>(initialAccounts)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedType, setSelectedType] = useState<string>('all')
  const [showAddModal, setShowAddModal] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [formData, setFormData] = useState({
    code: '',
    name: '',
    type: 'asset' as Account['type'],
    parent_id: '',
    is_group: false,
    currency: 'ILS',
  })

  // Filtered accounts
  const filteredAccounts = useMemo(() => {
    return accounts.filter(acc => {
      if (selectedType !== 'all' && acc.type !== selectedType) return false
      if (searchQuery) {
        const q = searchQuery.toLowerCase()
        return acc.code.toLowerCase().includes(q) || acc.name.toLowerCase().includes(q)
      }
      return true
    })
  }, [accounts, selectedType, searchQuery])

  // Handle Add Account
  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.code.trim() || !formData.name.trim()) {
      setError('يرجى إدخال كود الحساب واسم الحساب')
      return
    }

    setLoading(true)
    setError('')

    try {
      const { data: newAcc, error: insertErr } = await supabase
        .from('accounts')
        .insert({
          store_id: store.id,
          code: formData.code.trim(),
          name: formData.name.trim(),
          type: formData.type,
          parent_id: formData.parent_id || null,
          is_group: formData.is_group,
          currency: formData.currency,
          balance: 0,
        })
        .select('*')
        .single()

      if (insertErr) throw insertErr

      setAccounts(prev => [...prev, newAcc].sort((a, b) => a.code.localeCompare(b.code)))
      setShowAddModal(false)
      setFormData({
        code: '',
        name: '',
        type: 'asset',
        parent_id: '',
        is_group: false,
        currency: 'ILS',
      })
      router.refresh()
    } catch (err: any) {
      setError(err.message || 'حدث خطأ أثناء حفظ الحساب')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <span>🌳</span> دليل وشجرة الحسابات (Chart of Accounts)
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            الهيكل المحاسبي القياسي للأصول، الالتزامات، حقوق الملكية، الإيرادات، والمصروفات
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/dashboard/accounting/journal"
            className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-slate-800 px-4 py-2.5 text-sm font-medium text-slate-200 hover:bg-slate-700 transition"
          >
            📋 قيود اليومية
          </Link>
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-1.5 rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-bold text-slate-950 hover:bg-sky-400 transition"
          >
            ➕ إضافة حساب جديد
          </button>
        </div>
      </div>

      {/* ── Category Badges Filter ── */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setSelectedType('all')}
          className={`rounded-xl px-4 py-2 text-xs font-bold transition ${
            selectedType === 'all'
              ? 'bg-sky-500 text-slate-950 shadow-sm'
              : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
          }`}
        >
          كل الحسابات ({accounts.length})
        </button>
        {Object.entries(TYPE_CONFIG).map(([typeKey, conf]) => (
          <button
            key={typeKey}
            onClick={() => setSelectedType(typeKey)}
            className={`flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold transition ${
              selectedType === typeKey
                ? `${conf.bg} ${conf.color} border border-current shadow-sm`
                : 'bg-slate-900 border border-white/10 text-slate-400 hover:text-white'
            }`}
          >
            <span>{conf.icon}</span> {conf.label}
          </button>
        ))}
      </div>

      {/* ── Search & Filter ── */}
      <div className="relative w-full sm:w-80">
        <input
          type="text"
          placeholder="بحث برقم الكود أو اسم الحساب..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-2.5 text-right text-xs text-white placeholder-slate-500 outline-none focus:border-sky-500"
        />
      </div>

      {/* ── Accounts Table / Tree ── */}
      <div className="overflow-hidden rounded-2xl border border-white/10 bg-slate-900 shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead>
              <tr className="border-b border-white/10 bg-slate-800/60 text-slate-400 font-bold">
                <th className="p-3.5">كود الحساب</th>
                <th className="p-3.5">اسم الحساب</th>
                <th className="p-3.5">النوع الرئيسي</th>
                <th className="p-3.5">طبيعة الحساب</th>
                <th className="p-3.5">العملة</th>
                <th className="p-3.5">الرصيد الدفتري</th>
                <th className="p-3.5 text-center">الحالة</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 text-slate-200">
              {filteredAccounts.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-slate-500">
                    لا توجد حسابات مطابقة للبحث الحالي
                  </td>
                </tr>
              ) : (
                filteredAccounts.map(account => {
                  const conf = TYPE_CONFIG[account.type] || {
                    label: account.type,
                    color: 'text-slate-400',
                    bg: 'bg-slate-800',
                    icon: '📁',
                  }
                  const isMain = account.is_group || account.code.length <= 2

                  return (
                    <tr
                      key={account.id}
                      className={`hover:bg-slate-800/40 transition ${
                        isMain ? 'bg-slate-800/20 font-bold' : ''
                      }`}
                    >
                      <td className="p-3.5 font-mono font-bold text-sky-400">
                        {account.code}
                      </td>

                      <td className="p-3.5">
                        <div
                          style={{
                            paddingRight: `${Math.max(0, (account.code.length - 1) * 12)}px`,
                          }}
                          className="flex items-center gap-2"
                        >
                          <span>{account.is_group ? '📂' : '📄'}</span>
                          <span className={isMain ? 'text-white text-sm' : 'text-slate-200'}>
                            {account.name}
                          </span>
                        </div>
                      </td>

                      <td className="p-3.5">
                        <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-bold ${conf.color}`}>
                          {conf.icon} {conf.label.split(' ')[0]}
                        </span>
                      </td>

                      <td className="p-3.5 text-slate-400">
                        {account.is_group ? 'حساب رئيسي (تجميعي)' : 'حساب فرعي (حركات)'}
                      </td>

                      <td className="p-3.5 font-bold text-slate-300">
                        {account.currency || 'ILS'}
                      </td>

                      <td className="p-3.5 font-mono font-bold text-white">
                        {Number(account.balance || 0).toLocaleString('en-GB', { minimumFractionDigits: 2 })}{' '}
                        <span className="text-[10px] text-slate-400">₪</span>
                      </td>

                      <td className="p-3.5 text-center">
                        <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-400 border border-emerald-500/20">
                          نشط
                        </span>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Modal: إضافة حساب جديد ── */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-white/10 bg-slate-900 p-6 shadow-2xl">
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <span>➕</span> إضافة حساب جديد للدليل
            </h2>

            {error && <div className="mt-3 rounded-xl bg-rose-500/10 border border-rose-500/20 p-3 text-xs text-rose-400">{error}</div>}

            <form onSubmit={handleCreateAccount} className="mt-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-300">نوع الحساب *</label>
                  <select
                    value={formData.type}
                    onChange={e => setFormData({ ...formData, type: e.target.value as any })}
                    className="w-full rounded-xl border border-white/10 bg-slate-800 p-2.5 text-xs text-white outline-none focus:border-sky-500"
                  >
                    <option value="asset">1 — الأصول (Assets)</option>
                    <option value="liability">2 — الالتزامات (Liabilities)</option>
                    <option value="equity">3 — حقوق الملكية (Equity)</option>
                    <option value="revenue">4 — الإيرادات (Revenue)</option>
                    <option value="expense">5 — المصروفات (Expenses)</option>
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-300">كود الحساب *</label>
                  <input
                    type="text"
                    required
                    value={formData.code}
                    onChange={e => setFormData({ ...formData, code: e.target.value })}
                    placeholder="مثال: 5107 أو 1121"
                    className="w-full rounded-xl border border-white/10 bg-slate-800 p-2.5 text-xs text-white outline-none focus:border-sky-500 font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-300">اسم الحساب *</label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={e => setFormData({ ...formData, name: e.target.value })}
                  placeholder="مثال: مصاريف الدعاية والإعلان"
                  className="w-full rounded-xl border border-white/10 bg-slate-800 p-2.5 text-xs text-white outline-none focus:border-sky-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-300">الحساب الأب (اختياري)</label>
                  <select
                    value={formData.parent_id}
                    onChange={e => setFormData({ ...formData, parent_id: e.target.value })}
                    className="w-full rounded-xl border border-white/10 bg-slate-800 p-2.5 text-xs text-white outline-none focus:border-sky-500"
                  >
                    <option value="">بدون حساب أب (حساب رئيسي)</option>
                    {accounts.filter(a => a.is_group || a.code.length <= 3).map(a => (
                      <option key={a.id} value={a.id}>
                        {a.code} — {a.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-300">العملة</label>
                  <select
                    value={formData.currency}
                    onChange={e => setFormData({ ...formData, currency: e.target.value })}
                    className="w-full rounded-xl border border-white/10 bg-slate-800 p-2.5 text-xs text-white outline-none focus:border-sky-500 font-bold"
                  >
                    <option value="ILS">شيكل (ILS ₪)</option>
                    <option value="USD">دولار (USD $)</option>
                    <option value="JOD">دينار (JOD JD)</option>
                    <option value="EUR">يورو (EUR €)</option>
                  </select>
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="is_group"
                  checked={formData.is_group}
                  onChange={e => setFormData({ ...formData, is_group: e.target.checked })}
                  className="h-4 w-4 rounded border-white/10 bg-slate-800 text-sky-500"
                />
                <label htmlFor="is_group" className="text-xs text-slate-300 cursor-pointer">
                  حساب رئيسي تجميعي (يحتوي حسابات فرعية ولا تقبل الحركات المباشرة)
                </label>
              </div>

              <div className="flex gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="flex-1 rounded-xl border border-white/10 py-2.5 text-xs font-bold text-slate-400 hover:bg-slate-800 transition"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 rounded-xl bg-sky-500 py-2.5 text-xs font-bold text-slate-950 hover:bg-sky-400 transition disabled:opacity-50"
                >
                  {loading ? 'جارٍ الحفظ...' : 'حفظ الحساب'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
