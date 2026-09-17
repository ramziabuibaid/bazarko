-- ==============================================================================
-- Migration 041: Accounting Periods (Period Lock) and Anti-Duplication Integrity
-- ==============================================================================
SET search_path = public;

-- 1. جدول الفترات المحاسبية وإغلاق الفترة (Accounting Periods Lock)
CREATE TABLE IF NOT EXISTS public.accounting_periods (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id     UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  period_name  TEXT NOT NULL,
  start_date   DATE NOT NULL,
  end_date     DATE NOT NULL,
  is_closed    BOOLEAN NOT NULL DEFAULT FALSE,
  closed_at    TIMESTAMPTZ,
  closed_by    UUID REFERENCES public.profiles(id),
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(store_id, start_date, end_date)
);

CREATE INDEX IF NOT EXISTS idx_accounting_periods_store ON public.accounting_periods(store_id, start_date, end_date);

-- تفعيل RLS على الفترات المحاسبية
ALTER TABLE public.accounting_periods ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "accounting_periods_store_member" ON public.accounting_periods;
CREATE POLICY "accounting_periods_store_member" ON public.accounting_periods
  FOR ALL USING (is_store_member(store_id));

-- 2. قيود منع التكرار البرمجية والفعلية على مستوى قاعدة البيانات
-- منع تكرار رقم الفاتورة داخل نفس المتجر
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_invoices_store_number'
  ) THEN
    -- تنظيف أية تكرارات سابقة إن وجدت قبل وضع القيد أو استخدام INDEX فريد
    CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_store_number ON public.invoices(store_id, invoice_number);
  END IF;
END $$;

-- منع تكرار رقم السند داخل نفس المتجر ونفس النوع (قبض/صرف)
DO $$
BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS uq_vouchers_store_type_number ON public.vouchers(store_id, type, voucher_number);
END $$;

-- منع تكرار رقم الشيك لنفس البنك والمتجر
DO $$
BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS uq_checks_store_bank_number ON public.checks(store_id, type, bank_name, check_number);
END $$;

-- منع تكرار رقم فاتورة الشراء للمتجر والمورد
DO $$
BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS uq_purchase_invoices_store_num ON public.purchase_invoices(store_id, invoice_number);
END $$;
