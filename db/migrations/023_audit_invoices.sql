-- ==========================================
-- Migration 023: سجل العمليات المالية + تحسين حالات الفاتورة
-- ==========================================
SET search_path = public;

-- ─────────────────────────────────────────────────
-- 1. توسيع حالات الفاتورة: إضافة 'partial' (مدفوعة جزئياً)
--    حالة 'overdue' (متأخرة) تُحسب في الواجهة من due_date + المتبقّي
-- ─────────────────────────────────────────────────
ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_status_check;
ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_status_check
  CHECK (status IN ('draft','sent','partial','paid','cancelled'));

-- تاريخ السداد الكامل (للتقارير وسجل العمليات)
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_invoices_due_date ON public.invoices(store_id, due_date);
CREATE INDEX IF NOT EXISTS idx_invoices_status   ON public.invoices(store_id, status);

-- ─────────────────────────────────────────────────
-- 2. سجل العمليات المالية — من فعل ماذا ومتى
--    يُكتب من Server Actions عند إنشاء/تعديل/حذف/تغيير حالة فاتورة أو سند
-- ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.financial_audit_log (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id     UUID        NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  entity_type  TEXT        NOT NULL
               CHECK (entity_type IN ('invoice','voucher','cash_movement','cash_session')),
  entity_id    UUID,
  entity_label TEXT,        -- رقم الفاتورة/السند للعرض السريع (INV-0001)
  action       TEXT        NOT NULL
               CHECK (action IN ('create','update','delete','status_change','payment','cancel')),
  actor_id     UUID        REFERENCES auth.users(id),
  actor_name   TEXT,        -- اسم المنفّذ وقت العملية (snapshot)
  details      JSONB       NOT NULL DEFAULT '{}'::jsonb,  -- before/after أو ملخص التغيير
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fin_audit_store   ON public.financial_audit_log(store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fin_audit_entity  ON public.financial_audit_log(entity_type, entity_id);

ALTER TABLE public.financial_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "store_member_fin_audit_select" ON public.financial_audit_log;
DROP POLICY IF EXISTS "store_member_fin_audit_insert" ON public.financial_audit_log;

-- القراءة لأعضاء المتجر
CREATE POLICY "store_member_fin_audit_select" ON public.financial_audit_log
  FOR SELECT USING (is_store_member(store_id));

-- الإدراج لأعضاء المتجر (لا تعديل/حذف — السجل غير قابل للتلاعب)
CREATE POLICY "store_member_fin_audit_insert" ON public.financial_audit_log
  FOR INSERT WITH CHECK (is_store_member(store_id));
