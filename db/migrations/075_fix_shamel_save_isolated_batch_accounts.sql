-- Migration 075: Fix shamel_save_isolated_batch for accounts and cheques schema types, and ensure all isolated entities exist

-- 1. Ensure optional isolated tables exist if sync uploads them
CREATE TABLE IF NOT EXISTS public.shamel_salesmen (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  snapshot_id TEXT,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT,
  commission_rate NUMERIC(10,2) DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(store_id, code)
);

CREATE TABLE IF NOT EXISTS public.shamel_customer_prices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  snapshot_id TEXT,
  customer_code TEXT NOT NULL,
  product_code TEXT NOT NULL,
  price NUMERIC(14,2) DEFAULT 0,
  discount_rate NUMERIC(10,2) DEFAULT 0,
  currency TEXT DEFAULT 'ILS',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(store_id, customer_code, product_code)
);

ALTER TABLE public.shamel_salesmen ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "shamel_salesmen_store" ON public.shamel_salesmen;
CREATE POLICY "shamel_salesmen_store" ON public.shamel_salesmen
  FOR ALL USING (auth.role() = 'service_role' OR is_store_member(store_id));

ALTER TABLE public.shamel_customer_prices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "shamel_customer_prices_store" ON public.shamel_customer_prices;
CREATE POLICY "shamel_customer_prices_store" ON public.shamel_customer_prices
  FOR ALL USING (auth.role() = 'service_role' OR is_store_member(store_id));

-- 2. Fully typed, robust shamel_save_isolated_batch
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
  v_count INT := 0;
