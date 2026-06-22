import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// يستقبل أحداث نشاط الموظف من المتصفح، يضيف IP الحقيقي + معلومات الجهاز،
// ثم يكتبها عبر RPC log_staff_activity (الذي يتحقق من العضوية ويملأ هوية المنفّذ).

/** استخراج أول IP عام من سلسلة x-forwarded-for. */
function clientIp(req: NextRequest): string | null {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0]!.trim()
  return req.headers.get('x-real-ip') ?? req.headers.get('cf-connecting-ip') ?? null
}

/** اشتقاق المتصفح/النظام/نوع الجهاز من User-Agent (بلا اعتماديات). */
function parseUA(ua: string): { browser: string; os: string; device: string } {
  let browser = 'غير معروف'
  if (/edg/i.test(ua)) browser = 'Edge'
  else if (/opr|opera/i.test(ua)) browser = 'Opera'
  else if (/chrome|crios/i.test(ua)) browser = 'Chrome'
  else if (/firefox|fxios/i.test(ua)) browser = 'Firefox'
  else if (/safari/i.test(ua)) browser = 'Safari'

  let os = 'غير معروف'
  if (/windows/i.test(ua)) os = 'Windows'
  else if (/android/i.test(ua)) os = 'Android'
  else if (/iphone|ipad|ipod/i.test(ua)) os = 'iOS'
  else if (/mac os/i.test(ua)) os = 'macOS'
  else if (/linux/i.test(ua)) os = 'Linux'

  let device = 'desktop'
  if (/ipad|tablet/i.test(ua)) device = 'tablet'
  else if (/mobile|android|iphone/i.test(ua)) device = 'mobile'

  return { browser, os, device }
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 })
  }

  const storeId = body.storeId as string | undefined
  const sessionId = body.sessionId as string | undefined
  const kind = body.kind as string | undefined
  if (!storeId || !sessionId || !kind) {
    return NextResponse.json({ ok: false }, { status: 400 })
  }

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false }, { status: 401 })

  const ua = req.headers.get('user-agent') ?? (body.userAgent as string | undefined) ?? ''
  const { browser, os, device } = parseUA(ua)
  const client = (body.client ?? {}) as Record<string, string | undefined>

  // فشل التسجيل يجب ألّا يُعطّل أي شيء — نبتلع الأخطاء.
  await supabase.rpc('log_staff_activity', {
    p_store_id:     storeId,
    p_session_id:   sessionId,
    p_kind:         kind,
    p_action:       (body.action as string | undefined) ?? null,
    p_entity_type:  (body.entityType as string | undefined) ?? null,
    p_entity_id:    (body.entityId as string | undefined) ?? null,
    p_entity_label: (body.entityLabel as string | undefined) ?? null,
    p_page_path:    (body.pagePath as string | undefined) ?? null,
    p_details:      body.details ?? {},
    p_is_mobile:    device !== 'desktop',
    p_ip_address:   clientIp(req),
    p_user_agent:   ua || null,
    p_browser:      browser,
    p_os:           os,
    p_device_type:  device,
    p_screen:       client.screen ?? null,
    p_viewport:     client.viewport ?? null,
    p_language:     client.language ?? null,
    p_timezone:     client.timezone ?? null,
  })

  return NextResponse.json({ ok: true })
}
