'use client'

import { useState, useRef, useEffect, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { extractShamelZip, ExtractedFile } from '@/lib/shamel/unzip'
import { processShamelArchive } from '@/lib/shamel/mapper'
import { ShamelParsedData } from '@/lib/shamel/types'
import ShamelStatementModal from './components/ShamelStatementModal'
import ShamelItemCardModal from './components/ShamelItemCardModal'
import ShamelChequeDetailModal from './components/ShamelChequeDetailModal'

const PALESTINIAN_BANKS: Record<string, string> = {
  '0089': 'بنك فلسطين',
  '0049': 'البنك الإسلامي الفلسطيني',
  '0081': 'البنك الإسلامي العربي',
  '0027': 'البنك العربي',
  '0073': 'بنك القدس',
  '0082': 'البنك الوطني',
  '0066': 'بنك القاهرة عمان',
  '0076': 'بنك الصفا',
  '0037': 'بنك الأردن',
  '0043': 'بنك الإسكان للتجارة',
  '0067': 'البنك الأهلي الأردني',
  '0078': 'بنك الاستثمار الفلسطيني',
  '0012': 'بنك لئومي',
  '0010': 'بنك هبوعليم',
  '0011': 'بنك ديسكونت',
  '0020': 'بنك مزراحي تفاحوت',
  '0031': 'البنك الدولي الأول',
}

const getBankName = (code: string) => {
  const clean = (code || '').trim()
  const padded = clean.padStart(4, '0')
  return PALESTINIAN_BANKS[padded] || PALESTINIAN_BANKS[clean] || (clean ? `بنك (${clean})` : '—')
}

interface Props {
  store: {
    id: string
    name: string
    currency_code: string
    plan: string
  }
  initialSyncConfig: any
  initialSnapshots: any[]
  initialChequeStats?: any
  existingStats: {
    accounts: number
    customers: number
    products: number
    checks: number
  }
  isolatedStats: {
    customers: number
    stock: number
    cheques: number
    accounts: number
  }
}

type TabType = 'explorer_customers' | 'explorer_cheques' | 'explorer_stock' | 'explorer_accounts' | 'import_wizard' | 'gdrive'

export default function ShamelWizardClient({
  store,
  initialSyncConfig,
  initialSnapshots,
  initialChequeStats,
  existingStats,
  isolatedStats,
}: Props) {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [, startTransition] = useTransition()

  const hasIsolatedData = (isolatedStats.customers + isolatedStats.stock + isolatedStats.cheques + isolatedStats.accounts) > 0
  const [activeTab, setActiveTab] = useState<TabType>(hasIsolatedData ? 'explorer_customers' : 'import_wizard')

  // Parsing & File State
  const [parsing, setParsing] = useState(false)
  const [parsedData, setParsedData] = useState<ShamelParsedData | null>(null)
  const [sourceFilename, setSourceFilename] = useState<string>('')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  // Ingestion State
  const [importing, setImporting] = useState(false)
  const [progressPercent, setProgressPercent] = useState(0)
  const [currentStepText, setCurrentStepText] = useState('')
  const [importLogs, setImportLogs] = useState<string[]>([])

  // Wipe State
  const [wiping, setWiping] = useState(false)
  const [showWipeModal, setShowWipeModal] = useState(false)

  // Explorer Data & Query State
  const [queryRows, setQueryRows] = useState<any[]>([])
  const [queryTotal, setQueryTotal] = useState(0)
  const [queryLoading, setQueryLoading] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterBank, setFilterBank] = useState('all')
  const [chequeStats, setChequeStats] = useState<any>(initialChequeStats || null)

  // Pagination State
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)

  // Customer Explorer Sorting & Filtering State
  const [customerSortBy, setCustomerSortBy] = useState<'code' | 'name' | 'balance' | 'last_invoice' | 'last_receipt'>('code')
  const [customerSortDir, setCustomerSortDir] = useState<'asc' | 'desc'>('asc')
  const [customerHideZero, setCustomerHideZero] = useState(false)

  // Dedicated Cheques Search Toolbar State (matching MyShop)
  const [chequeNoInput, setChequeNoInput] = useState('')
  const [chequeNo, setChequeNo] = useState('')
  const [chequeAmountInput, setChequeAmountInput] = useState('')
  const [chequeAmount, setChequeAmount] = useState('')
  const [chequeAccountInput, setChequeAccountInput] = useState('')
  const [chequeAccount, setChequeAccount] = useState('')
  const [chequeStatus, setChequeStatus] = useState('all')
  const [chequeBank, setChequeBank] = useState('all')
  const [chequeDueDateFrom, setChequeDueDateFrom] = useState('')
  const [chequeDueDateTo, setChequeDueDateTo] = useState('')
  const [reloadTrigger, setReloadTrigger] = useState(0)
  const chequeDebounce = useRef<NodeJS.Timeout | null>(null)

  const handleChequeFilterChange = (
    setInput: (val: string) => void,
    setValue: (val: string) => void,
    val: string
  ) => {
    setInput(val)
    if (chequeDebounce.current) clearTimeout(chequeDebounce.current)
    chequeDebounce.current = setTimeout(() => {
      setValue(val)
      setCurrentPage(1)
    }, 300)
  }

  const resetChequeFilters = () => {
    setChequeNoInput('')
    setChequeNo('')
    setChequeAmountInput('')
    setChequeAmount('')
    setChequeAccountInput('')
    setChequeAccount('')
    setSearchTerm('')
    setChequeStatus('all')
    setChequeBank('all')
    setChequeDueDateFrom('')
    setChequeDueDateTo('')
    setCurrentPage(1)
  }

  const hasChequeFilters = Boolean(
    chequeNo ||
    chequeAmount ||
    chequeAccount ||
    searchTerm ||
    chequeStatus !== 'all' ||
    chequeBank !== 'all' ||
    chequeDueDateFrom ||
    chequeDueDateTo
  )

  const handleCustomerSort = (column: 'code' | 'name' | 'balance' | 'last_invoice' | 'last_receipt') => {
    if (customerSortBy === column) {
      setCustomerSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setCustomerSortBy(column)
      setCustomerSortDir('asc')
    }
    setCurrentPage(1)
  }

  const renderSortIndicator = (column: string) => {
    if (customerSortBy !== column) return <span className="text-slate-600 mr-1 text-[10px]">↕</span>
    return <span className="text-sky-400 mr-1 text-[10px] font-bold">{customerSortDir === 'asc' ? '▲' : '▼'}</span>
  }

  // Modals State
  const [statementCustomer, setStatementCustomer] = useState<{ code: string; name?: string } | null>(null)
  const [itemCardProduct, setItemCardProduct] = useState<{ code: string; name?: string } | null>(null)
  const [selectedCheque, setSelectedCheque] = useState<any | null>(null)

  // Promotion State
  const [promotingCode, setPromotingCode] = useState<string | null>(null)
  const [promotingAll, setPromotingAll] = useState(false)

  // Google Drive Sync State
  const [syncConfig, setSyncConfig] = useState(initialSyncConfig || {})
  const [folderIdInput, setFolderIdInput] = useState(initialSyncConfig?.gdrive_folder_id || '')
  const [folderNameInput, setFolderNameInput] = useState(initialSyncConfig?.gdrive_folder_name || 'Shamel_Backups')
  const [autoSyncInput, setAutoSyncInput] = useState(initialSyncConfig?.auto_sync_enabled || false)
  const [syncIntervalInput, setSyncIntervalInput] = useState(initialSyncConfig?.sync_interval_hours || 24)
  const [savingConfig, setSavingConfig] = useState(false)
  const [syncingNow, setSyncingNow] = useState(false)

  // Reset page when tab or primary filters change
  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab)
    setCurrentPage(1)
    setSearchTerm('')
    setFilterStatus('all')
    setFilterBank('all')
  }

  // ─────────────────────────────────────────────────────────────
  // Fetch Query Data for Explorer Tabs
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!activeTab.startsWith('explorer_')) return

    const kindMap: Record<string, string> = {
      explorer_customers: 'customers',
      explorer_cheques: 'cheques',
      explorer_stock: 'stock',
      explorer_accounts: 'accounts',
    }
    const kind = kindMap[activeTab]
    if (!kind) return

    setQueryLoading(true)
    const offset = (currentPage - 1) * pageSize
    const params = new URLSearchParams({
      kind,
      limit: String(pageSize),
      offset: String(offset),
    })

    if (activeTab === 'explorer_customers') {
      if (searchTerm) params.set('q', searchTerm)
      params.set('sort_by', customerSortBy)
      params.set('sort_dir', customerSortDir)
      if (customerHideZero || filterStatus === 'has_balance') params.set('hide_zero', 'true')
    } else if (activeTab === 'explorer_cheques') {
      if (searchTerm) params.set('q', searchTerm)
      if (chequeNo) params.set('cheque_no', chequeNo)
      if (chequeAmount) params.set('amount', chequeAmount)
      if (chequeAccount) params.set('account_no', chequeAccount)
      if (chequeStatus !== 'all') params.set('status', chequeStatus)
      if (chequeBank !== 'all') params.set('bank', chequeBank)
      if (chequeDueDateFrom) params.set('from', chequeDueDateFrom)
      if (chequeDueDateTo) params.set('to', chequeDueDateTo)
    } else {
      if (searchTerm) params.set('q', searchTerm)
      if (filterStatus !== 'all') params.set('status', filterStatus)
      if (filterBank !== 'all') params.set('bank', filterBank)
    }

    fetch(`/api/shamel/query?${params.toString()}`)
      .then(res => res.json())
      .then(data => {
        setQueryRows(data.rows || [])
        setQueryTotal(data.total || 0)
        if (data.stats) setChequeStats(data.stats)
      })
      .catch(err => console.error('Error querying Shamel explorer:', err))
      .finally(() => setQueryLoading(false))
  }, [
    activeTab,
    searchTerm,
    filterStatus,
    filterBank,
    currentPage,
    pageSize,
    customerSortBy,
    customerSortDir,
    customerHideZero,
    chequeNo,
    chequeAmount,
    chequeAccount,
    chequeStatus,
    chequeBank,
    chequeDueDateFrom,
    chequeDueDateTo,
    reloadTrigger,
  ])

  // ─────────────────────────────────────────────────────────────
  // 1. File Handling & Extraction
  // ─────────────────────────────────────────────────────────────
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return
    await processFiles(Array.from(files))
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      await processFiles(Array.from(e.dataTransfer.files))
    }
  }

  const processFiles = async (files: File[]) => {
    setParsing(true)
    setErrorMsg(null)
    setParsedData(null)
    setSuccessMsg(null)
    setImportLogs([])

    try {
      const fileMap = new Map<string, ExtractedFile>()

      if (files.length === 1 && files[0].name.toLowerCase().endsWith('.zip')) {
        const zipFile = files[0]
        setSourceFilename(zipFile.name)
        const arrayBuf = await zipFile.arrayBuffer()
        const extracted = extractShamelZip(arrayBuf)
        for (const [k, v] of extracted.entries()) {
          fileMap.set(k, v)
        }
      } else {
        setSourceFilename(`${files.length} ملفات .DAT`)
        for (const file of files) {
          const clean = file.name.toLowerCase().trim()
          const buf = await file.arrayBuffer()
          fileMap.set(clean, {
            name: file.name,
            cleanName: clean,
            data: new Uint8Array(buf),
            size: file.size,
            depth: 1,
            path: file.name,
          })
        }
      }

      if (fileMap.size === 0) {
        throw new Error('لم يتم العثور على أي ملفات صالحة في الحزمة المرفوعة.')
      }

      const result = processShamelArchive(fileMap)
      setParsedData(result)
    } catch (err: any) {
      console.error('File parsing error:', err)
      setErrorMsg(err?.message || 'فشل في قراءة ملفات الشامل. يرجى التأكد من اختيار ملف ZIP صالح.')
    } finally {
      setParsing(false)
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 2. Ingestion into ISOLATED Shamel Storage
  // ─────────────────────────────────────────────────────────────
  const appendLog = (msg: string) => {
    setImportLogs(prev => [...prev, `[${new Date().toLocaleTimeString('ar-u-nu-latn')}] ${msg}`])
  }

  const handleSaveToIsolatedStore = async () => {
    if (!parsedData) return
    setImporting(true)
    setProgressPercent(0)
    setImportLogs([])
    setErrorMsg(null)

    try {
      appendLog('بدء حفظ وتخزين بيانات الشامل في مستودع الاستعلام المعزول...')
      const snapId = `shamel_snap_${Date.now()}`

      const chunkArray = <T,>(arr: T[], size: number): T[][] => {
        const chunks: T[][] = []
        for (let i = 0; i < arr.length; i += size) {
          chunks.push(arr.slice(i, i + size))
        }
        return chunks
      }

      const postIsolated = async (table: string, items: any[]) => {
        const res = await fetch('/api/shamel/import-batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'save_isolated', table, items, snapshotId: snapId }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || `فشل حفظ دفعة من جدول ${table}`)
        return data
      }

      // 1. Accounts
      if (parsedData.accounts.length > 0) {
        setCurrentStepText(`حفظ شجرة الحسابات (${parsedData.accounts.length} حساب)...`)
        const chunks = chunkArray(parsedData.accounts, 300)
        for (const c of chunks) await postIsolated('accounts', c)
        appendLog(`✓ تم تخزين ${parsedData.accounts.length} حساب في مستودع الاستعلام.`)
      }
      setProgressPercent(25)

      // 2. Customers
      if (parsedData.customers.length > 0) {
        setCurrentStepText(`حفظ دليل الزبائن (${parsedData.customers.length} زبون)...`)
        const chunks = chunkArray(parsedData.customers, 300)
        for (const c of chunks) await postIsolated('customers', c)
        appendLog(`✓ تم تخزين ${parsedData.customers.length} زبون في مستودع الاستعلام.`)
      }
      setProgressPercent(50)

      // 3. Stock
      if (parsedData.products.length > 0) {
        setCurrentStepText(`حفظ الأصناف والمخزون (${parsedData.products.length} صنف)...`)
        const chunks = chunkArray(parsedData.products, 300)
        for (const c of chunks) await postIsolated('stock', c)
        appendLog(`✓ تم تخزين ${parsedData.products.length} صنف في مستودع الاستعلام.`)
      }
      setProgressPercent(75)

      // 4. Cheques
      if (parsedData.cheques.length > 0) {
        setCurrentStepText(`حفظ محفظة الشيكات (${parsedData.cheques.length.toLocaleString('ar-u-nu-latn')} شيك)...`)
        const chunks = chunkArray(parsedData.cheques, 400)
        for (const c of chunks) await postIsolated('cheques', c)
        appendLog(`✓ تم تخزين ${parsedData.cheques.length.toLocaleString('ar-u-nu-latn')} شيك في مستودع الاستعلام.`)
      }
      setProgressPercent(75)

      // 5. Assets
      if (parsedData.assets.length > 0) {
        await postIsolated('assets', parsedData.assets)
        appendLog(`✓ تم تخزين ${parsedData.assets.length.toLocaleString('ar-u-nu-latn')} أصل ثابت.`)
      }

      // 6. Detailed Journal Ledger Entries (ctrans.dat)
      if (parsedData.entries && parsedData.entries.length > 0) {
        const totalEntries = parsedData.entries.length
        setCurrentStepText(`حفظ قيود الحركات المالية ودفتر الأستاذ (${totalEntries.toLocaleString('ar-u-nu-latn')} قيد)...`)
        const chunks = chunkArray(parsedData.entries, 400)
        let done = 0
        for (const c of chunks) {
          await postIsolated('entries', c)
          done += c.length
          setCurrentStepText(`حفظ قيود الحركات: ${done.toLocaleString('ar-u-nu-latn')} / ${totalEntries.toLocaleString('ar-u-nu-latn')}`)
        }
        appendLog(`✓ تم تخزين ${totalEntries.toLocaleString('ar-u-nu-latn')} قيد حركة في دفتر أستاذ الشامل.`)
      }
      setProgressPercent(88)

      // 7. Invoice Line Items (strans.dat)
      if (parsedData.invoiceItems && parsedData.invoiceItems.length > 0) {
        const totalItems = parsedData.invoiceItems.length
        setCurrentStepText(`حفظ تفاصيل أسطر الفواتير وحركات الأصناف (${totalItems.toLocaleString('ar-u-nu-latn')} سطر)...`)
        const chunks = chunkArray(parsedData.invoiceItems, 400)
        let done = 0
        for (const c of chunks) {
          await postIsolated('invoice_items', c)
          done += c.length
          setCurrentStepText(`حفظ أسطر الفواتير: ${done.toLocaleString('ar-u-nu-latn')} / ${totalItems.toLocaleString('ar-u-nu-latn')}`)
        }
        appendLog(`✓ تم تخزين ${totalItems.toLocaleString('ar-u-nu-latn')} سطر تفصيلي للفواتير وحركات المخزون.`)
      }
      setProgressPercent(95)

      // 8. Snapshot audit record
      await fetch('/api/shamel/import-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          table: 'snapshot',
          snapshot: {
            id: snapId,
            source_modified_at: new Date().toISOString(),
            manifest: parsedData.inspections,
            report: {
              reconciliation: parsedData.reconciliation,
              importedCounts: {
                accounts: parsedData.accounts.length,
                customers: parsedData.customers.length,
                products: parsedData.products.length,
                cheques: parsedData.cheques.length,
                entries: parsedData.entries?.length || 0,
                invoiceItems: parsedData.invoiceItems?.length || 0,
              },
            },
          },
        }),
      })

      setProgressPercent(100)
      setCurrentStepText('اكتمل استخراج وتخزين بيانات الشامل بنجاح تام!')
      appendLog('✓ كشوفات الحسابات وسجلات الأصناف أصبحت مفعلة بالكامل مع كافة الحركات التاريخية.')
      setSuccessMsg('تم حفظ بيانات الشامل وسجل قيود الحركات بنجاح! كشوفات الحسابات الآن جاهزة للعرض التفصيلي.')
      setParsedData(null)
      router.refresh()
      setActiveTab('explorer_customers')
    } catch (err: any) {
      console.error('Import error:', err)
      setErrorMsg(err.message || 'حدث خطأ أثناء حفظ البيانات.')
    } finally {
      setImporting(false)
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 3. Promoting to Bazarko (Operational Sync)
  // ─────────────────────────────────────────────────────────────
  const handlePromote = async (entity: string, code?: string) => {
    if (code) setPromotingCode(code)
    else setPromotingAll(true)
    setErrorMsg(null)
    setSuccessMsg(null)

    try {
      const res = await fetch('/api/shamel/import-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'promote', entity, code: code || null }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'فشل الترحيل إلى بازاركو')

      const count = data.result?.promoted_count || 1
      setSuccessMsg(`✓ تم ترحيل وموائمة ${count.toLocaleString('ar-u-nu-latn')} سجل بنجاح إلى بازاركو!`)

      // Refresh query rows
      setQueryRows(prev =>
        prev.map(r => {
          if (!code || r.code === code || r.document === code) {
            return { ...r, is_promoted: true }
          }
          return r
        })
      )
      router.refresh()
    } catch (err: any) {
      setErrorMsg(err.message || 'فشلت عملية الترحيل.')
    } finally {
      setPromotingCode(null)
      setPromotingAll(false)
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 4. Wipe / Reset Entire Store Data
  // ─────────────────────────────────────────────────────────────
  const handleWipeStore = async () => {
    setWiping(true)
    setErrorMsg(null)
    setSuccessMsg(null)

    try {
      const res = await fetch('/api/shamel/import-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'wipe_store', wipeOperational: true }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'فشل إفراغ البيانات')

      setSuccessMsg('تم حذف وإفراغ كافة بيانات المتجر بنجاح. المتجر نظيف تماماً للبدء من جديد.')
      setShowWipeModal(false)
      setParsedData(null)
      setQueryRows([])
      setQueryTotal(0)
      router.refresh()
      setActiveTab('import_wizard')
    } catch (err: any) {
      setErrorMsg(err.message || 'حدث خطأ أثناء محاولة الحذف.')
    } finally {
      setWiping(false)
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 5. Google Drive Sync
  // ─────────────────────────────────────────────────────────────
  const handleSaveGdriveConfig = async (e: React.FormEvent) => {
    e.preventDefault()
    setSavingConfig(true)
    setErrorMsg(null)

    try {
      const res = await fetch('/api/shamel/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save_config',
          folderId: folderIdInput.trim(),
          folderName: folderNameInput.trim(),
          autoSync: autoSyncInput,
          syncInterval: Number(syncIntervalInput),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'فشل حفظ الإعدادات')
      setSyncConfig(data.config)
      setSuccessMsg('تم حفظ إعدادات Google Drive بنجاح.')
    } catch (err: any) {
      setErrorMsg(`خطأ: ${err.message}`)
    } finally {
      setSavingConfig(false)
    }
  }

  const handleSyncNow = async () => {
    setSyncingNow(true)
    setErrorMsg(null)

    try {
      const res = await fetch('/api/shamel/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sync_now' }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'فشلت المزامنة')
      setSuccessMsg(data.message)
      router.refresh()
    } catch (err: any) {
      setErrorMsg(`فشلت المزامنة: ${err.message}`)
    } finally {
      setSyncingNow(false)
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Helper: Pagination Component (Pure Dark Theme)
  // ─────────────────────────────────────────────────────────────
  const totalPages = Math.ceil(queryTotal / pageSize) || 1

  const renderPagination = () => {
    if (queryTotal <= 0) return null
    const fromIndex = (currentPage - 1) * pageSize + 1
    const toIndex = Math.min(currentPage * pageSize, queryTotal)

    return (
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-4 border-t border-white/10 text-xs text-slate-400">
        <div>
          عرض <span className="font-bold text-white font-mono">{fromIndex.toLocaleString('ar-u-nu-latn')}</span> إلى{' '}
          <span className="font-bold text-white font-mono">{toIndex.toLocaleString('ar-u-nu-latn')}</span> من إجمالي{' '}
          <span className="font-bold text-sky-400 font-mono">{queryTotal.toLocaleString('ar-u-nu-latn')}</span> سجل
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="text-slate-400">العدد بالصفحة:</span>
            <select
              value={pageSize}
              onChange={e => {
                setPageSize(Number(e.target.value))
                setCurrentPage(1)
              }}
              className="px-2.5 py-1.5 border border-white/10 rounded-lg text-xs bg-slate-950 text-white outline-none focus:border-sky-500 font-mono"
            >
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={200}>200</option>
            </select>
          </div>

          <div className="flex items-center gap-1.5 font-mono">
            <button
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage <= 1 || queryLoading}
              className="px-3 py-1.5 border border-white/10 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold disabled:opacity-40 transition"
            >
              السابق
            </button>
            <span className="px-2.5 py-1 text-slate-300 font-bold">
              {currentPage.toLocaleString('ar-u-nu-latn')} / {totalPages.toLocaleString('ar-u-nu-latn')}
            </span>
            <button
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage >= totalPages || queryLoading}
              className="px-3 py-1.5 border border-white/10 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold disabled:opacity-40 transition"
            >
              التالي
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 pb-12" dir="rtl">
      {/* Header Banner */}
      <div className="bg-gradient-to-l from-slate-900 via-indigo-950/80 to-slate-900 rounded-2xl p-6 text-white shadow-xl border border-white/10">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-3">
              <span className="text-3xl">🔄</span>
              <h1 className="text-2xl font-black tracking-tight text-white">
                مركز استعلام ومزامنة الشامل المحاسبي (Al-Shamel ERP)
              </h1>
              <span className="bg-indigo-500/20 text-indigo-300 text-xs px-2.5 py-1 rounded-full font-bold border border-indigo-500/30">
                مستودع بيانات معزول
              </span>
            </div>
            <p className="text-slate-400 text-sm max-w-2xl leading-relaxed">
              استعراض وبحث متقدم في بيانات الشامل الأصلية (الزبائن، كشوفات الحساب، الشيكات، سجلات الأصناف، الحسابات) مع إمكانية موائمتها وترحيلها تدريجياً إلى بازاركو.
            </p>
          </div>

          {/* Quick Actions & Reset Button */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowWipeModal(true)}
              className="px-4 py-2 bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/30 rounded-xl text-xs font-bold transition flex items-center gap-1.5"
            >
              <span>🗑️</span>
              <span>إفراغ وإعادة تعيين المتجر</span>
            </button>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex gap-2 mt-6 pt-4 border-t border-white/10 overflow-x-auto">
          <button
            onClick={() => handleTabChange('explorer_customers')}
            className={`px-4 py-2 rounded-lg font-bold text-xs transition-all flex items-center gap-2 ${
              activeTab === 'explorer_customers'
                ? 'bg-sky-500 text-slate-950 shadow-md font-black'
                : 'text-slate-300 hover:text-white hover:bg-white/10'
            }`}
          >
            <span>👥</span>
            <span>زبائن الشامل</span>
            {isolatedStats.customers > 0 && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-mono font-bold ${
                activeTab === 'explorer_customers' ? 'bg-slate-950/30 text-slate-950' : 'bg-slate-800 text-slate-300 border border-white/10'
              }`}>
                {isolatedStats.customers.toLocaleString('ar-u-nu-latn')}
              </span>
            )}
          </button>

          <button
            onClick={() => handleTabChange('explorer_cheques')}
            className={`px-4 py-2 rounded-lg font-bold text-xs transition-all flex items-center gap-2 ${
              activeTab === 'explorer_cheques'
                ? 'bg-sky-500 text-slate-950 shadow-md font-black'
                : 'text-slate-300 hover:text-white hover:bg-white/10'
            }`}
          >
            <span>🏦</span>
            <span>محفظة الشيكات</span>
            {isolatedStats.cheques > 0 && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-mono font-bold ${
                activeTab === 'explorer_cheques' ? 'bg-slate-950/30 text-slate-950' : 'bg-slate-800 text-slate-300 border border-white/10'
              }`}>
                {isolatedStats.cheques.toLocaleString('ar-u-nu-latn')}
              </span>
            )}
          </button>

          <button
            onClick={() => handleTabChange('explorer_stock')}
            className={`px-4 py-2 rounded-lg font-bold text-xs transition-all flex items-center gap-2 ${
              activeTab === 'explorer_stock'
                ? 'bg-sky-500 text-slate-950 shadow-md font-black'
                : 'text-slate-300 hover:text-white hover:bg-white/10'
            }`}
          >
            <span>🛍️</span>
            <span>المخزون والأصناف</span>
            {isolatedStats.stock > 0 && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-mono font-bold ${
                activeTab === 'explorer_stock' ? 'bg-slate-950/30 text-slate-950' : 'bg-slate-800 text-slate-300 border border-white/10'
              }`}>
                {isolatedStats.stock.toLocaleString('ar-u-nu-latn')}
              </span>
            )}
          </button>

          <button
            onClick={() => handleTabChange('explorer_accounts')}
            className={`px-4 py-2 rounded-lg font-bold text-xs transition-all flex items-center gap-2 ${
              activeTab === 'explorer_accounts'
                ? 'bg-sky-500 text-slate-950 shadow-md font-black'
                : 'text-slate-300 hover:text-white hover:bg-white/10'
            }`}
          >
            <span>🌳</span>
            <span>شجرة الحسابات</span>
            {isolatedStats.accounts > 0 && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-mono font-bold ${
                activeTab === 'explorer_accounts' ? 'bg-slate-950/30 text-slate-950' : 'bg-slate-800 text-slate-300 border border-white/10'
              }`}>
                {isolatedStats.accounts.toLocaleString('ar-u-nu-latn')}
              </span>
            )}
          </button>

          <button
            onClick={() => handleTabChange('import_wizard')}
            className={`px-4 py-2 rounded-lg font-bold text-xs transition-all flex items-center gap-2 ${
              activeTab === 'import_wizard'
                ? 'bg-sky-500 text-slate-950 shadow-md font-black'
                : 'text-slate-300 hover:text-white hover:bg-white/10'
            }`}
          >
            <span>⚡</span>
            <span>استيراد ملف جديد</span>
          </button>

          <button
            onClick={() => handleTabChange('gdrive')}
            className={`px-4 py-2 rounded-lg font-bold text-xs transition-all flex items-center gap-2 ${
              activeTab === 'gdrive'
                ? 'bg-sky-500 text-slate-950 shadow-md font-black'
                : 'text-slate-300 hover:text-white hover:bg-white/10'
            }`}
          >
            <span>☁️</span>
            <span>Google Drive</span>
          </button>
        </div>
      </div>

      {/* Messages */}
      {errorMsg && (
        <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 p-4 rounded-xl text-sm font-semibold flex items-center gap-2">
          <span>⚠️</span>
          <span>{errorMsg}</span>
        </div>
      )}
      {successMsg && (
        <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 p-4 rounded-xl text-sm font-semibold flex items-center gap-2">
          <span>✓</span>
          <span>{successMsg}</span>
        </div>
      )}

      {/* ───────────────────────────────────────────────────────── */}
      {/* 1. EXPLORER: CUSTOMERS (Pure Dark Theme)                  */}
      {/* ───────────────────────────────────────────────────────── */}
      {activeTab === 'explorer_customers' && (
        <div className="bg-slate-900 border border-white/10 rounded-2xl shadow-xl p-6 space-y-4">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-bold text-white">دليل زبائن الشامل المحاسبي</h2>
              <p className="text-xs text-slate-400">
                إجمالي المسجل: <span className="font-bold text-white font-mono">{queryTotal.toLocaleString('ar-u-nu-latn')}</span> زبون • انقر على أي زبون لعرض كشف الحساب التفصيلي وطباعته، أو رحّله لبازاركو.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
              <input
                type="text"
                value={searchTerm}
                onChange={e => { setSearchTerm(e.target.value); setCurrentPage(1) }}
                placeholder="بحث بالاسم، الكود، الهاتف..."
                className="px-3.5 py-2 text-xs border border-white/10 bg-slate-950 text-white placeholder-slate-500 rounded-xl focus:border-sky-500 outline-none w-full md:w-64"
              />

              <button
                type="button"
                onClick={() => { setCustomerHideZero(!customerHideZero); setCurrentPage(1) }}
                className={`px-3 py-2 border rounded-xl text-xs font-bold transition flex items-center gap-1.5 ${
                  customerHideZero
                    ? 'bg-sky-500/20 border-sky-500/40 text-sky-300'
                    : 'border-white/10 bg-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                <span>{customerHideZero ? '☑️ ذوو أرصدة فقط' : '◻️ كافة الزبائن'}</span>
              </button>

              <button
                onClick={() => handlePromote('customers')}
                disabled={promotingAll || queryRows.length === 0}
                className="px-4 py-2 bg-sky-500 hover:bg-sky-400 text-slate-950 rounded-xl text-xs font-bold shrink-0 disabled:opacity-50 transition"
              >
                {promotingAll ? 'جاري الترحيل...' : 'ترحيل الكل لبازاركو'}
              </button>
            </div>
          </div>

          {queryLoading ? (
            <div className="py-16 text-center text-slate-400 text-xs">
              <div className="text-2xl animate-spin mb-2">⏳</div>
              جاري جلب الزبائن من مستودع الشامل...
            </div>
          ) : queryRows.length === 0 ? (
            <div className="py-12 text-center text-slate-500 text-xs">
              لا توجد بيانات زبائن مطابقة في مستودع الشامل.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead>
                  <tr className="border-b border-white/10 bg-slate-800/60 text-slate-400 select-none">
                    <th
                      className="py-3 px-3.5 font-bold cursor-pointer hover:text-sky-400 transition"
                      onClick={() => handleCustomerSort('code')}
                    >
                      كود الشامل {renderSortIndicator('code')}
                    </th>
                    <th
                      className="py-3 px-3.5 font-bold cursor-pointer hover:text-sky-400 transition"
                      onClick={() => handleCustomerSort('name')}
                    >
                      الاسم / الهاتف {renderSortIndicator('name')}
                    </th>
                    <th
                      className="py-3 px-3.5 font-bold cursor-pointer hover:text-sky-400 transition"
                      onClick={() => handleCustomerSort('balance')}
                    >
                      الرصيد المكافئ (NIS) {renderSortIndicator('balance')}
                    </th>
                    <th
                      className="py-3 px-3.5 font-bold cursor-pointer hover:text-sky-400 transition"
                      onClick={() => handleCustomerSort('last_invoice')}
                    >
                      آخر فاتورة {renderSortIndicator('last_invoice')}
                    </th>
                    <th
                      className="py-3 px-3.5 font-bold cursor-pointer hover:text-sky-400 transition"
                      onClick={() => handleCustomerSort('last_receipt')}
                    >
                      آخر دفعة {renderSortIndicator('last_receipt')}
                    </th>
                    <th className="py-3 px-3.5 font-bold">الحالة في بازاركو</th>
                    <th className="py-3 px-3.5 font-bold text-center">الإجراءات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 text-slate-200">
                  {queryRows.map((c: any) => {
                    const rawEq = Number(c.equivalent_balance)
                    const rawBal = Number(c.balance)
                    const eqBal = !isNaN(rawEq) && Math.abs(rawEq) > 0.0001 ? rawEq : (!isNaN(rawBal) ? rawBal : 0)
                    const isZero = Math.abs(eqBal) <= 0.01

                    return (
                      <tr key={c.id || c.code} className="hover:bg-slate-800/50 transition-colors">
                        <td className="py-3 px-3.5 font-mono font-bold text-sky-400">{c.code}</td>
                        <td className="py-3 px-3.5 min-w-[200px]">
                          <button
                            onClick={() => setStatementCustomer({ code: c.code, name: c.name })}
                            className="font-bold text-white hover:text-sky-400 text-right block transition"
                          >
                            {c.name}
                          </button>
                          <div className="text-[11px] text-slate-400 font-mono mt-0.5">{c.phone || '—'}</div>
                        </td>
                        <td className="py-3 px-3.5 font-mono font-bold">
                          {isZero ? (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                              مصفى ✓
                            </span>
                          ) : (
                            <span className={eqBal > 0 ? 'text-rose-400 font-black' : 'text-sky-400 font-black'} dir="ltr">
                              {eqBal.toLocaleString('ar-u-nu-latn', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} NIS
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-3.5 font-mono text-slate-300 text-[11px]">
                          {c.last_invoice_date ? new Date(c.last_invoice_date).toLocaleDateString('ar-u-nu-latn') : '—'}
                        </td>
                        <td className="py-3 px-3.5 font-mono text-slate-300 text-[11px]">
                          {c.last_receipt_date ? new Date(c.last_receipt_date).toLocaleDateString('ar-u-nu-latn') : '—'}
                        </td>
                        <td className="py-3 px-3.5">
                          {c.is_promoted ? (
                            <span className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[10px] px-2 py-0.5 rounded-full font-bold">
                              ✓ مرحّل لبازاركو
                            </span>
                          ) : (
                            <span className="bg-slate-800 text-slate-400 border border-white/5 text-[10px] px-2 py-0.5 rounded-full">
                              في الشامل فقط
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-3.5 text-center">
                          <div className="flex items-center justify-center gap-2">
                            <button
                              onClick={() => setStatementCustomer({ code: c.code, name: c.name })}
                              className="px-2.5 py-1.5 bg-sky-500/10 hover:bg-sky-500/20 text-sky-300 border border-sky-500/30 rounded-lg font-bold text-[11px] transition shadow-xs flex items-center gap-1"
                            >
                              <span>📄</span>
                              <span>كشف الحساب</span>
                            </button>
                            <button
                              onClick={() => handlePromote('customers', c.code)}
                              disabled={promotingCode === c.code}
                              className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-white/10 rounded-lg font-bold text-[11px] disabled:opacity-50 transition"
                            >
                              {promotingCode === c.code ? '...' : c.is_promoted ? 'تحديث' : 'نقل لبازاركو'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>

              {renderPagination()}
            </div>
          )}
        </div>
      )}

      {/* ───────────────────────────────────────────────────────── */}
      {/* 2. EXPLORER: CHEQUES (Pure Dark Theme)                    */}
      {/* ───────────────────────────────────────────────────────── */}
      {activeTab === 'explorer_cheques' && (
        <div className="space-y-4">
          {/* 5 KPI Cards (Accurate across all 11,000+ checks via RPC in NIS) */}
          {chequeStats && (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <div className="bg-slate-900 p-4 rounded-2xl border border-white/10 shadow-xl text-center">
                <div className="text-xs text-slate-400 font-medium">إجمالي الشيكات في الشامل</div>
                <div className="text-2xl font-black text-white mt-1 font-mono">
                  {Number(chequeStats.total_count || 0).toLocaleString('ar-u-nu-latn')}
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5 font-bold font-mono" dir="ltr">
                  {Number(chequeStats.total_amount || 0).toLocaleString('ar-u-nu-latn', { minimumFractionDigits: 2 })} NIS
                </div>
              </div>

              <div className="bg-sky-500/5 p-4 rounded-2xl border border-sky-500/20 shadow-xl text-center">
                <div className="text-xs text-sky-400 font-bold">📥 في الصندوق</div>
                <div className="text-2xl font-black text-white mt-1 font-mono">
                  {Number(chequeStats.in_safe_count ?? chequeStats.in_portfolio_count ?? 0).toLocaleString('ar-u-nu-latn')}
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5 font-mono" dir="ltr">
                  {Number(chequeStats.in_safe_amount ?? chequeStats.in_portfolio_amount ?? 0).toLocaleString('ar-u-nu-latn', { minimumFractionDigits: 2 })} NIS
                </div>
              </div>

              <div className="bg-purple-500/5 p-4 rounded-2xl border border-purple-500/20 shadow-xl text-center">
                <div className="text-xs text-purple-400 font-bold">🔄 مجيّرة للغير</div>
                <div className="text-2xl font-black text-white mt-1 font-mono">
                  {Number(chequeStats.endorsed_count || 0).toLocaleString('ar-u-nu-latn')}
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5 font-mono" dir="ltr">
                  {Number(chequeStats.endorsed_amount || 0).toLocaleString('ar-u-nu-latn', { minimumFractionDigits: 2 })} NIS
                </div>
              </div>

              <div className="bg-emerald-500/5 p-4 rounded-2xl border border-emerald-500/20 shadow-xl text-center">
                <div className="text-xs text-emerald-400 font-bold">✓ محصلة في البنك</div>
                <div className="text-2xl font-black text-white mt-1 font-mono">
                  {Number(chequeStats.collected_count || 0).toLocaleString('ar-u-nu-latn')}
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5 font-mono" dir="ltr">
                  {Number(chequeStats.collected_amount || 0).toLocaleString('ar-u-nu-latn', { minimumFractionDigits: 2 })} NIS
                </div>
              </div>

              <div className="bg-rose-500/5 p-4 rounded-2xl border border-rose-500/20 shadow-xl text-center">
                <div className="text-xs text-rose-400 font-bold">⚠️ معادة / راجعة</div>
                <div className="text-2xl font-black text-white mt-1 font-mono">
                  {Number(chequeStats.returned_count ?? chequeStats.bounced_count ?? 0).toLocaleString('ar-u-nu-latn')}
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5 font-mono" dir="ltr">
                  {Number(chequeStats.returned_amount ?? chequeStats.bounced_amount ?? 0).toLocaleString('ar-u-nu-latn', { minimumFractionDigits: 2 })} NIS
                </div>
              </div>
            </div>
          )}

          {/* Dedicated Advanced Cheques Search Toolbar (matching MyShop) */}
          <div className="bg-slate-900 border border-white/10 rounded-2xl shadow-xl p-5 space-y-4">
            <div className="space-y-3">
              {/* Primary Dedicated Search Inputs Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {/* 1. Cheque Number */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-300 mb-1">
                    🔢 رقم الشيك (أو جزء منه)
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      maxLength={30}
                      value={chequeNoInput}
                      onChange={e => handleChequeFilterChange(setChequeNoInput, setChequeNo, e.target.value)}
                      placeholder="مثلاً: 266 أو 30000266"
                      className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-xs font-mono text-white placeholder-slate-500 focus:outline-none focus:border-sky-500"
                    />
                    {chequeNoInput && (
                      <button
                        onClick={() => { setChequeNoInput(''); setChequeNo(''); setCurrentPage(1) }}
                        className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white text-xs"
                        title="مسح"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>

                {/* 2. Cheque Amount */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-300 mb-1">
                    💰 قيمة الشيك (المبلغ)
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      step="any"
                      value={chequeAmountInput}
                      onChange={e => handleChequeFilterChange(setChequeAmountInput, setChequeAmount, e.target.value)}
                      placeholder="المبلغ مثلاً: 5000 أو 750"
                      className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-xs font-mono text-white placeholder-slate-500 focus:outline-none focus:border-sky-500"
                    />
                    {chequeAmountInput && (
                      <button
                        onClick={() => { setChequeAmountInput(''); setChequeAmount(''); setCurrentPage(1) }}
                        className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white text-xs"
                        title="مسح"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>

                {/* 3. Account Number */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-300 mb-1">
                    🏛️ رقم الحساب (أو جزء منه)
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      maxLength={30}
                      value={chequeAccountInput}
                      onChange={e => handleChequeFilterChange(setChequeAccountInput, setChequeAccount, e.target.value)}
                      placeholder="مثلاً: 2366043300"
                      className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-xs font-mono text-white placeholder-slate-500 focus:outline-none focus:border-sky-500"
                    />
                    {chequeAccountInput && (
                      <button
                        onClick={() => { setChequeAccountInput(''); setChequeAccount(''); setCurrentPage(1) }}
                        className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white text-xs"
                        title="مسح"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>

                {/* 4. Customer / Drawer / Endorsed Party Search */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-300 mb-1">
                    🔍 اسم الزبون / الساحب / المجير له
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      maxLength={120}
                      value={searchTerm}
                      onChange={e => { setSearchTerm(e.target.value); setCurrentPage(1) }}
                      placeholder="ابحث بالاسم أو السند..."
                      className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-sky-500"
                    />
                    {searchTerm && (
                      <button
                        onClick={() => { setSearchTerm(''); setCurrentPage(1) }}
                        className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white text-xs"
                        title="مسح"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Secondary Filters Bar: Status, Bank, Due Date Range, Actions */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-white/10 text-xs">
                <div className="flex flex-wrap items-center gap-3">
                  {/* Status Filter */}
                  <div className="flex items-center gap-1.5">
                    <span className="font-bold text-slate-400">الحالة:</span>
                    <select
                      value={chequeStatus}
                      onChange={e => { setChequeStatus(e.target.value); setCurrentPage(1) }}
                      className="rounded-xl border border-white/10 bg-slate-950 px-3 py-1.5 text-xs font-bold text-white focus:outline-none focus:border-sky-500"
                    >
                      <option value="all">جميع الحالات</option>
                      <option value="endorsed">🔄 مجيّر (لمورد / زبون)</option>
                      <option value="in_safe">📥 في الصندوق (الخزينة)</option>
                      <option value="collected">🏦 محصل في البنك</option>
                      <option value="returned">⚠️ معاد / راجع</option>
                    </select>
                  </div>

                  {/* Bank Filter */}
                  <div className="flex items-center gap-1.5">
                    <span className="font-bold text-slate-400">البنك:</span>
                    <select
                      value={chequeBank}
                      onChange={e => { setChequeBank(e.target.value); setCurrentPage(1) }}
                      className="rounded-xl border border-white/10 bg-slate-950 px-3 py-1.5 text-xs font-bold text-white focus:outline-none focus:border-sky-500 max-w-xs"
                    >
                      <option value="all">كل البنوك</option>
                      {Object.entries(PALESTINIAN_BANKS).map(([code, name]) => (
                        <option key={code} value={code}>
                          {name} ({code.replace(/^0+/, '')})
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Due Date Range */}
                  <div className="flex items-center gap-1.5 text-xs text-slate-400 bg-slate-950/80 px-2.5 py-1 rounded-xl border border-white/10">
                    <span className="text-[11px] font-bold">استحقاق:</span>
                    <input
                      type="date"
                      value={chequeDueDateFrom}
                      onChange={e => { setChequeDueDateFrom(e.target.value); setCurrentPage(1) }}
                      className="rounded-lg border border-white/10 bg-slate-900 px-2 py-1 text-xs text-white font-mono outline-none focus:border-sky-500"
                      title="من تاريخ استحقاق"
                    />
                    <span>-</span>
                    <input
                      type="date"
                      value={chequeDueDateTo}
                      onChange={e => { setChequeDueDateTo(e.target.value); setCurrentPage(1) }}
                      className="rounded-lg border border-white/10 bg-slate-900 px-2 py-1 text-xs text-white font-mono outline-none focus:border-sky-500"
                      title="إلى تاريخ استحقاق"
                    />
                    {(chequeDueDateFrom || chequeDueDateTo) && (
                      <button
                        onClick={() => { setChequeDueDateFrom(''); setChequeDueDateTo(''); setCurrentPage(1) }}
                        className="text-xs text-slate-400 hover:text-white px-1"
                        title="مسح التواريخ"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>

                {/* Action buttons: Reset & Refresh & Promote */}
                <div className="flex items-center gap-2">
                  {hasChequeFilters && (
                    <button
                      type="button"
                      onClick={resetChequeFilters}
                      className="px-3 py-1.5 rounded-xl text-xs font-bold bg-rose-500/10 text-rose-400 border border-rose-500/20 hover:bg-rose-500/20 transition"
                    >
                      مسح جميع الفلاتر ✕
                    </button>
                  )}
                  <button
                    onClick={() => setReloadTrigger(r => r + 1)}
                    className="p-1.5 px-3 rounded-xl border border-white/10 bg-slate-800 text-slate-300 hover:bg-slate-700 transition text-xs flex items-center gap-1.5 font-bold"
                    title="تحديث البيانات"
                  >
                    <span>تحديث</span>
                    <span>🔄</span>
                  </button>
                  <button
                    onClick={() => handlePromote('cheques')}
                    disabled={promotingAll || queryRows.length === 0}
                    className="px-3.5 py-1.5 bg-sky-500 hover:bg-sky-400 text-slate-950 rounded-xl text-xs font-bold shrink-0 disabled:opacity-50 transition"
                  >
                    {promotingAll ? 'جاري الترحيل...' : 'ترحيل كافة الشيكات لبازاركو'}
                  </button>
                </div>
              </div>
            </div>

            {queryLoading ? (
              <div className="py-16 text-center text-slate-400 text-xs">
                <div className="text-2xl animate-spin mb-2">⏳</div>
                جاري جلب الشيكات من قاعدة البيانات...
              </div>
            ) : queryRows.length === 0 ? (
              <div className="py-12 text-center text-slate-500 text-xs">لا توجد شيكات تطابق معايير البحث.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-right text-xs">
                  <thead>
                    <tr className="border-b border-white/10 bg-slate-800/60 text-slate-400 font-bold">
                      <th className="py-3 px-3.5">رقم الشيك</th>
                      <th className="py-3 px-3.5">الساحب / الزبون</th>
                      <th className="py-3 px-3.5">تاريخ الاستحقاق</th>
                      <th className="py-3 px-3.5 text-left">المبلغ والعملة</th>
                      <th className="py-3 px-3.5">البنك والحساب</th>
                      <th className="py-3 px-3.5 text-center">الحالة</th>
                      <th className="py-3 px-3.5">الطرف المجير له / المستفيد</th>
                      <th className="py-3 px-3.5">سند القبض / الإجراء</th>
                      <th className="py-3 px-3.5 text-center">كشف الزبون</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 text-slate-200">
                    {queryRows.map((chq: any) => {
                      const cleanTargetName = (chq.target_name || '').replace(/^[\s/]+/, '').trim()

                      return (
                        <tr key={chq.id || `${chq.document}-${chq.cheque_number}`} className="hover:bg-slate-800/50 transition-colors">
                          <td className="py-3 px-3.5">
                            <span className="font-mono font-bold text-sky-400 text-xs bg-slate-950 px-2.5 py-1 rounded-lg border border-white/10 inline-block">
                              #{chq.cheque_number || chq.cheque_no}
                            </span>
                          </td>
                          <td className="py-3 px-3.5 min-w-44">
                            <div className="font-bold text-white">{chq.customer_name || chq.drawer_name || 'غير محدد'}</div>
                            {chq.customer_code && (
                              <div className="text-[11px] text-sky-400 font-mono mt-0.5">كود: {chq.customer_code}</div>
                            )}
                          </td>
                          <td className="py-3 px-3.5 font-mono text-slate-300">
                            {chq.due_date ? new Date(chq.due_date).toLocaleDateString('ar-u-nu-latn') : '—'}
                          </td>
                          <td className="py-3 px-3.5 text-left font-black text-white font-mono" dir="ltr">
                            {Number(chq.amount).toLocaleString('ar-u-nu-latn', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{' '}
                            <span className="text-xs font-sans font-bold text-sky-400">{chq.currency}</span>
                          </td>
                          <td className="py-3 px-3.5 text-xs">
                            <div className="font-bold text-slate-200">{getBankName(chq.bank_code)}</div>
                            <div className="text-slate-400 font-mono text-[11px] mt-0.5" dir="ltr">
                              فرع {chq.branch_code || '—'} · حساب {chq.account_no || '—'}
                            </div>
                          </td>
                          <td className="py-3 px-3.5 text-center">
                            {chq.status_name === 'مجيّر' || chq.status === 'endorsed' ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-purple-500/10 text-purple-400 border border-purple-500/20">
                                🔄 مجيّر
                              </span>
                            ) : chq.status_name === 'في الصندوق' || chq.status === 'in_safe' || chq.status === 'in_portfolio' ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-sky-500/10 text-sky-400 border border-sky-500/20">
                                📥 في الصندوق
                              </span>
                            ) : chq.status_name === 'محصل في البنك' || chq.status === 'collected' ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                ✓ محصل بالبنك
                              </span>
                            ) : (chq.status_name || '').includes('راجع') || (chq.status_name || '').includes('معاد') || chq.status === 'bounced' || chq.status === 'returned' ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-rose-500/10 text-rose-400 border border-rose-500/20">
                                ⚠️ معاد / راجع
                              </span>
                            ) : (
                              <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-bold bg-slate-800 text-slate-300 border border-white/5">
                                {chq.status_name || chq.status || 'غير محدد'}
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-3.5 min-w-56">
                            {chq.status_name === 'مجيّر' || chq.status === 'endorsed' ? (
                              <div className="p-2.5 rounded-xl bg-purple-950/40 border border-purple-900/60 shadow-xs">
                                <div className="text-xs font-bold text-purple-200 flex items-center gap-1.5">
                                  <span className="w-2 h-2 rounded-full bg-purple-500 animate-pulse" />
                                  <span>مجيّر لصالح:</span>
                                  <span className="text-xs font-black text-white">
                                    {cleanTargetName || chq.target_account || '—'}
                                  </span>
                                </div>
                                {chq.target_account && (
                                  <div className="text-[11px] text-purple-300 font-mono mt-1 flex items-center gap-2">
                                    <span>كود: {chq.target_account}</span>
                                    {chq.target_account.startsWith('C') && (
                                      <button
                                        onClick={() => setStatementCustomer({ code: chq.target_account, name: cleanTargetName })}
                                        className="underline hover:text-white font-sans text-sky-400 font-bold"
                                      >
                                        (عرض كشفه)
                                      </button>
                                    )}
                                  </div>
                                )}
                              </div>
                            ) : chq.status_name === 'في الصندوق' || chq.status === 'in_safe' || chq.status === 'in_portfolio' ? (
                              <div className="text-xs text-sky-300 font-bold flex items-center gap-1.5 p-2 rounded-xl bg-sky-950/30 border border-sky-900/40">
                                <span>📦</span>
                                <span>موجود في حافظة الشيكات</span>
                              </div>
                            ) : chq.status_name === 'محصل في البنك' || chq.status === 'collected' ? (
                              <div className="text-xs text-emerald-300 p-2 rounded-xl bg-emerald-950/30 border border-emerald-900/40">
                                <div className="font-bold flex items-center gap-1.5">
                                  <span>🏦</span>
                                  <span>{cleanTargetName || 'الحساب الجاري بالبنك'}</span>
                                </div>
                                {chq.target_account && (
                                  <div className="text-[11px] text-slate-400 font-mono mt-0.5">
                                    حساب: {chq.target_account}
                                  </div>
                                )}
                              </div>
                            ) : (chq.status_name || '').includes('راجع') || (chq.status_name || '').includes('معاد') || chq.status === 'bounced' || chq.status === 'returned' ? (
                              <div className="text-xs text-rose-300 font-bold flex items-center gap-1.5 p-2 rounded-xl bg-rose-950/30 border border-rose-900/40">
                                <span>⚠️</span>
                                <span>معاد / راجع من البنك</span>
                              </div>
                            ) : (
                              <span className="text-slate-400 text-xs">{cleanTargetName || '—'}</span>
                            )}
                          </td>
                          <td className="py-3 px-3.5 font-mono text-xs">
                            <div>
                              <span className="text-[10px] text-slate-400 font-sans">القبض:</span>{' '}
                              <span className="font-bold text-slate-200">{chq.document}</span>
                            </div>
                            {chq.action_doc && chq.action_doc !== chq.document && (
                              <div className="mt-0.5">
                                <span className="text-[10px] text-slate-400 font-sans">الإجراء:</span>{' '}
                                <span className="font-bold text-sky-400">{chq.action_doc}</span>
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-3.5 text-center">
                            <div className="flex items-center justify-center gap-1.5">
                              <button
                                disabled={!chq.customer_code}
                                onClick={() => setStatementCustomer({ code: chq.customer_code, name: chq.customer_name || chq.drawer_name })}
                                className="px-2.5 py-1.5 rounded-lg text-xs font-bold bg-sky-500/10 hover:bg-sky-500/20 text-sky-300 border border-sky-500/30 transition disabled:opacity-30 flex items-center gap-1"
                              >
                                <span>كشف الزبون</span>
                                <span>←</span>
                              </button>
                              <button
                                onClick={() => setSelectedCheque(chq)}
                                className="px-2 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-white/10 rounded-lg font-bold text-[11px] transition"
                                title="تفاصيل الشيك"
                              >
                                🔍
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>

                {renderPagination()}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ───────────────────────────────────────────────────────── */}
      {/* 3. EXPLORER: STOCK (Pure Dark Theme)                      */}
      {/* ───────────────────────────────────────────────────────── */}
      {activeTab === 'explorer_stock' && (
        <div className="bg-slate-900 border border-white/10 rounded-2xl shadow-xl p-6 space-y-4">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-bold text-white">أصناف وبضاعة الشامل</h2>
              <p className="text-xs text-slate-400">
                إجمالي الأصناف: <span className="font-bold text-white font-mono">{queryTotal.toLocaleString('ar-u-nu-latn')}</span> صنف • انقر على أي صنف لعرض سجل حركته وتفاصيل فواتيره، أو رحّله لنقاط بيع بازاركو.
              </p>
            </div>

            <div className="flex items-center gap-3 w-full md:w-auto">
              <input
                type="text"
                value={searchTerm}
                onChange={e => { setSearchTerm(e.target.value); setCurrentPage(1) }}
                placeholder="بحث باسم الصنف، الكود، الباركود..."
                className="px-3.5 py-2 text-xs border border-white/10 bg-slate-950 text-white placeholder-slate-500 rounded-xl outline-none focus:border-sky-500 w-full md:w-64"
              />
              <button
                onClick={() => handlePromote('stock')}
                disabled={promotingAll || queryRows.length === 0}
                className="px-4 py-2 bg-sky-500 hover:bg-sky-400 text-slate-950 rounded-xl text-xs font-bold shrink-0 disabled:opacity-50 transition"
              >
                {promotingAll ? 'جاري الترحيل...' : 'ترحيل كافة الأصناف لبازاركو'}
              </button>
            </div>
          </div>

          {queryLoading ? (
            <div className="py-16 text-center text-slate-400 text-xs">
              <div className="text-2xl animate-spin mb-2">⏳</div>
              جاري جلب الأصناف من مستودع الشامل...
            </div>
          ) : queryRows.length === 0 ? (
            <div className="py-12 text-center text-slate-500 text-xs">لا توجد أصناف تطابق البحث.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead>
                  <tr className="border-b border-white/10 bg-slate-800/60 text-slate-400">
                    <th className="py-3 px-3.5 font-bold">كود الصنف</th>
                    <th className="py-3 px-3.5 font-bold">اسم الصنف</th>
                    <th className="py-3 px-3.5 font-bold">الباركود</th>
                    <th className="py-3 px-3.5 font-bold">سعر التكلفة</th>
                    <th className="py-3 px-3.5 font-bold">الكمية بالمخزن</th>
                    <th className="py-3 px-3.5 font-bold text-center">الإجراءات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 text-slate-200">
                  {queryRows.map((item: any) => (
                    <tr key={item.id} className="hover:bg-slate-800/50 transition-colors">
                      <td className="py-3 px-3.5 font-mono font-bold text-sky-400">{item.code}</td>
                      <td className="py-3 px-3.5">
                        <button
                          onClick={() => setItemCardProduct({ code: item.code, name: item.name })}
                          className="font-bold text-white hover:text-sky-400 text-right transition"
                        >
                          {item.name}
                        </button>
                      </td>
                      <td className="py-3 px-3.5 font-mono text-slate-400">{item.barcode || '—'}</td>
                      <td className="py-3 px-3.5 font-bold text-white font-mono" dir="ltr">
                        {Number(item.cost_price || 0) > 0 ? (
                          <span>{Number(item.cost_price).toLocaleString('ar-u-nu-latn', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {store.currency_code}</span>
                        ) : (
                          <span className="text-slate-500">—</span>
                        )}
                      </td>
                      <td className="py-3 px-3.5 font-bold font-mono">
                        <span className={Number(item.quantity) > 0 ? 'text-emerald-400' : 'text-slate-500'}>
                          {Number(item.quantity).toLocaleString('ar-u-nu-latn')}
                        </span>
                      </td>
                      <td className="py-3 px-3.5 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={() => setItemCardProduct({ code: item.code, name: item.name })}
                            className="px-2.5 py-1.5 bg-sky-500/10 hover:bg-sky-500/20 text-sky-300 border border-sky-500/30 rounded-lg font-bold text-[11px] transition shadow-xs flex items-center gap-1"
                          >
                            <span>🏷️</span>
                            <span>كشف الصنف</span>
                          </button>
                          <button
                            onClick={() => handlePromote('stock', item.code)}
                            disabled={promotingCode === item.code}
                            className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-white/10 rounded-lg font-bold text-[11px] disabled:opacity-50 transition"
                          >
                            {promotingCode === item.code ? '...' : item.is_promoted ? 'مرحّل' : 'نقل لبازاركو'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {renderPagination()}
            </div>
          )}
        </div>
      )}

      {/* ───────────────────────────────────────────────────────── */}
      {/* 4. EXPLORER: ACCOUNTS (Pure Dark Theme)                   */}
      {/* ───────────────────────────────────────────────────────── */}
      {activeTab === 'explorer_accounts' && (
        <div className="bg-slate-900 border border-white/10 rounded-2xl shadow-xl p-6 space-y-4">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-bold text-white">دليل وشجرة حسابات الشامل</h2>
              <p className="text-xs text-slate-400">
                إجمالي الحسابات: <span className="font-bold text-white font-mono">{queryTotal.toLocaleString('ar-u-nu-latn')}</span> حساب • تشمل الأصول، الخصوم، الإيرادات، والمصروفات.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <input
                type="text"
                value={searchTerm}
                onChange={e => { setSearchTerm(e.target.value); setCurrentPage(1) }}
                placeholder="بحث برقم الحساب أو الاسم..."
                className="px-3.5 py-2 text-xs border border-white/10 bg-slate-950 text-white placeholder-slate-500 rounded-xl outline-none focus:border-sky-500 w-64"
              />
              <button
                onClick={() => handlePromote('accounts')}
                disabled={promotingAll || queryRows.length === 0}
                className="px-4 py-2 bg-sky-500 hover:bg-sky-400 text-slate-950 rounded-xl text-xs font-bold shrink-0 disabled:opacity-50 transition"
              >
                {promotingAll ? 'جاري الترحيل...' : 'ترحيل الشجرة لبازاركو'}
              </button>
            </div>
          </div>

          {queryLoading ? (
            <div className="py-16 text-center text-slate-400 text-xs">
              <div className="text-2xl animate-spin mb-2">⏳</div>
              جاري جلب الحسابات...
            </div>
          ) : queryRows.length === 0 ? (
            <div className="py-12 text-center text-slate-500 text-xs">لا توجد حسابات.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead>
                  <tr className="border-b border-white/10 bg-slate-800/60 text-slate-400">
                    <th className="py-3 px-3.5 font-bold">رقم الحساب</th>
                    <th className="py-3 px-3.5 font-bold">اسم الحساب</th>
                    <th className="py-3 px-3.5 font-bold">الحساب الأب</th>
                    <th className="py-3 px-3.5 font-bold">النوع المحاسبي</th>
                    <th className="py-3 px-3.5 font-bold">الرصيد</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 text-slate-200">
                  {queryRows.map((acc: any) => (
                    <tr key={acc.id} className="hover:bg-slate-800/50">
                      <td className="py-3 px-3.5 font-mono font-bold text-white">{acc.code}</td>
                      <td className="py-3 px-3.5 font-bold text-sky-300">{acc.name}</td>
                      <td className="py-3 px-3.5 font-mono text-slate-400">{acc.parent_code || '—'}</td>
                      <td className="py-3 px-3.5">
                        <span className="bg-slate-800 text-slate-300 border border-white/5 text-[10px] px-2 py-0.5 rounded font-bold">
                          {acc.type === 'asset' ? 'أصول' : acc.type === 'liability' ? 'خصوم' : acc.type === 'revenue' ? 'إيراد' : 'مصروف'}
                        </span>
                      </td>
                      <td className="py-3 px-3.5 font-bold font-mono text-white">
                        {Number(acc.balance).toLocaleString('ar-u-nu-latn')} {acc.currency}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {renderPagination()}
            </div>
          )}
        </div>
      )}

      {/* ───────────────────────────────────────────────────────── */}
      {/* 5. TAB: IMPORT NEW FILES WIZARD (Pure Dark Theme)         */}
      {/* ───────────────────────────────────────────────────────── */}
      {activeTab === 'import_wizard' && (
        <div className="space-y-6">
          {!parsedData && !importing && (
            <div
              onDragOver={e => e.preventDefault()}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-white/15 hover:border-sky-500 bg-slate-900/60 hover:bg-sky-500/5 transition-all rounded-2xl p-12 text-center cursor-pointer shadow-xl group"
            >
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".zip,.dat,.DAT"
                onChange={handleFileSelect}
                className="hidden"
              />
              <div className="w-16 h-16 bg-sky-500/10 text-sky-400 rounded-full flex items-center justify-center mx-auto mb-4 text-3xl group-hover:scale-110 transition-transform">
                {parsing ? '⏳' : '📁'}
              </div>
              <h3 className="text-lg font-bold text-white mb-1">
                {parsing ? 'جاري فحص وقراءة ملفات الشامل...' : 'اسحب وأفلت ملف الـ ZIP لفرعك هنا'}
              </h3>
              <p className="text-slate-400 text-sm max-w-md mx-auto mb-4">
                يقوم النظام تلقائياً بتجاوز أي مجلدات مكررة أو فرعية واستخراج الملفات الأساسية وحفظها في قسم الاستعلام المعزول.
              </p>
              <div className="inline-flex items-center gap-2 bg-sky-500 text-slate-950 text-xs font-bold px-4 py-2.5 rounded-xl shadow-md hover:bg-sky-400 transition">
                <span>تصفح واختيار الملف</span>
              </div>
            </div>
          )}

          {parsedData && !importing && (
            <div className="space-y-6">
              <div className="bg-slate-900 border border-white/10 rounded-2xl p-6 shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                <div>
                  <h2 className="text-lg font-bold text-white">
                    تم فحص حزمة الشامل: <span className="text-sky-400 font-mono">{sourceFilename}</span>
                  </h2>
                  <p className="text-xs text-slate-400 mt-1">
                    سيتم حفظ هذه البيانات أولاً في مستودع استعلام الشامل الخاص بمتجرك، لتتمكن من تصفحها وموائمتها بحرية.
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => { setParsedData(null); setSourceFilename('') }}
                    className="px-4 py-2 text-xs font-semibold text-slate-300 bg-slate-800 hover:bg-slate-700 rounded-xl"
                  >
                    إلغاء
                  </button>
                  <button
                    onClick={handleSaveToIsolatedStore}
                    className="px-6 py-2.5 text-sm font-bold text-slate-950 bg-sky-500 hover:bg-sky-400 rounded-xl shadow-lg flex items-center gap-2 transition"
                  >
                    <span>💾</span>
                    تخزين واستعلام بيانات الشامل
                  </button>
                </div>
              </div>

              {/* Detected Cards */}
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                <div className="bg-slate-900 p-4 rounded-2xl border border-white/10 shadow-xl">
                  <div className="text-xs text-slate-400">الحسابات المكتشفة</div>
                  <div className="text-2xl font-black text-sky-400 mt-1 font-mono">{parsedData.accounts.length.toLocaleString('ar-u-nu-latn')}</div>
                </div>
                <div className="bg-slate-900 p-4 rounded-2xl border border-white/10 shadow-xl">
                  <div className="text-xs text-slate-400">الزبائن والعملاء</div>
                  <div className="text-2xl font-black text-blue-400 mt-1 font-mono">{parsedData.customers.length.toLocaleString('ar-u-nu-latn')}</div>
                </div>
                <div className="bg-slate-900 p-4 rounded-2xl border border-white/10 shadow-xl">
                  <div className="text-xs text-slate-400">الأصناف والمخزون</div>
                  <div className="text-2xl font-black text-emerald-400 mt-1 font-mono">{parsedData.products.length.toLocaleString('ar-u-nu-latn')}</div>
                </div>
                <div className="bg-slate-900 p-4 rounded-2xl border border-white/10 shadow-xl">
                  <div className="text-xs text-slate-400">محفظة الشيكات</div>
                  <div className="text-2xl font-black text-amber-400 mt-1 font-mono">{parsedData.cheques.length.toLocaleString('ar-u-nu-latn')}</div>
                </div>
                <div className="bg-slate-900 p-4 rounded-2xl border border-white/10 shadow-xl">
                  <div className="text-xs text-slate-400">قيود دفتر الأستاذ</div>
                  <div className="text-2xl font-black text-indigo-400 mt-1 font-mono">{parsedData.entries?.length?.toLocaleString('ar-u-nu-latn') || 0}</div>
                </div>
                <div className="bg-slate-900 p-4 rounded-2xl border border-white/10 shadow-xl">
                  <div className="text-xs text-slate-400">أسطر الفواتير</div>
                  <div className="text-2xl font-black text-purple-400 mt-1 font-mono">{parsedData.invoiceItems?.length?.toLocaleString('ar-u-nu-latn') || 0}</div>
                </div>
              </div>
            </div>
          )}

          {importing && (
            <div className="bg-slate-900 border border-white/10 rounded-2xl p-8 shadow-xl text-center space-y-6">
              <div className="w-16 h-16 bg-sky-500/10 text-sky-400 rounded-full flex items-center justify-center mx-auto text-2xl animate-pulse">
                ⏳
              </div>
              <div>
                <h3 className="text-xl font-bold text-white mb-2">جاري تخزين بيانات الشامل...</h3>
                <p className="text-slate-400 text-sm">{currentStepText}</p>
              </div>
              <div className="max-w-xl mx-auto space-y-2">
                <div className="w-full bg-slate-950 rounded-full h-4 overflow-hidden p-0.5 border border-white/10">
                  <div
                    className="bg-sky-500 h-full rounded-full transition-all duration-300"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
                <div className="flex justify-between text-xs font-bold text-slate-400 font-mono">
                  <span>{progressPercent}% مكتمل</span>
                  <span>حفظ معزول</span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ───────────────────────────────────────────────────────── */}
      {/* 6. TAB: GOOGLE DRIVE SYNC (Pure Dark Theme)               */}
      {/* ───────────────────────────────────────────────────────── */}
      {activeTab === 'gdrive' && (
        <div className="bg-slate-900 border border-white/10 rounded-2xl p-6 shadow-xl space-y-6">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div>
              <h3 className="text-base font-bold text-white">المزامنة السحابية الدورية عبر Google Drive</h3>
              <p className="text-xs text-slate-400 mt-1">
                تحديث ملفات المحل وسحب التغييرات اليومية بشكل آلي ومباشر.
              </p>
            </div>
            <button
              onClick={handleSyncNow}
              disabled={syncingNow || !folderIdInput}
              className="px-5 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded-xl shadow-md disabled:opacity-50 flex items-center gap-2 transition"
            >
              <span>{syncingNow ? '⏳' : '🔄'}</span>
              <span>{syncingNow ? 'جاري المزامنة...' : 'مزامنة الآن'}</span>
            </button>
          </div>

          <form onSubmit={handleSaveGdriveConfig} className="space-y-4 max-w-2xl">
            <div>
              <label className="block text-xs font-bold text-slate-300 mb-1.5">
                معرف مجلد Google Drive (Folder ID):
              </label>
              <input
                type="text"
                value={folderIdInput}
                onChange={e => setFolderIdInput(e.target.value)}
                placeholder="معرف مجلد فرعك في Google Drive..."
                className="w-full px-3.5 py-2.5 text-sm border border-white/10 bg-slate-950 text-white rounded-xl font-mono outline-none focus:border-sky-500"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-300 mb-1.5">اسم المجلد:</label>
              <input
                type="text"
                value={folderNameInput}
                onChange={e => setFolderNameInput(e.target.value)}
                className="w-full px-3.5 py-2.5 text-sm border border-white/10 bg-slate-950 text-white rounded-xl outline-none focus:border-sky-500"
              />
            </div>

            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoSyncInput}
                  onChange={e => setAutoSyncInput(e.target.checked)}
                  className="w-4 h-4 rounded text-sky-500 focus:ring-sky-500 bg-slate-950 border-white/10"
                />
                <span className="text-xs font-bold text-slate-300">تفعيل المزامنة المجدولة تلقائياً</span>
              </label>
            </div>

            <div className="pt-4 border-t border-white/10 flex justify-end">
              <button
                type="submit"
                disabled={savingConfig}
                className="px-6 py-2.5 bg-sky-500 hover:bg-sky-400 text-slate-950 text-xs font-bold rounded-xl disabled:opacity-50 transition"
              >
                {savingConfig ? 'جاري الحفظ...' : 'حفظ الإعدادات'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ───────────────────────────────────────────────────────── */}
      {/* MODAL: CUSTOMER STATEMENT                                 */}
      {/* ───────────────────────────────────────────────────────── */}
      {statementCustomer && (
        <ShamelStatementModal
          isOpen={true}
          onClose={() => setStatementCustomer(null)}
          customerCode={statementCustomer.code}
          customerName={statementCustomer.name}
          storeName={store.name}
          currencyCode={store.currency_code}
        />
      )}

      {/* ───────────────────────────────────────────────────────── */}
      {/* MODAL: ITEM MOVEMENT CARD                                 */}
      {/* ───────────────────────────────────────────────────────── */}
      {itemCardProduct && (
        <ShamelItemCardModal
          isOpen={true}
          onClose={() => setItemCardProduct(null)}
          itemCode={itemCardProduct.code}
          itemName={itemCardProduct.name}
          storeName={store.name}
          currencyCode={store.currency_code}
        />
      )}

      {/* ───────────────────────────────────────────────────────── */}
      {/* MODAL: CHEQUE DETAIL INSPECTION                           */}
      {/* ───────────────────────────────────────────────────────── */}
      {selectedCheque && (
        <ShamelChequeDetailModal
          isOpen={true}
          onClose={() => setSelectedCheque(null)}
          cheque={selectedCheque}
          currencyCode={store.currency_code}
          onOpenCustomerStatement={code => {
            setSelectedCheque(null)
            setStatementCustomer({ code })
          }}
          onPromote={doc => handlePromote('cheques', doc)}
        />
      )}

      {/* ───────────────────────────────────────────────────────── */}
      {/* MODAL: WIPE & RESET CONFIRMATION (Pure Dark)              */}
      {/* ───────────────────────────────────────────────────────── */}
      {showWipeModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-white/10 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 text-right text-white">
            <div className="w-12 h-12 rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/20 flex items-center justify-center text-2xl mx-auto">
              ⚠️
            </div>
            <div className="text-center">
              <h3 className="text-lg font-bold text-white">تأكيد إفراغ كافة بيانات الشامل للمتجر</h3>
              <p className="text-xs text-slate-400 mt-2 leading-relaxed">
                هل أنت متأكد من رغبتك في حذف كافة الحسابات والزبائن والمخزون والشيكات المستوردة لمتجر <span className="font-bold text-white">«{store.name}»</span>؟
                ستتمكن بعد ذلك من رفع ملف الشامل الصحيح من جديد بصفحة بيضاء نظيفة.
              </p>
            </div>

            <div className="flex items-center justify-end gap-3 pt-4 border-t border-white/10">
              <button
                type="button"
                onClick={() => setShowWipeModal(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-800 rounded-xl"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={handleWipeStore}
                disabled={wiping}
                className="px-5 py-2 bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold rounded-xl shadow-sm disabled:opacity-50 transition"
              >
                {wiping ? 'جاري الإفراغ...' : 'نعم، احذف وابدأ من جديد'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
