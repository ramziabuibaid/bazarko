-- ==========================================
-- Migration 025: تتبّع نشاط الموظفين داخل لوحة التحكم
--   (الوقت الفعلي + التنقّل + كل الأفعال + كشف اللصق)
--   يكمّل financial_audit_log (المالية) ويغطّي كل الوحدات الأخرى.
-- ==========================================
SET search_path = public;

-- ─────────────────────────────────────────────────
-- 1. جدول أحداث نشاط الموظف
--    kind:
--      session_start | heartbeat | session_end   → حساب الوقت الفعلي
--      page_view                                 → خريطة التنقّل داخل اللوحة
--      action                                    → إنشاء/تعديل/حذف… (مع before/after)
--      paste                                     → لصق نص طويل (مؤشر AI/نسخ)
-- ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.staff_activity (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id     UUID        NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  actor_id     UUID        REFERENCES auth.users(id),
  actor_name   TEXT,                                    -- snapshot لاسم المنفّذ وقت الحدث
  session_id   TEXT        NOT NULL,                    -- UUID في sessionStorage (جلسة تبويب واحدة)
  kind         TEXT        NOT NULL
               CHECK (kind IN ('session_start','heartbeat','session_end','page_view','action','paste')),
  action       TEXT        CHECK (action IN ('create','update','delete','status_change','login','logout','view','export','import')),
  entity_type  TEXT,                                    -- product | category | order | offer | customer | repair | settings | ...
  entity_id    UUID,
  entity_label TEXT,                                    -- اسم/رقم العنصر للعرض السريع
  page_path    TEXT,                                    -- /dashboard/products/...
  details      JSONB       NOT NULL DEFAULT '{}'::jsonb,-- before/after أو معلومات إضافية (مثلاً عدد أحرف اللصق)
  is_mobile    BOOLEAN     NOT NULL DEFAULT false,
  -- معلومات الجهاز والشبكة (تُملأ خادمياً عبر /api/activity)
  ip_address   TEXT,                                    -- IP العام للموظف (من x-forwarded-for)
  user_agent   TEXT,                                    -- سلسلة User-Agent الكاملة
  browser      TEXT,                                    -- Chrome / Safari / Firefox ...
  os           TEXT,                                    -- Windows / Android / iOS / macOS ...
  device_type  TEXT,                                    -- desktop / mobile / tablet
  screen       TEXT,                                    -- دقة الشاشة "1920x1080"
  viewport     TEXT,                                    -- حجم النافذة "1440x780"
  language     TEXT,                                    -- لغة المتصفح
  timezone     TEXT,                                    -- المنطقة الزمنية للجهاز
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- توافق مع النسخة الأولى من الجدول (إن كانت طُبّقت بدون أعمدة الجهاز/الشبكة)
ALTER TABLE public.staff_activity ADD COLUMN IF NOT EXISTS ip_address  TEXT;
ALTER TABLE public.staff_activity ADD COLUMN IF NOT EXISTS user_agent  TEXT;
ALTER TABLE public.staff_activity ADD COLUMN IF NOT EXISTS browser     TEXT;
ALTER TABLE public.staff_activity ADD COLUMN IF NOT EXISTS os          TEXT;
ALTER TABLE public.staff_activity ADD COLUMN IF NOT EXISTS device_type TEXT;
ALTER TABLE public.staff_activity ADD COLUMN IF NOT EXISTS screen      TEXT;
ALTER TABLE public.staff_activity ADD COLUMN IF NOT EXISTS viewport    TEXT;
ALTER TABLE public.staff_activity ADD COLUMN IF NOT EXISTS language    TEXT;
ALTER TABLE public.staff_activity ADD COLUMN IF NOT EXISTS timezone    TEXT;

CREATE INDEX IF NOT EXISTS idx_staff_activity_store        ON public.staff_activity(store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_staff_activity_actor        ON public.staff_activity(store_id, actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_staff_activity_session      ON public.staff_activity(session_id);
CREATE INDEX IF NOT EXISTS idx_staff_activity_kind         ON public.staff_activity(store_id, kind, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_staff_activity_ip           ON public.staff_activity(store_id, ip_address);

ALTER TABLE public.staff_activity ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff_activity_select" ON public.staff_activity;
DROP POLICY IF EXISTS "staff_activity_insert" ON public.staff_activity;

-- القراءة: أعضاء المتجر + مالك النظام (super admin) لتقرير لوحة الأدمن
CREATE POLICY "staff_activity_select" ON public.staff_activity
  FOR SELECT USING (is_store_member(store_id) OR is_platform_admin());

-- الإدراج: أعضاء المتجر فقط (الكتابة الفعلية تمرّ عبر RPC أدناه)
CREATE POLICY "staff_activity_insert" ON public.staff_activity
  FOR INSERT WITH CHECK (is_store_member(store_id));

-- لا UPDATE / DELETE — السجل غير قابل للتلاعب من الموظف.

-- ─────────────────────────────────────────────────
-- 2. RPC لتسجيل الحدث — SECURITY DEFINER
--    يملأ actor_id/actor_name تلقائياً من الجلسة، ويتحقق من العضوية.
-- ─────────────────────────────────────────────────
-- إسقاط التوقيع القديم (10 معاملات) إن وُجد من نسخة سابقة — تفادياً لـ overload مزدوج
DROP FUNCTION IF EXISTS public.log_staff_activity(
  uuid, text, text, text, text, uuid, text, text, jsonb, boolean
);

CREATE OR REPLACE FUNCTION public.log_staff_activity(
  p_store_id     uuid,
  p_session_id   text,
  p_kind         text,
  p_action       text    DEFAULT NULL,
  p_entity_type  text    DEFAULT NULL,
  p_entity_id    uuid    DEFAULT NULL,
  p_entity_label text    DEFAULT NULL,
  p_page_path    text    DEFAULT NULL,
  p_details      jsonb   DEFAULT '{}'::jsonb,
  p_is_mobile    boolean DEFAULT false,
  p_ip_address   text    DEFAULT NULL,
  p_user_agent   text    DEFAULT NULL,
  p_browser      text    DEFAULT NULL,
  p_os           text    DEFAULT NULL,
  p_device_type  text    DEFAULT NULL,
  p_screen       text    DEFAULT NULL,
  p_viewport     text    DEFAULT NULL,
  p_language     text    DEFAULT NULL,
  p_timezone     text    DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_name text;
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;

  -- المنفّذ يجب أن يكون عضواً نشطاً في المتجر
  IF NOT EXISTS (
    SELECT 1 FROM store_members
    WHERE store_id = p_store_id AND profile_id = v_uid AND is_active
  ) THEN
    RETURN;
  END IF;

  SELECT full_name INTO v_name FROM profiles WHERE id = v_uid;

  INSERT INTO staff_activity(
    store_id, actor_id, actor_name, session_id, kind, action,
    entity_type, entity_id, entity_label, page_path, details, is_mobile,
    ip_address, user_agent, browser, os, device_type, screen, viewport, language, timezone
  ) VALUES (
    p_store_id, v_uid, v_name, p_session_id, p_kind, p_action,
    p_entity_type, p_entity_id, p_entity_label, p_page_path,
    COALESCE(p_details, '{}'::jsonb), p_is_mobile,
    p_ip_address, p_user_agent, p_browser, p_os, p_device_type,
    p_screen, p_viewport, p_language, p_timezone
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.log_staff_activity(
  uuid, text, text, text, text, uuid, text, text, jsonb, boolean,
  text, text, text, text, text, text, text, text, text
) TO authenticated;
