-- ==========================================
-- Migration 026: تقييم خدمة الدعم بعد حلّ التذكرة
-- نجوم 1..5 + ملاحظة اختيارية — يُسجَّل عند الحل/الإغلاق
-- ==========================================
SET search_path = public;

ALTER TABLE public.support_tickets
  ADD COLUMN IF NOT EXISTS rating      SMALLINT CHECK (rating BETWEEN 1 AND 5),
  ADD COLUMN IF NOT EXISTS rating_note TEXT,
  ADD COLUMN IF NOT EXISTS rated_at    TIMESTAMPTZ;
