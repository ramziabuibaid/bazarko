'use client'

import { useRef, useState } from 'react'
import styles from '@/components/dashboard/quotations/quotations.module.css'
import {validQuote} from '@/lib/quotations/presentation'
import {businessDay} from '@/lib/dashboard/simple-metrics'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import BackToDashboardButton from '@/components/dashboard/BackToDashboardButton'

interface Customer {
  id: string
  name: string
  phone: string | null
  balance?: number
}

interface Product {
  id: string
  name: string
  price: number
  stock_quantity?: number
}

interface QuoteItemRow {
  product_id: string | null
  product_name: string
  quantity: number
  unit_price: number
  is_custom: boolean
  save_to_products: boolean
}

interface Props {
  store: { id: string; name: string; currency_code: string }
  customers: Customer[]
  products: Product[]
  preview?: boolean
}

export default function CreateQuotationClient({ store, customers, products, preview=false }: Props) {
  const router = useRouter()
  const supabase = createClient()

  const submitMode=useRef<'sent'|'draft'>('sent')
  const submitting=useRef(false)
  const [showReview,setShowReview]=useState(false)
  const [savedId,setSavedId]=useState<string|null>(null)
  const [quoteNumber, setQuoteNumber] = useState(`QT-${Date.now().toString().slice(-6)}`)
  const [issueDate, setIssueDate] = useState(businessDay().date)
  const [validUntil, setValidUntil] = useState(() => {
    const d = new Date(`${businessDay().date}T12:00:00Z`)
    d.setUTCDate(d.getUTCDate() + 14)
    return d.toISOString().slice(0, 10)
  })

  // Customer Autocomplete Search State
  const [customerId, setCustomerId] = useState('')
  const [customerSearch, setCustomerSearch] = useState('')
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false)

  const [notes, setNotes] = useState('')
  const [terms, setTerms] = useState('الأسعار حسب البنود الموضحة في العرض. يسري العرض حتى تاريخ الصلاحية المحدد.')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [items, setItems] = useState<QuoteItemRow[]>([
    {
      product_id: products[0]?.id || null,
      product_name: products[0]?.name || '',
      quantity: 1,
      unit_price: products[0]?.price || 0,
      is_custom: products.length===0,
      save_to_products: false,
    },
  ])

  const addItemRow = (isCustom = false) => {
    const firstProd = products[0]
    setItems(prev => [
      ...prev,
      {
        product_id: isCustom ? null : (firstProd?.id || null),
        product_name: isCustom ? '' : (firstProd?.name || ''),
        quantity: 1,
        unit_price: isCustom ? 0 : (firstProd?.price || 0),
        is_custom: isCustom,
        save_to_products: false,
      },
    ])
  }

  const removeItemRow = (idx: number) => {
    if (items.length <= 1) return
    setItems(prev => prev.filter((_, i) => i !== idx))
  }

  const updateItemRow = (idx: number, field: keyof QuoteItemRow, val: any) => {
    setItems(prev =>
      prev.map((item, i) => {
        if (i !== idx) return item
        if (field === 'product_id') {
          const selected = products.find(p => p.id === val)
          return {
            ...item,
            product_id: val,
            product_name: selected?.name || item.product_name,
            unit_price: selected?.price ?? item.unit_price,
          }
        }
        return { ...item, [field]: val }
      }),
    )
  }

  const totalAmount = items.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.unit_price || 0), 0)

  const selectedCustomer = customers.find(c => c.id === customerId)
  const filteredCustomers = customers.filter(c => {
    if (!customerSearch.trim()) return true
    const q = customerSearch.toLowerCase()
    return c.name.toLowerCase().includes(q) || (c.phone && c.phone.includes(q))
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if(submitting.current || savedId) return
    const validation=validQuote(items,issueDate,validUntil)
    if(validation){setError(validation);return}
    if(!quoteNumber.trim()){setError('أدخل رقم عرض السعر');return}
    if(preview){setError('معاينة فقط: تم التحقق من البنود، ولم تُحفظ بيانات.');return}
    submitting.current=true
    setLoading(true)
    setError('')

    try {
      // 1. معالجة البنود الحرة المطلوب حفظها كمنتجات جديدة في الدليل
      const preparedItems = items.map(item=>({...item}))
      for (let i = 0; i < preparedItems.length; i++) {
        const item = preparedItems[i]
        if (item.is_custom && item.save_to_products && item.product_name.trim()) {
          const { data: newProd, error: prodErr } = await supabase
            .from('products')
            .insert({
              store_id: store.id,
              name: item.product_name.trim(),
              price: Number(item.unit_price) || 0,
              is_active: true,
            })
            .select('id')
            .single()

          if (prodErr) throw prodErr
          if (newProd) {
            preparedItems[i].product_id = newProd.id
          }
        }
      }

      // 2. إدراج عرض السعر
      const { data: quote, error: quoteErr } = await supabase
        .from('quotations')
        .insert({
          store_id: store.id,
          quotation_number: quoteNumber.trim(),
          customer_id: customerId || null,
          issue_date: issueDate,
          valid_until: validUntil,
          subtotal: totalAmount,
          total_amount: totalAmount,
          currency: store.currency_code || 'ILS',
          notes: notes.trim() || null,
          terms: terms.trim() || null,
          status: 'draft',
        })
        .select('id')
        .single()

      if (quoteErr) throw quoteErr
      setSavedId(quote.id)

      // 3. إدراج بنود عرض السعر
      const itemPayloads = preparedItems.map((item, idx) => ({
        quotation_id: quote.id,
        product_id: item.product_id || null,
        product_name: item.product_name.trim(),
        quantity: Number(item.quantity),
        unit_price: Number(item.unit_price),
        total_price: Number(item.quantity) * Number(item.unit_price),
        sort_order: idx + 1,
      }))

      const { error: itemsErr } = await supabase.from('quotation_items').insert(itemPayloads)
      if (itemsErr) throw itemsErr

      if(submitMode.current==='sent') {
        const {data:issued,error:issueError}=await supabase.from('quotations').update({status:'sent'}).eq('id',quote.id).eq('store_id',store.id).select('id').single()
        if(issueError || !issued) throw issueError || new Error('تعذر إصدار العرض؛ بقي محفوظاً كمسودة')
      }
      router.push('/dashboard/quotations')
      router.refresh()
    } catch (err: any) {
      setError(err.message || 'فشل حفظ عرض السعر')
    } finally {
      submitting.current=false
      setLoading(false)
    }
  }

  const fmt = (n: number) => Number(n || 0).toLocaleString('ar-u-nu-latn', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  return (
    <div className={`${styles.page} space-y-6`} dir="rtl">
      {/* ── العودة للمبيعات ── */}
      <div>
        <BackToDashboardButton href="/dashboard/sales" label="العودة إلى لوحة إدارة المبيعات" />
      </div>

      {/* ── الترويسة ── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-black text-white flex items-center gap-2">
            <span>✍️</span> إنشاء عرض سعر جديد
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            تجهيز عروض أسعار تفصيلية لعملائك مع إمكانية إضافة خدمات أو أصناف مخصصة وحفظها
          </p>
        </div>

        <Link
          href="/dashboard/quotations"
          className="rounded-xl border border-white/10 bg-slate-800 px-4 py-2 text-xs font-bold text-slate-300 hover:bg-slate-700 hover:text-white transition shadow-sm"
        >
          ← العودة لعروض الأسعار
        </Link>
      </div>

      {error && (
        <div role="alert" className="rounded-xl bg-rose-500/10 border border-rose-500/20 p-4 text-xs font-bold text-rose-300">
          ⚠️ {error}
        </div>
      )}

      <nav className={styles.steps} aria-label="أقسام عرض السعر"><a href="#quote-info">١ معلومات العرض</a><a href="#quote-items">٢ الأصناف</a><button type="button" onClick={()=>setShowReview(v=>!v)}>٣ المراجعة</button></nav>
      <form id="quote-form" onSubmit={handleSubmit} className={styles.formGrid}>
      <div className={styles.formMain}>
      <div className="space-y-6 rounded-2xl border border-white/10 bg-slate-900 p-6 shadow-xl">
        
        {/* بيانات العرض الأساسية */}
        <div id="quote-info" className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label htmlFor="quote-number" className="mb-1 block text-xs font-semibold text-slate-300">رقم عرض السعر *</label>
            <input
              id="quote-number"
              type="text"
              required
              value={quoteNumber}
              onChange={e => setQuoteNumber(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-slate-800 p-2.5 text-xs text-white outline-none focus:border-sky-500 font-mono font-bold"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-300">تاريخ الإصدار *</label>
            <input
              type="date"
              aria-label="تاريخ الإصدار"
              required
              value={issueDate}
              onChange={e => setIssueDate(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-slate-800 p-2.5 text-xs text-white outline-none focus:border-sky-500"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-300">ساري حتى تاريخ *</label>
            <input
              type="date"
              aria-label="ساري حتى تاريخ"
              min={issueDate}
              required
              value={validUntil}
              onChange={e => setValidUntil(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-slate-800 p-2.5 text-xs text-white outline-none focus:border-sky-500"
            />
          </div>
        </div>

        {/* اختيار العميل بالبحث الذكي (Autocomplete) */}
        <div className="relative">
          <label className="mb-1 block text-xs font-semibold text-slate-300">العميل المستهدف (اختياري)</label>
          {customerId && selectedCustomer ? (
            <div className="flex items-center justify-between rounded-xl border border-sky-500/30 bg-sky-500/10 p-3 text-xs text-white">
              <div className="flex items-center gap-3">
                <span className="text-xl">👤</span>
                <div>
                  <span className="font-bold text-sm">{selectedCustomer.name}</span>
                  {selectedCustomer.phone && (
                    <span className="text-slate-400 font-mono text-xs mr-2" dir="ltr">
                      ({selectedCustomer.phone})
                    </span>
                  )}
                  {selectedCustomer.balance !== undefined && (
                    <span className="text-amber-400 font-mono text-xs mr-3">
                      [الرصيد الحالي: {fmt(selectedCustomer.balance)} {store.currency_code}]
                    </span>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => { setCustomerId(''); setCustomerSearch('') }}
                className="text-xs text-rose-400 hover:text-rose-300 underline font-bold"
              >
                تغيير العميل
              </button>
            </div>
          ) : (
            <div>
              <input
                type="text"
                value={customerSearch}
                onChange={e => { setCustomerSearch(e.target.value); setShowCustomerDropdown(true) }}
                onFocus={() => setShowCustomerDropdown(true)}
                placeholder="🔍 ابحث بالاسم أو رقم الهاتف لاختيار العميل..."
                className="w-full rounded-xl border border-white/10 bg-slate-800 p-3 text-xs text-white outline-none focus:border-sky-500 placeholder-slate-500"
              />
              {showCustomerDropdown && (
                <div className="absolute z-30 mt-1 max-h-52 w-full overflow-y-auto rounded-xl border border-white/10 bg-slate-800 shadow-2xl">
                  <button
                    type="button"
                    onClick={() => { setCustomerId(''); setShowCustomerDropdown(false) }}
                    className="w-full text-right p-2.5 text-xs text-slate-300 hover:bg-white/5 border-b border-white/5 font-bold"
                  >
                    عميل عام (غير مسجل بالدليل)
                  </button>
                  {filteredCustomers.map(c => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        setCustomerId(c.id)
                        setShowCustomerDropdown(false)
                        setCustomerSearch('')
                      }}
                      className="w-full flex items-center justify-between p-2.5 text-right text-xs text-white hover:bg-sky-500/10 border-b border-white/5 last:border-0"
                    >
                      <div>
                        <p className="font-bold">{c.name}</p>
                        {c.phone && <p className="text-[10px] text-slate-400 font-mono" dir="ltr">{c.phone}</p>}
                      </div>
                      {c.balance !== undefined && (
                        <span className="font-mono text-amber-400 text-xs">{fmt(c.balance)} {store.currency_code}</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── جدول الأصناف والبنود (تشمل البنود الحرة والخدمات) ── */}
        <div id="quote-items" className="space-y-3 border-t border-white/10 pt-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <label className="text-xs font-bold text-white block">الأصناف والخدمات في عرض السعر</label>
              <span className="text-[11px] text-slate-400">يمكنك اختيار منتجات من الدليل أو إدخال خدمات وبنود حرة</span>
            </div>
            
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => addItemRow(false)}
                className="text-xs font-bold text-sky-400 hover:text-sky-300 bg-sky-500/10 border border-sky-500/20 px-3 py-1.5 rounded-xl transition"
              >
                ⊕ صنف من الدليل
              </button>
              <button
                type="button"
                onClick={() => addItemRow(true)}
                className="text-xs font-bold text-emerald-400 hover:text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5 rounded-xl transition"
              >
                ✨ بند / خدمة حرة
              </button>
            </div>
          </div>

          <div className="space-y-2.5">
            {items.map((item, idx) => (
              <div key={idx} className="rounded-xl bg-slate-800/60 p-3 border border-white/5 space-y-2">
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="text-slate-500 font-mono text-xs w-5 text-center font-bold">{idx + 1}</span>

                  {/* نوع البند: من الدليل أو حر */}
                  <div className="flex-1 min-w-[200px]">
                    {item.is_custom ? (
                      <input
                        type="text"
                        required
                        value={item.product_name}
                        onChange={e => updateItemRow(idx, 'product_name', e.target.value)}
                        placeholder="اسم الصنف أو الخدمة الحرة..."
                        className="w-full rounded-lg border border-emerald-500/30 bg-slate-900 p-2 text-xs text-white outline-none focus:border-emerald-500 font-semibold"
                      />
                    ) : (
                      <select
                        value={item.product_id || ''}
                        onChange={e => updateItemRow(idx, 'product_id', e.target.value)}
                        className="w-full rounded-lg border border-white/10 bg-slate-900 p-2 text-xs text-white outline-none focus:border-sky-500 font-semibold"
                      >
                        {products.map(p => (
                          <option key={p.id} value={p.id}>
                            {p.name} ({fmt(p.price)} {store.currency_code})
                          </option>
                        ))}
                      </select>
                    )}
                  </div>

                  {/* الكمية */}
                  <div className="w-24">
                    <input
                      type="number"
                      min="0.001"
                      step="any"
                      aria-label={`كمية البند ${idx+1}`}
                      placeholder="الكمية"
                      value={item.quantity}
                      onChange={e => updateItemRow(idx, 'quantity', Number(e.target.value))}
                      className="w-full rounded-lg border border-white/10 bg-slate-900 p-2 text-xs text-white outline-none font-mono text-center"
                    />
                  </div>

                  {/* السعر */}
                  <div className="w-28">
                    <input
                      type="number"
                      step="any"
                      min="0"
                      aria-label={`سعر البند ${idx+1}`}
                      placeholder="السعر"
                      value={item.unit_price}
                      onChange={e => updateItemRow(idx, 'unit_price', Number(e.target.value))}
                      className="w-full rounded-lg border border-white/10 bg-slate-900 p-2 text-xs text-white outline-none font-mono text-center font-bold text-emerald-400"
                    />
                  </div>

                  {/* الإجمالي */}
                  <div className="w-28 text-left font-mono font-black text-white text-xs" dir="ltr">
                    {fmt(item.quantity * item.unit_price)} {store.currency_code}
                  </div>

                  {/* حذف */}
                  {items.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeItemRow(idx)}
                      className="text-slate-500 hover:text-rose-400 font-bold px-1 text-sm"
                    >
                      ✕
                    </button>
                  )}
                </div>

                {/* خيار الحفظ في دليل الأصناف للبند المخصص */}
                {item.is_custom && (
                  <div className="flex items-center gap-2 pr-7 text-[11px] text-slate-300">
                    <input
                      type="checkbox"
                      id={`save_to_prod_${idx}`}
                      checked={item.save_to_products}
                      onChange={e => updateItemRow(idx, 'save_to_products', e.target.checked)}
                      className="rounded border-white/20 bg-slate-800 text-sky-500 focus:ring-0"
                    />
                    <label htmlFor={`save_to_prod_${idx}`} className="cursor-pointer">
                      ☑️ حفظ هذا البند كمنتج جديد في قائمة الأصناف الرئيسية للمتجر
                    </label>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* ملخص الإجمالي */}
        <div className="rounded-xl border border-white/10 bg-slate-950 p-4 flex justify-between items-center text-xs">
          <span className="font-bold text-slate-300">الإجمالي الكلي لعرض السعر:</span>
          <span className="font-mono font-black text-2xl text-sky-400">
            {fmt(totalAmount)} <span className="text-sm">{store.currency_code}</span>
          </span>
        </div>

        {/* الشروط والملاحظات */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border-t border-white/10 pt-4">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-300">الشروط والأحكام</label>
            <textarea
              rows={2}
              value={terms}
              onChange={e => setTerms(e.target.value)}
              className="w-full resize-none rounded-xl border border-white/10 bg-slate-800 p-2.5 text-xs text-white outline-none focus:border-sky-500"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-300">ملاحظات إضافية</label>
            <textarea
              rows={2}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="أي ملاحظات خاصة موجهة للعميل..."
              className="w-full resize-none rounded-xl border border-white/10 bg-slate-800 p-2.5 text-xs text-white outline-none focus:border-sky-500"
            />
          </div>
        </div>

      </div>
      {showReview&&<section className={styles.review}><h2>مراجعة العرض</h2><p>{selectedCustomer?.name||'عميل عام'} · {quoteNumber} · {issueDate} — {validUntil}</p><ul>{items.map((item,i)=><li key={i}>{item.product_name||'بند غير محدد'} — {item.quantity} × {fmt(item.unit_price)} = {fmt(item.quantity*item.unit_price)} {store.currency_code}</li>)}</ul></section>}
      </div>
      <aside className={styles.summary}><h2>ملخص عرض السعر</h2><p>الإجمالي الكلي</p><strong dir="ltr">{store.currency_code} {fmt(totalAmount)}</strong><p>عدد البنود: {items.length}<br/>العميل: {selectedCustomer?.name||'عميل عام'}<br/>ساري حتى: {validUntil}</p><p>الإجمالي هو مجموع البنود. لا تُضاف ضريبة أو خصم تلقائي. حدّد شروط الأسعار بوضوح.</p>
      <button type="submit" disabled={loading||!!savedId} onClick={()=>{submitMode.current='sent'}}>{loading?'جارٍ الحفظ…':'✓ حفظ وإصدار عرض السعر'}</button>
      <button type="submit" disabled={loading||!!savedId} onClick={()=>{submitMode.current='draft'}}>حفظ كمسودة</button>
      <button type="button" onClick={()=>setShowReview(v=>!v)}>{showReview?'إخفاء المعاينة':'معاينة العرض'}</button>
      {savedId&&<p role="status">تم إنشاء سجل العرض. إذا تعذر إكمال البنود، راجع المسودة في القائمة قبل إصدار عرض آخر. <Link href="/dashboard/quotations">العودة للقائمة</Link></p>}
      </aside>
      </form>
    </div>
  )
}
