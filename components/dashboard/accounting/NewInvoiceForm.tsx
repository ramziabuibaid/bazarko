'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {createSalesInvoice,type SalesInvoiceInput} from '@/app/dashboard/accounting/invoices/new/create-invoice-action'
import Link from 'next/link'
import styles from './new-invoice.module.css'
import {invoiceAmounts,validInvoiceInput} from '@/lib/invoices/create-presentation'
import {businessDay} from '@/lib/dashboard/simple-metrics'

export interface Product {
  id: string
  name: string
  sku: string | null
  price: number
  cost_price?: number | null
  barcode?: string | null
  thumbnail_url: string | null
  stock_quantity?: number | null
  track_stock?: boolean | null
}

export interface Customer {
  id: string
  name: string
  phone: string | null
  balance: number
}

interface LineItem {
  key: number
  product_id: string | null
  name: string
  sku: string
  quantity: number
  unit_price: number
  cost_price?: number
  stock_quantity?: number | null
  track_stock?: boolean | null
}

let keySeq = 0

function useDebounce<T extends (...args: Parameters<T>) => void>(fn: T, ms: number) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  return useCallback((...args: Parameters<T>) => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => fn(...args), ms)
  }, [fn, ms])
}

interface PrefillItem {
  product_id: string | null
  name: string
  sku: string
  quantity: number
  unit_price: number
  cost_price?: number
}

interface Prefill {
  orderId?: string
  orderNumber?: string
  quotationId?: string
  quotationNumber?: string
  customerId: string | null
  customerName: string
  customerPhone: string
  discountAmount?: number
  notes?: string
  items: PrefillItem[]
}

interface Props {
  storeId: string
  userId: string
  currencyCode: string
  storeName: string
  prefill?: Prefill
  cashBoxes?: {id:string;name:string}[]
  previewData?: {products:Product[];customers:Customer[]}
}

type CustomerMode = 'search' | 'manual' | null

