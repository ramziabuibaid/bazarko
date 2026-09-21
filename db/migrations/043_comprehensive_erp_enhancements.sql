-- ==============================================================================
-- Migration 043: Comprehensive ERP Enhancements
-- 1. Fix vouchers_payment_method_check to allow check/cheque/split
-- 2. Fix invoices_discount_type_check to allow fixed/percentage/amount/percent
-- 3. Update cash_boxes with account_id and expanded box types
-- 4. Create purchase_orders and purchase_order_items tables
-- 5. Add multi-currency original amount columns to journal_lines
-- ==============================================================================
SET search_path = public;

-- 1. إصلاح قيود السندات (vouchers)
ALTER TABLE public.vouchers DROP CONSTRAINT IF EXISTS vouchers_payment_method_check;
ALTER TABLE public.vouchers ADD CONSTRAINT vouchers_payment_method_check 
  CHECK (payment_method IN ('cash', 'bank', 'card', 'transfer', 'check', 'cheque', 'split'));

-- 2. إصلاح قيود الفواتير (invoices)
ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_discount_type_check;
ALTER TABLE public.invoices ADD CONSTRAINT invoices_discount_type_check 
  CHECK (discount_type IN ('fixed', 'percentage', 'amount', 'percent'));

-- 3. تحديث جدول الصناديق والخزينة (cash_boxes)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'cash_boxes' AND column_name = 'account_id'
  ) THEN
    ALTER TABLE public.cash_boxes ADD COLUMN account_id UUID REFERENCES public.accounts(id) ON DELETE SET NULL;
  END IF;
END $$;

ALTER TABLE public.cash_boxes DROP CONSTRAINT IF EXISTS cash_boxes_type_check;
ALTER TABLE public.cash_boxes ADD CONSTRAINT cash_boxes_type_check 
  CHECK (type IN ('cash', 'bank', 'wallet', 'personal', 'checks_collection', 'checks_received', 'checks_issued'));

-- 4. جدول أوامر الشراء (purchase_orders)
CREATE TABLE IF NOT EXISTS public.purchase_orders (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id            UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  order_number        TEXT NOT NULL,
  supplier_id         UUID REFERENCES public.suppliers(id) ON DELETE SET NULL,
  issue_date          DATE NOT NULL DEFAULT CURRENT_DATE,
  expected_date       DATE,
  status              TEXT NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft', 'sent', 'confirmed', 'received', 'cancelled')),
  subtotal            NUMERIC(14,2) NOT NULL DEFAULT 0,
  tax_amount          NUMERIC(14,2) NOT NULL DEFAULT 0,
  discount_amount     NUMERIC(14,2) NOT NULL DEFAULT 0,
  total               NUMERIC(14,2) NOT NULL DEFAULT 0,
  notes               TEXT,
  converted_invoice_id UUID REFERENCES public.purchase_invoices(id) ON DELETE SET NULL,
  created_by          UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (store_id, order_number)
);

CREATE INDEX IF NOT EXISTS idx_purchase_orders_store ON public.purchase_orders(store_id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_supplier ON public.purchase_orders(supplier_id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_status ON public.purchase_orders(status);

-- جدول بنود أوامر الشراء (purchase_order_items)
CREATE TABLE IF NOT EXISTS public.purchase_order_items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id   UUID NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  product_id          UUID REFERENCES public.products(id) ON DELETE SET NULL,
  item_name           TEXT NOT NULL,
  item_sku            TEXT,
  quantity            NUMERIC(12,2) NOT NULL DEFAULT 1,
  unit_price          NUMERIC(14,2) NOT NULL DEFAULT 0,
  discount_amount     NUMERIC(14,2) NOT NULL DEFAULT 0,
  total               NUMERIC(14,2) NOT NULL DEFAULT 0,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_po_items_order ON public.purchase_order_items(purchase_order_id);

-- تمكين RLS على أوامر الشراء
ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_order_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "store_member_purchase_orders" ON public.purchase_orders;
CREATE POLICY "store_member_purchase_orders" ON public.purchase_orders
  FOR ALL USING (is_store_member(store_id));

DROP POLICY IF EXISTS "store_member_purchase_order_items" ON public.purchase_order_items;
CREATE POLICY "store_member_purchase_order_items" ON public.purchase_order_items
  FOR ALL USING (
    purchase_order_id IN (
      SELECT id FROM public.purchase_orders WHERE is_store_member(store_id)
    )
  );

-- 5. ترقية جدول سطور القيود اليومية (journal_lines) للمبالغ الأجنبية
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'journal_lines' AND column_name = 'original_debit'
  ) THEN
    ALTER TABLE public.journal_lines ADD COLUMN original_debit NUMERIC(14,2) DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'journal_lines' AND column_name = 'original_credit'
  ) THEN
    ALTER TABLE public.journal_lines ADD COLUMN original_credit NUMERIC(14,2) DEFAULT 0;
  END IF;
END $$;
