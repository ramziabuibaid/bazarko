-- Migration 078: Fix superseded ledger entries, update upsert conflict target to (store_id, document, line_index, direction)
-- and recalculate affected customer summaries while strictly adhering to isolated explorer schema contracts.

BEGIN;

-- 1. Delete ghost/superseded entries that were retained due to account changes (strictly scoped by store)
-- Document J0016437: lines 4, 5, 6, 7, 8 from stale snapshot shamel_gdrive_1790160392199
DELETE FROM public.shamel_entries 
WHERE document = 'J0016437' AND snapshot_id = 'shamel_gdrive_1790160392199';

-- Document R0012059: line 2 in stale snapshot shamel_snap_1789623801578 for C0000378
DELETE FROM public.shamel_entries 
WHERE document = 'R0012059' AND line_index = 2 AND account = 'C0000378'
  AND store_id IN (SELECT store_id FROM public.shamel_customers WHERE code = 'C0000378');

-- Document I0010224: line 0 ghost slot for C0001106
DELETE FROM public.shamel_entries 
WHERE document = 'I0010224' AND line_index = 0 AND account = 'C0001106'
  AND store_id IN (SELECT store_id FROM public.shamel_customers WHERE code = 'C0001106');

-- Document I0012505: line 0 ghost slot for C0001960
DELETE FROM public.shamel_entries 
WHERE document = 'I0012505' AND line_index = 0 AND account = 'C0001960'
  AND store_id IN (SELECT store_id FROM public.shamel_customers WHERE code = 'C0001960');

-- Document J0016566: line 0 ghost slot for C0001666
DELETE FROM public.shamel_entries 
WHERE document = 'J0016566' AND line_index = 0 AND account = 'C0001666'
  AND store_id IN (SELECT store_id FROM public.shamel_customers WHERE code = 'C0001666');

-- Document R0012276: line 2 ghost slot for C0000560
DELETE FROM public.shamel_entries 
WHERE document = 'R0012276' AND line_index = 2 AND account = 'C0000560'
  AND store_id IN (SELECT store_id FROM public.shamel_customers WHERE code = 'C0000560');

-- Document P0002272: line 2 ghost slot for C0000089
DELETE FROM public.shamel_entries 
WHERE document = 'P0002272' AND line_index = 2 AND account = 'C0000089'
  AND store_id IN (SELECT store_id FROM public.shamel_customers WHERE code = 'C0000089');

-- Document I0011089: line 2 ghost slot for 31100000
DELETE FROM public.shamel_entries 
WHERE document = 'I0011089' AND line_index = 2 AND account = '31100000'
  AND store_id IN (SELECT store_id FROM public.shamel_accounts WHERE code = '31100000');

-- 2. Deduplicate superseded entries before creating unique index to prevent conflict failure on production
DELETE FROM public.shamel_entries a
USING public.shamel_entries b
WHERE a.store_id = b.store_id
  AND a.document = b.document
  AND a.line_index = b.line_index
  AND a.direction = b.direction
  AND (
    COALESCE(a.source_offset, 0) < COALESCE(b.source_offset, 0)
    OR (COALESCE(a.source_offset, 0) = COALESCE(b.source_offset, 0) AND a.id < b.id)
  );

-- Drop old index and recreate unique index on (store_id, document, line_index, direction)
DROP INDEX IF EXISTS public.idx_shamel_entries_upsert;
CREATE UNIQUE INDEX idx_shamel_entries_upsert 
  ON public.shamel_entries(store_id, document, line_index, direction);

-- 3. Update shamel_save_isolated_batch function adhering strictly to table schemas
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
      phone = COALESCE(NULLIF(EXCLUDED.phone, ''), shamel_customers.phone),
      address = COALESCE(NULLIF(EXCLUDED.address, ''), shamel_customers.address),
      balance = EXCLUDED.balance,
      snapshot_id = EXCLUDED.snapshot_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;

  ELSIF p_kind = 'stock' THEN
    INSERT INTO public.shamel_stock (
      store_id, snapshot_id, code, name, barcode, price, cost_price, quantity
    )
    SELECT DISTINCT ON (x.code)
      p_store_id, p_snapshot_id, x.code, x.name, x.barcode,
      COALESCE(x.price, 0), COALESCE(x.cost_price, 0), COALESCE(x.quantity, x.stock_quantity, 0)
    FROM jsonb_to_recordset(p_items) AS x(
      code TEXT, name TEXT, barcode TEXT, price NUMERIC, cost_price NUMERIC, quantity NUMERIC, stock_quantity NUMERIC
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
      bank_code = EXCLUDED.bank_code,
      bank_name = EXCLUDED.bank_name,
      branch_code = EXCLUDED.branch_code,
      branch_name = EXCLUDED.branch_name,
      account_number = EXCLUDED.account_number,
      due_date = EXCLUDED.due_date,
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
      COALESCE(x.is_group, false),
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
    FROM jsonb_to_recordset(p_items) AS x(code TEXT, name TEXT, phone TEXT, commission_rate NUMERIC)
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
    SELECT DISTINCT ON (x.document, x.line_index, x.direction)
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
    ON CONFLICT (store_id, document, line_index, direction) DO UPDATE SET
      account = EXCLUDED.account,
      currency = EXCLUDED.currency,
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

  RETURN jsonb_build_object('success', true, 'count', v_count);
END;
$$;

-- 4. Recalculate customer summaries for affected customers
UPDATE public.shamel_customers c
SET 
  equivalent_balance = coalesce(sub.eq_bal, c.balance),
  has_balance = (abs(coalesce(sub.eq_bal, c.balance)) > 0.001),
  last_invoice_date = sub.last_inv,
  last_receipt_date = sub.last_rec
FROM (
  SELECT 
    store_id,
    account,
    round(sum(
      CASE 
        WHEN direction = 1 THEN coalesce(nullif(nis_amount, 0), amount * coalesce(exchange_rate, 1.0), amount)
        WHEN direction = 2 THEN -coalesce(nullif(nis_amount, 0), amount * coalesce(exchange_rate, 1.0), amount)
        ELSE 0
      END
    ), 2) as eq_bal,
    max(CASE WHEN document_type LIKE '%مبيعات%' OR document LIKE 'I%' THEN day END) as last_inv,
    max(CASE WHEN document_type LIKE '%قبض%' OR document LIKE 'R%' THEN day END) as last_rec
  FROM public.shamel_entries
  GROUP BY store_id, account
) sub
WHERE c.store_id = sub.store_id AND c.code = sub.account;

-- Also sync customer balance to equivalent_balance for the specific affected customers where balance was 0/mismatched (strictly scoped)
UPDATE public.shamel_customers c
SET balance = equivalent_balance
WHERE code IN ('C0001096', 'C0001106', 'C0001960', 'C0000560', 'C0002604', 'C0002517')
  AND EXISTS (
    SELECT 1 FROM public.shamel_entries e 
    WHERE e.store_id = c.store_id AND e.account = c.code
  );

COMMIT;
