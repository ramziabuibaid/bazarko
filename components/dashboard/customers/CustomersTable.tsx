'use client'

import { useEffect, useRef, useState } from 'react'
import styles from './directory.module.css'
import {filterCustomers,whatsappNumber,csvCell} from '@/lib/customers/directory'
import {BUSINESS_TIME_ZONE} from '@/lib/dashboard/simple-metrics'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

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
}

interface Props {
  customers: Customer[]
  currencyCode: string
  storeId: string
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

export default function CustomersTable({
  customers, currencyCode, storeId, activeType, searchQuery, sort, lastOrderDates, initShowAdd, countryCode='PS', preview=false, loadError=false, orderError=false,
}: Props) {
  const router = useRouter()
  const [query,setQuery]=useState(searchQuery),[type,setType]=useState(activeType),[sorting,setSorting]=useState(sort)
  const [city,setCity]=useState(''),[debt,setDebt]=useState('all'),[advanced,setAdvanced]=useState(false),[page,setPage]=useState(1)
  const [mutationError,setMutationError]=useState('')
  const busy=useRef(false)
  const visible=filterCustomers(customers,query,type,city,debt,sorting)
  const pages=Math.max(1,Math.ceil(visible.length/10)),currentPage=Math.min(page,pages)
  useEffect(()=>{setPage(1)},[query,type,city,debt,sorting])
  useEffect(()=>{setQuery(searchQuery);setType(activeType);setSorting(sort)},[searchQuery,activeType,sort])
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
      {advanced&&<div className={styles.advanced}><label>المدينة<select value={city} onChange={e=>setCity(e.target.value)}><option value="">كل المدن</option>{[...new Set(customers.map(c=>c.city).filter(Boolean))].map(c=><option key={c!} value={c!}>{c}</option>)}</select></label><label>الرصيد<select value={debt} onChange={e=>setDebt(e.target.value)}><option value="all">جميع الأرصدة</option><option value="debtor">مدين</option><option value="creditor">دائن</option><option value="balanced">متوازن</option></select></label><button type="button" onClick={()=>{setCity('');setDebt('all');setQuery('');setType('all');setSorting('created_at')}}>مسح الفلاتر</button></div>}
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
        <select
          value={sorting}
          aria-label="ترتيب الزبائن"
          onChange={e => setSorting(e.target.value)}
          className="shrink-0 rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-sm text-slate-300 outline-none"
        >
          <option value="created_at">الأحدث</option>
          <option value="balance">الأعلى ذمة</option>
          <option value="orders">الأكثر طلبيات</option>
        </select>
      </div>

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
          <table className="min-w-[680px] w-full">
            <thead>
              <tr className="border-b border-white/5 bg-white/3">
                <th className="px-4 py-3 text-right text-xs font-medium text-slate-400">الزبون</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-slate-400">التواصل</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-slate-400">النوع</th>
                <th className="hidden lg:table-cell px-4 py-3 text-right text-xs font-medium text-slate-400">تاريخ التسجيل</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-slate-400">الطلبيات</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-slate-400">الذمة</th>
                <th className="hidden md:table-cell px-4 py-3 text-right text-xs font-medium text-slate-400">آخر طلبية</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {visible.slice((currentPage-1)*10,currentPage*10).map(c => {
                const t = TYPE_LABELS[c.customer_type] ?? TYPE_LABELS.retail
                const lastOrder = lastOrderDates[c.id]
                const since = lastOrder ? daysSince(lastOrder) : null
                const sinceColor =
                  since?.level === 'fresh'  ? 'text-emerald-400' :
                  since?.level === 'stale'  ? 'text-amber-400' :
                  'text-slate-400'
                const waNum = whatsappNumber(c.phone,countryCode)
                return (
                  <tr key={c.id} className="hover:bg-white/3 transition-colors">
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
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {c.phone ? (
                          <>
                            {waNum&&<a
                              href={`https://wa.me/${waNum}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="فتح واتساب"
                              className="flex-shrink-0 rounded-lg bg-emerald-500/10 px-2 py-1 text-sm text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                            >
                              💬
                            </a>}
                            <span className="text-sm text-slate-300" dir="ltr">{c.phone}</span>
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
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${t.color}`}>
                        {t.label}
                      </span>
                    </td>
                    <td className="hidden lg:table-cell px-4 py-3 text-xs text-slate-300">
                      {new Date(c.created_at).toLocaleDateString('ar-u-nu-latn',{timeZone:BUSINESS_TIME_ZONE})}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-300">
                      <Link 
                        href={`/dashboard/orders?q=${encodeURIComponent(c.phone || c.name)}`}
                        className="text-sky-400 hover:underline"
                        title="عرض طلبيات هذا الزبون"
                      >
                        {c.total_orders} طلبيات
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      {c.balance > 0 ? (
                        <span className="text-sm font-semibold text-red-400" dir="ltr">
                          {c.balance.toLocaleString('ar-u-nu-latn')} {currencyCode}
                        </span>
                      ) : c.balance<0 ? (<span className="text-sm text-sky-400">دائن: {Math.abs(c.balance).toLocaleString('en-GB')} {currencyCode}</span>) : (
                        <span className="text-sm text-emerald-400">✓ متوازن</span>
                      )}
                    </td>
                    <td className="hidden md:table-cell px-4 py-3">
                      {since ? (
                        <span className={`text-xs ${sinceColor}`}>{since.text}</span>
                      ) : (
                        <span className="text-xs text-slate-400">{orderError?'غير متاح':'لم يطلب بعد'}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <details className={styles.actions}><summary aria-label={`إجراءات ${c.name}`}>•••</summary><div>
                        <Link
                          href={`/dashboard/customers/${c.id}`}
                          className="rounded-lg bg-white/5 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-white/10 hover:text-white transition-colors"
                        >
                          الملف
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
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {visible.length>0&&<div className={styles.pagination}><span>عرض {(currentPage-1)*10+1}–{Math.min(currentPage*10,visible.length)} من {visible.length}</span><button disabled={currentPage===1} onClick={()=>setPage(currentPage-1)}>السابق</button><span>{currentPage} / {pages}</span><button disabled={currentPage===pages} onClick={()=>setPage(currentPage+1)}>التالي</button></div>}
      <section className={styles.empty}><h2>زبائنك في مكان واحد</h2><p>نظّم الزبائن حسب النوع، وتابع الطلبات والأرصدة بسهولة.</p><Link href="/dashboard/customers/ledger" className="text-sky-400">عرض حسابات العملاء ←</Link></section>
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
    </div>
  )
}
