-- ==============================================================================
-- Migration 038: Invoice Enhancements (Payment Method, Discount Type, Logo/Stock)
-- ==============================================================================
SET search_path = public;

DO $$
BEGIN
  -- 1. إضافة طريقة الدفع للفاتورة (نقداً / آجل على الحساب / بنك / شيك / بطاقة)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'invoices' AND column_name = 'payment_method'
  ) THEN
    ALTER TABLE public.invoices ADD COLUMN payment_method TEXT NOT NULL DEFAULT 'cash'
      CHECK (payment_method IN ('cash', 'credit', 'bank', 'check', 'card', 'transfer'));
  END IF;

  -- 2. إضافة نوع وقيمة الخصم (مبلغ ثابت أو نسبة مئوية)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'invoices' AND column_name = 'discount_type'
  ) THEN
    ALTER TABLE public.invoices ADD COLUMN discount_type TEXT NOT NULL DEFAULT 'amount'
      CHECK (discount_type IN ('amount', 'percent'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'invoices' AND column_name = 'discount_value'
  ) THEN
    ALTER TABLE public.invoices ADD COLUMN discount_value NUMERIC(12,2) NOT NULL DEFAULT 0;
  END IF;

  -- 3. إضافة رابط عرض السعر المحول
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'invoices' AND column_name = 'quotation_id'
  ) THEN
    ALTER TABLE public.invoices ADD COLUMN quotation_id UUID REFERENCES public.quotations(id) ON DELETE SET NULL;
  END IF;
END $$;
