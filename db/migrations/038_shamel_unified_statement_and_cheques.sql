-- Migration 038: Unified NIS Statements, Currency Exchange Rates, and Advanced Cheques Explorer
BEGIN;

-- 1. Extend shamel_entries with exchange rate & nis equivalent
ALTER TABLE public.shamel_entries ADD COLUMN IF NOT EXISTS exchange_rate NUMERIC(10, 6) DEFAULT 1.0;
ALTER TABLE public.shamel_entries ADD COLUMN IF NOT EXISTS nis_amount NUMERIC(15, 2) DEFAULT 0.0;

-- 2. Extend shamel_customers with equivalent balance & activity dates
ALTER TABLE public.shamel_customers ADD COLUMN IF NOT EXISTS equivalent_balance NUMERIC(15, 2) DEFAULT 0.0;
ALTER TABLE public.shamel_customers ADD COLUMN IF NOT EXISTS has_balance BOOLEAN DEFAULT FALSE;
ALTER TABLE public.shamel_customers ADD COLUMN IF NOT EXISTS last_invoice_date DATE;
ALTER TABLE public.shamel_customers ADD COLUMN IF NOT EXISTS last_receipt_date DATE;

-- 3. Extend shamel_cheques with target endorsement & action doc
ALTER TABLE public.shamel_cheques ADD COLUMN IF NOT EXISTS target_account TEXT;
ALTER TABLE public.shamel_cheques ADD COLUMN IF NOT EXISTS target_name TEXT;
ALTER TABLE public.shamel_cheques ADD COLUMN IF NOT EXISTS action_doc TEXT;

-- 4. Fast indexes for ledger and cheques browse
CREATE INDEX IF NOT EXISTS idx_shamel_entries_unified 
  ON public.shamel_entries (store_id, account, day, document, line_index);

CREATE INDEX IF NOT EXISTS idx_shamel_cheques_adv
  ON public.shamel_cheques (store_id, due_date, status_name, bank_code);

