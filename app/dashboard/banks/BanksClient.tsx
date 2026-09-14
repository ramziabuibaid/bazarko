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

  const [activeTab, setActiveTab] = useState<'company' | 'directory'>('company')
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>(initialBankAccounts)
  const [showAddModal, setShowAddModal] = useState(false)
  const [editingBank, setEditingBank] = useState<BankAccount | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [pmaSearch, setPmaSearch] = useState('')

  // Quick Transfer Modal (Between Cash Box and Company Bank)
  const [showTransferModal, setShowTransferModal] = useState<BankAccount | null>(null)
  const [transferType, setTransferType] = useState<'deposit_to_bank' | 'withdraw_from_bank'>('deposit_to_bank')
  const [transferAmount, setTransferAmount] = useState('')
  const [transferNotes, setTransferNotes] = useState('')

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
    account_id: '',
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

  // Open add modal prefilled from PMA directory
  const handleOpenAddFromPma = (bankCode: string, branchCode?: string) => {
    const bank = getPmaBankByCode(bankCode)
    if (bank) {
      const branch = branchCode ? bank.branches.find(b => b.code === branchCode) : bank.branches[0]
      setFormData({
        bank_code: bank.code,
        bank_name: bank.name,
        branch_code: branch?.code || '',
        branch_name: branch?.name || '',
        account_number: '',
        account_name: `حساب ${bank.name} - ${store.name}`,
        currency: 'ILS',
        iban: '',
        account_type: 'checking',
        opening_balance: '0',
        account_id: '',
        notes: '',
      })
      setActiveTab('company')
      setShowAddModal(true)
    }
  }

  // Create or Update Company Bank Account
  const handleSaveBankAccount = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.account_number.trim() || !formData.account_name.trim()) {
      setError('يرجى كتابة رقم الحساب واسم الحساب')
      return
    }

    setLoading(true)
    setError('')

    try {
      const openBal = Number(formData.opening_balance) || 0

      if (editingBank) {
        // Update existing
        const { data: updated, error: updErr } = await supabase
          .from('bank_accounts')
          .update({
            bank_code: formData.bank_code,
            bank_name: formData.bank_name,
            branch_code: formData.branch_code,
            branch_name: formData.branch_name,
            account_number: formData.account_number.trim(),
            account_name: formData.account_name.trim(),
            currency: formData.currency,
            iban: formData.iban.trim() || null,
            account_type: formData.account_type,
            account_id: formData.account_id || editingBank.account_id,
            notes: formData.notes.trim() || null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', editingBank.id)
          .select('*, account:accounts(id, code, name)')
          .single()

        if (updErr) throw updErr
        setBankAccounts(prev => prev.map(b => b.id === editingBank.id ? updated : b))
        setEditingBank(null)
      } else {
        // Create new
        let coaAccountId = formData.account_id || null

        // Auto-create CoA Account node under 1120 if none specified
        if (!coaAccountId) {
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

          if (coaAccount) coaAccountId = coaAccount.id
        }

        // Insert into bank_accounts
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
            account_id: coaAccountId,
            opening_balance: openBal,
            balance: openBal,
            is_active: true,
            notes: formData.notes.trim() || null,
          })
          .select('*, account:accounts(id, code, name)')
          .single()

        if (bankErr) throw bankErr
        setBankAccounts(prev => [...prev, newBank])
      }

      setShowAddModal(false)
      router.refresh()
    } catch (err: any) {
      setError(err.message || 'حدث خطأ أثناء حفظ الحساب البنكي')
    } finally {
      setLoading(false)
    }
  }

  // Toggle active
  const handleToggleActive = async (bank: BankAccount) => {
    const nextActive = !bank.is_active
    const { error: err } = await supabase
      .from('bank_accounts')
      .update({ is_active: nextActive })
      .eq('id', bank.id)

    if (!err) {
      setBankAccounts(prev => prev.map(b => b.id === bank.id ? { ...b, is_active: nextActive } : b))
    }
  }

  // Handle Cashbox <-> Bank Transfer
  const handleExecuteTransfer = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!showTransferModal || !transferAmount || Number(transferAmount) <= 0) return

    setLoading(true)
    setError('')
    try {
      const amount = Number(transferAmount)
      const isDeposit = transferType === 'deposit_to_bank'

      // 1. Update bank balance
      const newBankBal = isDeposit
        ? Number(showTransferModal.balance) + amount
        : Number(showTransferModal.balance) - amount

      await supabase
        .from('bank_accounts')
        .update({ balance: newBankBal, updated_at: new Date().toISOString() })
        .eq('id', showTransferModal.id)

      // 2. Fetch default cashbox
      const { data: cashBox } = await supabase
        .from('cash_boxes')
        .select('id')
        .eq('store_id', store.id)
        .limit(1)
        .single()

      if (cashBox) {
        // Record cash movement in treasury
        await supabase.from('cash_movements').insert({
          store_id: store.id,
          cash_box_id: cashBox.id,
          direction: isDeposit ? 'out' : 'in',
          amount,
          source: 'transfer',
          party_name: `${showTransferModal.bank_name} (${showTransferModal.account_number})`,
          payment_method: 'bank',
          description: transferNotes || (isDeposit ? `إيداع نقدي في البنك (${showTransferModal.bank_name})` : `سحب نقدي من البنك (${showTransferModal.bank_name})`),
          date: new Date().toISOString().slice(0, 10),
        })
      }

      setBankAccounts(prev => prev.map(b => b.id === showTransferModal.id ? { ...b, balance: newBankBal } : b))
      setShowTransferModal(null)
      setTransferAmount('')
      setTransferNotes('')
      router.refresh()
    } catch (err: any) {
      setError(err.message || 'فشلت عملية التحويل')
    } finally {
      setLoading(false)
    }
  }

  const filteredPmaBanks = PALESTINIAN_BANKS.filter(b =>
    b.name.includes(pmaSearch) ||
    (b.nameEn && b.nameEn.toLowerCase().includes(pmaSearch.toLowerCase())) ||
    b.code.includes(pmaSearch) ||
    b.branches.some(br => br.name.includes(pmaSearch) || (br.city && br.city.includes(pmaSearch)))
  )

  const totalBalance = bankAccounts.reduce((sum, b) => sum + Number(b.balance || 0), 0)

  return (
    <div className="space-y-6">
      {/* ── Page Header ── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <span>🏛️</span> الحسابات البنكية الخاصة بالشركة
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            فصل وإدارة الحسابات البنكية الفعلية للشركة وربطها بالخزينة، السندات، الشيكات، ودليل الحسابات
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/dashboard/cheques"
            className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-slate-800 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-700 transition"
          >
            🏦 محفظة الشيكات
          </Link>
          <button
            onClick={() => {
              setEditingBank(null)
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
                account_id: '',
                notes: '',
              })
              setShowAddModal(true)
            }}
            className="flex items-center gap-1.5 rounded-xl bg-sky-500 px-4 py-2 text-sm font-bold text-slate-950 hover:bg-sky-400 transition shadow"
          >
            ➕ فتح وتعريف حساب بنكي للشركة
          </button>
        </div>
      </div>

      {/* ── Tabs Navigation ── */}
      <div className="flex border-b border-white/10 text-sm font-semibold">
        <button
          onClick={() => setActiveTab('company')}
          className={`flex items-center gap-2 border-b-2 px-5 py-3 transition ${
            activeTab === 'company'
              ? 'border-sky-500 text-sky-400'
              : 'border-transparent text-slate-400 hover:text-white'
          }`}
        >
          <span>💼</span> حسابات الشركة الشخصية ({bankAccounts.length})
        </button>
        <button
          onClick={() => setActiveTab('directory')}
          className={`flex items-center gap-2 border-b-2 px-5 py-3 transition ${
            activeTab === 'directory'
              ? 'border-sky-500 text-sky-400'
              : 'border-transparent text-slate-400 hover:text-white'
          }`}
        >
          <span>🏛️</span> دليل البنوك العامة (سلطة النقد PMA)
        </button>
      </div>

      {/* ── Tab 1: Company Personal Bank Accounts ── */}
      {activeTab === 'company' && (
        <div className="space-y-6">
          {/* Overview Summary */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="rounded-2xl border border-white/10 bg-slate-900 p-5">
              <p className="text-xs font-semibold text-slate-400">إجمالي الأرصدة البنكية للشركة</p>
              <p className="mt-2 text-3xl font-black text-white" dir="ltr">
                {totalBalance.toLocaleString('ar-u-nu-latn', { minimumFractionDigits: 2 })}{' '}
                <span className="text-sm font-bold text-sky-400">{store.currency_code}</span>
              </p>
              <p className="mt-1 text-xs text-slate-500">{bankAccounts.length} حسابات معرفة ومربوطة محاسبياً</p>
            </div>

            <div className="rounded-2xl border border-white/10 bg-slate-900 p-5">
              <p className="text-xs font-semibold text-slate-400">الربط مع القيود وشجرة الحسابات</p>
              <p className="mt-2 text-base font-bold text-emerald-400">✅ متصل تلقائياً (1120)</p>
              <p className="mt-1 text-xs text-slate-500">تظهر الحركات فوراً في ميزان المراجعة والتقارير</p>
            </div>

            <div className="rounded-2xl border border-white/10 bg-slate-900 p-5">
              <p className="text-xs font-semibold text-slate-400">العمليات السريعة</p>
              <div className="mt-2 flex items-center gap-2">
                <Link
                  href="/dashboard/banks/statement"
                  className="rounded-lg bg-sky-500/10 border border-sky-500/20 px-3 py-1 text-xs font-bold text-sky-400 hover:bg-sky-500/20 transition"
                >
                  📜 كشف حساب تفصيلي
                </Link>
                <Link
                  href="/dashboard/accounting/receipts"
                  className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-3 py-1 text-xs font-bold text-emerald-400 hover:bg-emerald-500/20 transition"
                >
                  📥 سندات القبض
                </Link>
              </div>
            </div>
          </div>

          {/* Accounts List Table */}
          <div className="overflow-hidden rounded-2xl border border-white/10 bg-slate-900 shadow-xl">
            <div className="border-b border-white/10 px-5 py-4 flex items-center justify-between">
              <h2 className="font-bold text-white text-base">قائمة حسابات الشركة المفتوحة والمعتمدة</h2>
              <span className="text-xs text-slate-400">الحسابات المستخدمة في الصندوق، السندات والشيكات</span>
            </div>

            {bankAccounts.length === 0 ? (
              <div className="p-12 text-center">
                <p className="text-4xl">🏦</p>
                <h3 className="mt-3 text-lg font-bold text-white">لم تقم الشركة بإضافة أي حساب بنكي شخصي بعد</h3>
                <p className="mt-1 text-sm text-slate-400">
                  قم بإضافة الحساب البنكي الفعلي للشركة لاستخدامه في المقبوضات والمدفوعات وإيداع الشيكات.
                </p>
                <button
                  onClick={() => setShowAddModal(true)}
                  className="mt-4 inline-flex items-center gap-2 rounded-xl bg-sky-500 px-5 py-2.5 text-sm font-bold text-slate-950 hover:bg-sky-400 transition"
                >
                  ➕ إضافة الحساب البنكي الأول
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-right text-sm">
                  <thead className="border-b border-white/10 bg-slate-800/50 text-xs font-semibold text-slate-400">
                    <tr>
                      <th className="p-4">البنك والفرع</th>
                      <th className="p-4">اسم الحساب ورقم الحساب</th>
                      <th className="p-4">الآيبان (IBAN)</th>
                      <th className="p-4">العملة</th>
                      <th className="p-4">الرصيد الدفتري الحالي</th>
                      <th className="p-4">الحساب المحاسبي المرتبط</th>
                      <th className="p-4">الحالة</th>
                      <th className="p-4 text-center">الإجراءات</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 text-slate-300">
                    {bankAccounts.map(b => (
                      <tr key={b.id} className="hover:bg-white/[0.02] transition">
                        <td className="p-4">
                          <p className="font-bold text-white">{b.bank_name}</p>
                          <p className="text-xs text-slate-400 mt-0.5">{b.branch_name}</p>
                        </td>
                        <td className="p-4">
                          <p className="font-semibold text-white">{b.account_name}</p>
                          <p className="font-mono text-xs text-sky-400 mt-0.5" dir="ltr">{b.account_number}</p>
                        </td>
                        <td className="p-4 font-mono text-xs text-slate-400" dir="ltr">
                          {b.iban || '—'}
                        </td>
                        <td className="p-4">
                          <span className="rounded-md bg-slate-800 px-2 py-1 text-xs font-mono font-bold text-white">
                            {b.currency}
                          </span>
                        </td>
                        <td className="p-4 font-mono font-black text-white text-base" dir="ltr">
                          {Number(b.balance || 0).toLocaleString('ar-u-nu-latn', { minimumFractionDigits: 2 })}{' '}
                          <span className="text-xs text-slate-400">{b.currency}</span>
                        </td>
                        <td className="p-4">
                          {b.account ? (
                            <div>
                              <p className="font-semibold text-slate-200">{b.account.name}</p>
                              <p className="font-mono text-xs text-slate-500" dir="ltr">{b.account.code}</p>
                            </div>
                          ) : (
                            <span className="text-xs text-slate-500">غير مربوط</span>
                          )}
                        </td>
                        <td className="p-4">
                          <button
                            onClick={() => handleToggleActive(b)}
                            className={`rounded-full px-2.5 py-0.5 text-xs font-semibold transition ${
                              b.is_active
                                ? 'bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25'
                                : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
                            }`}
                          >
                            {b.is_active ? 'نشط ✓' : 'معطل'}
                          </button>
                        </td>
                        <td className="p-4">
                          <div className="flex items-center justify-center gap-2">
                            <Link
                              href={`/dashboard/banks/statement?bank_id=${b.id}`}
                              className="rounded-lg bg-sky-500/10 border border-sky-500/20 px-2.5 py-1 text-xs font-bold text-sky-400 hover:bg-sky-500/20 transition"
                              title="عرض كشف الحساب البنكي"
                            >
                              📜 كشف الحساب
                            </Link>
                            <button
                              onClick={() => {
                                setShowTransferModal(b)
                                setTransferAmount('')
                                setTransferNotes('')
                              }}
                              className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 text-xs font-bold text-emerald-400 hover:bg-emerald-500/20 transition"
                              title="تحويل بين الصندوق والبنك"
                            >
                              🔄 إيداع/سحب
                            </button>
                            <button
                              onClick={() => {
                                setEditingBank(b)
                                setFormData({
                                  bank_code: b.bank_code,
                                  bank_name: b.bank_name,
                                  branch_code: b.branch_code,
                                  branch_name: b.branch_name,
                                  account_number: b.account_number,
                                  account_name: b.account_name,
                                  currency: b.currency,
                                  iban: b.iban || '',
                                  account_type: b.account_type,
                                  opening_balance: String(b.opening_balance || 0),
                                  account_id: b.account_id || '',
                                  notes: b.notes || '',
                                })
                                setShowAddModal(true)
                              }}
                              className="rounded-lg border border-white/10 bg-slate-800 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700 transition"
                              title="تعديل الحساب"
                            >
                              ✏️
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Tab 2: Public Banks Directory (PMA Reference) ── */}
      {activeTab === 'directory' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-2xl border border-white/10 bg-slate-900 p-4">
            <div className="flex-1 max-w-md">
              <input
                type="text"
                value={pmaSearch}
                onChange={e => setPmaSearch(e.target.value)}
                placeholder="🔍 ابحث في دليل البنوك العامة أو الفروع أو المدن..."
                className="w-full rounded-xl border border-white/10 bg-slate-800 px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-sky-500"
              />
            </div>
            <div className="text-xs text-slate-400">
              دليل سلطة النقد الفلسطينية (PMA) — بيانات عامة مرجعية
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filteredPmaBanks.map(bank => (
              <div
                key={bank.code}
                className="rounded-2xl border border-white/10 bg-slate-900 p-5 hover:border-sky-500/40 transition flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-bold text-white text-base">{bank.name}</h3>
                      {bank.nameEn && <p className="text-xs text-slate-400 mt-0.5">{bank.nameEn}</p>}
                    </div>
                    <span className="rounded bg-sky-500/10 px-2 py-0.5 font-mono text-xs font-bold text-sky-400">
                      كود: {bank.code}
                    </span>
                  </div>

                  <div className="mt-4 space-y-1.5 border-t border-white/5 pt-3 text-xs text-slate-300">
                    <p className="font-semibold text-slate-400">الفروع المتاحة ({bank.branches.length} فرع):</p>
                    <div className="max-h-32 overflow-y-auto space-y-1 pr-1">
                      {bank.branches.map(br => (
                        <div key={br.code} className="flex justify-between py-0.5 text-slate-400 hover:text-white">
                          <span>{br.name}</span>
                          <span className="font-mono text-[11px] text-slate-500">#{br.code}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="mt-4 border-t border-white/5 pt-3">
                  <button
                    onClick={() => handleOpenAddFromPma(bank.code)}
                    className="w-full rounded-xl bg-slate-800 border border-white/10 py-2 text-xs font-bold text-sky-400 hover:bg-sky-500/10 hover:border-sky-500/30 transition"
                  >
                    ➕ فتح حساب شركة بهذا البنك
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Modal: Add / Edit Company Bank Account ── */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <form
            onSubmit={handleSaveBankAccount}
            className="w-full max-w-xl rounded-2xl border border-white/10 bg-slate-900 p-6 shadow-2xl"
          >
            <div className="flex items-center justify-between pb-4 border-b border-white/10 mb-5">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <span>🏦</span> {editingBank ? 'تعديل الحساب البنكي للشركة' : 'فتح وتعريف حساب بنكي شخصي للشركة'}
              </h2>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            {error && (
              <div className="mb-4 rounded-xl bg-red-500/10 border border-red-500/20 p-3 text-xs text-red-400">
                {error}
              </div>
            )}

            <div className="grid grid-cols-2 gap-4 text-sm">
              {/* Bank Selector */}
              <div>
                <label className="block text-xs text-slate-400 mb-1">اسم البنك (PMA)</label>
                <select
                  value={formData.bank_code}
                  onChange={e => handleBankChange(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-white text-xs"
                >
                  {PALESTINIAN_BANKS.map(b => (
                    <option key={b.code} value={b.code}>
                      {b.name} ({b.code})
                    </option>
                  ))}
                </select>
              </div>

              {/* Branch Selector */}
              <div>
                <label className="block text-xs text-slate-400 mb-1">الفرع التابع له الحساب</label>
                <select
                  value={formData.branch_code}
                  onChange={e => handleBranchChange(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-white text-xs"
                >
                  {getPmaBankByCode(formData.bank_code)?.branches.map(br => (
                    <option key={br.code} value={br.code}>
                      {br.name} ({br.code})
                    </option>
                  ))}
                </select>
              </div>

              {/* Account Number */}
              <div>
                <label className="block text-xs text-slate-400 mb-1">رقم الحساب الفعلي *</label>
                <input
                  type="text"
                  required
                  placeholder="مثال: 1234567"
                  dir="ltr"
                  value={formData.account_number}
                  onChange={e => setFormData({ ...formData, account_number: e.target.value })}
                  className="w-full rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-white text-xs font-mono"
                />
              </div>

              {/* Account Label */}
              <div>
                <label className="block text-xs text-slate-400 mb-1">اسم/مسمى الحساب داخل الشركة *</label>
                <input
                  type="text"
                  required
                  placeholder="مثال: الحساب الجاري الرئيسي"
                  value={formData.account_name}
                  onChange={e => setFormData({ ...formData, account_name: e.target.value })}
                  className="w-full rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-white text-xs"
                />
              </div>

              {/* IBAN */}
              <div>
                <label className="block text-xs text-slate-400 mb-1">رقم الآيبان الدولي (IBAN)</label>
                <input
                  type="text"
                  placeholder="PS00..."
                  dir="ltr"
                  value={formData.iban}
                  onChange={e => setFormData({ ...formData, iban: e.target.value })}
                  className="w-full rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-white text-xs font-mono"
                />
              </div>

              {/* Currency */}
              <div>
                <label className="block text-xs text-slate-400 mb-1">عملة الحساب</label>
                <select
                  value={formData.currency}
                  onChange={e => setFormData({ ...formData, currency: e.target.value })}
                  className="w-full rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-white text-xs"
                >
                  <option value="ILS">شيكل (ILS)</option>
                  <option value="USD">دولار أمريكي (USD)</option>
                  <option value="JOD">دينار أردني (JOD)</option>
                  <option value="EUR">يورو (EUR)</option>
                  <option value="SAR">ريال سعودي (SAR)</option>
                </select>
              </div>

              {/* Account Type */}
              <div>
                <label className="block text-xs text-slate-400 mb-1">نوع الحساب</label>
                <select
                  value={formData.account_type}
                  onChange={e => setFormData({ ...formData, account_type: e.target.value })}
                  className="w-full rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-white text-xs"
                >
                  <option value="checking">حساب جاري (Checking)</option>
                  <option value="savings">حساب توفير (Savings)</option>
                  <option value="investment">حساب استثماري / وديعة</option>
                </select>
              </div>

              {/* Opening Balance */}
              <div>
                <label className="block text-xs text-slate-400 mb-1">الرصيد الافتتاحي</label>
                <input
                  type="number"
                  step="any"
                  disabled={!!editingBank}
                  dir="ltr"
                  value={formData.opening_balance}
                  onChange={e => setFormData({ ...formData, opening_balance: e.target.value })}
                  className="w-full rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-white text-xs font-mono disabled:opacity-50"
                />
              </div>

              {/* Chart of Accounts Link */}
              <div className="col-span-2">
                <label className="block text-xs text-slate-400 mb-1">
                  ربط الحساب بشجرة الحسابات (دليل الحسابات)
                </label>
                <select
                  value={formData.account_id}
                  onChange={e => setFormData({ ...formData, account_id: e.target.value })}
                  className="w-full rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-white text-xs"
                >
                  <option value="">إنشاء وربط تلقائي بأصل النقدية بالبنوك (1120)</option>
                  {parentAccounts.map(a => (
                    <option key={a.id} value={a.id}>
                      {a.code} - {a.name}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-slate-500 mt-1">
                  عند ترك هذا الخيار تلقائياً، ينشئ النظام بنداً مستقلاً في الأصول المتداولة لهذا الحساب البنكي.
                </p>
              </div>

              {/* Notes */}
              <div className="col-span-2">
                <label className="block text-xs text-slate-400 mb-1">ملاحظات إضافية</label>
                <textarea
                  rows={2}
                  value={formData.notes}
                  onChange={e => setFormData({ ...formData, notes: e.target.value })}
                  placeholder="ملاحظات حول سقف السحب، المفوضين بالتوقيع، أو شروط الحساب..."
                  className="w-full rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-white text-xs"
                />
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-3 border-t border-white/10 pt-4">
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="rounded-xl border border-white/10 px-4 py-2 text-xs text-slate-400 hover:text-white"
              >
                إلغاء
              </button>
              <button
                type="submit"
                disabled={loading}
                className="rounded-xl bg-sky-500 px-6 py-2 text-xs font-bold text-slate-950 hover:bg-sky-400 disabled:opacity-50 transition"
              >
                {loading ? 'جارٍ الحفظ...' : editingBank ? 'حفظ التعديلات' : 'تأكيد وحفظ الحساب البنكي'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── Modal: Cashbox <-> Bank Transfer ── */}
      {showTransferModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <form
            onSubmit={handleExecuteTransfer}
            className="w-full max-w-md rounded-2xl border border-white/10 bg-slate-900 p-6 shadow-2xl"
          >
            <h2 className="text-base font-bold text-white mb-1 flex items-center gap-2">
              <span>🔄</span> تحويل مالي بين الصندوق والخزينة والبنك
            </h2>
            <p className="text-xs text-slate-400 mb-4">
              الحساب: <strong>{showTransferModal.bank_name} ({showTransferModal.account_number})</strong>
            </p>

            <div className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-400 mb-1 font-semibold">نوع العملية</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setTransferType('deposit_to_bank')}
                    className={`rounded-xl p-2.5 font-bold border transition ${
                      transferType === 'deposit_to_bank'
                        ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300'
                        : 'bg-slate-800 border-white/10 text-slate-400'
                    }`}
                  >
                    📥 إيداع نقدي بالبنك
                  </button>
                  <button
                    type="button"
                    onClick={() => setTransferType('withdraw_from_bank')}
                    className={`rounded-xl p-2.5 font-bold border transition ${
                      transferType === 'withdraw_from_bank'
                        ? 'bg-amber-500/20 border-amber-500 text-amber-300'
                        : 'bg-slate-800 border-white/10 text-slate-400'
                    }`}
                  >
                    📤 سحب من البنك للصندوق
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-slate-400 mb-1 font-semibold">
                  المبلغ ({showTransferModal.currency}) *
                </label>
                <input
                  type="number"
                  step="any"
                  required
                  placeholder="0.00"
                  dir="ltr"
                  value={transferAmount}
                  onChange={e => setTransferAmount(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-white font-mono text-sm"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">البيان / ملاحظات</label>
                <input
                  type="text"
                  value={transferNotes}
                  onChange={e => setTransferNotes(e.target.value)}
                  placeholder="مثال: توريد مبيعات الأسبوع إلى الحساب الجاري"
                  className="w-full rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-white"
                />
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-3 border-t border-white/10 pt-4">
              <button
                type="button"
                onClick={() => setShowTransferModal(null)}
                className="rounded-xl border border-white/10 px-4 py-2 text-xs text-slate-400 hover:text-white"
              >
                إلغاء
              </button>
              <button
                type="submit"
                disabled={loading || !transferAmount}
                className="rounded-xl bg-emerald-500 px-5 py-2 text-xs font-bold text-slate-950 hover:bg-emerald-400 disabled:opacity-50 transition"
              >
                {loading ? 'جارٍ التنفيذ...' : 'تنفيذ التحويل'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
