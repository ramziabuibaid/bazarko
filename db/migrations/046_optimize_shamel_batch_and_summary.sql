-- Migration 046: Optimize shamel_save_isolated_batch for high volume entries and decouple customer summary aggregation

-- 1. Optimized shamel_save_isolated_batch
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
      barcode = EXCLUDED.barcode,
      price = EXCLUDED.price,
      cost_price = EXCLUDED.cost_price,
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
      COALESCE(x.status_code, 0), COALESCE(x.status_name, 'في الصندوق'),
      COALESCE(x.status, 'in_portfolio'), COALESCE(x.type, 'received')
    FROM jsonb_to_recordset(p_items) AS x(
      document TEXT, cheque_number TEXT, due_date DATE, bank_code TEXT, bank_name TEXT,
      branch_code TEXT, branch_name TEXT, account_number TEXT, drawer_name TEXT,
      customer_code TEXT, customer_name TEXT, amount NUMERIC, currency TEXT,
      status_code INT, status_name TEXT, status TEXT, type TEXT
    )
    ON CONFLICT (store_id, document, cheque_number, amount) DO UPDATE SET
      status = EXCLUDED.status,
      status_name = EXCLUDED.status_name,
      due_date = EXCLUDED.due_date,
      snapshot_id = EXCLUDED.snapshot_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;

  ELSIF p_kind = 'accounts' THEN
    INSERT INTO public.shamel_accounts (
      store_id, snapshot_id, code, name, parent_code, type, is_group, currency, balance
    )
    SELECT DISTINCT ON (x.code)
      p_store_id, p_snapshot_id, x.code, x.name, x.parent_code, x.type,
      COALESCE(x.is_group, FALSE), COALESCE(x.currency, 'ILS'), COALESCE(x.balance, 0)
    FROM jsonb_to_recordset(p_items) AS x(
      code TEXT, name TEXT, parent_code TEXT, type TEXT, is_group BOOLEAN, currency TEXT, balance NUMERIC
    )
    ON CONFLICT (store_id, code) DO UPDATE SET
      name = EXCLUDED.name,
      parent_code = EXCLUDED.parent_code,
      type = EXCLUDED.type,
      is_group = EXCLUDED.is_group,
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
      p_store_id, p_snapshot_id, x.document, COALESCE(x.line_index, 0),
      x.account, COALESCE(x.currency, 'ILS'), COALESCE(x.day, CURRENT_DATE),
      COALESCE(x.amount, 0), COALESCE(x.direction, 1),
      x.description, x.document_type, x.source_offset,
      COALESCE(x.exchange_rate, 1.0),
      COALESCE(x.nis_amount, x.amount * COALESCE(x.exchange_rate, 1.0), x.amount)
    FROM jsonb_to_recordset(p_items) AS x(
      document TEXT, line_index INT, account TEXT, currency TEXT, day DATE,
      amount NUMERIC, direction INT, description TEXT, document_type TEXT, source_offset BIGINT,
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
      p_store_id, p_snapshot_id, x.document, COALESCE(x.line_index, 0),
      COALESCE(x.day, CURRENT_DATE), x.item_code, COALESCE(x.item_name, 'صنف'),
      COALESCE(x.quantity, 0), COALESCE(x.price, 0), COALESCE(x.total, 0),
      COALESCE(x.location, 0)
    FROM jsonb_to_recordset(p_items) AS x(
      document TEXT, line_index INT, day DATE, item_code TEXT, item_name TEXT,
      quantity NUMERIC, price NUMERIC, total NUMERIC, location INT
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
  END IF;

  RETURN jsonb_build_object('success', TRUE, 'processed', v_count);
END;
$$;

-- 2. Dedicated single-pass Customer Summaries Refresh function
CREATE OR REPLACE FUNCTION public.shamel_refresh_customer_summaries(p_store_id UUID)
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

  UPDATE public.shamel_customers c
  SET 
    equivalent_balance = coalesce(sub.eq_bal, c.balance),
    has_balance = (abs(coalesce(sub.eq_bal, c.balance)) > 0.001),
    last_invoice_date = sub.last_inv,
    last_receipt_date = sub.last_rec
  FROM (
    SELECT 
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
    WHERE store_id = p_store_id
    GROUP BY account
  ) sub
  WHERE c.store_id = p_store_id AND c.code = sub.account;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN jsonb_build_object('success', TRUE, 'updated_customers', v_count);
END;
$$;
