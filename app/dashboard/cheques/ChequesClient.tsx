'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { PALESTINIAN_BANKS, getPmaBankByCode, normalizeBankCode } from '@/lib/palestineBanks'
import { tafqeet } from '@/lib/tafqeet'

interface CheckItem {
  id: string
  store_id: string
  type: 'received' | 'issued'
  check_number: string
  bank_code: string | null
  bank_name: string
  branch_code: string | null
  branch_name: string | null
  account_number: string | null
  drawer_name: string | null
  payee_name: string | null
  amount: number
  currency: string
  exchange_rate: number
  amount_ils: number
  due_date: string
  issue_date: string
  status: string
  customer_id: string | null
  supplier_id: string | null
  deposit_bank_account_id: string | null
  endorsed_supplier_id: string | null
  images: string[]
  notes: string | null
  customer?: { id: string; name: string; phone: string | null } | null
  supplier?: { id: string; name: string; phone: string | null } | null
  deposit_bank?: { id: string; bank_name: string; account_number: string } | null
  created_at: string
}

interface BankAccount {
  id: string
  bank_code: string
  bank_name: string
  branch_name: string
  account_number: string
  currency: string
  balance: number
}

interface Supplier {
  id: string
  name: string
  phone: string | null
  balance: number
}

interface Customer {
  id: string
  name: string
  phone: string | null
  balance: number
}

