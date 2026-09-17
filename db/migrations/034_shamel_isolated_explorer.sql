-- ==============================================================================
-- Migration 034: Shamel Isolated Explorer & Promotion Engine (Like MyShop)
-- مستودع عزل واستعلام بيانات الشامل مع الترحيل والموائمة التدريجية إلى بازاركو
-- ==============================================================================
SET search_path = public;

-- ─────────────────────────────────────────────────────────────
-- 1. جداول عزل وتصفح بيانات الشامل (Isolated Read Model)
-- ─────────────────────────────────────────────────────────────

-- 1.1 زبائن الشامل المعزولة
CREATE TABLE IF NOT EXISTS public.shamel_customers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id    UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  snapshot_id TEXT,
  code        TEXT NOT NULL,
  name        TEXT NOT NULL,
  phone       TEXT,
  address     TEXT,
  balance     NUMERIC(14,2) NOT NULL DEFAULT 0,
  is_promoted BOOLEAN NOT NULL DEFAULT FALSE,
  promoted_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(store_id, code)
);

CREATE INDEX IF NOT EXISTS idx_shamel_customers_store ON public.shamel_customers(store_id, code);

-- 1.2 أصناف ومخزون الشامل المعزولة
CREATE TABLE IF NOT EXISTS public.shamel_stock (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id    UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  snapshot_id TEXT,
  code        TEXT NOT NULL,
  name        TEXT NOT NULL,
  barcode     TEXT,
  price       NUMERIC(14,2) NOT NULL DEFAULT 0,
  cost_price  NUMERIC(14,2) NOT NULL DEFAULT 0,
  quantity    NUMERIC(10,2) NOT NULL DEFAULT 0,
  is_promoted BOOLEAN NOT NULL DEFAULT FALSE,
  promoted_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(store_id, code)
);

CREATE INDEX IF NOT EXISTS idx_shamel_stock_store ON public.shamel_stock(store_id, code);

-- 1.3 شيكات الشامل المعزولة
CREATE TABLE IF NOT EXISTS public.shamel_cheques (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id       UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  snapshot_id    TEXT,
  document       TEXT NOT NULL,
  cheque_number  TEXT NOT NULL,
  due_date       DATE,
  bank_code      TEXT,
  bank_name      TEXT,
  branch_code    TEXT,
  branch_name    TEXT,
  account_number TEXT,
  customer_code  TEXT,
  customer_name  TEXT,
  amount         NUMERIC(14,2) NOT NULL,
  currency       TEXT NOT NULL DEFAULT 'ILS',
  status_code    INTEGER DEFAULT 0,
  status_name    TEXT NOT NULL DEFAULT 'في الصندوق',
  status         TEXT NOT NULL DEFAULT 'in_portfolio',
  type           TEXT NOT NULL DEFAULT 'received',
  is_promoted    BOOLEAN NOT NULL DEFAULT FALSE,
  promoted_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(store_id, document, cheque_number, amount)
);

CREATE INDEX IF NOT EXISTS idx_shamel_cheques_store ON public.shamel_cheques(store_id, due_date);

-- 1.4 شجرة حسابات الشامل المعزولة
CREATE TABLE IF NOT EXISTS public.shamel_accounts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id    UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  snapshot_id TEXT,
  code        TEXT NOT NULL,
  name        TEXT NOT NULL,
  parent_code TEXT,
  type        TEXT NOT NULL DEFAULT 'asset',
  is_group    BOOLEAN NOT NULL DEFAULT FALSE,
  currency    TEXT NOT NULL DEFAULT 'ILS',
  balance     NUMERIC(14,2) NOT NULL DEFAULT 0,
  is_promoted BOOLEAN NOT NULL DEFAULT FALSE,
  promoted_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(store_id, code)
);

CREATE INDEX IF NOT EXISTS idx_shamel_accounts_store ON public.shamel_accounts(store_id, code);

