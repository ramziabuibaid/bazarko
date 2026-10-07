'use client'

import { useRef, useState, useMemo, useCallback } from 'react'
import styles from '@/components/dashboard/quotations/quotations.module.css'
import {
  validQuote,
  calculateQuotationTotals,
  formatQuoteShareMessage,
  type QuotationLineItem
} from '@/lib/quotations/presentation'
import { businessDay } from '@/lib/dashboard/simple-metrics'
import { normalizeArabicText } from '@/lib/products/directory'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import BackToDashboardButton from '@/components/dashboard/BackToDashboardButton'
import WhatsAppContactMenu from '@/components/whatsapp/WhatsAppContactMenu'

interface Customer {
  id: string
  name: string
  phone: string | null
  balance?: number
  whatsapp_prefix?: string | null
}

interface Product {
  id: string
  name: string
  price: number
  cost_price?: number
  stock_quantity?: number
  sku?: string | null
  barcode?: string | null
  is_active?: boolean
  thumbnail_url?: string | null
  images?: string[] | null
}

function useDebounce<T extends (...args: Parameters<T>) => void>(fn: T, ms: number) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  return useCallback((...args: Parameters<T>) => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => fn(...args), ms)
  }, [fn, ms])
}

function buildSafeSqlPattern(token: string): string {
  let s = token.replace(/[,()%]/g, '')
  // Replace taa marbuta and haa with single-char wildcard
  s = s.replace(/[ةه]/g, '_')
  // Replace hamza variants (أ, إ, آ, ٱ) with single-char wildcard
  s = s.replace(/[أإآٱ]/g, '_')
  // If token is longer than 2 characters and starts with plain 'ا', replace leading 'ا' with '_' to match Hamza or bare Alef
  if (s.length > 2 && s.startsWith('ا')) {
    s = '_' + s.slice(1)
  }
  return s
}

interface QuoteItemRow extends QuotationLineItem {
  id_temp: string
  thumbnail_url?: string | null
  images?: string[] | null
}

export interface InitialQuote {
  id: string
  quotation_number: string
  customer_id: string | null
  issue_date: string
  valid_until: string | null
  status: string
  subtotal: number
  discount: number
  total_amount: number
  currency: string
  notes: string | null
  terms: string | null
  customer?: Customer | null
  items: Array<{
    id: string
    product_id: string | null
    product_name: string
    quantity: number
    unit_price: number
    total_price: number
    sort_order?: number
    product?: {
      id: string
      thumbnail_url?: string | null
      images?: string[] | null
      cost_price?: number
    } | null
  }>
}

interface Props {
  store: { id: string; name: string; currency_code: string; subdomain?: string; country_code?: string }
  customers: Customer[]
  products: Product[]
  preview?: boolean
  initialQuote?: InitialQuote
}

