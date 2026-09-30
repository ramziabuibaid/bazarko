'use server'

import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import { revalidatePath } from 'next/cache'

export interface POItemInput {
  product_id?: string | null
  item_name: string
  item_sku?: string | null
  quantity: number
  unit_price: number
  discount_amount?: number
  notes?: string
}

export interface CreatePOInput {
  order_number: string
  supplier_id?: string | null
  issue_date: string
  expected_date?: string | null
  notes?: string
  items: POItemInput[]
}

/**
 * إنشاء أمر شراء جديد مع بنوده
 */
export async function createPurchaseOrder(input: CreatePOInput): Promise<{ ok: boolean; id?: string; error?: string }> {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { ok: false, error: 'غير مصرح' }

    const storeId = await getStoreForUser(supabase, user.id)
    if (!storeId) return { ok: false, error: 'المتجر غير موجود' }

    if (!input.items || input.items.length === 0) {
      return { ok: false, error: 'يجب إضافة بند واحد على الأقل في أمر الشراء' }
    }

    const subtotal = input.items.reduce((sum, i) => sum + (Number(i.quantity) * Number(i.unit_price)), 0)
    const discount = input.items.reduce((sum, i) => sum + (Number(i.discount_amount) || 0), 0)
    const total = Math.max(0, subtotal - discount)

    // 1. إدراج أمر الشراء
    const { data: po, error: poErr } = await supabase
      .from('purchase_orders')
      .insert({
        store_id: storeId,
        order_number: input.order_number.trim(),
        supplier_id: input.supplier_id || null,
        issue_date: input.issue_date,
        expected_date: input.expected_date || null,
        status: 'draft',
        subtotal,
        discount_amount: discount,
        total,
        notes: input.notes?.trim() || null,
        created_by: user.id,
      })
      .select('id')
      .single()

    if (poErr) throw poErr

    // 2. إدراج بنود أمر الشراء
    const itemRows = input.items.map(i => ({
      purchase_order_id: po.id,
      product_id: i.product_id || null,
      item_name: i.item_name.trim(),
      item_sku: i.item_sku?.trim() || null,
      quantity: Number(i.quantity),
      unit_price: Number(i.unit_price),
      discount_amount: Number(i.discount_amount) || 0,
      total: Number(i.quantity) * Number(i.unit_price) - (Number(i.discount_amount) || 0),
      notes: i.notes?.trim() || null,
    }))

    const { error: itemsErr } = await supabase.from('purchase_order_items').insert(itemRows)
    if (itemsErr) throw itemsErr

    revalidatePath('/dashboard/purchases/orders')
    return { ok: true, id: po.id }
  } catch (err: any) {
    console.error('Error creating purchase order:', err)
    return { ok: false, error: err.message || 'فشل إنشاء أمر الشراء' }
  }
}

/**
 * تحديث حالة أمر الشراء
 */
export async function updatePOStatus(poId: string, status: 'draft' | 'sent' | 'confirmed' | 'received' | 'cancelled'): Promise<{ ok: boolean; error?: string }> {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { ok: false, error: 'غير مصرح' }

    const storeId = await getStoreForUser(supabase, user.id)
    if (!storeId) return { ok: false, error: 'المتجر غير موجود' }

    const { error } = await supabase
      .from('purchase_orders')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', poId)
      .eq('store_id', storeId)

    if (error) throw error

    revalidatePath('/dashboard/purchases/orders')
    return { ok: true }
  } catch (err: any) {
    return { ok: false, error: err.message || 'فشل تحديث الحالة' }
  }
}

/**
 * حذف أمر الشراء
 */
export async function deletePurchaseOrder(poId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { ok: false, error: 'غير مصرح' }

    const storeId = await getStoreForUser(supabase, user.id)
    if (!storeId) return { ok: false, error: 'المتجر غير موجود' }

    const { error } = await supabase
      .from('purchase_orders')
      .delete()
      .eq('id', poId)
      .eq('store_id', storeId)

    if (error) throw error

    revalidatePath('/dashboard/purchases/orders')
    return { ok: true }
  } catch (err: any) {
    return { ok: false, error: err.message || 'فشل حذف أمر الشراء' }
  }
}

/**
 * تحويل أمر الشراء إلى فاتورة مشتريات فعلية بنقرة واحدة (Item 10)
 */
export async function convertPOToPurchaseInvoice(poId: string): Promise<{ ok: boolean; invoiceId?: string; error?: string }> {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { ok: false, error: 'غير مصرح' }

    const storeId = await getStoreForUser(supabase, user.id)
    if (!storeId) return { ok: false, error: 'المتجر غير موجود' }

    const { data, error } = await supabase.rpc('receive_purchase_order_atomic', {
      p_po: poId, p_receive: true,
    })
    if (error || !data?.ok) return { ok: false, error: error?.message || 'فشل استلام أمر الشراء' }

    revalidatePath('/dashboard/purchases')
    revalidatePath('/dashboard/purchases/orders')

    return { ok: true, invoiceId: data.invoiceId }
  } catch (err: any) {
    console.error('Error converting PO:', err)
    return { ok: false, error: err.message || 'فشل تحويل أمر الشراء إلى فاتورة' }
  }
}
