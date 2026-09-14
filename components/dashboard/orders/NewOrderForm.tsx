'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

import PosReceiptModal, { ReceiptData } from './PosReceiptModal'

interface Product {
  id: string
  name: string
  price: number
  sku: string | null
  stock_available: number | null
  track_stock: boolean
  thumbnail_url: string | null
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

export default function NewOrderForm({ storeId, currencyCode, storeInfo }: Props) {
  const router = useRouter()
  const supabase = createClient()

  const [mode, setMode] = useState<OrderMode>('pos')
  const [items, setItems] = useState<LineItem[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  // إيصال الطباعة الفوري
  const [receiptData, setReceiptData] = useState<ReceiptData | null>(null)
  const [showReceipt, setShowReceipt] = useState(false)

  // Product search
  const [productQuery, setProductQuery] = useState('')
  const [productResults, setProductResults] = useState<Product[]>([])
  const [showProducts, setShowProducts] = useState(false)
  const productSearchRef = useRef<HTMLDivElement>(null)
  const debouncedProduct = useDebounce(productQuery, 250)

  // Customer search (account mode)
  const [customerQuery, setCustomerQuery] = useState('')
  const [customerResults, setCustomerResults] = useState<Customer[]>([])
  const [showCustomers, setShowCustomers] = useState(false)
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null)
  const debouncedCustomer = useDebounce(customerQuery, 250)

  // POS customer info
  const [posName, setPosName] = useState('')
  const [posPhone, setPosPhone] = useState('')
  const [posEmail, setPosEmail] = useState('')

  // Payment
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash')
  const [amountPaid, setAmountPaid] = useState('')
  const [notes, setNotes] = useState('')

  const subtotal = items.reduce((s, i) => s + i.unitPrice * i.quantity, 0)
  const totalAmount = subtotal
  const effectiveAmountPaid = mode === 'pos' ? totalAmount : (parseFloat(amountPaid) || 0)
  const amountRemaining = Math.max(0, totalAmount - effectiveAmountPaid)

  // Search products
  useEffect(() => {
    if (!debouncedProduct.trim()) { setProductResults([]); return }
    supabase
      .from('products')
      .select('id, name, price, sku, stock_available, track_stock, thumbnail_url')
      .eq('store_id', storeId)
      .eq('is_active', true)
      .ilike('name', `%${debouncedProduct}%`)
      .limit(8)
      .then(({ data }: { data: Product[] | null }) => setProductResults(data ?? []))
  }, [debouncedProduct, storeId])

  // Search customers
  useEffect(() => {
    if (!debouncedCustomer.trim() || mode !== 'account') { setCustomerResults([]); return }
    supabase
      .from('customers')
      .select('id, name, phone, email, balance')
      .eq('store_id', storeId)
      .eq('is_active', true)
      .or(`name.ilike.%${debouncedCustomer}%,phone.ilike.%${debouncedCustomer}%`)
      .limit(6)
      .then(({ data }: { data: Customer[] | null }) => setCustomerResults(data ?? []))
  }, [debouncedCustomer, mode, storeId])

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (productSearchRef.current && !productSearchRef.current.contains(e.target as Node)) {
        setShowProducts(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  function addProduct(product: Product) {
    setItems(prev => {
      const existing = prev.find(i => i.productId === product.id)
      if (existing) {
        return prev.map(i => i.productId === product.id
          ? { ...i, quantity: i.quantity + 1 }
          : i
        )
      }
      return [...prev, {
        productId: product.id,
        name: product.name,
        unitPrice: product.price,
        quantity: 1,
        max: product.track_stock ? (product.stock_available ?? null) : null,
      }]
    })
    setProductQuery('')
    setShowProducts(false)
  }

  function updateQty(productId: string, qty: number) {
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (!items.length) { setError('أضف منتجاً واحداً على الأقل'); return }
    if (mode === 'account' && !selectedCustomer) { setError('اختر الزبون من قاعدة البيانات'); return }
    if (mode === 'pos' && !posName.trim()) { setError('اسم الزبون مطلوب'); return }

    setSubmitting(true)
    try {
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
          customerName: mode === 'pos' ? posName : undefined,
          customerPhone: mode === 'pos' ? posPhone : undefined,
          customerEmail: mode === 'pos' ? posEmail : undefined,
          paymentMethod,
          amountPaid: effectiveAmountPaid,
          notes,
        }),
      })

      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'حدث خطأ'); return }

      // إعداد بيانات الإيصال الفوري لنقطة البيع
      const receipt: ReceiptData = {
        orderId: data.orderId,
        orderNumber: data.orderNumber || `ORD-${Date.now()}`,
        createdAt: new Date().toISOString(),
        customerName: mode === 'pos' ? (posName.trim() || 'زبون نقدي') : (selectedCustomer?.name || 'عميل على الحساب'),
        customerPhone: mode === 'pos' ? posPhone : selectedCustomer?.phone,
        items: items.map(i => ({
          name: i.name,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
          totalPrice: i.unitPrice * i.quantity,
        })),
        subtotal,
        totalAmount,
        amountPaid: effectiveAmountPaid,
        paymentMethod,
        paymentStatus: effectiveAmountPaid >= totalAmount ? 'paid' : effectiveAmountPaid > 0 ? 'partial' : 'unpaid',
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
      setError('حدث خطأ في الاتصال')
    } finally {
      setSubmitting(false)
    }
  }

  function handleNewSale() {
    setItems([])
    setPosName('')
    setPosPhone('')
    setPosEmail('')
    setAmountPaid('')
    setNotes('')
    setSelectedCustomer(null)
    setReceiptData(null)
    setShowReceipt(false)
    setError('')
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Mode Tabs */}
      <div className="flex rounded-xl border border-white/10 bg-white/5 p-1">
        {([
          { key: 'pos',     label: '🏪 نقطة بيع (POS)',        desc: 'بيع فوري داخل المحل' },
          { key: 'account', label: '👤 حساب زبون',              desc: 'يضاف لذمة الزبون' },
        ] as const).map(tab => (
          <button
            key={tab.key}
            type="button"
            onClick={() => { setMode(tab.key); setError('') }}
            className={`flex-1 rounded-lg px-4 py-2.5 text-sm transition-all ${
              mode === tab.key
                ? 'bg-sky-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <div className="font-medium">{tab.label}</div>
            <div className={`text-xs mt-0.5 ${mode === tab.key ? 'text-sky-100' : 'text-slate-500'}`}>
              {tab.desc}
            </div>
          </button>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        {/* ── العمود الرئيسي ── */}
        <div className="space-y-5 lg:col-span-2">

          {/* بحث المنتجات */}
          <div className="rounded-2xl border border-white/5 bg-slate-900 p-5">
            <h2 className="mb-4 font-semibold text-white">المنتجات</h2>
            <div ref={productSearchRef} className="relative">
              <input
                type="text"
                value={productQuery}
                onChange={e => { setProductQuery(e.target.value); setShowProducts(true) }}
                onFocus={() => setShowProducts(true)}
                placeholder="🔍 ابحث عن منتج..."
                className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-sky-500/50"
              />
              {showProducts && productResults.length > 0 && (
                <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border border-white/10 bg-slate-800 shadow-xl">
                  {productResults.map(p => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => addProduct(p)}
                      className="flex w-full items-center gap-3 px-4 py-3 text-right hover:bg-white/5"
                    >
                      <div className="h-9 w-9 shrink-0 overflow-hidden rounded-lg bg-white/5">
                        {p.thumbnail_url
                          ? <img src={p.thumbnail_url} alt="" className="h-full w-full object-cover" />
                          : <div className="flex h-full items-center justify-center text-sm">🛍️</div>
                        }
                      </div>
                      <div className="flex-1 min-w-0 text-right">
                        <p className="truncate text-sm text-white">{p.name}</p>
                        {p.sku && <p className="text-xs text-slate-500" dir="ltr">SKU: {p.sku}</p>}
                      </div>
                      <div className="shrink-0 text-left">
                        <p className="text-sm font-semibold text-white" dir="ltr">
                          {p.price.toLocaleString('ar-u-nu-latn')} {currencyCode}
                        </p>
                        {p.track_stock && (
                          <p className={`text-xs ${(p.stock_available ?? 0) > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            {(p.stock_available ?? 0) > 0 ? `${p.stock_available} متوفر` : 'نفد'}
                          </p>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* قائمة العناصر */}
            {items.length > 0 && (
              <div className="mt-4 space-y-2">
                <div className="grid grid-cols-12 gap-2 px-1 text-xs text-slate-500">
                  <span className="col-span-5">المنتج</span>
                  <span className="col-span-2 text-center">الكمية</span>
                  <span className="col-span-3 text-left">السعر</span>
                  <span className="col-span-2 text-left">الإجمالي</span>
                </div>
                {items.map(item => (
                  <div key={item.productId} className="grid grid-cols-12 items-center gap-2 rounded-xl bg-white/3 px-3 py-2.5">
                    <div className="col-span-5">
                      <p className="truncate text-sm text-white">{item.name}</p>
                    </div>
                    <div className="col-span-2 flex items-center justify-center gap-1">
                      <button
                        type="button"
                        onClick={() => updateQty(item.productId, item.quantity - 1)}
                        className="flex h-6 w-6 items-center justify-center rounded-full bg-white/10 text-sm hover:bg-white/20"
                      >−</button>
                      <span className="w-5 text-center text-sm font-medium text-white">{item.quantity}</span>
                      <button
                        type="button"
                        onClick={() => updateQty(item.productId, item.quantity + 1)}
                        disabled={!!item.max && item.quantity >= item.max}
                        className="flex h-6 w-6 items-center justify-center rounded-full bg-white/10 text-sm hover:bg-white/20 disabled:opacity-40"
                      >+</button>
                    </div>
                    <div className="col-span-3">
                      <input
                        type="number"
                        value={item.unitPrice}
                        onChange={e => updatePrice(item.productId, e.target.value)}
                        min="0"
                        step="0.01"
                        dir="ltr"
                        className="w-full rounded-lg border border-white/10 bg-transparent px-2 py-1 text-sm text-white outline-none focus:border-sky-500/50"
                      />
                    </div>
                    <div className="col-span-2 flex items-center justify-between">
                      <span className="text-sm font-semibold text-white" dir="ltr">
                        {(item.unitPrice * item.quantity).toLocaleString('ar-u-nu-latn')}
                      </span>
                      <button
                        type="button"
                        onClick={() => updateQty(item.productId, 0)}
                        className="text-slate-500 hover:text-red-400"
                      >✕</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {items.length === 0 && (
              <div className="mt-4 rounded-xl border border-dashed border-white/10 py-8 text-center">
                <p className="text-sm text-slate-500">ابحث عن منتج وأضفه للطلبية</p>
              </div>
            )}
          </div>

          {/* ملاحظات */}
          <div className="rounded-2xl border border-white/5 bg-slate-900 p-5">
            <label className="mb-2 block text-sm font-medium text-slate-300">ملاحظات (اختياري)</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              placeholder="ملاحظات خاصة بهذه الطلبية..."
              className="w-full resize-none rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder-slate-500 outline-none focus:border-sky-500/50"
            />
          </div>
        </div>

        {/* ── العمود الجانبي ── */}
        <div className="space-y-5">

          {/* معلومات الزبون */}
          <div className="rounded-2xl border border-white/5 bg-slate-900 p-5">
            <h2 className="mb-4 font-semibold text-white">
              {mode === 'pos' ? 'بيانات الزبون (اختياري)' : 'الزبون'}
            </h2>

            {mode === 'pos' ? (
              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-xs text-slate-400">الاسم *</label>
                  <input
                    value={posName}
                    onChange={e => setPosName(e.target.value)}
                    placeholder="اسم الزبون"
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-sky-500/50"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-400">الهاتف</label>
                  <input
                    value={posPhone}
                    onChange={e => setPosPhone(e.target.value)}
                    placeholder="0591234567"
                    dir="ltr"
                    type="tel"
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-sky-500/50"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-400">الإيميل (لإرسال الفاتورة)</label>
                  <input
                    value={posEmail}
                    onChange={e => setPosEmail(e.target.value)}
                    placeholder="email@example.com"
                    dir="ltr"
                    type="email"
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-sky-500/50"
                  />
                </div>
              </div>
            ) : (
              <div className="relative">
                <input
                  type="text"
                  value={customerQuery}
                  onChange={e => {
                    setCustomerQuery(e.target.value)
                    setSelectedCustomer(null)
                    setShowCustomers(true)
                  }}
                  onFocus={() => setShowCustomers(true)}
                  placeholder="🔍 ابحث بالاسم أو الهاتف..."
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-sky-500/50"
                />
                {showCustomers && customerResults.length > 0 && (
                  <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border border-white/10 bg-slate-800 shadow-xl">
                    {customerResults.map(c => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => selectCustomer(c)}
                        className="flex w-full items-start gap-2 px-4 py-3 text-right hover:bg-white/5"
                      >
                        <div className="flex-1">
                          <p className="text-sm font-medium text-white">{c.name}</p>
                          {c.phone && <p className="text-xs text-slate-400" dir="ltr">{c.phone}</p>}
                        </div>
                        {c.balance > 0 && (
                          <span className="mt-0.5 text-xs font-medium text-red-400">
                            ذمة: {c.balance.toLocaleString('ar-u-nu-latn')}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
                {selectedCustomer && (
                  <div className="mt-3 rounded-xl bg-sky-500/10 border border-sky-500/20 px-4 py-3">
                    <p className="text-sm font-semibold text-sky-400">{selectedCustomer.name}</p>
                    {selectedCustomer.phone && (
                      <p className="text-xs text-slate-400" dir="ltr">{selectedCustomer.phone}</p>
                    )}
                    {selectedCustomer.balance > 0 && (
                      <p className="mt-1 text-xs text-red-400">
                        ذمة حالية: {selectedCustomer.balance.toLocaleString('ar-u-nu-latn')} {currencyCode}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* طريقة الدفع */}
          <div className="rounded-2xl border border-white/5 bg-slate-900 p-5">
            <h2 className="mb-4 font-semibold text-white">الدفع</h2>
            <div className="space-y-2">
              {PAYMENT_METHODS.map(m => (
                <label
                  key={m.value}
                  className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition ${
                    paymentMethod === m.value
                      ? 'border-sky-500/40 bg-sky-500/10'
                      : 'border-white/5 hover:border-white/10'
                  }`}
                >
                  <input
                    type="radio"
                    name="payment"
                    value={m.value}
                    checked={paymentMethod === m.value}
                    onChange={() => {
                      setPaymentMethod(m.value as PaymentMethod)
                      if (m.value === 'credit') setAmountPaid('0')
                    }}
                    className="accent-sky-500"
                  />
                  <span>{m.icon}</span>
                  <span className="text-sm text-white">{m.label}</span>
                </label>
              ))}
            </div>

            {/* المبلغ المدفوع — يظهر في account mode فقط */}
            {mode === 'account' && (
              <div className="mt-4">
                <label className="mb-1 block text-xs text-slate-400">
                  دفعة مقدمة / عربون ({currencyCode})
                </label>
                <input
                  type="number"
                  value={amountPaid}
                  onChange={e => setAmountPaid(e.target.value)}
                  min="0"
                  max={totalAmount}
                  step="0.01"
                  placeholder="0"
                  dir="ltr"
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-sky-500/50"
                />
              </div>
            )}
          </div>

          {/* ملخص المالي */}
          <div className="rounded-2xl border border-white/5 bg-slate-900 p-5">
            <h2 className="mb-3 font-semibold text-white">الملخص</h2>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between text-slate-400">
                <span>المجموع</span>
                <span dir="ltr">{subtotal.toLocaleString('ar-u-nu-latn')} {currencyCode}</span>
              </div>
              {mode === 'account' && (
                <>
                  <div className="flex justify-between text-slate-400">
                    <span>المدفوع</span>
                    <span dir="ltr" className="text-emerald-400">{effectiveAmountPaid.toLocaleString('ar-u-nu-latn')} {currencyCode}</span>
                  </div>
                  {amountRemaining > 0 && (
                    <div className="flex justify-between text-slate-400">
                      <span>يُضاف للذمة</span>
                      <span dir="ltr" className="text-red-400">{amountRemaining.toLocaleString('ar-u-nu-latn')} {currencyCode}</span>
                    </div>
                  )}
                </>
              )}
              <div className="border-t border-white/10 pt-2 flex justify-between font-bold text-white">
                <span>الإجمالي</span>
                <span dir="ltr">{totalAmount.toLocaleString('ar-u-nu-latn')} {currencyCode}</span>
              </div>
            </div>

            {error && (
              <p className="mt-3 rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</p>
            )}

            <button
              type="submit"
              disabled={submitting || !items.length}
              className="mt-4 w-full rounded-xl bg-sky-600 py-3 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-40"
            >
              {submitting
                ? 'جاري الإنشاء...'
                : mode === 'pos'
                  ? '✅ إتمام البيع'
                  : '📒 إنشاء وإضافة للذمة'}
            </button>
          </div>
        </div>
      </div>

      {receiptData && (
        <PosReceiptModal
          receipt={receiptData}
          isOpen={showReceipt}
          onClose={() => {
            setShowReceipt(false)
            router.push(`/dashboard/orders/${receiptData.orderId}`)
          }}
          onNewSale={handleNewSale}
        />
      )}
    </form>
  )
}
