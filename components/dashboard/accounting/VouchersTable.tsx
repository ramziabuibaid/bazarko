'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useToast } from '@/components/ui/Toast'
import { useConfirm } from '@/components/ui/Confirm'
import { createVoucher, deleteVoucher, getCustomerOpenInvoices, getSupplierOpenPurchases, ChequeItem } from '@/app/dashboard/accounting/vouchers/voucher-actions'
import { PALESTINIAN_BANKS } from '@/lib/palestineBanks'

interface Customer {
  id: string
  name: string
  phone: string | null
  balance?: number
}

interface Supplier {
  id: string
  name: string
  phone: string | null
  balance?: number
}

interface CashBox {
  id: string
  name: string
  type?: string
  is_default?: boolean
  is_active?: boolean
}

interface BankAccount {
  id: string
  bank_name: string
  account_number: string
  currency: string
}

interface Voucher {
  id: string
  voucher_number: string
  type: string
  date: string
  amount: number
  cash_amount?: number
  checks_amount?: number
  checks_data?: any[]
  party_name: string | null
  customer_id: string | null
  supplier_id?: string | null
  invoice_id?: string | null
  invoices?: any
  purchase_invoices?: any
  cash_boxes?: any
  payment_method: string
  category: string | null
  description: string
  reference: string | null
  cash_box_id?: string | null
  bank_account_id?: string | null
}

interface Props {
  vouchers: Voucher[]
  type: 'receipt' | 'payment'
  storeId: string
  userId: string
  currencyCode: string
  customers: Customer[]
  suppliers?: Supplier[]
  cashBoxes?: CashBox[]
  bankAccounts?: BankAccount[]
  storeName?: string
  storePhone?: string
}

const RECEIPT_CATEGORIES = ['مبيعات', 'دفعة زبون', 'استرداد', 'إيرادات أخرى', 'دفعة مقدمة']
const PAYMENT_CATEGORIES = ['مشتريات', 'إيجار', 'رواتب', 'مصاريف تشغيل', 'فواتير ومرافق', 'توصيل وشحن', 'تسويق وإعلان', 'أخرى']

