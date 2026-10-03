'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import styles from './pos.module.css'
import {allowedQuantity,cashChange,matchesProduct} from '@/lib/pos/cart'
import {allRows} from '@/lib/dashboard/load-simple-dashboard'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import PosReceiptModal, { ReceiptData } from './PosReceiptModal'

export interface Product {
  id: string
  name: string
  price: number
  cost_price?: number | null
  compare_price?: number | null
  barcode?: string | null
  sku: string | null
  stock_available: number | null
  track_stock: boolean
  thumbnail_url: string | null
  category_id?: string | null
}

export interface Category {
  id: string
  name: string
}

interface Customer {
  id: string
  name: string
  phone: string | null
  email: string | null
  balance: number
}

interface LineItem {
  productId: string
  name: string
  unitPrice: number
  costPrice?: number
  quantity: number
  max: number | null
}

type OrderMode = 'pos' | 'account'
type PaymentMethod = 'cash' | 'bank_transfer' | 'check' | 'online' | 'credit'

const PAYMENT_METHODS = [
  { value: 'cash',          label: 'نقداً',         icon: '💵' },
  { value: 'bank_transfer', label: 'تحويل بنكي',    icon: '🏦' },
  { value: 'check',         label: 'شيك',            icon: '📋' },
  { value: 'credit',        label: 'آجل (ذمة)',      icon: '📒' },
]

interface Props {
  storeId: string
  currencyCode: string
  posPresentation?: boolean
  previewCatalog?: {products:Product[];categories:Category[]}
  storeInfo?: {
    name?: string
    phone?: string | null
    address?: string | null
    taxNumber?: string | null
    receiptFooter?: string | null
  }
}

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}

