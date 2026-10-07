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
 * Calculates sell price from cost price:
 * - 35% profit margin (cost * 1.35)
 * - Tiered rounding upwards:
 *   - cost < 200 ILS: round up to nearest 10
 *   - cost 200 - 1000 ILS: round up to nearest 50
 *   - cost > 1000 ILS: round up to nearest 100
 */
export function calculateSellPrice(costPrice: number): number {
  const cost = Number(costPrice) || 0
  if (cost <= 0) return 0
  const rawPrice = cost * 1.35
  if (cost < 200) {
    return Math.ceil(rawPrice / 10) * 10
  } else if (cost <= 1000) {
    return Math.ceil(rawPrice / 50) * 50
  } else {
    return Math.ceil(rawPrice / 100) * 100
  }
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
  // First attempt: High-performance atomic SQL execution in PostgreSQL
  try {
    const { data: rpcData, error: rpcErr } = await supabase.rpc('shamel_execute_hybrid_sync', {
      p_store_id: storeId,
    })
    if (!rpcErr && rpcData) {
      return {
        customersMatchedByPhone: Number(rpcData.customersMatchedByPhone || 0),
        customersInserted: Number(rpcData.customersInserted || 0),
        customersUpdated: Number(rpcData.customersUpdated || 0),
        productsInserted: Number(rpcData.productsInserted || 0),
        productsUpdated: Number(rpcData.productsUpdated || 0),
      }
    }
    if (rpcErr) {
      console.warn('SQL hybrid sync RPC error, falling back to batch processor:', rpcErr.message)
    }
  } catch (rpcEx: any) {
    console.warn('SQL hybrid sync RPC exception, falling back to batch processor:', rpcEx?.message)
  }

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
      .select('code, name, phone, address, balance, last_invoice_date, last_receipt_date')
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
      .select('id, name, phone, shamel_code, address, balance, last_order_at, last_payment_at')
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
  const customersToUpdate: Array<{ id: string; patch: any }> = []

  for (const sc of allShamelCustomers) {
    if (sc.code.startsWith('S')) continue

    const lastOrderIso = sc.last_invoice_date ? `${sc.last_invoice_date}T00:00:00.000Z` : null
    const lastPaymentIso = sc.last_receipt_date ? `${sc.last_receipt_date}T00:00:00.000Z` : null
    const shamelBalance = Number(sc.balance || 0)

    const existingByCode = byShamelCode.get(sc.code)
    if (existingByCode) {
      customersToUpdate.push({
        id: existingByCode.id,
        patch: {
          name: sc.name,
          phone: sc.phone || existingByCode.phone,
          address: sc.address || existingByCode.address,
          balance: shamelBalance,
          last_order_at: lastOrderIso || existingByCode.last_order_at,
          last_payment_at: lastPaymentIso || existingByCode.last_payment_at,
          updated_at: new Date().toISOString(),
        },
      })
      continue
    }

    const normPhone = normalizePhone(sc.phone)
    const existingByPhone = normPhone.length >= 7 ? byNormPhone.get(normPhone) : null

    if (existingByPhone) {
      customersToUpdate.push({
        id: existingByPhone.id,
        patch: {
          shamel_code: sc.code,
          address: existingByPhone.address || sc.address || undefined,
          balance: shamelBalance,
          last_order_at: lastOrderIso || existingByPhone.last_order_at,
          last_payment_at: lastPaymentIso || existingByPhone.last_payment_at,
          updated_at: new Date().toISOString(),
        },
      })

      existingByPhone.shamel_code = sc.code
      byShamelCode.set(sc.code, existingByPhone)
      result.customersMatchedByPhone++
    } else {
      customersToInsert.push({
        store_id: storeId,
        name: sc.name,
        phone: sc.phone || '',
        address: sc.address || '',
        balance: shamelBalance,
        last_order_at: lastOrderIso,
        last_payment_at: lastPaymentIso,
        shamel_code: sc.code,
        customer_type: 'retail',
        is_active: true,
      })
    }
  }

  // Execute customer updates concurrently in chunks
  for (let i = 0; i < customersToUpdate.length; i += 30) {
    const chunk = customersToUpdate.slice(i, i + 30)
    await Promise.all(
      chunk.map(u => supabase.from('customers').update(u.patch).eq('id', u.id))
    )
    result.customersUpdated += chunk.length
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
      .select('code, name, barcode, price, cost_price, quantity')
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
      .select('id, shamel_code, sku, barcode, name, price, cost_price')
      .eq('store_id', storeId)
      .range(page * 1000, (page + 1) * 1000 - 1)
    if (error) throw new Error(`فشل جلب منتجات بازاركو: ${error.message}`)
    if (!data || data.length === 0) break
    existingBazarkoProducts.push(...data)
    page++
  }

  const productByCode = new Map<string, any>()
  const productByBarcode = new Map<string, any>()
  for (const p of existingBazarkoProducts) {
    if (p.shamel_code) {
      productByCode.set(p.shamel_code, p)
    }
    if (p.sku) {
      productByCode.set(p.sku, p)
    }
    if (p.barcode) {
      productByBarcode.set(p.barcode, p)
    }
  }

  const productsToInsert: any[] = []
  const productsToUpdate: Array<{ id: string; patch: any }> = []

  for (const stk of allShamelStock) {
    const existing = productByCode.get(stk.code) || (stk.barcode ? productByBarcode.get(stk.barcode) : null)
    const inStockQty = Math.max(0, Math.round(Number(stk.quantity) || 0))
    const cost = Number(stk.cost_price) || 0

    if (existing) {
      const newPrice = cost > 0 ? calculateSellPrice(cost) : (stk.price > 0 ? stk.price : existing.price)
      productsToUpdate.push({
        id: existing.id,
        patch: {
          name: stk.name,
          sku: stk.code,
          shamel_code: stk.code,
          barcode: stk.barcode || existing.barcode,
          price: newPrice,
          cost_price: cost > 0 ? cost : existing.cost_price,
          stock_quantity: inStockQty,
          track_stock: true,
          status: inStockQty > 0 ? 'active' : 'hidden',
          updated_at: new Date().toISOString(),
        },
      })
    } else if (inStockQty > 0) {
      // Synchronize only products that have available stock
      const cleanCode = (stk.code || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase()
      const rand = Math.random().toString(36).substring(2, 8)
      const slug = `shamel-${cleanCode || 'item'}-${rand}`
      const price = cost > 0 ? calculateSellPrice(cost) : (Number(stk.price) || 0)

      productsToInsert.push({
        store_id: storeId,
        name: stk.name,
        slug,
        sku: stk.code,
        shamel_code: stk.code,
        barcode: stk.barcode || '',
        price,
        cost_price: cost,
        stock_quantity: inStockQty,
        track_stock: true,
        status: 'active',
      })
    }
  }

  // Execute product updates concurrently in chunks
  for (let i = 0; i < productsToUpdate.length; i += 25) {
    const chunk = productsToUpdate.slice(i, i + 25)
    await Promise.all(
      chunk.map(u => supabase.from('products').update(u.patch).eq('id', u.id))
    )
    result.productsUpdated += chunk.length
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
