'use client'

import { createClient } from '@/lib/supabase/client'

export type ActivityKind = 'session_start' | 'heartbeat' | 'session_end' | 'page_view' | 'action' | 'paste'
export type ActivityAction =
  | 'create' | 'update' | 'delete' | 'status_change'
  | 'login' | 'logout' | 'view' | 'export' | 'import'

export interface TrackParams {
  kind:         ActivityKind
  action?:      ActivityAction
  entityType?:  string
  entityId?:    string | null
  entityLabel?: string | null
  pagePath?:    string | null
  details?:     Record<string, unknown>
}

/** UUID ثابت لكل جلسة تبويب (window) — يميّز فترة عمل واحدة لحساب الوقت. */
export function getStaffSessionId(): string {
  try {
    let sid = sessionStorage.getItem('bz_staff_session')
    if (!sid) {
      sid = crypto.randomUUID()
      sessionStorage.setItem('bz_staff_session', sid)
    }
    return sid
  } catch {
    return 'unknown'
  }
}

function isMobile(): boolean {
  try {
    return /Mobi|Android/i.test(navigator.userAgent)
  } catch {
    return false
  }
}

/**
 * يسجّل حدث نشاط للموظف الحالي. يبتلع الأخطاء بهدوء —
 * فشل التتبّع يجب ألّا يُعطّل عمل الموظف.
 */
export function trackActivity(storeId: string, params: TrackParams): void {
  try {
    createClient()
      .rpc('log_staff_activity', {
        p_store_id:     storeId,
        p_session_id:   getStaffSessionId(),
        p_kind:         params.kind,
        p_action:       params.action      ?? null,
        p_entity_type:  params.entityType  ?? null,
        p_entity_id:    params.entityId    ?? null,
        p_entity_label: params.entityLabel ?? null,
        p_page_path:    params.pagePath ?? (typeof window !== 'undefined' ? window.location.pathname : null),
        p_details:      params.details     ?? {},
        p_is_mobile:    isMobile(),
      })
      .then(({ error }: { error: { message: string } | null }) => {
        if (error) console.error('[activity] log_staff_activity failed:', error.message)
      })
  } catch {
    /* تجاهل بهدوء */
  }
}

/**
 * اختصار لتسجيل فعل (إنشاء/تعديل/حذف…) على عنصر.
 * استدعِه بعد نجاح عملية الكتابة في Supabase.
 *
 * مثال:
 *   trackAction(storeId, { action: 'update', entityType: 'product',
 *     entityId: id, entityLabel: name, details: { changed: ['price'] } })
 */
export function trackAction(
  storeId: string,
  a: {
    action:       ActivityAction
    entityType:   string
    entityId?:    string | null
    entityLabel?: string | null
    details?:     Record<string, unknown>
  }
): void {
  trackActivity(storeId, { kind: 'action', ...a })
}

/**
 * يحسب قائمة الحقول التي تغيّرت بين نسختين (للتمييز: تعديل سعر فقط أم إعادة كتابة كاملة).
 * يُستخدم في details.changed لقياس "حجم" التعديل.
 */
export function diffFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>
): string[] {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])
  const changed: string[] = []
  for (const k of keys) {
    if (JSON.stringify(before?.[k]) !== JSON.stringify(after?.[k])) changed.push(k)
  }
  return changed
}