export default function NewOrderForm({ storeId, currencyCode, storeInfo, posPresentation=false, previewCatalog }: Props) {
  const router = useRouter()
  const supabase = createClient()

  const lock=useRef(false),searchField=useRef<HTMLInputElement>(null)
  const [tender,setTender]=useState(''),[held,setHeld]=useState<string|null>(null),[holdNotice,setHoldNotice]=useState(''),[catalogError,setCatalogError]=useState('')
  const [mode, setMode] = useState<OrderMode>('pos')
  const [items, setItems] = useState<LineItem[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  // إيصال الطباعة الفوري
  const [receiptData, setReceiptData] = useState<ReceiptData | null>(null)
  const [showReceipt, setShowReceipt] = useState(false)

  // المنتجات والتصنيفات المعروضة
  const [allProducts, setAllProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [selectedCategory, setSelectedCategory] = useState<string>('all')
  const [loadingCatalog, setLoadingCatalog] = useState(true)

  // البحث اللحظي التراكمي
  const [productQuery, setProductQuery] = useState('')

  // Customer search (account mode)
  const [customerQuery, setCustomerQuery] = useState('')
  const [customerResults, setCustomerResults] = useState<Customer[]>([])
  const [showCustomers, setShowCustomers] = useState(false)
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null)
  const debouncedCustomer = useDebounce(customerQuery, 250)

  // Quick Add Customer modal
  const [showAddCustomerModal, setShowAddCustomerModal] = useState(false)
  const [newCustName, setNewCustName] = useState('')
  const [newCustPhone, setNewCustPhone] = useState('')
  const [addingCustomer, setAddingCustomer] = useState(false)

  // POS customer info
  const [posName, setPosName] = useState('عميل نقدي')
  const [posPhone, setPosPhone] = useState('')
  const [posEmail, setPosEmail] = useState('')

  // Payment
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash')
  const [amountPaid, setAmountPaid] = useState('')
  const [notes, setNotes] = useState('')

  // الحسابات المالية
  const subtotal = items.reduce((s, i) => s + i.unitPrice * i.quantity, 0)
  const totalCost = items.reduce((s, i) => s + (i.costPrice || 0) * i.quantity, 0)
  const totalAmount = subtotal
  const effectiveAmountPaid = mode === 'pos' ? totalAmount : (parseFloat(amountPaid) || 0)
  const cash=cashChange(totalAmount,tender)
  const amountRemaining = Math.max(0, totalAmount - effectiveAmountPaid)

  // تحميل كافة الأصناف والتصنيفات فور فتح الشاشة
  useEffect(() => {
    let isMounted = true
    async function fetchCatalog() {
      setLoadingCatalog(true)
      if(previewCatalog){setAllProducts(previewCatalog.products);setCategories(previewCatalog.categories);setLoadingCatalog(false);return}
      try {
        const [products,cats]=await Promise.all([
          allRows<Product>((from,to)=>supabase.from('products').select('id, name, price, cost_price, compare_price, sku, barcode, stock_available, track_stock, thumbnail_url, category_id').eq('store_id',storeId).eq('is_active',true).order('name').order('id').range(from,to)),
          allRows<Category>((from,to)=>supabase.from('categories').select('id, name, sort_order').eq('store_id',storeId).eq('is_active',true).order('sort_order').order('id').range(from,to)),
        ])
        if(isMounted){setAllProducts(products);setCategories(cats);setCatalogError('')}
      } catch {if(isMounted)setCatalogError('تعذر تحميل دليل المنتجات. أعد تحميل الصفحة.')}
      finally {if(isMounted)setLoadingCatalog(false)}
    }

    fetchCatalog()
    return () => { isMounted = false }
  }, [storeId])

  // فلترة الأصناف لحظياً وتراكمياً حسب التصنيف والبحث
  const filteredProducts = allProducts.filter(p => {
    if (selectedCategory !== 'all' && p.category_id !== selectedCategory) {
      return false
    }
    if (!productQuery.trim()) return true

    return matchesProduct(p,productQuery)
  })

  useEffect(()=>{function key(e:KeyboardEvent){if(e.key==='F2'){e.preventDefault();searchField.current?.focus()}}window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key)},[])
  useEffect(()=>{try{setHeld(sessionStorage.getItem(`bazarko.pos.held.${storeId}`))}catch{}},[storeId])
  function holdSale(){
    if(!items.length)return
    if(held){setHoldNotice('استعد السلة المعلقة قبل تعليق سلة أخرى.');return}
    try{const snapshot=JSON.stringify({items,mode,selectedCustomer,posName,posPhone,amountPaid,notes});sessionStorage.setItem(`bazarko.pos.held.${storeId}`,snapshot);setHeld(snapshot);setItems([]);setTender('');setHoldNotice('عُلقت السلة في هذا المتصفح؛ لم تسجل عملية بيع.')}catch{setHoldNotice('تعذر حفظ السلة المعلقة.')}
  }
  function resumeSale(){
    if(items.length){setHoldNotice('أفرغ السلة الحالية قبل استعادة المعلقة.');return}
    try{const value=JSON.parse(held||'{}');if(!Array.isArray(value.items))throw Error();const restored:LineItem[]=value.items.map((item:LineItem)=>{const product=allProducts.find(p=>p.id===item.productId);if(!product)throw Error();const max=product.track_stock?product.stock_available:null;if(!allowedQuantity(item.quantity,max))throw Error();return {...item,max}});setItems(restored);setMode(value.mode==='account'?'account':'pos');setSelectedCustomer(value.selectedCustomer||null);setPosName(value.posName||'عميل نقدي');setPosPhone(value.posPhone||'');setAmountPaid(value.amountPaid||'');setNotes(value.notes||'');sessionStorage.removeItem(`bazarko.pos.held.${storeId}`);setHeld(null);setHoldNotice('استُعيدت السلة. راجع الأسعار والمخزون قبل الإتمام.')}catch{setHoldNotice('تعذر الاستعادة؛ تحقق من المنتجات والكميات الحالية.')} 
  }
  function scanProduct(){const code=productQuery.trim();const matches=allProducts.filter(p=>p.sku===code||p.barcode===code);if(matches.length===1){addProduct(matches[0]);setProductQuery('')}else setError(matches.length?'الرمز يطابق أكثر من صنف؛ اختر الصنف يدوياً.':'لم يُعثر على باركود مطابق.')}

  // Search customers (loads recent customers on open, filters on typing)
  useEffect(() => {
    if(previewCatalog){setCustomerResults([{id:'demo-customer',name:'عميل توضيحي',phone:null,email:null,balance:0}]);return}
    if (mode !== 'account') {
      setCustomerResults([])
      return
    }

    let query = supabase
      .from('customers')
      .select('id, name, phone, email, balance')
      .eq('store_id', storeId)
      .eq('is_active', true)

    if (debouncedCustomer.trim()) {
      query = query.or(`name.ilike.%${debouncedCustomer.replace(/[,()%]/g,'')}%,phone.ilike.%${debouncedCustomer.replace(/[,()%]/g,'')}%`)
    }

    query
      .order('name', { ascending: true })
      .limit(10)
      .then(({ data }: { data: Customer[] | null }) => setCustomerResults(data ?? []))
  }, [debouncedCustomer, mode, storeId])

  function addProduct(product: Product) {
    if(product.track_stock&&(product.stock_available??0)<=0){setError('هذا المنتج غير متوفر حالياً');return}
    setItems(prev => {
      const existing = prev.find(i => i.productId === product.id)
      if (existing) {
        if (product.track_stock && product.stock_available !== null && existing.quantity >= product.stock_available) {
          return prev
        }
        return prev.map(i => i.productId === product.id ? { ...i, quantity: i.quantity + 1 } : i)
      }
      return [...prev, {
        productId: product.id,
        name: product.name,
        unitPrice: product.price,
        costPrice: Number(product.cost_price || 0),
        quantity: 1,
        max: product.track_stock ? (product.stock_available ?? null) : null,
      }]
    })
  }

  function updateQty(productId: string, qty: number) {
    const item=items.find(i=>i.productId===productId)
    if(!item||!allowedQuantity(qty,item.max)){setError('الكمية تتجاوز المخزون المتاح');return}
    if (qty <= 0) {
      setItems(prev => prev.filter(i => i.productId !== productId))
    } else {
      setItems(prev => prev.map(i => i.productId === productId ? { ...i, quantity: qty } : i))
    }
  }

  function updatePrice(productId: string, price: string) {
    const v = parseFloat(price)
    if (!isNaN(v) && v >= 0) {
      setItems(prev => prev.map(i => i.productId === productId ? { ...i, unitPrice: v } : i))
    }
  }

  function selectCustomer(c: Customer) {
    setSelectedCustomer(c)
    setCustomerQuery(c.name)
    setShowCustomers(false)
    setCustomerResults([])
  }

  async function handleQuickAddCustomer(e: React.FormEvent) {
    e.preventDefault()
    if (!newCustName.trim()||addingCustomer) return
    if(previewCatalog){setError('معاينة فقط؛ لا تُضاف بيانات عملاء.');return}
    setAddingCustomer(true)
    setError('')
    try {
      const { data: newCust, error: custErr } = await supabase
        .from('customers')
        .insert({
          store_id: storeId,
          name: newCustName.trim(),
          phone: newCustPhone.trim() || null,
          balance: 0,
        })
        .select('id, name, phone, email, balance')
        .single()

      if (custErr) {
        setError(`فشل إضافة العميل: ${custErr.message}`)
      } else if (newCust) {
        // إنشاء حساب تحليلي للعميل في دليل الحسابات تحت 1101 ذمم الزبائن
        try {
          const { data: parentAcc } = await supabase
            .from('accounts')
            .select('id, code')
            .eq('store_id', storeId)
            .eq('type', 'asset')
            .not('name', 'ilike', '%صندوق%')
            .not('name', 'ilike', '%بنك%')
            .or('code.eq.1400,code.eq.1101,name.ilike.%ذمم الزبائن%,name.ilike.%ذمم مدينة%')
            .limit(1)
            .maybeSingle()

          const pCode = parentAcc?.code || '1400'
          const { count: custAccCount } = await supabase
            .from('accounts')
            .select('id', { count: 'exact', head: true })
            .eq('store_id', storeId)
            .ilike('code', `${pCode}%`)

          const nextCode = `${pCode}${String((custAccCount ?? 0) + 1).padStart(3, '0')}`

          await supabase.from('accounts').insert({
            store_id: storeId,
            code: nextCode,
            name: newCustName.trim(),
            type: 'asset',
            normal_balance: 'debit',
            parent_id: parentAcc?.id || null,
            is_group: false,
            is_active: true,
            balance: 0,
          })
        } catch (accErr) {
          console.warn('Customer account creation in chart of accounts skipped or handled by trigger:', accErr)
        }

        selectCustomer(newCust as Customer)
        setShowAddCustomerModal(false)
        setNewCustName('')
        setNewCustPhone('')
      }
    } catch (err: any) {
      setError(err?.message || 'فشل إضافة العميل')
    } finally {
      setAddingCustomer(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if(lock.current||receiptData)return
    setError('')
    if(items.some(i=>!allowedQuantity(i.quantity,i.max)||!Number.isFinite(i.unitPrice)||i.unitPrice<0)||totalAmount<=0){setError('تحقق من الكميات والأسعار');return}
    if(mode==='pos'&&!cash.valid){setError('المبلغ المستلم أقل من إجمالي البيع');return}
    if(mode==='account'&&(!Number.isFinite(Number(amountPaid||0))||Number(amountPaid)<0||Number(amountPaid)>totalAmount)){setError('الدفعة يجب أن تكون بين صفر والإجمالي');return}

    if (!items.length) { setError('أضف منتجاً واحداً على الأقل للسلة'); return }
    if (mode === 'account' && !selectedCustomer) { setError('يرجى اختيار اسم العميل من دليل الحسابات في حالة البيع الآجل'); return }

    if(previewCatalog){setError('معاينة فقط؛ لم تسجل فاتورة أو دفعة.');return}

    lock.current=true
    setSubmitting(true)
    try {
      const activePayMethod = mode === 'pos' ? 'cash' : (paymentMethod || 'credit')
      const activeEffectivePaid = mode === 'pos' ? totalAmount : (parseFloat(amountPaid) || 0)

      const res = await fetch('/api/orders/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode,
          items: items.map(i => ({
            productId: i.productId,
            name: i.name,
            unitPrice: i.unitPrice,
            quantity: i.quantity,
          })),
          customerId: mode === 'account' ? selectedCustomer?.id : undefined,
          customerName: mode === 'account' ? selectedCustomer?.name : (posName.trim() || 'عميل نقدي'),
          customerPhone: mode === 'account' ? (selectedCustomer?.phone || undefined) : (posPhone.trim() || undefined),
          customerEmail: mode === 'account' ? (selectedCustomer?.email || undefined) : (posEmail.trim() || undefined),
          paymentMethod: activePayMethod,
          amountPaid: activeEffectivePaid,
          notes,
        }),
      })

      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'حدث خطأ أثناء الحفظ'); return }

      // إعداد بيانات الإيصال الفوري لنقطة البيع
      const receipt: ReceiptData = {
        orderId: data.orderId,
        orderNumber: data.orderNumber || `ORD-${Date.now()}`,
        createdAt: new Date().toISOString(),
        customerName: mode === 'pos' ? (posName.trim() || 'عميل نقدي') : (selectedCustomer?.name || 'عميل على الحساب'),
        customerPhone: mode === 'pos' ? posPhone : selectedCustomer?.phone,
        items: items.map(i => ({
          name: i.name,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
          totalPrice: i.unitPrice * i.quantity,
        })),
        subtotal,
        totalAmount,
        amountPaid: activeEffectivePaid,
        paymentMethod: activePayMethod,
        paymentStatus: activeEffectivePaid >= totalAmount ? 'paid' : activeEffectivePaid > 0 ? 'partial' : 'unpaid',
        storeName: storeInfo?.name || 'Bazarko Store',
        storePhone: storeInfo?.phone,
        storeAddress: storeInfo?.address,
        taxNumber: storeInfo?.taxNumber,
        currencyCode,
        receiptFooter: storeInfo?.receiptFooter,
        customerBalance: mode === 'account' && selectedCustomer ? selectedCustomer.balance + amountRemaining : null,
      }

      setReceiptData(receipt)
      setShowReceipt(true)
    } catch {
      setError('حدث خطأ في الاتصال بالخادم')
    } finally {
      lock.current=false
      setSubmitting(false)
    }
  }

  function handleNewSale() {
    setItems([])
    setTender('')
    setPosName('عميل نقدي')
    setPosPhone('')
    setPosEmail('')
    setAmountPaid('')
    setNotes('')
    setSelectedCustomer(null)
    setCustomerQuery('')
    setReceiptData(null)
    setShowReceipt(false)
    setError('')
  }

  const fmt = (n: number) => n.toLocaleString('ar-u-nu-latn', { maximumFractionDigits: 2 })

  return (
    <div className={`${posPresentation?styles.page:''} space-y-4`} dir="rtl">
      {/* ── Mode Selection Header ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900 border border-white/10 p-2.5 rounded-2xl shadow-sm">
        <div className="flex rounded-xl bg-slate-950 p-1 border border-white/5">
          <button
            type="button"
            onClick={() => {
              setMode('pos')
              setPaymentMethod('cash')
              setError('')
            }}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-black transition-all ${
              mode === 'pos'
                ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <span>💵</span>
            <span>1. بيع نقدي (الصندوق)</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setMode('account')
              setPaymentMethod('credit')
              setError('')
            }}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-black transition-all ${
              mode === 'account'
                ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <span>📒</span>
            <span>2. بيع آجل (ذمة عميل)</span>
          </button>
        </div>

        <div className="flex items-center gap-2 text-xs text-slate-400 px-2">
          <span>أصناف السلة:</span>
          <span className="font-mono font-bold text-sky-400 bg-sky-500/10 px-2.5 py-0.5 rounded-full border border-sky-500/20">
            {items.reduce((s, i) => s + i.quantity, 0)} قطعة
          </span>
        </div>
      </div>

      {error && (
        <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-3.5 text-xs font-bold text-red-300 flex items-center justify-between">
          <span>⚠️ {error}</span>
          <button type="button" onClick={() => setError('')} className="text-red-400 hover:text-white text-xs mr-2">✕</button>
        </div>
      )}

      {/* ── التقسيم الرئيسي (كتالوج الأصناف يميناً / السلة يساراً) ── */}
      <div className={posPresentation?styles.workspace:"grid grid-cols-1 lg:grid-cols-12 gap-5"}>

        {/* ── كتالوج الأصناف المباشر (7 أعمدة على الشاشات الكبيرة) ── */}
        <div className={posPresentation?styles.catalog:"lg:col-span-7 xl:col-span-8 space-y-4"}>

          {/* شريط البحث اللحظي التراكمي وتصنيفات المنتجات */}
          <div className="rounded-2xl border border-white/10 bg-slate-900/90 p-4 space-y-3">
            {/* حقل البحث اللحظي */}
            <div className="relative">
              <input
                ref={searchField}
                aria-label="البحث أو مسح الباركود"
                onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();scanProduct()}}}
                type="text"
                value={productQuery}
                onChange={e => setProductQuery(e.target.value)}
                placeholder="امسح الباركود أو ابحث عن منتج… F2"
                className="w-full rounded-xl border border-white/10 bg-slate-950 px-4 py-3 text-sm text-white placeholder-slate-500 outline-none focus:border-sky-500 transition shadow-inner"
              />
              {productQuery && (
                <button
                  type="button"
                  onClick={() => setProductQuery('')}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white text-xs bg-white/10 px-2 py-1 rounded-md"
                >
                  مسح ✕
                </button>
              )}
            </div>

            {/* شريط تبويبات التصنيفات */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none text-xs">
              <button
                type="button"
                onClick={() => setSelectedCategory('all')}
                className={`shrink-0 px-3.5 py-1.5 rounded-xl font-bold transition ${
                  selectedCategory === 'all'
                    ? 'bg-sky-500 text-slate-950 shadow-sm'
                    : 'bg-slate-800/80 text-slate-300 hover:bg-slate-700 hover:text-white border border-white/5'
                }`}
              >
                الكل 🌟 ({allProducts.length})
              </button>

              {categories.map(cat => {
                const count = allProducts.filter(p => p.category_id === cat.id).length
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setSelectedCategory(cat.id)}
                    className={`shrink-0 px-3 py-1.5 rounded-xl font-bold transition flex items-center gap-1.5 ${
                      selectedCategory === cat.id
                        ? 'bg-sky-500 text-slate-950 shadow-sm'
                        : 'bg-slate-800/80 text-slate-300 hover:bg-slate-700 hover:text-white border border-white/5'
                    }`}
                  >
                    <span>{cat.name}</span>
                    <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                      selectedCategory === cat.id ? 'bg-slate-950/30 text-slate-950' : 'bg-slate-700 text-slate-400'
                    }`}>
                      {count}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* شبكة بطاقات الأصناف (Card Grid) */}
          {catalogError?<p role="alert" className="p-5 text-rose-300">{catalogError}</p>:loadingCatalog ? (
            <div className="rounded-2xl border border-white/5 bg-slate-900/50 p-12 text-center">
              <span className="text-3xl animate-spin inline-block">⏳</span>
              <p className="mt-3 text-sm text-slate-400 font-bold">جاري تحميل دليل الأصناف والمخزون...</p>
            </div>
          ) : filteredProducts.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/10 bg-slate-900/40 p-12 text-center">
              <span className="text-4xl">🔍</span>
              <p className="mt-2 text-sm text-slate-300 font-bold">لا توجد أصناف مطابقة للبحث</p>
              <p className="text-xs text-slate-500 mt-1">جرب كلمات أخرى أو قم بإلغاء الفلترة</p>
              {productQuery && (
                <button
                  type="button"
                  onClick={() => setProductQuery('')}
                  className="mt-3 text-xs text-sky-400 underline font-bold"
                >
                  إعادة عرض كافة الأصناف
                </button>
              )}
            </div>
          ) : (
            <div className={posPresentation?styles.products:"grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3 max-h-[calc(100vh-280px)] overflow-y-auto pr-1"}>
              {filteredProducts.map(product => {
                const inCartItem = items.find(i => i.productId === product.id)
                const inCartQty = inCartItem?.quantity ?? 0
                const isOutOfStock = product.track_stock && (product.stock_available ?? 0) <= 0
                const hasDiscount = product.compare_price && product.compare_price > product.price
                const discountPct = hasDiscount
                  ? Math.round(((product.compare_price! - product.price) / product.compare_price!) * 100)
                  : 0

                return (
                  <button
                    type="button"
                    disabled={isOutOfStock||submitting||!!receiptData}
                    aria-label={`إضافة ${product.name}`}
                    key={product.id}
                    onClick={() => !isOutOfStock && addProduct(product)}
                    className={`${posPresentation?styles.product:''} group relative flex flex-col justify-between p-3 rounded-2xl border text-right transition duration-150 select-none cursor-pointer ${
                      isOutOfStock
                        ? 'border-white/5 bg-slate-900/40 opacity-50 cursor-not-allowed'
                        : inCartQty > 0
                          ? 'border-sky-500/60 bg-sky-500/10 shadow-md shadow-sky-500/5'
                          : 'border-white/10 bg-slate-900 hover:border-sky-500/40 hover:bg-slate-800/80 shadow-sm'
                    }`}
                  >
                    {/* شارة الكمية في السلة إن وجدت */}
                    {inCartQty > 0 && (
                      <span className="absolute -top-2 -left-2 flex h-6 w-6 items-center justify-center rounded-full bg-sky-500 text-slate-950 font-black text-xs font-mono shadow-md">
                        {inCartQty}
                      </span>
                    )}

                    <div>
                      {/* صورة الصنف */}
                      <div className="relative aspect-video w-full rounded-xl overflow-hidden bg-slate-950 mb-2.5 border border-white/5">
                        {product.thumbnail_url ? (
                          <img
                            src={product.thumbnail_url}
                            alt={product.name}
                            className="h-full w-full object-cover group-hover:scale-105 transition duration-300"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-2xl text-slate-600">
                            📦
                          </div>
                        )}

                        {/* بادج الخصم */}
                        {hasDiscount && (
                          <span className="absolute top-1.5 right-1.5 rounded-md bg-rose-500 px-1.5 py-0.5 text-[10px] font-black text-white shadow">
                            خصم %{discountPct}
                          </span>
                        )}
                      </div>

                      {/* اسم الصنف وكوده */}
                      <h3 className="font-bold text-white text-xs sm:text-sm line-clamp-2 group-hover:text-sky-300 transition">
                        {product.name}
                      </h3>
                      {product.sku && (
                        <p className="text-[11px] text-slate-400 font-mono mt-0.5 truncate" dir="ltr">
                          #{product.sku}
                        </p>
                      )}
                    </div>

                    {/* السعر والمخزون (المحور 16: السعر الأصلي أولاً ثم الصافي) */}
                    <div className="mt-3 pt-2 border-t border-white/5 flex items-end justify-between gap-1">
                      <div>
                        {hasDiscount && (
                          <span className="block text-[11px] line-through text-slate-400 font-mono">
                            {fmt(product.compare_price!)} {currencyCode}
                          </span>
                        )}
                        <span className="text-sm font-black font-mono text-emerald-400">
                          {fmt(product.price)} <span className="text-[10px] text-emerald-400/80">{currencyCode}</span>
                        </span>
                      </div>

                      <div className="text-left">
                        {product.track_stock ? (
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                            isOutOfStock
                              ? 'bg-rose-500/20 text-rose-300'
                              : 'bg-emerald-500/20 text-emerald-300'
                          }`}>
                            {isOutOfStock ? 'نفد' : `${product.stock_available}`}
                          </span>
                        ) : (
                          <span className="text-[10px] text-slate-400">متوفر</span>
                        )}
                      </div>
                    </div>
                    {posPresentation&&<span className={styles.plus} aria-hidden="true">＋</span>}
                  </button>
                )
              })}
            </div>
          )}
          {posPresentation&&<div className={styles.footer}><span>لم تجد المنتج؟</span><Link href="/dashboard/products/new">＋ إضافة منتج</Link><button onClick={()=>{setProductQuery('');setSelectedCategory('all')}}>مسح الفلاتر</button></div>}
        </div>

        {/* ── العمود الجانبي (سلة الطلب والدفع الفوري) - 5 أعمدة ── */}
        <div className={posPresentation?styles.cart:"lg:col-span-5 xl:col-span-4 space-y-4"}>

          {/* كرت السلة وبنود الفاتورة */}
          <div className="rounded-2xl border border-white/10 bg-slate-900/95 p-4 shadow-xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-white/5">
              <h2 className="font-bold text-white text-sm flex items-center gap-2">
                <span>🛒</span> سلة البيع
              </h2>
              {items.length > 0 && (
                <button
                  type="button"
                  onClick={() => setItems([])}
                  className="text-xs text-rose-400 hover:text-rose-300 transition"
                >
                  تفريغ السلة
                </button>
              )}
            </div>

            {/* قائمة البنود */}
            {items.length === 0 ? (
              <div className="rounded-xl border border-dashed border-white/10 py-12 text-center">
                <span className="text-3xl">👈</span>
                <p className="text-xs text-slate-400 mt-2 font-bold">السلة فارغة</p>
                <p className="text-[11px] text-slate-500 mt-0.5">انقر على أي صنف من القائمة لإضافته مباشرة</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                {items.map(item => (
                  <div key={item.productId} className="flex items-center justify-between gap-2 rounded-xl bg-slate-950 p-2.5 border border-white/5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-bold text-white">{item.name}</p>
                      <div className="flex flex-wrap items-center gap-2 mt-1">
                        <div className="flex items-center gap-1">
                          <span className="text-[10px] text-slate-400">البيع:</span>
                          <input
                            type="number"
                            aria-label={`سعر ${item.name}`}
                            value={item.unitPrice}
                            onChange={e => updatePrice(item.productId, e.target.value)}
                            min="0"
                            step="0.01"
                            dir="ltr"
                            className="w-16 rounded border border-white/10 bg-slate-900 px-1.5 py-0.5 text-xs text-emerald-400 font-mono font-bold outline-none focus:border-sky-500"
                          />
                        </div>
                        {Number(item.costPrice || 0) > 0 && (
                          <span className="text-[10px] font-mono text-slate-400 bg-slate-900 px-1.5 py-0.5 rounded border border-white/5" title="تكلفة الصنف المعتمدة">
                            التكلفة: {fmt(item.costPrice || 0)}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* التحكم بالكمية */}
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        aria-label={`تقليل كمية ${item.name}`}
                        onClick={() => updateQty(item.productId, item.quantity - 1)}
                        className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white font-bold transition"
                      >
                        -
                      </button>
                      <span className="w-6 text-center font-mono font-bold text-xs text-white">
                        {item.quantity}
                      </span>
                      <button
                        type="button"
                        aria-label={`زيادة كمية ${item.name}`}
                        onClick={() => updateQty(item.productId, item.quantity + 1)}
                        disabled={item.max!==null && item.quantity >= item.max}
                        className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white font-bold transition disabled:opacity-30"
                      >
                        +
                      </button>
                    </div>

                    {/* إجمالي البند وزر الحذف */}
                    <div className="text-left shrink-0 min-w-[70px]">
                      <p className="text-xs font-bold font-mono text-white" dir="ltr">
                        {fmt(item.unitPrice * item.quantity)}
                      </p>
                      {Number(item.costPrice || 0) > 0 && (
                        <p className="text-[10px] font-mono text-slate-400" dir="ltr" title="إجمالي تكلفة البند">
                          تكلفة: {fmt((item.costPrice || 0) * item.quantity)}
                        </p>
                      )}
                      <button
                        type="button"
                        onClick={() => updateQty(item.productId, 0)}
                        className="text-[11px] text-rose-400 hover:underline mt-0.5 block mr-auto"
                      >
                        حذف
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* ── اختيار العميل وطريقة البيع ── */}
            <div className="pt-2 border-t border-white/5 space-y-3">
              {mode === 'pos' ? (
                <div className="rounded-xl border border-emerald-500/20 bg-emerald-950/20 p-3 space-y-2">
                  <div className="flex items-center justify-between text-emerald-400 font-bold text-xs">
                    <span className="flex items-center gap-1.5">
                      <span>💵</span>
                      <span>بيع نقدي مباشر (الصندوق)</span>
                    </span>

                  </div>
                  <div className="pt-2 border-t border-emerald-500/10 grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] text-slate-400 mb-1 block">اسم العميل (اختياري)</label>
                      <input
                        type="text"
                        value={posName}
                        onChange={e => setPosName(e.target.value)}
                        placeholder="عميل نقدي"
                        className="w-full rounded-lg border border-white/10 bg-slate-950 px-2.5 py-1 text-xs text-white placeholder-slate-500 outline-none focus:border-emerald-500"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-400 mb-1 block">الهاتف (اختياري للإيصال)</label>
                      <input
                        type="tel"
                        value={posPhone}
                        onChange={e => setPosPhone(e.target.value)}
                        placeholder="059xxxxxxx"
                        dir="ltr"
                        className="w-full rounded-lg border border-white/10 bg-slate-950 px-2.5 py-1 text-xs text-white placeholder-slate-500 outline-none focus:border-emerald-500"
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-amber-500/20 bg-amber-950/20 p-3 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
                      <span>👤</span>
                      <span>اختيار العميل من دليل الحسابات *</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => setShowAddCustomerModal(true)}
                      className="text-[10px] text-sky-400 hover:text-sky-300 font-bold bg-sky-500/10 px-2 py-0.5 rounded border border-sky-500/20 transition cursor-pointer"
                    >
                      + إضافة عميل للدليل
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-300">
                    يتم تسجيل العملية على حساب العميل بالذمة. <strong className="text-amber-300">الصندوق لا يتغير في البيع الآجل</strong>.
                  </p>
                  <div className="relative">
                    <input
                      type="text"
                      value={customerQuery}
                      onChange={e => { setCustomerQuery(e.target.value); setShowCustomers(true) }}
                      onFocus={() => setShowCustomers(true)}
                      placeholder="🔍 ابحث بالاسم أو الهاتف في دليل الحسابات..."
                      className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-xs text-white placeholder-slate-500 outline-none focus:border-amber-500"
                    />
                    {showCustomers && customerResults.length > 0 && (
                      <div className="absolute z-30 w-full mt-1 overflow-hidden rounded-xl border border-white/10 bg-slate-800 shadow-2xl">
                        {customerResults.map(c => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => selectCustomer(c)}
                            className="flex w-full items-center justify-between p-2.5 text-right hover:bg-white/5 text-xs text-white border-b border-white/5 last:border-0 cursor-pointer"
                          >
                            <div>
                              <p className="font-bold">{c.name}</p>
                              {c.phone && <p className="text-[10px] text-slate-400">{c.phone}</p>}
                            </div>
                            <div className="text-left">
                              <span className="font-mono text-amber-400 font-bold">{fmt(c.balance)} {currencyCode}</span>
                              <span className="block text-[9px] text-slate-400">رصيد مستحق</span>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {selectedCustomer ? (
                    <div className="rounded-xl bg-slate-950 p-2.5 border border-amber-500/30 text-xs space-y-1">
                      <div className="flex items-center justify-between font-bold text-white">
                        <span>العميل: {selectedCustomer.name}</span>
                        <span className="text-[10px] text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                          ✓ تم الاختيار
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-slate-400 text-[11px]">
                        <span>الرصيد المستحق الحالي:</span>
                        <span className="font-mono text-amber-400 font-bold">{fmt(selectedCustomer.balance)} {currencyCode}</span>
                      </div>
                      <div className="flex items-center justify-between text-slate-400 text-[11px]">
                        <span>الرصيد بعد هذه الفاتورة:</span>
                        <span className="font-mono text-rose-400 font-bold">
                          {fmt(selectedCustomer.balance + amountRemaining)} {currencyCode}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="text-[10px] text-amber-300/80 bg-amber-500/10 p-2 rounded-lg border border-amber-500/20">
                      ⚠️ يرجى البحث واختيار عميل من القائمة لإتمام البيع الآجل
                    </div>
                  )}

                  {/* دفعة نقدية اختيارية مسددة مقدماً */}
                  <div className="pt-2 border-t border-amber-500/10 space-y-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-slate-400">دفعة نقدية مسددة مقدماً (اختياري):</span>
                      <span className="text-slate-400 font-mono">المتبقي ذمة: {fmt(amountRemaining)} {currencyCode}</span>
                    </div>
                    <input
                      type="number"
                      min="0"
                      max={totalAmount}
                      step="0.01"
                      value={amountPaid}
                      onChange={e => setAmountPaid(e.target.value)}
                      placeholder="0.00 (المبلغ بالكامل آجل)"
                      dir="ltr"
                      className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-1.5 text-xs text-emerald-400 font-mono font-bold outline-none focus:border-amber-500"
                    />
                  </div>
                </div>
              )}
            </div>

            {posPresentation&&<><div className={styles.methods}><button type="button" aria-pressed={mode==='pos'} onClick={()=>{setMode('pos');setPaymentMethod('cash')}}>نقد</button><button type="button" aria-pressed={mode==='account'} onClick={()=>{setMode('account');setPaymentMethod('credit')}}>على الحساب</button><button disabled title="تسجل عبر مسار سندات القبض">شيك</button><button disabled title="تسجل عبر مسار سندات القبض">مختلط</button><button disabled title="تسجل عبر مسار سندات القبض">تحويل بنكي</button></div>{mode==='pos'&&<div className={styles.tender}><label>المبلغ المستلم<input aria-label="المبلغ المستلم نقداً" type="number" min="0" step="0.01" value={tender} placeholder={String(totalAmount)} onChange={e=>setTender(e.target.value)}/></label><label>الباقي للزبون<strong>{fmt(cash.change)} {currencyCode}</strong></label></div>}<div className={styles.hold}><button type="button" disabled={submitting||!!receiptData||!items.length} onClick={holdSale}>تعليق البيع</button>{held&&<button type="button" disabled={loadingCatalog} onClick={resumeSale}>استعادة السلة المعلقة</button>}{held&&<button type="button" onClick={()=>{try{sessionStorage.removeItem(`bazarko.pos.held.${storeId}`);setHeld(null);setHoldNotice('حُذفت السلة المعلقة.')}catch{setHoldNotice('تعذر حذف السلة المعلقة.')}}}>حذف المعلقة</button>}</div><p role="status" className={styles.notice}>{holdNotice}</p></>}
            {/* ── الأثر المحاسبي والقيود الآلية ── */}
            <details className="rounded-xl border border-sky-500/20 bg-sky-950/20 p-3 text-[11px] space-y-2"><summary>عرض الأثر المحاسبي التقديري</summary>
              <div className="flex items-center justify-between text-sky-300 font-bold border-b border-sky-500/20 pb-1">
                <span className="flex items-center gap-1.5">
                  <span>⚖️</span> الأثر المحاسبي التلقائي:
                </span>
                <span className="bg-sky-500/20 px-2 py-0.5 rounded text-[10px]">
                  {mode === 'pos' ? 'قيد بيع نقدي' : 'قيد بيع آجل'}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-slate-300">
                <div className="bg-slate-900/90 p-2 rounded-lg border border-white/5">
                  <span className="text-slate-400 block text-[10px]">حركة الصندوق:</span>
                  <span className={`font-mono font-bold ${mode === 'pos' ? 'text-emerald-400' : 'text-slate-400'}`}>
                    {mode === 'pos' ? `+${fmt(totalAmount)} ${currencyCode}` : (effectiveAmountPaid > 0 ? `+${fmt(effectiveAmountPaid)} ${currencyCode}` : 'لا يتغير (0 نقد)')}
                  </span>
                </div>
                <div className="bg-slate-900/90 p-2 rounded-lg border border-white/5">
                  <span className="text-slate-400 block text-[10px]">حساب العميل:</span>
                  <span className={`font-mono font-bold ${mode === 'account' ? 'text-amber-400' : 'text-slate-400'}`}>
                    {mode === 'account' ? `+${fmt(amountRemaining)} ${currencyCode}` : 'لا مديونية'}
                  </span>
                </div>
              </div>

              <div className="bg-slate-900/90 p-2 rounded-lg border border-white/5 space-y-1 font-mono text-[10px]">
                <div className="text-slate-400 font-sans font-bold text-[10px] mb-1">القيود اليومية المزدوجة التلقائية:</div>
                <div className="text-slate-300 leading-tight">
                  <span className="text-slate-400 font-sans">القيد 1: </span>
                  <span>مدين تكلفة البضاعة 5001 / دائن المخزون 1201</span>
                </div>
                <div className="leading-tight">
                  <span className="text-slate-400 font-sans">القيد 2: </span>
                  {mode === 'pos' ? (
                    <span className="text-emerald-300 font-bold">مدين الصندوق 1001 / دائن المبيعات 4001</span>
                  ) : (
                    <span className="text-amber-300 font-bold">
                      مدين {selectedCustomer ? selectedCustomer.name : 'حساب العميل (1101)'} / دائن المبيعات 4001
                    </span>
                  )}
                </div>
              </div>
            </details>
            {/* ملخص الإجمالي وزر الحفظ */}
            <div className="pt-3 border-t border-white/10 space-y-3">
              <div className="flex items-center justify-between text-slate-400 text-xs">
                <span>المجموع الفرعي (البيع):</span>
                <span className="font-mono font-bold text-white">{fmt(subtotal)} {currencyCode}</span>
              </div>

              {totalCost > 0 && (
                <div className="rounded-xl border border-white/5 bg-slate-950 p-2.5 space-y-1 text-[11px] font-mono">
                  <div className="flex items-center justify-between text-slate-400">
                    <span>إجمالي تكلفة الأصناف:</span>
                    <span dir="ltr">{fmt(totalCost)} {currencyCode}</span>
                  </div>
                  <div className="flex items-center justify-between text-emerald-400 font-bold border-t border-white/5 pt-1">
                    <span>صافي الربح التقديري:</span>
                    <span dir="ltr">+{fmt(subtotal - totalCost)} {currencyCode} ({subtotal > 0 ? (((subtotal - totalCost) / subtotal) * 100).toFixed(1) : 0}%)</span>
                  </div>
                </div>
              )}

              <div className="flex items-baseline justify-between pt-1 border-t border-white/5">
                <span className="font-black text-white text-sm">الإجمالي النهائي:</span>
                <div className="text-left">
                  <span className="text-2xl font-black font-mono text-emerald-400">
                    {fmt(totalAmount)}
                  </span>
                  <span className="text-xs font-bold text-emerald-400/80 mr-1">{currencyCode}</span>
                </div>
              </div>

              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting || items.length === 0 || !!receiptData}
                className="w-full flex items-center justify-center gap-2 py-3.5 px-4 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-slate-950 font-black text-sm shadow-lg shadow-emerald-500/10 transition duration-150 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                {submitting ? (
                  <>
                    <span className="animate-spin">⏳</span>
                    <span>جاري حفظ العملية...</span>
                  </>
                ) : (
                  <>
                    <span>⚡</span>
                    <span>إتمام البيع وإصدار الفاتورة</span>
                  </>
                )}
              </button>
            </div>

          </div>

        </div>

      </div>

      {receiptData&&!showReceipt&&<div className={styles.hold}><button onClick={()=>setShowReceipt(true)}>عرض الإيصال المحفوظ</button><button onClick={handleNewSale}>بدء بيع جديد</button></div>}
      {/* مودال الإيصال الفوري والطباعة الحرارية */}
      {showReceipt && receiptData && (
        <PosReceiptModal
          receipt={receiptData}
          isOpen={showReceipt}
          onClose={() => setShowReceipt(false)}
          onNewSale={handleNewSale}
        />
      )}

      {/* مودال إضافة عميل جديد لدليل الحسابات بسرعة */}
      {showAddCustomerModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4" dir="rtl">
          <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-slate-900 p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <h3 className="font-bold text-white text-sm flex items-center gap-2">
                <span>➕</span> إضافة عميل جديد لدليل الحسابات
              </h3>
              <button
                type="button"
                onClick={() => setShowAddCustomerModal(false)}
                className="text-slate-400 hover:text-white text-xs cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleQuickAddCustomer} className="space-y-3">
              <div>
                <label className="text-xs font-bold text-slate-300 block mb-1">اسم العميل *</label>
                <input
                  type="text"
                  required
                  value={newCustName}
                  onChange={e => setNewCustName(e.target.value)}
                  placeholder="الاسم الكامل للعميل"
                  className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-xs text-white placeholder-slate-500 outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-300 block mb-1">رقم الهاتف (اختياري)</label>
                <input
                  type="tel"
                  value={newCustPhone}
                  onChange={e => setNewCustPhone(e.target.value)}
                  placeholder="059xxxxxxx"
                  dir="ltr"
                  className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-xs text-white placeholder-slate-500 outline-none focus:border-amber-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/5">
                <button
                  type="button"
                  onClick={() => setShowAddCustomerModal(false)}
                  className="px-3 py-1.5 rounded-lg border border-white/10 text-xs font-bold text-slate-400 hover:text-white cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={addingCustomer || !newCustName.trim()}
                  className="px-4 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold shadow disabled:opacity-40 cursor-pointer"
                >
                  {addingCustomer ? 'جاري الحفظ...' : 'حفظ واختيار العميل'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
