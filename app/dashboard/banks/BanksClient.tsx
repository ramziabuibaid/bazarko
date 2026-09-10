'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { PALESTINIAN_BANKS, getPmaBankByCode, normalizeBankCode } from '@/lib/palestineBanks'

interface BankAccount {
  id: string
  store_id: string
  bank_code: string
  bank_name: string
  branch_code: string
  branch_name: string
  account_number: string
  account_name: string
  currency: string
  iban: string | null
  account_type: string
  account_id: string | null
  opening_balance: number
  balance: number
  is_active: boolean
  notes: string | null
  account?: { id: string; code: string; name: string } | null
  created_at: string
}

interface Props {
  store: { id: string; name: string; currency_code: string }
  initialBankAccounts: BankAccount[]
  parentAccounts: Array<{ id: string; code: string; name: string }>
}

export default function BanksClient({
  store,
  initialBankAccounts,
  parentAccounts,
}: Props) {
  const router = useRouter()
  const supabase = createClient()

  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>(initialBankAccounts)
  const [showAddModal, setShowAddModal] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [formData, setFormData] = useState({
    bank_code: '01',
    bank_name: 'بنك فلسطين',
    branch_code: '450',
    branch_name: 'فرع رام الله الرئيسي',
    account_number: '',
    account_name: `حساب جاري - ${store.name}`,
    currency: 'ILS',
    iban: '',
    account_type: 'checking',
    opening_balance: '0',
    notes: '',
  })

  // PMA Bank Change
  const handleBankChange = (code: string) => {
    const norm = normalizeBankCode(code)
    const bank = getPmaBankByCode(norm)
    if (bank) {
      const defaultBranch = bank.branches[0]
      setFormData(prev => ({
        ...prev,
        bank_code: bank.code,
        bank_name: bank.name,
        branch_code: defaultBranch?.code || '',
        branch_name: defaultBranch?.name || '',
      }))
    }
  }

  // PMA Branch Change
  const handleBranchChange = (branchCode: string) => {
    const bank = getPmaBankByCode(formData.bank_code)
    const branch = bank?.branches.find(b => b.code === branchCode)
    if (branch) {
      setFormData(prev => ({
        ...prev,
        branch_code: branch.code,
        branch_name: branch.name,
      }))
    }
  }

  // Create Bank Account & Auto-link Chart of Accounts
  const handleCreateBankAccount = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.account_number.trim() || !formData.account_name.trim()) {
      setError('يرجى ملء رقم الحساب واسم الحساب')
      return
    }

    setLoading(true)
    setError('')

    try {
      const openBal = Number(formData.opening_balance) || 0

      // 1. Create CoA Account node under 1120 if possible
      const accountCode = `1120-${formData.bank_code}${formData.account_number.slice(-4)}`
      const { data: coaAccount } = await supabase
        .from('accounts')
        .insert({
          store_id: store.id,
          code: accountCode,
          name: `${formData.bank_name} - ${formData.account_number}`,
          type: 'asset',
          is_group: false,
          currency: formData.currency,
          balance: openBal,
        })
        .select('id, code, name')
        .single()

      // 2. Insert into bank_accounts
      const { data: newBank, error: bankErr } = await supabase
        .from('bank_accounts')
        .insert({
          store_id: store.id,
          bank_code: formData.bank_code,
          bank_name: formData.bank_name,
          branch_code: formData.branch_code,
          branch_name: formData.branch_name,
          account_number: formData.account_number.trim(),
          account_name: formData.account_name.trim(),
          currency: formData.currency,
          iban: formData.iban.trim() || null,
          account_type: formData.account_type,
          account_id: coaAccount?.id || null,
          opening_balance: openBal,
          balance: openBal,
          is_active: true,
          notes: formData.notes.trim() || null,
        })
        .select('*, account:accounts(id, code, name)')
        .single()

      if (bankErr) throw bankErr

      setBankAccounts(prev => [...prev, newBank])
      setShowAddModal(false)
      // Reset
      setFormData({
        bank_code: '01',
        bank_name: 'بنك فلسطين',
        branch_code: '450',
        branch_name: 'فرع رام الله الرئيسي',
        account_number: '',
        account_name: `حساب جاري - ${store.name}`,
        currency: 'ILS',
        iban: '',
        account_type: 'checking',
        opening_balance: '0',
        notes: '',
      })
      router.refresh()
    } catch (err: any) {
      setError(err.message || 'حدث خطأ أثناء حفظ الحساب البنكي')
    } finally {
      setLoading(false)
    }
  }

  // Total Bank Balances in ILS (approx)
  const totalBalance = bankAccounts.reduce((sum, b) => sum + Number(b.balance || 0), 0)

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <span>🏛️</span> الحسابات البنكية الخاصة بالشركة
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            تعريف وإدارة الحسابات البنكية وربطها تلقائياً بشجرة الحسابات وسلطة النقد PMA
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/dashboard/cheques"
            className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-slate-800 px-4 py-2.5 text-sm font-medium text-slate-200 hover:bg-slate-700 transition"
          >
            🏦 محفظة الشيكات
          </Link>
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-1.5 rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-bold text-slate-950 hover:bg-sky-400 transition"
          >
            ➕ إضافة حساب بنكي جديد
          </button>
        </div>
      </div>

      {/* ── Overview Summary ── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-white/10 bg-slate-900 p-5">
          <p className="text-xs font-semibold text-slate-400">إجمالي الأرصدة البنكية الحالية</p>
          <p className="mt-2 text-3xl font-black text-white">
            {totalBalance.toLocaleString('en-GB', { minimumFractionDigits: 2 })}{' '}
            <span className="text-sm font-bold text-sky-400">₪</span>
          </p>
          <p className="mt-1 text-xs text-slate-500">{bankAccounts.length} حسابات بنكية معرفة</p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-slate-900 p-5">
          <p className="text-xs font-semibold text-slate-400">دليل سلطة النقد الفلسطيني (PMA)</p>
          <p className="mt-2 text-base font-bold text-emerald-400">✅ متصل ومفعل</p>
          <p className="mt-1 text-xs text-slate-500">14 بنكاً فلسطينياً ووافداً مع كافة الفروع</p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-slate-900 p-5">
          <p className="text-xs font-semibold text-slate-400">الربط مع شجرة الحسابات</p>
          <p className="mt-2 text-base font-bold text-purple-400">1120 — البنوك والحسابات الجارية</p>
          <p className="mt-1 text-xs text-slate-500">توليد قيود محاسبية تلقائية لجميع الحركات</p>
        </div>
      </div>

      {/* ── Bank Accounts Cards Grid ── */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {bankAccounts.length === 0 ? (
          <div className="col-span-full rounded-2xl border border-white/10 bg-slate-900 p-12 text-center text-slate-500">
            <p className="text-4xl mb-3">🏛️</p>
            <p className="text-base font-bold text-white">لا توجد حسابات بنكية معرفة حتى الآن</p>
            <p className="mt-1 text-xs text-slate-400">أضف حساب شركتك البنكي لربطه بحركات القبض والصرف والشيكات</p>
            <button
              onClick={() => setShowAddModal(true)}
              className="mt-4 rounded-xl bg-sky-500 px-5 py-2 text-xs font-bold text-slate-950 hover:bg-sky-400 transition"
            >
              إضافة حساب الآن
            </button>
          </div>
        ) : (
          bankAccounts.map(account => (
            <div
              key={account.id}
              className="flex flex-col justify-between rounded-2xl border border-white/10 bg-slate-900 p-5 hover:border-sky-500/40 transition shadow-lg"
            >
              <div>
                <div className="flex items-start justify-between">
                  <div>
                    <span className="rounded-lg bg-sky-500/10 px-2.5 py-1 text-[11px] font-mono font-bold text-sky-400">
                      كود PMA: {account.bank_code}
                    </span>
                    <h3 className="mt-2 text-lg font-bold text-white">{account.bank_name}</h3>
                    <p className="text-xs text-slate-400">{account.branch_name}</p>
                  </div>
                  <span className="rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[10px] font-bold text-emerald-400 border border-emerald-500/20">
                    نشط
                  </span>
                </div>

                <div className="mt-4 space-y-2 rounded-xl bg-slate-800/60 p-3 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-400">رقم الحساب:</span>
                    <span className="font-mono font-bold text-white">{account.account_number}</span>
                  </div>
                  {account.iban && (
                    <div className="flex justify-between">
                      <span className="text-slate-400">الآيبان IBAN:</span>
                      <span className="font-mono text-[11px] text-slate-300">{account.iban}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-slate-400">حساب الشجرة:</span>
                    <span className="font-mono text-purple-400 font-semibold">
                      {account.account?.code || '1120'}
                    </span>
                  </div>
                </div>

                <div className="mt-4 border-t border-white/5 pt-3">
                  <p className="text-[11px] text-slate-400">الرصيد الدفتري الحالي</p>
                  <p className="mt-1 text-2xl font-black text-white font-mono">
                    {Number(account.balance).toLocaleString('en-GB', { minimumFractionDigits: 2 })}{' '}
                    <span className="text-xs text-sky-400">{account.currency}</span>
                  </p>
                </div>
              </div>

              <div className="mt-5 flex gap-2 border-t border-white/10 pt-3">
                <Link
                  href={`/dashboard/banks/statement?bank_id=${account.id}`}
                  className="flex-1 rounded-xl bg-slate-800 py-2 text-center text-xs font-bold text-slate-200 hover:bg-slate-700 transition"
                >
                  📊 كشف الحساب
                </Link>
                <Link
                  href={`/dashboard/banks/statement/print?bank_id=${account.id}`}
                  className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-slate-400 hover:text-white transition"
                  title="طباعة كشف حساب بنكي"
                >
                  🖨️
                </Link>
              </div>
            </div>
          ))
        )}
      </div>

      {/* ── Modal: إضافة حساب بنكي جديد ── */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="relative max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-white/10 bg-slate-900 p-6 shadow-2xl">
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <span>🏛️</span> إضافة حساب بنكي جديد
            </h2>

            {error && <div className="mt-3 rounded-xl bg-rose-500/10 border border-rose-500/20 p-3 text-xs text-rose-400">{error}</div>}

            <form onSubmit={handleCreateBankAccount} className="mt-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-300">البنك (سلطة النقد PMA)</label>
                  <select
                    value={formData.bank_code}
                    onChange={e => handleBankChange(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-slate-800 p-2.5 text-xs text-white outline-none focus:border-sky-500"
                  >
                    {PALESTINIAN_BANKS.map(b => (
                      <option key={b.code} value={b.code}>
                        {b.code} — {b.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-300">الفرع</label>
                  <select
                    value={formData.branch_code}
                    onChange={e => handleBranchChange(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-slate-800 p-2.5 text-xs text-white outline-none focus:border-sky-500"
                  >
                    {getPmaBankByCode(formData.bank_code)?.branches.map(br => (
                      <option key={br.code} value={br.code}>
                        {br.code} — {br.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-300">رقم الحساب البنكي *</label>
                  <input
                    type="text"
                    required
                    value={formData.account_number}
                    onChange={e => setFormData({ ...formData, account_number: e.target.value })}
                    placeholder="مثال: 1234567"
                    className="w-full rounded-xl border border-white/10 bg-slate-800 p-2.5 text-xs text-white outline-none focus:border-sky-500 font-mono"
                  />
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

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-300">اسم الحساب (للتعريف الداخلي) *</label>
                <input
                  type="text"
                  required
                  value={formData.account_name}
                  onChange={e => setFormData({ ...formData, account_name: e.target.value })}
                  className="w-full rounded-xl border border-white/10 bg-slate-800 p-2.5 text-xs text-white outline-none focus:border-sky-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-300">رقم الآيبان (IBAN)</label>
                  <input
                    type="text"
                    value={formData.iban}
                    onChange={e => setFormData({ ...formData, iban: e.target.value })}
                    placeholder="PS00..."
                    className="w-full rounded-xl border border-white/10 bg-slate-800 p-2.5 text-xs text-white outline-none focus:border-sky-500 font-mono"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-300">الرصيد الافتتاحي</label>
                  <input
                    type="number"
                    step="any"
                    value={formData.opening_balance}
                    onChange={e => setFormData({ ...formData, opening_balance: e.target.value })}
                    className="w-full rounded-xl border border-white/10 bg-slate-800 p-2.5 text-xs text-white outline-none focus:border-sky-500 font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-300">ملاحظات</label>
                <textarea
                  rows={2}
                  value={formData.notes}
                  onChange={e => setFormData({ ...formData, notes: e.target.value })}
                  className="w-full rounded-xl border border-white/10 bg-slate-800 p-2.5 text-xs text-white outline-none focus:border-sky-500"
                />
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
                  {loading ? 'جارٍ الحفظ...' : 'حفظ وتثبيت الحساب'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
