-- Migration 065: Protect shamel_stock cost_price and price from being overwritten with zero during sync

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
      p_store_id, p_snapshot_id, x.document, x.cheque_number, x.due_date,
      x.bank_code, COALESCE(x.bank_name, 'بنك ' || COALESCE(x.bank_code, '')),
      x.branch_code, x.branch_name, x.account_number,
      x.customer_code, x.customer_name,
      x.amount, COALESCE(x.currency, 'ILS'),
      x.status_code, x.status_name,
      COALESCE(x.status, 'under_collection'),
      COALESCE(x.type, 'incoming')
    FROM jsonb_to_recordset(p_items) AS x(
      document TEXT, cheque_number TEXT, due_date DATE, bank_code TEXT, bank_name TEXT,
      branch_code TEXT, branch_name TEXT, account_number TEXT, customer_code TEXT,
      customer_name TEXT, amount NUMERIC, currency TEXT, status_code TEXT, status_name TEXT,
      status TEXT, type TEXT
    )
    ON CONFLICT (store_id, document, cheque_number, amount) DO UPDATE SET
      due_date = EXCLUDED.due_date,
      bank_code = EXCLUDED.bank_code,
      bank_name = EXCLUDED.bank_name,
      customer_code = EXCLUDED.customer_code,
      customer_name = EXCLUDED.customer_name,
      status_code = EXCLUDED.status_code,
      status_name = EXCLUDED.status_name,
      status = EXCLUDED.status,
      snapshot_id = EXCLUDED.snapshot_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;

  ELSIF p_kind = 'accounts' THEN
    INSERT INTO public.shamel_accounts (
      store_id, snapshot_id, code, name, parent_code, account_type, level, is_leaf, balance
    )
    SELECT DISTINCT ON (x.code)
      p_store_id, p_snapshot_id, x.code, x.name, x.parent_code,
      COALESCE(x.account_type, 'asset'), COALESCE(x.level, 1),
      COALESCE(x.is_leaf, TRUE), COALESCE(x.balance, 0)
    FROM jsonb_to_recordset(p_items) AS x(
      code TEXT, name TEXT, parent_code TEXT, account_type TEXT, level INT,
      is_leaf BOOLEAN, balance NUMERIC
    )
    ON CONFLICT (store_id, code) DO UPDATE SET
      name = EXCLUDED.name,
      parent_code = EXCLUDED.parent_code,
      balance = EXCLUDED.balance,
      snapshot_id = EXCLUDED.snapshot_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;

  ELSIF p_kind = 'entries' THEN
    INSERT INTO public.shamel_entries (
      store_id, snapshot_id, document, line_index, account, currency,
      day, amount, direction, description, document_type, source_offset,
      exchange_rate, nis_amount
    )
    SELECT
      p_store_id, p_snapshot_id, x.document, x.line_index, x.account,
      COALESCE(x.currency, 'ILS'), x.day, x.amount, x.direction,
      x.description, x.document_type, x.source_offset,
      COALESCE(x.exchange_rate, 1.0), COALESCE(x.nis_amount, x.amount)
    FROM jsonb_to_recordset(p_items) AS x(
      document TEXT, line_index INT, account TEXT, currency TEXT,
      day DATE, amount NUMERIC, direction INT, description TEXT,
      document_type TEXT, source_offset BIGINT, exchange_rate NUMERIC, nis_amount NUMERIC
    );
    GET DIAGNOSTICS v_count = ROW_COUNT;

  ELSIF p_kind = 'invoice_items' THEN
    INSERT INTO public.shamel_invoice_items (
      store_id, snapshot_id, document, line_index, day,
      item_code, item_name, quantity, price, total, location
    )
    SELECT
      p_store_id, p_snapshot_id, x.document, x.line_index, x.day,
      x.item_code, x.item_name, x.quantity, x.price, x.total, x.location
    FROM jsonb_to_recordset(p_items) AS x(
      document TEXT, line_index INT, day DATE,
      item_code TEXT, item_name TEXT, quantity NUMERIC,
      price NUMERIC, total NUMERIC, location INT
    );
    GET DIAGNOSTICS v_count = ROW_COUNT;

  ELSE
    RAISE EXCEPTION 'Unknown kind: %', p_kind;
  END IF;

  RETURN jsonb_build_object('success', TRUE, 'count', v_count);
END;
$$;