-- 1.5 أصول الشامل ومراكز التكلفة
CREATE TABLE IF NOT EXISTS public.shamel_assets (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id      UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  snapshot_id   TEXT,
  code          TEXT NOT NULL,
  name          TEXT NOT NULL,
  purchase_cost NUMERIC(14,2) NOT NULL DEFAULT 0,
  currency      TEXT NOT NULL DEFAULT 'ILS',
  is_promoted   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(store_id, code)
);

-- ─────────────────────────────────────────────────────────────
-- 2. سياسات الأمان RLS
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.shamel_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shamel_stock     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shamel_cheques   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shamel_accounts  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shamel_assets    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "shamel_customers_store" ON public.shamel_customers;
DROP POLICY IF EXISTS "shamel_stock_store"     ON public.shamel_stock;
DROP POLICY IF EXISTS "shamel_cheques_store"   ON public.shamel_cheques;
DROP POLICY IF EXISTS "shamel_accounts_store"  ON public.shamel_accounts;
DROP POLICY IF EXISTS "shamel_assets_store"    ON public.shamel_assets;

CREATE POLICY "shamel_customers_store" ON public.shamel_customers
  FOR ALL USING (is_store_member(store_id)) WITH CHECK (is_store_member(store_id));

CREATE POLICY "shamel_stock_store" ON public.shamel_stock
  FOR ALL USING (is_store_member(store_id)) WITH CHECK (is_store_member(store_id));

CREATE POLICY "shamel_cheques_store" ON public.shamel_cheques
  FOR ALL USING (is_store_member(store_id)) WITH CHECK (is_store_member(store_id));

CREATE POLICY "shamel_accounts_store" ON public.shamel_accounts
  FOR ALL USING (is_store_member(store_id)) WITH CHECK (is_store_member(store_id));

CREATE POLICY "shamel_assets_store" ON public.shamel_assets
  FOR ALL USING (is_store_member(store_id)) WITH CHECK (is_store_member(store_id));

