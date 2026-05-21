-- ==========================================
-- Migration 005: Repair Jobs (نظام الصيانة)
-- ==========================================
SET search_path = public;

-- ─────────────────────────────────────────────────
-- 1. طلبات الصيانة
-- ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.repair_jobs (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id         UUID        NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  job_number       TEXT        NOT NULL,

  -- الزبون
  customer_id      UUID        REFERENCES public.customers(id),
  customer_name    TEXT        NOT NULL,
  customer_phone   TEXT,

  -- الجهاز
  device_type      TEXT        NOT NULL DEFAULT 'other'
                   CHECK (device_type IN ('phone','laptop','tablet','tv','printer','camera','appliance','other')),
  brand            TEXT,
  model            TEXT,
  serial_number    TEXT,
  color            TEXT,
  condition_notes  TEXT,        -- حالة الجهاز عند الاستلام (خدوش، كسر...)

  -- العطل والعمل
  problem_desc     TEXT        NOT NULL,
  diagnosis        TEXT,        -- تشخيص الفني
  work_done        TEXT,        -- العمل المنجز

  -- الحالة والأولوية
  status           TEXT        NOT NULL DEFAULT 'received'
                   CHECK (status IN ('received','diagnosing','in_repair','waiting_parts','ready','delivered','cancelled')),
  priority         TEXT        NOT NULL DEFAULT 'normal'
                   CHECK (priority IN ('normal','urgent')),

  -- المالية
  estimated_cost   NUMERIC(12,2),
  final_cost       NUMERIC(12,2) NOT NULL DEFAULT 0,
  deposit_paid     NUMERIC(12,2) NOT NULL DEFAULT 0,

  -- التواريخ
  received_at      DATE        NOT NULL DEFAULT CURRENT_DATE,
  estimated_done   DATE,
  delivered_at     DATE,

  -- الفني
  assigned_to      TEXT,

  -- الربط بالفاتورة
  invoice_id       UUID        REFERENCES public.invoices(id),

  -- ملاحظات داخلية
  internal_notes   TEXT,

  created_by       UUID        REFERENCES auth.users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(store_id, job_number)
);

-- ─────────────────────────────────────────────────
-- 2. قطع الغيار المستخدمة
-- ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.repair_job_parts (
  id         UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id     UUID          NOT NULL REFERENCES public.repair_jobs(id) ON DELETE CASCADE,
  product_id UUID          REFERENCES public.products(id),
  name       TEXT          NOT NULL,
  quantity   NUMERIC(10,2) NOT NULL DEFAULT 1,
  unit_cost  NUMERIC(12,2) NOT NULL DEFAULT 0,
  total      NUMERIC(12,2) NOT NULL DEFAULT 0
);

-- ─────────────────────────────────────────────────
-- 3. سجل تغييرات الحالة (Audit Trail)
-- ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.repair_job_history (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id      UUID        NOT NULL REFERENCES public.repair_jobs(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status   TEXT        NOT NULL,
  note        TEXT,
  changed_by  UUID        REFERENCES auth.users(id),
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────
-- 4. RLS
-- ─────────────────────────────────────────────────
ALTER TABLE public.repair_jobs         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.repair_job_parts    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.repair_job_history  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "store_member_repair_jobs"    ON public.repair_jobs;
DROP POLICY IF EXISTS "public_read_repair_jobs"     ON public.repair_jobs;
DROP POLICY IF EXISTS "store_member_repair_parts"   ON public.repair_job_parts;
DROP POLICY IF EXISTS "store_member_repair_history" ON public.repair_job_history;

-- الموظفون: صلاحية كاملة
CREATE POLICY "store_member_repair_jobs" ON public.repair_jobs
  FOR ALL USING (is_store_member(store_id));

-- الزبون: قراءة فقط لتتبع جهازه (بدون تسجيل دخول)
CREATE POLICY "public_read_repair_jobs" ON public.repair_jobs
  FOR SELECT USING (true);

CREATE POLICY "store_member_repair_parts" ON public.repair_job_parts
  FOR ALL USING (
    job_id IN (SELECT id FROM public.repair_jobs WHERE is_store_member(store_id))
  );

CREATE POLICY "store_member_repair_history" ON public.repair_job_history
  FOR ALL USING (
    job_id IN (SELECT id FROM public.repair_jobs WHERE is_store_member(store_id))
  );
