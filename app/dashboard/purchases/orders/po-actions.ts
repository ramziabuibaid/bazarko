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

    // 1. جلب أمر الشراء وبنوده
    const { data: po, error: poErr } = await supabase
      .from('purchase_orders')
      .select('*, items:purchase_order_items(*)')
      .eq('id', poId)
      .eq('store_id', storeId)
      .single()

    if (poErr || !po) return { ok: false, error: 'أمر الشراء غير موجود' }

    if (po.converted_invoice_id) {
      return { ok: false, error: 'تم تحويل أمر الشراء هذا مسبقاً إلى فاتورة مشتريات' }
    }

    // 2. توليد رقم فاتورة شراء جديدة
    const { count } = await supabase
      .from('purchase_invoices')
      .select('*', { count: 'exact', head: true })
      .eq('store_id', storeId)

    const nextInvoiceNum = `PINV-${String((count ?? 0) + 1).padStart(4, '0')}`

    // 3. إنشاء فاتورة المشتريات
    const { data: newInv, error: invErr } = await supabase
      .from('purchase_invoices')
      .insert({
        store_id: storeId,
        invoice_number: nextInvoiceNum,
        supplier_id: po.supplier_id,
        invoice_date: new Date().toISOString().slice(0, 10),
        due_date: po.expected_date || null,
        total_amount: po.total,
        paid_amount: 0,
        payment_status: 'unpaid',
        payment_method: 'credit',
        notes: `فاتورة شراء تم توليدها آلياً من أمر الشراء رقم #${po.order_number}. ${po.notes || ''}`.trim(),
        created_by: user.id,
      })
      .select('id')
      .single()

    if (invErr) throw invErr

    // 4. إدراج بنود فاتورة المشتريات وتحديث المخزون
    const purchaseItems = (po.items || []).map((item: any) => ({
      purchase_invoice_id: newInv.id,
      product_id: item.product_id || null,
      product_name: item.item_name,
      quantity: Number(item.quantity),
      unit_price: Number(item.unit_price),
      total_price: Number(item.total),
    }))

    if (purchaseItems.length > 0) {
      const { error: piErr } = await supabase.from('purchase_items').insert(purchaseItems)
      if (piErr) throw piErr

      // تحديث كميات المخزون وحركات المخزن للأصناف المرتبطة
      for (const it of purchaseItems) {
        if (it.product_id) {
          const { data: prod } = await supabase.from('products').select('stock_quantity, cost_price').eq('id', it.product_id).single()
          if (prod) {
            const newStock = Number(prod.stock_quantity || 0) + it.quantity
            await supabase.from('products').update({
              stock_quantity: newStock,
              cost_price: it.unit_price || prod.cost_price,
            }).eq('id', it.product_id)

            await supabase.from('inventory_movements').insert({
              store_id: storeId,
              product_id: it.product_id,
              movement_type: 'purchase',
              document_number: nextInvoiceNum,
              document_type: 'فاتورة مشتريات (أمر شراء)',
              ref_id: newInv.id,
              entity_name: po.supplier_name || 'مورد عام',
              quantity_in: Number(it.quantity),
              quantity_out: 0,
              balance_after: newStock,
              unit_price: Number(it.unit_price || prod.cost_price || 0),
              notes: `وارد مشتريات بموجب فاتورة ${nextInvoiceNum} (أمر شراء ${po.order_number})`,
              movement_date: new Date().toISOString().slice(0, 10),
            })
          }
        }
      }
    }

    // 5. تحديث حساب المورد (زيادة ذمة المورد كحركة دائنة)
    if (po.supplier_id) {
      const { data: sup } = await supabase.from('suppliers').select('balance').eq('id', po.supplier_id).single()
      if (sup) {
        const newBal = Number(sup.balance || 0) + Number(po.total)
        await supabase.from('suppliers').update({ balance: newBal }).eq('id', po.supplier_id)

        await supabase.from('supplier_ledger').insert({
          store_id: storeId,
          supplier_id: po.supplier_id,
          type: 'invoice',
          date: new Date().toISOString().slice(0, 10),
          description: `فاتورة شراء رقم ${nextInvoiceNum} من أمر شراء #${po.order_number}`,
          reference: nextInvoiceNum,
          debit: 0,
          credit: Number(po.total),
          balance: newBal,
        })
      }
    }

    // 6. تحديث حالة أمر الشراء إلى مستلم وتم التحويل
    await supabase
      .from('purchase_orders')
      .update({
        status: 'received',
        converted_invoice_id: newInv.id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', po.id)

    revalidatePath('/dashboard/purchases')
    revalidatePath('/dashboard/purchases/orders')

    return { ok: true, invoiceId: newInv.id }
  } catch (err: any) {
    console.error('Error converting PO:', err)
    return { ok: false, error: err.message || 'فشل تحويل أمر الشراء إلى فاتورة' }
  }
}
