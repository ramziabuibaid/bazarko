import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import { generateSlug } from '@/lib/utils/slug'
import * as XLSX from 'xlsx'

// الحد الأقصى لحجم الملف: 5 ميغابايت
const MAX_FILE_SIZE = 5 * 1024 * 1024

// الحقول الإلزامية لكل صف
const REQUIRED_FIELDS = ['اسم المنتج *']

// قيم صحيحة للحالة
const VALID_STATUSES = ['active', 'draft', 'hidden', 'archived']

interface ParsedRow {
  rowIndex: number
  productId: string | null
  name: string
  description: string
  categoryName: string
  price: number
  comparePrice: number | null
  costPrice: number | null
  sku: string
  barcode: string
  stockQuantity: number
  trackStock: boolean
  lowStockAlert: number | null
  status: string
  isFeatured: boolean
  weight: number | null
}

interface RowError {
  row: number
  field: string
  message: string
}

function parseBool(val: unknown): boolean {
  if (val === true || val === 'نعم' || val === 'yes' || val === 'true' || val === 1) return true
  return false
}

function parseNumber(val: unknown): number | null {
  if (val === null || val === undefined || val === '') return null
  const n = Number(val)
  return isNaN(n) ? null : n
}

function parsePositiveNumber(val: unknown): number | null {
  const n = parseNumber(val)
  if (n === null) return null
  return n >= 0 ? n : null
}

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })

  const storeId = await getStoreForUser(supabase, user.id)
  if (!storeId) return NextResponse.json({ error: 'المتجر غير موجود' }, { status: 404 })

  // --- قراءة الملف ---
  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: 'تعذّر قراءة الملف المرفق' }, { status: 400 })
  }

  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'لم يتم إرفاق أي ملف' }, { status: 400 })

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: 'حجم الملف أكبر من 5 ميغابايت' }, { status: 400 })
  }

  // --- تحليل Excel ---
  let rows: Record<string, unknown>[]
  try {
    const buffer = await file.arrayBuffer()
    const wb = XLSX.read(buffer, { type: 'array' })
    const sheetName = wb.SheetNames[0]
    if (!sheetName) throw new Error('الملف لا يحتوي على أي ورقة')
    const ws = wb.Sheets[sheetName]
    rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' })
  } catch {
    return NextResponse.json({
      error: 'تعذّر قراءة ملف Excel. تأكد أنه ملف xlsx صحيح وأن الأعمدة لم تُحذف'
    }, { status: 400 })
  }

  if (rows.length === 0) {
    return NextResponse.json({ error: 'الملف لا يحتوي على أي بيانات' }, { status: 400 })
  }

  if (rows.length > 2000) {
    return NextResponse.json({ error: 'الحد الأقصى 2000 صف في المرة الواحدة' }, { status: 400 })
  }

  // --- جلب بيانات المتجر للتحقق ---
  const [{ data: existingProducts }, { data: categories }] = await Promise.all([
    supabase
      .from('products')
      .select('id, slug')
      .eq('store_id', storeId),
    supabase
      .from('categories')
      .select('id, name')
      .eq('store_id', storeId)
      .eq('is_active', true),
  ])

  const existingIds = new Set((existingProducts ?? []).map(p => p.id))
  const existingSlugs = new Set((existingProducts ?? []).map(p => p.slug))
  const categoryMap = new Map(
    (categories ?? []).map(c => [c.name.trim().toLowerCase(), c.id])
  )

  // --- تحقق من عمود المعرّف (ابحث عنه بجزء من الاسم) ---
  const sampleRow = rows[0]
  const idColumnKey = Object.keys(sampleRow).find(k => k.includes('معرّف المنتج'))
  const nameColumnKey = Object.keys(sampleRow).find(k => k.includes('اسم المنتج'))
  const priceColumnKey = Object.keys(sampleRow).find(k => k.includes('سعر البيع'))

  if (!nameColumnKey || !priceColumnKey) {
    return NextResponse.json({
      error: 'لم يتم العثور على أعمدة إلزامية. تأكد أن الملف صادر من النظام ولم تُحذف أعمدة منه'
    }, { status: 400 })
  }

  // --- تحليل وتحقق من كل صف ---
  const validRows: ParsedRow[] = []
  const errors: RowError[] = []
  const idsSeen = new Set<string>()

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    const rowNum = i + 2 // +2 لأن الصف الأول رأس الجدول

    // الاسم
    const name = String(r[nameColumnKey] ?? '').trim()
    if (!name) {
      errors.push({ row: rowNum, field: 'اسم المنتج', message: 'الاسم فارغ — هذا الحقل إلزامي' })
      continue
    }
    if (name.length > 200) {
      errors.push({ row: rowNum, field: 'اسم المنتج', message: `الاسم طويل جداً (${name.length} حرف، الحد 200)` })
      continue
    }

    // السعر
    const priceRaw = r[priceColumnKey]
    const price = parsePositiveNumber(priceRaw)
    if (price === null || price <= 0) {
      errors.push({ row: rowNum, field: 'سعر البيع', message: `السعر "${priceRaw}" غير صالح — يجب أن يكون رقماً أكبر من 0` })
      continue
    }

    // المعرّف (اختياري — فارغ = منتج جديد)
    const rawId = idColumnKey ? String(r[idColumnKey] ?? '').trim() : ''
    const productId = rawId || null

    // إذا وُجد معرّف: تحقق أنه ينتمي لهذا المتجر
    if (productId) {
      if (!existingIds.has(productId)) {
        errors.push({ row: rowNum, field: 'معرّف المنتج', message: `المعرّف "${productId}" لا ينتمي لهذا المتجر` })
        continue
      }
      if (idsSeen.has(productId)) {
        errors.push({ row: rowNum, field: 'معرّف المنتج', message: `تكرار: المعرّف "${productId}" مذكور أكثر من مرة في الملف` })
        continue
      }
      idsSeen.add(productId)
    }

    // سعر المقارنة والتكلفة (اختياريان)
    const comparePriceKey = Object.keys(r).find(k => k.includes('سعر المقارنة'))
    const costPriceKey = Object.keys(r).find(k => k.includes('سعر التكلفة'))
    const comparePrice = comparePriceKey ? parsePositiveNumber(r[comparePriceKey]) : null
    const costPrice = costPriceKey ? parsePositiveNumber(r[costPriceKey]) : null

    // الكمية
    const qtyKey = Object.keys(r).find(k => k === 'الكمية')
    const qtyRaw = qtyKey ? r[qtyKey] : ''
    let stockQuantity = 0
    if (qtyRaw !== '' && qtyRaw !== undefined && qtyRaw !== null) {
      const qtyNum = parseNumber(qtyRaw)
      if (qtyNum === null || qtyNum < 0 || !Number.isInteger(qtyNum)) {
        errors.push({ row: rowNum, field: 'الكمية', message: `الكمية "${qtyRaw}" غير صالحة — يجب أن تكون رقماً صحيحاً (0 أو أكثر)` })
        continue
      }
      stockQuantity = qtyNum
    }

    // الحالة
    const statusKey = Object.keys(r).find(k => k === 'الحالة')
    const statusRaw = statusKey ? String(r[statusKey] ?? '').trim().toLowerCase() : 'active'
    const status = statusRaw || 'active'
    if (!VALID_STATUSES.includes(status)) {
      errors.push({ row: rowNum, field: 'الحالة', message: `الحالة "${status}" غير معروفة — القيم المقبولة: active, draft, hidden, archived` })
      continue
    }

    // الفئة (اختياري)
    const catKey = Object.keys(r).find(k => k === 'الفئة')
    const categoryName = catKey ? String(r[catKey] ?? '').trim() : ''

    // تتبع المخزون
    const trackKey = Object.keys(r).find(k => k.includes('تتبع المخزون'))
    const trackStock = trackKey ? parseBool(r[trackKey]) : true

    // تنبيه نفاد المخزون
    const alertKey = Object.keys(r).find(k => k.includes('تنبيه عند'))
    const lowStockAlert = alertKey ? parsePositiveNumber(r[alertKey]) : null

    // المنتج المميز
    const featKey = Object.keys(r).find(k => k.includes('منتج مميز'))
    const isFeatured = featKey ? parseBool(r[featKey]) : false

    // الوزن
    const weightKey = Object.keys(r).find(k => k.includes('الوزن'))
    const weight = weightKey ? parsePositiveNumber(r[weightKey]) : null

    // SKU والباركود
    const skuKey = Object.keys(r).find(k => k.includes('كود SKU'))
    const barcodeKey = Object.keys(r).find(k => k.includes('الباركود'))
    const sku = skuKey ? String(r[skuKey] ?? '').trim() : ''
    const barcode = barcodeKey ? String(r[barcodeKey] ?? '').trim() : ''

    const descKey = Object.keys(r).find(k => k === 'الوصف')
    const description = descKey ? String(r[descKey] ?? '').trim() : ''

    validRows.push({
      rowIndex: rowNum,
      productId,
      name,
      description,
      categoryName,
      price,
      comparePrice,
      costPrice,
      sku,
      barcode,
      stockQuantity,
      trackStock,
      lowStockAlert,
      status,
      isFeatured,
      weight,
    })
  }

  // إذا وُجدت أخطاء → لا نُطبّق أي شيء
  if (errors.length > 0) {
    return NextResponse.json({
      success: false,
      errors,
      message: `وُجد ${errors.length} خطأ في الملف. لم يُطبَّق أي تغيير. صحّح الأخطاء وأعد الرفع.`,
    }, { status: 422 })
  }

  // --- تطبيق التغييرات ---
  const toUpdate = validRows.filter(r => r.productId !== null)
  const toInsert = validRows.filter(r => r.productId === null)

  let updatedCount = 0
  let insertedCount = 0
  const applyErrors: string[] = []

  // تحديث المنتجات الموجودة
  for (const row of toUpdate) {
    const categoryId = row.categoryName
      ? (categoryMap.get(row.categoryName.toLowerCase()) ?? null)
      : null

    const { error } = await supabase
      .from('products')
      .update({
        name: row.name,
        description: row.description || null,
        category_id: row.categoryName ? categoryId : undefined,
        price: row.price,
        compare_price: row.comparePrice,
        cost_price: row.costPrice,
        sku: row.sku || null,
        barcode: row.barcode || null,
        stock_quantity: row.stockQuantity,
        track_stock: row.trackStock,
        low_stock_alert: row.lowStockAlert,
        status: row.status,
        is_featured: row.isFeatured,
        weight: row.weight,
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.productId!)
      .eq('store_id', storeId)

    if (error) {
      applyErrors.push(`الصف ${row.rowIndex}: فشل تحديث "${row.name}" — ${error.message}`)
    } else {
      updatedCount++
    }
  }

  // إضافة المنتجات الجديدة
  for (const row of toInsert) {
    const categoryId = row.categoryName
      ? (categoryMap.get(row.categoryName.toLowerCase()) ?? null)
      : null

    // توليد slug فريد
    let slug = generateSlug(row.name)
    if (existingSlugs.has(slug)) {
      slug = `${slug}-${Date.now().toString(36)}`
    }
    existingSlugs.add(slug)

    const { error } = await supabase
      .from('products')
      .insert({
        store_id: storeId,
        name: row.name,
        slug,
        description: row.description || null,
        category_id: categoryId,
        price: row.price,
        compare_price: row.comparePrice,
        cost_price: row.costPrice,
        sku: row.sku || null,
        barcode: row.barcode || null,
        stock_quantity: row.stockQuantity,
        track_stock: row.trackStock,
        low_stock_alert: row.lowStockAlert ?? 5,
        status: row.status,
        is_featured: row.isFeatured,
        weight: row.weight,
      })

    if (error) {
      applyErrors.push(`الصف ${row.rowIndex}: فشل إضافة "${row.name}" — ${error.message}`)
    } else {
      insertedCount++
    }
  }

  return NextResponse.json({
    success: true,
    updatedCount,
    insertedCount,
    applyErrors,
    message: applyErrors.length === 0
      ? `تم بنجاح: تحديث ${updatedCount} منتج، إضافة ${insertedCount} منتج جديد`
      : `تحديث ${updatedCount}، إضافة ${insertedCount}، فشل ${applyErrors.length} صف`,
  })
}