-- 5. Updated shamel_statement supporting unified NIS calculation
CREATE OR REPLACE FUNCTION public.shamel_statement(
  p_store_id UUID,
  p_code TEXT,
  p_currency TEXT DEFAULT 'NIS',
  p_from DATE DEFAULT NULL,
  p_to DATE DEFAULT NULL,
  p_offset INT DEFAULT 0,
  p_limit INT DEFAULT 300
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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
  v_is_unified BOOLEAN := FALSE;
BEGIN
  IF NOT is_store_member(p_store_id) THEN
    RAISE EXCEPTION 'Not authorized for this store';
  END IF;

  -- 1. Find Customer
  SELECT * INTO v_customer
  FROM public.shamel_customers
  WHERE store_id = p_store_id AND code = p_code;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'CUSTOMER_NOT_FOUND', 'message', 'الزبون غير موجود');
  END IF;

  -- 2. Fetch Customer Cheques
  SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.due_date DESC NULLS LAST, c.cheque_number), '[]'::JSONB)
  INTO v_cheques
  FROM (
    SELECT id, document, cheque_number, bank_code, bank_name, branch_code, due_date, amount, currency, status, status_name, target_account, target_name
    FROM public.shamel_cheques
    WHERE store_id = p_store_id AND customer_code = p_code
  ) c;

  -- 3. Check if entries exist
  SELECT EXISTS(
    SELECT 1 FROM public.shamel_entries
    WHERE store_id = p_store_id AND account = p_code
  ) INTO v_has_entries;

  v_is_unified := (p_currency IS NULL OR p_currency = 'NIS' OR p_currency = 'ILS' OR p_currency = 'ALL');

  IF v_has_entries THEN
    IF v_is_unified THEN
      -- UNIFIED NIS CALCULATION (default Al-Shamel behavior)
      -- Opening balance before p_from
      IF p_from IS NOT NULL THEN
        SELECT coalesce(sum(
          CASE 
            WHEN direction = 1 THEN coalesce(nullif(nis_amount, 0), amount * coalesce(exchange_rate, 1.0), amount)
            WHEN direction = 2 THEN -coalesce(nullif(nis_amount, 0), amount * coalesce(exchange_rate, 1.0), amount)
            ELSE 0
          END
        ), 0)
        INTO v_opening
        FROM public.shamel_entries
        WHERE store_id = p_store_id AND account = p_code AND day < p_from;
      ELSE
        v_opening := 0;
      END IF;

      -- Period totals
      SELECT
        count(*),
        coalesce(sum(CASE WHEN direction = 1 THEN coalesce(nullif(nis_amount, 0), amount * coalesce(exchange_rate, 1.0), amount) ELSE 0 END), 0),
        coalesce(sum(CASE WHEN direction = 2 THEN coalesce(nullif(nis_amount, 0), amount * coalesce(exchange_rate, 1.0), amount) ELSE 0 END), 0)
      INTO v_total_entries, v_dr, v_cr
      FROM public.shamel_entries
      WHERE store_id = p_store_id AND account = p_code
        AND (p_from IS NULL OR day >= p_from)
        AND (p_to IS NULL OR day <= p_to);

      -- Rows
      SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::JSONB) INTO v_rows
      FROM (
        SELECT
          document,
          line_index,
          day,
          description,
          document_type,
          currency AS original_currency,
          amount AS original_amount,
          exchange_rate,
          CASE WHEN direction = 1 THEN coalesce(nullif(nis_amount, 0), amount * coalesce(exchange_rate, 1.0), amount) ELSE 0 END AS debit,
          CASE WHEN direction = 2 THEN coalesce(nullif(nis_amount, 0), amount * coalesce(exchange_rate, 1.0), amount) ELSE 0 END AS credit,
          v_opening + sum(
            CASE 
              WHEN direction = 1 THEN coalesce(nullif(nis_amount, 0), amount * coalesce(exchange_rate, 1.0), amount)
              WHEN direction = 2 THEN -coalesce(nullif(nis_amount, 0), amount * coalesce(exchange_rate, 1.0), amount)
              ELSE 0
            END
          ) OVER (ORDER BY day, document, line_index ROWS UNBOUNDED PRECEDING) AS running_balance
        FROM public.shamel_entries
        WHERE store_id = p_store_id AND account = p_code
          AND (p_from IS NULL OR day >= p_from)
          AND (p_to IS NULL OR day <= p_to)
        ORDER BY day, document, line_index
        LIMIT p_limit OFFSET p_offset
      ) t;

    ELSE
      -- Specific foreign currency statement (JOD, USD, EUR)
      IF p_from IS NOT NULL THEN
        SELECT coalesce(sum(CASE direction WHEN 1 THEN amount WHEN 2 THEN -amount ELSE 0 END), 0)
        INTO v_opening
        FROM public.shamel_entries
        WHERE store_id = p_store_id AND account = p_code AND currency = p_currency AND day < p_from;
      ELSE
        v_opening := 0;
      END IF;

      SELECT
        count(*),
        coalesce(sum(amount) FILTER (WHERE direction = 1), 0),
        coalesce(sum(amount) FILTER (WHERE direction = 2), 0)
      INTO v_total_entries, v_dr, v_cr
      FROM public.shamel_entries
      WHERE store_id = p_store_id AND account = p_code AND currency = p_currency
        AND (p_from IS NULL OR day >= p_from)
        AND (p_to IS NULL OR day <= p_to);

      SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::JSONB) INTO v_rows
      FROM (
        SELECT
          document,
          line_index,
          day,
          description,
          document_type,
          currency AS original_currency,
          amount AS original_amount,
          exchange_rate,
          CASE WHEN direction = 1 THEN amount ELSE 0 END AS debit,
          CASE WHEN direction = 2 THEN amount ELSE 0 END AS credit,
          v_opening + sum(CASE direction WHEN 1 THEN amount WHEN 2 THEN -amount ELSE 0 END)
            OVER (ORDER BY day, document, line_index ROWS UNBOUNDED PRECEDING) AS running_balance
        FROM public.shamel_entries
        WHERE store_id = p_store_id AND account = p_code AND currency = p_currency
          AND (p_from IS NULL OR day >= p_from)
          AND (p_to IS NULL OR day <= p_to)
        ORDER BY day, document, line_index
        LIMIT p_limit OFFSET p_offset
      ) t;
    END IF;

    RETURN jsonb_build_object(
      'customer', jsonb_build_object(
        'code', v_customer.code,
        'name', v_customer.name,
        'phone', v_customer.phone,
        'address', v_customer.address,
        'balance', COALESCE(v_customer.equivalent_balance, v_customer.balance),
        'equivalent_balance', COALESCE(v_customer.equivalent_balance, v_customer.balance)
      ),
      'has_ledger_entries', true,
      'opening_balance', v_opening,
      'period_debit', v_dr,
      'period_credit', v_cr,
      'closing_balance', v_opening + v_dr - v_cr,
      'currency', CASE WHEN v_is_unified THEN 'NIS' ELSE p_currency END,
      'total', v_total_entries,
      'rows', v_rows,
      'cheques', v_cheques,
      'offset', p_offset,
      'limit', p_limit
    );

  ELSE
    -- When entries are not loaded, fallback to master balance
    RETURN jsonb_build_object(
      'customer', jsonb_build_object(
        'code', v_customer.code,
        'name', v_customer.name,
        'phone', v_customer.phone,
        'address', v_customer.address,
        'balance', v_customer.balance,
        'equivalent_balance', COALESCE(v_customer.equivalent_balance, v_customer.balance)
      ),
      'has_ledger_entries', false,
      'opening_balance', v_customer.balance,
      'period_debit', 0,
      'period_credit', 0,
      'closing_balance', v_customer.balance,
      'currency', 'NIS',
      'total', 0,
      'rows', '[]'::JSONB,
      'cheques', v_cheques,
      'offset', p_offset,
      'limit', p_limit
    );
  END IF;
