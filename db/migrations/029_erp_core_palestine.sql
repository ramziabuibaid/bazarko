-- ==============================================================================
-- Migration 029: Bazarko Palestine SaaS ERP Core Engine
-- المحاسبة المزدوجة، الشيكات وسلطة النقد PMA، الحسابات البنكية،
-- المشتريات، المردودات، عروض الأسعار، كشف حركات الأصناف، والماركات
-- ==============================================================================
SET search_path = public;

-- ─────────────────────────────────────────────────────────────
-- 1. الماركات والبراندات (Brands)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.brands (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id    UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL,
  logo_url    TEXT,
  description TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order  INTEGER DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(store_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_brands_store ON public.brands(store_id);

-- إضافة brand_id إلى المنتجات إن لم يكن موجوداً
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'products' AND column_name = 'brand_id'
  ) THEN
    ALTER TABLE public.products ADD COLUMN brand_id UUID REFERENCES public.brands(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────
-- 2. ترقية دليل الحسابات وشجرة الحسابات (Accounts)
-- ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'accounts' AND column_name = 'is_group'
  ) THEN
    ALTER TABLE public.accounts ADD COLUMN is_group BOOLEAN NOT NULL DEFAULT FALSE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'accounts' AND column_name = 'currency'
  ) THEN
    ALTER TABLE public.accounts ADD COLUMN currency TEXT NOT NULL DEFAULT 'ILS';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'accounts' AND column_name = 'balance'
  ) THEN
    ALTER TABLE public.accounts ADD COLUMN balance NUMERIC(14,2) NOT NULL DEFAULT 0;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────
-- 3. الحسابات البنكية للشركة (Company Bank Accounts)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bank_accounts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id        UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  bank_code       TEXT NOT NULL,
  bank_name       TEXT NOT NULL,
  branch_code     TEXT NOT NULL,
  branch_name     TEXT NOT NULL,
  account_number  TEXT NOT NULL,
  account_name    TEXT NOT NULL,
  currency        TEXT NOT NULL DEFAULT 'ILS',
  iban            TEXT,
  account_type    TEXT NOT NULL DEFAULT 'checking',
  account_id      UUID REFERENCES public.accounts(id) ON DELETE SET NULL,
  opening_balance NUMERIC(14,2) NOT NULL DEFAULT 0,
  balance         NUMERIC(14,2) NOT NULL DEFAULT 0,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(store_id, account_number, currency)
);

CREATE INDEX IF NOT EXISTS idx_bank_accounts_store ON public.bank_accounts(store_id);

-- ─────────────────────────────────────────────────────────────
-- 4. القيود اليومية المحاسبية المزدوجة (Journal Entries & Lines)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.journal_entries (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id     UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  entry_number TEXT NOT NULL,
  date         DATE NOT NULL DEFAULT CURRENT_DATE,
  description  TEXT NOT NULL,
  source       TEXT NOT NULL DEFAULT 'manual'
               CHECK (source IN ('manual', 'invoice', 'purchase', 'sales_return', 'purchase_return', 'voucher', 'check_op', 'opening', 'closing', 'system')),
  ref_id       UUID,
  status       TEXT NOT NULL DEFAULT 'posted'
               CHECK (status IN ('draft', 'posted', 'voided')),
  attachments  TEXT[] DEFAULT ARRAY[]::TEXT[],
  created_by   UUID REFERENCES auth.users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(store_id, entry_number)
);

CREATE INDEX IF NOT EXISTS idx_journal_entries_store ON public.journal_entries(store_id, date);
CREATE INDEX IF NOT EXISTS idx_journal_entries_ref   ON public.journal_entries(source, ref_id);