interface Props {
  store: { id: string; name: string; currency_code: string }
  initialChecks: CheckItem[]
  bankAccounts: BankAccount[]
  suppliers: Supplier[]
  customers: Customer[]
  operations: any[]
}

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; border: string }> = {
  in_portfolio: { label: 'في الحافظة', color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20' },
  deposited: { label: 'برسم التحصيل', color: 'text-sky-400', bg: 'bg-sky-500/10', border: 'border-sky-500/20' },
  collected: { label: 'محصل', color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20' },
  bounced: { label: 'راجع / مرتد', color: 'text-rose-400', bg: 'bg-rose-500/10', border: 'border-rose-500/20' },
  endorsed: { label: 'مجيّر لمورد', color: 'text-purple-400', bg: 'bg-purple-500/10', border: 'border-purple-500/20' },
  returned_to_drawer: { label: 'معاد للساحب', color: 'text-slate-400', bg: 'bg-slate-500/10', border: 'border-slate-500/20' },
  returned_to_customer: { label: 'معاد للزبون', color: 'text-slate-400', bg: 'bg-slate-500/10', border: 'border-slate-500/20' },
  supplier_returned: { label: 'معاد من مورد', color: 'text-orange-400', bg: 'bg-orange-500/10', border: 'border-orange-500/20' },
}

export default function ChequesClient({
  store,
  initialChecks,
  bankAccounts,
  suppliers,
  customers,
  operations,
}: Props) {
  const router = useRouter()
  const supabase = createClient()

  const [checks, setChecks] = useState<CheckItem[]>(initialChecks)
  const [activeTab, setActiveTab] = useState<'received' | 'issued'>('received')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState('')

  // Modals state
  const [showAddModal, setShowAddModal] = useState(false)
  const [showOpModal, setShowOpModal] = useState<{ check: CheckItem; opType: string } | null>(null)
  const [lightboxImage, setLightboxImage] = useState<string | null>(null)
  const [lightboxCheck, setLightboxCheck] = useState<CheckItem | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // New Cheque Form
  const [formData, setFormData] = useState({
    type: 'received' as 'received' | 'issued',
    check_number: '',
    bank_code: '01',
    bank_name: 'بنك فلسطين',
    branch_code: '450',
    branch_name: 'فرع رام الله الرئيسي',
    account_number: '',
    drawer_name: '',
    payee_name: store.name,
    amount: '',
    currency: 'ILS',
    exchange_rate: 1.0,
    due_date: new Date().toISOString().slice(0, 10),
    issue_date: new Date().toISOString().slice(0, 10),
    customer_id: '',
    supplier_id: '',
    notes: '',
    imageFiles: [] as File[],
  })

  // Operation Form State
  const [opData, setOpData] = useState({
    target_bank_account_id: bankAccounts[0]?.id || '',
    target_supplier_id: suppliers[0]?.id || '',
    notes: '',
    date: new Date().toISOString().slice(0, 10),
  })

  // Filtered checks
  const filteredChecks = useMemo(() => {
    return checks.filter(c => {
      if (c.type !== activeTab) return false
      if (statusFilter !== 'all' && c.status !== statusFilter) return false
      if (searchQuery) {
        const q = searchQuery.toLowerCase()
        const matchesNumber = c.check_number.toLowerCase().includes(q)
        const matchesBank = c.bank_name.toLowerCase().includes(q)
        const matchesDrawer = (c.drawer_name || '').toLowerCase().includes(q)
        const matchesPayee = (c.payee_name || '').toLowerCase().includes(q)
        const matchesCustomer = (c.customer?.name || '').toLowerCase().includes(q)
        const matchesSupplier = (c.supplier?.name || '').toLowerCase().includes(q)
        if (!matchesNumber && !matchesBank && !matchesDrawer && !matchesPayee && !matchesCustomer && !matchesSupplier) {
          return false
        }
      }
      return true
    })
  }, [checks, activeTab, statusFilter, searchQuery])

  // Stats calculation
  const stats = useMemo(() => {
    const list = checks.filter(c => c.type === activeTab)
    const inPortfolio = list.filter(c => c.status === 'in_portfolio')
    const deposited = list.filter(c => c.status === 'deposited')
    const collected = list.filter(c => c.status === 'collected')
    const bounced = list.filter(c => c.status === 'bounced')

    return {
      totalCount: list.length,
      totalAmount: list.reduce((sum, c) => sum + Number(c.amount_ils), 0),
      portfolioCount: inPortfolio.length,
      portfolioAmount: inPortfolio.reduce((sum, c) => sum + Number(c.amount_ils), 0),
      depositedCount: deposited.length,
      depositedAmount: deposited.reduce((sum, c) => sum + Number(c.amount_ils), 0),
      collectedCount: collected.length,
      collectedAmount: collected.reduce((sum, c) => sum + Number(c.amount_ils), 0),
      bouncedCount: bounced.length,
      bouncedAmount: bounced.reduce((sum, c) => sum + Number(c.amount_ils), 0),
    }
  }, [checks, activeTab])

  // PMA Bank Selection handler
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

  // PMA Branch Selection handler
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

  // Handle Cheque Creation
  const handleCreateCheck = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.check_number || !formData.amount || Number(formData.amount) <= 0) {
      setError('يرجى إدخال رقم الشيك ومبلغ صحيح')
      return
    }

    setLoading(true)
    setError('')

    try {
      const numAmount = Number(formData.amount)
      const exRate = Number(formData.exchange_rate) || 1.0
      const amountIls = formData.currency === 'ILS' ? numAmount : numAmount * exRate

      // Upload images if any
      const imageUrls: string[] = []
      for (const file of formData.imageFiles) {
        const ext = file.name.split('.').pop()
        const filename = `${store.id}/${Date.now()}_${Math.random().toString(36).substring(7)}.${ext}`
        const { data: uploadData, error: uploadErr } = await supabase.storage
          .from('checks')
          .upload(filename, file)

        if (!uploadErr && uploadData) {
          const { data: publicUrlData } = supabase.storage.from('checks').getPublicUrl(filename)
          if (publicUrlData?.publicUrl) imageUrls.push(publicUrlData.publicUrl)
        }
      }

      const { data: newCheck, error: insertErr } = await supabase
        .from('checks')
        .insert({
          store_id: store.id,
          type: formData.type,
          check_number: formData.check_number.trim(),
          bank_code: formData.bank_code,
          bank_name: formData.bank_name,
          branch_code: formData.branch_code,
          branch_name: formData.branch_name,
          account_number: formData.account_number.trim(),
          drawer_name: formData.drawer_name.trim() || null,
          payee_name: formData.payee_name.trim() || null,
          amount: numAmount,
          currency: formData.currency,
          exchange_rate: exRate,
          amount_ils: amountIls,
          due_date: formData.due_date,
          issue_date: formData.issue_date,
          status: 'in_portfolio',
          customer_id: formData.type === 'received' ? formData.customer_id || null : null,
          supplier_id: formData.type === 'issued' ? formData.supplier_id || null : null,
          images: imageUrls,
          notes: formData.notes.trim() || null,
        })
        .select('*, customer:customers(id, name, phone), supplier:suppliers(id, name, phone)')
        .single()

      if (insertErr) throw insertErr

      // Log initial creation in check_operations
      await supabase.from('check_operations').insert({
        store_id: store.id,
        check_id: newCheck.id,
        operation_type: 'status_change',
        from_status: 'none',
        to_status: 'in_portfolio',
        operation_date: formData.issue_date,
        notes: 'تسجيل الشيك وإدراجه في الحافظة',
      })

      setChecks(prev => [newCheck, ...prev])
      setShowAddModal(false)
      // Reset form
      setFormData({
        type: activeTab,
        check_number: '',
        bank_code: '01',
        bank_name: 'بنك فلسطين',
        branch_code: '450',
        branch_name: 'فرع رام الله الرئيسي',
        account_number: '',
        drawer_name: '',
        payee_name: store.name,
        amount: '',
        currency: 'ILS',
        exchange_rate: 1.0,
        due_date: new Date().toISOString().slice(0, 10),
        issue_date: new Date().toISOString().slice(0, 10),
        customer_id: '',
        supplier_id: '',
        notes: '',
        imageFiles: [],
      })
      router.refresh()
    } catch (err: any) {
      setError(err.message || 'حدث خطأ أثناء حفظ الشيك')
    } finally {
      setLoading(false)
    }
  }

  // Handle Operations (Deposit, Collect, Bounce, Endorse, Return)
  const handleExecuteOperation = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!showOpModal) return

    setLoading(true)
    setError('')

    const { check, opType } = showOpModal
    let newStatus = check.status
    let targetBankId: string | null = null
    let targetSupplierId: string | null = null

    if (opType === 'deposit') {
      newStatus = 'deposited'
      targetBankId = opData.target_bank_account_id
    } else if (opType === 'collect') {
      newStatus = 'collected'
      targetBankId = opData.target_bank_account_id
    } else if (opType === 'bounce') {
      newStatus = 'bounced'
    } else if (opType === 'endorse') {
      newStatus = 'endorsed'
      targetSupplierId = opData.target_supplier_id
    } else if (opType === 'return') {
      newStatus = check.type === 'received' ? 'returned_to_drawer' : 'supplier_returned'
    }

    try {
      // 1. Update Check Status
      const { error: updateErr } = await supabase
        .from('checks')
        .update({
          status: newStatus,
          deposit_bank_account_id: targetBankId || check.deposit_bank_account_id,
          endorsed_supplier_id: targetSupplierId || check.endorsed_supplier_id,
          updated_at: new Date().toISOString(),
        })
        .eq('id', check.id)

      if (updateErr) throw updateErr

      // 2. Log Operation
      await supabase.from('check_operations').insert({
        store_id: store.id,
        check_id: check.id,
        operation_type: opType,
        from_status: check.status,
        to_status: newStatus,
        operation_date: opData.date,
        target_bank_account_id: targetBankId,
        target_supplier_id: targetSupplierId,
        notes: opData.notes.trim() || null,
      })

      // 3. If collected, update bank account balance
      if (opType === 'collect' && targetBankId) {
        const bank = bankAccounts.find(b => b.id === targetBankId)
        if (bank) {
          const newBal = Number(bank.balance || 0) + Number(check.amount_ils)
          await supabase.from('bank_accounts').update({ balance: newBal }).eq('id', targetBankId)
        }
      }

      // Update local state
      setChecks(prev =>
        prev.map(c =>
          c.id === check.id
            ? {
                ...c,
                status: newStatus,
                deposit_bank_account_id: targetBankId || c.deposit_bank_account_id,
                endorsed_supplier_id: targetSupplierId || c.endorsed_supplier_id,
              }
            : c
        )
      )

      setShowOpModal(null)
      router.refresh()
    } catch (err: any) {
      setError(err.message || 'فشلت العملية')
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
            <span>🏦</span> محفظة الشيكات والبنوك
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            إدارة الشيكات الواردة والصادرة وفق معايير سلطة النقد الفلسطينية (PMA)
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/dashboard/banks"
            className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-slate-800 px-4 py-2.5 text-sm font-medium text-slate-200 hover:bg-slate-700 transition"
          >
            🏛️ الحسابات البنكية
          </Link>
          <button
            onClick={() => {
              setFormData(f => ({ ...f, type: activeTab }))
              setShowAddModal(true)
            }}
            className="flex items-center gap-1.5 rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-bold text-slate-950 hover:bg-sky-400 transition"
          >
            ➕ تسجيل شيك جديد
          </button>
        </div>
      </div>

      {/* ── Tabs (Received / Issued) ── */}
      <div className="flex border-b border-white/10">
        <button
          onClick={() => { setActiveTab('received'); setStatusFilter('all') }}
          className={`px-6 py-3 text-sm font-bold border-b-2 transition ${
            activeTab === 'received'
              ? 'border-sky-500 text-sky-400'
              : 'border-transparent text-slate-400 hover:text-white'
          }`}
        >
          📥 شيكات مقبوضة (واردة من الزبائن)
        </button>
        <button
          onClick={() => { setActiveTab('issued'); setStatusFilter('all') }}
          className={`px-6 py-3 text-sm font-bold border-b-2 transition ${
            activeTab === 'issued'
              ? 'border-sky-500 text-sky-400'
              : 'border-transparent text-slate-400 hover:text-white'
          }`}
        >
          📤 شيكات صادرة (للموردين)
        </button>
      </div>

      {/* ── Stats Summary Cards ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 text-right">
          <p className="text-xs font-semibold text-amber-400">في الحافظة (جاهزة)</p>
          <p className="mt-2 text-2xl font-black text-white">
            {stats.portfolioAmount.toLocaleString('en-GB', { minimumFractionDigits: 2 })} <span className="text-xs text-slate-400">₪</span>
          </p>
          <p className="mt-1 text-xs text-slate-400">{stats.portfolioCount} شيك</p>
        </div>

        <div className="rounded-2xl border border-sky-500/20 bg-sky-500/5 p-4 text-right">
          <p className="text-xs font-semibold text-sky-400">برسم التحصيل (في البنك)</p>
          <p className="mt-2 text-2xl font-black text-white">
            {stats.depositedAmount.toLocaleString('en-GB', { minimumFractionDigits: 2 })} <span className="text-xs text-slate-400">₪</span>
          </p>
          <p className="mt-1 text-xs text-slate-400">{stats.depositedCount} شيك</p>
        </div>

        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-right">
          <p className="text-xs font-semibold text-emerald-400">محصلة</p>
          <p className="mt-2 text-2xl font-black text-white">
            {stats.collectedAmount.toLocaleString('en-GB', { minimumFractionDigits: 2 })} <span className="text-xs text-slate-400">₪</span>
          </p>
          <p className="mt-1 text-xs text-slate-400">{stats.collectedCount} شيك</p>
        </div>

        <div className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-4 text-right">
          <p className="text-xs font-semibold text-rose-400">راجعة / مرتجعة</p>
          <p className="mt-2 text-2xl font-black text-white">
            {stats.bouncedAmount.toLocaleString('en-GB', { minimumFractionDigits: 2 })} <span className="text-xs text-slate-400">₪</span>
          </p>
          <p className="mt-1 text-xs text-slate-400">{stats.bouncedCount} شيك</p>
        </div>
      </div>

      {/* ── Filters & Search ── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1.5">
          {[
            { id: 'all', label: 'الكل' },
            { id: 'in_portfolio', label: 'في الحافظة' },
            { id: 'deposited', label: 'برسم التحصيل' },
            { id: 'collected', label: 'محصل' },
            { id: 'bounced', label: 'راجع' },
            { id: 'endorsed', label: 'مجيّر' },
          ].map(st => (
            <button
              key={st.id}
              onClick={() => setStatusFilter(st.id)}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                statusFilter === st.id
                  ? 'bg-sky-500 text-slate-950 shadow-sm'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              {st.label}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-72">
          <input
            type="text"
            placeholder="بحث برقم الشيك، البنك، الساحب..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full rounded-xl border border-white/10 bg-slate-900 px-3.5 py-2 text-right text-xs text-white placeholder-slate-500 outline-none focus:border-sky-500"
          />
        </div>
      </div>

      {/* ── Cheques Table ── */}
      <div className="overflow-hidden rounded-2xl border border-white/10 bg-slate-900 shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead>
              <tr className="border-b border-white/10 bg-slate-800/60 text-slate-400">
                <th className="p-3.5 font-bold">رقم الشيك</th>
                <th className="p-3.5 font-bold">البنك والفرع (PMA)</th>
                <th className="p-3.5 font-bold">{activeTab === 'received' ? 'الساحب / العميل' : 'المستفيد / المورد'}</th>
                <th className="p-3.5 font-bold">المبلغ</th>
                <th className="p-3.5 font-bold">تاريخ الاستحقاق</th>
                <th className="p-3.5 font-bold">الحالة</th>
                <th className="p-3.5 font-bold">الصورة</th>
                <th className="p-3.5 text-center font-bold">الإجراءات والعمليات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 text-slate-200">
              {filteredChecks.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-slate-500">
                    لا توجد شيكات مطابقة للبحث أو التصفية الحالية
                  </td>
                </tr>
              ) : (
                filteredChecks.map(check => {
                  const st = STATUS_CONFIG[check.status] || {
                    label: check.status,
                    color: 'text-slate-400',
                    bg: 'bg-slate-800',
                    border: 'border-white/10',
                  }

                  const isOverdue =
                    new Date(check.due_date) < new Date() &&
                    ['in_portfolio', 'deposited'].includes(check.status)

                  return (
                    <tr key={check.id} className="hover:bg-slate-800/40 transition">
                      <td className="p-3.5 font-mono font-bold text-white">
                        <Link
                          href={`/dashboard/cheques/print/${check.id}`}
                          className="hover:text-sky-400 transition"
                          title="طباعة تفاصيل وسجل الشيك"
                        >
                          #{check.check_number}
                        </Link>
                      </td>

                      <td className="p-3.5">
                        <p className="font-semibold text-white">{check.bank_name}</p>
                        <p className="text-[11px] text-slate-400">{check.branch_name || 'الفرع الرئيسي'}</p>
                      </td>

                      <td className="p-3.5">
                        {activeTab === 'received' ? (
                          <div>
                            <p className="font-medium text-white">{check.drawer_name || check.customer?.name || '—'}</p>
                            {check.customer && <p className="text-[10px] text-sky-400">عميل: {check.customer.name}</p>}
                          </div>
                        ) : (
                          <div>
                            <p className="font-medium text-white">{check.payee_name || check.supplier?.name || '—'}</p>
                            {check.supplier && <p className="text-[10px] text-emerald-400">مورد: {check.supplier.name}</p>}
                          </div>
                        )}
                      </td>

                      <td className="p-3.5 font-bold text-white">
                        <div>
                          <span>{Number(check.amount).toLocaleString('en-GB', { minimumFractionDigits: 2 })}</span>{' '}
                          <span className="text-slate-400 text-[11px]">{check.currency}</span>
                        </div>
                        {check.currency !== 'ILS' && (
                          <div className="text-[10px] text-slate-400">
                            ≈ {Number(check.amount_ils).toLocaleString('en-GB', { minimumFractionDigits: 2 })} ₪
                          </div>
                        )}
                      </td>

                      <td className="p-3.5 font-mono">
                        <span className={isOverdue ? 'text-rose-400 font-bold' : 'text-slate-300'}>
                          {new Date(check.due_date).toLocaleDateString('en-GB')}
                        </span>
                        {isOverdue && <span className="mr-1 text-[10px] text-rose-400 font-bold">⚠️ مستحق</span>}
                      </td>

                      <td className="p-3.5">
                        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold border ${st.bg} ${st.color} ${st.border}`}>
                          {st.label}
                        </span>
                      </td>

                      <td className="p-3.5">
                        {check.images && check.images.length > 0 ? (
                          <button
                            onClick={() => {
                              setLightboxImage(check.images[0])
                              setLightboxCheck(check)
                            }}
                            className="group relative h-9 w-14 overflow-hidden rounded-lg border border-white/10 bg-slate-800"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={check.images[0]} alt="شيك" className="h-full w-full object-cover transition group-hover:scale-110" />
                          </button>
                        ) : (
                          <span className="text-slate-600 text-[11px]">بدون صورة</span>
                        )}
                      </td>

                      <td className="p-3.5 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          {/* Operations depending on status */}
                          {check.status === 'in_portfolio' && (
                            <>
                              <button
                                onClick={() => setShowOpModal({ check, opType: 'deposit' })}
                                className="rounded-lg bg-sky-500/10 px-2 py-1 text-[11px] font-bold text-sky-400 hover:bg-sky-500/20 transition"
                              >
                                إيداع
                              </button>
                              <button
                                onClick={() => setShowOpModal({ check, opType: 'collect' })}
                                className="rounded-lg bg-emerald-500/10 px-2 py-1 text-[11px] font-bold text-emerald-400 hover:bg-emerald-500/20 transition"
                              >
                                تحصيل
                              </button>
                              {check.type === 'received' && (
                                <button
                                  onClick={() => setShowOpModal({ check, opType: 'endorse' })}
                                  className="rounded-lg bg-purple-500/10 px-2 py-1 text-[11px] font-bold text-purple-400 hover:bg-purple-500/20 transition"
                                >
                                  تظهير
                                </button>
                              )}
                            </>
                          )}

                          {check.status === 'deposited' && (
                            <>
                              <button
                                onClick={() => setShowOpModal({ check, opType: 'collect' })}
                                className="rounded-lg bg-emerald-500/10 px-2 py-1 text-[11px] font-bold text-emerald-400 hover:bg-emerald-500/20 transition"
                              >
                                تأكيد تحصيل
                              </button>
                              <button
                                onClick={() => setShowOpModal({ check, opType: 'bounce' })}
                                className="rounded-lg bg-rose-500/10 px-2 py-1 text-[11px] font-bold text-rose-400 hover:bg-rose-500/20 transition"
                              >
                                تسجيل ارتداد
                              </button>
                            </>
                          )}

                          {['in_portfolio', 'bounced'].includes(check.status) && (
                            <button
                              onClick={() => setShowOpModal({ check, opType: 'return' })}
                              className="rounded-lg bg-slate-700 px-2 py-1 text-[11px] font-bold text-slate-300 hover:bg-slate-600 transition"
                            >
                              إرجاع
                            </button>
                          )}

                          <Link
                            href={`/dashboard/cheques/print/${check.id}`}
                            className="rounded-lg border border-white/10 bg-white/5 p-1.5 text-slate-400 hover:text-white transition"
                            title="طباعة رسمية"
                          >
                            🖨️
                          </Link>
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Modal: إضافة شيك جديد ── */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="relative max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-white/10 bg-slate-900 p-6 shadow-2xl">
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <span>✍️</span> تسجيل شيك جديد
            </h2>

            {error && <div className="mt-3 rounded-xl bg-rose-500/10 border border-rose-500/20 p-3 text-xs text-rose-400">{error}</div>}

            <form onSubmit={handleCreateCheck} className="mt-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-300">نوع الشيك</label>
                  <select
                    value={formData.type}
                    onChange={e => setFormData({ ...formData, type: e.target.value as any })}
                    className="w-full rounded-xl border border-white/10 bg-slate-800 p-2.5 text-xs text-white outline-none focus:border-sky-500"
                  >
                    <option value="received">مقبوض (وارد من عميل)</option>
                    <option value="issued">صادر (لمورد / دفع)</option>
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-300">رقم الشيك *</label>
                  <input
                    type="text"
                    required
                    value={formData.check_number}
                    onChange={e => setFormData({ ...formData, check_number: e.target.value })}
                    placeholder="مثال: 0045892"
                    className="w-full rounded-xl border border-white/10 bg-slate-800 p-2.5 text-xs text-white outline-none focus:border-sky-500 font-mono"
                  />
                </div>
              </div>

              {/* PMA Bank Directory Fast Recognition */}
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

              {/* Amount, Currency & Tafqeet */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-300">المبلغ *</label>
                  <input
                    type="number"
                    step="any"
                    required
                    value={formData.amount}
                    onChange={e => setFormData({ ...formData, amount: e.target.value })}
                    placeholder="0.00"
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

                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-300">سعر الصرف (للشيكل)</label>
                  <input
                    type="number"
                    step="any"
                    disabled={formData.currency === 'ILS'}
                    value={formData.currency === 'ILS' ? 1.0 : formData.exchange_rate}
                    onChange={e => setFormData({ ...formData, exchange_rate: Number(e.target.value) })}
                    className="w-full rounded-xl border border-white/10 bg-slate-800 p-2.5 text-xs text-white outline-none focus:border-sky-500 font-mono disabled:opacity-50"
                  />
                </div>
              </div>

              {/* Tafqeet Preview */}
              {Number(formData.amount) > 0 && (
                <div className="rounded-xl bg-sky-500/10 border border-sky-500/20 p-3 text-xs text-sky-300 font-medium">
                  ✍️ فقط {tafqeet(Number(formData.amount), formData.currency)} لا غير.
                </div>
              )}

              {/* Dates */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-300">تاريخ الاستحقاق *</label>
                  <input
                    type="date"
                    required
                    value={formData.due_date}
                    onChange={e => setFormData({ ...formData, due_date: e.target.value })}
                    className="w-full rounded-xl border border-white/10 bg-slate-800 p-2.5 text-xs text-white outline-none focus:border-sky-500"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-300">تاريخ التحرير</label>
                  <input
                    type="date"
                    value={formData.issue_date}
                    onChange={e => setFormData({ ...formData, issue_date: e.target.value })}
                    className="w-full rounded-xl border border-white/10 bg-slate-800 p-2.5 text-xs text-white outline-none focus:border-sky-500"
                  />
                </div>
              </div>

              {/* Names & References */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-300">اسم الساحب (صاحب الشيك)</label>
                  <input
                    type="text"
                    value={formData.drawer_name}
                    onChange={e => setFormData({ ...formData, drawer_name: e.target.value })}
                    placeholder="اسم الشخص أو الشركة الساحبة"
                    className="w-full rounded-xl border border-white/10 bg-slate-800 p-2.5 text-xs text-white outline-none focus:border-sky-500"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-300">اسم المستفيد</label>
                  <input
                    type="text"
                    value={formData.payee_name}
                    onChange={e => setFormData({ ...formData, payee_name: e.target.value })}
                    placeholder="اسم المستفيد"
                    className="w-full rounded-xl border border-white/10 bg-slate-800 p-2.5 text-xs text-white outline-none focus:border-sky-500"
                  />
                </div>
              </div>

              {/* Customer / Supplier selection */}
              {formData.type === 'received' ? (
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-300">العميل المرتبط (اختياري)</label>
                  <select
                    value={formData.customer_id}
                    onChange={e => setFormData({ ...formData, customer_id: e.target.value })}
                    className="w-full rounded-xl border border-white/10 bg-slate-800 p-2.5 text-xs text-white outline-none focus:border-sky-500"
                  >
                    <option value="">بدون ربط بعميل محدد</option>
                    {customers.map(c => (
                      <option key={c.id} value={c.id}>
                        {c.name} {c.phone ? `(${c.phone})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-300">المورد المرتبط (اختياري)</label>
                  <select
                    value={formData.supplier_id}
                    onChange={e => setFormData({ ...formData, supplier_id: e.target.value })}
                    className="w-full rounded-xl border border-white/10 bg-slate-800 p-2.5 text-xs text-white outline-none focus:border-sky-500"
                  >
                    <option value="">بدون ربط بمورد محدد</option>
                    {suppliers.map(s => (
                      <option key={s.id} value={s.id}>
                        {s.name} {s.phone ? `(${s.phone})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Upload Cheque Images */}
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-300">صور الشيك (وجه / ظهر)</label>
                <input
                  type="file"
                  multiple
                  accept="image/*"
                  onChange={e => {
                    if (e.target.files) {
                      setFormData({ ...formData, imageFiles: Array.from(e.target.files) })
                    }
                  }}
                  className="w-full rounded-xl border border-dashed border-white/20 bg-slate-800/50 p-3 text-xs text-slate-400 file:mr-3 file:rounded-lg file:border-0 file:bg-sky-500 file:px-3 file:py-1 file:text-xs file:font-bold file:text-slate-950 hover:file:bg-sky-400"
                />
              </div>

              {/* Notes */}
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-300">ملاحظات إضافية</label>
                <textarea
                  rows={2}
                  value={formData.notes}
                  onChange={e => setFormData({ ...formData, notes: e.target.value })}
                  className="w-full rounded-xl border border-white/10 bg-slate-800 p-2.5 text-xs text-white outline-none focus:border-sky-500"
                />
              </div>

              {/* Modal Buttons */}
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
                  {loading ? 'جارٍ الحفظ...' : 'حفظ وإدراج في الحافظة'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Modal: تنفيذ عملية على الشيك ── */}
      {showOpModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-white/10 bg-slate-900 p-6 shadow-2xl">
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <span>⚡</span> تنفيذ عملية:{' '}
              {showOpModal.opType === 'deposit' && 'إيداع الشيك برسم التحصيل'}
              {showOpModal.opType === 'collect' && 'تحصيل الشيك في الحساب البنكي'}
              {showOpModal.opType === 'bounce' && 'تسجيل ارتداد / شيك راجع'}
              {showOpModal.opType === 'endorse' && 'تظهير الشيك لمورد'}
              {showOpModal.opType === 'return' && 'إرجاع الشيك'}
            </h2>

            <div className="mt-3 rounded-xl bg-slate-800 p-3 text-xs space-y-1">
              <p><span className="text-slate-400">رقم الشيك:</span> <span className="font-mono text-white">#{showOpModal.check.check_number}</span></p>
              <p><span className="text-slate-400">البنك:</span> <span className="text-white">{showOpModal.check.bank_name} ({showOpModal.check.branch_name})</span></p>
              <p><span className="text-slate-400">المبلغ:</span> <span className="font-bold text-sky-400">{Number(showOpModal.check.amount).toLocaleString('en-GB', { minimumFractionDigits: 2 })} {showOpModal.check.currency}</span></p>
            </div>

            {error && <div className="mt-3 rounded-xl bg-rose-500/10 border border-rose-500/20 p-3 text-xs text-rose-400">{error}</div>}

            <form onSubmit={handleExecuteOperation} className="mt-4 space-y-4">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-300">تاريخ العملية</label>
                <input
                  type="date"
                  required
                  value={opData.date}
                  onChange={e => setOpData({ ...opData, date: e.target.value })}
                  className="w-full rounded-xl border border-white/10 bg-slate-800 p-2.5 text-xs text-white outline-none focus:border-sky-500"
                />
              </div>

              {['deposit', 'collect'].includes(showOpModal.opType) && (
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-300">الحساب البنكي المستهدف *</label>
                  <select
                    required
                    value={opData.target_bank_account_id}
                    onChange={e => setOpData({ ...opData, target_bank_account_id: e.target.value })}
                    className="w-full rounded-xl border border-white/10 bg-slate-800 p-2.5 text-xs text-white outline-none focus:border-sky-500"
                  >
                    {bankAccounts.length === 0 ? (
                      <option value="">لا توجد حسابات بنكية معرفة (يرجى إضافة حساب بنكي أولاً)</option>
                    ) : (
                      bankAccounts.map(b => (
                        <option key={b.id} value={b.id}>
                          {b.bank_name} — {b.branch_name} ({b.account_number}) [{b.currency}]
                        </option>
                      ))
                    )}
                  </select>
                </div>
              )}

              {showOpModal.opType === 'endorse' && (
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-300">المورد المجيّر له *</label>
                  <select
                    required
                    value={opData.target_supplier_id}
                    onChange={e => setOpData({ ...opData, target_supplier_id: e.target.value })}
                    className="w-full rounded-xl border border-white/10 bg-slate-800 p-2.5 text-xs text-white outline-none focus:border-sky-500"
                  >
                    {suppliers.map(s => (
                      <option key={s.id} value={s.id}>
                        {s.name} {s.phone ? `(${s.phone})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-300">ملاحظات وبيان العملية</label>
                <textarea
                  rows={2}
                  value={opData.notes}
                  onChange={e => setOpData({ ...opData, notes: e.target.value })}
                  placeholder="سبب الارتداد أو تفاصيل إضافية..."
                  className="w-full rounded-xl border border-white/10 bg-slate-800 p-2.5 text-xs text-white outline-none focus:border-sky-500"
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowOpModal(null)}
                  className="flex-1 rounded-xl border border-white/10 py-2.5 text-xs font-bold text-slate-400 hover:bg-slate-800 transition"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 rounded-xl bg-sky-500 py-2.5 text-xs font-bold text-slate-950 hover:bg-sky-400 transition disabled:opacity-50"
                >
                  {loading ? 'جارٍ المعالجة...' : 'تأكيد العملية'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Image Lightbox Modal ── */}
      {lightboxImage && (
        <div
          onClick={() => {
            setLightboxImage(null)
            setLightboxCheck(null)
          }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4 backdrop-blur-md"
        >
          <div
            onClick={e => e.stopPropagation()}
            className="relative max-h-[92vh] max-w-4xl overflow-hidden rounded-2xl border border-white/20 bg-slate-950 p-4 shadow-2xl flex flex-col"
          >
            <div className="flex items-center justify-between pb-3 border-b border-white/10 mb-3 text-white">
              <div className="flex items-center gap-3">
                <span className="text-base font-bold">
                  {lightboxCheck ? `شيك رقم #${lightboxCheck.check_number} (${lightboxCheck.bank_name})` : 'صورة الشيك'}
                </span>
                {lightboxCheck && (
                  <span className="rounded-lg bg-white/10 px-2.5 py-0.5 text-xs font-mono font-bold text-sky-400">
                    {Number(lightboxCheck.amount).toLocaleString('ar-u-nu-latn')} {lightboxCheck.currency}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                {lightboxCheck && (
                  <Link
                    href={`/dashboard/cheques/print/${lightboxCheck.id}`}
                    target="_blank"
                    className="flex items-center gap-1.5 rounded-lg bg-sky-500 px-3 py-1.5 text-xs font-bold text-slate-950 hover:bg-sky-400 transition"
                  >
                    <span>🖨️</span> طباعة بطاقة ومستند الشيك
                  </Link>
                )}
                <button
                  onClick={() => {
                    setLightboxImage(null)
                    setLightboxCheck(null)
                  }}
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-800 text-white font-bold hover:bg-rose-600 transition"
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="overflow-auto max-h-[75vh] flex items-center justify-center bg-black/50 rounded-xl p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={lightboxImage} alt="صورة الشيك بالحجم الكامل" className="max-h-[70vh] w-auto rounded-lg object-contain shadow-lg" />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
