-- ==============================================================================
-- Migration 033: Bazarko Al-Shamel ERP Cloud Importer & Sync Engine
-- معالج استيراد ومزامنة بيانات الشامل المحاسبي Al-Shamel ERP
-- الأصول الثابتة، مراكز التكلفة، المندوبين، قوائم الأسعار الخاصة، ودوال الـ RPC
-- ==============================================================================
SET search_path = public;

-- ─────────────────────────────────────────────────────────────
-- 1. ربط الجداول التشغيلية بحقل كود الشامل (shamel_code) لمنع التكرار ودعم الـ Upsert
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.accounts  ADD COLUMN IF NOT EXISTS shamel_code TEXT;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS shamel_code TEXT;
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS shamel_code TEXT;
ALTER TABLE public.products  ADD COLUMN IF NOT EXISTS shamel_code TEXT;
ALTER TABLE public.checks    ADD COLUMN IF NOT EXISTS shamel_code TEXT;

CREATE INDEX IF NOT EXISTS idx_accounts_store_shamel_code  ON public.accounts(store_id, shamel_code) WHERE shamel_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customers_store_shamel_code ON public.customers(store_id, shamel_code) WHERE shamel_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_suppliers_store_shamel_code ON public.suppliers(store_id, shamel_code) WHERE shamel_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_products_store_shamel_code  ON public.products(store_id, shamel_code) WHERE shamel_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_checks_store_shamel_code    ON public.checks(store_id, shamel_code) WHERE shamel_code IS NOT NULL;

