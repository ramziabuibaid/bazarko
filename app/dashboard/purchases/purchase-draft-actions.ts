'use server'

import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import { revalidatePath } from 'next/cache'

export async function postPurchaseDraft(storeId: string, purchaseId: string): Promise<{ ok: boolean; error?: string }> {
  const c = createClient()
  const { data: { user } } = await c.auth.getUser()
  if (!user || await getStoreForUser(c, user.id) !== storeId) {
    return { ok: false, error: 'المتجر غير مصرح به' }
  }

  try {
    const { data, error } = await c.rpc('post_purchase_invoice_atomic', {
      p_store_id: storeId,
      p_invoice_id: purchaseId,
    })

    if (error) {
      return { ok: false, error: error.message }
    }

    if (!data?.ok) {
      return { ok: false, error: 'تعذر اعتماد الفاتورة' }
    }

    try {
      for (const path of [
        '/dashboard/purchases',
        `/dashboard/purchases/${purchaseId}`,
        '/dashboard/products',
        '/dashboard/inventory',
        '/dashboard/suppliers',
        '/dashboard/accounting/journal',
        '/dashboard/accounting/payments',
      ]) {
        revalidatePath(path)
      }
    } catch {}

    return { ok: true }
  } catch (err: any) {
    return { ok: false, error: err?.message || 'تعذر الاتصال بالسيرفر' }
  }
}

export async function cancelPurchaseDraft(storeId: string, purchaseId: string): Promise<{ ok: boolean; error?: string }> {
  const c = createClient()
  const { data: { user } } = await c.auth.getUser()
  if (!user || await getStoreForUser(c, user.id) !== storeId) {
    return { ok: false, error: 'المتجر غير مصرح به' }
  }

  try {
    const { data, error } = await c.rpc('cancel_purchase_invoice_draft', {
      p_store_id: storeId,
      p_invoice_id: purchaseId,
    })

    if (error) {
      return { ok: false, error: error.message }
    }

    if (!data?.ok) {
      return { ok: false, error: 'تعذر إلغاء المسودة' }
    }

    try {
      for (const path of [
        '/dashboard/purchases',
        `/dashboard/purchases/${purchaseId}`,
      ]) {
        revalidatePath(path)
      }
    } catch {}

    return { ok: true }
  } catch (err: any) {
    return { ok: false, error: err?.message || 'تعذر الاتصال بالسيرفر' }
  }
}