END;
$$;

-- 6. Advanced Cheques Explorer Function (matching Manar myshop)
CREATE OR REPLACE FUNCTION public.shamel_cheques_browse(
  p_store_id UUID,
  p_query TEXT DEFAULT '',
  p_status TEXT DEFAULT 'all',
  p_bank TEXT DEFAULT 'all',
  p_from DATE DEFAULT NULL,
  p_to DATE DEFAULT NULL,
  p_cheque_no TEXT DEFAULT '',
  p_account_no TEXT DEFAULT '',
  p_amount NUMERIC DEFAULT NULL,
  p_offset INT DEFAULT 0,
  p_limit INT DEFAULT 50
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_stats JSONB;
  v_filtered_total BIGINT := 0;
  v_rows JSONB := '[]'::JSONB;
  norm_q TEXT;
  norm_chq TEXT;
  norm_acc TEXT;
  norm_status TEXT;
BEGIN
  IF NOT is_store_member(p_store_id) THEN
    RAISE EXCEPTION 'Not authorized for this store';
  END IF;

  norm_q := lower(trim(COALESCE(p_query, '')));
  norm_q := translate(norm_q, 'أإآةى', 'اااهي');
  norm_chq := trim(COALESCE(p_cheque_no, ''));
  norm_acc := trim(COALESCE(p_account_no, ''));

  -- Map status
  IF p_status = 'in_portfolio' OR p_status = 'in_safe' OR p_status = 'في الصندوق' THEN
    norm_status := 'في الصندوق';
  ELSIF p_status = 'endorsed' OR p_status = 'مجيّر' THEN
    norm_status := 'مجيّر';
  ELSIF p_status = 'collected' OR p_status = 'محصل في البنك' THEN
    norm_status := 'محصل في البنك';
  ELSIF p_status = 'bounced' OR p_status = 'returned' OR p_status = 'معاد / راجع' THEN
    norm_status := 'معاد / راجع';
  ELSE
    norm_status := 'all';
  END IF;

  -- 1. Global Store Cheque Stats for the 5 KPI Cards
  SELECT jsonb_build_object(
    'total_count', count(*),
    'total_amount', coalesce(sum(amount), 0),
    'in_safe_count', count(*) FILTER (WHERE status_name = 'في الصندوق' OR status = 'in_portfolio'),
    'in_safe_amount', coalesce(sum(amount) FILTER (WHERE status_name = 'في الصندوق' OR status = 'in_portfolio'), 0),
    'endorsed_count', count(*) FILTER (WHERE status_name = 'مجيّر' OR status = 'endorsed'),
    'endorsed_amount', coalesce(sum(amount) FILTER (WHERE status_name = 'مجيّر' OR status = 'endorsed'), 0),
    'collected_count', count(*) FILTER (WHERE status_name = 'محصل في البنك' OR status = 'collected'),
    'collected_amount', coalesce(sum(amount) FILTER (WHERE status_name = 'محصل في البنك' OR status = 'collected'), 0),
    'returned_count', count(*) FILTER (WHERE status_name LIKE '%راجع%' OR status_name LIKE '%معاد%' OR status = 'bounced'),
    'returned_amount', coalesce(sum(amount) FILTER (WHERE status_name LIKE '%راجع%' OR status_name LIKE '%معاد%' OR status = 'bounced'), 0)
  ) INTO v_stats
  FROM public.shamel_cheques
  WHERE store_id = p_store_id;

  -- 2. Filtered Count
  SELECT count(*) INTO v_filtered_total
  FROM public.shamel_cheques c
  WHERE c.store_id = p_store_id
    AND (norm_status = 'all' OR c.status_name = norm_status OR c.status = p_status)
    AND (p_bank = 'all' OR c.bank_code = p_bank)
    AND (p_from IS NULL OR c.due_date >= p_from)
    AND (p_to IS NULL OR c.due_date <= p_to)
    AND (norm_chq = '' OR c.cheque_number LIKE '%' || norm_chq || '%')
    AND (norm_acc = '' OR c.account_number LIKE '%' || norm_acc || '%')
    AND (p_amount IS NULL OR abs(c.amount - p_amount) <= 0.01)
    AND (
      norm_q = '' OR (
        SELECT count(*)
        FROM unnest(string_to_array(norm_q, ' ')) w
        WHERE length(w) > 0
          AND strpos(translate(lower(c.cheque_number || ' ' || coalesce(c.customer_name, '') || ' ' || c.customer_code || ' ' || coalesce(c.target_name, '') || ' ' || coalesce(c.target_account, '') || ' ' || coalesce(c.account_number, '') || ' ' || c.document), 'أإآةى', 'اااهي'), w) = 0
      ) = 0
    );

  -- 3. Filtered Rows
  SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::JSONB) INTO v_rows
  FROM (
    SELECT
      c.id,
      c.cheque_number,
      c.document,
      c.action_doc,
      c.amount,
      c.currency,
      c.due_date,
      c.bank_code,
      c.bank_name,
      c.branch_code,
      c.branch_name,
      c.account_number,
      c.customer_code,
      c.customer_name,
      c.status_code,
      c.status_name,
      c.status,
      c.target_account,
      c.target_name
    FROM public.shamel_cheques c
    WHERE c.store_id = p_store_id
      AND (norm_status = 'all' OR c.status_name = norm_status OR c.status = p_status)
      AND (p_bank = 'all' OR c.bank_code = p_bank)
      AND (p_from IS NULL OR c.due_date >= p_from)
      AND (p_to IS NULL OR c.due_date <= p_to)
      AND (norm_chq = '' OR c.cheque_number LIKE '%' || norm_chq || '%')
      AND (norm_acc = '' OR c.account_number LIKE '%' || norm_acc || '%')
      AND (p_amount IS NULL OR abs(c.amount - p_amount) <= 0.01)
      AND (
        norm_q = '' OR (
          SELECT count(*)
          FROM unnest(string_to_array(norm_q, ' ')) w
          WHERE length(w) > 0
            AND strpos(translate(lower(c.cheque_number || ' ' || coalesce(c.customer_name, '') || ' ' || c.customer_code || ' ' || coalesce(c.target_name, '') || ' ' || coalesce(c.target_account, '') || ' ' || coalesce(c.account_number, '') || ' ' || c.document), 'أإآةى', 'اااهي'), w) = 0
        ) = 0
      )
    ORDER BY c.due_date DESC NULLS LAST, c.document DESC, c.cheque_number ASC
    LIMIT p_limit OFFSET p_offset
  ) t;

  RETURN jsonb_build_object(
    'stats', v_stats,
    'total', v_filtered_total,
    'rows', v_rows,
    'offset', p_offset,
    'limit', p_limit
  );