export default function VouchersTable({
  vouchers,
  type,
  storeId,
  currencyCode,
  customers,
  suppliers = [],
  cashBoxes = [],
  bankAccounts = [],
  storeName,
}: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const toast = useToast()
  const confirm = useConfirm()

  const isReceipt = type === 'receipt'
  const categories = isReceipt ? RECEIPT_CATEGORIES : PAYMENT_CATEGORIES

  // Modal State
  const [showModal, setShowModal] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (searchParams?.get('new') === '1') {
      setShowModal(true)
    }
  }, [searchParams])

  // Form Fields
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'cheque' | 'split' | 'bank'>('cash')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('')
  const [reference, setReference] = useState('')

  // Cash Details
  const defaultCashBox = cashBoxes.find(b => b.is_default) || cashBoxes[0]
  const [selectedCashBoxId, setSelectedCashBoxId] = useState<string>(defaultCashBox?.id || '')
  const [cashAmountInput, setCashAmountInput] = useState('')

  // Bank Details
  const [selectedBankId, setSelectedBankId] = useState<string>(bankAccounts[0]?.id || '')

  // Cheques List Details
  const [cheques, setCheques] = useState<ChequeItem[]>([
    {
      check_number: '',
      account_number: '',
      bank_code: PALESTINIAN_BANKS[0].code,
      bank_name: PALESTINIAN_BANKS[0].name,
      branch_code: PALESTINIAN_BANKS[0].branches[0]?.code || '450',
      branch_name: PALESTINIAN_BANKS[0].branches[0]?.name || 'فرع رام الله الرئيسي',
      due_date: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
      date: new Date().toISOString().slice(0, 10),
      amount: 0,
      drawer_name: '',
      payee_name: '',
      notes: '',
    },
  ])

  // التبديل التلقائي لطريقة الدفع عند تغيير الصندوق
  const handleCashBoxChange = (boxId: string) => {
    setSelectedCashBoxId(boxId)
    const box = cashBoxes.find(b => b.id === boxId)
    if (box) {
      if (
        box.type === 'checks_received' ||
        box.type === 'checks_collection' ||
        box.type === 'checks_issued' ||
        box.name.includes('شيك')
      ) {
        setPaymentMethod('cheque')
      } else if (box.type === 'bank' || box.name.includes('بنك')) {
        setPaymentMethod('bank')
      } else if (paymentMethod === 'cheque') {
        setPaymentMethod('cash')
      }
    }
  }

  // اختيار الصندوق الملائم عند الضغط على طريقة الدفع
  const handlePaymentMethodChange = (method: 'cash' | 'cheque' | 'split' | 'bank') => {
    setPaymentMethod(method)
    if (method === 'cheque') {
      const chequeBox = cashBoxes.find(
        b =>
          b.type === 'checks_received' ||
          b.type === 'checks_collection' ||
          b.type === 'checks_issued' ||
          b.name.includes('شيك'),
      )
      if (chequeBox) setSelectedCashBoxId(chequeBox.id)
    } else if (method === 'cash') {
      const cashBox = cashBoxes.find(
        b =>
          b.type !== 'checks_received' &&
          b.type !== 'checks_collection' &&
          b.type !== 'checks_issued' &&
          !b.name.includes('شيك'),
      )
      if (cashBox) setSelectedCashBoxId(cashBox.id)
    }
  }

  // Party Selection
  const [partyMode, setPartyMode] = useState<'registered' | 'manual'>('registered')
  const [selectedCustomerId, setSelectedCustomerId] = useState('')
  const [selectedSupplierId, setSelectedSupplierId] = useState('')
  const [manualPartyName, setManualPartyName] = useState('')

  // Optional Invoice Decoupling
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string>('')
  const [openInvoices, setOpenInvoices] = useState<any[]>([])
  const [loadingInvoices, setLoadingInvoices] = useState(false)

  const [selectedPurchaseId, setSelectedPurchaseId] = useState<string>('')
  const [openPurchases, setOpenPurchases] = useState<any[]>([])
  const [loadingPurchases, setLoadingPurchases] = useState(false)

  // Search & Filter in Table
  const [searchQuery, setSearchQuery] = useState('')
  const [methodFilter, setMethodFilter] = useState('all')

  // Calculate sum of cheques
  const totalChequesAmount = useMemo(() => {
    return cheques.reduce((sum, c) => sum + (Number(c.amount) || 0), 0)
  }, [cheques])

  // Calculate effective total voucher amount
  const computedTotalAmount = useMemo(() => {
    if (paymentMethod === 'cash') {
      return Number(cashAmountInput) || 0
    }
    if (paymentMethod === 'cheque') {
      return totalChequesAmount
    }
    if (paymentMethod === 'split') {
      return (Number(cashAmountInput) || 0) + totalChequesAmount
    }
    if (paymentMethod === 'bank') {
      return Number(cashAmountInput) || 0
    }
    return 0
  }, [paymentMethod, cashAmountInput, totalChequesAmount])

  // Load customer open invoices when customer changes
  useEffect(() => {
    if (isReceipt && selectedCustomerId) {
      setLoadingInvoices(true)
      getCustomerOpenInvoices(selectedCustomerId).then(invs => {
        setOpenInvoices(invs)
        setSelectedInvoiceId('')
        setLoadingInvoices(false)
      })
    } else {
      setOpenInvoices([])
      setSelectedInvoiceId('')
    }
  }, [isReceipt, selectedCustomerId])

  // Load supplier open purchases when supplier changes
  useEffect(() => {
    if (!isReceipt && selectedSupplierId) {
      setLoadingPurchases(true)
      getSupplierOpenPurchases(selectedSupplierId).then(pi => {
        setOpenPurchases(pi)
        setSelectedPurchaseId('')
        setLoadingPurchases(false)
      })
    } else {
      setOpenPurchases([])
      setSelectedPurchaseId('')
    }
  }, [isReceipt, selectedSupplierId])

  // Auto-fill party name on cheque when party is chosen
  useEffect(() => {
    const activeName = isReceipt
      ? (customers.find(c => c.id === selectedCustomerId)?.name || manualPartyName)
      : (suppliers.find(s => s.id === selectedSupplierId)?.name || manualPartyName)

    if (activeName) {
      setCheques(prev => prev.map(c => ({
        ...c,
        drawer_name: isReceipt && !c.drawer_name ? activeName : c.drawer_name,
        payee_name: !isReceipt && !c.payee_name ? activeName : c.payee_name,
      })))
    }
  }, [selectedCustomerId, selectedSupplierId, manualPartyName, isReceipt, customers, suppliers])

  // Cheque list actions
  const addChequeRow = () => {
    const activeName = isReceipt
      ? (customers.find(c => c.id === selectedCustomerId)?.name || manualPartyName)
      : (suppliers.find(s => s.id === selectedSupplierId)?.name || manualPartyName)

    setCheques(prev => [
      ...prev,
      {
        check_number: '',
        account_number: '',
        bank_code: PALESTINIAN_BANKS[0].code,
        bank_name: PALESTINIAN_BANKS[0].name,
        branch_code: PALESTINIAN_BANKS[0].branches[0]?.code || '450',
        branch_name: PALESTINIAN_BANKS[0].branches[0]?.name || 'فرع رام الله الرئيسي',
        due_date: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
        date: new Date().toISOString().slice(0, 10),
        amount: 0,
        drawer_name: isReceipt ? activeName : '',
        payee_name: !isReceipt ? activeName : '',
        notes: '',
      },
    ])
  }

  const removeChequeRow = (index: number) => {
    if (cheques.length <= 1) return
    setCheques(prev => prev.filter((_, idx) => idx !== index))
  }

  const updateChequeRow = (index: number, field: keyof ChequeItem, val: any) => {
    setCheques(prev => prev.map((c, idx) => idx === index ? { ...c, [field]: val } : c))
  }

  const handleBankSelect = (index: number, bankCode: string) => {
    const pmaBank = PALESTINIAN_BANKS.find(b => b.code === bankCode)
    if (pmaBank) {
      setCheques(prev => prev.map((c, idx) => idx === index ? {
        ...c,
        bank_code: pmaBank.code,
        bank_name: pmaBank.name,
        branch_code: pmaBank.branches[0]?.code || '',
        branch_name: pmaBank.branches[0]?.name || '',
      } : c))
    }
  }

  const handleBranchSelect = (index: number, branchCode: string) => {
    const chk = cheques[index]
    const pmaBank = PALESTINIAN_BANKS.find(b => b.code === chk.bank_code || b.name === chk.bank_name)
    const branch = pmaBank?.branches.find(br => br.code === branchCode)
    if (branch) {
      setCheques(prev => prev.map((c, idx) => idx === index ? {
        ...c,
        branch_code: branch.code,
        branch_name: branch.name,
      } : c))
    }
  }

  // Reset Form
  const resetForm = () => {
    setDate(new Date().toISOString().slice(0, 10))
    setPaymentMethod('cash')
    setCashAmountInput('')
    setDescription('')
    setCategory('')
    setReference('')
    setSelectedCustomerId('')
    setSelectedSupplierId('')
    setManualPartyName('')
    setSelectedInvoiceId('')
    setSelectedPurchaseId('')
    setPartyMode('registered')
    setError('')
    setCheques([
      {
        check_number: '',
        bank_code: PALESTINIAN_BANKS[0].code,
        bank_name: PALESTINIAN_BANKS[0].name,
        branch_code: PALESTINIAN_BANKS[0].branches[0]?.code || '450',
        branch_name: PALESTINIAN_BANKS[0].branches[0]?.name || 'فرع رام الله الرئيسي',
        amount: 0,
        due_date: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
        drawer_name: '',
        payee_name: '',
        notes: '',
      },
    ])
  }

  // Handle Submit
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    const totalAmt = computedTotalAmount
    if (totalAmt <= 0) {
      setError('يجب أن يكون إجمالي السند أكبر من صفر')
      return
    }

    if (!description.trim()) {
      setError('يرجى إدخال البيان / وصف السند')
      return
    }

    const partyName = isReceipt
      ? (partyMode === 'registered' ? customers.find(c => c.id === selectedCustomerId)?.name : manualPartyName.trim())
      : (partyMode === 'registered' ? suppliers.find(s => s.id === selectedSupplierId)?.name : manualPartyName.trim())

    if (!partyName) {
      setError(isReceipt ? 'يرجى تحديد العميل أو إدخال اسم الجهة' : 'يرجى تحديد المورد أو إدخال اسم المستفيد')
      return
    }

    // Validation for cheques
    if (paymentMethod === 'cheque' || paymentMethod === 'split') {
      if (cheques.length === 0) {
        setError('يرجى إدخال بيانات الشيكات')
        return
      }
      for (let i = 0; i < cheques.length; i++) {
        const c = cheques[i]
        if (!c.check_number.trim()) {
          setError(`الشيك رقم ${i + 1}: يرجى إدخال رقم الشيك`)
          return
        }
        if (!c.amount || Number(c.amount) <= 0) {
          setError(`الشيك رقم ${i + 1}: يرجى إدخال قيمة صحيحة للشيك`)
          return
        }
        if (!c.due_date) {
          setError(`الشيك رقم ${i + 1}: يرجى تحديد تاريخ الاستحقاق`)
          return
        }
      }
    }

    setSaving(true)

    try {
      const res = await createVoucher({
        type,
        date,
        payment_method: paymentMethod,
        amount: totalAmt,
        cash_amount: (paymentMethod === 'cash' || paymentMethod === 'split') ? (Number(cashAmountInput) || 0) : 0,
        checks_amount: (paymentMethod === 'cheque' || paymentMethod === 'split') ? totalChequesAmount : 0,
        cash_box_id: selectedCashBoxId || null,
        bank_account_id: paymentMethod === 'bank' ? selectedBankId : null,
        customer_id: isReceipt && partyMode === 'registered' ? selectedCustomerId : null,
        supplier_id: !isReceipt && partyMode === 'registered' ? selectedSupplierId : null,
        party_name: partyName,
        category: category || null,
        description: description.trim(),
        reference: reference.trim() || null,
        invoice_id: isReceipt && selectedInvoiceId ? selectedInvoiceId : null,
        purchase_invoice_id: !isReceipt && selectedPurchaseId ? selectedPurchaseId : null,
        checks: (paymentMethod === 'cheque' || paymentMethod === 'split')
          ? cheques.map(c => ({ ...c, date: c.date || date }))
          : [],
      })

      if (!res.success) {
        throw new Error(res.error || 'فشل حفظ السند')
      }

      toast(`تم حفظ سند ${isReceipt ? 'القبض' : 'الصرف'} بنجاح`)
      setShowModal(false)
      resetForm()
      router.refresh()
    } catch (err: any) {
      setError(err.message || 'حدث خطأ أثناء الحفظ')
    } finally {
      setSaving(false)
    }
  }

  // Handle Delete
  const handleDelete = async (v: Voucher) => {
    const ok = await confirm({
      title: `حذف سند ${isReceipt ? 'القبض' : 'الصرف'}`,
      message: `هل تريد بالتأكيد حذف السند (${v.voucher_number}) بمبلغ ${fmt(v.amount)} ${currencyCode}؟\nسيتم عكس أثر العملية تلقائياً على الصندوق، الشيكات، كشف الحساب، والفواتير المرتبطة.`,
      confirmLabel: 'حذف نهائي وتراجع مالي',
      danger: true,
    })

    if (!ok) return

    const res = await deleteVoucher(v.id)
    if (!res.success) {
      toast(res.error || 'تعذر حذف السند', 'error')
    } else {
      toast(`تم حذف السند ${v.voucher_number} وعكس أثره المالي بنجاح`)
      router.refresh()
    }
  }

  const fmt = (n: number) =>
    Number(n || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  // Filtered Vouchers
  const filteredVouchers = useMemo(() => {
    return vouchers.filter(v => {
      if (methodFilter !== 'all' && v.payment_method !== methodFilter) return false
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim()
        const num = v.voucher_number.toLowerCase()
        const party = (v.party_name || '').toLowerCase()
        const desc = (v.description || '').toLowerCase()
        return num.includes(q) || party.includes(q) || desc.includes(q)
      }
      return true
    })
  }, [vouchers, methodFilter, searchQuery])

  const totalFilteredAmount = useMemo(() => {
    return filteredVouchers.reduce((s, v) => s + Number(v.amount || 0), 0)
  }, [filteredVouchers])

  return (
    <div className="space-y-5">
      
      {/* ── Top Summary & Actions ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <p className="text-xs text-slate-400">
            {isReceipt ? '💵 إجمالي المقبوضات المسجلة' : '💸 إجمالي المدفوعات المسجلة'}
          </p>
          <p className={`text-2xl font-bold font-mono ${isReceipt ? 'text-sky-400' : 'text-rose-400'}`} dir="ltr">
            {fmt(totalFilteredAmount)} {currencyCode}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => { resetForm(); setShowModal(true) }}
            className={`flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-xs font-bold transition shadow-lg ${
              isReceipt
                ? 'bg-sky-500 text-slate-950 hover:bg-sky-400 shadow-sky-500/10'
                : 'bg-rose-500 text-white hover:bg-rose-400 shadow-rose-500/10'
            }`}
          >
            <span>➕</span>
            <span>{isReceipt ? 'سند قبض جديد' : 'سند صرف جديد'}</span>
          </button>
        </div>
      </div>

      {/* ── Filters Bar ── */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 rounded-2xl border border-white/10 bg-slate-900 p-3">
        {/* Method tabs */}
        <div className="flex flex-wrap gap-1">
          <button
            onClick={() => setMethodFilter('all')}
            className={`rounded-xl px-3 py-1.5 text-xs font-bold transition ${
              methodFilter === 'all'
                ? 'bg-sky-500 text-slate-950'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            الكل ({vouchers.length})
          </button>
          <button
            onClick={() => setMethodFilter('cash')}
            className={`rounded-xl px-3 py-1.5 text-xs font-bold transition ${
              methodFilter === 'cash'
                ? 'bg-emerald-500 text-slate-950'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            💵 نقدي
          </button>
          <button
            onClick={() => setMethodFilter('cheque')}
            className={`rounded-xl px-3 py-1.5 text-xs font-bold transition ${
              methodFilter === 'cheque'
                ? 'bg-purple-500 text-white'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            📑 شيكات
          </button>
          <button
            onClick={() => setMethodFilter('split')}
            className={`rounded-xl px-3 py-1.5 text-xs font-bold transition ${
              methodFilter === 'split'
                ? 'bg-amber-500 text-slate-950'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            💵+📑 نقدي وشيكات
          </button>
          <button
            onClick={() => setMethodFilter('bank')}
            className={`rounded-xl px-3 py-1.5 text-xs font-bold transition ${
              methodFilter === 'bank'
                ? 'bg-blue-500 text-white'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            🏛️ بنك
          </button>
        </div>

        {/* Search */}
        <div className="relative w-full sm:w-64">
          <input
            type="text"
            placeholder="🔍 بحث برقم السند، الجهة، البيان..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full rounded-xl border border-white/10 bg-slate-800 px-3.5 py-1.5 text-right text-xs text-white placeholder-slate-500 outline-none focus:border-sky-500"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-white"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* ── Vouchers Table ── */}
      <div className="overflow-hidden rounded-2xl border border-white/10 bg-slate-900 shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead>
              <tr className="border-b border-white/10 bg-slate-800/80 text-slate-400 font-bold">
                <th className="p-3.5">رقم السند</th>
                <th className="p-3.5">التاريخ</th>
                <th className="p-3.5">{isReceipt ? 'المستلم منه (العميل)' : 'المستفيد (المورد)'}</th>
                <th className="p-3.5">طريقة الدفع والقبض</th>
                <th className="p-3.5">الفاتورة المرتبطة</th>
                <th className="p-3.5">البيان / الوصف</th>
                <th className="p-3.5">المبلغ الإجمالي</th>
                <th className="p-3.5 text-center">الإجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 text-slate-200">
              {filteredVouchers.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-10 text-center text-slate-500">
                    لا توجد سندات مطابقة للبحث أو الفلتر
                  </td>
                </tr>
              ) : (
                filteredVouchers.map(v => {
                  const hasChecks = v.payment_method === 'cheque' || v.payment_method === 'split'
                  const checksCount = v.checks_data?.length || 0

                  return (
                    <tr key={v.id} className="hover:bg-slate-800/40 transition">
                      <td className="p-3.5 font-mono font-bold text-sky-400 whitespace-nowrap" dir="ltr">
                        {v.voucher_number}
                      </td>

                      <td className="p-3.5 font-mono text-slate-400 whitespace-nowrap">
                        {v.date}
                      </td>

                      <td className="p-3.5 font-bold text-white">
                        {v.party_name || '—'}
                      </td>

                      {/* Payment method badge with breakdown */}
                      <td className="p-3.5">
                        {(() => {
                          const boxName = Array.isArray(v.cash_boxes) ? v.cash_boxes[0]?.name : v.cash_boxes?.name
                          if (v.payment_method === 'cash') {
                            return (
                              <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 text-[11px] font-bold text-emerald-400">
                                💵 نقداً {boxName ? `(${boxName})` : ''}
                              </span>
                            )
                          }
                          if (v.payment_method === 'cheque') {
                            return (
                              <span className="inline-flex items-center gap-1 rounded-md bg-purple-500/10 border border-purple-500/20 px-2 py-0.5 text-[11px] font-bold text-purple-400">
                                📑 شيكات ({checksCount > 0 ? `${checksCount} شيك` : 'شيك'})
                              </span>
                            )
                          }
                          if (v.payment_method === 'split') {
                            return (
                              <div className="space-y-0.5">
                                <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 text-[10px] font-bold text-amber-400">
                                  💵+📑 نقدي وشيكات
                                </span>
                                <div className="text-[10px] text-slate-400 font-mono" dir="ltr">
                                  نقدي: {fmt(v.cash_amount || 0)} | شيكات: {fmt(v.checks_amount || 0)}
                                </div>
                              </div>
                            )
                          }
                          return (
                            <span className="inline-flex items-center gap-1 rounded-md bg-blue-500/10 border border-blue-500/20 px-2 py-0.5 text-[11px] font-bold text-blue-400">
                              🏛️ تحويل بنكي
                            </span>
                          )
                        })()}
                      </td>

                      {/* Linked Invoice */}
                      <td className="p-3.5">
                        {(() => {
                          const invNum = Array.isArray(v.invoices) ? v.invoices[0]?.invoice_number : v.invoices?.invoice_number
                          const pInvNum = Array.isArray(v.purchase_invoices) ? v.purchase_invoices[0]?.invoice_number : v.purchase_invoices?.invoice_number
                          if (invNum) {
                            return (
                              <span className="inline-flex items-center gap-1 rounded-md bg-sky-500/10 border border-sky-500/20 px-2 py-0.5 text-[11px] font-mono font-bold text-sky-300">
                                🔗 فاتورة: {invNum}
                              </span>
                            )
                          }
                          if (pInvNum) {
                            return (
                              <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 text-[11px] font-mono font-bold text-amber-300">
                                🔗 شراء: {pInvNum}
                              </span>
                            )
                          }
                          return (
                            <span className="text-[11px] text-slate-500">
                              — قيد عام بالحساب
                            </span>
                          )
                        })()}
                      </td>

                      <td className="p-3.5 text-slate-300 max-w-xs truncate">
                        {v.description}
                      </td>

                      <td className="p-3.5 font-mono font-bold text-white text-sm" dir="ltr">
                        {fmt(v.amount)}{' '}
                        <span className="text-xs text-slate-400">{currencyCode}</span>
                      </td>

                      {/* Actions */}
                      <td className="p-3.5 text-center whitespace-nowrap">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            type="button"
                            title="طباعة السند رسمياً كـ PDF"
                            onClick={() => window.open(`/dashboard/accounting/${isReceipt ? 'receipts' : 'payments'}/print/${v.id}`, '_blank')}
                            className="rounded-lg border border-white/10 bg-slate-800 p-1.5 text-slate-300 hover:text-white hover:bg-slate-700 transition"
                          >
                            🖨️
                          </button>

                          <button
                            type="button"
                            title="حذف السند وعكس الأثر المالي"
                            onClick={() => handleDelete(v)}
                            className="rounded-lg border border-rose-500/20 bg-rose-500/10 p-1.5 text-rose-400 hover:bg-rose-500 hover:text-white transition"
                          >
                            🗑️
                          </button>
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

      {/* ── Modal: Create Voucher (Receipt / Payment) ── */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="relative max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-white/10 bg-slate-900 p-6 shadow-2xl">
            
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-white/10 pb-4">
              <div>
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                  <span>{isReceipt ? '💵 إنشاء سند قبض مالي جديد' : '💸 إنشاء سند صرف مالي جديد'}</span>
                </h2>
                <p className="mt-1 text-xs text-slate-400">
                  {isReceipt
                    ? 'تسجيل مقبوضات نقدية أو شيكات مع الربط الاختياري بفواتير المبيعات'
                    : 'تسجيل مدفوعات نقدية أو شيكات للموردين أو المصاريف مع الربط الاختياري بفواتير الشراء'}
                </p>
              </div>
              <button
                onClick={() => setShowModal(false)}
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
              
              {/* 1. وسيلة الدفع / القبض */}
              <div>
                <label className="mb-2 block text-xs font-semibold text-slate-300">
                  نوع وسيلة {isReceipt ? 'القبض' : 'الصرف'} *
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <button
                    type="button"
                    onClick={() => handlePaymentMethodChange('cash')}
                    className={`flex items-center justify-center gap-1.5 rounded-xl border p-2.5 text-xs font-bold transition ${
                      paymentMethod === 'cash'
                        ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400'
                        : 'bg-slate-800 border-white/5 text-slate-400 hover:text-white'
                    }`}
                  >
                    <span>💵</span>
                    <span>نقدي فقط</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handlePaymentMethodChange('cheque')}
                    className={`flex items-center justify-center gap-1.5 rounded-xl border p-2.5 text-xs font-bold transition ${
                      paymentMethod === 'cheque'
                        ? 'bg-purple-500/20 border-purple-500 text-purple-400'
                        : 'bg-slate-800 border-white/5 text-slate-400 hover:text-white'
                    }`}
                  >
                    <span>📑</span>
                    <span>شيكات فقط</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handlePaymentMethodChange('split')}
                    className={`flex items-center justify-center gap-1.5 rounded-xl border p-2.5 text-xs font-bold transition ${
                      paymentMethod === 'split'
                        ? 'bg-amber-500/20 border-amber-500 text-amber-400'
                        : 'bg-slate-800 border-white/5 text-slate-400 hover:text-white'
                    }`}
                  >
                    <span>💵+📑</span>
                    <span>نقدي + شيكات</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handlePaymentMethodChange('bank')}
                    className={`flex items-center justify-center gap-1.5 rounded-xl border p-2.5 text-xs font-bold transition ${
                      paymentMethod === 'bank'
                        ? 'bg-blue-500/20 border-blue-500 text-blue-400'
                        : 'bg-slate-800 border-white/5 text-slate-400 hover:text-white'
                    }`}
                  >
                    <span>🏛️</span>
                    <span>تحويل بنكي</span>
                  </button>
                </div>
              </div>

              {/* 1.1 الصندوق / الخزينة المحددة للعملية حسب الصلاحيات */}
              <div className="rounded-xl border border-white/10 bg-slate-800/60 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-white flex items-center gap-1.5">
                    <span>🏦</span> تحديد الصندوق لتسجيل السند ({isReceipt ? 'صندوق القبض' : 'صندوق الصرف'}) *
                  </label>
                  <span className="text-[10px] text-slate-400">
                    {cashBoxes.length > 0 ? `${cashBoxes.length} صندوق مصرح لك باستخدامه` : 'لا توجد صناديق متاحة'}
                  </span>
                </div>

                {cashBoxes.length === 0 ? (
                  <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-2.5 text-xs text-red-400">
                    ⚠️ ليس لديك صلاحية على أي صندوق {isReceipt ? 'قبض' : 'صرف'} مسجل في هذا المتجر. يرجى التواصل مع إدارة النظام لفتح الصلاحية.
                  </div>
                ) : (
                  <select
                    value={selectedCashBoxId}
                    onChange={e => handleCashBoxChange(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-slate-900 p-2.5 text-xs text-white font-bold outline-none focus:border-sky-500"
                  >
                    {cashBoxes.map(b => (
                      <option key={b.id} value={b.id}>
                        {b.type === 'checks_received' || b.type === 'checks_collection' || b.type === 'checks_issued' || b.name.includes('شيك')
                          ? `📑 ${b.name} (صندوق شيكات)`
                          : b.type === 'bank' || b.name.includes('بنك')
                          ? `🏦 ${b.name} (حساب بنكي)`
                          : `💵 ${b.name} (صندوق نقدي)`}
                        {b.is_default ? ' [الافتراضي]' : ''}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* 2. التاريخ والتصنيف */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-300">تاريخ السند *</label>
                  <input
                    type="date"
                    required
                    value={date}
                    onChange={e => setDate(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-slate-800 p-2.5 text-xs text-white outline-none focus:border-sky-500"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-300">التصنيف المحاسبي</label>
                  <select
                    value={category}
                    onChange={e => setCategory(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-slate-800 p-2.5 text-xs text-white outline-none focus:border-sky-500"
                  >
                    <option value="">-- اختياري --</option>
                    {categories.map(cat => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* 3. الجهة المستلم منها / المستفيد */}
              <div className="rounded-xl border border-white/10 bg-slate-800/40 p-3.5 space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-white">
                    {isReceipt ? 'العميل / المستلم منه *' : 'المورد / المستفيد *'}
                  </label>
                  <div className="flex items-center gap-2 text-xs">
                    <button
                      type="button"
                      onClick={() => setPartyMode('registered')}
                      className={`px-2.5 py-0.5 rounded-md font-semibold transition ${
                        partyMode === 'registered' ? 'bg-sky-500 text-slate-950' : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      {isReceipt ? 'عميل مسجل' : 'مورد مسجل'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setPartyMode('manual')}
                      className={`px-2.5 py-0.5 rounded-md font-semibold transition ${
                        partyMode === 'manual' ? 'bg-sky-500 text-slate-950' : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      جهة أخرى / يدوي
                    </button>
                  </div>
                </div>

                {partyMode === 'registered' ? (
                  isReceipt ? (
                    <div>
                      <select
                        value={selectedCustomerId}
                        onChange={e => setSelectedCustomerId(e.target.value)}
                        className="w-full rounded-xl border border-white/10 bg-slate-800 p-2.5 text-xs text-white outline-none focus:border-sky-500 font-bold"
                      >
                        <option value="">-- اختر العميل من الدليل --</option>
                        {customers.map(c => (
                          <option key={c.id} value={c.id}>
                            {c.name} {c.phone ? `(${c.phone})` : ''} — الرصيد: {fmt(c.balance || 0)} {currencyCode}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <div>
                      <select
                        value={selectedSupplierId}
                        onChange={e => setSelectedSupplierId(e.target.value)}
                        className="w-full rounded-xl border border-white/10 bg-slate-800 p-2.5 text-xs text-white outline-none focus:border-sky-500 font-bold"
                      >
                        <option value="">-- اختر المورد من الدليل --</option>
                        {suppliers.map(s => (
                          <option key={s.id} value={s.id}>
                            {s.name} {s.phone ? `(${s.phone})` : ''} — الرصيد: {fmt(s.balance || 0)} {currencyCode}
                          </option>
                        ))}
                      </select>
                    </div>
                  )
                ) : (
                  <div>
                    <input
                      type="text"
                      required
                      value={manualPartyName}
                      onChange={e => setManualPartyName(e.target.value)}
                      placeholder={isReceipt ? 'اسم الشخص أو الجهة الدافعة...' : 'اسم الشخص أو الجهة المستفيدة...'}
                      className="w-full rounded-xl border border-white/10 bg-slate-800 p-2.5 text-xs text-white outline-none focus:border-sky-500"
                    />
                  </div>
                )}

                {/* ── الربط الاختياري بالفاتورة (11.1 - 11.4) ── */}
                {partyMode === 'registered' && isReceipt && selectedCustomerId && (
                  <div className="pt-2 border-t border-white/5">
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[11px] font-bold text-sky-300 flex items-center gap-1">
                        <span>🔗</span> الفاتورة المرتبطة (اختياري تماماً):
                      </label>
                      <span className="text-[10px] text-slate-400">
                        {loadingInvoices ? 'جارٍ التحقق من فواتير العميل...' : `${openInvoices.length} فاتورة غير مسددة`}
                      </span>
                    </div>

                    <select
                      value={selectedInvoiceId}
                      onChange={e => setSelectedInvoiceId(e.target.value)}
                      className="w-full rounded-xl border border-sky-500/30 bg-slate-800 p-2 text-xs text-white outline-none focus:border-sky-500"
                    >
                      <option value="">[اختياري] — بدون ربط بفاتورة (تسجيل دفعة عامة على كشف حساب العميل)</option>
                      {openInvoices.map(inv => (
                        <option key={inv.id} value={inv.id}>
                          فاتورة {inv.invoice_number} ({inv.issue_date}) — المتبقي: {fmt(inv.remaining)} {currencyCode} [الإجمالي: {fmt(inv.total)}]
                        </option>
                      ))}
                    </select>
                    <p className="mt-1 text-[10px] text-slate-400">
                      {selectedInvoiceId
                        ? '✓ سيتم تحديث حالة الفاتورة المختارة والمبلغ المدفوع منها تلقائياً بناءً على هذا السند.'
                        : '💡 عند عدم اختيار فاتورة محددة، يسجل القبض مباشرة كحركة دائنة في كشف حساب العميل لتخفيض رصيده.'}
                    </p>
                  </div>
                )}

                {partyMode === 'registered' && !isReceipt && selectedSupplierId && (
                  <div className="pt-2 border-t border-white/5">
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[11px] font-bold text-amber-300 flex items-center gap-1">
                        <span>🔗</span> فاتورة الشراء المرتبطة (اختياري تماماً):
                      </label>
                      <span className="text-[10px] text-slate-400">
                        {loadingPurchases ? 'جارٍ البحث...' : `${openPurchases.length} فاتورة شراء مفتوحة`}
                      </span>
                    </div>

                    <select
                      value={selectedPurchaseId}
                      onChange={e => setSelectedPurchaseId(e.target.value)}
                      className="w-full rounded-xl border border-amber-500/30 bg-slate-800 p-2 text-xs text-white outline-none focus:border-amber-500"
                    >
                      <option value="">[اختياري] — بدون ربط بفاتورة (تسجيل دفعة عامة على حساب المورد)</option>
                      {openPurchases.map(pi => (
                        <option key={pi.id} value={pi.id}>
                          فاتورة شراء {pi.invoice_number} ({pi.invoice_date}) — المتبقي: {fmt(pi.remaining)} {currencyCode}
                        </option>
                      ))}
                    </select>
                    <p className="mt-1 text-[10px] text-slate-400">
                      {selectedPurchaseId
                        ? '✓ سيتم تحديث حالة فاتورة الشراء والمبلغ المسدد منها تلقائياً.'
                        : '💡 عند عدم اختيار فاتورة، يسجل الصرف مباشرة في حساب المورد ويخفض ذمته.'}
                    </p>
                  </div>
                )}
              </div>

              {/* 4. تفاصيل النقدية (عند اختيار نقدي أو نقدي + شيكات) */}
              {(paymentMethod === 'cash' || paymentMethod === 'split') && (
                <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3.5 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-bold text-emerald-400 flex items-center gap-1">
                      <span>💵</span> تفاصيل المبلغ النقدي وحساب الصندوق
                    </h3>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-300">صندوق {isReceipt ? 'القبض' : 'الصرف'} *</label>
                      <select
                        value={selectedCashBoxId}
                        onChange={e => setSelectedCashBoxId(e.target.value)}
                        className="w-full rounded-xl border border-white/10 bg-slate-800 p-2.5 text-xs text-white outline-none focus:border-emerald-500"
                      >
                        {cashBoxes.map(b => (
                          <option key={b.id} value={b.id}>
                            {b.name} {b.is_default ? '(الافتراضي)' : ''}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-300">
                        {paymentMethod === 'split' ? 'المبلغ النقدي *' : 'المبلغ الإجمالي نقداً *'}
                      </label>
                      <div className="relative">
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          required
                          value={cashAmountInput}
                          onChange={e => setCashAmountInput(e.target.value)}
                          placeholder="0.00"
                          dir="ltr"
                          className="w-full rounded-xl border border-white/10 bg-slate-800 p-2.5 text-xs text-white outline-none focus:border-emerald-500 font-mono font-bold"
                        />
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 font-bold">
                          {currencyCode}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* 5. تفاصيل التحويل البنكي */}
              {paymentMethod === 'bank' && (
                <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-3.5 space-y-3">
                  <h3 className="text-xs font-bold text-blue-400 flex items-center gap-1">
                    <span>🏛️</span> الحساب البنكي والمبلغ
                  </h3>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-300">الحساب المصرفي *</label>
                      <select
                        value={selectedBankId}
                        onChange={e => setSelectedBankId(e.target.value)}
                        className="w-full rounded-xl border border-white/10 bg-slate-800 p-2.5 text-xs text-white outline-none focus:border-blue-500"
                      >
                        {bankAccounts.map(b => (
                          <option key={b.id} value={b.id}>
                            {b.bank_name} — {b.account_number} ({b.currency})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-300">المبلغ المحول *</label>
                      <div className="relative">
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          required
                          value={cashAmountInput}
                          onChange={e => setCashAmountInput(e.target.value)}
                          placeholder="0.00"
                          dir="ltr"
                          className="w-full rounded-xl border border-white/10 bg-slate-800 p-2.5 text-xs text-white outline-none focus:border-blue-500 font-mono font-bold"
                        />
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 font-bold">
                          {currencyCode}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* 6. تفاصيل الشيكات (عند اختيار شيكات أو نقدي + شيكات) */}
              {(paymentMethod === 'cheque' || paymentMethod === 'split') && (
                <div className="rounded-xl border border-purple-500/20 bg-purple-500/5 p-3.5 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-bold text-purple-300 flex items-center gap-1">
                      <span>📑</span> تفاصيل الشيكات المسجلة ({cheques.length} شيك)
                    </h3>
                    <button
                      type="button"
                      onClick={addChequeRow}
                      className="flex items-center gap-1 rounded-lg bg-purple-500/20 border border-purple-500/30 px-2.5 py-1 text-xs font-bold text-purple-300 hover:bg-purple-500 hover:text-white transition"
                    >
                      <span>⊕</span> إضافة شيك آخر
                    </button>
                  </div>

                  <div className="space-y-3">
                    {cheques.map((chk, idx) => (
                      <div key={idx} className="rounded-xl border border-white/10 bg-slate-800/80 p-3 space-y-2.5">
                        <div className="flex items-center justify-between text-xs font-bold text-slate-300 border-b border-white/5 pb-1.5">
                          <span>شيك رقم #{idx + 1}</span>
                          {cheques.length > 1 && (
                            <button
                              type="button"
                              onClick={() => removeChequeRow(idx)}
                              className="text-rose-400 hover:underline text-[11px]"
                            >
                              حذف هذا الشيك ✕
                            </button>
                          )}
                        </div>

                        {/* ── حقول بيانات الشيك بالترتيب الدقيق المطلوب (1 إلى 9) ── */}
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                          {/* 1. رقم الشيك */}
                          <div>
                            <label className="block text-[11px] font-bold text-sky-300 mb-0.5">
                              1. رقم الشيك *
                            </label>
                            <input
                              type="text"
                              required
                              value={chk.check_number}
                              onChange={e => updateChequeRow(idx, 'check_number', e.target.value)}
                              placeholder="مثال: 0012345"
                              dir="ltr"
                              className="w-full rounded-lg border border-white/10 bg-slate-900 p-2 text-xs text-white outline-none focus:border-purple-500 font-mono font-bold"
                            />
                          </div>

                          {/* 2. رقم الحساب */}
                          <div>
                            <label className="block text-[11px] font-bold text-sky-300 mb-0.5">
                              2. رقم الحساب *
                            </label>
                            <input
                              type="text"
                              value={chk.account_number || ''}
                              onChange={e => updateChequeRow(idx, 'account_number', e.target.value)}
                              placeholder="رقم حساب الساحب..."
                              dir="ltr"
                              className="w-full rounded-lg border border-white/10 bg-slate-900 p-2 text-xs text-white outline-none focus:border-purple-500 font-mono"
                            />
                          </div>

                          {/* 3 & 4. البنك المسحوب عليه حسب دليل سلطة النقد PMA */}
                          <div className="sm:col-span-2">
                            <label className="block text-[11px] font-bold text-sky-300 mb-0.5">
                              3. البنك المسحوب عليه (دليل سلطة النقد PMA) *
                            </label>
                            <select
                              required
                              value={chk.bank_code || ''}
                              onChange={e => handleBankSelect(idx, e.target.value)}
                              className="w-full rounded-lg border border-sky-500/30 bg-slate-900 p-2 text-xs text-white outline-none focus:border-sky-400 font-bold"
                            >
                              <option value="">-- اختر البنك من دليل سلطة النقد الفلسطيني --</option>
                              {PALESTINIAN_BANKS.map(b => (
                                <option key={b.code} value={b.code}>
                                  [{b.code}] {b.name} {b.nameEn ? `(${b.nameEn})` : ''}
                                </option>
                              ))}
                            </select>
                          </div>

                          {/* 5 & 6. فرع البنك */}
                          <div className="sm:col-span-2">
                            <label className="block text-[11px] font-bold text-sky-300 mb-0.5">
                              4. فرع البنك المسحوب عليه (PMA Branch)
                            </label>
                            {(() => {
                              const activeBank = PALESTINIAN_BANKS.find(b => b.code === chk.bank_code || b.name === chk.bank_name)
                              const branches = activeBank?.branches || []
                              return (
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                  <select
                                    value={chk.branch_code || ''}
                                    onChange={e => handleBranchSelect(idx, e.target.value)}
                                    className="w-full rounded-lg border border-white/10 bg-slate-900 p-2 text-xs text-white outline-none focus:border-purple-500"
                                  >
                                    <option value="">-- اختر الفرع --</option>
                                    {branches.map(br => (
                                      <option key={br.code} value={br.code}>
                                        [{br.code}] {br.name} {br.city ? `— ${br.city}` : ''}
                                      </option>
                                    ))}
                                    <option value="other">فرع آخر غير مدرج</option>
                                  </select>
                                  <input
                                    type="text"
                                    value={chk.branch_name || ''}
                                    onChange={e => updateChequeRow(idx, 'branch_name', e.target.value)}
                                    placeholder="اسم الفرع يدوياً إن لم يوجد..."
                                    className="w-full rounded-lg border border-white/10 bg-slate-900 p-2 text-xs text-white outline-none focus:border-purple-500"
                                  />
                                </div>
                              )
                            })()}
                          </div>

                          {/* 7. تاريخ الاستحقاق */}
                          <div>
                            <label className="block text-[11px] font-bold text-amber-300 mb-0.5">
                              7. تاريخ الاستحقاق *
                            </label>
                            <input
                              type="date"
                              required
                              value={chk.due_date}
                              onChange={e => updateChequeRow(idx, 'due_date', e.target.value)}
                              className="w-full rounded-lg border border-amber-500/30 bg-slate-900 p-2 text-xs text-white outline-none focus:border-amber-400 font-bold"
                            />
                          </div>

                          {/* 8. التاريخ */}
                          <div>
                            <label className="block text-[11px] font-bold text-sky-300 mb-0.5">
                              8. التاريخ (تاريخ تحرير الشيك) *
                            </label>
                            <input
                              type="date"
                              required
                              value={chk.date || date}
                              onChange={e => updateChequeRow(idx, 'date', e.target.value)}
                              className="w-full rounded-lg border border-white/10 bg-slate-900 p-2 text-xs text-white outline-none focus:border-purple-500 font-bold"
                            />
                          </div>

                          {/* 9. قيمة الشيك */}
                          <div>
                            <label className="block text-[11px] font-bold text-emerald-400 mb-0.5">
                              9. قيمة الشيك *
                            </label>
                            <div className="relative">
                              <input
                                type="number"
                                step="0.01"
                                min="0.01"
                                required
                                value={chk.amount || ''}
                                onChange={e => updateChequeRow(idx, 'amount', parseFloat(e.target.value) || 0)}
                                placeholder="0.00"
                                dir="ltr"
                                className="w-full rounded-lg border border-emerald-500/30 bg-slate-900 p-2 text-xs text-white outline-none focus:border-emerald-400 font-mono font-bold text-sm"
                              />
                              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] text-emerald-400 font-bold">
                                {currencyCode}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* اسم الساحب أو المستفيد */}
                        <div className="pt-1">
                          <label className="block text-[11px] font-semibold text-slate-400 mb-0.5">
                            {isReceipt ? 'اسم الساحب (صاحب الشيك المدون عليه)' : 'اسم المستفيد من الشيك'}
                          </label>
                          <input
                            type="text"
                            value={isReceipt ? chk.drawer_name : chk.payee_name}
                            onChange={e => updateChequeRow(idx, isReceipt ? 'drawer_name' : 'payee_name', e.target.value)}
                            placeholder="اختياري..."
                            className="w-full rounded-lg border border-white/10 bg-slate-900 p-2 text-xs text-white outline-none focus:border-purple-500"
                          />
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center justify-between border-t border-purple-500/20 pt-2 text-xs font-mono font-bold text-purple-300">
                    <span>إجمالي مبالغ الشيكات:</span>
                    <span dir="ltr">{fmt(totalChequesAmount)} {currencyCode}</span>
                  </div>
                </div>
              )}

              {/* 7. بطاقة ملخص المبالغ والتحقق (خصوصاً في حالة split) */}
              <div className="rounded-xl border border-sky-500/20 bg-sky-500/10 p-3.5 flex items-center justify-between">
                <div>
                  <span className="text-xs font-bold text-sky-300 block">إجمالي سند {isReceipt ? 'القبض' : 'الصرف'} النهائي:</span>
                  {paymentMethod === 'split' && (
                    <span className="text-[11px] text-slate-400 font-mono" dir="ltr">
                      (نقدي: {fmt(Number(cashAmountInput) || 0)} + شيكات: {fmt(totalChequesAmount)})
                    </span>
                  )}
                </div>
                <div className="text-right">
                  <span className="font-mono text-2xl font-bold text-sky-400" dir="ltr">
                    {fmt(computedTotalAmount)} {currencyCode}
                  </span>
                </div>
              </div>

              {/* 8. البيان والملاحظات والمرجع */}
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-300">البيان / الشرح التفصيلي *</label>
                <textarea
                  required
                  rows={2}
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder={isReceipt ? 'مثال: دفعة عن حساب الزبون نقداً وبشيك...' : 'مثال: سداد دفعة مورد / مصاريف إيجار...'}
                  className="w-full rounded-xl border border-white/10 bg-slate-800 p-2.5 text-xs text-white outline-none focus:border-sky-500 resize-none"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-300">رقم المرجع / ملاحظات داخلية (اختياري)</label>
                <input
                  type="text"
                  value={reference}
                  onChange={e => setReference(e.target.value)}
                  placeholder="مثال: رقم إيصال يدوي، رقم الحوالة، أو مرجع العقد"
                  className="w-full rounded-xl border border-white/10 bg-slate-800 p-2.5 text-xs text-white outline-none focus:border-sky-500"
                />
              </div>

              {/* Modal Actions */}
              <div className="flex gap-3 pt-3 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="flex-1 rounded-xl border border-white/10 py-2.5 text-xs font-bold text-slate-400 hover:bg-slate-800 transition"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={saving || computedTotalAmount <= 0}
                  className={`flex-1 rounded-xl py-2.5 text-xs font-bold transition disabled:opacity-50 ${
                    isReceipt
                      ? 'bg-sky-500 text-slate-950 hover:bg-sky-400'
                      : 'bg-rose-500 text-white hover:bg-rose-400'
                  }`}
                >
                  {saving ? 'جارٍ الحفظ...' : (isReceipt ? 'حفظ سند القبض' : 'حفظ سند الصرف')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
