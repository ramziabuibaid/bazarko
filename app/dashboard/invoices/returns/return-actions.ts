'use server'

import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import { revalidatePath } from 'next/cache'

interface ReturnItemPayload {
  product_id: string | null
  product_name: string
  quantity: number
  unit_price: number
}

interface UpdateReturnPayload {
  return_number: string
  return_date: string
  customer_id: string | null
  refund_method: string
  reason: string | null
  notes: string | null
  items: ReturnItemPayload[]
}

/**
 * حذف مرتجع مبيعات مع عكس أثر المخزون ورصيد العميل
 */
export async function deleteSalesReturn(returnId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { ok: false, error: 'غير مصرح' }

    const storeId = await getStoreForUser(supabase, user.id)
    if (!storeId) return { ok: false, error: 'المتجر غير موجود' }

    // 1. جلب سند المرتجع وبنوده
    const { data: ret } = await supabase
      .from('sales_returns')
      .select('*')
      .eq('id', returnId)
      .eq('store_id', storeId)
      .single()

    if (!ret) return { ok: false, error: 'سند المرتجع غير موجود' }

    const { data: items } = await supabase
      .from('sales_return_items')
      .select('*')
      .eq('sales_return_id', returnId)

    // 2. عكس أثر المخزون (خصم الكميات التي كانت قد أُعيدت للمستودع)
    if (items && items.length > 0) {
      for (const item of items) {
        if (item.product_id) {
          const { data: prod } = await supabase
            .from('products')
            .select('stock_quantity')
            .eq('id', item.product_id)
            .single()

          if (prod) {
            const restoredStock = Math.max(0, Number(prod.stock_quantity || 0) - Number(item.quantity))
            await supabase
              .from('products')
              .update({ stock_quantity: restoredStock })
              .eq('id', item.product_id)
          }

          await supabase
            .from('inventory_movements')
            .delete()
            .eq('ref_id', returnId)
            .eq('product_id', item.product_id)
        }
      }
    }

    // 3. عكس رصيد العميل وكشف الحساب إذا كان المرتجع قيداً دائناً
    if (ret.customer_id && ret.refund_method === 'credit') {
      const { data: cust } = await supabase
        .from('customers')
        .select('balance')
        .eq('id', ret.customer_id)
        .single()

      if (cust) {
        const revertedBalance = Number(cust.balance || 0) + Number(ret.total_amount || 0)
        await supabase
          .from('customers')
          .update({ balance: revertedBalance })
          .eq('id', ret.customer_id)

        await supabase
          .from('customer_ledger')
          .delete()
          .eq('reference_id', returnId)
          .eq('reference_type', 'sales_return')
      }
    }

    // 4. حذف البنود والسند
    await supabase.from('sales_return_items').delete().eq('sales_return_id', returnId)
    const { error: delErr } = await supabase
      .from('sales_returns')
      .delete()
      .eq('id', returnId)
      .eq('store_id', storeId)

    if (delErr) throw delErr

    revalidatePath('/dashboard/invoices/returns')
    revalidatePath('/dashboard/sales')
    return { ok: true }
  } catch (err: any) {
    return { ok: false, error: err.message || 'فشل حذف سند المرتجع' }
  }
}

/**
 * تعديل سند مرتجع مبيعات
 */