export default function CreateQuotationClient({ store, customers, products, preview = false, initialQuote }: Props) {
  const router = useRouter()
  const supabase = createClient()
  const isEditMode = Boolean(initialQuote)

  // Parse metadata from notes if initialQuote is provided
  const initialMeta = useMemo(() => {
    if (!initialQuote?.notes) return {}
    try {
      const match = initialQuote.notes.match(/\[\[META:([\s\S]*?)\]\]/)
      if (match && match[1]) return JSON.parse(match[1])
    } catch {}
    return {}
  }, [initialQuote?.notes])

  const submitMode = useRef<'sent' | 'draft'>('sent')
  const submitting = useRef(false)
  const [showReview, setShowReview] = useState(false)
  const [savedId, setSavedId] = useState<string | null>(null)
  const [createdQuote, setCreatedQuote] = useState<{ id: string; number: string; shareUrl: string } | null>(null)
  const [quoteNumber, setQuoteNumber] = useState(
    initialQuote ? initialQuote.quotation_number : `QT-${Date.now().toString().slice(-6)}`
  )
  const [issueDate, setIssueDate] = useState(
    initialQuote?.issue_date ? initialQuote.issue_date.slice(0, 10) : businessDay().date
  )
  const [validUntil, setValidUntil] = useState(() => {
    if (initialQuote?.valid_until) return initialQuote.valid_until.slice(0, 10)
    const d = new Date(`${businessDay().date}T12:00:00Z`)
    d.setUTCDate(d.getUTCDate() + 14)
    return d.toISOString().slice(0, 10)
  })

  // Customer Autocomplete Search State
  const [customerId, setCustomerId] = useState(initialQuote?.customer_id || '')
  const [customerSearch, setCustomerSearch] = useState('')
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false)
  const [searchedCustomers, setSearchedCustomers] = useState<Customer[]>([])
  const [isSearchingCustomers, setIsSearchingCustomers] = useState(false)
  const customerSearchVersion = useRef(0)

  // New Customer Modal & Form State
  const [showAddCustomerModal, setShowAddCustomerModal] = useState(false)
  const [newCustName, setNewCustName] = useState('')
  const [newCustPhone, setNewCustPhone] = useState('')
  const [newCustAddress, setNewCustAddress] = useState('')
  const [newCustNotes, setNewCustNotes] = useState('')
  const [custSaving, setCustSaving] = useState(false)
  const [custModalError, setCustModalError] = useState('')
  const [duplicateWarning, setDuplicateWarning] = useState<{
    phone: string
    customer: Customer
  } | null>(null)

  // Product Autocomplete Search State
  const [productSearch, setProductSearch] = useState('')
  const [showProductDropdown, setShowProductDropdown] = useState(false)
  const [searchedProducts, setSearchedProducts] = useState<Product[]>([])
  const [isSearchingProducts, setIsSearchingProducts] = useState(false)
  const productSearchVersion = useRef(0)

  // Discounts
  const [specialDiscountType, setSpecialDiscountType] = useState<'amount' | 'percent'>(
    initialMeta.specialDiscountType === 'percent' ? 'percent' : 'amount'
  )
  const [specialDiscountValue, setSpecialDiscountValue] = useState<number>(
    Number(initialMeta.specialDiscountValue ?? initialMeta.specialDiscount ?? 0)
  )

  // Show Cost and Profit
  const [showInternalProfit, setShowInternalProfit] = useState(false)

  const [notes, setNotes] = useState(() => {
    if (!initialQuote?.notes) return ''
    return initialQuote.notes.replace(/\n?\[\[META:[\s\S]*?\]\]/g, '').trim()
  })
  const [terms, setTerms] = useState(
    initialQuote?.terms || 'الأسعار حسب البنود الموضحة في العرض. يسري العرض حتى تاريخ الصلاحية المحدد.'
  )
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // البنود (تبدأ فارغة عند الإنشاء الجديد، أو محملة عند التعديل)
  const [items, setItems] = useState<QuoteItemRow[]>(() => {
    if (!initialQuote || !initialQuote.items) return []
    const gifts: Record<string, boolean> = initialMeta.gifts || {}
    return initialQuote.items
      .slice()
      .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))
      .map(item => {
        const prod = item.product
        return {
          id_temp: `saved-${item.id}`,
          product_id: item.product_id,
          product_name: item.product_name,
          quantity: Number(item.quantity) || 1,
          unit_price: Number(item.unit_price) || 0,
          cost_price: Number(prod?.cost_price || 0),
          is_gift: !!gifts[item.id],
          is_custom: !item.product_id,
          save_to_products: false,
          thumbnail_url: prod?.thumbnail_url || (Array.isArray(prod?.images) && prod?.images[0]) || null,
          images: prod?.images || null,
        }
      })
  })

  // Live Server Product Search (Debounced 150ms)
  const searchServerProducts = useDebounce(async (queryStr: string) => {
    const raw = queryStr.trim()
    if (!raw) {
      setSearchedProducts([])
      setIsSearchingProducts(false)
      return
    }

    const version = ++productSearchVersion.current
    setIsSearchingProducts(true)

    const tokens = raw.split(/\s+/).filter(Boolean)
    let query = supabase
      .from('products')
      .select('id, name, price, cost_price, stock_quantity, sku, barcode, is_active, thumbnail_url, images')
      .eq('store_id', store.id)

    for (const t of tokens) {
      const safe = buildSafeSqlPattern(t)
      if (safe) {
        query = query.or(`name.ilike.%${safe}%,sku.ilike.%${safe}%,barcode.ilike.%${safe}%`)
      }
    }

    query = query
      .order('is_active', { ascending: false })
      .order('stock_quantity', { ascending: false })
      .limit(50)

    const { data, error: searchErr } = await query
    if (version === productSearchVersion.current) {
      setIsSearchingProducts(false)
      if (!searchErr && data) {
        setSearchedProducts(data as Product[])
      }
    }
  }, 150)

  // Live Server Customer Search (Debounced 150ms)
  const searchServerCustomers = useDebounce(async (queryStr: string) => {
    const raw = queryStr.trim()
    if (!raw) {
      setSearchedCustomers([])
      setIsSearchingCustomers(false)
      return
    }

    const version = ++customerSearchVersion.current
    setIsSearchingCustomers(true)

    const tokens = raw.split(/\s+/).filter(Boolean)
    let query = supabase
      .from('customers')
      .select('id, name, phone, balance')
      .eq('store_id', store.id)

    for (const t of tokens) {
      const safe = buildSafeSqlPattern(t)
      if (safe) {
        query = query.or(`name.ilike.%${safe}%,phone.ilike.%${safe}%`)
      }
    }

    query = query.order('name').limit(25)

    const { data, error: searchErr } = await query
    if (version === customerSearchVersion.current) {
      setIsSearchingCustomers(false)
      if (!searchErr && data) {
        setSearchedCustomers(data as Customer[])
      }
    }
  }, 150)

  // Combined Customer Directory
  const allCustomersMap = useMemo(() => {
    const map = new Map<string, Customer>()
    for (const c of customers) map.set(c.id, c)
    for (const c of searchedCustomers) map.set(c.id, c)
    return map
  }, [customers, searchedCustomers])

  const selectedCustomer = customerId ? allCustomersMap.get(customerId) : undefined

  // Smart Filter for Customers
  const filteredCustomers = useMemo(() => {
    const q = customerSearch.trim()
    if (!q) return customers.slice(0, 15)

    const normQ = normalizeArabicText(q)
    const tokens = normQ.split(/\s+/).filter(Boolean)
    const pool = Array.from(allCustomersMap.values())

    return pool.filter(c => {
      const target = normalizeArabicText(`${c.name} ${c.phone || ''}`)
      return tokens.every(t => target.includes(t))
    }).slice(0, 25)
  }, [customerSearch, customers, allCustomersMap])

  // التحقق من تكرار رقم هاتف الزبون
  const checkPhoneDuplicate = useCallback(async (rawPhone: string): Promise<Customer | null> => {
    const cleanDigits = rawPhone.replace(/\D/g, '')
    if (!cleanDigits || cleanDigits.length < 7) {
      return null
    }

    // 1. فحص القائمة المحلية في الذاكرة
    const localMatch = Array.from(allCustomersMap.values()).find(c => {
      const d = (c.phone || '').replace(/\D/g, '')
      if (!d) return false
      return d === cleanDigits || d.endsWith(cleanDigits) || cleanDigits.endsWith(d)
    })
    if (localMatch) return localMatch

    // 2. استعلام قاعدة البيانات في Supabase للتأكد من عدم وجود زبون بنفس الرقم
    try {
      const { data, error } = await supabase
        .from('customers')
        .select('id, name, phone, balance')
        .eq('store_id', store.id)
        .or(`phone.eq.${rawPhone.trim()},phone.ilike.%${cleanDigits.slice(-7)}%`)
        .limit(5)

      if (!error && data && data.length > 0) {
        const dbMatch = (data as Customer[]).find(c => {
          const d = (c.phone || '').replace(/\D/g, '')
          return d && (d === cleanDigits || d.endsWith(cleanDigits) || cleanDigits.endsWith(d))
        })
        if (dbMatch) return dbMatch
      }
    } catch {}

    return null
  }, [allCustomersMap, store.id, supabase])

  const handleNewCustPhoneChange = async (val: string) => {
    setNewCustPhone(val)
    setCustModalError('')
    if (val.trim().length >= 7) {
      const dup = await checkPhoneDuplicate(val)
      if (dup) {
        setDuplicateWarning({ phone: val.trim(), customer: dup })
      } else {
        setDuplicateWarning(null)
      }
    } else {
      setDuplicateWarning(null)
    }
  }

  const handleCreateCustomer = async (e: React.FormEvent) => {
    e.preventDefault()
    if (custSaving) return
    const name = newCustName.trim()
    if (!name) {
      setCustModalError('يرجى إدخال اسم العميل')
      return
    }

    const phone = newCustPhone.trim()
    if (phone) {
      const dup = await checkPhoneDuplicate(phone)
      if (dup) {
        setDuplicateWarning({ phone, customer: dup })
        setCustModalError(`⚠️ تنبيه: رقم الموبايل (${phone}) مسجل مسبقاً باسم العميل «${dup.name}». يرجى استخدام رقم آخر أو اختيار الزبون المسجل.`)
        return
      }
    }

    setCustSaving(true)
    setCustModalError('')

    try {
      const { data: newCust, error: err } = await supabase
        .from('customers')
        .insert({
          store_id: store.id,
          name,
          phone: phone || null,
          address: newCustAddress.trim() || null,
          notes: newCustNotes.trim() || null,
          customer_type: 'retail',
          balance: 0,
          credit_limit: 0,
        })
        .select('id, name, phone, balance')
        .single()

      if (err) throw err

      if (newCust) {
        // تحديث قائمة العملاء وتحديد العميل الجديد فوراً
        setSearchedCustomers(prev => [newCust as Customer, ...prev])
        setCustomerId(newCust.id)
        setShowAddCustomerModal(false)
        setNewCustName('')
        setNewCustPhone('')
        setNewCustAddress('')
        setNewCustNotes('')
        setDuplicateWarning(null)
        setCustomerSearch('')
        setShowCustomerDropdown(false)
      }
    } catch (err: any) {
      setCustModalError(err.message || 'تعذر إضافة العميل. يرجى التحقق من البيانات والمحاولة مجدداً.')
    } finally {
      setCustSaving(false)
    }
  }

  // Combined Product Directory
  const allProductsMap = useMemo(() => {
    const map = new Map<string, Product>()
    for (const p of products) map.set(p.id, p)
    for (const p of searchedProducts) map.set(p.id, p)
    return map
  }, [products, searchedProducts])

  // Smart Filter for Products (combines instant memory and live server results with Arabic normalization)
  const filteredProducts = useMemo(() => {
    const q = productSearch.trim()
    if (!q) {
      return products.slice(0, 20)
    }

    const normQ = normalizeArabicText(q)
    const tokens = normQ.split(/\s+/).filter(Boolean)
    const pool = Array.from(allProductsMap.values())

    const matches = pool.filter(p => {
      const target = normalizeArabicText(`${p.name} ${p.price} ${p.sku || ''} ${p.barcode || ''}`)
      return tokens.every(t => target.includes(t))
    })

    // Sort to keep positive stock and active products on top
    return matches.sort((a, b) => {
      const stockA = Number(a.stock_quantity ?? 0)
      const stockB = Number(b.stock_quantity ?? 0)
      if (stockA > 0 && stockB <= 0) return -1
      if (stockB > 0 && stockA <= 0) return 1
      return 0
    }).slice(0, 40)
  }, [productSearch, products, allProductsMap])

  // Calculations
  const calculations = useMemo(() => {
    return calculateQuotationTotals(items, specialDiscountType, specialDiscountValue)
  }, [items, specialDiscountType, specialDiscountValue])

  // Add Product from Catalog
  const addProductItem = (p: Product) => {
    setItems(prev => [
      ...prev,
      {
        id_temp: `temp-${Date.now()}-${Math.random()}`,
        product_id: p.id,
        product_name: p.name,
        quantity: 1,
        unit_price: Number(p.price) || 0,
        cost_price: Number(p.cost_price) || 0,
        is_gift: false,
        is_custom: false,
        save_to_products: false,
        thumbnail_url: p.thumbnail_url || (Array.isArray(p.images) && p.images[0]) || null,
        images: p.images || null,
      },
    ])
    setProductSearch('')
    setShowProductDropdown(false)
  }

  // Add Named Custom / Free Item
  const addNamedCustomItem = (name: string) => {
    const trimmed = name.trim()
    if (!trimmed) return
    setItems(prev => [
      ...prev,
      {
        id_temp: `temp-${Date.now()}-${Math.random()}`,
        product_id: null,
        product_name: trimmed,
        quantity: 1,
        unit_price: 0,
        cost_price: 0,
        is_gift: false,
        is_custom: true,
        save_to_products: false,
      },
    ])
    setProductSearch('')
    setShowProductDropdown(false)
  }

  // Add Custom / Free Item
  const addCustomItem = () => {
    setItems(prev => [
      ...prev,
      {
        id_temp: `temp-${Date.now()}-${Math.random()}`,
        product_id: null,
        product_name: '',
        quantity: 1,
        unit_price: 0,
        cost_price: 0,
        is_gift: false,
        is_custom: true,
        save_to_products: false,
      },
    ])
  }

  // Move Item Up / Down (Reordering)
  const moveItem = (index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1
    if (targetIndex < 0 || targetIndex >= items.length) return
    setItems(prev => {
      const next = [...prev]
      const temp = next[index]
      next[index] = next[targetIndex]
      next[targetIndex] = temp
      return next
    })
  }

  // Drag & Drop Reordering
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null)
  const handleDragStart = (idx: number) => {
    setDraggedIdx(idx)
  }
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
  }
  const handleDrop = (targetIdx: number) => {
    if (draggedIdx === null || draggedIdx === targetIdx) return
    setItems(prev => {
      const next = [...prev]
      const [removed] = next.splice(draggedIdx, 1)
      next.splice(targetIdx, 0, removed)
      return next
    })
    setDraggedIdx(null)
  }

  const removeItemRow = (idx: number) => {
    setItems(prev => prev.filter((_, i) => i !== idx))
  }

  const updateItemRow = (idx: number, field: keyof QuoteItemRow, val: any) => {
    setItems(prev =>
      prev.map((item, i) => {
        if (i !== idx) return item
        return { ...item, [field]: val }
      })
    )
  }

  const toggleGift = (idx: number) => {
    setItems(prev =>
      prev.map((item, i) => {
        if (i !== idx) return item
        return { ...item, is_gift: !item.is_gift }
      })
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (submitting.current || savedId) return
    const validation = validQuote(items, issueDate, validUntil)
    if (validation) {
      setError(validation)
      return
    }
    if (!quoteNumber.trim()) {
      setError('أدخل رقم عرض السعر')
      return
    }
    if (preview) {
      setError('معاينة فقط: تم التحقق من البنود، ولم تُحفظ بيانات.')
      return
    }
    submitting.current = true
    setLoading(true)
    setError('')

    try {
      // 1. معالجة البنود الحرة المطلوب حفظها كمنتجات جديدة
      const preparedItems = items.map(item => ({ ...item }))
      for (let i = 0; i < preparedItems.length; i++) {
        const item = preparedItems[i]
        if (item.is_custom && item.save_to_products && item.product_name.trim()) {
          const { data: newProd, error: prodErr } = await supabase
            .from('products')
            .insert({
              store_id: store.id,
              name: item.product_name.trim(),
              price: Number(item.unit_price) || 0,
              cost_price: Number(item.cost_price) || 0,
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

      // 2. إعداد الملاحظات وتضمين الميتاداتا
      const meta = {
        gifts: preparedItems.reduce((acc, it, idx) => {
          if (it.is_gift) acc[`row_${idx}`] = true
          return acc
        }, {} as Record<string, boolean>),
        specialDiscount: calculations.specialDiscount,
        specialDiscountType,
        specialDiscountValue,
        giftDiscount: calculations.giftDiscount,
        netTotal: calculations.netTotal,
      }
      const finalNotes = `${notes.trim()}\n\n[[META:${JSON.stringify(meta)}]]`.trim()
      let quoteId = initialQuote?.id || ''
      const finalQuoteNumber = quoteNumber.trim()

      if (isEditMode && initialQuote) {
        // تحديث سجل عرض السعر القائم
        const { error: quoteErr } = await supabase
          .from('quotations')
          .update({
            quotation_number: finalQuoteNumber,
            customer_id: customerId || null,
            issue_date: issueDate,
            valid_until: validUntil,
            subtotal: calculations.subtotal,
            discount: calculations.totalDiscount,
            total_amount: calculations.netTotal,
            currency: store.currency_code || 'ILS',
            notes: finalNotes || null,
            terms: terms.trim() || null,
            ...(submitMode.current === 'sent' && initialQuote.status === 'draft' ? { status: 'sent' } : {}),
          })
          .eq('id', initialQuote.id)
          .eq('store_id', store.id)

        if (quoteErr) throw quoteErr
        quoteId = initialQuote.id

        // حذف البنود القديمة لإعادة إدراج البنود المحدثة والمرتبة
        const { error: delErr } = await supabase
          .from('quotation_items')
          .delete()
          .eq('quotation_id', quoteId)

        if (delErr) throw delErr

        // إدراج بنود عرض السعر
        const itemPayloads = preparedItems.map((item, idx) => ({
          quotation_id: quoteId,
          product_id: item.product_id || null,
          product_name: item.product_name.trim(),
          quantity: Number(item.quantity),
          unit_price: Number(item.unit_price),
          total_price: Number(item.quantity) * Number(item.unit_price),
          sort_order: idx + 1,
        }))

        const { data: insertedItems, error: itemsErr } = await supabase
          .from('quotation_items')
          .insert(itemPayloads)
          .select('id, sort_order')

        if (itemsErr) throw itemsErr

        // تحديث الميتاداتا بمعرفات البنود الحقيقية
        if (insertedItems && insertedItems.length > 0) {
          const itemGiftMap: Record<string, boolean> = {}
          insertedItems.forEach((ins, idx) => {
            if (preparedItems[idx]?.is_gift) {
              itemGiftMap[ins.id] = true
            }
          })
          const updatedMeta = { ...meta, gifts: itemGiftMap }
          const refinedNotes = `${notes.trim()}\n\n[[META:${JSON.stringify(updatedMeta)}]]`.trim()
          await supabase.from('quotations').update({ notes: refinedNotes }).eq('id', quoteId)
        }
      } else {
        // 3. إدراج سجل عرض السعر الجديد
        const { data: quote, error: quoteErr } = await supabase
          .from('quotations')
          .insert({
            store_id: store.id,
            quotation_number: finalQuoteNumber,
            customer_id: customerId || null,
            issue_date: issueDate,
            valid_until: validUntil,
            subtotal: calculations.subtotal,
            discount: calculations.totalDiscount,
            total_amount: calculations.netTotal,
            currency: store.currency_code || 'ILS',
            notes: finalNotes || null,
            terms: terms.trim() || null,
            status: 'draft',
          })
          .select('id, quotation_number')
          .single()

        if (quoteErr) throw quoteErr
        quoteId = quote.id

        // 4. إدراج بنود عرض السعر
        const itemPayloads = preparedItems.map((item, idx) => ({
          quotation_id: quote.id,
          product_id: item.product_id || null,
          product_name: item.product_name.trim(),
          quantity: Number(item.quantity),
          unit_price: Number(item.unit_price),
          total_price: Number(item.quantity) * Number(item.unit_price),
          sort_order: idx + 1,
        }))

        const { data: insertedItems, error: itemsErr } = await supabase
          .from('quotation_items')
          .insert(itemPayloads)
          .select('id, sort_order')

        if (itemsErr) throw itemsErr

        // تحديث الميتاداتا بمعرفات البنود الحقيقية
        if (insertedItems && insertedItems.length > 0) {
          const itemGiftMap: Record<string, boolean> = {}
          insertedItems.forEach((ins, idx) => {
            if (preparedItems[idx]?.is_gift) {
              itemGiftMap[ins.id] = true
            }
          })
          const updatedMeta = { ...meta, gifts: itemGiftMap }
          const refinedNotes = `${notes.trim()}\n\n[[META:${JSON.stringify(updatedMeta)}]]`.trim()
          await supabase.from('quotations').update({ notes: refinedNotes }).eq('id', quote.id)
        }

        if (submitMode.current === 'sent') {
          const { data: issued, error: issueError } = await supabase
            .from('quotations')
            .update({ status: 'sent' })
            .eq('id', quote.id)
            .eq('store_id', store.id)
            .select('id')
            .single()
          if (issueError || !issued) throw issueError || new Error('تعذر إصدار العرض؛ بقي محفوظاً كمسودة')
        }
      }

      setSavedId(quoteId)

      // تكوين الرابط العام
      const country = store.country_code ? store.country_code.toLowerCase() : 'ps'
      const sub = store.subdomain || 'store'
      const origin = typeof window !== 'undefined' ? window.location.origin : ''
      const shareUrl = `${origin}/store/${country}/${sub}/quotation/${quoteId}`

      setCreatedQuote({
        id: quoteId,
        number: finalQuoteNumber,
        shareUrl,
      })
    } catch (err: any) {
      setError(err.message || 'فشل حفظ عرض السعر')
    } finally {
      submitting.current = false
      setLoading(false)
    }
  }

  const fmt = (n: number) =>
    Number(n || 0).toLocaleString('ar-u-nu-latn', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  // نسخ الرابط أو إرساله عبر واتساب
  const shareWhatsApp = () => {
    if (!createdQuote) return
    const message = formatQuoteShareMessage({
      storeName: store.name,
      quotationNumber: createdQuote.number,
      customerName: selectedCustomer?.name,
      netTotal: calculations.netTotal,
      currency: store.currency_code,
      publicUrl: createdQuote.shareUrl,
      giftDiscount: calculations.giftDiscount,
      specialDiscount: calculations.specialDiscount,
    })
    const phone = selectedCustomer?.phone ? selectedCustomer.phone.replace(/[^0-9]/g, '') : ''
    const waUrl = phone
      ? `https://api.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(message)}`
      : `https://api.whatsapp.com/send?text=${encodeURIComponent(message)}`
    window.open(waUrl, '_blank')
  }

  return (
    <div className={`${styles.page} space-y-6`} dir="rtl">
      <div>
        <BackToDashboardButton href="/dashboard/sales" label="العودة إلى لوحة إدارة المبيعات" />
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-black text-white flex items-center gap-2">
            <span>{isEditMode ? '✏️' : '✍️'}</span> {isEditMode ? `تعديل عرض السعر (${quoteNumber})` : 'إنشاء عرض سعر جديد'}
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            {isEditMode
              ? 'تعديل بنود وخصومات وهدايا عرض السعر وحفظ التحديثات مباشرة'
              : 'تجهيز عروض أسعار تفصيلية لعملائك مع إمكانية إضافة هدايا وخصومات وروابط مشاركة تفاعلية'}
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

      {/* نافذة نجاح الحفظ وروابط المشاركة المباشرة */}
      {createdQuote && (
        <div className="rounded-2xl border-2 border-emerald-500/40 bg-emerald-950/40 p-6 space-y-4 text-white shadow-2xl">
          <div className="flex items-center gap-3">
            <span className="text-3xl">🎉</span>
            <div>
              <h2 className="text-lg font-black text-emerald-300">
                {isEditMode ? `تم حفظ التعديلات على عرض السعر بنجاح (#${createdQuote.number})` : `تم حفظ عرض السعر بنجاح (#${createdQuote.number})`}
              </h2>
              <p className="text-xs text-slate-300 mt-0.5">
                يمكنك الآن مشاركة الرابط العام التفاعلي مع الزبون عبر الواتساب، أو تحويل العرض إلى فاتورة مبيعات، أو طباعته.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 bg-slate-900/90 p-3 rounded-xl border border-white/10">
            <input
              type="text"
              readOnly
              value={createdQuote.shareUrl}
              className="flex-1 bg-transparent text-xs text-sky-300 font-mono outline-none"
              dir="ltr"
            />
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(createdQuote.shareUrl)
                alert('تم نسخ الرابط العام لعرض السعر!')
              }}
              className="px-3 py-1.5 rounded-lg bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 border border-sky-500/30 font-bold text-xs"
            >
              📋 نسخ الرابط
            </button>
            <WhatsAppContactMenu
              phone={selectedCustomer?.phone}
              customerName={selectedCustomer?.name}
              customerId={selectedCustomer?.id}
              defaultPrefix={selectedCustomer?.whatsapp_prefix as any}
              message={`مرحباً ${selectedCustomer?.name || 'عزيزنا العميل'}،\nيسرنا تزويدكم بعرض السعر رقم #${createdQuote.number} بقيمة ${calculations.netTotal.toLocaleString('ar-u-nu-latn')} ${store.currency_code}.\nرابط المعاينة:\n${createdQuote.shareUrl}`}
              label="إرسال للزبون عبر واتساب"
              variant="button"
            />
          </div>

          <div className="flex flex-wrap gap-3 pt-2">
            <Link
              href={`/dashboard/accounting/invoices/new?from_quotation=${createdQuote.id}`}
              className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs flex items-center gap-1.5"
            >
              🧾 تحويل إلى فاتورة مبيعات الآن
            </Link>
            <Link
              href={`/dashboard/quotations/print/${createdQuote.id}`}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-white/10 font-bold text-xs"
            >
              🖨️ طباعة النموذج الرسمي
            </Link>
            <Link
              href="/dashboard/quotations"
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 font-bold text-xs"
            >
              العودة لقائمة العروض
            </Link>
          </div>
        </div>
      )}

      <form id="quote-form" onSubmit={handleSubmit} className={styles.formGrid}>
        <div className={styles.formMain}>
          <div className="space-y-6 rounded-2xl border border-white/10 bg-slate-900 p-6 shadow-xl">
            {/* بيانات العرض الأساسية */}
            <div id="quote-info" className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label htmlFor="quote-number" className="mb-1 block text-xs font-semibold text-slate-300">
                  رقم عرض السعر *
                </label>
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

            {/* اختيار العميل بالبحث الذكي اللحظي */}
            <div className="relative">
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-semibold text-slate-300">العميل المستهدف (اختياري)</label>
                <button
                  type="button"
                  onClick={() => {
                    setNewCustName(customerSearch.trim())
                    setNewCustPhone('')
                    setNewCustAddress('')
                    setNewCustNotes('')
                    setCustModalError('')
                    setDuplicateWarning(null)
                    setShowAddCustomerModal(true)
                  }}
                  className="inline-flex items-center gap-1 text-xs font-bold text-sky-400 hover:text-sky-300 bg-sky-500/10 hover:bg-sky-500/20 border border-sky-500/20 px-2.5 py-1 rounded-lg transition cursor-pointer"
                >
                  <span>👤＋</span> إضافة زبون جديد
                </button>
              </div>

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
                          [الرصيد: {fmt(selectedCustomer.balance)} {store.currency_code}]
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setCustomerId('')
                      setCustomerSearch('')
                      setShowCustomerDropdown(true)
                    }}
                    className="text-xs text-rose-400 hover:text-rose-300 underline font-bold"
                  >
                    تغيير العميل
                  </button>
                </div>
              ) : (
                <div className="relative">
                  <input
                    type="text"
                    value={customerSearch}
                    onChange={e => {
                      const val = e.target.value
                      setCustomerSearch(val)
                      setShowCustomerDropdown(true)
                      searchServerCustomers(val)
                    }}
                    onFocus={() => setShowCustomerDropdown(true)}
                    placeholder="🔍 ابحث بالاسم أو رقم الهاتف لاختيار العميل (بحث ذكي فوري)..."
                    className="w-full rounded-xl border border-white/10 bg-slate-800 p-3 text-xs text-white outline-none focus:border-sky-500 placeholder-slate-500"
                  />
                  {showCustomerDropdown && (
                    <div className="absolute z-30 mt-1 max-h-60 w-full overflow-y-auto rounded-xl border border-white/10 bg-slate-800 shadow-2xl divide-y divide-white/5">
                      {/* خيار إضافة زبون جديد فوراً بالاسم المكتوب */}
                      {customerSearch.trim() && (
                        <button
                          type="button"
                          onMouseDown={e => {
                            e.preventDefault()
                            setNewCustName(customerSearch.trim())
                            setNewCustPhone('')
                            setNewCustAddress('')
                            setNewCustNotes('')
                            setCustModalError('')
                            setDuplicateWarning(null)
                            setShowAddCustomerModal(true)
                            setShowCustomerDropdown(false)
                          }}
                          className="w-full flex items-center justify-between p-2.5 text-right text-xs bg-sky-500/15 hover:bg-sky-500/25 text-sky-300 font-bold border-b border-sky-500/20 transition group"
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-sm">👤＋</span>
                            <span>إضافة زبون جديد باسم: <b className="text-white underline group-hover:text-sky-200">«{customerSearch.trim()}»</b></span>
                          </div>
                          <span className="text-[10px] bg-sky-500/20 text-sky-200 px-2 py-0.5 rounded border border-sky-500/30 font-mono">
                            إضافة +
                          </span>
                        </button>
                      )}

                      {customerSearch.trim() && (
                        <div className="px-3 py-1.5 text-[11px] font-semibold text-slate-400 bg-slate-900/60 flex items-center justify-between">
                          <span>العملاء المطابقون ({filteredCustomers.length})</span>
                          {isSearchingCustomers && (
                            <span className="text-sky-400 text-[10px] animate-pulse">جاري البحث في قاعدة العملاء...</span>
                          )}
                        </div>
                      )}
                      <button
                        type="button"
                        onMouseDown={e => {
                          e.preventDefault()
                          setCustomerId('')
                          setShowCustomerDropdown(false)
                        }}
                        className="w-full text-right p-2.5 text-xs text-slate-300 hover:bg-white/5 font-bold"
                      >
                        عميل عام (بدون تحديد عميل بالدليل)
                      </button>
                      {filteredCustomers.length > 0 ? (
                        filteredCustomers.map(c => (
                          <button
                            key={c.id}
                            type="button"
                            onMouseDown={e => {
                              e.preventDefault()
                              setCustomerId(c.id)
                              setShowCustomerDropdown(false)
                              setCustomerSearch('')
                            }}
                            className="w-full flex items-center justify-between p-2.5 text-right text-xs text-white hover:bg-sky-500/10 transition"
                          >
                            <div>
                              <p className="font-bold">{c.name}</p>
                              {c.phone && (
                                <p className="text-[10px] text-slate-400 font-mono" dir="ltr">
                                  {c.phone}
                                </p>
                              )}
                            </div>
                            {c.balance !== undefined && (
                              <span className="font-mono text-amber-400 text-xs">
                                {fmt(c.balance)} {store.currency_code}
                              </span>
                            )}
                          </button>
                        ))
                      ) : (
                        <div className="p-4 text-center text-xs text-slate-400 space-y-2.5">
                          <p>{isSearchingCustomers ? 'جاري البحث في قاعدة بيانات العملاء...' : 'لا يوجد عميل مطابق للبحث'}</p>
                          <button
                            type="button"
                            onMouseDown={e => {
                              e.preventDefault()
                              setNewCustName(customerSearch.trim())
                              setNewCustPhone('')
                              setNewCustAddress('')
                              setNewCustNotes('')
                              setCustModalError('')
                              setDuplicateWarning(null)
                              setShowAddCustomerModal(true)
                              setShowCustomerDropdown(false)
                            }}
                            className="inline-flex items-center gap-1.5 text-xs text-sky-300 hover:text-white bg-sky-600 hover:bg-sky-500 px-3.5 py-1.5 rounded-xl font-bold transition shadow cursor-pointer"
                          >
                            <span>👤＋</span> إضافة «{customerSearch.trim() || 'زبون جديد'}» الآن
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ── قسم البحث عن الأصناف وإضافتها بالبحث الذكي ── */}
            <div id="quote-items" className="space-y-4 border-t border-white/10 pt-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <label className="text-xs font-bold text-white block">الأصناف والخدمات في عرض السعر</label>
                  <span className="text-[11px] text-slate-400">
                    ابحث عن الصنف وأضفه بنقرة واحدة، مع إمكانية إضافة خدمات أو بنود حرة
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1.5 text-xs text-slate-300 bg-slate-800/80 px-2.5 py-1.5 rounded-xl border border-white/5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={showInternalProfit}
                      onChange={e => setShowInternalProfit(e.target.checked)}
                      className="rounded bg-slate-900 border-white/20 text-sky-500"
                    />
                    <span>إظهار التكلفة والربح المتوقع</span>
                  </label>
                  <button
                    type="button"
                    onClick={addCustomItem}
                    className="text-xs font-bold text-emerald-400 hover:text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5 rounded-xl transition"
                  >
                    ✨ بند / خدمة حرة
                  </button>
                </div>
              </div>

              {/* شريط البحث الذكي عن الأصناف */}
              <div className="relative">
                <input
                  type="text"
                  value={productSearch}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      if (productSearch.trim()) {
                        addNamedCustomItem(productSearch.trim())
                      }
                    }
                  }}
                  onChange={e => {
                    const val = e.target.value
                    setProductSearch(val)
                    setShowProductDropdown(true)
                    searchServerProducts(val)
                  }}
                  onFocus={() => setShowProductDropdown(true)}
                  placeholder="🔍 ابحث عن صنف بالاسم أو الموديل، أو اكتب اسم أي صنف جديد واضغط Enter لإضافته..."
                  className="w-full rounded-xl border border-sky-500/30 bg-slate-800/90 p-3 text-xs text-white outline-none focus:border-sky-500 placeholder-slate-400"
                />
                {showProductDropdown && (
                  <div className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-xl border border-white/10 bg-slate-800 shadow-2xl divide-y divide-white/5">
                    {/* خيار إضافة صنف مخصص مباشرة بما كتبه المستخدم */}
                    {productSearch.trim() && (
                      <button
                        type="button"
                        onMouseDown={e => {
                          e.preventDefault()
                          addNamedCustomItem(productSearch.trim())
                        }}
                        className="w-full flex items-center justify-between p-2.5 text-right text-xs bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 font-bold border-b border-emerald-500/20 transition group"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-sm">✨</span>
                          <span>إضافة صنف مخصص غير مسجل باسم: <b className="text-white underline group-hover:text-emerald-200">«{productSearch.trim()}»</b></span>
                        </div>
                        <span className="text-[10px] bg-emerald-500/20 text-emerald-200 px-2 py-0.5 rounded border border-emerald-500/30 font-mono">
                          Enter ↵
                        </span>
                      </button>
                    )}

                    {productSearch.trim() && (
                      <div className="px-3 py-1.5 text-[11px] font-semibold text-slate-400 bg-slate-900/60 flex items-center justify-between">
                        <span>نتائج البحث ({filteredProducts.length} صنف)</span>
                        {isSearchingProducts && (
                          <span className="text-sky-400 text-[10px] animate-pulse">جاري البحث في كامل المخزون...</span>
                        )}
                      </div>
                    )}
                    {filteredProducts.length > 0 ? (
                      filteredProducts.map(p => (
                        <button
                          key={p.id}
                          type="button"
                          onMouseDown={e => {
                            e.preventDefault()
                            addProductItem(p)
                          }}
                          className="w-full flex items-center justify-between p-2.5 text-right text-xs text-white hover:bg-sky-500/10 transition"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            {p.thumbnail_url ? (
                              <img
                                src={p.thumbnail_url}
                                alt={p.name}
                                className="w-9 h-9 rounded-lg object-cover border border-white/10 shrink-0 bg-slate-900"
                              />
                            ) : (
                              <div className="w-9 h-9 rounded-lg bg-slate-700/60 border border-white/5 flex items-center justify-center shrink-0 text-sm">
                                📦
                              </div>
                            )}
                            <div className="min-w-0">
                              <p className="font-bold truncate">{p.name}</p>
                              <div className="flex items-center gap-2 mt-0.5 text-[10px] text-slate-400">
                                <span>
                                  السعر: <b className="text-sky-300">{fmt(p.price)} {store.currency_code}</b>
                                </span>
                                {p.cost_price !== undefined && showInternalProfit && (
                                  <span>التكلفة: {fmt(p.cost_price)}</span>
                                )}
                                {p.sku && <span className="font-mono text-slate-500">[{p.sku}]</span>}
                              </div>
                            </div>
                          </div>
                          <span
                            className={`rounded-lg px-2 py-0.5 font-mono text-[11px] font-bold shrink-0 mr-2 ${
                              (p.stock_quantity ?? 0) > 0
                                ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/20'
                                : 'bg-amber-500/10 text-amber-300 border border-amber-500/20'
                            }`}
                          >
                            المتوفر: {p.stock_quantity ?? 0}
                          </span>
                        </button>
                      ))
                    ) : (
                      <div className="p-4 text-center text-xs text-slate-400">
                        {isSearchingProducts ? '⏳ جاري البحث في كامل أصناف المخزون...' : 'لا يوجد صنف مطابق بالدليل'}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* قائمة البنود المضافة */}
              <div className="space-y-2.5">
                {items.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-white/10 bg-slate-900/40 p-8 text-center text-slate-400 text-xs">
                    لم تقم بإضافة أي أصناف بعد. ابحث عن صنف من الدليل أعلاه أو اضغط «+ إضافة صنف مخصص جديد» للبدء.
                  </div>
                ) : (
                  items.map((item, idx) => (
                    <div
                      key={item.id_temp}
                      draggable
                      onDragStart={() => handleDragStart(idx)}
                      onDragOver={handleDragOver}
                      onDrop={() => handleDrop(idx)}
                      className={`rounded-xl p-3 border transition ${
                        draggedIdx === idx ? 'opacity-40 border-sky-400 border-dashed' : ''
                      } ${
                        item.is_gift
                          ? 'bg-amber-950/20 border-amber-500/30'
                          : 'bg-slate-800/60 border-white/5 hover:border-white/10'
                      } space-y-2`}
                    >
                      <div className="flex flex-wrap items-center gap-2.5">
                        {/* أسهم الترتيب ومقبض السحب ورقم البند */}
                        <div className="flex items-center gap-1.5 shrink-0">
                          <div className="flex flex-col gap-0.5">
                            <button
                              type="button"
                              disabled={idx === 0}
                              onClick={() => moveItem(idx, 'up')}
                              title="تحريك لأعلى"
                              className="w-5 h-4 flex items-center justify-center rounded text-[10px] text-slate-400 hover:text-white hover:bg-white/10 disabled:opacity-20 disabled:hover:bg-transparent transition cursor-pointer disabled:cursor-not-allowed"
                            >
                              ▲
                            </button>
                            <button
                              type="button"
                              disabled={idx === items.length - 1}
                              onClick={() => moveItem(idx, 'down')}
                              title="تحريك لأسفل"
                              className="w-5 h-4 flex items-center justify-center rounded text-[10px] text-slate-400 hover:text-white hover:bg-white/10 disabled:opacity-20 disabled:hover:bg-transparent transition cursor-pointer disabled:cursor-not-allowed"
                            >
                              ▼
                            </button>
                          </div>
                          <span className="text-slate-500 font-mono text-xs w-5 text-center font-bold" title="رقم البند">
                            {idx + 1}
                          </span>
                          <span className="text-slate-600 cursor-grab active:cursor-grabbing text-xs px-0.5 select-none" title="اسحب لإعادة الترتيب">
                            ⋮⋮
                          </span>
                        </div>

                        {/* صورة الصنف المصغرة */}
                        <div className="shrink-0">
                          {item.thumbnail_url ? (
                            <img
                              src={item.thumbnail_url}
                              alt={item.product_name}
                              className="w-9 h-9 rounded-lg object-cover border border-white/10 shrink-0 bg-slate-900"
                            />
                          ) : (
                            <div className="w-9 h-9 rounded-lg bg-slate-800 border border-white/5 flex items-center justify-center shrink-0 text-xs text-slate-400">
                              📦
                            </div>
                          )}
                        </div>

                        {/* بيان الصنف (قابل للتعديل والكتابة المباشرة دائماً كما في الفواتير) */}
                        <div className="flex-1 min-w-[200px]">
                          <div className="relative flex items-center">
                            <input
                              type="text"
                              required
                              value={item.product_name}
                              onChange={e => updateItemRow(idx, 'product_name', e.target.value)}
                              placeholder="اسم الصنف أو الخدمة *"
                              className={`w-full rounded-lg py-2 pr-2 pl-20 text-xs text-white outline-none font-semibold transition ${
                                item.is_custom
                                  ? 'border border-emerald-500/30 bg-slate-900/90 focus:border-emerald-500'
                                  : 'border border-white/10 bg-slate-900/80 focus:border-sky-500'
                              }`}
                            />
                            <div className="absolute left-2 flex items-center gap-1 pointer-events-none">
                              {item.is_custom ? (
                                <span className="text-[9px] bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 px-1.5 py-0.5 rounded font-bold">
                                  مخصص
                                </span>
                              ) : (
                                <span className="text-[9px] bg-sky-500/15 text-sky-300 border border-sky-500/30 px-1.5 py-0.5 rounded font-bold">
                                  دليل
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* الكمية */}
                        <div className="w-20">
                          <input
                            type="number"
                            min="0.001"
                            step="any"
                            aria-label={`كمية البند ${idx + 1}`}
                            placeholder="الكمية"
                            value={item.quantity}
                            onFocus={e => e.target.select()}
                            onClick={e => (e.target as HTMLInputElement).select()}
                            onChange={e => updateItemRow(idx, 'quantity', Number(e.target.value))}
                            className="w-full rounded-lg border border-white/10 bg-slate-900 p-2 text-xs text-white outline-none font-mono text-center font-bold"
                          />
                        </div>

                        {/* السعر */}
                        <div className="w-24">
                          <input
                            type="number"
                            step="any"
                            min="0"
                            aria-label={`سعر البند ${idx + 1}`}
                            placeholder="السعر"
                            value={item.unit_price}
                            onFocus={e => e.target.select()}
                            onClick={e => (e.target as HTMLInputElement).select()}
                            onChange={e => updateItemRow(idx, 'unit_price', Number(e.target.value))}
                            className="w-full rounded-lg border border-white/10 bg-slate-900 p-2 text-xs text-white outline-none font-mono text-center font-bold text-emerald-400"
                          />
                        </div>

                        {/* زر تعيين كهدية */}
                        <div>
                          <button
                            type="button"
                            onClick={() => toggleGift(idx)}
                            className={`rounded-lg px-2.5 py-1.5 text-xs font-bold transition border ${
                              item.is_gift
                                ? 'bg-amber-500 text-slate-950 border-amber-400'
                                : 'bg-slate-800 text-slate-300 border-white/10 hover:border-amber-400/50'
                            }`}
                          >
                            {item.is_gift ? '🎁 هدية مجانية' : 'هدية؟'}
                          </button>
                        </div>

                        {/* الإجمالي */}
                        <div className="w-24 text-left font-mono font-black text-white text-xs" dir="ltr">
                          {item.is_gift ? (
                            <div>
                              <span className="text-slate-500 line-through text-[10px] block">
                                {fmt(item.quantity * item.unit_price)}
                              </span>
                              <span className="text-amber-400 font-bold">0.00</span>
                            </div>
                          ) : (
                            <span>{fmt(item.quantity * item.unit_price)} {store.currency_code}</span>
                          )}
                        </div>

                        {/* زر الحذف */}
                        <button
                          type="button"
                          onClick={() => removeItemRow(idx)}
                          className="text-slate-500 hover:text-rose-400 font-bold px-1.5 text-sm"
                        >
                          ✕
                        </button>
                      </div>

                      {/* شريط معلومات التكلفة والربح للبند الداخلي */}
                      {showInternalProfit && (
                        <div className="flex items-center justify-between text-[11px] text-slate-400 bg-slate-900/60 p-2 rounded-lg">
                          <div className="flex items-center gap-2">
                            <span>التكلفة التقديرية:</span>
                            <input
                              type="number"
                              step="any"
                              min="0"
                              value={item.cost_price || ''}
                              placeholder="0"
                              onChange={e => updateItemRow(idx, 'cost_price', Number(e.target.value))}
                              className="w-20 bg-slate-800 border border-white/10 rounded px-1.5 py-0.5 text-white font-mono text-center"
                            />
                            <span>{store.currency_code}</span>
                          </div>
                          <div>
                            <span>الربح من البند: </span>
                            <span
                              className={`font-mono font-bold ${
                                (item.quantity * item.unit_price - item.quantity * (item.cost_price || 0)) >= 0
                                  ? 'text-emerald-400'
                                  : 'text-rose-400'
                              }`}
                              dir="ltr"
                            >
                              {fmt(
                                (item.is_gift ? 0 : item.quantity * item.unit_price) -
                                  item.quantity * (item.cost_price || 0)
                              )}{' '}
                              {store.currency_code}
                            </span>
                          </div>
                        </div>
                      )}

                      {/* خيار الحفظ في الدليل للمنتج المخصص */}
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
                  ))
                )}

                {/* زر إضافة صنف مخصص حر إضافي أسفل القائمة */}
                <button
                  type="button"
                  onClick={addCustomItem}
                  className="w-full rounded-xl border border-dashed border-emerald-500/30 bg-emerald-500/5 hover:bg-emerald-500/10 py-3 text-xs font-bold text-emerald-300 hover:text-emerald-200 transition flex items-center justify-center gap-2 shadow-sm"
                >
                  <span>✨</span>
                  <span>+ إضافة صنف مخصص جديد (بند حر / خدمة)</span>
                </button>
              </div>
            </div>

            {/* قسم الخصومات الخاصة والهدايا */}
            <div className="rounded-xl border border-white/10 bg-slate-950 p-4 space-y-3 text-xs">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <span className="font-bold text-slate-200">الخصم الخاص الممنوح:</span>
                <div className="flex items-center gap-2">
                  <div className="flex rounded-lg bg-slate-800 p-0.5 text-[11px]">
                    <button
                      type="button"
                      onClick={() => setSpecialDiscountType('amount')}
                      className={`rounded px-2.5 py-1 font-bold transition ${
                        specialDiscountType === 'amount'
                          ? 'bg-sky-500 text-slate-950'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      مبلغ ثابت ({store.currency_code})
                    </button>
                    <button
                      type="button"
                      onClick={() => setSpecialDiscountType('percent')}
                      className={`rounded px-2.5 py-1 font-bold transition ${
                        specialDiscountType === 'percent'
                          ? 'bg-sky-500 text-slate-950'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      نسبة مئوية (%)
                    </button>
                  </div>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={specialDiscountValue || ''}
                    placeholder="0"
                    onChange={e => setSpecialDiscountValue(Math.max(0, parseFloat(e.target.value) || 0))}
                    className="w-28 rounded-lg border border-white/10 bg-slate-800 p-2 text-white font-mono text-center font-bold outline-none focus:border-sky-500"
                  />
                </div>
              </div>

              {calculations.giftDiscount > 0 && (
                <div className="flex justify-between items-center text-amber-300 bg-amber-500/10 p-2.5 rounded-lg border border-amber-500/20">
                  <span>🎁 خصم الهدايا المجانية المحدد تلقائياً ({calculations.giftCount} أصناف):</span>
                  <span className="font-mono font-bold" dir="ltr">
                    - {fmt(calculations.giftDiscount)} {store.currency_code}
                  </span>
                </div>
              )}

              {calculations.specialDiscount > 0 && (
                <div className="flex justify-between items-center text-rose-300 bg-rose-500/10 p-2.5 rounded-lg border border-rose-500/20">
                  <span>✨ الخصم الخاص الممنوح:</span>
                  <span className="font-mono font-bold" dir="ltr">
                    - {fmt(calculations.specialDiscount)} {store.currency_code}
                  </span>
                </div>
              )}

              <div className="flex justify-between items-center border-t border-white/10 pt-3 text-sm font-black">
                <span className="text-white">صافي إجمالي عرض السعر المطلوب من الزبون:</span>
                <span className="font-mono text-2xl text-sky-400" dir="ltr">
                  {fmt(calculations.netTotal)} {store.currency_code}
                </span>
              </div>
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

          {showReview && (
            <section className={styles.review}>
              <h2>مراجعة العرض</h2>
              <p>
                {selectedCustomer?.name || 'عميل عام'} · {quoteNumber} · {issueDate} — {validUntil}
              </p>
              <ul>
                {items.map((item, i) => (
                  <li key={i}>
                    {item.product_name || 'بند غير محدد'} — {item.quantity} × {fmt(item.unit_price)} ={' '}
                    {fmt(item.quantity * item.unit_price)} {store.currency_code}{' '}
                    {item.is_gift ? '(هدية)' : ''}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        {/* الشريط الجانبي للملخص والأرباح والحفظ */}
        <aside className={styles.summary}>
          <h2>ملخص عرض السعر</h2>
          <p>الإجمالي الصافي المطلوب</p>
          <strong dir="ltr">
            {store.currency_code} {fmt(calculations.netTotal)}
          </strong>

          {/* كشف التكلفة والربح الداخلي في الشريط الجانبي */}
          {showInternalProfit && calculations.totalCost > 0 && (
            <div className="rounded-xl border border-sky-500/20 bg-sky-500/5 p-3 space-y-1.5 text-xs my-3 text-right">
              <div className="flex items-center justify-between text-slate-300">
                <span>التكلفة التقديرية للبضاعة:</span>
                <span className="font-mono font-bold text-slate-200" dir="ltr">
                  {fmt(calculations.totalCost)} {store.currency_code}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>صافي الربح المتوقع:</span>
                <span
                  className={`font-mono font-bold text-sm ${
                    calculations.totalProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                  dir="ltr"
                >
                  {fmt(calculations.totalProfit)} {store.currency_code}
                  <span className="text-[10px] font-normal mr-1 text-slate-400">
                    ({calculations.profitPercent}%)
                  </span>
                </span>
              </div>
            </div>
          )}

          <p>
            عدد البنود: {items.length}
            <br />
            العميل: {selectedCustomer?.name || 'عميل عام'}
            <br />
            ساري حتى: {validUntil}
          </p>

          <button
            type="submit"
            disabled={loading || !!savedId}
            onClick={() => {
              submitMode.current = 'sent'
            }}
          >
            {loading ? 'جارٍ الحفظ…' : isEditMode ? '💾 حفظ التعديلات على عرض السعر' : '✓ حفظ وإصدار عرض السعر'}
          </button>
          <button
            type="submit"
            disabled={loading || !!savedId}
            onClick={() => {
              submitMode.current = 'draft'
            }}
          >
            {isEditMode ? 'حفظ كمسودة معدلة' : 'حفظ كمسودة'}
          </button>
          <button type="button" onClick={() => setShowReview(v => !v)}>
            {showReview ? 'إخفاء المعاينة' : 'معاينة العرض'}
          </button>

          {savedId && (
            <p role="status">
              تم إنشاء سجل العرض #{quoteNumber}. يمكنك الآن مشاركته أو تحويله لفاتورة.
            </p>
          )}
        </aside>
      </form>

      {/* ── نافذة إضافة زبون جديد مع فحص تكرار رقم الهاتف ── */}
      {showAddCustomerModal && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 sm:p-4 backdrop-blur-sm"
          onClick={() => {
            if (!custSaving) setShowAddCustomerModal(false)
          }}
        >
          <div
            className="relative w-full max-w-lg rounded-2xl border border-white/10 bg-slate-900 p-5 sm:p-6 shadow-2xl space-y-4 text-white"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center gap-2">
                <span className="text-xl">👤＋</span>
                <h3 className="font-bold text-base text-white">إضافة عميل / زبون جديد</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowAddCustomerModal(false)}
                className="text-slate-400 hover:text-white text-lg w-7 h-7 flex items-center justify-center rounded-lg hover:bg-white/10 transition cursor-pointer"
              >
                ✕
              </button>
            </div>

            {custModalError && (
              <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300 font-bold">
                {custModalError}
              </div>
            )}

            {/* تحذير وتنبيه فوري عند تكرار رقم الهاتف */}
            {duplicateWarning && (
              <div className="rounded-xl border border-amber-500/40 bg-amber-950/40 p-3.5 space-y-2.5 text-xs">
                <div className="flex items-start gap-2.5 text-amber-300 font-bold">
                  <span className="text-xl shrink-0">⚠️</span>
                  <div className="space-y-1">
                    <p className="leading-relaxed">
                      رقم الهاتف (<span dir="ltr" className="font-mono text-white font-black">{duplicateWarning.phone}</span>) مسجل مسبقاً في النظام لزبون آخر:
                    </p>
                    <p className="text-white text-sm font-black flex items-center gap-2">
                      <span>«{duplicateWarning.customer.name}»</span>
                      {duplicateWarning.customer.balance !== undefined && (
                        <span className="text-amber-400 font-mono text-xs font-normal">
                          [الرصيد: {fmt(duplicateWarning.customer.balance)} {store.currency_code}]
                        </span>
                      )}
                    </p>
                  </div>
                </div>
                <div className="pt-2 border-t border-amber-500/20">
                  <button
                    type="button"
                    onClick={() => {
                      setCustomerId(duplicateWarning.customer.id)
                      setShowAddCustomerModal(false)
                      setNewCustName('')
                      setNewCustPhone('')
                      setDuplicateWarning(null)
                      setCustomerSearch('')
                      setShowCustomerDropdown(false)
                    }}
                    className="w-full rounded-xl bg-amber-500 hover:bg-amber-400 active:bg-amber-600 text-slate-950 font-black py-2.5 px-3 text-xs transition flex items-center justify-center gap-2 shadow-md cursor-pointer"
                  >
                    <span>✓</span>
                    <span>اختيار هذا الزبون الموجود مباشرة ({duplicateWarning.customer.name})</span>
                  </button>
                </div>
              </div>
            )}

            <form onSubmit={handleCreateCustomer} className="space-y-3.5 text-xs">
              <div>
                <label className="block mb-1 text-slate-300 font-semibold">
                  اسم العميل / المؤسسة <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  value={newCustName}
                  onChange={e => {
                    setNewCustName(e.target.value)
                    setCustModalError('')
                  }}
                  placeholder="مثال: شركة النور أو أحمد محمد..."
                  className="w-full rounded-xl border border-white/10 bg-slate-800 p-2.5 text-xs text-white outline-none focus:border-sky-500 placeholder-slate-500"
                />
              </div>

              <div>
                <label className="block mb-1 text-slate-300 font-semibold">
                  رقم الموبايل / الجوال (يفضل لإرسال العرض عبر واتساب)
                </label>
                <input
                  type="tel"
                  dir="ltr"
                  value={newCustPhone}
                  onChange={e => handleNewCustPhoneChange(e.target.value)}
                  onBlur={() => {
                    if (newCustPhone.trim()) {
                      handleNewCustPhoneChange(newCustPhone.trim())
                    }
                  }}
                  placeholder="مثال: 0599123456 أو 0569123456"
                  className={`w-full rounded-xl border p-2.5 text-xs text-white outline-none font-mono transition placeholder-slate-500 ${
                    duplicateWarning
                      ? 'border-amber-500 bg-amber-950/20 focus:border-amber-400'
                      : 'border-white/10 bg-slate-800 focus:border-sky-500'
                  }`}
                />
                {duplicateWarning ? (
                  <p className="mt-1 text-[11px] text-amber-400 font-bold">
                    ⚠️ هذا الرقم ينتمي للعميل «{duplicateWarning.customer.name}». يمكنك اختياره أعلاه أو تصحيح الرقم.
                  </p>
                ) : (
                  <p className="mt-1 text-[10px] text-slate-400">
                    يقوم النظام تلقائياً بالتحقق من عدم تكرار رقم الموبايل مع أي زبون آخر مسجل.
                  </p>
                )}
              </div>

              <div>
                <label className="block mb-1 text-slate-300 font-semibold">العنوان / المدينة (اختياري)</label>
                <input
                  type="text"
                  value={newCustAddress}
                  onChange={e => setNewCustAddress(e.target.value)}
                  placeholder="مثال: نابلس - رفيديا أو رام الله..."
                  className="w-full rounded-xl border border-white/10 bg-slate-800 p-2.5 text-xs text-white outline-none focus:border-sky-500 placeholder-slate-500"
                />
              </div>

              <div>
                <label className="block mb-1 text-slate-300 font-semibold">ملاحظات عن العميل (اختياري)</label>
                <textarea
                  rows={2}
                  value={newCustNotes}
                  onChange={e => setNewCustNotes(e.target.value)}
                  placeholder="أي تفاصيل إضافية..."
                  className="w-full resize-none rounded-xl border border-white/10 bg-slate-800 p-2.5 text-xs text-white outline-none focus:border-sky-500 placeholder-slate-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-white/10">
                <button
                  type="button"
                  disabled={custSaving}
                  onClick={() => setShowAddCustomerModal(false)}
                  className="rounded-xl border border-white/10 bg-slate-800 px-4 py-2 text-xs font-bold text-slate-300 hover:bg-slate-700 transition cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={custSaving}
                  className="rounded-xl bg-sky-500 hover:bg-sky-400 active:bg-sky-600 px-5 py-2 text-xs font-bold text-slate-950 transition flex items-center gap-1.5 shadow cursor-pointer disabled:opacity-50"
                >
                  {custSaving ? 'جارٍ الإضافة…' : '✓ حفظ وتحديد الزبون'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
