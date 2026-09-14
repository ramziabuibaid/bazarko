-- ================================================================
-- Migration 031: Complete ERP Schema Synchronization & PostgREST Reload
-- ================================================================
SET search_path = public;

-- 1. Ensure invoices has all expected columns
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS customer_name TEXT;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS customer_phone TEXT;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS customer_address TEXT;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS total NUMERIC(12,2) DEFAULT 0;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS total_amount NUMERIC(12,2) DEFAULT 0;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS subtotal NUMERIC(12,2) DEFAULT 0;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(12,2) DEFAULT 0;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS amount_paid NUMERIC(12,2) DEFAULT 0;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS amount_remaining NUMERIC(12,2) DEFAULT 0;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;

-- Sync total and total_amount for existing and future rows
UPDATE public.invoices SET total = total_amount WHERE (total IS NULL OR total = 0) AND total_amount IS NOT NULL AND total_amount > 0;
UPDATE public.invoices SET total_amount = total WHERE (total_amount IS NULL OR total_amount = 0) AND total IS NOT NULL AND total > 0;

CREATE OR REPLACE FUNCTION sync_invoices_totals()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.total IS NOT NULL AND (NEW.total_amount IS NULL OR NEW.total_amount = 0) THEN
    NEW.total_amount := NEW.total;
  ELSIF NEW.total_amount IS NOT NULL AND (NEW.total IS NULL OR NEW.total = 0) THEN
    NEW.total := NEW.total_amount;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_invoices_totals ON public.invoices;
CREATE TRIGGER trg_sync_invoices_totals
  BEFORE INSERT OR UPDATE ON public.invoices
  FOR EACH ROW
  EXECUTE FUNCTION sync_invoices_totals();

-- 2. Ensure invoice_items has all expected columns
ALTER TABLE public.invoice_items ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE public.invoice_items ADD COLUMN IF NOT EXISTS sku TEXT;
ALTER TABLE public.invoice_items ADD COLUMN IF NOT EXISTS total NUMERIC(12,2) DEFAULT 0;
ALTER TABLE public.invoice_items ADD COLUMN IF NOT EXISTS total_price NUMERIC(12,2) DEFAULT 0;
ALTER TABLE public.invoice_items ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE public.invoice_items ADD COLUMN IF NOT EXISTS unit_price NUMERIC(12,2) DEFAULT 0;
ALTER TABLE public.invoice_items ADD COLUMN IF NOT EXISTS quantity NUMERIC(10,2) DEFAULT 1;

-- Sync name/description and total/total_price
UPDATE public.invoice_items SET name = description WHERE (name IS NULL OR name = '') AND description IS NOT NULL;
UPDATE public.invoice_items SET description = name WHERE (description IS NULL OR description = '') AND name IS NOT NULL;
UPDATE public.invoice_items SET total = total_price WHERE (total IS NULL OR total = 0) AND total_price IS NOT NULL AND total_price > 0;
UPDATE public.invoice_items SET total_price = total WHERE (total_price IS NULL OR total_price = 0) AND total IS NOT NULL AND total > 0;

CREATE OR REPLACE FUNCTION sync_invoice_items_cols()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.name IS NOT NULL AND (NEW.description IS NULL OR NEW.description = '') THEN
    NEW.description := NEW.name;
  ELSIF NEW.description IS NOT NULL AND (NEW.name IS NULL OR NEW.name = '') THEN
    NEW.name := NEW.description;
  END IF;

  IF NEW.total IS NOT NULL AND (NEW.total_price IS NULL OR NEW.total_price = 0) THEN
    NEW.total_price := NEW.total;
  ELSIF NEW.total_price IS NOT NULL AND (NEW.total IS NULL OR NEW.total = 0) THEN
    NEW.total := NEW.total_price;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_invoice_items_cols ON public.invoice_items;
CREATE TRIGGER trg_sync_invoice_items_cols
  BEFORE INSERT OR UPDATE ON public.invoice_items
  FOR EACH ROW
  EXECUTE FUNCTION sync_invoice_items_cols();

-- 3. Ensure vouchers columns
ALTER TABLE public.vouchers ADD COLUMN IF NOT EXISTS bank_account_id UUID REFERENCES public.bank_accounts(id) ON DELETE SET NULL;
ALTER TABLE public.vouchers ADD COLUMN IF NOT EXISTS check_id UUID REFERENCES public.checks(id) ON DELETE SET NULL;

-- 4. Ensure products brand_id
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS brand_id UUID REFERENCES public.brands(id) ON DELETE SET NULL;

-- 5. Ensure stores pos & sync columns
ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS pos_receipt_header TEXT;
ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS pos_receipt_footer TEXT DEFAULT 'شكراً لتعاملكم معنا!';
ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS api_sync_key TEXT;

-- 6. Ensure campaigns & inventory sync logs
CREATE TABLE IF NOT EXISTS public.ads_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  platform TEXT NOT NULL DEFAULT 'meta' CHECK (platform IN ('meta', 'google', 'tiktok', 'snapchat', 'whatsapp')),
  campaign_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'paused', 'completed', 'cancelled')),
  budget NUMERIC(12,2) NOT NULL DEFAULT 0,
  spent NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'ILS',
  target_audience JSONB DEFAULT '{}',
  product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  start_date DATE NOT NULL DEFAULT CURRENT_DATE,
  end_date DATE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.inventory_sync_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  sync_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'success',
  items_synced INTEGER NOT NULL DEFAULT 0,
  details JSONB DEFAULT '{}',
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 7. Ensure RLS on all tables
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vouchers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ads_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_sync_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "store_member_invoices" ON public.invoices;
CREATE POLICY "store_member_invoices" ON public.invoices
  FOR ALL USING (is_store_member(store_id));

DROP POLICY IF EXISTS "store_member_invoice_items" ON public.invoice_items;
CREATE POLICY "store_member_invoice_items" ON public.invoice_items
  FOR ALL USING (
    invoice_id IN (
      SELECT id FROM public.invoices WHERE is_store_member(store_id)
    )
  );

DROP POLICY IF EXISTS "store_member_vouchers" ON public.vouchers;
CREATE POLICY "store_member_vouchers" ON public.vouchers
  FOR ALL USING (is_store_member(store_id));

DROP POLICY IF EXISTS "store_member_ads_campaigns" ON public.ads_campaigns;
CREATE POLICY "store_member_ads_campaigns" ON public.ads_campaigns
  FOR ALL USING (is_store_member(store_id));

DROP POLICY IF EXISTS "store_member_inventory_sync_logs" ON public.inventory_sync_logs;
CREATE POLICY "store_member_inventory_sync_logs" ON public.inventory_sync_logs
  FOR ALL USING (is_store_member(store_id));

-- 8. PostgREST Schema Reload Notification
NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload config';