-- ─────────────────────────────────────────────────────────────
-- 2. جدول سجلات النسخ والاستيراد (Shamel Snapshots & Audit)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.shamel_snapshots (
  id                 TEXT PRIMARY KEY, -- Hash Fingerprint (SHA-256)
  store_id           UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  source_modified_at TIMESTAMPTZ,
  imported_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  manifest           JSONB NOT NULL DEFAULT '[]'::jsonb,
  report             JSONB NOT NULL DEFAULT '{}'::jsonb,
  status             TEXT NOT NULL DEFAULT 'applied' CHECK (status IN ('validated', 'applied', 'partial', 'failed')),
  created_by         UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_shamel_snapshots_store ON public.shamel_snapshots(store_id, imported_at DESC);

-- ─────────────────────────────────────────────────────────────
-- 3. جدول إعدادات المزامنة السحابية الدورية (Google Drive Sync Config)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.shamel_sync_configs (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id                 UUID NOT NULL UNIQUE REFERENCES public.stores(id) ON DELETE CASCADE,
  gdrive_folder_id         TEXT,
  gdrive_folder_name       TEXT,
  gdrive_service_account   TEXT,
  gdrive_credentials_json  TEXT, -- Encrypted or protected
  auto_sync_enabled        BOOLEAN NOT NULL DEFAULT FALSE,
  sync_interval_hours      INTEGER NOT NULL DEFAULT 24,
  last_sync_at             TIMESTAMPTZ,
  last_sync_status         TEXT DEFAULT 'idle' CHECK (last_sync_status IN ('idle', 'in_progress', 'success', 'error')),
  last_sync_message        TEXT,
  last_sync_report         JSONB DEFAULT '{}'::jsonb,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────
-- 4. الجداول الإضافية لدعم كامل كيانات الشامل ERP
-- ─────────────────────────────────────────────────────────────

-- 4.1 مراكز التكلفة (Cost Centers - COSTCENT.DAT)
CREATE TABLE IF NOT EXISTS public.cost_centers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id    UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  code        TEXT NOT NULL,
  name        TEXT NOT NULL,
  parent_id   UUID REFERENCES public.cost_centers(id) ON DELETE SET NULL,
  shamel_code TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(store_id, code)
);

CREATE INDEX IF NOT EXISTS idx_cost_centers_store ON public.cost_centers(store_id);

-- 4.2 الأصول الثابتة (Fixed Assets - ASSETS.DAT)
CREATE TABLE IF NOT EXISTS public.fixed_assets (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id          UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  code              TEXT NOT NULL,
  name              TEXT NOT NULL,
  category          TEXT,
  purchase_date     DATE,
  purchase_cost     NUMERIC(14,2) NOT NULL DEFAULT 0,
  currency          TEXT NOT NULL DEFAULT 'ILS',
  current_value     NUMERIC(14,2) NOT NULL DEFAULT 0,
  depreciation_rate NUMERIC(6,2) DEFAULT 0,
  location          TEXT,
  account_id        UUID REFERENCES public.accounts(id) ON DELETE SET NULL,
  shamel_code       TEXT,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(store_id, code)
);

CREATE INDEX IF NOT EXISTS idx_fixed_assets_store ON public.fixed_assets(store_id);

-- 4.3 مندوبو المبيعات (Sales Reps - SALESMEN.DAT)
CREATE TABLE IF NOT EXISTS public.sales_reps (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id        UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  code            TEXT NOT NULL,
  name            TEXT NOT NULL,
  phone           TEXT,
  commission_rate NUMERIC(6,2) DEFAULT 0,
  shamel_code     TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(store_id, code)
);

CREATE INDEX IF NOT EXISTS idx_sales_reps_store ON public.sales_reps(store_id);

-- 4.4 قوائم أسعار الزبائن الخاصة (Customer Price Lists - CUSTLPRC.DAT)
CREATE TABLE IF NOT EXISTS public.customer_price_lists (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id     UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  customer_id  UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  product_id   UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  special_price NUMERIC(14,2) NOT NULL CHECK (special_price >= 0),
  currency     TEXT NOT NULL DEFAULT 'ILS',
  min_quantity NUMERIC(10,2) DEFAULT 1,
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(store_id, customer_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_cust_price_store ON public.customer_price_lists(store_id, customer_id);

-- ─────────────────────────────────────────────────────────────
-- 5. تفعيل سياسات الأمان RLS للجداول الجديدة
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.shamel_snapshots      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shamel_sync_configs   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cost_centers          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fixed_assets          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_reps            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_price_lists  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "shamel_snapshots_member"     ON public.shamel_snapshots;
DROP POLICY IF EXISTS "shamel_sync_configs_member"   ON public.shamel_sync_configs;
DROP POLICY IF EXISTS "cost_centers_member"          ON public.cost_centers;
DROP POLICY IF EXISTS "fixed_assets_member"          ON public.fixed_assets;
DROP POLICY IF EXISTS "sales_reps_member"            ON public.sales_reps;
DROP POLICY IF EXISTS "customer_price_lists_member"  ON public.customer_price_lists;

CREATE POLICY "shamel_snapshots_member" ON public.shamel_snapshots
  FOR ALL USING (is_store_member(store_id)) WITH CHECK (is_store_member(store_id));

CREATE POLICY "shamel_sync_configs_member" ON public.shamel_sync_configs
  FOR ALL USING (is_store_member(store_id)) WITH CHECK (is_store_member(store_id));

CREATE POLICY "cost_centers_member" ON public.cost_centers
  FOR ALL USING (is_store_member(store_id)) WITH CHECK (is_store_member(store_id));

CREATE POLICY "fixed_assets_member" ON public.fixed_assets
  FOR ALL USING (is_store_member(store_id)) WITH CHECK (is_store_member(store_id));

CREATE POLICY "sales_reps_member" ON public.sales_reps
  FOR ALL USING (is_store_member(store_id)) WITH CHECK (is_store_member(store_id));

CREATE POLICY "customer_price_lists_member" ON public.customer_price_lists
  FOR ALL USING (is_store_member(store_id)) WITH CHECK (is_store_member(store_id));

-- ─────────────────────────────────────────────────────────────
-- 6. دوال الـ RPC للحقن الدفعي السريع والآمن (Bulk Upsert Functions)
-- ─────────────────────────────────────────────────────────────

-- 6.1 حقن شجرة الحسابات (Accounts Bulk Upsert)
CREATE OR REPLACE FUNCTION public.shamel_bulk_upsert_accounts(
  p_store_id UUID,
  p_accounts JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rec RECORD;
  v_inserted INT := 0;
  v_updated INT := 0;
BEGIN
  IF NOT is_store_member(p_store_id) THEN
    RAISE EXCEPTION 'Not authorized for this store';
  END IF;

  FOR v_rec IN SELECT * FROM jsonb_to_recordset(p_accounts) AS x(
    code TEXT,
    name TEXT,
    type TEXT,
    is_group BOOLEAN,
    currency TEXT,
    balance NUMERIC,
    parent_code TEXT
  ) LOOP
    -- Upsert Account
    INSERT INTO public.accounts (
      store_id, code, name, type, is_group, currency, balance, shamel_code, is_active
    ) VALUES (
      p_store_id, v_rec.code, v_rec.name, COALESCE(v_rec.type, 'asset'),
      COALESCE(v_rec.is_group, FALSE), COALESCE(v_rec.currency, 'ILS'),
      COALESCE(v_rec.balance, 0), v_rec.code, TRUE
    )
    ON CONFLICT (store_id, code) DO UPDATE SET
      name = EXCLUDED.name,
      type = EXCLUDED.type,
      is_group = EXCLUDED.is_group,
      currency = EXCLUDED.currency,
      balance = EXCLUDED.balance,
      shamel_code = EXCLUDED.shamel_code;

    IF FOUND THEN
      v_updated := v_updated + 1;
    ELSE
      v_inserted := v_inserted + 1;
    END IF;
  END LOOP;

  -- Second pass: Link parent_ids using parent_code
  UPDATE public.accounts a
  SET parent_id = p.id
  FROM public.accounts p
  JOIN (
    SELECT x.code, x.parent_code
    FROM jsonb_to_recordset(p_accounts) AS x(code TEXT, parent_code TEXT)
    WHERE x.parent_code IS NOT NULL AND x.parent_code <> ''
  ) map ON map.parent_code = p.code AND p.store_id = p_store_id
  WHERE a.store_id = p_store_id AND a.code = map.code AND a.parent_id IS DISTINCT FROM p.id;

  RETURN jsonb_build_object('success', TRUE, 'inserted', v_inserted, 'updated', v_updated);
END;
$$;

-- 6.2 حقن الزبائن (Customers Bulk Upsert)
CREATE OR REPLACE FUNCTION public.shamel_bulk_upsert_customers(
  p_store_id UUID,
  p_customers JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rec RECORD;
  v_count INT := 0;
BEGIN
  IF NOT is_store_member(p_store_id) THEN
    RAISE EXCEPTION 'Not authorized for this store';
  END IF;

  FOR v_rec IN SELECT * FROM jsonb_to_recordset(p_customers) AS x(
    code TEXT,
    name TEXT,
    phone TEXT,
    address TEXT,
    balance NUMERIC
  ) LOOP
    IF EXISTS (SELECT 1 FROM public.customers WHERE store_id = p_store_id AND shamel_code = v_rec.code) THEN
      UPDATE public.customers
      SET name = v_rec.name,
          phone = COALESCE(v_rec.phone, phone),
          address = COALESCE(v_rec.address, address),
          balance = COALESCE(v_rec.balance, balance)
      WHERE store_id = p_store_id AND shamel_code = v_rec.code;
    ELSIF v_rec.phone IS NOT NULL AND v_rec.phone <> '' AND EXISTS (
      SELECT 1 FROM public.customers WHERE store_id = p_store_id AND phone = v_rec.phone
    ) THEN
      UPDATE public.customers
      SET shamel_code = v_rec.code,
          name = v_rec.name,
          balance = COALESCE(v_rec.balance, balance)
      WHERE store_id = p_store_id AND phone = v_rec.phone;
    ELSE
      INSERT INTO public.customers (
        store_id, name, phone, address, balance, shamel_code
      ) VALUES (
        p_store_id, v_rec.name, v_rec.phone, v_rec.address, COALESCE(v_rec.balance, 0), v_rec.code
      );
    END IF;
    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('success', TRUE, 'processed', v_count);
END;
$$;

-- 6.3 حقن الموردين (Suppliers Bulk Upsert)
CREATE OR REPLACE FUNCTION public.shamel_bulk_upsert_suppliers(
  p_store_id UUID,
  p_suppliers JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rec RECORD;
  v_count INT := 0;
BEGIN
  IF NOT is_store_member(p_store_id) THEN
    RAISE EXCEPTION 'Not authorized for this store';
  END IF;

  FOR v_rec IN SELECT * FROM jsonb_to_recordset(p_suppliers) AS x(
    code TEXT,
    name TEXT,
    phone TEXT,
    address TEXT,
    balance NUMERIC
  ) LOOP
    IF EXISTS (SELECT 1 FROM public.suppliers WHERE store_id = p_store_id AND shamel_code = v_rec.code) THEN
      UPDATE public.suppliers
      SET name = v_rec.name,
          phone = COALESCE(v_rec.phone, phone),
          address = COALESCE(v_rec.address, address),
          balance = COALESCE(v_rec.balance, balance)
      WHERE store_id = p_store_id AND shamel_code = v_rec.code;
    ELSE
      INSERT INTO public.suppliers (
        store_id, name, phone, address, balance, shamel_code
      ) VALUES (
        p_store_id, v_rec.name, v_rec.phone, v_rec.address, COALESCE(v_rec.balance, 0), v_rec.code
      );
    END IF;
    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('success', TRUE, 'processed', v_count);
END;
$$;

-- 6.4 حقن المنتجات والمخزون (Products Bulk Upsert)
CREATE OR REPLACE FUNCTION public.shamel_bulk_upsert_products(
  p_store_id UUID,
  p_products JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rec RECORD;
  v_count INT := 0;
BEGIN
  IF NOT is_store_member(p_store_id) THEN
    RAISE EXCEPTION 'Not authorized for this store';
  END IF;

  FOR v_rec IN SELECT * FROM jsonb_to_recordset(p_products) AS x(
    code TEXT,
    name TEXT,
    barcode TEXT,
    price NUMERIC,
    cost_price NUMERIC,
    stock_quantity NUMERIC
  ) LOOP
    IF EXISTS (SELECT 1 FROM public.products WHERE store_id = p_store_id AND shamel_code = v_rec.code) THEN
      UPDATE public.products
      SET name = v_rec.name,
          barcode = COALESCE(v_rec.barcode, barcode),
          price = CASE WHEN v_rec.price > 0 THEN v_rec.price ELSE price END,
          cost_price = CASE WHEN v_rec.cost_price > 0 THEN v_rec.cost_price ELSE cost_price END,
          stock_quantity = COALESCE(ROUND(v_rec.stock_quantity)::int, stock_quantity),
          status = 'active'
      WHERE store_id = p_store_id AND shamel_code = v_rec.code;
    ELSIF v_rec.barcode IS NOT NULL AND v_rec.barcode <> '' AND EXISTS (
      SELECT 1 FROM public.products WHERE store_id = p_store_id AND barcode = v_rec.barcode
    ) THEN
      UPDATE public.products
      SET shamel_code = v_rec.code,
          name = v_rec.name,
          stock_quantity = COALESCE(ROUND(v_rec.stock_quantity)::int, stock_quantity),
          status = 'active'
      WHERE store_id = p_store_id AND barcode = v_rec.barcode;
    ELSE
      INSERT INTO public.products (
        store_id, name, slug, sku, barcode, price, cost_price, stock_quantity, shamel_code, status
      ) VALUES (
        p_store_id, v_rec.name,
        'shamel-' || lower(regexp_replace(v_rec.code, '[^a-zA-Z0-9]', '', 'g')) || '-' || substr(md5(random()::text), 1, 6),
        v_rec.code, v_rec.barcode,
        COALESCE(v_rec.price, 0), COALESCE(v_rec.cost_price, 0),
        COALESCE(ROUND(v_rec.stock_quantity)::int, 0), v_rec.code, 'active'
      );
    END IF;
    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('success', TRUE, 'processed', v_count);
END;
$$;

-- 6.5 حقن محفظة الشيكات (Checks Bulk Upsert)
CREATE OR REPLACE FUNCTION public.shamel_bulk_upsert_checks(
  p_store_id UUID,
  p_checks JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rec RECORD;
  v_count INT := 0;
  v_cust_id UUID;
  v_supp_id UUID;
BEGIN
  IF NOT is_store_member(p_store_id) THEN
    RAISE EXCEPTION 'Not authorized for this store';
  END IF;

  FOR v_rec IN SELECT * FROM jsonb_to_recordset(p_checks) AS x(
    document TEXT,
    check_number TEXT,
    due_date DATE,
    bank_code TEXT,
    bank_name TEXT,
    branch_code TEXT,
    branch_name TEXT,
    account_number TEXT,
    drawer_name TEXT,
    customer_code TEXT,
    amount NUMERIC,
    currency TEXT,
    status TEXT,
    type TEXT
  ) LOOP
    v_cust_id := NULL;
    v_supp_id := NULL;
    IF v_rec.customer_code IS NOT NULL AND v_rec.customer_code <> '' THEN
      SELECT id INTO v_cust_id FROM public.customers WHERE store_id = p_store_id AND shamel_code = v_rec.customer_code LIMIT 1;
      IF v_cust_id IS NULL THEN
        SELECT id INTO v_supp_id FROM public.suppliers WHERE store_id = p_store_id AND shamel_code = v_rec.customer_code LIMIT 1;
      END IF;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.checks
      WHERE store_id = p_store_id AND (shamel_code = v_rec.document OR (check_number = v_rec.check_number AND amount = v_rec.amount))
    ) THEN
      INSERT INTO public.checks (
        store_id,
        type,
        check_number,
        bank_code,
        bank_name,
        branch_code,
        branch_name,
        account_number,
        drawer_name,
        amount,
        currency,
        amount_ils,
        due_date,
        status,
        customer_id,
        supplier_id,
        shamel_code
      ) VALUES (
        p_store_id,
        COALESCE(v_rec.type, 'received'),
        v_rec.check_number,
        v_rec.bank_code,
        COALESCE(v_rec.bank_name, 'بنك ' || COALESCE(v_rec.bank_code, '')),
        v_rec.branch_code,
        COALESCE(v_rec.branch_name, 'فرع ' || COALESCE(v_rec.branch_code, '')),
        v_rec.account_number,
        COALESCE(v_rec.drawer_name, 'عميل الشامل'),
        v_rec.amount,
        COALESCE(v_rec.currency, 'ILS'),
        v_rec.amount,
        COALESCE(v_rec.due_date, CURRENT_DATE),
        COALESCE(v_rec.status, 'in_portfolio'),
        v_cust_id,
        v_supp_id,
        v_rec.document
      );
      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('success', TRUE, 'processed', v_count);
END;
$$;

-- 6.6 حقن الأصول الثابتة (Assets Bulk Upsert)
CREATE OR REPLACE FUNCTION public.shamel_bulk_upsert_assets(
  p_store_id UUID,
  p_assets JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rec RECORD;
  v_count INT := 0;
BEGIN
  IF NOT is_store_member(p_store_id) THEN
    RAISE EXCEPTION 'Not authorized for this store';
  END IF;

  FOR v_rec IN SELECT * FROM jsonb_to_recordset(p_assets) AS x(
    code TEXT,
    name TEXT,
    purchase_date DATE,
    purchase_cost NUMERIC,
    currency TEXT,
    depreciation_rate NUMERIC,
    location TEXT
  ) LOOP
    INSERT INTO public.fixed_assets (
      store_id, code, name, purchase_date, purchase_cost, currency, current_value, depreciation_rate, location, shamel_code
    ) VALUES (
      p_store_id, v_rec.code, v_rec.name, v_rec.purchase_date,
      COALESCE(v_rec.purchase_cost, 0), COALESCE(v_rec.currency, 'ILS'),
      COALESCE(v_rec.purchase_cost, 0), COALESCE(v_rec.depreciation_rate, 0),
      v_rec.location, v_rec.code
    )
    ON CONFLICT (store_id, code) DO UPDATE SET
      name = EXCLUDED.name,
      purchase_cost = EXCLUDED.purchase_cost,
      current_value = EXCLUDED.current_value,
      depreciation_rate = EXCLUDED.depreciation_rate;
    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('success', TRUE, 'processed', v_count);
END;
$$;

-- 6.7 حقن مراكز التكلفة ومندوبي المبيعات وقوائم الأسعار
CREATE OR REPLACE FUNCTION public.shamel_bulk_upsert_cost_centers(
  p_store_id UUID,
  p_cost_centers JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rec RECORD;
  v_count INT := 0;
BEGIN
  IF NOT is_store_member(p_store_id) THEN
    RAISE EXCEPTION 'Not authorized for this store';
  END IF;

  FOR v_rec IN SELECT * FROM jsonb_to_recordset(p_cost_centers) AS x(
    code TEXT,
    name TEXT
  ) LOOP
    INSERT INTO public.cost_centers (
      store_id, code, name, shamel_code
    ) VALUES (
      p_store_id, v_rec.code, v_rec.name, v_rec.code
    )
    ON CONFLICT (store_id, code) DO UPDATE SET
      name = EXCLUDED.name;
    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('success', TRUE, 'processed', v_count);
END;
$$;

CREATE OR REPLACE FUNCTION public.shamel_bulk_upsert_sales_reps(
  p_store_id UUID,
  p_sales_reps JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rec RECORD;
  v_count INT := 0;
BEGIN
  IF NOT is_store_member(p_store_id) THEN
    RAISE EXCEPTION 'Not authorized for this store';
  END IF;

  FOR v_rec IN SELECT * FROM jsonb_to_recordset(p_sales_reps) AS x(
    code TEXT,
    name TEXT,
    phone TEXT,
    commission_rate NUMERIC
  ) LOOP
    INSERT INTO public.sales_reps (
      store_id, code, name, phone, commission_rate, shamel_code
    ) VALUES (
      p_store_id, v_rec.code, v_rec.name, v_rec.phone, COALESCE(v_rec.commission_rate, 0), v_rec.code
    )
    ON CONFLICT (store_id, code) DO UPDATE SET
      name = EXCLUDED.name,
      phone = COALESCE(EXCLUDED.phone, sales_reps.phone),
      commission_rate = EXCLUDED.commission_rate;
    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('success', TRUE, 'processed', v_count);
END;
$$;

CREATE OR REPLACE FUNCTION public.shamel_bulk_upsert_price_lists(
  p_store_id UUID,
  p_price_lists JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rec RECORD;
  v_count INT := 0;
  v_cust_id UUID;
  v_prod_id UUID;
BEGIN
  IF NOT is_store_member(p_store_id) THEN
    RAISE EXCEPTION 'Not authorized for this store';
  END IF;

  FOR v_rec IN SELECT * FROM jsonb_to_recordset(p_price_lists) AS x(
    customer_code TEXT,
    product_code TEXT,
    special_price NUMERIC,
    currency TEXT
  ) LOOP
    SELECT id INTO v_cust_id FROM public.customers WHERE store_id = p_store_id AND shamel_code = v_rec.customer_code LIMIT 1;
    SELECT id INTO v_prod_id FROM public.products  WHERE store_id = p_store_id AND shamel_code = v_rec.product_code LIMIT 1;

    IF v_cust_id IS NOT NULL AND v_prod_id IS NOT NULL THEN
      INSERT INTO public.customer_price_lists (
        store_id, customer_id, product_id, special_price, currency
      ) VALUES (
        p_store_id, v_cust_id, v_prod_id, v_rec.special_price, COALESCE(v_rec.currency, 'ILS')
      )
      ON CONFLICT (store_id, customer_id, product_id) DO UPDATE SET
        special_price = EXCLUDED.special_price,
        currency = EXCLUDED.currency;
      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('success', TRUE, 'processed', v_count);
END;
$$;
