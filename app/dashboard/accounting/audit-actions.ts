'use server'

import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import { logFinancialEvent, type AuditEntity, type AuditAction } from '@/lib/accounting/audit'

/**
 * غلاف server action لتسجيل عملية مالية في السجل من مكوّنات العميل.
 * يتحقق من الجلسة والعضوية ثم يكتب الصف عبر logFinancialEvent.
 */
export async function recordAuditEvent(input: {
  entityType:  AuditEntity
  entityId?:   string | null
  entityLabel?: string | null
  action:      AuditAction
  details?:    Record<string, unknown>
}): Promise<void> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  const storeId = await getStoreForUser(supabase, user.id)
  if (!storeId) return

  await logFinancialEvent({
    storeId,
    actorId:     user.id,
    entityType:  input.entityType,
    entityId:    input.entityId,
    entityLabel: input.entityLabel,
    action:      input.action,
    details:     input.details,
  })
}
