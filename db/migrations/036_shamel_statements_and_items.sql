-- Migration 036: Shamel Statements, Item Movement Cards, and Document Details
-- Isolated tables & RPCs for deep financial statements and item tracking.

BEGIN;

-- 1. Journal entries table for customer & account ledger
CREATE TABLE IF NOT EXISTS public.shamel_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  snapshot_id TEXT,
  document TEXT NOT NULL,
  line_index INTEGER NOT NULL DEFAULT 0,
  account TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'ILS',
  day DATE NOT NULL,
  amount NUMERIC(15, 2) NOT NULL DEFAULT 0,
  direction INTEGER NOT NULL DEFAULT 1, -- 1 = debit, 2 = credit
  description TEXT,
  document_type TEXT,
  source_offset BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shamel_entries_store_acc ON public.shamel_entries(store_id, account, currency, day);
CREATE INDEX IF NOT EXISTS idx_shamel_entries_store_doc ON public.shamel_entries(store_id, document);

-- 2. Invoice line items table for item movement card and document details
CREATE TABLE IF NOT EXISTS public.shamel_invoice_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  snapshot_id TEXT,
  document TEXT NOT NULL,
  line_index INTEGER NOT NULL DEFAULT 0,
  day DATE NOT NULL,
  item_code TEXT NOT NULL,
  item_name TEXT NOT NULL,
  quantity NUMERIC(15, 3) NOT NULL DEFAULT 0,
  price NUMERIC(15, 2) NOT NULL DEFAULT 0,
  total NUMERIC(15, 2) NOT NULL DEFAULT 0,
  location INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shamel_invoice_items_store_item ON public.shamel_invoice_items(store_id, item_code, day DESC);
CREATE INDEX IF NOT EXISTS idx_shamel_invoice_items_store_doc ON public.shamel_invoice_items(store_id, document);

-- 3. RLS
ALTER TABLE public.shamel_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shamel_invoice_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "shamel_entries_store" ON public.shamel_entries;
CREATE POLICY "shamel_entries_store" ON public.shamel_entries
  FOR ALL USING (is_store_member(store_id)) WITH CHECK (is_store_member(store_id));

DROP POLICY IF EXISTS "shamel_invoice_items_store" ON public.shamel_invoice_items;
CREATE POLICY "shamel_invoice_items_store" ON public.shamel_invoice_items
  FOR ALL USING (is_store_member(store_id)) WITH CHECK (is_store_member(store_id));

GRANT ALL ON public.shamel_entries TO authenticated, service_role;
GRANT ALL ON public.shamel_invoice_items TO authenticated, service_role;

-- 4. Update shamel_reset_store to wipe entries and invoice items as well
CREATE OR REPLACE FUNCTION public.shamel_reset_store(
  p_store_id UUID,
  p_wipe_operational BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_customers_count INT := 0;
  v_stock_count INT := 0;
  v_cheques_count INT := 0;
  v_accounts_count INT := 0;
  v_entries_count INT := 0;
  v_inv_items_count INT := 0;
BEGIN
  -- 1. Wipe isolated explorer tables
  DELETE FROM public.shamel_customers WHERE store_id = p_store_id;
  GET DIAGNOSTICS v_customers_count = ROW_COUNT;

  DELETE FROM public.shamel_stock WHERE store_id = p_store_id;
  GET DIAGNOSTICS v_stock_count = ROW_COUNT;

  DELETE FROM public.shamel_cheques WHERE store_id = p_store_id;
  GET DIAGNOSTICS v_cheques_count = ROW_COUNT;

  DELETE FROM public.shamel_accounts WHERE store_id = p_store_id;
  GET DIAGNOSTICS v_accounts_count = ROW_COUNT;

  DELETE FROM public.shamel_assets WHERE store_id = p_store_id;

  DELETE FROM public.shamel_entries WHERE store_id = p_store_id;
  GET DIAGNOSTICS v_entries_count = ROW_COUNT;

  DELETE FROM public.shamel_invoice_items WHERE store_id = p_store_id;
  GET DIAGNOSTICS v_inv_items_count = ROW_COUNT;

  DELETE FROM public.shamel_snapshots WHERE store_id = p_store_id;

  -- 2. Optionally wipe operational data that was imported from Shamel
  IF p_wipe_operational THEN
    DELETE FROM public.checks WHERE store_id = p_store_id;
    DELETE FROM public.products WHERE store_id = p_store_id AND shamel_code IS NOT NULL;
    DELETE FROM public.customers WHERE store_id = p_store_id AND (shamel_code IS NOT NULL OR notes LIKE '%شامل%');
    DELETE FROM public.accounts WHERE store_id = p_store_id AND shamel_code IS NOT NULL;
    DELETE FROM public.cost_centers WHERE store_id = p_store_id;
    DELETE FROM public.fixed_assets WHERE store_id = p_store_id;
    DELETE FROM public.sales_reps WHERE store_id = p_store_id;
    DELETE FROM public.customer_price_lists WHERE store_id = p_store_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'deleted_customers', v_customers_count,
    'deleted_stock', v_stock_count,
    'deleted_cheques', v_cheques_count,
    'deleted_accounts', v_accounts_count,
    'deleted_entries', v_entries_count,
    'deleted_invoice_items', v_inv_items_count
  );
