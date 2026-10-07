'use client'

import { useEffect, useRef, useState } from 'react'
import styles from './directory.module.css'
import {filterCustomers,whatsappNumber,csvCell} from '@/lib/customers/directory'
import {BUSINESS_TIME_ZONE} from '@/lib/dashboard/simple-metrics'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import ShamelStatementModal from '@/app/dashboard/accounting/shamel/components/ShamelStatementModal'
import WhatsAppContactMenu from '@/components/whatsapp/WhatsAppContactMenu'

interface Customer {
  id: string
  name: string
  phone: string | null
  email: string | null
  city: string | null
  address: string | null
  notes: string | null
  social_url: string | null
  credit_limit: number | null
  balance: number
  total_orders: number
  customer_type: string
  is_active: boolean
  created_at: string
  shamel_code?: string | null
  last_order_at?: string | null
  last_payment_at?: string | null
  whatsapp_prefix?: string | null
}

interface Props {
  customers: Customer[]
  currencyCode: string
  storeId: string
  storeName?: string
  activeType: string
  searchQuery: string
  sort: string
  lastOrderDates: Record<string, string>
  countryCode?: string
  preview?: boolean
  loadError?: boolean
  orderError?: boolean
  initShowAdd?: boolean
}

const TYPE_LABELS: Record<string, { label: string; color: string }> = {
  retail:    { label: 'تجزئة',   color: 'bg-slate-500/15 text-slate-400' },
  wholesale: { label: 'جملة',    color: 'bg-blue-500/15 text-blue-400' },
  vip:       { label: 'VIP',     color: 'bg-amber-500/15 text-amber-400' },
}

const TYPE_TABS = [
  { key: 'all',       label: 'الكل' },
  { key: 'retail',    label: 'تجزئة' },
  { key: 'wholesale', label: 'جملة' },
  { key: 'vip',       label: 'VIP' },
]

function daysSince(dateStr: string): { text: string; level: 'fresh' | 'normal' | 'stale' } {
  const days = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86_400_000)
  const text =
    days === 0 ? 'اليوم' :
    days === 1 ? 'أمس' :
    days < 7  ? `منذ ${days} أيام` :
    days < 30 ? `منذ ${Math.floor(days / 7)} أسابيع` :
    days < 365 ? `منذ ${Math.floor(days / 30)} شهر` :
    `منذ ${Math.floor(days / 365)} سنة`
  const level = days <= 7 ? 'fresh' : days <= 30 ? 'normal' : 'stale'
  return { text, level }
}

