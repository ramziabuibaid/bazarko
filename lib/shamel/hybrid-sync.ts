import { SupabaseClient } from '@supabase/supabase-js'

export interface HybridSyncResult {
  customersMatchedByPhone: number
  customersInserted: number
  customersUpdated: number
  productsInserted: number
  productsUpdated: number
}

/**
 * Normalizes phone numbers for matching:
 * - strips whitespace, dashes, slashes, brackets
 * - strips 00970, 00972, 970, 972 prefixes
 * - strips leading 0 (e.g. 0599 -> 599)
 */
export function normalizePhone(phone: string | null | undefined): string {
  if (!phone) return ''
  let digits = phone.replace(/\D/g, '')
  if (digits.startsWith('00970')) digits = digits.slice(5)
  else if (digits.startsWith('00972')) digits = digits.slice(5)
  else if (digits.startsWith('970')) digits = digits.slice(3)
  else if (digits.startsWith('972')) digits = digits.slice(3)

  if (digits.startsWith('0')) digits = digits.slice(1)

  return digits
}

/**
 * Synchronizes Shamel data to Bazarko operational tables under the Hybrid Model:
 * 1. Customers:
 *    - Existing Bazarko customer with matching shamel_code -> update details.
 *    - Bazarko customer without shamel_code but with MATCHING PHONE -> associate shamel_code (NO DUPLICATES!).
 *    - New Shamel customer -> insert with shamel_code and 0 initial balance.
 * 2. Products:
 *    - Products are maintained in Shamel and synced downwards to Bazarko.
 *    - Existing product with shamel_code -> update price/cost/name/barcode.
 *    - New Shamel product -> insert with shamel_code, active status.
 */
