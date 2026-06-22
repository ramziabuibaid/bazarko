'use client'

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

/** معلومات الجهاز التي يعرفها المتصفح فقط (الباقي — IP/UA — يُضاف خادمياً). */
function clientInfo(): Record<string, string> {
  try {
    return {
      screen:    `${window.screen.width}x${window.screen.height}`,
      viewport:  `${window.innerWidth}x${window.innerHeight}`,
      language:  navigator.language,
      timezone:  Intl.DateTimeFormat().resolvedOptions().timeZone,
      userAgent: navigator.userAgent,
    }
  } catch {
    return {}
  }
}

/**
 * يسجّل حدث نشاط للموظف الحالي عبر /api/activity (ليلتقط الخادمُ الـ IP الحقيقي
 * ومعلومات الجهاز). يبتلع الأخطاء بهدوء — التتبّع يجب ألّا يُعطّل عمل الموظف.
 */
export function trackActivity(storeId: string, params: TrackParams): void {
  try {
    const ci = clientInfo()
    const payload = JSON.stringify({
      storeId,
      sessionId:   getStaffSessionId(),
      kind:        params.kind,
      action:      params.action      ?? null,
      entityType:  params.entityType  ?? null,
      entityId:    params.entityId    ?? null,
      entityLabel: params.entityLabel ?? null,
      pagePath:    params.pagePath ?? (typeof window !== 'undefined' ? window.location.pathname : null),
      details:     params.details     ?? {},
      userAgent:   ci.userAgent,
      client:      ci,
    })

    // عند إغلاق التبويب نستخدم sendBeacon لضمان الإرسال؛ غير ذلك fetch مع keepalive.
    if (params.kind === 'session_end' && typeof navigator !== 'undefined' && navigator.sendBeacon) {
      navigator.sendBeacon('/api/activity', new Blob([payload], { type: 'application/json' }))
      return
    }

    fetch('/api/activity', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    payload,
      keepalive: true,
    }).catch(() => {})
  } catch {
    /* تجاهل بهدوء */
  }
}

/**
 * اختصار لتسجيل فعل (إنشاء/تعديل/حذف…) على عنصر.
 * استدعِه بعد نجاح عملية الكتابة في Supabase.
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
