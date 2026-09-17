-- Migration 037: Support entries and invoice_items in shamel_save_isolated_batch
BEGIN;

-- 1. Unique indexes for idempotent upserts
CREATE UNIQUE INDEX IF NOT EXISTS idx_shamel_entries_upsert 
  ON public.shamel_entries(store_id, document, line_index, account, direction);

CREATE UNIQUE INDEX IF NOT EXISTS idx_shamel_invoice_items_upsert 
  ON public.shamel_invoice_items(store_id, document, line_index, item_code);

-- 2. Update shamel_save_isolated_batch
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

  ELSIF p_kind = 'entries' THEN
    FOR v_rec IN SELECT * FROM jsonb_to_recordset(p_items) AS x(
      document TEXT, line_index INT, account TEXT, currency TEXT, day DATE,
      amount NUMERIC, direction INT, description TEXT, document_type TEXT, source_offset BIGINT
    ) LOOP
      INSERT INTO public.shamel_entries (
        store_id, snapshot_id, document, line_index, account, currency, day,
        amount, direction, description, document_type, source_offset
      ) VALUES (
        p_store_id, p_snapshot_id, v_rec.document, COALESCE(v_rec.line_index, 0),
        v_rec.account, COALESCE(v_rec.currency, 'ILS'), COALESCE(v_rec.day, CURRENT_DATE),
        COALESCE(v_rec.amount, 0), COALESCE(v_rec.direction, 1),
        v_rec.description, v_rec.document_type, v_rec.source_offset
      )
      ON CONFLICT (store_id, document, line_index, account, direction) DO UPDATE SET
        day = EXCLUDED.day,
        amount = EXCLUDED.amount,
        description = EXCLUDED.description,
        document_type = EXCLUDED.document_type,
        snapshot_id = EXCLUDED.snapshot_id;
      v_count := v_count + 1;
    END LOOP;

  ELSIF p_kind = 'invoice_items' THEN
    FOR v_rec IN SELECT * FROM jsonb_to_recordset(p_items) AS x(
      document TEXT, line_index INT, day DATE, item_code TEXT, item_name TEXT,
      quantity NUMERIC, price NUMERIC, total NUMERIC, location INT
    ) LOOP
      INSERT INTO public.shamel_invoice_items (
        store_id, snapshot_id, document, line_index, day, item_code, item_name,
        quantity, price, total, location
      ) VALUES (
        p_store_id, p_snapshot_id, v_rec.document, COALESCE(v_rec.line_index, 0),
        COALESCE(v_rec.day, CURRENT_DATE), v_rec.item_code, COALESCE(v_rec.item_name, 'صنف'),
        COALESCE(v_rec.quantity, 0), COALESCE(v_rec.price, 0), COALESCE(v_rec.total, 0),
        COALESCE(v_rec.location, 0)
      )
      ON CONFLICT (store_id, document, line_index, item_code) DO UPDATE SET
        day = EXCLUDED.day,
        item_name = EXCLUDED.item_name,
        quantity = EXCLUDED.quantity,
        price = EXCLUDED.price,
        total = EXCLUDED.total,
        location = EXCLUDED.location,
        snapshot_id = EXCLUDED.snapshot_id;
      v_count := v_count + 1;
    END LOOP;
  END IF;

  RETURN jsonb_build_object('success', TRUE, 'processed', v_count);
END;
$$;

COMMIT;
