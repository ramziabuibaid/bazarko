'use client'

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import { trackActivity } from '@/lib/activity/track'

const HEARTBEAT_MS = 30_000   // نبضة كل 30 ثانية أثناء النشاط
const IDLE_MS      = 60_000   // بعد دقيقة بلا تفاعل يُعتبر خاملاً (لا نبضة)
const PASTE_MIN    = 40       // أدنى طول للصق نعتبره جديراً بالتسجيل

/**
 * يتتبّع نشاط الموظف داخل لوحة التحكم:
 *  - بداية/نهاية الجلسة + نبضات → حساب الوقت الفعلي النشط (لا مجرد فتح التبويب)
 *  - مشاهدة كل صفحة → خريطة أين يقضي وقته
 *  - لصق النصوص الطويلة → مؤشر اعتماد على نسخ/ذكاء صناعي
 *
 * يُركّب مرة واحدة داخل DashboardShell.
 */
export default function StaffActivityTracker({ storeId }: { storeId: string }) {
  const pathname = usePathname()
  const lastActiveRef = useRef<number>(Date.now())

  // بداية الجلسة (مرة واحدة لكل تبويب)
  useEffect(() => {
    try {
      if (!sessionStorage.getItem('bz_staff_session_started')) {
        sessionStorage.setItem('bz_staff_session_started', '1')
        trackActivity(storeId, { kind: 'session_start', action: 'login' })
      }
    } catch {
      trackActivity(storeId, { kind: 'session_start', action: 'login' })
    }
  }, [storeId])

  // تسجيل النشاط الأخير عند أي تفاعل (لكشف الخمول)
  useEffect(() => {
    const mark = () => { lastActiveRef.current = Date.now() }
    const evs: (keyof DocumentEventMap)[] = ['mousedown', 'keydown', 'mousemove', 'scroll', 'touchstart']
    evs.forEach(e => document.addEventListener(e, mark, { passive: true }))
    return () => evs.forEach(e => document.removeEventListener(e, mark))
  }, [])

  // نبضات أثناء النشاط فقط
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== 'visible') return
      if (Date.now() - lastActiveRef.current > IDLE_MS) return
      trackActivity(storeId, { kind: 'heartbeat' })
    }
    const id = setInterval(tick, HEARTBEAT_MS)
    return () => clearInterval(id)
  }, [storeId])

  // نهاية الجلسة عند إغلاق/إخفاء التبويب (أفضل جهد ممكن)
  useEffect(() => {
    const end = () => {
      if (document.visibilityState === 'hidden') {
        trackActivity(storeId, { kind: 'session_end', action: 'logout' })
      }
    }
    document.addEventListener('visibilitychange', end)
    window.addEventListener('pagehide', () =>
      trackActivity(storeId, { kind: 'session_end', action: 'logout' })
    )
    return () => document.removeEventListener('visibilitychange', end)
  }, [storeId])

  // كشف اللصق الطويل في الحقول النصية
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const text = e.clipboardData?.getData('text') ?? ''
      if (text.length < PASTE_MIN) return
      const target = e.target as HTMLElement | null
      const field =
        target && 'name' in target ? (target as HTMLInputElement).name :
        target?.getAttribute?.('aria-label') ?? target?.tagName?.toLowerCase()
      trackActivity(storeId, {
        kind: 'paste',
        details: { length: text.length, field: field ?? null, path: window.location.pathname },
      })
    }
    document.addEventListener('paste', onPaste, true)
    return () => document.removeEventListener('paste', onPaste, true)
  }, [storeId])

  // مشاهدة الصفحة عند كل تغيّر مسار
  useEffect(() => {
    if (!pathname) return
    trackActivity(storeId, { kind: 'page_view', pagePath: pathname })
  }, [storeId, pathname])

  return null
}
