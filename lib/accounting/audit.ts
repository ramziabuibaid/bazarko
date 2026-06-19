import { createClient } from '@/lib/supabase/server'

export type AuditEntity = 'invoice' | 'voucher' | 'cash_movement' | 'cash_session'
export type AuditAction = 'create' | 'update' | 'delete' | 'status_change' | 'payment' | 'cancel'

interface LogParams {
  storeId:     string
  entityType:  AuditEntity
  entityId?:   string | null
  entityLabel?: string | null
  action:      AuditAction
  actorId?:    string | null
  actorName?:  string | null
  details?:    Record<string, unknown>
}

/**
 * يسجّل عملية مالية في financial_audit_log.
 * يبتلع الأخطاء بهدوء — فشل التسجيل يجب ألا يُفشل العملية الأصلية.
 */
export async function logFinancialEvent(params: LogParams): Promise<void> {
  try {
    const supabase = createClient()

    let actorName = params.actorName ?? null
    if (!actorName && params.actorId) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', params.actorId)
        .maybeSingle()
      actorName = profile?.full_name ?? null
    }

    await supabase.from('financial_audit_log').insert({
      store_id:     params.storeId,
      entity_type:  params.entityType,
      entity_id:    params.entityId ?? null,
      entity_label: params.entityLabel ?? null,
      action:       params.action,
      actor_id:     params.actorId ?? null,
      actor_name:   actorName,
      details:      params.details ?? {},
    })
  } catch {
    // تجاهل بهدوء
  }
}