END;
$$;

-- 7. Update shamel_save_isolated_batch to save rates, target endorsement & update customer summary
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
        store_id, snapshot_id, code, name, phone, address, balance, equivalent_balance
      ) VALUES (
        p_store_id, p_snapshot_id, v_rec.code, v_rec.name, v_rec.phone, v_rec.address,
        COALESCE(v_rec.balance, 0), COALESCE(v_rec.balance, 0)
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
      status_code INT, status_name TEXT, status TEXT, type TEXT,
      target_account TEXT, target_name TEXT, action_doc TEXT
    ) LOOP
      INSERT INTO public.shamel_cheques (
        store_id, snapshot_id, document, cheque_number, due_date, bank_code, bank_name,
        branch_code, branch_name, account_number, customer_code, customer_name,
        amount, currency, status_code, status_name, status, type,
        target_account, target_name, action_doc
      ) VALUES (
        p_store_id, p_snapshot_id, v_rec.document, v_rec.cheque_number, v_rec.due_date,
        v_rec.bank_code, COALESCE(v_rec.bank_name, 'بنك ' || COALESCE(v_rec.bank_code, '')),
        v_rec.branch_code, v_rec.branch_name, v_rec.account_number,
        v_rec.customer_code, v_rec.customer_name,
        v_rec.amount, COALESCE(v_rec.currency, 'ILS'),
        COALESCE(v_rec.status_code, 0), COALESCE(v_rec.status_name, 'في الصندوق'),
        COALESCE(v_rec.status, 'in_portfolio'), COALESCE(v_rec.type, 'received'),
        v_rec.target_account, v_rec.target_name, v_rec.action_doc
      )
      ON CONFLICT (store_id, document, cheque_number, amount) DO UPDATE SET
        status = EXCLUDED.status,
        status_name = EXCLUDED.status_name,
        due_date = EXCLUDED.due_date,
        target_account = EXCLUDED.target_account,
        target_name = EXCLUDED.target_name,
        action_doc = EXCLUDED.action_doc,
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
      amount NUMERIC, direction INT, description TEXT, document_type TEXT, source_offset BIGINT,
      exchange_rate NUMERIC, nis_amount NUMERIC
    ) LOOP
      INSERT INTO public.shamel_entries (
        store_id, snapshot_id, document, line_index, account, currency, day,
        amount, direction, description, document_type, source_offset,
        exchange_rate, nis_amount
      ) VALUES (
        p_store_id, p_snapshot_id, v_rec.document, COALESCE(v_rec.line_index, 0),
        v_rec.account, COALESCE(v_rec.currency, 'ILS'), COALESCE(v_rec.day, CURRENT_DATE),
        COALESCE(v_rec.amount, 0), COALESCE(v_rec.direction, 1),
        v_rec.description, v_rec.document_type, v_rec.source_offset,
        COALESCE(v_rec.exchange_rate, 1.0),
        COALESCE(v_rec.nis_amount, v_rec.amount * COALESCE(v_rec.exchange_rate, 1.0), v_rec.amount)
      )
      ON CONFLICT (store_id, document, line_index, account, direction) DO UPDATE SET
        day = EXCLUDED.day,
        amount = EXCLUDED.amount,
        exchange_rate = EXCLUDED.exchange_rate,
        nis_amount = EXCLUDED.nis_amount,
        description = EXCLUDED.description,
        document_type = EXCLUDED.document_type,
        snapshot_id = EXCLUDED.snapshot_id;
      v_count := v_count + 1;
    END LOOP;

    -- Update Customers Equivalent Balance & Summary Activity Dates
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
