'use server'

import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import { requireStorePermission } from '@/lib/supabase/permissions'
import { revalidatePath } from 'next/cache'

export interface UpdatePurchaseInput {
  invoice_date: string
  due_date?: string | null
  supplier_id: string
  supplier_number?: string | null
  discount: number
  notes?: string | null
  items: {
    product_id: string
    quantity: number
    unit_price: number
    notes?: string | null
  }[]
}

export async function updatePurchaseInvoice(
  purchaseId: string,
  input: UpdatePurchaseInput
): Promise<{ ok: boolean; error?: string; data?: any }> {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { ok: false, error: 'غير مصرح؛ يرجى تسجيل الدخول' }

    const storeId = await getStoreForUser(supabase, user.id)
    if (!storeId) return { ok: false, error: 'المتجر غير موجود' }

    await requireStorePermission(storeId, 'purchases.write')

    if (!input || !Array.isArray(input.items) || input.items.length === 0) {
      return { ok: false, error: 'يجب إضافة بند واحد على الأقل' }
    }

    const { data, error } = await supabase.rpc('update_purchase_invoice_atomic', {
      p_store_id: storeId,
      p_invoice_id: purchaseId,
      p_payload: input,
    })

    if (error) {
      console.error('Error in update_purchase_invoice_atomic RPC:', error)
      return { ok: false, error: error.message || 'فشل تعديل الفاتورة' }
    }

    try {
      for (const path of [
        '/dashboard/purchases',
        `/dashboard/purchases/${purchaseId}`,
        `/dashboard/purchases/${purchaseId}/edit`,
        '/dashboard/products',
        '/dashboard/inventory',
        '/dashboard/suppliers',
        '/dashboard/accounting/journal',
        '/dashboard/accounting/reports',
      ]) {
        revalidatePath(path)
      }
    } catch {}

    return { ok: true, data }
  } catch (err: any) {
    console.error('Exception in updatePurchaseInvoice:', err)
    return { ok: false, error: err?.message || 'حدث خطأ غير متوقع أثناء تعديل الفاتورة' }
  }
}
