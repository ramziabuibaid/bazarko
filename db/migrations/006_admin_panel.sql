-- ==========================================
-- Migration 006: Admin Panel (لوحة مالك النظام)
-- ==========================================
SET search_path = public;

-- ─────────────────────────────────────────────────
-- 1. إضافة is_admin لجدول profiles
-- ─────────────────────────────────────────────────
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false;

-- ─────────────────────────────────────────────────
-- 2. إضافة حالة المتجر (active/suspended)
-- ─────────────────────────────────────────────────
ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ;
ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS suspended_reason TEXT;
ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'free'
  CHECK (plan IN ('free', 'basic', 'pro'));
ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS plan_expires_at DATE;

-- ─────────────────────────────────────────────────
-- 3. دالة مساعدة: هل المستخدم مالك النظام؟
-- ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT is_admin FROM public.profiles WHERE id = auth.uid()),
    false
  );
$$;