export default function NewInvoiceForm({ storeId, userId, currencyCode, storeName, prefill, previewData, cashBoxes=[] }: Props) {
  const router  = useRouter()
  const supabase = createClient()

  // ── حالة الزبون ──────────────────────────────────────────────
  const [customerMode, setCustomerMode] = useState<CustomerMode>(
    prefill?.customerId ? 'search' : null
  )
  const [customerSearch, setCustomerSearch]   = useState('')
  const [customerResults, setCustomerResults] = useState<Customer[]>([])
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(
    prefill?.customerId
      ? { id: prefill.customerId, name: prefill.customerName, phone: prefill.customerPhone || null, balance: 0 }
      : null
  )
  const [customerName, setCustomerName]       = useState(prefill?.customerName ?? '')
  const [customerPhone, setCustomerPhone]     = useState(prefill?.customerPhone ?? '')
  const [customerAddress, setCustomerAddress] = useState('')

  // ── بحث المنتجات ─────────────────────────────────────────────
  const [productSearch, setProductSearch]     = useState('')
  const [productResults, setProductResults]   = useState<Product[]>([])

  // ── البنود ───────────────────────────────────────────────────
  const [items, setItems] = useState<LineItem[]>(
    prefill?.items.length
      ? prefill.items.map(i => ({ key: keySeq++, product_id: i.product_id, name: i.name, sku: i.sku, quantity: i.quantity, unit_price: i.unit_price, cost_price: Number(i.cost_price || 0) }))
      : [{ key: keySeq++, product_id: null, name: '', sku: '', quantity: 1, unit_price: 0, cost_price: 0 }]
  )

  // ── طريقة الدفع ──────────────────────────────────────────────
  const [collectionMode,setCollectionMode]=useState<'full'|'partial'|'none'>('full')
  const [amountPaid,setAmountPaid]=useState('')
  const [cashBoxId,setCashBoxId]=useState(cashBoxes[0]?.id||'')
  const pendingRequest=useRef<{id:string;payload:SalesInvoiceInput}|null>(null)
  const [hasPending,setHasPending]=useState(false)
  const pendingKey=`bazarko.invoice.pending.${storeId}.${userId}`
  useEffect(()=>{try{const v=JSON.parse(sessionStorage.getItem(pendingKey)||'null');if(v?.id&&v?.payload){pendingRequest.current=v;setHasPending(true)}}catch{}},[pendingKey])
  function restorePending(){const p=pendingRequest.current?.payload;if(!p)return;setItems(p.items.map(i=>({...i,key:keySeq++})));setSelectedCustomer(p.customerId?{id:p.customerId,name:p.customerName,phone:p.customerPhone||null,balance:0}:null);setCustomerMode(p.customerId?'search':'manual');setCustomerName(p.customerName);setCustomerPhone(p.customerPhone);setCustomerAddress(p.customerAddress);setIssueDate(p.issueDate);setDueDate(p.dueDate);setNotes(p.notes);setDiscountType(p.discountType);setDiscountValue(p.discountValue);setCollectionMode(p.collectionMode);setAmountPaid(String(p.amountPaid));setCashBoxId(p.cashBoxId||'');setReviewing(false);setError('استُعيد طلب الحفظ السابق؛ راجعه ثم أعد التأكيد بنفس بياناته.');}


  // ── الخصم: نوعين (مبلغ ثابت ₪ / نسبة مئوية %) ────────────────
  const [discountType, setDiscountType]   = useState<'amount' | 'percent'>('amount')
  const [discountValue, setDiscountValue] = useState<number>(prefill?.discountAmount || 0)

  // Helper: Calculate default due date (1 month from date)
  const addOneMonth = (dateStr: string) => {
    try {
      const d = new Date(dateStr)
      if (isNaN(d.getTime())) return ''
      d.setMonth(d.getMonth() + 1)
      return d.toISOString().split('T')[0]
    } catch {
      return ''
    }
  }

  // ── الإجماليات ────────────────────────────────────────────────
  const [issueDate, setIssueDate]           = useState(businessDay().date)
  const [dueDate, setDueDate]               = useState(() => addOneMonth(businessDay().date))
  const [notes, setNotes]                   = useState(prefill?.notes || '')
  const [saving, setSaving]                 = useState(false)
  const [error, setError]                   = useState('')

  const amounts=invoiceAmounts(items,discountType,discountValue,0)
  const {subtotal,total}=amounts
  const discountAmount=amounts.discount
  const effectivePaid=collectionMode==='full'?total:collectionMode==='none'?0:Number(amountPaid)
  const remaining=total-effectivePaid
  const totalCost=items.reduce((sum,i)=>sum+i.quantity*Number(i.cost_price||0),0)
  const [reviewing,setReviewing]=useState(false)
  const [draftNotice,setDraftNotice]=useState('')
  const [hasDraft,setHasDraft]=useState(false)
  const [createdId,setCreatedId]=useState<string|null>(null)
  const [showInternal,setShowInternal]=useState(false)
  const saveLock=useRef(false)
  const customerVersion=useRef(0),productVersion=useRef(0)
  const draftKey=`bazarko.invoice.draft.${storeId}.${userId}`
  useEffect(()=>{try{setHasDraft(!!sessionStorage.getItem(draftKey))}catch{}},[draftKey])
  function saveLocalDraft(){try{sessionStorage.setItem(draftKey,JSON.stringify({items,selectedCustomer,customerMode,customerName,customerPhone,customerAddress,issueDate,dueDate,notes,discountType,discountValue,collectionMode,amountPaid,cashBoxId}));setHasDraft(true);setDraftNotice('حُفظت مسودة في هذا التبويب فقط؛ لم تُنشأ فاتورة أو حركة مالية.')}catch{setDraftNotice('تعذر حفظ المسودة المحلية.')}}
  function restoreLocalDraft(){try{const v=JSON.parse(sessionStorage.getItem(draftKey)||'null');if(!v||!Array.isArray(v.items))throw Error();setItems(v.items.map((i:LineItem)=>({...i,key:keySeq++})));setSelectedCustomer(v.selectedCustomer||null);setCustomerMode(v.customerMode||null);setCustomerName(v.customerName||'');setCustomerPhone(v.customerPhone||'');setCustomerAddress(v.customerAddress||'');setIssueDate(v.issueDate||businessDay().date);setDueDate(v.dueDate||'');setNotes(v.notes||'');setDiscountType(v.discountType==='percent'?'percent':'amount');setDiscountValue(Number(v.discountValue)||0);setCollectionMode(v.collectionMode==='partial'?'partial':v.collectionMode==='none'?'none':'full');setAmountPaid(v.amountPaid||'');setCashBoxId(v.cashBoxId||cashBoxes[0]?.id||'');setReviewing(false);setDraftNotice('استُعيدت المسودة. راجع البنود والأسعار والزبون قبل الحفظ.')}catch{setDraftNotice('تعذر استعادة المسودة.')}}
  const fmt      = (n: number) => n.toLocaleString('ar-u-nu-latn', { maximumFractionDigits: 2 })

  // ── Debounced searches (البحث الذكي متعدد الكلمات والمقاطع) ────

  const searchCustomers = useDebounce(async (q: string) => {
    const raw = q.trim()
    if (!raw) { setCustomerResults([]); return }
    const version = customerVersion.current
    const tokens = raw.split(/\s+/).filter(Boolean)
    if (tokens.length === 0) { setCustomerResults([]); return }

    if (previewData) {
      setCustomerResults(
        previewData.customers.filter(c => {
          const target = `${c.name} ${c.phone || ''}`.toLowerCase()
          return tokens.every(token => target.includes(token.toLowerCase()))
        })
      )
      return
    }

    let query = supabase
      .from('customers')
      .select('id, name, phone, balance')
      .eq('store_id', storeId)

    // Filter by each token as an AND condition across (name OR phone)
    for (const t of tokens) {
      const safe = t.replace(/[,()%]/g, '')
      if (safe) {
        query = query.or(`name.ilike.%${safe}%,phone.ilike.%${safe}%`)
      }
    }

    const { data, error: searchError } = await query.limit(8)
    if (version === customerVersion.current) {
      setCustomerResults((data as Customer[] | null) ?? [])
      if (searchError) setError('تعذر البحث عن الزبون.')
    }
  }, 200)

  const searchProducts = useDebounce(async (q: string) => {
    const raw = q.trim()
    if (!raw) { setProductResults([]); return }
    const version = productVersion.current
    const tokens = raw.split(/\s+/).filter(Boolean)
    if (tokens.length === 0) { setProductResults([]); return }

    if (previewData) {
      setProductResults(
        previewData.products.filter(p => {
          const target = `${p.name} ${p.sku || ''} ${p.barcode || ''}`.toLowerCase()
          return tokens.every(token => target.includes(token.toLowerCase()))
        })
      )
      return
    }

    let query = supabase
      .from('products')
      .select('id, name, sku, barcode, price, cost_price, thumbnail_url, stock_quantity, track_stock')
      .eq('store_id', storeId)
      .eq('is_active', true)

    // Filter by each token as an AND condition across (name OR sku OR barcode)
    for (const t of tokens) {
      const safe = t.replace(/[,()%]/g, '')
      if (safe) {
        query = query.or(`name.ilike.%${safe}%,sku.ilike.%${safe}%,barcode.ilike.%${safe}%`)
      }
    }

    const { data, error: searchError } = await query.limit(8)
    if (version === productVersion.current) {
      setProductResults((data as Product[] | null) ?? [])
      if (searchError) setError('تعذر البحث عن المنتج.')
    }
  }, 200)

  // ── البنود ───────────────────────────────────────────────────

  function addProductToItems(p: Product) {
    productVersion.current++
    setItems(prev => [
      ...prev.filter(i=>i.name.trim()||i.product_id),
      {
        key: keySeq++,
        product_id: p.id,
        name: p.name,
        sku: p.sku ?? '',
        quantity: 1,
        unit_price: p.price,
        cost_price: Number(p.cost_price || 0),
        stock_quantity: p.stock_quantity,
        track_stock: p.track_stock,
      },
    ])
    setReviewing(false)
    setProductSearch('')
    setProductResults([])
  }

  function updateItem(key: number, field: keyof LineItem, value: string | number) {
    setReviewing(false)
    setItems(prev => prev.map(i => i.key === key ? { ...i, [field]: value } : i))
  }

  function removeItem(key: number) {
    setReviewing(false)
    setItems(prev => prev.filter(i => i.key !== key))
  }

  function clearCustomer() {
    customerVersion.current++
    setReviewing(false)
    setSelectedCustomer(null)
    setCustomerSearch('')
    setCustomerResults([])
    setCustomerName('')
    setCustomerPhone('')
    setCustomerMode(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if(saveLock.current||createdId)return
    setError('')
    const validation=validInvoiceInput(items,discountType,discountValue,issueDate,dueDate)
    if(validation){setError(validation);return}
    if(total<=0){setError('الإجمالي يجب أن يكون موجباً.');return}
    if(!Number.isFinite(effectivePaid)||effectivePaid<0||effectivePaid>total||(collectionMode==='partial'&&(effectivePaid<=0||effectivePaid>=total))){setError('الدفعة الجزئية يجب أن تكون أكبر من صفر وأقل من الإجمالي.');return}
    if(remaining>0&&!selectedCustomer&&!(customerMode==='manual'&&customerName.trim())){setError('اختر زبوناً مسجلاً أو أدخل اسم الزبون للفاتورة غير المسددة بالكامل.');return}
    if(effectivePaid>0&&!cashBoxId){setError('اختر صندوق قبض نقدي.');return}
    if(!reviewing){setReviewing(true);return}
    if(previewData){setError('معاينة فقط؛ لم تُحفظ فاتورة أو دفعة.');return}
    const payload:SalesInvoiceInput={customerId:selectedCustomer?.id||null,customerName:selectedCustomer?.name||(customerMode==='manual'?customerName.trim():''),customerPhone:selectedCustomer?.phone||(customerMode==='manual'?customerPhone.trim():''),customerAddress:customerAddress.trim(),issueDate,dueDate,notes:notes.trim(),discountType,discountValue,collectionMode,amountPaid:effectivePaid,cashBoxId:effectivePaid>0?cashBoxId:null,orderId:pendingRequest.current?pendingRequest.current.payload.orderId:prefill?.orderId||null,quotationId:pendingRequest.current?pendingRequest.current.payload.quotationId:prefill?.quotationId||null,items:items.map(i=>({product_id:i.product_id,name:i.name.trim(),sku:i.sku,quantity:i.quantity,unit_price:i.unit_price}))}
    if(pendingRequest.current&&JSON.stringify(pendingRequest.current.payload)!==JSON.stringify(payload)){setError('يوجد طلب سابق لم تُؤكد نتيجته. استعده وأعد محاولته قبل إنشاء فاتورة أخرى.');return}
    const request=pendingRequest.current||{id:crypto.randomUUID(),payload}
    try{sessionStorage.setItem(pendingKey,JSON.stringify(request))}catch{setError('تعذر حفظ معرف الطلب محلياً. تحقق من إتاحة تخزين المتصفح قبل الحفظ.');return}
    pendingRequest.current=request;setHasPending(true);saveLock.current=true;setSaving(true)
    try{
      const result=await createSalesInvoice(storeId,request.id,request.payload)
      if(!result.ok||!result.invoiceId){if(!result.uncertain){pendingRequest.current=null;setHasPending(false);sessionStorage.removeItem(pendingKey)}setError(result.error||'تعذر حفظ الفاتورة.');return}
      setCreatedId(result.invoiceId)
      try{sessionStorage.removeItem(pendingKey);sessionStorage.removeItem(draftKey)}catch{}
      router.push(`/dashboard/accounting/invoices/${result.invoiceId}`)
    }catch{setError('تعذر تأكيد نتيجة الحفظ. أعد محاولة الطلب نفسه؛ لا تنشئ فاتورة ثانية.')}
    finally{saveLock.current=false;setSaving(false)}
  }

  // ── Render ────────────────────────────────────────────────────

  return (
    <form noValidate onSubmit={handleSubmit} onChangeCapture={()=>setReviewing(false)} className={styles.form} dir="rtl">
<div className={styles.main}>

      {/* شارة الطلبية المرتبطة */}
      {(prefill?.orderId||prefill?.quotationId) && prefill && (
        <div className="flex items-center gap-3 rounded-xl border border-sky-500/20 bg-sky-500/5 px-4 py-3">
          <span className="text-sky-400">🔗</span>
          <p className="text-sm text-sky-300">
            هذه الفاتورة مرتبطة بـ {prefill.quotationId?'عرض السعر':'الطلبية'}{' '}
            <span className="font-mono font-semibold" dir="ltr">{prefill.quotationNumber||prefill.orderNumber}</span>
          </p>
        </div>
      )}

      {/* ── معلومات الزبون ── */}
      <div className={`${styles.panel} space-y-4`}>
        <h2 className="text-sm font-semibold text-white">معلومات الزبون</h2>

        {/* اختيار الوضع */}
        {customerMode === null && (
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setCustomerMode('search')}
              className="flex flex-col items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 py-4 text-sm text-slate-300 transition-colors hover:border-sky-500/30 hover:bg-sky-500/5 hover:text-sky-400"
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <circle cx="8" cy="8" r="6" />
                <line x1="13" y1="13" x2="18" y2="18" />
              </svg>
              اختيار زبون موجود
            </button>
            <button
              type="button"
              onClick={() => setCustomerMode('manual')}
              className="flex flex-col items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 py-4 text-sm text-slate-300 transition-colors hover:border-emerald-500/30 hover:bg-emerald-500/5 hover:text-emerald-400"
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="10" cy="7" r="4" />
                <path d="M2 17c0-3.3 3.6-6 8-6s8 2.7 8 6" />
                <line x1="15" y1="11" x2="15" y2="17" />
                <line x1="12" y1="14" x2="18" y2="14" />
              </svg>
              إدخال بيانات جديدة
            </button>
          </div>
        )}

        {/* وضع البحث */}
        {customerMode === 'search' && !selectedCustomer && (
          <div>
            <div className="relative">
              <svg className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <circle cx="6" cy="6" r="4.5" />
                <line x1="9.5" y1="9.5" x2="13" y2="13" />
              </svg>
              <input
                value={customerSearch}
                onChange={e => { customerVersion.current++; setCustomerSearch(e.target.value); searchCustomers(e.target.value) }}
                aria-label="البحث عن زبون" placeholder="ابحث باسم الزبون أو الهاتف..."
                autoFocus
                className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 pr-10 text-sm text-white placeholder-slate-400 outline-none focus:border-sky-500/50"
              />
              {customerResults.length > 0 && (
                <div className="absolute top-full z-10 mt-1 w-full overflow-hidden rounded-xl border border-white/10 bg-slate-800 shadow-xl">
                  {customerResults.map(c => (
                    <button key={c.id} type="button"
                      onClick={() => {
                        customerVersion.current++
                        setReviewing(false)
                        setSelectedCustomer(c)
                        setCustomerSearch('')
                        setCustomerResults([])
                      }}
                      className="flex w-full items-center gap-3 px-4 py-3 text-right transition-colors hover:bg-white/5">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-white">{c.name}</p>
                        {c.phone && <p className="text-xs text-slate-400" dir="ltr">{c.phone}</p>}
                      </div>
                      {c.balance > 0 && (
                        <span className="shrink-0 text-xs text-yellow-400">{fmt(c.balance)} {currencyCode}</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button type="button" onClick={() => setCustomerMode(null)}
              className="mt-2 text-xs text-slate-500 hover:text-slate-300">
              ← رجوع
            </button>
          </div>
        )}

        {/* زبون محدد من البحث */}
        {customerMode === 'search' && selectedCustomer && (
          <div className="flex items-center justify-between rounded-xl border border-sky-500/20 bg-sky-500/8 px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-sky-400">{selectedCustomer.name}</p>
              {selectedCustomer.phone && (
                <p className="mt-0.5 text-xs text-slate-400" dir="ltr">{selectedCustomer.phone}</p>
              )}
            </div>
            <button type="button" onClick={clearCustomer}
              className="text-sm text-slate-500 hover:text-red-400 transition-colors">
              ✕ تغيير
            </button>
          </div>
        )}

        {/* وضع الإدخال اليدوي */}
        {customerMode === 'manual' && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs text-slate-400">اسم الزبون</label>
                <input
                  value={customerName}
                  onChange={e => setCustomerName(e.target.value)}
                  placeholder="الاسم الكامل..."
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-sky-500/50"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-400">رقم الهاتف</label>
                <input
                  value={customerPhone}
                  onChange={e => setCustomerPhone(e.target.value)}
                  placeholder="+970..."
                  dir="ltr"
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-sky-500/50"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs text-slate-400">العنوان</label>
                <input
                  value={customerAddress}
                  onChange={e => setCustomerAddress(e.target.value)}
                  placeholder="المدينة، الحي..."
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-sky-500/50"
                />
              </div>
            </div>
            <button type="button" onClick={() => setCustomerMode(null)}
              className="text-xs text-slate-500 hover:text-slate-300">
              ← رجوع
            </button>
          </div>
        )}
      </div>

      {/* ── تواريخ ── */}
      <div className={styles.panel}>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="mb-1 block text-xs text-slate-400">تاريخ الإصدار *</label>
            <input aria-label="تاريخ الإصدار" type="date" value={issueDate} onChange={e => {
              const newIssue = e.target.value
              setIssueDate(newIssue)
              setDueDate(addOneMonth(newIssue))
            }} required
              className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white outline-none focus:border-sky-500/50 [color-scheme:dark]" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-400">تاريخ الاستحقاق (افتراضياً شهر)</label>
            <input aria-label="تاريخ الاستحقاق" type="date" value={dueDate} onChange={e => setDueDate(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white outline-none focus:border-sky-500/50 [color-scheme:dark]" />
          </div>
        </div>
      </div>

      {/* ── بنود الفاتورة ── */}
      <div className={`${styles.panel} space-y-4`}>
        <h2 className="text-sm font-semibold text-white">بنود الفاتورة <span className="text-xs text-sky-300">· {items.length} بنود</span></h2><label className={styles.notice}><input type="checkbox" checked={showInternal} onChange={e=>setShowInternal(e.target.checked)}/> عرض التكلفة والربح الداخليين</label>

        {/* بحث عن منتج */}
        <div className="relative">
          <svg className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <circle cx="6" cy="6" r="4.5" />
            <line x1="9.5" y1="9.5" x2="13" y2="13" />
          </svg>
          <input
            value={productSearch}
            onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();const matches=productResults.filter(p=>p.barcode===productSearch.trim()||p.sku===productSearch.trim());if(matches.length===1)addProductToItems(matches[0]);else setError('اختر منتجاً من نتائج البحث؛ يجب أن يكون الرمز مطابقاً لصنف واحد.')}}}
            onChange={e => { productVersion.current++; setProductSearch(e.target.value); searchProducts(e.target.value) }}
            aria-label="البحث عن منتج" placeholder="ابحث بالاسم أو SKU أو الباركود..."
            className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 pr-10 text-sm text-white placeholder-slate-400 outline-none focus:border-sky-500/50"
          />
          {productResults.length > 0 && (
            <div className="absolute top-full z-10 mt-1 w-full overflow-hidden rounded-xl border border-white/10 bg-slate-800 shadow-xl">
              {productResults.map(p => (
                <button key={p.id} type="button" onClick={() => addProductToItems(p)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-right transition-colors hover:bg-white/5">
                  <div className="h-8 w-8 shrink-0 overflow-hidden rounded-lg bg-white/5">
                    {p.thumbnail_url
                      ? <img src={p.thumbnail_url} alt="" className="h-full w-full object-cover" />
                      : <div className="flex h-full items-center justify-center text-xs">🛍️</div>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white">{p.name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      {p.sku && <span className="text-xs text-slate-500" dir="ltr">{p.sku}</span>}
                      {p.track_stock !== false && (
                        <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium ${
                          (p.stock_quantity ?? 0) > 0
                            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                            : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                        }`}>
                          <span>المتوفر:</span>
                          <span className="font-mono font-bold" dir="ltr">{p.stock_quantity ?? 0}</span>
                        </span>
                      )}
                    </div>
                  </div>
                  <span className="shrink-0 text-sm font-medium text-sky-400" dir="ltr">{fmt(p.price)}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ── بطاقات البنود (موبايل) ── */}
        <div className="md:hidden space-y-3">
          {items.map((item, idx) => (
            <div key={item.key} className="rounded-xl border border-white/8 bg-slate-800/60 p-3 space-y-3">
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <label className="text-[10px] font-medium text-slate-500">الوصف *</label>
                  <input
                    value={item.name}
                    onChange={e => updateItem(item.key, 'name', e.target.value)}
                    placeholder="اسم البند أو الخدمة..."
                    aria-label={`وصف البند ${idx+1}`}
                    className="mt-0.5 w-full bg-transparent text-sm text-white outline-none placeholder-slate-500"
                  />
                  {item.sku && <p className="text-[10px] text-slate-600 mt-0.5" dir="ltr">{item.sku}</p>}
                </div>
                <button type="button" onClick={() => removeItem(item.key)}
                  className="shrink-0 mt-1 flex h-6 w-6 items-center justify-center rounded-full text-slate-600 hover:bg-red-500/10 hover:text-red-400 transition-colors text-xs">
                  ✕
                </button>
              </div>
              <div className="flex items-end gap-3">
                <div>
                  <label className="text-[10px] font-medium text-slate-500">الكمية</label>
                  <input
                    aria-label={`كمية ${item.name||'البند'}`} type="number" min="0.01" step="any"
                    value={item.quantity}
                    onFocus={e => e.target.select()}
                    onClick={e => (e.target as HTMLInputElement).select()}
                    onChange={e => updateItem(item.key, 'quantity', Number(e.target.value))}
                    dir="ltr"
                    className="mt-0.5 w-16 block rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-center text-sm text-white outline-none focus:border-sky-500/50"
                  />
                </div>
                <span className="mb-1.5 text-slate-600">×</span>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] font-medium text-slate-500">السعر ({currencyCode})</label>
                    {item.track_stock !== false && item.stock_quantity !== undefined && item.stock_quantity !== null && (
                      <span className={`text-[10px] font-medium px-1.5 py-0.2 rounded ${
                        Number(item.stock_quantity) > 0 ? 'text-emerald-400 bg-emerald-500/10' : 'text-amber-400 bg-amber-500/10'
                      }`}>
                        المتاح: <b dir="ltr">{item.stock_quantity}</b>
                      </span>
                    )}
                  </div>
                  <input
                    type="number" min="0" step="0.01"
                    aria-label={`سعر ${item.name||'البند'}`} value={item.unit_price || ''}
                    onFocus={e => e.target.select()}
                    onClick={e => (e.target as HTMLInputElement).select()}
                    onChange={e => updateItem(item.key, 'unit_price', Math.max(0, parseFloat(e.target.value) || 0))}
                    placeholder="0"
                    dir="ltr"
                    className="mt-0.5 w-full block rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-white outline-none focus:border-sky-500/50"
                  />
                </div>
                <div className="text-right shrink-0">
                  <p className="text-[10px] font-medium text-slate-500">الإجمالي</p>
                  <p className="mt-0.5 text-sm font-bold text-emerald-400" dir="ltr">
                    {fmt(item.quantity * item.unit_price)}
                  </p>
                </div>
              </div>
              {showInternal && Number(item.cost_price || 0) > 0 && (
                <div className="mt-2 flex items-center justify-between text-[11px] rounded bg-white/5 px-2 py-1 text-slate-400">
                  <span>التكلفة للوحدة: <span className="text-slate-200 font-mono" dir="ltr">{fmt(item.cost_price || 0)} {currencyCode}</span></span>
                  <span>الربح: <span className={`font-mono font-semibold ${((item.quantity * item.unit_price) - (item.quantity * (item.cost_price || 0))) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`} dir="ltr">
                    {fmt((item.quantity * item.unit_price) - (item.quantity * (item.cost_price || 0)))} {currencyCode}
                  </span></span>
                </div>
              )}
            </div>
          ))}
          {items.length === 0 && (
            <p className="py-4 text-center text-sm text-slate-500">لا توجد بنود — ابحث عن منتج أو أضف بنداً يدوياً</p>
          )}
        </div>

        {/* ── جدول البنود (ديسكتوب) ── */}
        <div className="hidden md:block overflow-x-auto rounded-xl border border-white/5">
          <table className="w-full min-w-[650px] text-sm">
            <thead>
              <tr className="border-b border-white/5 bg-white/3">
                <th className="px-3 py-2.5 text-right text-xs text-slate-400">الوصف</th>
                <th className="w-16 px-2 py-2.5 text-center text-xs text-slate-400">الكمية</th>
                <th className={showInternal?"w-24 px-2 py-2.5 text-left text-xs text-slate-400":styles.cost}>التكلفة</th>
                <th className="w-40 px-2 py-2.5 text-left text-xs text-slate-400">سعر البيع والمتاح</th>
                <th className="w-24 px-2 py-2.5 text-left text-xs text-slate-400">الإجمالي</th>
                <th className={showInternal?"w-24 px-2 py-2.5 text-left text-xs text-slate-400":styles.cost}>الربح</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {items.map(item => {
                const lineTotal = item.quantity * item.unit_price
                const lineCost = item.quantity * Number(item.cost_price || 0)
                const lineProfit = lineTotal - lineCost
                return (
                  <tr key={item.key}>
                    <td className="px-3 py-2">
                      <input
                        value={item.name}
                        onChange={e => updateItem(item.key, 'name', e.target.value)}
                        placeholder="وصف البند *"
                        aria-label={`وصف البند ${item.key}`}
                        className="w-full bg-transparent text-sm text-white outline-none placeholder-slate-600"
                      />
                      {item.sku && <p className="text-xs text-slate-600" dir="ltr">{item.sku}</p>}
                    </td>
                    <td className="px-2 py-2 text-center">
                      <input
                        aria-label={`كمية ${item.name||'البند'}`} type="number" min="0.01" step="any"
                        value={item.quantity}
                        onFocus={e => e.target.select()}
                        onClick={e => (e.target as HTMLInputElement).select()}
                        onChange={e => updateItem(item.key, 'quantity', Number(e.target.value))}
                        dir="ltr"
                        className="w-14 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-center text-sm text-white outline-none focus:border-sky-500/50"
                      />
                    </td>
                    <td className={showInternal?"px-2 py-2 text-left":styles.cost}>
                      <input
                        type="number" min="0" step="0.01"
                        value={item.cost_price || ''}
                        onFocus={e => e.target.select()}
                        onClick={e => (e.target as HTMLInputElement).select()}
                        onChange={e => updateItem(item.key, 'cost_price', Math.max(0, parseFloat(e.target.value) || 0))}
                        placeholder="0"
                        dir="ltr"
                        className="w-20 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-left text-xs text-slate-300 font-mono outline-none focus:border-sky-500/50"
                      />
                    </td>
                    <td className="px-2 py-2 text-left">
                      <div className="flex items-center gap-2">
                        <input
                          type="number" min="0" step="0.01"
                          aria-label={`سعر ${item.name||'البند'}`} value={item.unit_price || ''}
                          onFocus={e => e.target.select()}
                          onClick={e => (e.target as HTMLInputElement).select()}
                          onChange={e => updateItem(item.key, 'unit_price', Math.max(0, parseFloat(e.target.value) || 0))}
                          placeholder="0"
                          dir="ltr"
                          className="w-20 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-left text-sm text-white font-mono outline-none focus:border-sky-500/50"
                        />
                        {item.track_stock !== false && item.stock_quantity !== undefined && item.stock_quantity !== null && (
                          <span
                            title={`المخزون المتاح: ${item.stock_quantity}`}
                            className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap ${
                              Number(item.stock_quantity) > 0
                                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                            }`}
                          >
                            <span className="text-[10px] text-slate-400">متاح:</span>
                            <span className="font-mono font-bold" dir="ltr">{item.stock_quantity}</span>
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-2 py-2 text-left text-sm font-semibold text-white font-mono" dir="ltr">
                      {fmt(lineTotal)}
                    </td>
                    <td className={`${showInternal?"px-2 py-2 text-left text-xs font-mono font-semibold":styles.cost} ${lineProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`} dir="ltr">
                      {fmt(lineProfit)}
                    </td>
                    <td className="px-3 py-2">
                      <button type="button" onClick={() => removeItem(item.key)}
                        className="text-slate-600 hover:text-red-400 transition-colors text-xs">✕</button>
                    </td>
                  </tr>
                )
              })}
              {items.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-sm text-slate-500">
                    لا توجد بنود
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <button
          type="button"
          onClick={() => {setReviewing(false);setItems(prev => [...prev, { key: keySeq++, product_id: null, name: '', sku: '', quantity: 1, unit_price: 0, cost_price: 0 }])}}
          className="w-full rounded-xl border border-dashed border-white/10 py-2.5 text-sm text-slate-400 transition-colors hover:border-sky-500/30 hover:text-sky-400"
        >
          + إضافة بند يدوي
        </button>
      </div>

      {/* ── ملاحظات ── */}
      <div className={styles.panel}>
        <label className="mb-2 block text-xs text-slate-400">ملاحظات (تظهر في الفاتورة)</label>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="شكراً لتعاملكم معنا..."
          rows={2}
          className="w-full resize-none rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-sky-500/50"
        />
      </div>

</div><aside className={styles.side}>      {/* ── طريقة الدفع والإجماليات ── */}
      <div className={`${styles.panel} space-y-4`}>
<h2>ملخص الفاتورة والتحصيل</h2><div className={styles.tabs}><button type="button" aria-pressed={collectionMode==='full'} onClick={()=>{setCollectionMode('full');setReviewing(false)}}>دفع كامل</button><button type="button" aria-pressed={collectionMode==='partial'} onClick={()=>{setCollectionMode('partial');setReviewing(false)}}>دفعة جزئية</button><button type="button" aria-pressed={collectionMode==='none'} onClick={()=>{setCollectionMode('none');setReviewing(false)}}>بدون دفعة</button></div><p className={styles.notice}>التحصيل النقدي بتاريخ الفاتورة، مع سند قبض مرتبط بها.</p>{collectionMode!=='none'&&<label className={styles.notice}>صندوق القبض<select aria-label="صندوق القبض" value={cashBoxId} onChange={e=>setCashBoxId(e.target.value)} className="w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-3 mt-2"><option value="">اختر صندوقاً</option>{cashBoxes.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label>}{collectionMode==='partial'&&<label className={styles.notice}>المدفوع الآن<input aria-label="الدفعة الجزئية" type="number" min="0.01" max={total} step="0.01" value={amountPaid} onChange={e=>setAmountPaid(e.target.value)} className="w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-3 mt-2"/></label>}

        <div className="flex items-center justify-between text-sm border-t border-white/5 pt-3">
          <span className="text-slate-400">المجموع الفرعي</span>
          <span className="text-white font-mono font-bold" dir="ltr">{fmt(subtotal)} {currencyCode}</span>
        </div>

        {showInternal && totalCost > 0 && (
          <div className="rounded-xl border border-sky-500/20 bg-sky-500/5 p-3 space-y-1.5 text-xs">
            <div className="flex items-center justify-between text-slate-300">
              <span>إجمالي التكلفة التقديرية للبضاعة:</span>
              <span className="font-mono font-bold text-slate-200" dir="ltr">{fmt(totalCost)} {currencyCode}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-300">مجمل الربح المتوقع:</span>
              <span className={`font-mono font-bold text-sm ${(total - totalCost) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`} dir="ltr">
                {fmt(total - totalCost)} {currencyCode}
                {total > 0 && (
                  <span className="text-[11px] font-normal mr-1 text-slate-400">
                    ({(((total - totalCost) / total) * 100).toFixed(1)}%)
                  </span>
                )}
              </span>
            </div>
          </div>
        )}

        {/* نوع وقيمة الخصم */}
        <div className="rounded-xl border border-white/10 bg-slate-800/60 p-3 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-bold text-slate-300">الخصم التجاري الممنوح:</span>
            <div className="flex rounded-lg bg-slate-900 p-0.5 text-[11px]">
              <button
                type="button"
                onClick={() => {setDiscountType('amount');setReviewing(false)}}
                className={`rounded px-2.5 py-0.5 font-bold transition ${
                  discountType === 'amount' ? 'bg-sky-500 text-slate-950' : 'text-slate-400 hover:text-white'
                }`}
              >
                مبلغ ثابت ({currencyCode})
              </button>
              <button
                type="button"
                onClick={() => {setDiscountType('percent');setReviewing(false)}}
                className={`rounded px-2.5 py-0.5 font-bold transition ${
                  discountType === 'percent' ? 'bg-sky-500 text-slate-950' : 'text-slate-400 hover:text-white'
                }`}
              >
                نسبة مئوية (%)
              </button>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <input
              type="number"
              aria-label="قيمة الخصم"
              min="0"
              max={discountType==='percent'?100:subtotal}
              step="any"
              value={discountValue || ''}
              onChange={e => setDiscountValue(Math.max(0, parseFloat(e.target.value) || 0))}
              placeholder={discountType === 'percent' ? 'مثال: 5%' : `مثال: 50 ${currencyCode}`}
              dir="ltr"
              className="flex-1 rounded-lg border border-white/10 bg-slate-900 px-3 py-1.5 text-sm text-white font-mono outline-none focus:border-sky-500/50"
            />
            <span className="text-amber-400 font-mono font-bold text-xs" dir="ltr">
              - {fmt(discountAmount)} {currencyCode}
            </span>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-white/5 pt-3 text-base font-bold">
          <span className="text-white">الإجمالي المستحق</span>
          <span className="text-emerald-400 font-mono text-lg" dir="ltr">{fmt(total)} {currencyCode}</span>
        </div>

<div className={styles.summary}><span>المدفوع الآن</span><b>{fmt(effectivePaid)} {currencyCode}</b></div><div className={styles.summary}><span>المتبقي على الزبون</span><strong>{fmt(remaining)} {currencyCode}</strong></div><p className={styles.notice}>{remaining>0?'يسجل المتبقي على حساب الزبون المختار.':'الفاتورة مدفوعة بالكامل بسند قبض نقدي.'}</p>
</div>
      {error && (
        <p role="alert" className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </p>
      )}

      <div className={styles.actions}>{hasPending&&<button type="button" disabled={saving} onClick={restorePending}>استعادة طلب الحفظ السابق</button>}
<button type="button" disabled={saving||!!createdId} onClick={saveLocalDraft}>حفظ مسودة محلية</button>{hasDraft&&<button type="button" disabled={saving||!!createdId} onClick={restoreLocalDraft}>استعادة المسودة المحلية</button>}<p role="status" className={styles.notice}>{draftNotice}</p>
{createdId&&<Link href={`/dashboard/accounting/invoices/${createdId}`}>فتح الفاتورة المحفوظة للمراجعة</Link>}

        <button type="button" onClick={() => router.back()}
          className="flex-1 rounded-xl border border-white/10 py-3 text-sm text-slate-400 transition-colors hover:text-white">
          إلغاء
        </button>
        <button type="submit" disabled={saving||!!createdId}
          className="flex-[2] rounded-xl bg-sky-600 py-3 text-sm font-semibold text-white transition-colors hover:bg-sky-500 disabled:opacity-50">
          {saving ? 'جاري الحفظ...' : reviewing?'تأكيد وحفظ الفاتورة':'مراجعة قبل الحفظ'}
        </button>
      </div>
</aside>{reviewing&&<section className={styles.review} role="region" aria-label="مراجعة الفاتورة"><h2>راجع الفاتورة قبل تأكيد الحفظ</h2><p>الزبون: {selectedCustomer?.name||customerName||'عميل نقدي'} · {items.length} بنود · الإصدار: {issueDate}</p><p>الإجمالي: {fmt(total)} {currencyCode} · المدفوع: {fmt(effectivePaid)} · المتبقي: {fmt(remaining)}</p><p className={styles.notice}>سيتم حفظ الفاتورة وبنودها وتحديث المخزون وحساب الزبون. راجع الطباعة من صفحة الفاتورة بعد الحفظ.</p></section>}
    </form>
  )
}