BEGIN
  IF auth.role() <> 'service_role' AND NOT is_store_member(p_store_id) THEN
    RAISE EXCEPTION 'Not authorized for this store';
  END IF;

  IF p_kind = 'customers' THEN
    INSERT INTO public.shamel_customers (
      store_id, snapshot_id, code, name, phone, address, balance, equivalent_balance
    )
    SELECT DISTINCT ON (x.code)
      p_store_id, p_snapshot_id, x.code, x.name, x.phone, x.address,
      COALESCE(x.balance, 0), COALESCE(x.balance, 0)
    FROM jsonb_to_recordset(p_items) AS x(
      code TEXT, name TEXT, phone TEXT, address TEXT, balance NUMERIC
    )
    ON CONFLICT (store_id, code) DO UPDATE SET
      name = EXCLUDED.name,
      phone = EXCLUDED.phone,
      address = EXCLUDED.address,
      balance = EXCLUDED.balance,
      snapshot_id = EXCLUDED.snapshot_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;

  ELSIF p_kind = 'stock' THEN
    INSERT INTO public.shamel_stock (
      store_id, snapshot_id, code, name, barcode, price, cost_price, quantity
    )
    SELECT DISTINCT ON (x.code)
      p_store_id, p_snapshot_id, x.code, x.name, x.barcode,
      COALESCE(x.price, 0), COALESCE(x.cost_price, 0), COALESCE(x.stock_quantity, 0)
    FROM jsonb_to_recordset(p_items) AS x(
      code TEXT, name TEXT, barcode TEXT, price NUMERIC, cost_price NUMERIC, stock_quantity NUMERIC
    )
    ON CONFLICT (store_id, code) DO UPDATE SET
      name = EXCLUDED.name,
      barcode = COALESCE(NULLIF(EXCLUDED.barcode, ''), shamel_stock.barcode),
      price = CASE WHEN EXCLUDED.price > 0 THEN EXCLUDED.price ELSE shamel_stock.price END,
      cost_price = CASE WHEN EXCLUDED.cost_price > 0 THEN EXCLUDED.cost_price ELSE shamel_stock.cost_price END,
      quantity = EXCLUDED.quantity,
      snapshot_id = EXCLUDED.snapshot_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;

  ELSIF p_kind = 'cheques' THEN
    INSERT INTO public.shamel_cheques (
      store_id, snapshot_id, document, cheque_number, due_date, bank_code, bank_name,
      branch_code, branch_name, account_number, customer_code, customer_name,
      amount, currency, status_code, status_name, status, type
    )
    SELECT DISTINCT ON (x.document, x.cheque_number, x.amount)
      p_store_id, p_snapshot_id, x.document, x.cheque_number,
      CASE 
        WHEN x.due_date IS NOT NULL AND x.due_date ~ '^\d{4}-\d{2}-\d{2}' THEN x.due_date::DATE
        ELSE NULL
      END,
      x.bank_code, COALESCE(x.bank_name, 'بنك ' || COALESCE(x.bank_code, '')),
      x.branch_code, x.branch_name, x.account_number,
      x.customer_code, x.customer_name,
      COALESCE(x.amount, 0), COALESCE(x.currency, 'ILS'),
      COALESCE(NULLIF(regexp_replace(x.status_code::text, '[^0-9-]', '', 'g'), '')::INT, 0),
      x.status_name,
      COALESCE(x.status, 'under_collection'),
      COALESCE(x.type, 'incoming')
    FROM jsonb_to_recordset(p_items) AS x(
      document TEXT, cheque_number TEXT, due_date TEXT, bank_code TEXT, bank_name TEXT,
      branch_code TEXT, branch_name TEXT, account_number TEXT, customer_code TEXT,
      customer_name TEXT, amount NUMERIC, currency TEXT, status_code TEXT, status_name TEXT,
      status TEXT, type TEXT
    )
    ON CONFLICT (store_id, document, cheque_number, amount) DO UPDATE SET
      due_date = EXCLUDED.due_date,
      bank_code = EXCLUDED.bank_code,
      bank_name = EXCLUDED.bank_name,
      branch_code = EXCLUDED.branch_code,
      branch_name = EXCLUDED.branch_name,
      account_number = EXCLUDED.account_number,
      customer_code = EXCLUDED.customer_code,
      customer_name = EXCLUDED.customer_name,
      status_code = EXCLUDED.status_code,
      status_name = EXCLUDED.status_name,
      status = EXCLUDED.status,
      snapshot_id = EXCLUDED.snapshot_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;

  ELSIF p_kind = 'accounts' THEN
    INSERT INTO public.shamel_accounts (
      store_id, snapshot_id, code, name, parent_code, type, is_group, currency, balance
    )
    SELECT DISTINCT ON (x.code)
      p_store_id, p_snapshot_id, x.code, x.name, x.parent_code,
      COALESCE(x.type, 'asset'),
      COALESCE(x.is_group, FALSE),
      COALESCE(x.currency, 'ILS'),
      COALESCE(x.balance, 0)
    FROM jsonb_to_recordset(p_items) AS x(
      code TEXT, name TEXT, parent_code TEXT, type TEXT, is_group BOOLEAN, currency TEXT, balance NUMERIC
    )
    ON CONFLICT (store_id, code) DO UPDATE SET
      name = EXCLUDED.name,
      parent_code = EXCLUDED.parent_code,
      type = EXCLUDED.type,
      is_group = EXCLUDED.is_group,
      currency = EXCLUDED.currency,
      balance = EXCLUDED.balance,
      snapshot_id = EXCLUDED.snapshot_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;

  ELSIF p_kind = 'assets' THEN
    INSERT INTO public.shamel_assets (
      store_id, snapshot_id, code, name, purchase_cost, currency
    )
    SELECT DISTINCT ON (x.code)
      p_store_id, p_snapshot_id, x.code, x.name,
      COALESCE(x.purchase_cost, 0), COALESCE(x.currency, 'ILS')
    FROM jsonb_to_recordset(p_items) AS x(
      code TEXT, name TEXT, purchase_cost NUMERIC, currency TEXT
    )
    ON CONFLICT (store_id, code) DO UPDATE SET
      name = EXCLUDED.name,
      purchase_cost = EXCLUDED.purchase_cost;
    GET DIAGNOSTICS v_count = ROW_COUNT;

  ELSIF p_kind = 'cost_centers' THEN
    INSERT INTO public.cost_centers (
      store_id, code, name, shamel_code, is_active
    )
    SELECT DISTINCT ON (x.code)
      p_store_id, x.code, x.name, x.code, TRUE
    FROM jsonb_to_recordset(p_items) AS x(code TEXT, name TEXT)
    ON CONFLICT (store_id, code) DO UPDATE SET
      name = EXCLUDED.name;
    GET DIAGNOSTICS v_count = ROW_COUNT;

  ELSIF p_kind = 'salesmen' THEN
    INSERT INTO public.shamel_salesmen (
      store_id, snapshot_id, code, name, phone, commission_rate
    )
    SELECT DISTINCT ON (x.code)
      p_store_id, p_snapshot_id, x.code, x.name, x.phone, COALESCE(x.commission_rate, 0)
    FROM jsonb_to_recordset(p_items) AS x(
      code TEXT, name TEXT, phone TEXT, commission_rate NUMERIC
    )
    ON CONFLICT (store_id, code) DO UPDATE SET
      name = EXCLUDED.name,
      phone = EXCLUDED.phone,
      commission_rate = EXCLUDED.commission_rate,
      snapshot_id = EXCLUDED.snapshot_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;

  ELSIF p_kind = 'customer_prices' THEN
    INSERT INTO public.shamel_customer_prices (
      store_id, snapshot_id, customer_code, product_code, price, discount_rate, currency
    )
    SELECT DISTINCT ON (x.customer_code, x.product_code)
      p_store_id, p_snapshot_id, x.customer_code, x.product_code,
      COALESCE(x.price, 0), COALESCE(x.discount_rate, 0), COALESCE(x.currency, 'ILS')
    FROM jsonb_to_recordset(p_items) AS x(
      customer_code TEXT, product_code TEXT, price NUMERIC, discount_rate NUMERIC, currency TEXT
    )
    ON CONFLICT (store_id, customer_code, product_code) DO UPDATE SET
      price = EXCLUDED.price,
      discount_rate = EXCLUDED.discount_rate,
      currency = EXCLUDED.currency,
      snapshot_id = EXCLUDED.snapshot_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;

  ELSIF p_kind = 'entries' THEN
    INSERT INTO public.shamel_entries (
      store_id, snapshot_id, document, line_index, account, currency, day,
      amount, direction, description, document_type, source_offset, exchange_rate, nis_amount
    )
    SELECT DISTINCT ON (x.document, x.line_index, x.account, x.direction)
      p_store_id, p_snapshot_id, x.document,
      COALESCE(NULLIF(regexp_replace(x.line_index::text, '[^0-9-]', '', 'g'), '')::INT, 0),
      x.account, COALESCE(x.currency, 'ILS'),
      CASE 
        WHEN x.day IS NOT NULL AND x.day ~ '^\d{4}-\d{2}-\d{2}' THEN x.day::DATE
        ELSE CURRENT_DATE
      END,
      COALESCE(x.amount, 0),
      COALESCE(NULLIF(regexp_replace(x.direction::text, '[^0-9-]', '', 'g'), '')::INT, 1),
      x.description, x.document_type,
      NULLIF(regexp_replace(x.source_offset::text, '[^0-9-]', '', 'g'), '')::BIGINT,
      COALESCE(x.exchange_rate, 1.0),
      COALESCE(x.nis_amount, x.amount * COALESCE(x.exchange_rate, 1.0), x.amount)
    FROM jsonb_to_recordset(p_items) AS x(
      document TEXT, line_index TEXT, account TEXT, currency TEXT, day TEXT,
      amount NUMERIC, direction TEXT, description TEXT, document_type TEXT, source_offset TEXT,
      exchange_rate NUMERIC, nis_amount NUMERIC
    )
    ON CONFLICT (store_id, document, line_index, account, direction) DO UPDATE SET
      day = EXCLUDED.day,
      amount = EXCLUDED.amount,
      exchange_rate = EXCLUDED.exchange_rate,
      nis_amount = EXCLUDED.nis_amount,
      description = EXCLUDED.description,
      document_type = EXCLUDED.document_type,
      snapshot_id = EXCLUDED.snapshot_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;

  ELSIF p_kind = 'invoice_items' THEN
    INSERT INTO public.shamel_invoice_items (
      store_id, snapshot_id, document, line_index, day, item_code, item_name,
      quantity, price, total, location
    )
    SELECT DISTINCT ON (x.document, x.line_index, x.item_code)
      p_store_id, p_snapshot_id, x.document,
      COALESCE(NULLIF(regexp_replace(x.line_index::text, '[^0-9-]', '', 'g'), '')::INT, 0),
      CASE 
        WHEN x.day IS NOT NULL AND x.day ~ '^\d{4}-\d{2}-\d{2}' THEN x.day::DATE
        ELSE CURRENT_DATE
      END,
      x.item_code, COALESCE(x.item_name, 'صنف'),
      COALESCE(x.quantity, 0), COALESCE(x.price, 0), COALESCE(x.total, 0),
      COALESCE(NULLIF(regexp_replace(x.location::text, '[^0-9-]', '', 'g'), '')::INT, 0)
    FROM jsonb_to_recordset(p_items) AS x(
      document TEXT, line_index TEXT, day TEXT, item_code TEXT, item_name TEXT,
      quantity NUMERIC, price NUMERIC, total NUMERIC, location TEXT
    )
    ON CONFLICT (store_id, document, line_index, item_code) DO UPDATE SET
      day = EXCLUDED.day,
      item_name = EXCLUDED.item_name,
      quantity = EXCLUDED.quantity,
      price = EXCLUDED.price,
      total = EXCLUDED.total,
      location = EXCLUDED.location,
      snapshot_id = EXCLUDED.snapshot_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;

  ELSE
    RAISE EXCEPTION 'Unknown kind: %', p_kind;
  END IF;

  RETURN jsonb_build_object('success', TRUE, 'count', v_count, 'processed', v_count);
END;
$$;