export async function updateSalesReturn(
  returnId: string,
  payload: UpdateReturnPayload
): Promise<{ ok: boolean; error?: string }> {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { ok: false, error: 'غير مصرح' }

    const storeId = await getStoreForUser(supabase, user.id)
    if (!storeId) return { ok: false, error: 'المتجر غير موجود' }

    // 1. جلب السند القديم
    const { data: oldRet } = await supabase
      .from('sales_returns')
      .select('*')
      .eq('id', returnId)
      .eq('store_id', storeId)
      .single()

    if (!oldRet) return { ok: false, error: 'سند المرتجع غير موجود' }

    const { data: oldItems } = await supabase
      .from('sales_return_items')
      .select('*')
      .eq('sales_return_id', returnId)

    // 2. عكس أثر المخزون للبنود القديمة
    if (oldItems && oldItems.length > 0) {
      for (const item of oldItems) {
        if (item.product_id) {
          const { data: prod } = await supabase
            .from('products')
            .select('stock_quantity')
            .eq('id', item.product_id)
            .single()

          if (prod) {
            const revertedStock = Math.max(0, Number(prod.stock_quantity || 0) - Number(item.quantity))
            await supabase.from('products').update({ stock_quantity: revertedStock }).eq('id', item.product_id)
          }

          await supabase
            .from('inventory_movements')
            .delete()
            .eq('ref_id', returnId)
            .eq('product_id', item.product_id)
        }
      }
    }

    // 3. عكس رصيد العميل القديم إن وُجد
    if (oldRet.customer_id && oldRet.refund_method === 'credit') {
      const { data: oldCust } = await supabase
        .from('customers')
        .select('balance')
        .eq('id', oldRet.customer_id)
        .single()

      if (oldCust) {
        const revertedBalance = Number(oldCust.balance || 0) + Number(oldRet.total_amount || 0)
        await supabase.from('customers').update({ balance: revertedBalance }).eq('id', oldRet.customer_id)
        await supabase
          .from('customer_ledger')
          .delete()
          .eq('reference_id', returnId)
          .eq('reference_type', 'sales_return')
      }
    }

    // 4. حساب الإجمالي الجديد
    const newTotal = payload.items.reduce((sum, it) => sum + Number(it.quantity || 0) * Number(it.unit_price || 0), 0)

    // 5. تحديث سند المرتجع
    const { error: updErr } = await supabase
      .from('sales_returns')
      .update({
        return_number: payload.return_number.trim(),
        return_date: payload.return_date,
        customer_id: payload.customer_id || null,
        refund_method: payload.refund_method,
        reason: payload.reason?.trim() || null,
        notes: payload.notes?.trim() || null,
        total_amount: newTotal,
        updated_at: new Date().toISOString(),
      })
      .eq('id', returnId)
      .eq('store_id', storeId)

    if (updErr) throw updErr

    // 6. استبدال البنود
    await supabase.from('sales_return_items').delete().eq('sales_return_id', returnId)
    const newItemsPayload = payload.items.map(item => ({
      sales_return_id: returnId,
      product_id: item.product_id || null,
      product_name: item.product_name,
      quantity: Number(item.quantity),
      unit_price: Number(item.unit_price),
      total_price: Number(item.quantity) * Number(item.unit_price),
    }))

    const { error: insErr } = await supabase.from('sales_return_items').insert(newItemsPayload)
    if (insErr) throw insErr

    // 7. إضافة المخزون الجديد وحركاته
    for (const item of payload.items) {
      if (item.product_id) {
        const { data: prod } = await supabase
          .from('products')
          .select('stock_quantity')
          .eq('id', item.product_id)
          .single()

        const newStock = Number(prod?.stock_quantity || 0) + Number(item.quantity)
        await supabase.from('products').update({ stock_quantity: newStock }).eq('id', item.product_id)

        await supabase.from('inventory_movements').insert({
          store_id: storeId,
          product_id: item.product_id,
          movement_type: 'sales_return',
          document_number: payload.return_number,
          document_type: 'مرتجع مبيعات (معدل)',
          ref_id: returnId,
          quantity_in: Number(item.quantity),
          quantity_out: 0,
          balance_after: newStock,
          unit_price: Number(item.unit_price),
          movement_date: payload.return_date,
        })
      }
    }

    // 8. تطبيق الرصيد الجديد على العميل
    if (payload.customer_id && payload.refund_method === 'credit') {
      const { data: newCust } = await supabase
        .from('customers')
        .select('balance')
        .eq('id', payload.customer_id)
        .single()

      if (newCust) {
        const updatedBalance = Number(newCust.balance || 0) - newTotal
        await supabase.from('customers').update({ balance: updatedBalance }).eq('id', payload.customer_id)

        await supabase.from('customer_ledger').insert({
          store_id: storeId,
          customer_id: payload.customer_id,
          type: 'return',
          date: payload.return_date,
          description: `مرتجع مبيعات رقم #${payload.return_number} (معدل)`,
          debit: 0,
          credit: newTotal,
          balance: updatedBalance,
          reference_id: returnId,
          reference_type: 'sales_return',
          created_by: user.id,
        })
      }
    }

    revalidatePath('/dashboard/invoices/returns')
    revalidatePath('/dashboard/sales')
    return { ok: true }
  } catch (err: any) {
    return { ok: false, error: err.message || 'فشل تحديث سند المرتجع' }
  }
}
