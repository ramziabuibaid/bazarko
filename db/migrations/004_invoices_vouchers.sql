-- ==========================================
-- Migration 004: Invoices + Vouchers
-- ==========================================
SET search_path = public;

-- ─────────────────────────────────────────────────
-- 1. جدول الفواتير
-- ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.invoices (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id         UUID        NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  invoice_number   TEXT        NOT NULL,
  order_id         UUID        REFERENCES public.orders(id),
  customer_id      UUID        REFERENCES public.customers(id),
  customer_name    TEXT,
  customer_phone   TEXT,
  customer_address TEXT,
  issue_date       DATE        NOT NULL DEFAULT CURRENT_DATE,
  due_date         DATE,
  status           TEXT        NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft','sent','paid','cancelled')),
  subtotal         NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount_amount  NUMERIC(12,2) NOT NULL DEFAULT 0,
  total            NUMERIC(12,2) NOT NULL DEFAULT 0,
  amount_paid      NUMERIC(12,2) NOT NULL DEFAULT 0,
  notes            TEXT,
  created_by       UUID        REFERENCES auth.users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(store_id, invoice_number)
);

-- ─────────────────────────────────────────────────
-- 2. بنود الفاتورة
-- ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.invoice_items (
  id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id  UUID          NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  product_id  UUID          REFERENCES public.products(id),
  name        TEXT          NOT NULL,
  sku         TEXT,
  quantity    NUMERIC(10,2) NOT NULL DEFAULT 1,
  unit_price  NUMERIC(12,2) NOT NULL,
  total       NUMERIC(12,2) NOT NULL
);

-- ─────────────────────────────────────────────────
-- 3. سندات القبض والصرف (جدول موحّد)
-- ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.vouchers (
  id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id       UUID          NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  voucher_number TEXT          NOT NULL,
  type           TEXT          NOT NULL CHECK (type IN ('receipt','payment')),
  date           DATE          NOT NULL DEFAULT CURRENT_DATE,
  amount         NUMERIC(12,2) NOT NULL,
  customer_id    UUID          REFERENCES public.customers(id),
  party_name     TEXT,
  payment_method TEXT          NOT NULL DEFAULT 'cash'
                 CHECK (payment_method IN ('cash','bank','card','transfer')),
  category       TEXT,
  description    TEXT          NOT NULL,
  reference      TEXT,
  created_by     UUID          REFERENCES auth.users(id),
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
  UNIQUE(store_id, voucher_number)
);

-- ─────────────────────────────────────────────────
-- 4. RLS
-- ─────────────────────────────────────────────────
ALTER TABLE public.invoices      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vouchers      ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "store_member_invoices"      ON public.invoices;
DROP POLICY IF EXISTS "store_member_invoice_items" ON public.invoice_items;
DROP POLICY IF EXISTS "store_member_vouchers"      ON public.vouchers;

CREATE POLICY "store_member_invoices" ON public.invoices
  FOR ALL USING (is_store_member(store_id));

CREATE POLICY "store_member_invoice_items" ON public.invoice_items
  FOR ALL USING (
    invoice_id IN (
      SELECT id FROM public.invoices WHERE is_store_member(store_id)
    )
  );

CREATE POLICY "store_member_vouchers" ON public.vouchers
  FOR ALL USING (is_store_member(store_id));