function exportCSV(customers: Customer[], currencyCode: string, lastOrderDates: Record<string, string>) {
  const headers = ['الاسم', 'الهاتف', 'البريد الإلكتروني', 'المدينة', 'النوع', 'الطلبيات', 'الذمة', 'آخر طلبية']
  const rows = customers.map(c => [
    c.name,
    c.phone ?? '',
    c.email ?? '',
    c.city ?? '',
    TYPE_LABELS[c.customer_type]?.label ?? c.customer_type,
    c.total_orders,
    `${c.balance} ${currencyCode}`,
    lastOrderDates[c.id] ? new Date(lastOrderDates[c.id]).toLocaleDateString('ar-u-nu-latn',{timeZone:BUSINESS_TIME_ZONE}) : '',
  ])
  const csv = [headers, ...rows]
    .map(row => row.map(csvCell).join(','))
    .join('\n')
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `زبائن-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

interface ColumnDef {
  id: string
  label: string
  defaultVisible: boolean
}

const ALL_COLUMNS: ColumnDef[] = [
  { id: 'name', label: 'الزبون', defaultVisible: true },
  { id: 'phone', label: 'التواصل', defaultVisible: true },
  { id: 'customer_type', label: 'النوع', defaultVisible: true },
  { id: 'created_at', label: 'تاريخ التسجيل', defaultVisible: true },
  { id: 'total_orders', label: 'طلبيات بازاركو', defaultVisible: true },
  { id: 'balance', label: 'الذمة / الرصيد', defaultVisible: true },
  { id: 'last_order', label: 'آخر طلبية بازاركو', defaultVisible: true },
  { id: 'last_shamel_invoice', label: 'آخر فاتورة شامل', defaultVisible: true },
  { id: 'last_shamel_payment', label: 'آخر دفعة شامل', defaultVisible: true },
]

const DEFAULT_VISIBLE_COLUMNS = ALL_COLUMNS.reduce((acc, col) => {
  acc[col.id] = col.defaultVisible
  return acc
}, {} as Record<string, boolean>)

export default function CustomersTable({
  customers, currencyCode, storeId, storeName = 'متجر بازاركو', activeType, searchQuery, sort, lastOrderDates, initShowAdd, countryCode='PS', preview=false, loadError=false, orderError=false,
}: Props) {
  const router = useRouter()
  const [query, setQuery] = useState(searchQuery)
  const [type, setType] = useState(activeType)
  const [city, setCity] = useState('')
  const [debt, setDebt] = useState('all')
  const [hideZero, setHideZero] = useState(false)
  const [advanced, setAdvanced] = useState(false)
  const [page, setPage] = useState(1)
  const [sortField, setSortField] = useState<string>(sort || 'created_at')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')
  const [mutationError, setMutationError] = useState('')
  const [showColSettings, setShowColSettings] = useState(false)
  const [visibleColumns, setVisibleColumns] = useState<Record<string, boolean>>(DEFAULT_VISIBLE_COLUMNS)
  const [statementCustomer, setStatementCustomer] = useState<Customer | null>(null)

  // Load custom columns preferences
  useEffect(() => {
    try {
      const saved = localStorage.getItem(`bazarko_cust_cols_${storeId}`)
      if (saved) {
        const parsed = JSON.parse(saved)
        setVisibleColumns(prev => ({ ...prev, ...parsed }))
      }
    } catch {}
  }, [storeId])

  function toggleColumn(colId: string) {
    setVisibleColumns(prev => {
      const next = { ...prev, [colId]: !prev[colId] }
      try {
        localStorage.setItem(`bazarko_cust_cols_${storeId}`, JSON.stringify(next))
      } catch {}
      return next
    })
  }

  function handleSort(columnId: string) {
    if (sortField === columnId) {
      setSortOrder(prev => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(columnId)
      setSortOrder('desc')
    }
  }

  // Filter customers
  const filtered = filterCustomers(customers, query, type, city, hideZero ? 'non_zero' : debt, 'created_at')

  // Client-side sort based on header click
  const visible = [...filtered].sort((a, b) => {
    let comparison = 0
    switch (sortField) {
      case 'name':
        comparison = a.name.localeCompare(b.name, 'ar')
        break
      case 'phone':
        comparison = (a.phone || '').localeCompare(b.phone || '')
        break
      case 'customer_type':
        comparison = a.customer_type.localeCompare(b.customer_type)
        break
      case 'created_at':
        comparison = new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        break
      case 'total_orders':
      case 'orders':
        comparison = a.total_orders - b.total_orders
        break
      case 'balance':
        comparison = a.balance - b.balance
        break
      case 'last_order': {
        const da = lastOrderDates[a.id] ? new Date(lastOrderDates[a.id]).getTime() : 0
        const db = lastOrderDates[b.id] ? new Date(lastOrderDates[b.id]).getTime() : 0
        comparison = da - db
        break
      }
      case 'last_shamel_invoice': {
        const da = a.last_order_at ? new Date(a.last_order_at).getTime() : 0
        const db = b.last_order_at ? new Date(b.last_order_at).getTime() : 0
        comparison = da - db
        break
      }
      case 'last_shamel_payment': {
        const da = a.last_payment_at ? new Date(a.last_payment_at).getTime() : 0
        const db = b.last_payment_at ? new Date(b.last_payment_at).getTime() : 0
        comparison = da - db
        break
      }
      default:
        comparison = new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    }
    return sortOrder === 'asc' ? comparison : -comparison
  })

  const PAGE_SIZE = 20
  const pages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE))
  const currentPage = Math.min(page, pages)
  useEffect(() => { setPage(1) }, [query, type, city, debt, hideZero, sortField, sortOrder])
  useEffect(() => { setQuery(searchQuery); setType(activeType); if (sort) setSortField(sort) }, [searchQuery, activeType, sort])

  const busy = useRef(false)
  const [showAdd, setShowAdd] = useState(initShowAdd || false)
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null)
  const [deletingCustomer, setDeletingCustomer] = useState<Customer | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importMsg, setImportMsg] = useState('')
  const [form, setForm] = useState({
    name: '', phone: '', email: '', city: '', address: '',
    customer_type: 'retail', notes: '', credit_limit: '0', social_url: '',
  })

  useEffect(()=>{
    if(!showAdd&&!editingCustomer&&!deletingCustomer)return
    const previous=document.activeElement as HTMLElement|null
    const dialog=document.querySelector<HTMLElement>('[role="dialog"]')
    const first=dialog?.querySelector<HTMLElement>('input, button, select, textarea, a[href]')
    first?.focus()
    function keyboard(event:KeyboardEvent){
      if(event.key==='Escape'&&!busy.current){setShowAdd(false);setEditingCustomer(null);setDeletingCustomer(null)}
      if(event.key!=='Tab'||!dialog)return
      const controls=Array.from(dialog.querySelectorAll<HTMLElement>('input, button, select, textarea, a[href]')).filter(el=>!el.hasAttribute('disabled'))
      const first=controls[0],last=controls[controls.length-1]
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}
    }
    document.addEventListener('keydown',keyboard)
    return ()=>{document.removeEventListener('keydown',keyboard);previous?.focus()}
  },[showAdd,editingCustomer,deletingCustomer])

  function handleEditClick(c: Customer) {
    setForm({
      name: c.name, phone: c.phone ?? '', email: c.email ?? '', city: c.city ?? '',
      address: c.address ?? '', customer_type: c.customer_type, notes: c.notes ?? '',
      credit_limit: String(c.credit_limit ?? 0), social_url: c.social_url ?? ''
    })
    setMutationError('')
    setShowAdd(false)
    setEditingCustomer(c)
  }

  function handleCancelEdit() {
    setEditingCustomer(null)
    setForm({ name: '', phone: '', email: '', city: '', address: '', customer_type: 'retail', notes: '', credit_limit: '0', social_url: '' })
  }

  async function importFromContacts() {
    const nav = navigator as Navigator & { contacts?: { select: (props: string[], opts: object) => Promise<Array<{ name?: string[]; tel?: string[]; email?: string[] }>> } }
    if (!nav.contacts) {
      setImportMsg('المتصفح الحالي لا يدعم اختيار جهات الاتصال. أدخل البيانات يدوياً.')
      setTimeout(() => setImportMsg(''), 4000)
      return
    }
    setImporting(true)
    try {
      const results = await nav.contacts.select(['name', 'tel', 'email'], { multiple: false })
      if (results && results.length > 0) {
        const c = results[0]
        setForm(f => ({
          ...f,
          name:  c.name?.[0]  ?? f.name,
          phone: c.tel?.[0]?.replace(/\s+/g, '') ?? f.phone,
          email: c.email?.[0] ?? f.email,
        }))
      }
    } catch {
      // المستخدم ألغى الاختيار
    }
    setImporting(false)
  }

  async function saveCustomer(e: React.FormEvent) {
    e.preventDefault()
    if(busy.current)return
    setMutationError('')
    if(!form.name.trim()||!Number.isFinite(Number(form.credit_limit))||Number(form.credit_limit)<0){setMutationError('تحقق من الاسم وحد الائتمان');return}
    if(preview){setMutationError('معاينة فقط؛ لم يتم حفظ بيانات.');return}
    busy.current=true
    setSaving(true)
    const supabase = createClient()
    const data = {
      name: form.name.trim(),
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      city: form.city.trim() || null,
      address: form.address.trim() || null,
      customer_type: form.customer_type,
      notes: form.notes.trim() || null,
      credit_limit: parseFloat(form.credit_limit) || 0,
      social_url: form.social_url.trim() || null,
    }
    
    try {
    let error;
    if (editingCustomer) {
      const { error: err } = await supabase.from('customers').update({ ...data, updated_at: new Date().toISOString() }).eq('id', editingCustomer.id).eq('store_id',storeId).select('id').single()
      error = err
    } else {
      const { error: err } = await supabase.from('customers').insert({ store_id: storeId, ...data }).select('id').single()
      error = err
    }
    
    busy.current=false
    setSaving(false)
    if(error)setMutationError('تعذر حفظ الزبون. تحقق من البيانات والصلاحيات ثم أعد المحاولة.')
    if (!error) {
      setShowAdd(false)
      setEditingCustomer(null)
      setForm({ name: '', phone: '', email: '', city: '', address: '', customer_type: 'retail', notes: '', credit_limit: '0', social_url: '' })
      router.refresh()
    }
    } catch {setMutationError('تعذر الاتصال لحفظ الزبون. أعد المحاولة.')}
    finally {busy.current=false;setSaving(false)}
  }

  async function deleteCustomer() {
    if(!deletingCustomer || busy.current)return
    setMutationError('')
    if(preview){setMutationError('معاينة فقط؛ لم تُحذف بيانات.');return}
    busy.current=true;setDeleting(true)
    try {
      const {error}=await createClient().from('customers').delete().eq('id',deletingCustomer.id).eq('store_id',storeId).select('id').single()
      if(error)throw error
      setDeletingCustomer(null);router.refresh()
    } catch {setMutationError('تعذر حذف الزبون؛ قد توجد معاملات مرتبطة به أو صلاحيات غير كافية.')}
    finally {busy.current=false;setDeleting(false)}
  }

  return (
    <div className={`${styles.table} space-y-3`}>
      {/* صف البحث وأزرار الإجراءات */}
      <div className={styles.toolbar}>
        <form onSubmit={e=>e.preventDefault()} className="flex flex-1 gap-2">
          <input
            name="q"
            value={query}
            onChange={e=>setQuery(e.target.value)}
            aria-label="البحث عن زبون"
            placeholder="ابحث بالاسم، الهاتف، أو البريد..."
            className="flex-1 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm leading-relaxed text-white placeholder-slate-500 outline-none focus:border-sky-500/50"
          />
          <button
            type="submit"
            className="rounded-xl border border-white/10 px-4 py-3 text-sm text-slate-300 hover:bg-white/5 hover:text-white transition-colors"
          >
            بحث
          </button>
        </form>

        {/* زر إخفاء أصحاب الرصيد الصفري */}
        <button
          type="button"
          onClick={() => setHideZero(v => !v)}
          className={`shrink-0 flex items-center gap-1.5 rounded-xl border px-3.5 py-3 text-sm font-medium transition-colors ${
            hideZero
              ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
              : 'border-white/10 text-slate-400 hover:bg-white/5 hover:text-white'
          }`}
          title="إخفاء الزبائن الذين رصيدهم صفر"
        >
          <span>{hideZero ? '✓' : '∅'}</span>
          <span>إخفاء الأرصدة الصفرية</span>
        </button>

        {/* تخصيص الأعمدة */}
        <button
          type="button"
          onClick={() => setShowColSettings(true)}
          className="shrink-0 flex items-center gap-1.5 rounded-xl border border-white/10 px-3 py-3 text-sm text-slate-300 hover:bg-white/5 hover:text-white transition-colors"
          title="تخصيص أعمدة الجدول"
        >
          <span>⚙️</span>
          <span className="hidden md:inline">الأعمدة</span>
        </button>

        <button
          onClick={() => exportCSV(visible, currencyCode, lastOrderDates)}
          title="تصدير CSV"
          className="shrink-0 rounded-xl border border-white/10 px-3 py-3 text-sm text-slate-400 hover:bg-white/5 hover:text-white transition-colors"
        >
          ↓ CSV
        </button>
        <button
          onClick={() => {setMutationError('');handleCancelEdit();setShowAdd(true)}}
          className="shrink-0 flex items-center gap-1.5 rounded-xl border border-sky-500/30 bg-sky-500/10 px-4 py-3 text-sm font-medium text-sky-400 hover:bg-sky-500/20 transition-colors"
        >
          <span className="text-base leading-none">+</span>
          <span className="hidden sm:inline">زبون جديد</span>
          <span className="sm:hidden">جديد</span>
        </button>
      </div>

      <button type="button" className="rounded-xl border border-white/10 px-4 py-2 text-slate-300" aria-expanded={advanced} onClick={()=>setAdvanced(v=>!v)}>بحث متقدم</button>
      {advanced&&<div className={styles.advanced}><label>المدينة<select value={city} onChange={e=>setCity(e.target.value)}><option value="">كل المدن</option>{[...new Set(customers.map(c=>c.city).filter(Boolean))].map(c=><option key={c!} value={c!}>{c}</option>)}</select></label><label>الرصيد<select value={debt} onChange={e=>setDebt(e.target.value)}><option value="all">جميع الأرصدة</option><option value="debtor">مدين</option><option value="creditor">دائن</option><option value="balanced">متوازن</option></select></label><button type="button" onClick={()=>{setCity('');setDebt('all');setHideZero(false);setQuery('');setType('all');setSortField('created_at');setSortOrder('desc')}}>مسح الفلاتر</button></div>}
      
      {/* صف الفلاتر والترتيب */}
      <div className={styles.filters}>
        <div className="flex gap-1 overflow-x-auto">
          {TYPE_TABS.map(tab => (
            <button
              type="button"
              key={tab.key}
              onClick={()=>setType(tab.key)}
              aria-pressed={type===tab.key}
              className={`shrink-0 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors ${
                type === tab.key
                  ? 'bg-sky-500/15 text-sky-400'
                  : 'text-slate-400 hover:bg-white/5 hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400">ترتيب سريع:</span>
          <select
            value={sortField}
            aria-label="ترتيب الزبائن"
            onChange={e => { setSortField(e.target.value); setSortOrder('desc') }}
            className="shrink-0 rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-sm text-slate-300 outline-none"
          >
            <option value="created_at">الأحدث تسجيلاً</option>
            <option value="balance">الأعلى ذمة</option>
            <option value="total_orders">الأكثر طلبيات</option>
            <option value="name">الاسم أبجدياً</option>
            <option value="last_order">آخر طلبية بازاركو</option>
            <option value="last_shamel_invoice">آخر فاتورة شامل</option>
            <option value="last_shamel_payment">آخر دفعة شامل</option>
          </select>
        </div>
      </div>

      {/* نافذة تخصيص الأعمدة */}
      {showColSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setShowColSettings(false)}>
          <div role="dialog" aria-modal="true" aria-label="تخصيص الأعمدة" className="w-full max-w-sm rounded-2xl border border-white/10 bg-slate-900 p-6" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-white mb-1">تخصيص أعمدة الجدول</h3>
            <p className="text-xs text-slate-400 mb-4">اختر الأعمدة التي ترغب بعرضها (يتم حفظ اختياراتك دائماً)</p>
            <div className="space-y-2 mb-6">
              {ALL_COLUMNS.map(col => (
                <label key={col.id} className="flex items-center justify-between p-2 rounded-xl bg-white/5 hover:bg-white/10 cursor-pointer transition-colors">
                  <span className="text-sm text-slate-200">{col.label}</span>
                  <input
                    type="checkbox"
                    checked={visibleColumns[col.id] ?? true}
                    onChange={() => toggleColumn(col.id)}
                    className="h-4 w-4 rounded accent-sky-500"
                  />
                </label>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setVisibleColumns(DEFAULT_VISIBLE_COLUMNS)
                  try { localStorage.removeItem(`bazarko_cust_cols_${storeId}`) } catch {}
                }}
                className="rounded-xl border border-white/10 px-4 py-2 text-xs text-slate-400 hover:text-white"
              >
                استعادة الافتراضي
              </button>
              <button
                type="button"
                onClick={() => setShowColSettings(false)}
                className="rounded-xl bg-sky-600 px-5 py-2 text-xs font-semibold text-white hover:bg-sky-500"
              >
                تم
              </button>
            </div>
          </div>
        </div>
      )}

      {/* الجدول */}
      {visible.length === 0 ? (
        <div className="rounded-2xl border border-white/5 bg-white/3 py-16 text-center">
          <p className="text-4xl">👥</p>
          <p className="mt-3 text-slate-400">{loadError?'البيانات غير متاحة':customers.length?'لا توجد نتائج تطابق البحث والفلاتر':'أضف أول زبون لتبدأ تنظيم علاقاتك وطلباته'}</p>
          <button
            onClick={() => {setMutationError('');handleCancelEdit();setShowAdd(true)}}
            className="mt-4 rounded-xl bg-sky-600 px-5 py-2 text-sm font-semibold text-white hover:bg-sky-500"
          >
            أضف أول زبون
          </button>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-white/5">
          <table className="min-w-[760px] w-full">
            <thead>
              <tr className="border-b border-white/5 bg-white/3">
                {visibleColumns.name && (
                  <th onClick={() => handleSort('name')} className="px-4 py-3 text-right text-xs font-medium text-slate-400 cursor-pointer select-none hover:text-white transition-colors">
                    <div className="flex items-center gap-1.5 justify-start">
                      <span>الزبون</span>
                      {sortField === 'name' && <span className="text-sky-400 font-bold">{sortOrder === 'asc' ? '▲' : '▼'}</span>}
                    </div>
                  </th>
                )}
                {visibleColumns.phone && (
                  <th onClick={() => handleSort('phone')} className="px-4 py-3 text-right text-xs font-medium text-slate-400 cursor-pointer select-none hover:text-white transition-colors">
                    <div className="flex items-center gap-1.5 justify-start">
                      <span>التواصل</span>
                      {sortField === 'phone' && <span className="text-sky-400 font-bold">{sortOrder === 'asc' ? '▲' : '▼'}</span>}
                    </div>
                  </th>
                )}
                {visibleColumns.customer_type && (
                  <th onClick={() => handleSort('customer_type')} className="px-4 py-3 text-right text-xs font-medium text-slate-400 cursor-pointer select-none hover:text-white transition-colors">
                    <div className="flex items-center gap-1.5 justify-start">
                      <span>النوع</span>
                      {sortField === 'customer_type' && <span className="text-sky-400 font-bold">{sortOrder === 'asc' ? '▲' : '▼'}</span>}
                    </div>
                  </th>
                )}
                {visibleColumns.created_at && (
                  <th onClick={() => handleSort('created_at')} className="hidden lg:table-cell px-4 py-3 text-right text-xs font-medium text-slate-400 cursor-pointer select-none hover:text-white transition-colors">
                    <div className="flex items-center gap-1.5 justify-start">
                      <span>تاريخ التسجيل</span>
                      {sortField === 'created_at' && <span className="text-sky-400 font-bold">{sortOrder === 'asc' ? '▲' : '▼'}</span>}
                    </div>
                  </th>
                )}
                {visibleColumns.total_orders && (
                  <th onClick={() => handleSort('total_orders')} className="px-4 py-3 text-right text-xs font-medium text-slate-400 cursor-pointer select-none hover:text-white transition-colors">
                    <div className="flex items-center gap-1.5 justify-start">
                      <span>الطلبيات (بازاركو)</span>
                      {sortField === 'total_orders' && <span className="text-sky-400 font-bold">{sortOrder === 'asc' ? '▲' : '▼'}</span>}
                    </div>
                  </th>
                )}
                {visibleColumns.balance && (
                  <th onClick={() => handleSort('balance')} className="px-4 py-3 text-right text-xs font-medium text-slate-400 cursor-pointer select-none hover:text-white transition-colors">
                    <div className="flex items-center gap-1.5 justify-start">
                      <span>الذمة / الرصيد</span>
                      {sortField === 'balance' && <span className="text-sky-400 font-bold">{sortOrder === 'asc' ? '▲' : '▼'}</span>}
                    </div>
                  </th>
                )}
                {visibleColumns.last_order && (
                  <th onClick={() => handleSort('last_order')} className="hidden md:table-cell px-4 py-3 text-right text-xs font-medium text-slate-400 cursor-pointer select-none hover:text-white transition-colors">
                    <div className="flex items-center gap-1.5 justify-start">
                      <span>آخر طلبية بازاركو</span>
                      {sortField === 'last_order' && <span className="text-sky-400 font-bold">{sortOrder === 'asc' ? '▲' : '▼'}</span>}
                    </div>
                  </th>
                )}
                {visibleColumns.last_shamel_invoice && (
                  <th onClick={() => handleSort('last_shamel_invoice')} className="hidden xl:table-cell px-4 py-3 text-right text-xs font-medium text-slate-400 cursor-pointer select-none hover:text-white transition-colors">
                    <div className="flex items-center gap-1.5 justify-start">
                      <span>آخر فاتورة شامل</span>
                      {sortField === 'last_shamel_invoice' && <span className="text-sky-400 font-bold">{sortOrder === 'asc' ? '▲' : '▼'}</span>}
                    </div>
                  </th>
                )}
                {visibleColumns.last_shamel_payment && (
                  <th onClick={() => handleSort('last_shamel_payment')} className="hidden xl:table-cell px-4 py-3 text-right text-xs font-medium text-slate-400 cursor-pointer select-none hover:text-white transition-colors">
                    <div className="flex items-center gap-1.5 justify-start">
                      <span>آخر دفعة شامل</span>
                      {sortField === 'last_shamel_payment' && <span className="text-sky-400 font-bold">{sortOrder === 'asc' ? '▲' : '▼'}</span>}
                    </div>
                  </th>
                )}
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {visible.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE).map(c => {
                const t = TYPE_LABELS[c.customer_type] ?? TYPE_LABELS.retail
                const bazarkoOrder = lastOrderDates[c.id]
                const sinceBazarko = bazarkoOrder ? daysSince(bazarkoOrder) : null
                const sinceInvoice = c.last_order_at ? daysSince(c.last_order_at) : null
                const sincePayment = c.last_payment_at ? daysSince(c.last_payment_at) : null
                const waNum = whatsappNumber(c.phone, countryCode)
                return (
                  <tr key={c.id} className="hover:bg-white/3 transition-colors">
                    {visibleColumns.name && (
                      <td className="px-4 py-3">
                        <div className={styles.avatar}>
                          <span aria-hidden="true">{c.name.trim().slice(0,1)}</span>
                          <div>
                            <div className="flex items-center gap-2">
                              <Link href={`/dashboard/customers/${c.id}`} className="font-semibold text-white">{c.name}</Link>
                              {c.shamel_code && (
                                <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-mono font-bold text-sky-400 border border-sky-500/30" title={`رقم الشامل: ${c.shamel_code}`}>
                                  {c.shamel_code}
                                </span>
                              )}
                            </div>
                            {c.city&&<p className="text-xs text-slate-400">{c.city}</p>}
                            {!c.is_active&&<small className="text-amber-400">غير نشط</small>}
                          </div>
                        </div>
                      </td>
                    )}
                    {visibleColumns.phone && (
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {c.phone ? (
                            <>
                              <WhatsAppContactMenu
                                phone={c.phone}
                                customerId={c.id}
                                customerName={c.name}
                                defaultPrefix={(c.whatsapp_prefix as any) || undefined}
                                variant="chips"
                              />
                              <span className="text-sm text-slate-300 font-mono" dir="ltr">{c.phone}</span>
                            </>
                          ) : c.email ? (
                            <a
                              href={`mailto:${c.email}`}
                              className="text-sm text-slate-400 hover:text-sky-400 transition-colors"
                              dir="ltr"
                            >
                              ✉️ {c.email}
                            </a>
                          ) : (
                            <span className="text-xs text-slate-600">—</span>
                          )}
                        </div>
                      </td>
                    )}
                    {visibleColumns.customer_type && (
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${t.color}`}>
                          {t.label}
                        </span>
                      </td>
                    )}
                    {visibleColumns.created_at && (
                      <td className="hidden lg:table-cell px-4 py-3 text-xs text-slate-300">
                        {new Date(c.created_at).toLocaleDateString('ar-u-nu-latn',{timeZone:BUSINESS_TIME_ZONE})}
                      </td>
                    )}
                    {visibleColumns.total_orders && (
                      <td className="px-4 py-3 text-sm text-slate-300">
                        <Link 
                          href={`/dashboard/orders?q=${encodeURIComponent(c.phone || c.name)}`}
                          className="text-sky-400 hover:underline"
                          title="عرض طلبيات هذا الزبون في المتجر"
                        >
                          {c.total_orders} طلبيات
                        </Link>
                      </td>
                    )}
                    {visibleColumns.balance && (
                      <td className="px-4 py-3">
                        {c.balance > 0 ? (
                          <span className="text-sm font-semibold text-red-400" dir="ltr">
                            {c.balance.toLocaleString('ar-u-nu-latn')} {currencyCode}
                          </span>
                        ) : c.balance<0 ? (<span className="text-sm text-sky-400">دائن: {Math.abs(c.balance).toLocaleString('ar-u-nu-latn')} {currencyCode}</span>) : (
                          <span className="text-sm text-emerald-400">✓ متوازن (0)</span>
                        )}
                      </td>
                    )}
                    {visibleColumns.last_order && (
                      <td className="hidden md:table-cell px-4 py-3">
                        {sinceBazarko ? (
                          <span className={`text-xs block ${sinceBazarko.level === 'fresh' ? 'text-emerald-400' : sinceBazarko.level === 'stale' ? 'text-amber-400' : 'text-slate-400'}`}>
                            {sinceBazarko.text}
                          </span>
                        ) : (
                          <span className="text-xs text-slate-500">لا يوجد طلب بالمتجر</span>
                        )}
                      </td>
                    )}
                    {visibleColumns.last_shamel_invoice && (
                      <td className="hidden xl:table-cell px-4 py-3 text-xs">
                        {c.last_order_at ? (
                          <div>
                            <span className="text-slate-300 block">{new Date(c.last_order_at).toLocaleDateString('ar-u-nu-latn')}</span>
                            {sinceInvoice && <span className="text-[10px] text-slate-500 block">{sinceInvoice.text}</span>}
                          </div>
                        ) : (
                          <span className="text-slate-500">—</span>
                        )}
                      </td>
                    )}
                    {visibleColumns.last_shamel_payment && (
                      <td className="hidden xl:table-cell px-4 py-3 text-xs">
                        {c.last_payment_at ? (
                          <div>
                            <span className="text-emerald-400 block font-medium">{new Date(c.last_payment_at).toLocaleDateString('ar-u-nu-latn')}</span>
                            {sincePayment && <span className="text-[10px] text-emerald-500/70 block">{sincePayment.text}</span>}
                          </div>
                        ) : (
                          <span className="text-slate-500">—</span>
                        )}
                      </td>
                    )}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 justify-end">
                        {c.shamel_code ? (
                          <button
                            type="button"
                            onClick={() => setStatementCustomer(c)}
                            title="عرض كشف حساب الشامل"
                            className="inline-flex items-center gap-1 rounded-lg bg-sky-500/10 border border-sky-500/20 px-2.5 py-1 text-xs font-medium text-sky-400 hover:bg-sky-500/20 transition-colors"
                          >
                            <span>📄</span>
                            <span className="hidden sm:inline">كشف الشامل</span>
                          </button>
                        ) : (
                          <Link
                            href={`/dashboard/customers/${c.id}?tab=ledger`}
                            title="كشف حساب الحركات"
                            className="inline-flex items-center gap-1 rounded-lg bg-white/5 border border-white/10 px-2 py-1 text-xs text-slate-300 hover:bg-white/10 hover:text-white transition-colors"
                          >
                            <span>📋</span>
                            <span className="hidden sm:inline">كشف الحساب</span>
                          </Link>
                        )}
                        <details className={styles.actions}><summary aria-label={`إجراءات ${c.name}`}>•••</summary><div>
                          <Link
                            href={`/dashboard/customers/${c.id}`}
                            className="rounded-lg bg-white/5 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-white/10 hover:text-white transition-colors"
                          >
                            الملف الشخصي
                          </Link>
                          {c.shamel_code && (
                            <button
                              type="button"
                              onClick={() => setStatementCustomer(c)}
                              className="rounded-lg bg-sky-500/10 px-2.5 py-1.5 text-xs text-sky-400 hover:bg-sky-500/20 transition-colors text-right"
                            >
                              كشف حساب الشامل
                            </button>
                          )}
                          <Link
                            href={`/dashboard/customers/${c.id}?tab=ledger`}
                            className="rounded-lg bg-white/5 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-white/10 hover:text-white transition-colors"
                          >
                            كشف حساب بازاركو
                          </Link>
                          <button
                            onClick={() => handleEditClick(c)}
                            className="rounded-lg bg-sky-500/10 px-2.5 py-1.5 text-xs text-sky-400 hover:bg-sky-500/20 transition-colors"
                          >
                            تعديل
                          </button>
                          <button
                            onClick={() => {setMutationError('');setDeletingCustomer(c)}}
                            className="rounded-lg bg-red-500/10 px-2.5 py-1.5 text-xs text-red-400 hover:bg-red-500/20 transition-colors"
                          >
                            حذف
                          </button>
                        </div></details>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {visible.length > 0 && (
        <div className={styles.pagination}>
          <span>عرض {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, visible.length)} من {visible.length}</span>
          <button disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>السابق</button>
          <span>{currentPage} / {pages}</span>
          <button disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)}>التالي</button>
        </div>
      )}

      {/* Modal إضافة/تعديل زبون */}
      {(showAdd || editingCustomer) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={editingCustomer ? handleCancelEdit : () => setShowAdd(false)}>
          <div role="dialog" aria-modal="true" aria-label={editingCustomer?'تعديل زبون':'زبون جديد'} className="w-full max-w-md rounded-2xl border border-white/10 bg-slate-900 p-6 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <h2 className="mb-4 text-lg font-semibold text-white">{editingCustomer ? 'تعديل زبون' : 'زبون جديد'}</h2>

            {/* استيراد من جهات الاتصال */}
            {!editingCustomer && (
              <>
                <button
              type="button"
              onClick={importFromContacts}
              disabled={importing}
              className="mb-1 w-full flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 py-2.5 text-sm text-slate-300 hover:bg-white/10 hover:text-white transition-colors disabled:opacity-40"
            >
              {importing ? (
                <span className="animate-pulse text-slate-400">جاري فتح جهات الاتصال...</span>
              ) : (
                <>
                  <span className="text-base">📱</span>
                  <span>استيراد من جهات الاتصال</span>
                </>
              )}
                </button>
                {importMsg && (
                  <p className="mb-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-400">{importMsg}</p>
                )}

                <div className="mb-4 flex items-center gap-3">
                  <div className="flex-1 border-t border-white/10" />
                  <span className="text-xs text-slate-600">أو أدخل يدوياً</span>
                  <div className="flex-1 border-t border-white/10" />
                </div>
              </>
            )}

            {mutationError&&<p role="alert" className={styles.error}>{mutationError}</p>}
            <form onSubmit={saveCustomer} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="mb-1 block text-xs text-slate-400">الاسم *</label>
                  <input
                    aria-label="اسم الزبون"
                    autoFocus
                    value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    required
                    placeholder="اسم الزبون"
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-sky-500/50"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-400">الهاتف *</label>
                  <input
                    aria-label="هاتف الزبون"
                    value={form.phone}
                    onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                    placeholder="0591234567"
                    dir="ltr"
                    type="tel"
                    required
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-sky-500/50"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-400">المدينة</label>
                  <input
                    value={form.city}
                    onChange={e => setForm(f => ({ ...f, city: e.target.value }))}
                    placeholder="رام الله"
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-sky-500/50"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-400">البريد الإلكتروني</label>
                  <input
                    value={form.email}
                    onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                    placeholder="email@example.com"
                    dir="ltr"
                    type="email"
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-sky-500/50"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-400">نوع الزبون</label>
                  <select
                    value={form.customer_type}
                    onChange={e => setForm(f => ({ ...f, customer_type: e.target.value }))}
                    className="w-full rounded-xl border border-white/10 bg-slate-800 px-3 py-2.5 text-sm text-white outline-none"
                  >
                    <option value="retail">تجزئة</option>
                    <option value="wholesale">جملة</option>
                    <option value="vip">VIP</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-400">حد الائتمان</label>
                  <input
                    value={form.credit_limit}
                    onChange={e => setForm(f => ({ ...f, credit_limit: e.target.value }))}
                    type="number"
                    min="0"
                    step="any"
                    dir="ltr"
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white outline-none focus:border-sky-500/50"
                  />
                </div>
                <div className="col-span-2">
                  <label className="mb-1 block text-xs text-slate-400">إنستغرام / فيسبوك</label>
                  <input
                    value={form.social_url}
                    onChange={e => setForm(f => ({ ...f, social_url: e.target.value }))}
                    placeholder="https://instagram.com/username"
                    dir="ltr"
                    type="url"
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-sky-500/50"
                  />
                </div>
                <div className="col-span-2">
                  <label className="mb-1 block text-xs text-slate-400">ملاحظات</label>
                  <textarea
                    value={form.notes}
                    onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                    rows={2}
                    className="w-full resize-none rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-sky-500/50"
                  />
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={editingCustomer ? handleCancelEdit : () => setShowAdd(false)}
                  className="flex-1 rounded-xl border border-white/10 py-2.5 text-sm text-slate-400 hover:text-white"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 rounded-xl bg-sky-600 py-2.5 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
                >
                  {saving ? 'جاري الحفظ...' : (editingCustomer ? 'حفظ التعديلات' : 'إضافة الزبون')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal حذف زبون */}
      {deletingCustomer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setDeletingCustomer(null)}>
          <div role="dialog" aria-modal="true" aria-label="حذف الزبون" className="w-full max-w-sm rounded-2xl border border-white/10 bg-slate-900 p-6 text-center" onClick={e => e.stopPropagation()}>
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-500/10 text-2xl text-red-400">
              ⚠️
            </div>
            <h2 className="mb-2 text-lg font-semibold text-white">حذف الزبون</h2>
            <p className="mb-6 text-sm text-slate-400">
              هل أنت متأكد من حذف الزبون <strong>{deletingCustomer.name}</strong>؟ لا يمكن التراجع عن الحذف. قد يمنع النظام حذف زبون لديه معاملات مرتبطة.
            </p>
            {mutationError&&<p role="alert" className={styles.error}>{mutationError}</p>}
            <div className="flex gap-3">
              <button
                onClick={() => setDeletingCustomer(null)}
                className="flex-1 rounded-xl border border-white/10 py-2.5 text-sm font-medium text-slate-400 hover:text-white"
              >
                تراجع
              </button>
              <button
                onClick={deleteCustomer}
                disabled={deleting}
                className="flex-1 rounded-xl bg-red-500 py-2.5 text-sm font-semibold text-white hover:bg-red-400 disabled:opacity-50"
              >
                {deleting ? 'جاري الحذف...' : 'نعم، احذف الزبون'}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Modal كشف حساب الشامل الموحد */}
      {statementCustomer && (
        <ShamelStatementModal
          isOpen={!!statementCustomer}
          onClose={() => setStatementCustomer(null)}
          customerCode={statementCustomer.shamel_code || ''}
          customerName={statementCustomer.name}
          storeName={storeName}
          currencyCode={currencyCode}
        />
      )}
    </div>
  )
}