END;
$$;

-- 5. RPC: shamel_statement
CREATE OR REPLACE FUNCTION public.shamel_statement(
  p_store_id UUID,
  p_code TEXT,
  p_currency TEXT DEFAULT 'ILS',
  p_from DATE DEFAULT NULL,
  p_to DATE DEFAULT NULL,
  p_offset INT DEFAULT 0,
  p_limit INT DEFAULT 200
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_customer RECORD;
  v_opening NUMERIC(15, 2) := 0;
  v_dr NUMERIC(15, 2) := 0;
  v_cr NUMERIC(15, 2) := 0;
  v_total_entries BIGINT := 0;
  v_rows JSONB := '[]'::JSONB;
  v_cheques JSONB := '[]'::JSONB;
  v_has_entries BOOLEAN := FALSE;
BEGIN
  -- 1. Find Customer
  SELECT * INTO v_customer
  FROM public.shamel_customers
  WHERE store_id = p_store_id AND code = p_code;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'CUSTOMER_NOT_FOUND', 'message', 'الزبون غير موجود');
  END IF;

  -- 2. Fetch Customer Cheques
  SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.due_date DESC, c.cheque_number), '[]'::JSONB)
  INTO v_cheques
  FROM (
    SELECT id, document, cheque_number, bank_code, bank_name, branch_code, due_date, amount, currency, status, status_name
    FROM public.shamel_cheques
    WHERE store_id = p_store_id AND customer_code = p_code
  ) c;

  -- 3. Check if entries exist for this customer in shamel_entries
  SELECT EXISTS(
    SELECT 1 FROM public.shamel_entries
    WHERE store_id = p_store_id AND account = p_code
  ) INTO v_has_entries;

  IF v_has_entries THEN
    -- Opening balance before p_from
    IF p_from IS NOT NULL THEN
      SELECT coalesce(sum(CASE direction WHEN 1 THEN amount WHEN 2 THEN -amount ELSE 0 END), 0)
      INTO v_opening
      FROM public.shamel_entries
      WHERE store_id = p_store_id AND account = p_code AND day < p_from;
    ELSE
      v_opening := 0;
    END IF;

    -- Period totals
    SELECT
      count(*),
      coalesce(sum(amount) FILTER (WHERE direction = 1), 0),
      coalesce(sum(amount) FILTER (WHERE direction = 2), 0)
    INTO v_total_entries, v_dr, v_cr
    FROM public.shamel_entries
    WHERE store_id = p_store_id AND account = p_code
      AND (p_from IS NULL OR day >= p_from)
      AND (p_to IS NULL OR day <= p_to);

    -- Paginated Rows with running balance
    SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::JSONB) INTO v_rows
    FROM (
      SELECT
        document,
        line_index,
        day,
        description,
        document_type,
        CASE WHEN direction = 1 THEN amount ELSE 0 END AS debit,
        CASE WHEN direction = 2 THEN amount ELSE 0 END AS credit,
        v_opening + sum(CASE direction WHEN 1 THEN amount WHEN 2 THEN -amount ELSE 0 END)
          OVER (ORDER BY day, document, line_index ROWS UNBOUNDED PRECEDING) AS running_balance
      FROM public.shamel_entries
      WHERE store_id = p_store_id AND account = p_code
        AND (p_from IS NULL OR day >= p_from)
        AND (p_to IS NULL OR day <= p_to)
      ORDER BY day, document, line_index
      LIMIT p_limit OFFSET p_offset
    ) t;

    RETURN jsonb_build_object(
      'customer', jsonb_build_object(
        'code', v_customer.code,
        'name', v_customer.name,
        'phone', v_customer.phone,
        'address', v_customer.address,
        'balance', v_customer.balance
      ),
      'has_ledger_entries', true,
      'opening_balance', v_opening,
      'period_debit', v_dr,
      'period_credit', v_cr,
      'closing_balance', v_opening + v_dr - v_cr,
      'currency', p_currency,
      'total', v_total_entries,
      'rows', v_rows,
      'cheques', v_cheques,
      'offset', p_offset,
      'limit', p_limit
    );
  ELSE
    -- When ctrans.dat was not loaded, return clean customer balance and cheques
    RETURN jsonb_build_object(
      'customer', jsonb_build_object(
        'code', v_customer.code,
        'name', v_customer.name,
        'phone', v_customer.phone,
        'address', v_customer.address,
        'balance', v_customer.balance
      ),
      'has_ledger_entries', false,
      'opening_balance', v_customer.balance,
      'period_debit', 0,
      'period_credit', 0,
      'closing_balance', v_customer.balance,
      'currency', p_currency,
      'total', 0,
      'rows', '[]'::JSONB,
      'cheques', v_cheques,
      'offset', p_offset,
      'limit', p_limit
    );
  END IF;
END;
$$;

