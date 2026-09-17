-- ==============================================================================
-- Migration 040: Vouchers Split Payment Methods (Cash, Cheques, Cash+Cheques),
-- Cash Boxes, and Optional Invoice/Purchase Decoupling
-- ==============================================================================
SET search_path = public;

DO $$
BEGIN
  -- 1. المبالغ المفصلة (نقدي / شيكات)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'vouchers' AND column_name = 'cash_amount'
  ) THEN
    ALTER TABLE public.vouchers ADD COLUMN cash_amount NUMERIC(14,2) DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'vouchers' AND column_name = 'checks_amount'
  ) THEN
    ALTER TABLE public.vouchers ADD COLUMN checks_amount NUMERIC(14,2) DEFAULT 0;
  END IF;

  -- 2. مصفوفة بيانات الشيكات المرفقة بالسند
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'vouchers' AND column_name = 'checks_data'
  ) THEN
    ALTER TABLE public.vouchers ADD COLUMN checks_data JSONB DEFAULT '[]'::jsonb;
  END IF;

  -- 3. صندوق القبض / الصرف
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'vouchers' AND column_name = 'cash_box_id'
  ) THEN
    ALTER TABLE public.vouchers ADD COLUMN cash_box_id UUID REFERENCES public.cash_boxes(id) ON DELETE SET NULL;
  END IF;

  -- 4. ربط المورد (لسندات الصرف)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'vouchers' AND column_name = 'supplier_id'
  ) THEN
    ALTER TABLE public.vouchers ADD COLUMN supplier_id UUID REFERENCES public.suppliers(id) ON DELETE SET NULL;
  END IF;

  -- 5. الربط الاختياري بالفاتورة (مبيعات أو مشتريات)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'vouchers' AND column_name = 'invoice_id'
  ) THEN
    ALTER TABLE public.vouchers ADD COLUMN invoice_id UUID REFERENCES public.invoices(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'vouchers' AND column_name = 'purchase_invoice_id'
  ) THEN
    ALTER TABLE public.vouchers ADD COLUMN purchase_invoice_id UUID REFERENCES public.purchase_invoices(id) ON DELETE SET NULL;
  END IF;
END $$;
