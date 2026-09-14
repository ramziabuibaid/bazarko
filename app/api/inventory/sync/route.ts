import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { ingestExternalImage } from '@/lib/supabase/storage-server'
import { generateSlug } from '@/lib/utils/slug'

interface SyncProductItem {
  id?: string
  sku?: string
  barcode?: string
  name: string
  price: number
  cost_price?: number
  compare_price?: number
  stock_quantity: number
  category_name?: string
  category_id?: string
  image_url?: string
  image_urls?: string[]
  description?: string
  is_active?: boolean
}

interface SyncPayload {
  products: SyncProductItem[]
  source?: string
  autoIngestImages?: boolean
}

export async function POST(req: NextRequest) {
  const supabase = createClient()

  // 1. Authentication: Check Bearer token or User Session
  let storeId: string | null = null
  const authHeader = req.headers.get('authorization') || req.headers.get('x-api-key')

  if (authHeader) {
    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    const { data: store } = await supabase
      .from('stores')
      .select('id')
      .eq('api_sync_key', token)
      .single()

    if (store) {
      storeId = store.id
    }
  }

  if (!storeId) {
    // Check session
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      const { data: member } = await supabase
        .from('store_members')
        .select('store_id')
        .eq('user_id', user.id)
        .single()

      if (member) storeId = member.store_id
    }
  }

  if (!storeId) {
    return NextResponse.json({ error: 'غير مصرح به: يرجى التحقق من مفتاح الربط API Key أو تسجيل الدخول' }, { status: 401 })
  }

  let body: SyncPayload
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'تنسيق JSON غير صالح' }, { status: 400 })
  }

  const items = Array.isArray(body.products) ? body.products : (Array.isArray(body) ? body : [])
  if (!items.length) {
    return NextResponse.json({ error: 'لم يتم إرسال أي أصناف للمزامنة' }, { status: 400 })
  }

  const autoIngest = body.autoIngestImages !== false // default true
  let processed = 0
  let updated = 0
  let created = 0
  const errors: Array<{ name: string; sku?: string; error: string }> = []

  // Pre-load existing categories
  const { data: categories } = await supabase
    .from('categories')
    .select('id, name')
    .eq('store_id', storeId)

  const categoryMap = new Map((categories || []).map(c => [c.name.trim().toLowerCase(), c.id]))

  for (const item of items) {
    processed++
    try {
      if (!item.name || !item.name.trim()) {
        errors.push({ name: 'بدون اسم', sku: item.sku, error: 'اسم الصنف مطلوب' })
        continue
      }

      // Handle Category
      let resolvedCatId = item.category_id || null
      if (!resolvedCatId && item.category_name) {
        const key = item.category_name.trim().toLowerCase()
        if (categoryMap.has(key)) {
          resolvedCatId = categoryMap.get(key)!
        } else {
          // Auto create category
          const slug = generateSlug(item.category_name) || `cat-${Date.now()}`
          const { data: newCat } = await supabase
            .from('categories')
            .insert({ store_id: storeId, name: item.category_name.trim(), slug })
            .select('id')
            .single()

          if (newCat) {
            resolvedCatId = newCat.id
            categoryMap.set(key, newCat.id)
          }
        }
      }

      // Handle Permanent Image Ingestion (Save directly to Supabase storage)
      const rawImages: string[] = []
      if (item.image_url) rawImages.push(item.image_url)
      if (item.image_urls && Array.isArray(item.image_urls)) rawImages.push(...item.image_urls)

      const finalImages: string[] = []
      for (const img of rawImages) {
        if (!img || typeof img !== 'string') continue
        if (autoIngest && img.startsWith('http')) {
          const storedUrl = await ingestExternalImage(storeId, img)
          finalImages.push(storedUrl)
        } else {
          finalImages.push(img)
        }
      }

      // Find if item exists in store
      let existingProduct: any = null

      if (item.id) {
        const { data } = await supabase.from('products').select('*').eq('id', item.id).eq('store_id', storeId).single()
        existingProduct = data
      }

      if (!existingProduct && item.sku) {
        const { data } = await supabase.from('products').select('*').eq('sku', item.sku.trim()).eq('store_id', storeId).single()
        existingProduct = data
      }

      if (!existingProduct && item.barcode) {
        const { data } = await supabase.from('products').select('*').eq('barcode', item.barcode.trim()).eq('store_id', storeId).single()
        existingProduct = data
      }

      if (!existingProduct) {
        const { data } = await supabase.from('products').select('*').eq('name', item.name.trim()).eq('store_id', storeId).single()
        existingProduct = data
      }

      if (existingProduct) {
        // Update product stock and details
        const updatePayload: Record<string, any> = {
          stock_quantity: Number(item.stock_quantity ?? existingProduct.stock_quantity),
          updated_at: new Date().toISOString(),
        }

        if (item.price !== undefined) updatePayload.price = Number(item.price)
        if (item.cost_price !== undefined) updatePayload.cost_price = Number(item.cost_price)
        if (item.compare_price !== undefined) updatePayload.compare_price = Number(item.compare_price)
        if (item.barcode) updatePayload.barcode = item.barcode
        if (item.sku) updatePayload.sku = item.sku
        if (resolvedCatId) updatePayload.category_id = resolvedCatId
        if (item.description) updatePayload.description = item.description

        if (finalImages.length > 0) {
          // Merge unique images
          const merged = Array.from(new Set([...finalImages, ...(existingProduct.images || [])]))
          updatePayload.images = merged
        }

        const { error: updErr } = await supabase
          .from('products')
          .update(updatePayload)
          .eq('id', existingProduct.id)

        if (updErr) throw updErr
        updated++
      } else {
        // Create new product
        const slug = generateSlug(item.name) || `prod-${Date.now()}`
        const { error: insErr } = await supabase
          .from('products')
          .insert({
            store_id: storeId,
            name: item.name.trim(),
            slug,
            sku: item.sku?.trim() || null,
            barcode: item.barcode?.trim() || null,
            price: Number(item.price || 0),
            cost_price: item.cost_price !== undefined ? Number(item.cost_price) : null,
            compare_price: item.compare_price !== undefined ? Number(item.compare_price) : null,
            stock_quantity: Number(item.stock_quantity || 0),
            track_stock: true,
            status: item.is_active === false ? 'draft' : 'active',
            category_id: resolvedCatId,
            description: item.description || null,
            images: finalImages,
          })

        if (insErr) throw insErr
        created++
      }
    } catch (err: any) {
      errors.push({ name: item.name, sku: item.sku, error: err.message || 'خطأ غير معروف' })
    }
  }

  // Record in inventory sync logs
  await supabase.from('inventory_sync_logs').insert({
    store_id: storeId,
    source: body.source || (authHeader ? 'api' : 'manual_sync'),
    status: errors.length === 0 ? 'success' : errors.length < items.length ? 'partial' : 'failed',
    items_processed: processed,
    items_updated: updated,
    items_created: created,
    errors: errors,
    details: { total_sent: items.length },
  })

  return NextResponse.json({
    ok: true,
    message: `اكتملت المزامنة بنجاح: تم معالجة ${processed} صنف، تحديث ${updated} صنف، وإضافة ${created} صنف جديد.`,
    processed,
    updated,
    created,
    errorsCount: errors.length,
    errors: errors.slice(0, 10),
  })
}

export async function GET(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: member } = await supabase
    .from('store_members')
    .select('store_id, stores(id, name, api_sync_key)')
    .eq('user_id', user.id)
    .single()

  if (!member) return NextResponse.json({ error: 'Store not found' }, { status: 404 })

  const { data: logs } = await supabase
    .from('inventory_sync_logs')
    .select('*')
    .eq('store_id', member.store_id)
    .order('created_at', { ascending: false })
    .limit(10)

  return NextResponse.json({
    store: member.stores,
    recentLogs: logs || [],
  })
}