-- 6. RPC: shamel_item_card
CREATE OR REPLACE FUNCTION public.shamel_item_card(
  p_store_id UUID,
  p_item_code TEXT,
  p_from DATE DEFAULT NULL,
  p_to DATE DEFAULT NULL,
  p_type TEXT DEFAULT 'all', -- 'all', 'sales', 'purchases', 'returns'
  p_offset INT DEFAULT 0,
  p_limit INT DEFAULT 100
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_item RECORD;
  v_movements JSONB := '[]'::JSONB;
  v_total_movements BIGINT := 0;
  v_total_sold NUMERIC(15, 3) := 0;
  v_total_purchased NUMERIC(15, 3) := 0;
  v_last_sale JSONB := NULL;
  v_last_purchase JSONB := NULL;
BEGIN
  -- 1. Item info
  SELECT * INTO v_item
  FROM public.shamel_stock
  WHERE store_id = p_store_id AND code = p_item_code;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'ITEM_NOT_FOUND', 'message', 'الصنف غير موجود');
  END IF;

  -- 2. Stats from invoice items
  SELECT coalesce(sum(quantity), 0) INTO v_total_sold
  FROM public.shamel_invoice_items
  WHERE store_id = p_store_id AND item_code = p_item_code AND (document LIKE 'I%' OR document LIKE 'فاتورة%');

  SELECT coalesce(sum(quantity), 0) INTO v_total_purchased
  FROM public.shamel_invoice_items
  WHERE store_id = p_store_id AND item_code = p_item_code AND (document LIKE 'H%' OR document LIKE 'شراء%');

  -- Last sale
  SELECT to_jsonb(s) INTO v_last_sale
  FROM (
    SELECT day, price, quantity, document
    FROM public.shamel_invoice_items
    WHERE store_id = p_store_id AND item_code = p_item_code AND (document LIKE 'I%' OR document LIKE 'فاتورة%')
    ORDER BY day DESC, document DESC
    LIMIT 1
  ) s;

  -- Last purchase
  SELECT to_jsonb(p) INTO v_last_purchase
  FROM (
    SELECT day, price, quantity, document
    FROM public.shamel_invoice_items
    WHERE store_id = p_store_id AND item_code = p_item_code AND (document LIKE 'H%' OR document LIKE 'شراء%')
    ORDER BY day DESC, document DESC
    LIMIT 1
  ) p;

  -- 3. Movements query
  SELECT count(*) INTO v_total_movements
  FROM public.shamel_invoice_items i
  WHERE i.store_id = p_store_id AND i.item_code = p_item_code
    AND (p_from IS NULL OR i.day >= p_from)
    AND (p_to IS NULL OR i.day <= p_to)
    AND (
      p_type = 'all'
      OR (p_type = 'sales' AND (i.document LIKE 'I%' OR i.document LIKE 'فاتورة%'))
      OR (p_type = 'purchases' AND (i.document LIKE 'H%' OR i.document LIKE 'شراء%'))
      OR (p_type = 'returns' AND (i.document LIKE 'M%' OR i.document LIKE 'R%' OR i.document LIKE 'مردود%'))
    );

  SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::JSONB) INTO v_movements
  FROM (
    SELECT
      i.document,
      i.line_index,
      i.day,
      i.quantity,
      i.price,
      i.total,
      i.location,
      CASE
        WHEN i.document LIKE 'I%' THEN 'مبيعات'
        WHEN i.document LIKE 'H%' THEN 'مشتريات'
        WHEN i.document LIKE 'M%' THEN 'مردودات'
        ELSE 'حركة مخزنية'
      END AS movement_type
    FROM public.shamel_invoice_items i
    WHERE i.store_id = p_store_id AND i.item_code = p_item_code
      AND (p_from IS NULL OR i.day >= p_from)
      AND (p_to IS NULL OR i.day <= p_to)
      AND (
        p_type = 'all'
        OR (p_type = 'sales' AND (i.document LIKE 'I%' OR i.document LIKE 'فاتورة%'))
        OR (p_type = 'purchases' AND (i.document LIKE 'H%' OR i.document LIKE 'شراء%'))
        OR (p_type = 'returns' AND (i.document LIKE 'M%' OR i.document LIKE 'R%' OR i.document LIKE 'مردود%'))
      )
    ORDER BY i.day DESC, i.document DESC
    LIMIT p_limit OFFSET p_offset
  ) t;

  RETURN jsonb_build_object(
    'item', jsonb_build_object(
      'code', v_item.code,
      'name', v_item.name,
      'barcode', v_item.barcode,
      'price', v_item.price,
      'cost_price', v_item.cost_price,
      'stock_quantity', v_item.quantity
    ),
    'stats', jsonb_build_object(
      'total_stock', v_item.quantity,
      'total_sold', v_total_sold,
      'total_purchased', v_total_purchased,
      'last_sale', v_last_sale,
      'last_purchase', v_last_purchase
    ),
    'total', v_total_movements,
    'rows', v_movements,
    'offset', p_offset,
    'limit', p_limit
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.shamel_statement(UUID, TEXT, TEXT, DATE, DATE, INT, INT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.shamel_item_card(UUID, TEXT, DATE, DATE, TEXT, INT, INT) TO authenticated, service_role;

COMMIT;