-- ─────────────────────────────────────────────────────────────
-- 3. دالة إفراغ وإعادة ضبط بيانات المتجر (Reset / Wipe Store Data)
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.shamel_reset_store(
  p_store_id UUID,
  p_wipe_operational BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT is_store_member(p_store_id) THEN
    RAISE EXCEPTION 'Not authorized for this store';
  END IF;

  -- Wipe isolated tables
  DELETE FROM public.shamel_customers WHERE store_id = p_store_id;
  DELETE FROM public.shamel_stock WHERE store_id = p_store_id;
  DELETE FROM public.shamel_cheques WHERE store_id = p_store_id;
  DELETE FROM public.shamel_accounts WHERE store_id = p_store_id;
  DELETE FROM public.shamel_assets WHERE store_id = p_store_id;
  DELETE FROM public.shamel_snapshots WHERE store_id = p_store_id;

  -- Wipe operational if requested
  IF p_wipe_operational THEN
    DELETE FROM public.customer_price_lists WHERE store_id = p_store_id;
    DELETE FROM public.sales_reps WHERE store_id = p_store_id;
    DELETE FROM public.cost_centers WHERE store_id = p_store_id;
    DELETE FROM public.fixed_assets WHERE store_id = p_store_id;
    DELETE FROM public.checks WHERE store_id = p_store_id AND shamel_code IS NOT NULL;
    DELETE FROM public.products WHERE store_id = p_store_id AND shamel_code IS NOT NULL;
    DELETE FROM public.customers WHERE store_id = p_store_id AND shamel_code IS NOT NULL;
    DELETE FROM public.suppliers WHERE store_id = p_store_id AND shamel_code IS NOT NULL;
    DELETE FROM public.accounts WHERE store_id = p_store_id AND shamel_code IS NOT NULL;
  END IF;

  RETURN jsonb_build_object('success', TRUE, 'message', 'تم إفراغ وإعادة ضبط بيانات المتجر بنجاح');
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- 4. دوال الحقن في الجداول المعزولة (Isolated Ingestion)
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.shamel_save_isolated_batch(
  p_store_id UUID,
  p_snapshot_id TEXT,
  p_kind TEXT,
  p_items JSONB
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

  IF p_kind = 'customers' THEN
    FOR v_rec IN SELECT * FROM jsonb_to_recordset(p_items) AS x(
      code TEXT, name TEXT, phone TEXT, address TEXT, balance NUMERIC
    ) LOOP
      INSERT INTO public.shamel_customers (
        store_id, snapshot_id, code, name, phone, address, balance
      ) VALUES (
        p_store_id, p_snapshot_id, v_rec.code, v_rec.name, v_rec.phone, v_rec.address, COALESCE(v_rec.balance, 0)
      )
      ON CONFLICT (store_id, code) DO UPDATE SET
        name = EXCLUDED.name,
        phone = EXCLUDED.phone,
        address = EXCLUDED.address,
        balance = EXCLUDED.balance,
        snapshot_id = EXCLUDED.snapshot_id;
      v_count := v_count + 1;
    END LOOP;

  ELSIF p_kind = 'stock' THEN
    FOR v_rec IN SELECT * FROM jsonb_to_recordset(p_items) AS x(
      code TEXT, name TEXT, barcode TEXT, price NUMERIC, cost_price NUMERIC, stock_quantity NUMERIC
    ) LOOP
      INSERT INTO public.shamel_stock (
        store_id, snapshot_id, code, name, barcode, price, cost_price, quantity
      ) VALUES (
        p_store_id, p_snapshot_id, v_rec.code, v_rec.name, v_rec.barcode,
        COALESCE(v_rec.price, 0), COALESCE(v_rec.cost_price, 0), COALESCE(v_rec.stock_quantity, 0)
      )
      ON CONFLICT (store_id, code) DO UPDATE SET
        name = EXCLUDED.name,
        barcode = EXCLUDED.barcode,
        price = EXCLUDED.price,
        cost_price = EXCLUDED.cost_price,
        quantity = EXCLUDED.quantity,
        snapshot_id = EXCLUDED.snapshot_id;
      v_count := v_count + 1;
    END LOOP;

  ELSIF p_kind = 'cheques' THEN
    FOR v_rec IN SELECT * FROM jsonb_to_recordset(p_items) AS x(
      document TEXT, cheque_number TEXT, due_date DATE, bank_code TEXT, bank_name TEXT,
      branch_code TEXT, branch_name TEXT, account_number TEXT, drawer_name TEXT,
      customer_code TEXT, customer_name TEXT, amount NUMERIC, currency TEXT,
      status_code INT, status_name TEXT, status TEXT, type TEXT
    ) LOOP
      INSERT INTO public.shamel_cheques (
        store_id, snapshot_id, document, cheque_number, due_date, bank_code, bank_name,
        branch_code, branch_name, account_number, customer_code, customer_name,
        amount, currency, status_code, status_name, status, type
      ) VALUES (
        p_store_id, p_snapshot_id, v_rec.document, v_rec.cheque_number, v_rec.due_date,
        v_rec.bank_code, COALESCE(v_rec.bank_name, 'بنك ' || COALESCE(v_rec.bank_code, '')),
        v_rec.branch_code, v_rec.branch_name, v_rec.account_number,
        v_rec.customer_code, v_rec.customer_name,
        v_rec.amount, COALESCE(v_rec.currency, 'ILS'),
        COALESCE(v_rec.status_code, 0), COALESCE(v_rec.status_name, 'في الصندوق'),
        COALESCE(v_rec.status, 'in_portfolio'), COALESCE(v_rec.type, 'received')
      )
      ON CONFLICT (store_id, document, cheque_number, amount) DO UPDATE SET
        status = EXCLUDED.status,
        status_name = EXCLUDED.status_name,
        due_date = EXCLUDED.due_date,
        snapshot_id = EXCLUDED.snapshot_id;
      v_count := v_count + 1;
    END LOOP;

  ELSIF p_kind = 'accounts' THEN
    FOR v_rec IN SELECT * FROM jsonb_to_recordset(p_items) AS x(
      code TEXT, name TEXT, parent_code TEXT, type TEXT, is_group BOOLEAN, currency TEXT, balance NUMERIC
    ) LOOP
      INSERT INTO public.shamel_accounts (
        store_id, snapshot_id, code, name, parent_code, type, is_group, currency, balance
      ) VALUES (
        p_store_id, p_snapshot_id, v_rec.code, v_rec.name, v_rec.parent_code,
        COALESCE(v_rec.type, 'asset'), COALESCE(v_rec.is_group, FALSE),
        COALESCE(v_rec.currency, 'ILS'), COALESCE(v_rec.balance, 0)
      )
      ON CONFLICT (store_id, code) DO UPDATE SET
        name = EXCLUDED.name,
        parent_code = EXCLUDED.parent_code,
        type = EXCLUDED.type,
        is_group = EXCLUDED.is_group,
        balance = EXCLUDED.balance,
        snapshot_id = EXCLUDED.snapshot_id;
      v_count := v_count + 1;
    END LOOP;

  ELSIF p_kind = 'assets' THEN
    FOR v_rec IN SELECT * FROM jsonb_to_recordset(p_items) AS x(
      code TEXT, name TEXT, purchase_cost NUMERIC, currency TEXT
    ) LOOP
      INSERT INTO public.shamel_assets (
        store_id, snapshot_id, code, name, purchase_cost, currency
      ) VALUES (
        p_store_id, p_snapshot_id, v_rec.code, v_rec.name, COALESCE(v_rec.purchase_cost, 0), COALESCE(v_rec.currency, 'ILS')
      )
      ON CONFLICT (store_id, code) DO UPDATE SET
        name = EXCLUDED.name,
        purchase_cost = EXCLUDED.purchase_cost;
      v_count := v_count + 1;
    END LOOP;
  END IF;

  RETURN jsonb_build_object('success', TRUE, 'processed', v_count);
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- 5. دالة ترحيل وموائمة الكيانات إلى بازاركو (Promote Engine)
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.shamel_promote_entity(
  p_store_id UUID,
  p_entity TEXT, -- 'customers' | 'stock' | 'cheques' | 'accounts'
  p_code TEXT DEFAULT NULL -- NULL means all in this entity
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count INT := 0;
  v_rec RECORD;
  v_slug TEXT;
  v_cust_id UUID;
  v_supp_id UUID;
BEGIN
  IF NOT is_store_member(p_store_id) THEN
    RAISE EXCEPTION 'Not authorized for this store';
  END IF;

  -- 1. Promote Customers
  IF p_entity = 'customers' THEN
    FOR v_rec IN 
      SELECT * FROM public.shamel_customers 
      WHERE store_id = p_store_id AND (p_code IS NULL OR code = p_code)
    LOOP
      IF EXISTS (SELECT 1 FROM public.customers WHERE store_id = p_store_id AND shamel_code = v_rec.code) THEN
        UPDATE public.customers
        SET name = v_rec.name,
            phone = COALESCE(v_rec.phone, phone),
            address = COALESCE(v_rec.address, address),
            balance = v_rec.balance
        WHERE store_id = p_store_id AND shamel_code = v_rec.code;
      ELSE
        INSERT INTO public.customers (
          store_id, name, phone, address, balance, shamel_code
        ) VALUES (
          p_store_id, v_rec.name, v_rec.phone, v_rec.address, v_rec.balance, v_rec.code
        );
      END IF;

      UPDATE public.shamel_customers 
      SET is_promoted = TRUE, promoted_at = now() 
      WHERE store_id = p_store_id AND code = v_rec.code;

      v_count := v_count + 1;
    END LOOP;

  -- 2. Promote Stock/Products
  ELSIF p_entity = 'stock' THEN
    FOR v_rec IN 
      SELECT * FROM public.shamel_stock 
      WHERE store_id = p_store_id AND (p_code IS NULL OR code = p_code)
    LOOP
      IF EXISTS (SELECT 1 FROM public.products WHERE store_id = p_store_id AND shamel_code = v_rec.code) THEN
        UPDATE public.products
        SET name = v_rec.name,
            barcode = COALESCE(v_rec.barcode, barcode),
            price = CASE WHEN v_rec.price > 0 THEN v_rec.price ELSE price END,
            cost_price = CASE WHEN v_rec.cost_price > 0 THEN v_rec.cost_price ELSE cost_price END,
            stock_quantity = ROUND(v_rec.quantity)::int,
            status = 'active'
        WHERE store_id = p_store_id AND shamel_code = v_rec.code;
      ELSE
        v_slug := 'shamel-' || lower(regexp_replace(v_rec.code, '[^a-zA-Z0-9]', '', 'g')) || '-' || substr(md5(random()::text), 1, 6);
        INSERT INTO public.products (
          store_id, name, slug, sku, barcode, price, cost_price, stock_quantity, shamel_code, status
        ) VALUES (
          p_store_id, v_rec.name, v_slug, v_rec.code, v_rec.barcode,
          v_rec.price, v_rec.cost_price, ROUND(v_rec.quantity)::int, v_rec.code, 'active'
        );
      END IF;

      UPDATE public.shamel_stock 
      SET is_promoted = TRUE, promoted_at = now() 
      WHERE store_id = p_store_id AND code = v_rec.code;

      v_count := v_count + 1;
    END LOOP;

  -- 3. Promote Cheques
  ELSIF p_entity = 'cheques' THEN
    FOR v_rec IN 
      SELECT * FROM public.shamel_cheques 
      WHERE store_id = p_store_id AND (p_code IS NULL OR document = p_code)
    LOOP
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
        WHERE store_id = p_store_id AND (shamel_code = v_rec.document OR (check_number = v_rec.cheque_number AND amount = v_rec.amount))
      ) THEN
        INSERT INTO public.checks (
          store_id, type, check_number, bank_code, bank_name, branch_code, branch_name,
          account_number, drawer_name, amount, currency, amount_ils, due_date, status,
          customer_id, supplier_id, shamel_code
        ) VALUES (
          p_store_id, v_rec.type, v_rec.cheque_number, v_rec.bank_code, v_rec.bank_name,
          v_rec.branch_code, v_rec.branch_name, v_rec.account_number,
          COALESCE(v_rec.customer_name, 'عميل الشامل'), v_rec.amount, v_rec.currency,
          v_rec.amount, COALESCE(v_rec.due_date, CURRENT_DATE), v_rec.status,
          v_cust_id, v_supp_id, v_rec.document
        );
      END IF;

      UPDATE public.shamel_cheques 
      SET is_promoted = TRUE, promoted_at = now() 
      WHERE store_id = p_store_id AND id = v_rec.id;

      v_count := v_count + 1;
    END LOOP;

  -- 4. Promote Chart of Accounts
  ELSIF p_entity = 'accounts' THEN
    FOR v_rec IN 
      SELECT * FROM public.shamel_accounts 
      WHERE store_id = p_store_id AND (p_code IS NULL OR code = p_code)
    LOOP
      INSERT INTO public.accounts (
        store_id, code, name, type, is_group, currency, balance, shamel_code, is_active
      ) VALUES (
        p_store_id, v_rec.code, v_rec.name, v_rec.type, v_rec.is_group,
        v_rec.currency, v_rec.balance, v_rec.code, TRUE
      )
      ON CONFLICT (store_id, code) DO UPDATE SET
        name = EXCLUDED.name,
        type = EXCLUDED.type,
        is_group = EXCLUDED.is_group,
        balance = EXCLUDED.balance,
        shamel_code = EXCLUDED.shamel_code;

      UPDATE public.shamel_accounts 
      SET is_promoted = TRUE, promoted_at = now() 
      WHERE store_id = p_store_id AND code = v_rec.code;

      v_count := v_count + 1;
    END LOOP;

    -- Link parent IDs
    UPDATE public.accounts a
    SET parent_id = p.id
    FROM public.accounts p
    JOIN public.shamel_accounts sa ON sa.parent_code = p.code AND sa.store_id = p_store_id
    WHERE a.store_id = p_store_id AND a.code = sa.code AND a.parent_id IS DISTINCT FROM p.id;

  END IF;

  RETURN jsonb_build_object('success', TRUE, 'promoted_count', v_count);
END;
$$;