CREATE TABLE IF NOT EXISTS public.journal_lines (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_entry_id UUID NOT NULL REFERENCES public.journal_entries(id) ON DELETE CASCADE,
  account_id       UUID NOT NULL REFERENCES public.accounts(id) ON DELETE RESTRICT,
  debit            NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit           NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  currency         TEXT NOT NULL DEFAULT 'ILS',
  exchange_rate    NUMERIC(10,4) DEFAULT 1.0,
  description      TEXT,
  sort_order       INTEGER DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_journal_lines_entry   ON public.journal_lines(journal_entry_id);
CREATE INDEX IF NOT EXISTS idx_journal_lines_account ON public.journal_lines(account_id);

-- ─────────────────────────────────────────────────────────────
-- 5. محفظة الشيكات (Checks & Operations)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.checks (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id                UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  type                    TEXT NOT NULL CHECK (type IN ('received', 'issued')),
  check_number            TEXT NOT NULL,
  bank_code               TEXT,
  bank_name               TEXT NOT NULL,
  branch_code             TEXT,
  branch_name             TEXT,
  account_number          TEXT,
  drawer_name             TEXT,
  payee_name              TEXT,
  amount                  NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  currency                TEXT NOT NULL DEFAULT 'ILS',
  exchange_rate           NUMERIC(10,4) DEFAULT 1.0,
  amount_ils              NUMERIC(14,2) NOT NULL,
  due_date                DATE NOT NULL,
  issue_date              DATE NOT NULL DEFAULT CURRENT_DATE,
  status                  TEXT NOT NULL DEFAULT 'in_portfolio'
                          CHECK (status IN ('in_portfolio', 'deposited', 'collected', 'bounced', 'endorsed', 'returned_to_drawer', 'returned_to_customer', 'supplier_returned')),
  customer_id             UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  supplier_id             UUID REFERENCES public.suppliers(id) ON DELETE SET NULL,
  deposit_bank_account_id UUID REFERENCES public.bank_accounts(id) ON DELETE SET NULL,
  endorsed_supplier_id    UUID REFERENCES public.suppliers(id) ON DELETE SET NULL,
  cashbox_id              UUID REFERENCES public.cash_boxes(id) ON DELETE SET NULL,
  images                  TEXT[] DEFAULT ARRAY[]::TEXT[],
  notes                   TEXT,
  created_by              UUID REFERENCES auth.users(id),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_checks_store    ON public.checks(store_id, type, status);
CREATE INDEX IF NOT EXISTS idx_checks_due_date ON public.checks(store_id, due_date);
CREATE INDEX IF NOT EXISTS idx_checks_customer ON public.checks(customer_id);
CREATE INDEX IF NOT EXISTS idx_checks_supplier ON public.checks(supplier_id);

CREATE TABLE IF NOT EXISTS public.check_operations (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id               UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  check_id               UUID NOT NULL REFERENCES public.checks(id) ON DELETE CASCADE,
  operation_type         TEXT NOT NULL
                         CHECK (operation_type IN ('deposit', 'collect', 'bounce', 'endorse', 'return_to_drawer', 'return_to_customer', 'supplier_return', 'status_change', 'manual_edit')),
  from_status            TEXT NOT NULL,
  to_status              TEXT NOT NULL,
  operation_date         DATE NOT NULL DEFAULT CURRENT_DATE,
  target_bank_account_id UUID REFERENCES public.bank_accounts(id) ON DELETE SET NULL,
  target_supplier_id     UUID REFERENCES public.suppliers(id) ON DELETE SET NULL,
  journal_entry_id       UUID REFERENCES public.journal_entries(id) ON DELETE SET NULL,
  notes                  TEXT,
  performed_by           UUID REFERENCES auth.users(id),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_check_operations_check ON public.check_operations(check_id);

-- ─────────────────────────────────────────────────────────────
-- 6. فواتير المشتريات والمردودات (Purchases & Returns)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.purchase_invoices (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id                UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  supplier_id             UUID REFERENCES public.suppliers(id) ON DELETE SET NULL,
  invoice_number          TEXT NOT NULL,
  supplier_invoice_number TEXT,
  status                  TEXT NOT NULL DEFAULT 'completed'
                          CHECK (status IN ('draft', 'pending', 'completed', 'cancelled')),
  payment_status          TEXT NOT NULL DEFAULT 'unpaid'
                          CHECK (payment_status IN ('unpaid', 'partial', 'paid')),
  payment_method          TEXT DEFAULT 'credit'
                          CHECK (payment_method IN ('cash', 'bank_transfer', 'check', 'credit', 'mixed')),
  subtotal                NUMERIC(14,2) NOT NULL,
  discount                NUMERIC(14,2) DEFAULT 0,
  tax_amount              NUMERIC(14,2) DEFAULT 0,
  total_amount            NUMERIC(14,2) NOT NULL,
  paid_amount             NUMERIC(14,2) DEFAULT 0,
  currency                TEXT NOT NULL DEFAULT 'ILS',
  invoice_date            DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date                DATE,
  notes                   TEXT,
  journal_entry_id        UUID REFERENCES public.journal_entries(id) ON DELETE SET NULL,
  created_by              UUID REFERENCES auth.users(id),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(store_id, invoice_number)
);

CREATE INDEX IF NOT EXISTS idx_purchase_invoices_store    ON public.purchase_invoices(store_id, invoice_date);
CREATE INDEX IF NOT EXISTS idx_purchase_invoices_supplier ON public.purchase_invoices(supplier_id);

CREATE TABLE IF NOT EXISTS public.purchase_items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_invoice_id UUID NOT NULL REFERENCES public.purchase_invoices(id) ON DELETE CASCADE,
  product_id          UUID REFERENCES public.products(id) ON DELETE SET NULL,
  product_name        TEXT NOT NULL,
  quantity            NUMERIC(10,2) NOT NULL CHECK (quantity > 0),
  unit_price          NUMERIC(14,2) NOT NULL CHECK (unit_price >= 0),
  total_price         NUMERIC(14,2) NOT NULL,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_purchase_items_invoice ON public.purchase_items(purchase_invoice_id);

CREATE TABLE IF NOT EXISTS public.purchase_returns (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id            UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  supplier_id         UUID REFERENCES public.suppliers(id) ON DELETE SET NULL,
  purchase_invoice_id UUID REFERENCES public.purchase_invoices(id) ON DELETE SET NULL,
  return_number       TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'completed'
                      CHECK (status IN ('draft', 'completed', 'cancelled')),
  refund_method       TEXT DEFAULT 'credit'
                      CHECK (refund_method IN ('cash', 'bank', 'check', 'credit')),
  total_amount        NUMERIC(14,2) NOT NULL,
  return_date         DATE NOT NULL DEFAULT CURRENT_DATE,
  reason              TEXT,
  notes               TEXT,
  journal_entry_id    UUID REFERENCES public.journal_entries(id) ON DELETE SET NULL,
  created_by          UUID REFERENCES auth.users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(store_id, return_number)
);

CREATE INDEX IF NOT EXISTS idx_purchase_returns_store ON public.purchase_returns(store_id);

CREATE TABLE IF NOT EXISTS public.purchase_return_items (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_return_id UUID NOT NULL REFERENCES public.purchase_returns(id) ON DELETE CASCADE,
  product_id         UUID REFERENCES public.products(id) ON DELETE SET NULL,
  product_name       TEXT NOT NULL,
  quantity           NUMERIC(10,2) NOT NULL CHECK (quantity > 0),
  unit_price         NUMERIC(14,2) NOT NULL,
  total_price        NUMERIC(14,2) NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────
-- 7. مردودات المبيعات (Sales Returns)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sales_returns (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id         UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  customer_id      UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  invoice_id       UUID REFERENCES public.invoices(id) ON DELETE SET NULL,
  return_number    TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'completed'
                   CHECK (status IN ('draft', 'completed', 'cancelled')),
  refund_method    TEXT DEFAULT 'credit'
                   CHECK (refund_method IN ('cash', 'bank', 'check', 'credit')),
  total_amount     NUMERIC(14,2) NOT NULL,
  return_date      DATE NOT NULL DEFAULT CURRENT_DATE,
  reason           TEXT,
  notes            TEXT,
  journal_entry_id UUID REFERENCES public.journal_entries(id) ON DELETE SET NULL,
  created_by       UUID REFERENCES auth.users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(store_id, return_number)
);

CREATE INDEX IF NOT EXISTS idx_sales_returns_store ON public.sales_returns(store_id);

CREATE TABLE IF NOT EXISTS public.sales_return_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_return_id UUID NOT NULL REFERENCES public.sales_returns(id) ON DELETE CASCADE,
  product_id      UUID REFERENCES public.products(id) ON DELETE SET NULL,
  product_name    TEXT NOT NULL,
  quantity        NUMERIC(10,2) NOT NULL CHECK (quantity > 0),
  unit_price      NUMERIC(14,2) NOT NULL,
  total_price     NUMERIC(14,2) NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────
-- 8. عروض الأسعار (Quotations)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.quotations (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id             UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  customer_id          UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  quotation_number     TEXT NOT NULL,
  status               TEXT NOT NULL DEFAULT 'sent'
                       CHECK (status IN ('draft', 'sent', 'accepted', 'rejected', 'converted', 'expired')),
  issue_date           DATE NOT NULL DEFAULT CURRENT_DATE,
  valid_until          DATE,
  subtotal             NUMERIC(14,2) NOT NULL,
  discount             NUMERIC(14,2) DEFAULT 0,
  tax_amount           NUMERIC(14,2) DEFAULT 0,
  total_amount         NUMERIC(14,2) NOT NULL,
  currency             TEXT NOT NULL DEFAULT 'ILS',
  notes                TEXT,
  terms                TEXT,
  converted_invoice_id UUID REFERENCES public.invoices(id) ON DELETE SET NULL,
  created_by           UUID REFERENCES auth.users(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(store_id, quotation_number)
);

CREATE INDEX IF NOT EXISTS idx_quotations_store ON public.quotations(store_id);

CREATE TABLE IF NOT EXISTS public.quotation_items (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_id UUID NOT NULL REFERENCES public.quotations(id) ON DELETE CASCADE,
  product_id   UUID REFERENCES public.products(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  quantity     NUMERIC(10,2) NOT NULL CHECK (quantity > 0),
  unit_price   NUMERIC(14,2) NOT NULL,
  total_price  NUMERIC(14,2) NOT NULL,
  notes        TEXT,
  sort_order   INTEGER DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────
-- 9. كشف حركات الأصناف الشامل (Inventory Movements Ledger)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.inventory_movements (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id        UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  product_id      UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  movement_type   TEXT NOT NULL
                  CHECK (movement_type IN ('sale', 'purchase', 'sales_return', 'purchase_return', 'adjustment_in', 'adjustment_out', 'transfer_in', 'transfer_out', 'damage', 'initial')),
  document_number TEXT,
  document_type   TEXT,
  ref_id          UUID,
  entity_name     TEXT,
  quantity_in     NUMERIC(10,2) NOT NULL DEFAULT 0,
  quantity_out    NUMERIC(10,2) NOT NULL DEFAULT 0,
  balance_after   NUMERIC(10,2) NOT NULL,
  unit_price      NUMERIC(14,2) DEFAULT 0,
  notes           TEXT,
  movement_date   DATE NOT NULL DEFAULT CURRENT_DATE,
  created_by      UUID REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inv_movements_store   ON public.inventory_movements(store_id, movement_date);
CREATE INDEX IF NOT EXISTS idx_inv_movements_product ON public.inventory_movements(product_id, movement_date);

-- ─────────────────────────────────────────────────────────────
-- 10. تفعيل RLS على كافة الجداول الجديدة
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.brands               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_accounts         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal_entries      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal_lines        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checks               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.check_operations     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_invoices    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_items       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_returns     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_return_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_returns        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_return_items   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quotations           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quotation_items      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_movements  ENABLE ROW LEVEL SECURITY;

-- سياسات RLS باستخدام is_store_member
DROP POLICY IF EXISTS "brands_store_member"               ON public.brands;
DROP POLICY IF EXISTS "bank_accounts_store_member"         ON public.bank_accounts;
DROP POLICY IF EXISTS "journal_entries_store_member"      ON public.journal_entries;
DROP POLICY IF EXISTS "checks_store_member"               ON public.checks;
DROP POLICY IF EXISTS "check_operations_store_member"     ON public.check_operations;
DROP POLICY IF EXISTS "purchase_invoices_store_member"    ON public.purchase_invoices;
DROP POLICY IF EXISTS "purchase_returns_store_member"     ON public.purchase_returns;
DROP POLICY IF EXISTS "sales_returns_store_member"        ON public.sales_returns;
DROP POLICY IF EXISTS "quotations_store_member"           ON public.quotations;
DROP POLICY IF EXISTS "inventory_movements_store_member"  ON public.inventory_movements;

CREATE POLICY "brands_store_member"              ON public.brands              FOR ALL USING (is_store_member(store_id));
CREATE POLICY "bank_accounts_store_member"        ON public.bank_accounts        FOR ALL USING (is_store_member(store_id));
CREATE POLICY "journal_entries_store_member"     ON public.journal_entries     FOR ALL USING (is_store_member(store_id));
CREATE POLICY "checks_store_member"              ON public.checks              FOR ALL USING (is_store_member(store_id));
CREATE POLICY "check_operations_store_member"    ON public.check_operations    FOR ALL USING (is_store_member(store_id));
CREATE POLICY "purchase_invoices_store_member"   ON public.purchase_invoices   FOR ALL USING (is_store_member(store_id));
CREATE POLICY "purchase_returns_store_member"    ON public.purchase_returns    FOR ALL USING (is_store_member(store_id));
CREATE POLICY "sales_returns_store_member"       ON public.sales_returns       FOR ALL USING (is_store_member(store_id));
CREATE POLICY "quotations_store_member"          ON public.quotations          FOR ALL USING (is_store_member(store_id));
CREATE POLICY "inventory_movements_store_member" ON public.inventory_movements FOR ALL USING (is_store_member(store_id));

-- الجداول الفرعية (Child tables with FK reference)
DROP POLICY IF EXISTS "journal_lines_store_member"        ON public.journal_lines;
DROP POLICY IF EXISTS "purchase_items_store_member"       ON public.purchase_items;
DROP POLICY IF EXISTS "purchase_return_items_store_member" ON public.purchase_return_items;
DROP POLICY IF EXISTS "sales_return_items_store_member"   ON public.sales_return_items;
DROP POLICY IF EXISTS "quotation_items_store_member"      ON public.quotation_items;

CREATE POLICY "journal_lines_store_member" ON public.journal_lines FOR ALL USING (
  EXISTS (SELECT 1 FROM public.journal_entries je WHERE je.id = journal_entry_id AND is_store_member(je.store_id))
);

CREATE POLICY "purchase_items_store_member" ON public.purchase_items FOR ALL USING (
  EXISTS (SELECT 1 FROM public.purchase_invoices pi WHERE pi.id = purchase_invoice_id AND is_store_member(pi.store_id))
);

CREATE POLICY "purchase_return_items_store_member" ON public.purchase_return_items FOR ALL USING (
  EXISTS (SELECT 1 FROM public.purchase_returns pr WHERE pr.id = purchase_return_id AND is_store_member(pr.store_id))
);

CREATE POLICY "sales_return_items_store_member" ON public.sales_return_items FOR ALL USING (
  EXISTS (SELECT 1 FROM public.sales_returns sr WHERE sr.id = sales_return_id AND is_store_member(sr.store_id))
);

CREATE POLICY "quotation_items_store_member" ON public.quotation_items FOR ALL USING (
  EXISTS (SELECT 1 FROM public.quotations q WHERE q.id = quotation_id AND is_store_member(q.store_id))
);

-- تخزين صور الشيكات (Storage bucket checks)
INSERT INTO storage.buckets (id, name, public)
VALUES ('checks', 'checks', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "authenticated_upload_checks" ON storage.objects;
DROP POLICY IF EXISTS "authenticated_read_checks"   ON storage.objects;
DROP POLICY IF EXISTS "authenticated_delete_checks" ON storage.objects;

CREATE POLICY "authenticated_upload_checks"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'checks');

CREATE POLICY "authenticated_read_checks"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'checks');

CREATE POLICY "authenticated_delete_checks"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'checks');
