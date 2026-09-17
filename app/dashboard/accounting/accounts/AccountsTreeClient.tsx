'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import BackToDashboardButton from '@/components/dashboard/BackToDashboardButton'
import AccountFormModal, { AccountItem } from '@/components/dashboard/accounting/AccountFormModal'
import AccountStatementModal from '@/components/dashboard/accounting/AccountStatementModal'
import { toggleAccountActive, deleteAccount } from '@/app/dashboard/accounting/accounts/account-actions'

interface EnrichedAccount extends AccountItem {
  total_debit?: number
  total_credit?: number
  movements_count?: number
  last_movement_date?: string | null
  calculated_balance?: number
}

interface Props {
  store: { id: string; name: string; currency_code: string }
  initialAccounts: EnrichedAccount[]
}

const TYPE_CONFIG: Record<string, { label: string; color: string; bg: string; icon: string }> = {
  asset: { label: 'الأصول (Assets)', color: 'text-sky-400', bg: 'bg-sky-500/10', icon: '🏛️' },
  liability: { label: 'الالتزامات (Liabilities)', color: 'text-rose-400', bg: 'bg-rose-500/10', icon: '💳' },
  equity: { label: 'حقوق الملكية (Equity)', color: 'text-purple-400', bg: 'bg-purple-500/10', icon: '🛡️' },
  revenue: { label: 'الإيرادات (Revenue)', color: 'text-emerald-400', bg: 'bg-emerald-500/10', icon: '📈' },
  expense: { label: 'المصروفات (Expenses)', color: 'text-amber-400', bg: 'bg-amber-500/10', icon: '📉' },
}

