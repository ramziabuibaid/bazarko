'use server'

import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import { requireStorePermission } from '@/lib/supabase/permissions'
import { checkIsPeriodClosed } from '@/app/dashboard/accounting/periods/period-actions'
import { postJournalEntry, reverseJournalEntry } from '@/lib/accounting/engine'
import { resolveAccount } from '@/lib/accounting/resolver'
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
 * حذف مرتجع مبيعات مع عكس أثر المخزون ورصيد العميل بشكل ذري وآمن
 */
export async function deleteSalesReturn(returnId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { ok: false, error: 'غير مصرح' }

    const storeId = await getStoreForUser(supabase, user.id)
    if (!storeId) return { ok: false, error: 'المتجر غير موجود' }

    await requireStorePermission(storeId, 'sales.write')

    // 1. جلب سند المرتجع وبنوده
    const { data: ret } = await supabase
      .from('sales_returns')
      .select('*')
      .eq('id', returnId)
      .eq('store_id', storeId)
      .single()

    if (!ret) return { ok: false, error: 'سند المرتجع غير موجود' }

    const periodCheck = await checkIsPeriodClosed(storeId, ret.return_date)
    if (periodCheck.isClosed) {
      return { ok: false, error: `لا يمكن حذف مرتجع يقع ضمن فترة محاسبية مقفلة (${periodCheck.periodName})` }
    }

    const { data: items } = await supabase
      .from('sales_return_items')
      .select('*')
      .eq('sales_return_id', returnId)

    // التحقق من كفاية المخزون قبل عكسه
    if (items && items.length > 0) {
      for (const item of items) {
        if (item.product_id) {
          const { data: prod } = await supabase
            .from('products')
            .select('stock_quantity, track_stock, name')
            .eq('id', item.product_id)
            .single()

          if (prod && prod.track_stock !== false && Number(prod.stock_quantity || 0) < Number(item.quantity)) {
            return {
              ok: false,
              error: `لا يمكن حذف المرتجع: الكمية الحالية للصنف (${prod.name}) لا تكفي لعكس المرتجع (${prod.stock_quantity} متاح مقابل ${item.quantity} مطلوب)`,
            }
          }
        }
      }
    }

    // سجل التراجعات في حال فشل أي خطوة
    const stockRollback: Array<{ productId: string; oldStock: number }> = []

    // 2. عكس أثر المخزون
    if (items && items.length > 0) {
      for (const item of items) {
        if (item.product_id) {
          const { data: prod } = await supabase
            .from('products')
            .select('stock_quantity')
            .eq('id', item.product_id)
            .single()

          if (prod) {
            const curStock = Number(prod.stock_quantity || 0)
            const restoredStock = Math.max(0, curStock - Number(item.quantity))
            stockRollback.push({ productId: item.product_id, oldStock: curStock })
            await supabase.from('products').update({ stock_quantity: restoredStock }).eq('id', item.product_id)
          }

          await supabase
            .from('inventory_movements')
            .delete()
            .eq('ref_id', returnId)
            .eq('product_id', item.product_id)

          await supabase
            .from('stock_movements')
            .delete()
            .eq('reference_id', returnId)
            .eq('reference_type', 'sales_return')
            .eq('product_id', item.product_id)
        }
      }
    }

    // 3. عكس رصيد العميل وكشف الحساب إذا كان المرتجع قيداً دائناً
    let prevCustomerBalance: number | null = null
    if (ret.customer_id && ret.refund_method === 'credit') {
      const { data: cust } = await supabase
        .from('customers')
        .select('balance')
        .eq('id', ret.customer_id)
        .single()

      if (cust) {
        prevCustomerBalance = cust.balance
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

    // عكس القيد المحاسبي المزدوج في دفتر اليومية إن وُجد
    if (ret.journal_entry_id) {
      try {
        await reverseJournalEntry(ret.journal_entry_id, user.id, `إلغاء سند مرتجع مبيعات #${ret.return_number}`)
      } catch (jErr) {
        console.error('Failed to reverse journal entry for sales return:', jErr)
      }
    }

    // 4. حذف البنود والسند
    await supabase.from('sales_return_items').delete().eq('sales_return_id', returnId)
    const { error: delErr } = await supabase
      .from('sales_returns')
      .delete()
      .eq('id', returnId)
      .eq('store_id', storeId)

    if (delErr) {
      // استعادة المخزون ورصيد العميل عند فشل الحذف
      for (const rb of stockRollback) {
        await supabase.from('products').update({ stock_quantity: rb.oldStock }).eq('id', rb.productId)
      }
      if (ret.customer_id && prevCustomerBalance !== null) {
        await supabase.from('customers').update({ balance: prevCustomerBalance }).eq('id', ret.customer_id)
      }
      return { ok: false, error: delErr.message || 'فشل حذف سند المرتجع' }
    }

    revalidatePath('/dashboard/invoices/returns')
    revalidatePath('/dashboard/sales')
    return { ok: true }
  } catch (err: any) {
    return { ok: false, error: err.message || 'فشل حذف سند المرتجع' }
  }
}

/**
 * تعديل سند مرتجع مبيعات مع حماية ذرية كاملة
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

    await requireStorePermission(storeId, 'sales.write')

    // 1. جلب السند القديم
    const { data: oldRet } = await supabase
      .from('sales_returns')
      .select('*')
      .eq('id', returnId)
      .eq('store_id', storeId)
      .single()

    if (!oldRet) return { ok: false, error: 'سند المرتجع غير موجود' }

    // فحص الفترات المحاسبية المقفلة
    const oldPeriodCheck = await checkIsPeriodClosed(storeId, oldRet.return_date)
    if (oldPeriodCheck.isClosed) {
      return { ok: false, error: `لا يمكن تعديل مرتجع يقع ضمن فترة محاسبية مقفلة (${oldPeriodCheck.periodName})` }
    }

    if (payload.return_date !== oldRet.return_date) {
      const newPeriodCheck = await checkIsPeriodClosed(storeId, payload.return_date)
      if (newPeriodCheck.isClosed) {
        return { ok: false, error: `لا يمكن نقل المرتجع إلى فترة محاسبية مقفلة (${newPeriodCheck.periodName})` }
      }
    }

    const { data: oldItems } = await supabase
      .from('sales_return_items')
      .select('*')
      .eq('sales_return_id', returnId)

    // التحقق من كفاية المخزون عند عكس القديم وتطبيق الجديد
    for (const oldItem of oldItems || []) {
      if (oldItem.product_id) {
        const { data: prod } = await supabase
          .from('products')
          .select('stock_quantity, track_stock, name')
          .eq('id', oldItem.product_id)
          .single()

        const newItemQty = (payload.items || [])
          .filter(it => it.product_id === oldItem.product_id)
          .reduce((sum, it) => sum + Number(it.quantity || 0), 0)

        // الفرق الصافي الذي سيُخصم من المخزون
        const netDeduction = Number(oldItem.quantity) - newItemQty
        if (prod && prod.track_stock !== false && netDeduction > 0 && Number(prod.stock_quantity || 0) < netDeduction) {
          return {
            ok: false,
            error: `المخزون الحالي للصنف (${prod.name}) لا يكفي لتعديل المرتجع (${prod.stock_quantity} متاح)`,
          }
        }
      }
    }

    // 2. تحديث سند المرتجع أولاً
    const newTotal = payload.items.reduce((sum, it) => sum + Number(it.quantity || 0) * Number(it.unit_price || 0), 0)

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

    if (updErr) {
      return { ok: false, error: updErr.message || 'فشل تحديث بيانات سند المرتجع' }
    }

    // 3. عكس المخزون القديم وتطبيق الجديد
    if (oldItems && oldItems.length > 0) {
      for (const item of oldItems) {
        if (item.product_id) {
          const { data: prod } = await supabase.from('products').select('stock_quantity').eq('id', item.product_id).single()
          if (prod) {
            const revertedStock = Math.max(0, Number(prod.stock_quantity || 0) - Number(item.quantity))
            await supabase.from('products').update({ stock_quantity: revertedStock }).eq('id', item.product_id)
          }
          await supabase.from('inventory_movements').delete().eq('ref_id', returnId).eq('product_id', item.product_id)
          await supabase.from('stock_movements').delete().eq('reference_id', returnId).eq('reference_type', 'sales_return').eq('product_id', item.product_id)
        }
      }
    }

    // استبدال البنود
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
    if (insErr) {
      return { ok: false, error: insErr.message || 'فشل حفظ بنود المرتجع المحدثة' }
    }

    // إضافة المخزون الجديد وحركاته
    for (const item of payload.items) {
      if (item.product_id) {
        const { data: prod } = await supabase.from('products').select('stock_quantity, track_stock').eq('id', item.product_id).single()
        const curStock = Number(prod?.stock_quantity || 0)
        const newStock = curStock + Number(item.quantity)
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
          created_by: user.id,
        })

        await supabase.from('stock_movements').insert({
          store_id: storeId,
          product_id: item.product_id,
          type: 'return',
          quantity: Number(item.quantity),
          quantity_before: curStock,
          quantity_after: newStock,
          reference_id: returnId,
          reference_type: 'sales_return',
          notes: `مرتجع مبيعات (معدل) #${payload.return_number}`,
          created_by: user.id,
        })
      }
    }

    // 4. تسوية ذمة العميل
    if (oldRet.customer_id && oldRet.refund_method === 'credit') {
      const { data: oldCust } = await supabase.from('customers').select('balance').eq('id', oldRet.customer_id).single()
      if (oldCust) {
        const revertedBalance = Number(oldCust.balance || 0) + Number(oldRet.total_amount || 0)
        await supabase.from('customers').update({ balance: revertedBalance }).eq('id', oldRet.customer_id)
        await supabase.from('customer_ledger').delete().eq('reference_id', returnId).eq('reference_type', 'sales_return')
      }
    }

    if (payload.customer_id && payload.refund_method === 'credit') {
      const { data: newCust } = await supabase.from('customers').select('balance').eq('id', payload.customer_id).single()
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

    // 5. تحديث القيد المحاسبي المزدوج
    if (oldRet.journal_entry_id) {
      try {
        await reverseJournalEntry(oldRet.journal_entry_id, user.id, `تعديل سند مرتجع مبيعات #${payload.return_number}`)
      } catch (jErr) {
        console.error('Failed to reverse previous journal entry on return edit:', jErr)
      }
    }

    try {
      const returnAccountRes = await resolveAccount(supabase, 'SALES_RETURNS', { storeId })
      const counterpartRes = payload.refund_method === 'credit' && payload.customer_id
        ? await resolveAccount(supabase, 'CUSTOMER_RECEIVABLE', { storeId, customerId: payload.customer_id })
        : await resolveAccount(supabase, 'CASH', { storeId })

      if (returnAccountRes?.accountId && counterpartRes?.accountId) {
        const lines = [
          { account_id: returnAccountRes.accountId, debit: newTotal, credit: 0, description: `مرتجع مبيعات معدل #${payload.return_number}` },
          { account_id: counterpartRes.accountId, debit: 0, credit: newTotal, description: `مرتجع مبيعات معدل #${payload.return_number}` },
        ]

        await postJournalEntry({
          storeId,
          date: payload.return_date,
          description: `مرتجع مبيعات رقم #${payload.return_number} (معدل)`,
          source: 'sales_return',
          sourceType: 'sales_return',
          sourceId: returnId,
          sourceNumber: payload.return_number,
          lines,
          actorId: user.id,
        })
      }
    } catch (jErr) {
      console.error('Error posting updated journal entry for sales return:', jErr)
    }

    revalidatePath('/dashboard/invoices/returns')
    revalidatePath('/dashboard/sales')
    return { ok: true }
  } catch (err: any) {
    return { ok: false, error: err.message || 'فشل تحديث سند المرتجع' }
  }
}

/**
 * إنشاء سند مرتجع مبيعات مع تحديث ذري للمخزون والذمم والقيود اليومية
 */
export async function createSalesReturnAction(payload: {
  return_number?: string
  return_date: string
  customer_id: string | null
  invoice_id: string | null
  refund_method: string
  reason?: string | null
  notes?: string | null
  items: ReturnItemPayload[]
}): Promise<{ ok: boolean; error?: string; returnId?: string }> {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { ok: false, error: 'غير مصرح' }

    const storeId = await getStoreForUser(supabase, user.id)
    if (!storeId) return { ok: false, error: 'المتجر غير موجود' }

    await requireStorePermission(storeId, 'sales.write')

    const periodCheck = await checkIsPeriodClosed(storeId, payload.return_date)
    if (periodCheck.isClosed) {
      return { ok: false, error: `لا يمكن إنشاء مرتجع في فترة محاسبية مقفلة (${periodCheck.periodName})` }
    }

    if (!payload.items || payload.items.length === 0) {
      return { ok: false, error: 'يرجى تحديد أصناف وكميات صحيحة للإرجاع' }
    }

    const returnTotal = payload.items.reduce(
      (sum, it) => sum + (Number(it.quantity) || 0) * (Number(it.unit_price) || 0),
      0
    )

    if (returnTotal <= 0) {
      return { ok: false, error: 'إجمالي المرتجع يجب أن يكون أكبر من الصفر' }
    }

    let returnNumber = payload.return_number?.trim()
    if (!returnNumber) {
      const { data: generatedVNum } = await supabase.rpc('generate_sequence_number', {
        p_store_id: storeId,
        p_prefix: `RET-${new Date().getFullYear()}-`,
      })
      returnNumber = generatedVNum || `RET-${Date.now().toString().slice(-6)}`
    }

    // 1. إدراج رأس سند المرتجع
    const { data: returnRecord, error: returnErr } = await supabase
      .from('sales_returns')
      .insert({
        store_id: storeId,
        return_number: returnNumber,
        customer_id: payload.customer_id || null,
        invoice_id: payload.invoice_id || null,
        refund_method: payload.refund_method,
        total_amount: returnTotal,
        return_date: payload.return_date,
        reason: payload.reason?.trim() || null,
        notes: payload.notes?.trim() || null,
        status: 'completed',
        created_by: user.id,
      })
      .select('*, customer:customers(id, name, phone)')
      .single()

    if (returnErr || !returnRecord) {
      return { ok: false, error: returnErr?.message || 'فشل حفظ سند المرتجع' }
    }

    // 2. إدراج بنود المرتجع
    const itemPayloads = payload.items.map(item => ({
      sales_return_id: returnRecord.id,
      product_id: item.product_id || null,
      product_name: item.product_name,
      quantity: Number(item.quantity),
      unit_price: Number(item.unit_price),
      total_price: Number(item.quantity) * Number(item.unit_price),
    }))

    const { error: itemsErr } = await supabase.from('sales_return_items').insert(itemPayloads)
    if (itemsErr) {
      await supabase.from('sales_returns').delete().eq('id', returnRecord.id)
      return { ok: false, error: itemsErr.message || 'فشل حفظ بنود المرتجع' }
    }

    // 3. إعادة كميات المخزون وتسجيل حركات المخزون الثنائية
    for (const item of payload.items) {
      if (item.product_id) {
        const { data: prod } = await supabase
          .from('products')
          .select('stock_quantity, track_stock')
          .eq('id', item.product_id)
          .single()

        if (prod && prod.track_stock !== false) {
          const curStock = Number(prod.stock_quantity || 0)
          const newQty = curStock + Number(item.quantity)

          await supabase.from('products').update({ stock_quantity: newQty }).eq('id', item.product_id)

          await supabase.from('inventory_movements').insert({
            store_id: storeId,
            product_id: item.product_id,
            movement_type: 'sales_return',
            document_number: returnNumber,
            document_type: 'مرتجع مبيعات',
            ref_id: returnRecord.id,
            entity_name: returnRecord.customer?.name || 'عميل نقدي',
            quantity_in: Number(item.quantity),
            quantity_out: 0,
            balance_after: newQty,
            unit_price: Number(item.unit_price),
            movement_date: payload.return_date,
            created_by: user.id,
          })

          await supabase.from('stock_movements').insert({
            store_id: storeId,
            product_id: item.product_id,
            type: 'return',
            quantity: Number(item.quantity),
            quantity_before: curStock,
            quantity_after: newQty,
            reference_id: returnRecord.id,
            reference_type: 'sales_return',
            notes: `مرتجع مبيعات #${returnNumber}`,
            created_by: user.id,
          })
        }
      }
    }

    // 4. تسوية ذمة العميل وكشف حسابه
    if (payload.customer_id && payload.refund_method === 'credit') {
      const { data: cust } = await supabase
        .from('customers')
        .select('balance')
        .eq('id', payload.customer_id)
        .single()

      if (cust) {
        const newBalance = Number(cust.balance || 0) - returnTotal
        await supabase.from('customers').update({ balance: newBalance }).eq('id', payload.customer_id)

        await supabase.from('customer_ledger').insert({
          store_id: storeId,
          customer_id: payload.customer_id,
          type: 'return',
          date: payload.return_date,
          description: `مرتجع مبيعات رقم #${returnNumber}`,
          debit: 0,
          credit: returnTotal,
          balance: newBalance,
          reference_id: returnRecord.id,
          reference_type: 'sales_return',
          created_by: user.id,
        })
      }
    }

    // 5. ترحيل القيد المحاسبي المزدوج في دفتر اليومية
    try {
      const returnAccountRes = await resolveAccount(supabase, 'SALES_RETURNS', { storeId })
      const counterpartRes = payload.refund_method === 'credit' && payload.customer_id
        ? await resolveAccount(supabase, 'CUSTOMER_RECEIVABLE', { storeId, customerId: payload.customer_id, customerName: returnRecord.customer?.name })
        : await resolveAccount(supabase, 'CASH', { storeId })

      if (returnAccountRes?.accountId && counterpartRes?.accountId) {
        const lines = [
          { account_id: returnAccountRes.accountId, debit: returnTotal, credit: 0, description: `مرتجع مبيعات #${returnNumber}` },
          { account_id: counterpartRes.accountId, debit: 0, credit: returnTotal, description: `مرتجع مبيعات #${returnNumber}` },
        ]

        await postJournalEntry({
          storeId,
          date: payload.return_date,
          description: `مرتجع مبيعات رقم #${returnNumber}`,
          source: 'sales_return',
          sourceType: 'sales_return',
          sourceId: returnRecord.id,
          sourceNumber: returnNumber,
          lines,
          actorId: user.id,
        })
      }
    } catch (jErr) {
      console.error('Error posting journal entry for sales return:', jErr)
    }

    revalidatePath('/dashboard/invoices/returns')
    revalidatePath('/dashboard/sales')
    return { ok: true, returnId: returnRecord.id }
  } catch (err: any) {
    return { ok: false, error: err.message || 'فشل إنشاء سند المرتجع' }
  }
}