export async function executeHybridSync(
  supabase: SupabaseClient,
  storeId: string
): Promise<HybridSyncResult> {
  const result: HybridSyncResult = {
    customersMatchedByPhone: 0,
    customersInserted: 0,
    customersUpdated: 0,
    productsInserted: 0,
    productsUpdated: 0,
  }

  // ─────────────────────────────────────────────────────────────
  // 1. SYNC CUSTOMERS
  // ─────────────────────────────────────────────────────────────
  let allShamelCustomers: any[] = []
  let page = 0
  while (true) {
    const { data, error } = await supabase
      .from('shamel_customers')
      .select('code, name, phone, address, balance')
      .eq('store_id', storeId)
      .range(page * 1000, (page + 1) * 1000 - 1)
    if (error) throw new Error(`فشل جلب زبائن الشامل: ${error.message}`)
    if (!data || data.length === 0) break
    allShamelCustomers.push(...data)
    page++
  }

  let existingBazarkoCustomers: any[] = []
  page = 0
  while (true) {
    const { data, error } = await supabase
      .from('customers')
      .select('id, name, phone, shamel_code, address')
      .eq('store_id', storeId)
      .range(page * 1000, (page + 1) * 1000 - 1)
    if (error) throw new Error(`فشل جلب زبائن بازاركو: ${error.message}`)
    if (!data || data.length === 0) break
    existingBazarkoCustomers.push(...data)
    page++
  }

  const byShamelCode = new Map<string, any>()
  const byNormPhone = new Map<string, any>()

  for (const c of existingBazarkoCustomers) {
    if (c.shamel_code) {
      byShamelCode.set(c.shamel_code, c)
    }
    const normP = normalizePhone(c.phone)
    if (normP.length >= 7) {
      byNormPhone.set(normP, c)
    }
  }

  const customersToInsert: any[] = []

  for (const sc of allShamelCustomers) {
    if (sc.code.startsWith('S')) continue

    const existingByCode = byShamelCode.get(sc.code)
    if (existingByCode) {
      await supabase
        .from('customers')
        .update({
          name: sc.name,
          phone: sc.phone || existingByCode.phone,
          address: sc.address || existingByCode.address,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existingByCode.id)
      result.customersUpdated++
      continue
    }

    const normPhone = normalizePhone(sc.phone)
    const existingByPhone = normPhone.length >= 7 ? byNormPhone.get(normPhone) : null

    if (existingByPhone) {
      await supabase
        .from('customers')
        .update({
          shamel_code: sc.code,
          address: existingByPhone.address || sc.address || undefined,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existingByPhone.id)

      existingByPhone.shamel_code = sc.code
      byShamelCode.set(sc.code, existingByPhone)
      result.customersMatchedByPhone++
    } else {
      customersToInsert.push({
        store_id: storeId,
        name: sc.name,
        phone: sc.phone || '',
        address: sc.address || '',
        balance: 0,
        shamel_code: sc.code,
        customer_type: 'retail',
        is_active: true,
      })
    }
  }

  for (let i = 0; i < customersToInsert.length; i += 200) {
    const chunk = customersToInsert.slice(i, i + 200)
    const { error: insertErr } = await supabase.from('customers').insert(chunk)
    if (insertErr) {
      throw new Error(`فشل إدخال دفعة الزبائن: ${insertErr.message}`)
    }
    result.customersInserted += chunk.length
  }

  // ─────────────────────────────────────────────────────────────
  // 2. SYNC PRODUCTS (STOCK)
  // ─────────────────────────────────────────────────────────────
  let allShamelStock: any[] = []
  page = 0
  while (true) {
    const { data, error } = await supabase
      .from('shamel_stock')
      .select('code, name, barcode, price, cost_price')
      .eq('store_id', storeId)
      .range(page * 1000, (page + 1) * 1000 - 1)
    if (error) throw new Error(`فشل جلب أصناف الشامل: ${error.message}`)
    if (!data || data.length === 0) break
    allShamelStock.push(...data)
    page++
  }

  let existingBazarkoProducts: any[] = []
  page = 0
  while (true) {
    const { data, error } = await supabase
      .from('products')
      .select('id, shamel_code, name, price, cost_price, barcode')
      .eq('store_id', storeId)
      .range(page * 1000, (page + 1) * 1000 - 1)
    if (error) throw new Error(`فشل جلب منتجات بازاركو: ${error.message}`)
    if (!data || data.length === 0) break
    existingBazarkoProducts.push(...data)
    page++
  }

  const productByShamelCode = new Map<string, any>()
  for (const p of existingBazarkoProducts) {
    if (p.shamel_code) {
      productByShamelCode.set(p.shamel_code, p)
    }
  }

  const productsToInsert: any[] = []

  for (const stk of allShamelStock) {
    const existing = productByShamelCode.get(stk.code)
    if (existing) {
      await supabase
        .from('products')
        .update({
          name: stk.name,
          barcode: stk.barcode || existing.barcode,
          price: stk.price > 0 ? stk.price : existing.price,
          cost_price: stk.cost_price > 0 ? stk.cost_price : existing.cost_price,
          status: 'active',
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
      result.productsUpdated++
    } else {
      const cleanCode = (stk.code || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase()
      const rand = Math.random().toString(36).substring(2, 8)
      const slug = `shamel-${cleanCode || 'item'}-${rand}`

      productsToInsert.push({
        store_id: storeId,
        name: stk.name,
        slug,
        sku: stk.code,
        barcode: stk.barcode || '',
        price: Number(stk.price) || 0,
        cost_price: Number(stk.cost_price) || 0,
        stock_quantity: 0,
        shamel_code: stk.code,
        status: 'active',
      })
    }
  }

  for (let i = 0; i < productsToInsert.length; i += 200) {
    const chunk = productsToInsert.slice(i, i + 200)
    const { error: insertProdErr } = await supabase.from('products').insert(chunk)
    if (insertProdErr) {
      throw new Error(`فشل إدخال دفعة الأصناف: ${insertProdErr.message}`)
    }
    result.productsInserted += chunk.length
  }

  // Mark all shamel_customers and shamel_stock as promoted
  await Promise.all([
    supabase
      .from('shamel_customers')
      .update({ is_promoted: true, promoted_at: new Date().toISOString() })
      .eq('store_id', storeId),
    supabase
      .from('shamel_stock')
      .update({ is_promoted: true, promoted_at: new Date().toISOString() })
      .eq('store_id', storeId),
  ])

  return result
}