export default function AccountsTreeClient({ store, initialAccounts }: Props) {
  const router = useRouter()

  const [accounts, setAccounts] = useState<EnrichedAccount[]>(initialAccounts)
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(
    initialAccounts.length > 0 ? initialAccounts[0].id : null
  )

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedType, setSelectedType] = useState<string>('all')

  // Expanded nodes state: Set of account IDs
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(() => {
    // By default, expand top level accounts
    const initialExpanded = new Set<string>()
    initialAccounts.forEach(acc => {
      if (acc.is_group || acc.code.length <= 2 || !acc.parent_id) {
        initialExpanded.add(acc.id)
      }
    })
    return initialExpanded
  })

  // Modal States
  const [statementModalAcc, setStatementModalAcc] = useState<EnrichedAccount | null>(null)
  const [formModalState, setFormModalState] = useState<{
    open: boolean
    mode: 'create' | 'edit'
    initialData?: EnrichedAccount | null
    presetParentId?: string | null
    presetType?: AccountItem['type']
  }>({ open: false, mode: 'create' })

  // Action status
  const [actionLoading, setActionLoading] = useState(false)
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const showToast = (type: 'success' | 'error', text: string) => {
    setActionMessage({ type, text })
    setTimeout(() => setActionMessage(null), 5000)
  }

  // Find currently selected account
  const selectedAccount = useMemo(() => {
    return accounts.find(a => a.id === selectedAccountId) || null
  }, [accounts, selectedAccountId])

  // Map of children by parent_id
  const childrenMap = useMemo(() => {
    const map = new Map<string | null, EnrichedAccount[]>()
    accounts.forEach(acc => {
      const pid = acc.parent_id || null
      if (!map.has(pid)) map.set(pid, [])
      map.get(pid)!.push(acc)
    })
    // Sort each children group by code
    map.forEach(list => list.sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true })))
    return map
  }, [accounts])

  // Compute rolled-up balances for each account (including parents/groups)
  const rolledUpBalanceMap = useMemo(() => {
    const balanceMap = new Map<string, number>()

    const calculateBalance = (acc: EnrichedAccount): number => {
      const children = childrenMap.get(acc.id) || []
      if (children.length === 0) {
        const bal = acc.calculated_balance !== undefined ? acc.calculated_balance : (acc.balance || 0)
        balanceMap.set(acc.id, bal)
        return bal
      }
      // Sum children balances + own balance if any
      let sum = acc.calculated_balance || 0
      for (const child of children) {
        sum += calculateBalance(child)
      }
      balanceMap.set(acc.id, sum)
      return sum
    }

    // Run for all root level accounts
    accounts.forEach(acc => {
      if (!balanceMap.has(acc.id)) {
        calculateBalance(acc)
      }
    })

    return balanceMap
  }, [accounts, childrenMap])

  // Toggle node expansion
  const toggleNode = (nodeId: string) => {
    setExpandedNodes(prev => {
      const next = new Set(prev)
      if (next.has(nodeId)) {
        next.delete(nodeId)
      } else {
        next.add(nodeId)
      }
      return next
    })
  }

  // Expand all / Collapse all
  const expandAll = () => {
    const allIds = new Set(accounts.map(a => a.id))
    setExpandedNodes(allIds)
  }

  const collapseAll = () => {
    setExpandedNodes(new Set())
  }

  // Filter accounts when search or type filter is active
  const searchMatchedIds = useMemo(() => {
    if (!searchQuery.trim()) return null
    const q = searchQuery.toLowerCase().trim()
    const matches = new Set<string>()

    // Find accounts directly matching
    accounts.forEach(acc => {
      if (
        acc.code.toLowerCase().includes(q) ||
        acc.name.toLowerCase().includes(q) ||
        (acc.description && acc.description.toLowerCase().includes(q))
      ) {
        matches.add(acc.id)
        // Also add all ancestors to keep tree path visible
        let currentParentId = acc.parent_id
        while (currentParentId) {
          matches.add(currentParentId)
          const parent = accounts.find(a => a.id === currentParentId)
          currentParentId = parent ? parent.parent_id : null
        }
      }
    })

    return matches
  }, [accounts, searchQuery])

  // Formatting utility
  const fmt = (n: number) =>
    Number(n || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  // Delete Handler
  const handleDeleteAccount = async (account: EnrichedAccount) => {
    if (!confirm(`هل أنت متأكد من رغبتك في حذف الحساب (${account.code} - ${account.name})؟\nلا يمكن التراجع عن هذه العملية.`)) {
      return
    }

    setActionLoading(true)
    const res = await deleteAccount(account.id)
    setActionLoading(false)

    if (!res.success) {
      showToast('error', res.error || 'تعذر حذف الحساب')
    } else {
      showToast('success', `تم حذف الحساب (${account.code} - ${account.name}) بنجاح`)
      setAccounts(prev => prev.filter(a => a.id !== account.id))
      if (selectedAccountId === account.id) {
        setSelectedAccountId(null)
      }
      router.refresh()
    }
  }

  // Toggle Active Handler
  const handleToggleActive = async (account: EnrichedAccount) => {
    const targetState = !account.is_active
    const actionLabel = targetState ? 'تفعيل' : 'تعطيل'

    setActionLoading(true)
    const res = await toggleAccountActive(account.id, targetState)
    setActionLoading(false)

    if (!res.success) {
      showToast('error', res.error || `فشل ${actionLabel} الحساب`)
    } else {
      showToast('success', `تم ${actionLabel} الحساب (${account.code}) بنجاح`)
      setAccounts(prev => prev.map(a => a.id === account.id ? { ...a, is_active: targetState } : a))
      router.refresh()
    }
  }

  // Handle Form Modal Success (create/edit)
  const handleModalSuccess = (saved: AccountItem) => {
    setAccounts(prev => {
      const idx = prev.findIndex(a => a.id === saved.id)
      if (idx >= 0) {
        const copy = [...prev]
        copy[idx] = { ...copy[idx], ...saved }
        return copy
      } else {
        return [...prev, saved].sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }))
      }
    })

    // If added child, ensure parent is expanded
    if (saved.parent_id) {
      setExpandedNodes(prev => new Set(prev).add(saved.parent_id!))
    }

    setSelectedAccountId(saved.id)
    setFormModalState({ open: false, mode: 'create' })
    showToast('success', `تم حفظ الحساب (${saved.code} - ${saved.name}) بنجاح`)
    router.refresh()
  }

  // Recursive Tree Node Renderer
  const renderTreeNode = (account: EnrichedAccount, depth: number = 0) => {
    const children = childrenMap.get(account.id) || []
    const hasChildren = children.length > 0
    const isExpanded = expandedNodes.has(account.id)
    const isSelected = selectedAccountId === account.id

    // Check search filter
    if (searchMatchedIds && !searchMatchedIds.has(account.id)) {
      return null
    }

    // Check type filter for root level nodes
    if (depth === 0 && selectedType !== 'all' && account.type !== selectedType) {
      return null
    }

    const balance = rolledUpBalanceMap.get(account.id) || 0
    const typeConf = TYPE_CONFIG[account.type] || { color: 'text-slate-400', icon: '📄' }

    return (
      <div key={account.id} className="select-none">
        <div
          onClick={() => setSelectedAccountId(account.id)}
          className={`group flex items-center justify-between rounded-xl py-2 px-3 transition-all cursor-pointer border ${
            isSelected
              ? 'bg-sky-500/15 border-sky-500/50 shadow-md shadow-sky-500/5'
              : 'hover:bg-slate-800/50 border-transparent hover:border-white/5'
          } ${!account.is_active ? 'opacity-60 bg-red-950/10' : ''}`}
          style={{ paddingRight: `${Math.max(12, depth * 22 + 12)}px` }}
        >
          {/* Right part: Caret + Icon + Code + Name + Badges */}
          <div className="flex items-center gap-2 min-w-0">
            {/* Caret arrow */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                toggleNode(account.id)
              }}
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-700 hover:text-white transition ${
                hasChildren || account.is_group ? 'visible' : 'invisible'
              }`}
            >
              <span className={`text-[10px] transform transition-transform ${isExpanded ? 'rotate-90' : 'rotate-0'}`}>
                ◀
              </span>
            </button>

            {/* Folder / Document Icon */}
            <span className="text-sm shrink-0">
              {account.is_group ? '📁' : '📄'}
            </span>

            {/* Code */}
            <span className="font-mono font-bold text-sky-400 text-xs shrink-0" dir="ltr">
              {account.code}
            </span>

            {/* Name */}
            <span className={`truncate text-xs ${
              account.is_group || depth === 0
                ? 'font-bold text-white'
                : 'font-medium text-slate-200'
            }`}>
              {account.name}
            </span>

            {/* System Locked Badge */}
            {account.is_system && (
              <span className="shrink-0 text-[10px] text-amber-400" title="حساب نظام أساسي محمي">
                🔒
              </span>
            )}

            {/* Inactive Badge */}
            {!account.is_active && (
              <span className="shrink-0 rounded bg-rose-500/10 border border-rose-500/20 px-1.5 py-0.2 text-[9px] font-bold text-rose-400">
                غير فعال
              </span>
            )}

            {/* Group Badge */}
            {account.is_group && (
              <span className="shrink-0 rounded bg-slate-800 px-1.5 py-0.2 text-[9px] font-semibold text-slate-400">
                تجميعي
              </span>
            )}
          </div>

          {/* Left part: Balance & Quick Action Buttons */}
          <div className="flex items-center gap-3 shrink-0">
            {/* Rolled up balance */}
            <div className="text-left font-mono" dir="ltr">
              <span className={`text-xs font-bold ${
                balance > 0 ? 'text-emerald-400' : balance < 0 ? 'text-rose-400' : 'text-slate-400'
              }`}>
                {fmt(balance)}
              </span>
              <span className="mr-1 text-[10px] text-slate-500">
                {account.currency || store.currency_code}
              </span>
            </div>

            {/* Quick action buttons (on hover) */}
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                type="button"
                title="إضافة حساب فرعي تابع لهذا الحساب"
                onClick={(e) => {
                  e.stopPropagation()
                  setFormModalState({
                    open: true,
                    mode: 'create',
                    presetParentId: account.id,
                    presetType: account.type,
                  })
                }}
                className="flex items-center gap-0.5 rounded-lg bg-sky-500/10 hover:bg-sky-500 hover:text-slate-950 px-2 py-1 text-[10px] font-bold text-sky-400 transition"
              >
                <span>⊕</span> فرعي
              </button>

              <button
                type="button"
                title="إضافة حساب على نفس المستوى"
                onClick={(e) => {
                  e.stopPropagation()
                  setFormModalState({
                    open: true,
                    mode: 'create',
                    presetParentId: account.parent_id,
                    presetType: account.type,
                  })
                }}
                className="flex items-center gap-0.5 rounded-lg bg-slate-800 hover:bg-slate-700 px-2 py-1 text-[10px] font-bold text-slate-300 hover:text-white transition"
              >
                <span>+</span> موازي
              </button>
            </div>
          </div>
        </div>

        {/* Render Children Recursively if Expanded */}
        {hasChildren && isExpanded && (
          <div className="relative">
            {/* Vertical tree line guide */}
            <div
              className="absolute right-0 top-0 bottom-0 border-r border-white/5"
              style={{ marginRight: `${depth * 22 + 23}px` }}
            />
            {children.map(child => renderTreeNode(child, depth + 1))}
          </div>
        )}
      </div>
    )
  }

  // Get Top-level Root accounts (no parent)
  const rootAccounts = useMemo(() => {
    return (childrenMap.get(null) || []).filter(a => {
      if (selectedType !== 'all' && a.type !== selectedType) return false
      return true
    })
  }, [childrenMap, selectedType])

  return (
    <div className="space-y-6">
      
      {/* ── Back to Accounting Hub ── */}
      <div>
        <BackToDashboardButton href="/dashboard/accounting-hub" label="العودة إلى لوحة الإدارة المالية والمحاسبية" />
      </div>

      {/* ── Header ── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <span>🌳</span> دليل وشجرة الحسابات الهرمية (Chart of Accounts)
          </h1>
          <p className="mt-1 text-xs text-slate-400">
            هيكل محاسبي هرمي متعدد المستويات يدعم الأب والأبناء، الحسابات التجميعية وحسابات الحركات، وكشوف الحسابات المباشرة
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <Link
            href="/dashboard/accounting/journal"
            className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-slate-800 px-3.5 py-2 text-xs font-bold text-slate-200 hover:bg-slate-700 transition"
          >
            📋 قيود اليومية
          </Link>

          <button
            type="button"
            onClick={() => setFormModalState({ open: true, mode: 'create', presetParentId: null })}
            className="flex items-center gap-1.5 rounded-xl bg-sky-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-sky-400 transition shadow-lg shadow-sky-500/10"
          >
            ➕ إضافة حساب جديد
          </button>
        </div>
      </div>

      {/* ── Toast Notification ── */}
      {actionMessage && (
        <div
          className={`flex items-center justify-between rounded-xl p-3.5 text-xs font-bold transition-all ${
            actionMessage.type === 'success'
              ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400'
              : 'bg-rose-500/10 border border-rose-500/20 text-rose-400'
          }`}
        >
          <span>{actionMessage.text}</span>
          <button onClick={() => setActionMessage(null)} className="text-slate-400 hover:text-white">✕</button>
        </div>
      )}

      {/* ── Control Bar: Search + Filter Tabs + Tree Tools ── */}
      <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3 rounded-2xl border border-white/10 bg-slate-900 p-3">
        
        {/* Type Category Filter Tabs */}
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => setSelectedType('all')}
            className={`rounded-xl px-3 py-1.5 text-xs font-bold transition ${
              selectedType === 'all'
                ? 'bg-sky-500 text-slate-950'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            الكل ({accounts.length})
          </button>
          {Object.entries(TYPE_CONFIG).map(([typeKey, conf]) => (
            <button
              key={typeKey}
              onClick={() => setSelectedType(typeKey)}
              className={`flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-xs font-bold transition ${
                selectedType === typeKey
                  ? `${conf.bg} ${conf.color} border border-current`
                  : 'bg-slate-900 text-slate-400 hover:text-white border border-white/5'
              }`}
            >
              <span>{conf.icon}</span> {conf.label.split(' ')[0]}
            </button>
          ))}
        </div>

        {/* Search Input & Expand/Collapse */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1 sm:w-72">
            <input
              type="text"
              placeholder="🔍 ابحث برقم الحساب أو الاسم أو الوصف..."
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

          <button
            onClick={expandAll}
            title="فتح كافة التفرعات"
            className="rounded-xl border border-white/10 bg-slate-800 px-2.5 py-1.5 text-[11px] font-bold text-slate-300 hover:bg-slate-700 hover:text-white transition whitespace-nowrap"
          >
            فتح الكل
          </button>

          <button
            onClick={collapseAll}
            title="طي كافة التفرعات"
            className="rounded-xl border border-white/10 bg-slate-800 px-2.5 py-1.5 text-[11px] font-bold text-slate-300 hover:bg-slate-700 hover:text-white transition whitespace-nowrap"
          >
            طي الكل
          </button>
        </div>
      </div>

      {/* ── Main Split Screen: Tree on Right + Details on Left ── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* ── Right Pane: Hierarchical Tree ── */}
        <div className="lg:col-span-7 xl:col-span-8 rounded-2xl border border-white/10 bg-slate-900 p-4 shadow-xl overflow-hidden">
          <div className="flex items-center justify-between border-b border-white/10 pb-3 mb-3 text-xs text-slate-400 font-bold">
            <div className="flex items-center gap-2">
              <span>هيكل شجرة الحسابات</span>
              <span className="rounded-md bg-slate-800 px-2 py-0.5 text-[10px] text-slate-300 font-mono">
                {accounts.length} حساب
              </span>
            </div>
            <span>الرصيد الدفتري التراكمي</span>
          </div>

          <div className="max-h-[75vh] overflow-y-auto space-y-0.5 pr-1">
            {rootAccounts.length === 0 ? (
              <div className="py-16 text-center text-slate-500">
                <span className="text-4xl">🌳</span>
                <p className="mt-2 text-sm font-semibold text-slate-400">لا توجد حسابات مطابقة للبحث أو الفلتر الحالي</p>
                <button
                  type="button"
                  onClick={() => { setSearchQuery(''); setSelectedType('all') }}
                  className="mt-2 text-xs text-sky-400 hover:underline"
                >
                  إعادة ضبط البحث والتصنيفات
                </button>
              </div>
            ) : (
              rootAccounts.map(acc => renderTreeNode(acc, 0))
            )}
          </div>
        </div>

        {/* ── Left Pane: Selected Account Details & Actions Panel ── */}
        <div className="lg:col-span-5 xl:col-span-4">
          <div className="sticky top-6 rounded-2xl border border-white/10 bg-slate-900 p-5 shadow-xl space-y-5">
            
            {selectedAccount ? (
              <>
                {/* Header & Badges */}
                <div className="border-b border-white/10 pb-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-2xl">{selectedAccount.is_group ? '📁' : '📄'}</span>
                        <h2 className="text-base font-bold text-white truncate">
                          {selectedAccount.name}
                        </h2>
                      </div>
                      <div className="mt-1.5 flex items-center gap-2">
                        <span className="rounded-md bg-sky-500/10 px-2.5 py-0.5 font-mono text-xs font-bold text-sky-400 border border-sky-500/20" dir="ltr">
                          كود: {selectedAccount.code}
                        </span>
                        {selectedAccount.is_system && (
                          <span className="flex items-center gap-1 rounded-md bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 text-[10px] font-bold text-amber-400">
                            <span>🔒</span> حساب نظام
                          </span>
                        )}
                        <span className={`rounded-md px-2 py-0.5 text-[10px] font-bold border ${
                          selectedAccount.is_active
                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                            : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                        }`}>
                          {selectedAccount.is_active ? 'نشط وفعال' : 'معطل (غير فعال)'}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Account Metadata Grid */}
                <div className="grid grid-cols-2 gap-2.5 text-xs">
                  <div className="rounded-xl border border-white/5 bg-slate-800/60 p-3">
                    <span className="text-slate-400 block text-[11px]">النوع المحاسبي</span>
                    <span className={`mt-1 font-bold inline-flex items-center gap-1 ${
                      TYPE_CONFIG[selectedAccount.type]?.color || 'text-white'
                    }`}>
                      {TYPE_CONFIG[selectedAccount.type]?.icon} {TYPE_CONFIG[selectedAccount.type]?.label.split(' ')[0]}
                    </span>
                  </div>

                  <div className="rounded-xl border border-white/5 bg-slate-800/60 p-3">
                    <span className="text-slate-400 block text-[11px]">طبيعة الحساب</span>
                    <span className="mt-1 font-bold text-white block">
                      {selectedAccount.normal_balance === 'debit' ? 'مدين بطبيعته' : 'دائن بطبيعته'}
                    </span>
                  </div>

                  <div className="rounded-xl border border-white/5 bg-slate-800/60 p-3">
                    <span className="text-slate-400 block text-[11px]">تصنيف الحساب</span>
                    <span className="mt-1 font-bold text-slate-200 block">
                      {selectedAccount.is_group ? 'تجميعي (رئيسي)' : 'تفصيلي (حركات)'}
                    </span>
                  </div>

                  <div className="rounded-xl border border-white/5 bg-slate-800/60 p-3">
                    <span className="text-slate-400 block text-[11px]">العملة المعيارية</span>
                    <span className="mt-1 font-mono font-bold text-white block">
                      {selectedAccount.currency || store.currency_code}
                    </span>
                  </div>
                </div>

                {/* Current Balance Card */}
                <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-emerald-300">الرصيد الدفتري الحالي</span>
                    <span className="text-xs font-mono text-emerald-400">
                      {selectedAccount.is_group ? '(تجميعي للأبناء)' : '(حركات)'}
                    </span>
                  </div>
                  <p className="mt-2 font-mono text-2xl font-bold text-emerald-400" dir="ltr">
                    {fmt(rolledUpBalanceMap.get(selectedAccount.id) || 0)} {selectedAccount.currency || store.currency_code}
                  </p>
                </div>

                {/* Transactions Summary */}
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-xl border border-white/5 bg-slate-800/40 p-2.5">
                    <span className="text-[11px] text-slate-400">إجمالي المدين</span>
                    <p className="mt-0.5 font-mono font-bold text-sky-400" dir="ltr">
                      {fmt(selectedAccount.total_debit || 0)}
                    </p>
                  </div>
                  <div className="rounded-xl border border-white/5 bg-slate-800/40 p-2.5">
                    <span className="text-[11px] text-slate-400">إجمالي الدائن</span>
                    <p className="mt-0.5 font-mono font-bold text-amber-400" dir="ltr">
                      {fmt(selectedAccount.total_credit || 0)}
                    </p>
                  </div>
                  <div className="rounded-xl border border-white/5 bg-slate-800/40 p-2.5">
                    <span className="text-[11px] text-slate-400">عدد الحركات</span>
                    <p className="mt-0.5 font-mono font-bold text-slate-200">
                      {selectedAccount.movements_count || 0} حركة
                    </p>
                  </div>
                  <div className="rounded-xl border border-white/5 bg-slate-800/40 p-2.5">
                    <span className="text-[11px] text-slate-400">آخر حركة</span>
                    <p className="mt-0.5 font-mono font-semibold text-slate-300">
                      {selectedAccount.last_movement_date || '—'}
                    </p>
                  </div>
                </div>

                {/* Parent Account Reference */}
                {selectedAccount.parent_id && (
                  <div className="rounded-xl border border-white/5 bg-slate-800/30 p-3 text-xs">
                    <span className="text-slate-400 block text-[11px]">الحساب الأب المباشر:</span>
                    {(() => {
                      const parent = accounts.find(a => a.id === selectedAccount.parent_id)
                      return parent ? (
                        <button
                          type="button"
                          onClick={() => setSelectedAccountId(parent.id)}
                          className="mt-1 font-bold text-sky-400 hover:underline flex items-center gap-1.5"
                        >
                          <span className="font-mono">({parent.code})</span>
                          <span>{parent.name}</span>
                        </button>
                      ) : (
                        <span className="text-slate-400">غير محدد</span>
                      )
                    })()}
                  </div>
                )}

                {/* Description if present */}
                {selectedAccount.description && (
                  <div className="rounded-xl border border-white/5 bg-slate-800/30 p-3 text-xs">
                    <span className="text-slate-400 block text-[11px]">الوصف والملاحظات:</span>
                    <p className="mt-1 text-slate-300 leading-relaxed">{selectedAccount.description}</p>
                  </div>
                )}

                {/* Action Buttons */}
                <div className="border-t border-white/10 pt-4 space-y-2.5">
                  
                  {/* Primary Row: Statement + Edit */}
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setStatementModalAcc(selectedAccount)}
                      className="flex items-center justify-center gap-1.5 rounded-xl bg-sky-600 px-3 py-2.5 text-xs font-bold text-white hover:bg-sky-500 transition shadow"
                    >
                      <span>📜</span> كشف الحساب
                    </button>

                    <button
                      type="button"
                      onClick={() => setFormModalState({
                        open: true,
                        mode: 'edit',
                        initialData: selectedAccount,
                      })}
                      className="flex items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-slate-800 px-3 py-2.5 text-xs font-bold text-slate-200 hover:bg-slate-700 hover:text-white transition"
                    >
                      <span>✏️</span> تعديل الحساب
                    </button>
                  </div>

                  {/* Secondary Row: Add Child + Add Sibling */}
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setFormModalState({
                        open: true,
                        mode: 'create',
                        presetParentId: selectedAccount.id,
                        presetType: selectedAccount.type,
                      })}
                      className="flex items-center justify-center gap-1 rounded-xl border border-sky-500/30 bg-sky-500/10 px-2.5 py-2 text-xs font-bold text-sky-400 hover:bg-sky-500 hover:text-slate-950 transition"
                    >
                      <span>⊕</span> إضافة فرعي
                    </button>

                    <button
                      type="button"
                      onClick={() => setFormModalState({
                        open: true,
                        mode: 'create',
                        presetParentId: selectedAccount.parent_id,
                        presetType: selectedAccount.type,
                      })}
                      className="flex items-center justify-center gap-1 rounded-xl border border-white/10 bg-slate-800 px-2.5 py-2 text-xs font-bold text-slate-300 hover:bg-slate-700 hover:text-white transition"
                    >
                      <span>+</span> إضافة موازي
                    </button>
                  </div>

                  {/* Tertiary Row: Active Toggle + Delete */}
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <button
                      type="button"
                      disabled={actionLoading}
                      onClick={() => handleToggleActive(selectedAccount)}
                      className={`flex items-center justify-center gap-1 rounded-xl border px-2.5 py-2 text-xs font-bold transition disabled:opacity-50 ${
                        selectedAccount.is_active
                          ? 'border-amber-500/20 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20'
                          : 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
                      }`}
                    >
                      <span>{selectedAccount.is_active ? '🔴' : '🟢'}</span>
                      <span>{selectedAccount.is_active ? 'تعطيل الحساب' : 'تفعيل الحساب'}</span>
                    </button>

                    <button
                      type="button"
                      disabled={actionLoading || selectedAccount.is_system}
                      onClick={() => handleDeleteAccount(selectedAccount)}
                      title={selectedAccount.is_system ? 'لا يمكن حذف حساب نظام أساسي' : 'حذف الحساب'}
                      className="flex items-center justify-center gap-1 rounded-xl border border-rose-500/20 bg-rose-500/10 px-2.5 py-2 text-xs font-bold text-rose-400 hover:bg-rose-500 hover:text-white transition disabled:opacity-30 disabled:hover:bg-rose-500/10 disabled:hover:text-rose-400"
                    >
                      <span>🗑️</span> حذف الحساب
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="py-20 text-center text-slate-500">
                <span className="text-4xl">👈</span>
                <h3 className="mt-3 text-sm font-bold text-slate-300">اختر حساباً من الشجرة</h3>
                <p className="mt-1 text-xs text-slate-400 leading-relaxed px-4">
                  اضغط على أي حساب لعرض تفاصيله، رصيده الدفتري التراكمي، كشف حسابه، أو إضافة حسابات فرعية وموازية له.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Modal: Add / Edit Account ── */}
      {formModalState.open && (
        <AccountFormModal
          mode={formModalState.mode}
          initialData={formModalState.initialData}
          presetParentId={formModalState.presetParentId}
          presetType={formModalState.presetType}
          accounts={accounts}
          currencyCode={store.currency_code}
          onClose={() => setFormModalState({ open: false, mode: 'create' })}
          onSuccess={handleModalSuccess}
        />
      )}

      {/* ── Modal: Direct Account Statement ── */}
      {statementModalAcc && (
        <AccountStatementModal
          account={statementModalAcc}
          currencyCode={store.currency_code}
          onClose={() => setStatementModalAcc(null)}
        />
      )}
    </div>
  )
}
