-- Regenerated from the read-only deployed function definitions captured in docs/audit/deployed-schema.json.
-- Guards run inside each SECURITY DEFINER function, even for direct RPC calls.
BEGIN;
CREATE FUNCTION public.assert_store_read_permission(p_store uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.store_members WHERE store_id=p_store AND profile_id=auth.uid() AND is_active IS TRUE) THEN
   RAISE EXCEPTION 'غير مخول لقراءة المتجر' USING ERRCODE='42501'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.assert_store_read_permission(uuid) FROM PUBLIC,anon,authenticated;

-- Guard shamel_statement
CREATE OR REPLACE FUNCTION public.shamel_statement(p_store_id uuid, p_code text, p_currency text DEFAULT 'NIS'::text, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_offset integer DEFAULT 0, p_limit integer DEFAULT 300)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
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
  PERFORM public.assert_store_read_permission(p_store_id);
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
$function$
;
REVOKE ALL ON FUNCTION public.shamel_statement(uuid,text,text,date,date,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.shamel_statement(uuid,text,text,date,date,integer,integer) TO authenticated;

-- Guard shamel_item_card
CREATE OR REPLACE FUNCTION public.shamel_item_card(p_store_id uuid, p_item_code text, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_type text DEFAULT 'all'::text, p_offset integer DEFAULT 0, p_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_item RECORD;
  v_movements JSONB := '[]'::JSONB;
  v_total_movements BIGINT := 0;
  v_total_sold NUMERIC(15, 3) := 0;
  v_total_purchased NUMERIC(15, 3) := 0;
  v_last_sale JSONB := NULL;
  v_last_purchase JSONB := NULL;
BEGIN
  PERFORM public.assert_store_read_permission(p_store_id);
  IF auth.role() <> 'service_role' AND NOT is_store_member(p_store_id) THEN
    RAISE EXCEPTION 'Not authorized for this store';
  END IF;

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

  -- Last sale with customer name
  SELECT to_jsonb(s) INTO v_last_sale
  FROM (
    SELECT 
      i.day, i.price, i.quantity, i.document,
      e.account AS customer_code,
      coalesce(c.name, a.name, e.description) AS customer_name
    FROM public.shamel_invoice_items i
    LEFT JOIN LATERAL (
      SELECT e.account, e.description
      FROM public.shamel_entries e
      WHERE e.store_id = p_store_id
        AND e.document = i.document
        AND (e.account LIKE 'C%' OR e.direction = 1)
        AND e.account NOT LIKE '411%' AND e.account NOT LIKE '311%' AND e.account NOT LIKE '111%' AND e.account NOT LIKE '211%'
      ORDER BY (e.account LIKE 'C%') DESC, e.line_index ASC
      LIMIT 1
    ) e ON true
    LEFT JOIN public.shamel_customers c ON c.store_id = p_store_id AND c.code = e.account
    LEFT JOIN public.shamel_accounts a ON a.store_id = p_store_id AND a.code = e.account
    WHERE i.store_id = p_store_id AND i.item_code = p_item_code AND (i.document LIKE 'I%' OR i.document LIKE 'فاتورة%')
    ORDER BY i.day DESC, i.document DESC
    LIMIT 1
  ) s;

  -- Last purchase with supplier name
  SELECT to_jsonb(p) INTO v_last_purchase
  FROM (
    SELECT 
      i.day, i.price, i.quantity, i.document,
      e.account AS supplier_code,
      coalesce(c.name, a.name, e.description) AS supplier_name
    FROM public.shamel_invoice_items i
    LEFT JOIN LATERAL (
      SELECT e.account, e.description
      FROM public.shamel_entries e
      WHERE e.store_id = p_store_id
        AND e.document = i.document
        AND (e.account LIKE 'S%' OR e.direction = 2)
        AND e.account NOT LIKE '411%' AND e.account NOT LIKE '311%' AND e.account NOT LIKE '111%' AND e.account NOT LIKE '211%'
      ORDER BY (e.account LIKE 'S%') DESC, e.line_index ASC
      LIMIT 1
    ) e ON true
    LEFT JOIN public.shamel_customers c ON c.store_id = p_store_id AND c.code = e.account
    LEFT JOIN public.shamel_accounts a ON a.store_id = p_store_id AND a.code = e.account
    WHERE i.store_id = p_store_id AND i.item_code = p_item_code AND (i.document LIKE 'H%' OR i.document LIKE 'شراء%')
    ORDER BY i.day DESC, i.document DESC
    LIMIT 1
  ) p;

  -- 3. Filtered movements count
  SELECT count(*) INTO v_total_movements
  FROM public.shamel_invoice_items i
  WHERE i.store_id = p_store_id AND i.item_code = p_item_code
    AND (p_from IS NULL OR i.day >= p_from)
    AND (p_to IS NULL OR i.day <= p_to)
    AND (
      p_type = 'all'
      OR (p_type = 'sales' AND (i.document LIKE 'I%' OR i.document LIKE 'فاتورة%'))
      OR (p_type = 'purchases' AND (i.document LIKE 'H%' OR i.document LIKE 'شراء%'))
      OR (p_type = 'returns' AND (i.document LIKE 'M%' OR i.document LIKE 'S%' OR i.document LIKE 'مردود%'))
    );

  -- 4. Movements query with customer/party name
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
        WHEN i.document LIKE 'M%' THEN 'مردودات مشتريات'
        WHEN i.document LIKE 'S%' THEN 'مردودات مبيعات'
        ELSE 'حركة مخزنية'
      END AS movement_type,
      CASE
        WHEN i.document LIKE 'I%' OR i.document LIKE 'S%' THEN 'customer'
        WHEN i.document LIKE 'H%' OR i.document LIKE 'M%' THEN 'supplier'
        ELSE 'internal'
      END AS party_type,
      e.account AS party_code,
      coalesce(c.name, a.name, e.description) AS party_name
    FROM public.shamel_invoice_items i
    LEFT JOIN LATERAL (
      SELECT e.account, e.description
      FROM public.shamel_entries e
      WHERE e.store_id = p_store_id
        AND e.document = i.document
        AND (e.account LIKE 'C%' OR e.account LIKE 'S%' OR e.direction IN (1, 2))
        AND e.account NOT LIKE '411%' AND e.account NOT LIKE '311%' AND e.account NOT LIKE '111%' AND e.account NOT LIKE '211%'
      ORDER BY (e.account LIKE 'C%' OR e.account LIKE 'S%') DESC, e.line_index ASC
      LIMIT 1
    ) e ON true
    LEFT JOIN public.shamel_customers c ON c.store_id = p_store_id AND c.code = e.account
    LEFT JOIN public.shamel_accounts a ON a.store_id = p_store_id AND a.code = e.account
    WHERE i.store_id = p_store_id AND i.item_code = p_item_code
      AND (p_from IS NULL OR i.day >= p_from)
      AND (p_to IS NULL OR i.day <= p_to)
      AND (
        p_type = 'all'
        OR (p_type = 'sales' AND (i.document LIKE 'I%' OR i.document LIKE 'فاتورة%'))
        OR (p_type = 'purchases' AND (i.document LIKE 'H%' OR i.document LIKE 'شراء%'))
        OR (p_type = 'returns' AND (i.document LIKE 'M%' OR i.document LIKE 'S%' OR i.document LIKE 'مردود%'))
      )
    ORDER BY i.day DESC, i.document DESC, i.line_index ASC
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
$function$
;
REVOKE ALL ON FUNCTION public.shamel_item_card(uuid,text,date,date,text,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.shamel_item_card(uuid,text,date,date,text,integer,integer) TO authenticated;

-- Guard shamel_cheques_browse
CREATE OR REPLACE FUNCTION public.shamel_cheques_browse(p_store_id uuid, p_query text DEFAULT ''::text, p_status text DEFAULT 'all'::text, p_bank text DEFAULT 'all'::text, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_cheque_no text DEFAULT ''::text, p_account_no text DEFAULT ''::text, p_amount numeric DEFAULT NULL::numeric, p_offset integer DEFAULT 0, p_limit integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_stats JSONB;
  v_filtered_total BIGINT := 0;
  v_rows JSONB := '[]'::JSONB;
  norm_q TEXT;
  norm_chq TEXT;
  norm_acc TEXT;
  norm_status TEXT;
BEGIN
  PERFORM public.assert_store_read_permission(p_store_id);
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
$function$
;
REVOKE ALL ON FUNCTION public.shamel_cheques_browse(uuid,text,text,text,date,date,text,text,numeric,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.shamel_cheques_browse(uuid,text,text,text,date,date,text,text,numeric,integer,integer) TO authenticated;

-- Guard shamel_get_cheque_stats
CREATE OR REPLACE FUNCTION public.shamel_get_cheque_stats(p_store_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_stats JSONB;
BEGIN
  PERFORM public.assert_store_read_permission(p_store_id);
  IF NOT is_store_member(p_store_id) THEN
    RAISE EXCEPTION 'Not authorized for this store';
  END IF;

  SELECT jsonb_build_object(
    'total_count', count(*),
    'total_amount', COALESCE(sum(amount), 0),
    'in_portfolio_count', count(*) FILTER (WHERE status = 'in_portfolio'),
    'in_portfolio_amount', COALESCE(sum(amount) FILTER (WHERE status = 'in_portfolio'), 0),
    'endorsed_count', count(*) FILTER (WHERE status = 'endorsed'),
    'endorsed_amount', COALESCE(sum(amount) FILTER (WHERE status = 'endorsed'), 0),
    'collected_count', count(*) FILTER (WHERE status = 'collected'),
    'collected_amount', COALESCE(sum(amount) FILTER (WHERE status = 'collected'), 0),
    'bounced_count', count(*) FILTER (WHERE status = 'bounced'),
    'bounced_amount', COALESCE(sum(amount) FILTER (WHERE status = 'bounced'), 0)
  ) INTO v_stats
  FROM public.shamel_cheques
  WHERE store_id = p_store_id;

  RETURN v_stats;
END;
$function$
;
REVOKE ALL ON FUNCTION public.shamel_get_cheque_stats(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.shamel_get_cheque_stats(uuid) TO authenticated;

-- Guard shamel_bulk_upsert_accounts
CREATE OR REPLACE FUNCTION public.shamel_bulk_upsert_accounts(p_store_id uuid, p_accounts jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_rec RECORD;
  v_inserted INT := 0;
  v_updated INT := 0;
BEGIN
  PERFORM public.assert_financial_permission(p_store_id,'admin');
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
$function$
;
REVOKE ALL ON FUNCTION public.shamel_bulk_upsert_accounts(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.shamel_bulk_upsert_accounts(uuid,jsonb) TO authenticated;

-- Guard shamel_bulk_upsert_assets
CREATE OR REPLACE FUNCTION public.shamel_bulk_upsert_assets(p_store_id uuid, p_assets jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_rec RECORD;
  v_count INT := 0;
BEGIN
  PERFORM public.assert_financial_permission(p_store_id,'admin');
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
$function$
;
REVOKE ALL ON FUNCTION public.shamel_bulk_upsert_assets(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.shamel_bulk_upsert_assets(uuid,jsonb) TO authenticated;

-- Guard shamel_bulk_upsert_checks
CREATE OR REPLACE FUNCTION public.shamel_bulk_upsert_checks(p_store_id uuid, p_checks jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_rec RECORD;
  v_count INT := 0;
  v_cust_id UUID;
  v_supp_id UUID;
BEGIN
  PERFORM public.assert_financial_permission(p_store_id,'admin');
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
$function$
;
REVOKE ALL ON FUNCTION public.shamel_bulk_upsert_checks(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.shamel_bulk_upsert_checks(uuid,jsonb) TO authenticated;

-- Guard shamel_bulk_upsert_cost_centers
CREATE OR REPLACE FUNCTION public.shamel_bulk_upsert_cost_centers(p_store_id uuid, p_cost_centers jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_rec RECORD;
  v_count INT := 0;
BEGIN
  PERFORM public.assert_financial_permission(p_store_id,'admin');
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
$function$
;
REVOKE ALL ON FUNCTION public.shamel_bulk_upsert_cost_centers(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.shamel_bulk_upsert_cost_centers(uuid,jsonb) TO authenticated;

-- Guard shamel_bulk_upsert_customers
CREATE OR REPLACE FUNCTION public.shamel_bulk_upsert_customers(p_store_id uuid, p_customers jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_rec RECORD;
  v_count INT := 0;
BEGIN
  PERFORM public.assert_financial_permission(p_store_id,'admin');
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
$function$
;
REVOKE ALL ON FUNCTION public.shamel_bulk_upsert_customers(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.shamel_bulk_upsert_customers(uuid,jsonb) TO authenticated;

-- Guard shamel_bulk_upsert_price_lists
CREATE OR REPLACE FUNCTION public.shamel_bulk_upsert_price_lists(p_store_id uuid, p_price_lists jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_rec RECORD;
  v_count INT := 0;
  v_cust_id UUID;
  v_prod_id UUID;
BEGIN
  PERFORM public.assert_financial_permission(p_store_id,'admin');
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
$function$
;
REVOKE ALL ON FUNCTION public.shamel_bulk_upsert_price_lists(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.shamel_bulk_upsert_price_lists(uuid,jsonb) TO authenticated;

-- Guard shamel_bulk_upsert_products
CREATE OR REPLACE FUNCTION public.shamel_bulk_upsert_products(p_store_id uuid, p_products jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_rec RECORD;
  v_count INT := 0;
BEGIN
  PERFORM public.assert_financial_permission(p_store_id,'admin');
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
$function$
;
REVOKE ALL ON FUNCTION public.shamel_bulk_upsert_products(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.shamel_bulk_upsert_products(uuid,jsonb) TO authenticated;

-- Guard shamel_bulk_upsert_sales_reps
CREATE OR REPLACE FUNCTION public.shamel_bulk_upsert_sales_reps(p_store_id uuid, p_sales_reps jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_rec RECORD;
  v_count INT := 0;
BEGIN
  PERFORM public.assert_financial_permission(p_store_id,'admin');
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
$function$
;
REVOKE ALL ON FUNCTION public.shamel_bulk_upsert_sales_reps(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.shamel_bulk_upsert_sales_reps(uuid,jsonb) TO authenticated;

-- Guard shamel_bulk_upsert_suppliers
CREATE OR REPLACE FUNCTION public.shamel_bulk_upsert_suppliers(p_store_id uuid, p_suppliers jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_rec RECORD;
  v_count INT := 0;
BEGIN
  PERFORM public.assert_financial_permission(p_store_id,'admin');
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
$function$
;
REVOKE ALL ON FUNCTION public.shamel_bulk_upsert_suppliers(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.shamel_bulk_upsert_suppliers(uuid,jsonb) TO authenticated;

-- Guard shamel_delete_operational_document
CREATE OR REPLACE FUNCTION public.shamel_delete_operational_document(p_store_id uuid, p_source_type text, p_source_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_rec RECORD;
  v_cust_id UUID;
  v_supp_id UUID;
BEGIN
  PERFORM public.assert_financial_permission(p_store_id,'admin');
  IF auth.role() <> 'service_role' AND NOT is_store_member(p_store_id) THEN
    RAISE EXCEPTION 'غير مصرح لك بتنفيذ هذه العملية على هذا المتجر';
  END IF;

  -- 1. Sales Invoice
  IF p_source_type = 'sale' OR p_source_type = 'invoice' THEN
    SELECT id, customer_id INTO v_rec FROM public.invoices WHERE store_id = p_store_id AND (shamel_source_id = p_source_id OR invoice_number = p_source_id) LIMIT 1;
    IF v_rec.id IS NOT NULL THEN
      DELETE FROM public.inventory_movements WHERE store_id = p_store_id AND ref_id = v_rec.id;
      DELETE FROM public.customer_ledger WHERE store_id = p_store_id AND reference_id = v_rec.id;
      DELETE FROM public.journal_entries WHERE store_id = p_store_id AND (ref_id = v_rec.id OR shamel_source_id = p_source_id);
      DELETE FROM public.invoice_items WHERE invoice_id = v_rec.id;
      DELETE FROM public.invoices WHERE id = v_rec.id;

      IF v_rec.customer_id IS NOT NULL THEN
        UPDATE public.customers
        SET balance = COALESCE((SELECT SUM(debit) - SUM(credit) FROM public.customer_ledger WHERE customer_id = v_rec.customer_id), 0)
        WHERE id = v_rec.customer_id;
      END IF;
    END IF;

  -- 2. Purchase Invoice
  ELSIF p_source_type = 'purchase' THEN
    SELECT id, supplier_id INTO v_rec FROM public.purchase_invoices WHERE store_id = p_store_id AND (shamel_source_id = p_source_id OR invoice_number = p_source_id) LIMIT 1;
    IF v_rec.id IS NOT NULL THEN
      DELETE FROM public.inventory_movements WHERE store_id = p_store_id AND ref_id = v_rec.id;
      DELETE FROM public.journal_entries WHERE store_id = p_store_id AND (ref_id = v_rec.id OR shamel_source_id = p_source_id);
      DELETE FROM public.purchase_items WHERE purchase_invoice_id = v_rec.id;
      DELETE FROM public.purchase_invoices WHERE id = v_rec.id;

      IF v_rec.supplier_id IS NOT NULL THEN
        UPDATE public.suppliers
        SET balance = COALESCE((SELECT SUM(total_amount) FROM public.purchase_invoices WHERE supplier_id = v_rec.supplier_id AND status <> 'cancelled'), 0)
                    - COALESCE((SELECT SUM(amount) FROM public.vouchers WHERE supplier_id = v_rec.supplier_id AND type = 'payment'), 0)
        WHERE id = v_rec.supplier_id;
      END IF;
    END IF;

  -- 3. Voucher (Receipt or Payment)
  ELSIF p_source_type LIKE '%voucher%' OR p_source_type = 'receipt' OR p_source_type = 'payment' THEN
    SELECT id, type, customer_id, supplier_id, cash_box_id INTO v_rec FROM public.vouchers WHERE store_id = p_store_id AND (shamel_source_id = p_source_id OR voucher_number = p_source_id) LIMIT 1;
    IF v_rec.id IS NOT NULL THEN
      DELETE FROM public.cash_movements WHERE store_id = p_store_id AND ref_id = v_rec.id;
      DELETE FROM public.customer_ledger WHERE store_id = p_store_id AND reference_id = v_rec.id;
      DELETE FROM public.journal_entries WHERE store_id = p_store_id AND (ref_id = v_rec.id OR shamel_source_id = p_source_id);
      DELETE FROM public.vouchers WHERE id = v_rec.id;

      IF v_rec.customer_id IS NOT NULL THEN
        UPDATE public.customers
        SET balance = COALESCE((SELECT SUM(debit) - SUM(credit) FROM public.customer_ledger WHERE customer_id = v_rec.customer_id), 0)
        WHERE id = v_rec.customer_id;
      END IF;
      IF v_rec.cash_box_id IS NOT NULL THEN
        UPDATE public.cash_boxes
        SET current_balance = opening_balance + COALESCE((SELECT SUM(CASE WHEN direction = 'in' THEN amount ELSE -amount END) FROM public.cash_movements WHERE cash_box_id = v_rec.cash_box_id), 0)
        WHERE id = v_rec.cash_box_id;
      END IF;
    END IF;

  -- 4. Journal Entry
  ELSIF p_source_type = 'journal_entry' THEN
    DELETE FROM public.journal_entries WHERE store_id = p_store_id AND (shamel_source_id = p_source_id OR entry_number = p_source_id);
  END IF;

  RETURN jsonb_build_object('success', TRUE, 'deleted_source_id', p_source_id);
END;
$function$
;
REVOKE ALL ON FUNCTION public.shamel_delete_operational_document(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.shamel_delete_operational_document(uuid,text,text) TO authenticated;

-- Guard shamel_promote_entity
CREATE OR REPLACE FUNCTION public.shamel_promote_entity(p_store_id uuid, p_entity text, p_code text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_count INT := 0;
  v_rec RECORD;
  v_slug TEXT;
  v_cust_id UUID;
  v_supp_id UUID;
BEGIN
  PERFORM public.assert_financial_permission(p_store_id,'admin');
  IF auth.role() <> 'service_role' AND NOT is_store_member(p_store_id) THEN
    RAISE EXCEPTION 'Not authorized for this store';
  END IF;

  -- إذا طلب الترحيل الشامل، استدعاء محرك إعادة البناء الفعلي من العمليات
  IF p_entity = 'reconstruct' THEN
    RETURN public.shamel_reconstruct_from_operations(p_store_id, 0);
  END IF;

  -- 1. ترحيل العملاء برصيد أولي 0
  IF p_entity = 'customers' THEN
    FOR v_rec IN 
      SELECT * FROM public.shamel_customers 
      WHERE store_id = p_store_id AND (p_code IS NULL OR code = p_code)
    LOOP
      IF v_rec.code LIKE 'S%' THEN
        IF EXISTS (SELECT 1 FROM public.suppliers WHERE store_id = p_store_id AND shamel_code = v_rec.code) THEN
          UPDATE public.suppliers
          SET name = v_rec.name, phone = COALESCE(v_rec.phone, phone), address = COALESCE(v_rec.address, address)
          WHERE store_id = p_store_id AND shamel_code = v_rec.code;
        ELSE
          INSERT INTO public.suppliers (store_id, name, phone, address, balance, shamel_code)
          VALUES (p_store_id, v_rec.name, v_rec.phone, v_rec.address, 0, v_rec.code);
        END IF;
      ELSE
        IF EXISTS (SELECT 1 FROM public.customers WHERE store_id = p_store_id AND shamel_code = v_rec.code) THEN
          UPDATE public.customers
          SET name = v_rec.name, phone = COALESCE(v_rec.phone, phone), address = COALESCE(v_rec.address, address)
          WHERE store_id = p_store_id AND shamel_code = v_rec.code;
        ELSE
          INSERT INTO public.customers (store_id, name, phone, address, balance, total_spent, total_paid, shamel_code)
          VALUES (p_store_id, v_rec.name, v_rec.phone, v_rec.address, 0, 0, 0, v_rec.code);
        END IF;
      END IF;

      UPDATE public.shamel_customers 
      SET is_promoted = TRUE, promoted_at = now() 
      WHERE store_id = p_store_id AND code = v_rec.code;

      v_count := v_count + 1;
    END LOOP;

  -- 2. ترحيل الأصناف برصيد مخزون أولي 0
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
            status = 'active'
        WHERE store_id = p_store_id AND shamel_code = v_rec.code;
      ELSE
        v_slug := 'shamel-' || lower(regexp_replace(v_rec.code, '[^a-zA-Z0-9]', '', 'g')) || '-' || substr(md5(random()::text), 1, 6);
        INSERT INTO public.products (
          store_id, name, slug, sku, barcode, price, cost_price, stock_quantity, shamel_code, status
        ) VALUES (
          p_store_id, v_rec.name, v_slug, v_rec.code, v_rec.barcode,
          v_rec.price, v_rec.cost_price, 0, v_rec.code, 'active'
        );
      END IF;

      UPDATE public.shamel_stock 
      SET is_promoted = TRUE, promoted_at = now() 
      WHERE store_id = p_store_id AND code = v_rec.code;

      v_count := v_count + 1;
    END LOOP;

  -- 3. ترحيل الشيكات
  ELSIF p_entity = 'cheques' THEN
    FOR v_rec IN 
      SELECT * FROM public.shamel_cheques 
      WHERE store_id = p_store_id 
        AND (p_code IS NULL OR document = p_code OR customer_code = p_code)
    LOOP
      v_cust_id := NULL;
      IF v_rec.customer_code IS NOT NULL AND v_rec.customer_code <> '' THEN
        SELECT id INTO v_cust_id FROM public.customers WHERE store_id = p_store_id AND shamel_code = v_rec.customer_code LIMIT 1;
      END IF;

      INSERT INTO public.checks (
        store_id, type, check_number, bank_code, bank_name, branch_code, branch_name,
        account_number, drawer_name, amount, currency, amount_ils, due_date, status,
        customer_id, shamel_code
      ) VALUES (
        p_store_id, v_rec.type, v_rec.cheque_number, v_rec.bank_code, v_rec.bank_name,
        v_rec.branch_code, v_rec.branch_name, v_rec.account_number,
        COALESCE(v_rec.customer_name, 'عميل الشامل'), v_rec.amount, v_rec.currency,
        v_rec.amount, COALESCE(v_rec.due_date, CURRENT_DATE), v_rec.status,
        v_cust_id, v_rec.document
      )
      ON CONFLICT (store_id, document, cheque_number, amount) DO UPDATE SET
        status = EXCLUDED.status,
        due_date = EXCLUDED.due_date;

      UPDATE public.shamel_cheques 
      SET is_promoted = TRUE, promoted_at = now() 
      WHERE store_id = p_store_id AND id = v_rec.id;

      v_count := v_count + 1;
    END LOOP;

  -- 4. ترحيل شجرة الحسابات برصيد أولي 0
  ELSIF p_entity = 'accounts' THEN
    FOR v_rec IN 
      SELECT * FROM public.shamel_accounts 
      WHERE store_id = p_store_id AND (p_code IS NULL OR code = p_code)
    LOOP
      INSERT INTO public.accounts (
        store_id, code, name, type, is_group, currency, balance, shamel_code, is_active
      ) VALUES (
        p_store_id, v_rec.code, v_rec.name, v_rec.type, v_rec.is_group,
        v_rec.currency, 0, v_rec.code, TRUE
      )
      ON CONFLICT (store_id, code) DO UPDATE SET
        name = EXCLUDED.name,
        type = EXCLUDED.type,
        is_group = EXCLUDED.is_group,
        shamel_code = EXCLUDED.shamel_code;

      UPDATE public.shamel_accounts 
      SET is_promoted = TRUE, promoted_at = now() 
      WHERE store_id = p_store_id AND code = v_rec.code;

      v_count := v_count + 1;
    END LOOP;

    -- ربط الحسابات بالآباء
    UPDATE public.accounts a
    SET parent_id = p.id
    FROM public.accounts p
    JOIN public.shamel_accounts sa ON sa.parent_code = p.code AND sa.store_id = p_store_id
    WHERE a.store_id = p_store_id AND a.code = sa.code AND a.parent_id IS DISTINCT FROM p.id;

  END IF;

  RETURN jsonb_build_object('success', TRUE, 'promoted_count', v_count);
END;
$function$
;
REVOKE ALL ON FUNCTION public.shamel_promote_entity(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.shamel_promote_entity(uuid,text,text) TO authenticated;

-- Guard shamel_reconstruct_from_operations
CREATE OR REPLACE FUNCTION public.shamel_reconstruct_from_operations(p_store_id uuid, p_stage integer DEFAULT 0, p_options jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_stage_start TIMESTAMPTZ;
  v_default_cash_box_id UUID;
  v_cash_acc_id UUID;
  v_inv_acc_id UUID;
  v_sales_acc_id UUID;
  v_cogs_acc_id UUID;
  v_receivable_acc_id UUID;
  v_payable_acc_id UUID;
  v_cheque_acc_id UUID;
  
  -- عدادات وإحصائيات
  v_accounts_count INT := 0;
  v_customers_count INT := 0;
  v_suppliers_count INT := 0;
  v_products_count INT := 0;
  v_purchases_count INT := 0;
  v_purchase_returns_count INT := 0;
  v_sales_count INT := 0;
  v_sales_returns_count INT := 0;
  v_receipts_count INT := 0;
  v_cheques_count INT := 0;
  v_payments_count INT := 0;
  v_other_movements_count INT := 0;
  v_standalone_entries_count INT := 0;

  v_rec RECORD;
  v_sub_rec RECORD;
  v_entry_rec RECORD;
  v_inv_id UUID;
  v_pur_id UUID;
  v_ret_id UUID;
  v_vouch_id UUID;
  v_je_id UUID;
  v_cust_id UUID;
  v_supp_id UUID;
  v_prod_id UUID;
  v_item_cost NUMERIC;
  v_doc_total NUMERIC;
  v_running_bal NUMERIC;

  -- متغيرات المطابقة والتدقيق (المرحلة 17)
  v_total_debit NUMERIC(14,2) := 0;
  v_total_credit NUMERIC(14,2) := 0;
  v_diff NUMERIC(14,2) := 0;
  v_is_balanced BOOLEAN := FALSE;
  v_mismatched_stock_count INT := 0;
  v_mismatched_cust_count INT := 0;
  v_discrepancies JSONB := '[]'::jsonb;
  v_stage_results JSONB := '[]'::jsonb;
BEGIN
  PERFORM public.assert_financial_permission(p_store_id,'admin');
  IF auth.role() <> 'service_role' AND NOT is_store_member(p_store_id) THEN
    RAISE EXCEPTION 'غير مصرح لك بالوصول لبيانات هذا المتجر';
  END IF;

  v_stage_start := clock_timestamp();

  -- ضمان وجود الصندوق الافتراضي والحسابات المركزية للمتجر
  SELECT id INTO v_default_cash_box_id FROM public.cash_boxes WHERE store_id = p_store_id AND is_default = TRUE LIMIT 1;
  IF v_default_cash_box_id IS NULL THEN
    SELECT id INTO v_default_cash_box_id FROM public.cash_boxes WHERE store_id = p_store_id LIMIT 1;
  END IF;
  IF v_default_cash_box_id IS NULL THEN
    INSERT INTO public.cash_boxes (store_id, name, type, opening_balance, current_balance, is_default)
    VALUES (p_store_id, 'الصندوق الرئيسي', 'cash', 0, 0, TRUE)
    RETURNING id INTO v_default_cash_box_id;
  END IF;

  -- جلب حسابات النظام
  SELECT id INTO v_cash_acc_id FROM public.accounts WHERE store_id = p_store_id AND code = '1001' LIMIT 1;
  IF v_cash_acc_id IS NULL THEN
    INSERT INTO public.accounts (store_id, code, name, type, is_group, normal_balance, balance, currency, is_system)
    VALUES (p_store_id, '1001', 'الصندوق الرئيسي', 'asset', FALSE, 'debit', 0, 'ILS', TRUE)
    RETURNING id INTO v_cash_acc_id;
  END IF;

  SELECT id INTO v_inv_acc_id FROM public.accounts WHERE store_id = p_store_id AND code = '1201' LIMIT 1;
  IF v_inv_acc_id IS NULL THEN
    INSERT INTO public.accounts (store_id, code, name, type, is_group, normal_balance, balance, currency, is_system)
    VALUES (p_store_id, '1201', 'المخزون السلعي', 'asset', FALSE, 'debit', 0, 'ILS', TRUE)
    RETURNING id INTO v_inv_acc_id;
  END IF;

  SELECT id INTO v_sales_acc_id FROM public.accounts WHERE store_id = p_store_id AND code = '4001' LIMIT 1;
  IF v_sales_acc_id IS NULL THEN
    INSERT INTO public.accounts (store_id, code, name, type, is_group, normal_balance, balance, currency, is_system)
    VALUES (p_store_id, '4001', 'إيرادات المبيعات', 'revenue', FALSE, 'credit', 0, 'ILS', TRUE)
    RETURNING id INTO v_sales_acc_id;
  END IF;

  SELECT id INTO v_cogs_acc_id FROM public.accounts WHERE store_id = p_store_id AND code = '5001' LIMIT 1;
  IF v_cogs_acc_id IS NULL THEN
    INSERT INTO public.accounts (store_id, code, name, type, is_group, normal_balance, balance, currency, is_system)
    VALUES (p_store_id, '5001', 'تكلفة البضاعة المباعة', 'expense', FALSE, 'debit', 0, 'ILS', TRUE)
    RETURNING id INTO v_cogs_acc_id;
  END IF;

  SELECT id INTO v_receivable_acc_id FROM public.accounts WHERE store_id = p_store_id AND code = '1101' LIMIT 1;
  IF v_receivable_acc_id IS NULL THEN
    INSERT INTO public.accounts (store_id, code, name, type, is_group, normal_balance, balance, currency, is_system)
    VALUES (p_store_id, '1101', 'ذمم العملاء والزبائن', 'asset', FALSE, 'debit', 0, 'ILS', TRUE)
    RETURNING id INTO v_receivable_acc_id;
  END IF;

  SELECT id INTO v_payable_acc_id FROM public.accounts WHERE store_id = p_store_id AND code = '2101' LIMIT 1;
  IF v_payable_acc_id IS NULL THEN
    INSERT INTO public.accounts (store_id, code, name, type, is_group, normal_balance, balance, currency, is_system)
    VALUES (p_store_id, '2101', 'ذمم الموردين والدائنين', 'liability', FALSE, 'credit', 0, 'ILS', TRUE)
    RETURNING id INTO v_payable_acc_id;
  END IF;

  SELECT id INTO v_cheque_acc_id FROM public.accounts WHERE store_id = p_store_id AND code = '1102' LIMIT 1;
  IF v_cheque_acc_id IS NULL THEN
    INSERT INTO public.accounts (store_id, code, name, type, is_group, normal_balance, balance, currency, is_system)
    VALUES (p_store_id, '1102', 'شيكات برسم التحصيل PMA', 'asset', FALSE, 'debit', 0, 'ILS', TRUE)
    RETURNING id INTO v_cheque_acc_id;
  END IF;


  -- =========================================================================
  -- المرحلة 1 – شجرة الحسابات (الأرصدة تبدأ بصفر قطعي)
  -- =========================================================================
  IF p_stage = 0 OR p_stage = 1 THEN
    FOR v_rec IN 
      SELECT * FROM public.shamel_accounts 
      WHERE store_id = p_store_id 
      ORDER BY length(code) ASC, code ASC
    LOOP
      INSERT INTO public.accounts (
        store_id, code, name, type, is_group, currency, balance, shamel_code, is_active
      ) VALUES (
        p_store_id, v_rec.code, v_rec.name, v_rec.type, COALESCE(v_rec.is_group, FALSE),
        COALESCE(v_rec.currency, 'ILS'), 0, v_rec.code, TRUE
      )
      ON CONFLICT (store_id, code) DO UPDATE SET
        name = EXCLUDED.name,
        type = EXCLUDED.type,
        is_group = EXCLUDED.is_group,
        shamel_code = EXCLUDED.shamel_code;

      UPDATE public.shamel_accounts SET is_promoted = TRUE, promoted_at = now()
      WHERE store_id = p_store_id AND code = v_rec.code;

      v_accounts_count := v_accounts_count + 1;
    END LOOP;

    -- ربط الحسابات الآباء
    UPDATE public.accounts a
    SET parent_id = p.id
    FROM public.accounts p
    JOIN public.shamel_accounts sa ON sa.parent_code = p.code AND sa.store_id = p_store_id
    WHERE a.store_id = p_store_id AND a.code = sa.code AND a.parent_id IS DISTINCT FROM p.id;

    v_stage_results := v_stage_results || jsonb_build_object(
      'stage', 1, 'name', 'شجرة الحسابات', 'count', v_accounts_count, 'initial_balance', 0
    );
  END IF;


  -- =========================================================================
  -- المرحلة 2 – العملاء والموردون (بيانات أساسية فقط ورصيد أولي صفر)
  -- =========================================================================
  IF p_stage = 0 OR p_stage = 2 THEN
    -- الزبائن (C... أو غير S...)
    FOR v_rec IN 
      SELECT * FROM public.shamel_customers 
      WHERE store_id = p_store_id AND code NOT LIKE 'S%'
    LOOP
      IF EXISTS (SELECT 1 FROM public.customers WHERE store_id = p_store_id AND shamel_code = v_rec.code) THEN
        UPDATE public.customers
        SET name = v_rec.name,
            phone = COALESCE(v_rec.phone, phone),
            address = COALESCE(v_rec.address, address)
        WHERE store_id = p_store_id AND shamel_code = v_rec.code;
      ELSE
        INSERT INTO public.customers (
          store_id, name, phone, address, balance, total_spent, total_paid, shamel_code
        ) VALUES (
          p_store_id, v_rec.name, v_rec.phone, v_rec.address, 0, 0, 0, v_rec.code
        );
      END IF;

      UPDATE public.shamel_customers SET is_promoted = TRUE, promoted_at = now()
      WHERE store_id = p_store_id AND code = v_rec.code;

      v_customers_count := v_customers_count + 1;
    END LOOP;

    -- الموردون (S...)
    FOR v_rec IN 
      SELECT * FROM public.shamel_customers 
      WHERE store_id = p_store_id AND code LIKE 'S%'
    LOOP
      IF EXISTS (SELECT 1 FROM public.suppliers WHERE store_id = p_store_id AND shamel_code = v_rec.code) THEN
        UPDATE public.suppliers
        SET name = v_rec.name,
            phone = COALESCE(v_rec.phone, phone),
            address = COALESCE(v_rec.address, address)
        WHERE store_id = p_store_id AND shamel_code = v_rec.code;
      ELSE
        INSERT INTO public.suppliers (
          store_id, name, phone, address, balance, shamel_code
        ) VALUES (
          p_store_id, v_rec.name, v_rec.phone, v_rec.address, 0, v_rec.code
        );
      END IF;

      UPDATE public.shamel_customers SET is_promoted = TRUE, promoted_at = now()
      WHERE store_id = p_store_id AND code = v_rec.code;

      v_suppliers_count := v_suppliers_count + 1;
    END LOOP;

    v_stage_results := v_stage_results || jsonb_build_object(
      'stage', 2, 'name', 'العملاء والموردون', 'customers_count', v_customers_count, 'suppliers_count', v_suppliers_count, 'initial_balance', 0
    );
  END IF;


  -- =========================================================================
  -- المرحلة 3 – الأصناف والمخازن (البيانات الأساسية فقط ورصيد مخزون أولي صفر)
  -- =========================================================================
  IF p_stage = 0 OR p_stage = 3 THEN
    FOR v_rec IN 
      SELECT * FROM public.shamel_stock 
      WHERE store_id = p_store_id
    LOOP
      IF EXISTS (SELECT 1 FROM public.products WHERE store_id = p_store_id AND shamel_code = v_rec.code) THEN
        UPDATE public.products
        SET name = v_rec.name,
            barcode = COALESCE(v_rec.barcode, barcode),
            price = CASE WHEN v_rec.price > 0 THEN v_rec.price ELSE price END,
            cost_price = CASE WHEN v_rec.cost_price > 0 THEN v_rec.cost_price ELSE cost_price END,
            status = 'active'
        WHERE store_id = p_store_id AND shamel_code = v_rec.code;
      ELSE
        INSERT INTO public.products (
          store_id, name, slug, sku, barcode, price, cost_price, stock_quantity, shamel_code, status
        ) VALUES (
          p_store_id, v_rec.name,
          'shamel-' || lower(regexp_replace(v_rec.code, '[^a-zA-Z0-9]', '', 'g')) || '-' || substr(md5(random()::text), 1, 6),
          v_rec.code, v_rec.barcode,
          COALESCE(v_rec.price, 0), COALESCE(v_rec.cost_price, 0), 0, v_rec.code, 'active'
        );
      END IF;

      UPDATE public.shamel_stock SET is_promoted = TRUE, promoted_at = now()
      WHERE store_id = p_store_id AND code = v_rec.code;

      v_products_count := v_products_count + 1;
    END LOOP;

    v_stage_results := v_stage_results || jsonb_build_object(
      'stage', 3, 'name', 'الأصناف والمخازن', 'count', v_products_count, 'initial_stock', 0
    );
  END IF;


  -- =========================================================================
  -- المرحلة 4 – المشتريات (مرتبة زمنياً: مخزون + تكلفة + قيد + رصيد المورد)
  -- =========================================================================
  IF p_stage = 0 OR p_stage = 4 THEN
    FOR v_rec IN 
      SELECT 
        e.document,
        min(e.day) as day,
        max(e.currency) as currency,
        max(COALESCE(e.description, 'فاتورة مشتريات الشامل')) as description,
        round(sum(CASE WHEN e.direction = 2 THEN e.amount ELSE 0 END), 2) as total_cred,
        round(sum(CASE WHEN e.direction = 1 THEN e.amount ELSE 0 END), 2) as total_deb,
        max(CASE WHEN e.account LIKE 'S%' THEN e.account END) as supp_code
      FROM public.shamel_entries e
      WHERE e.store_id = p_store_id
        AND (e.document_type LIKE '%مشتريات%' OR e.document_type LIKE '%شراء%' OR (e.document LIKE 'P%' AND e.document NOT LIKE 'PR%'))
      GROUP BY e.document
      ORDER BY min(e.day) ASC, e.document ASC
    LOOP
      v_supp_id := NULL;
      IF v_rec.supp_code IS NOT NULL THEN
        SELECT id INTO v_supp_id FROM public.suppliers WHERE store_id = p_store_id AND shamel_code = v_rec.supp_code LIMIT 1;
      END IF;

      v_doc_total := GREATEST(v_rec.total_deb, v_rec.total_cred);

      -- 4.1 إدراج فاتورة المشتريات
      INSERT INTO public.purchase_invoices (
        store_id, invoice_number, supplier_id, invoice_date, subtotal, total_amount, currency,
        payment_status, status, shamel_source_id, shamel_source_type, notes
      ) VALUES (
        p_store_id, v_rec.document, v_supp_id, v_rec.day, v_doc_total, v_doc_total,
        COALESCE(v_rec.currency, 'ILS'), 'paid', 'completed', v_rec.document, 'purchase', v_rec.description
      )
      ON CONFLICT (store_id, invoice_number) DO UPDATE SET
        total_amount = EXCLUDED.total_amount,
        shamel_source_id = EXCLUDED.shamel_source_id
      RETURNING id INTO v_pur_id;

      -- 4.2 بنود المشتريات وحركات المخزون
      FOR v_sub_rec IN 
        SELECT * FROM public.shamel_invoice_items 
        WHERE store_id = p_store_id AND document = v_rec.document
        ORDER BY line_index ASC
      LOOP
        SELECT id INTO v_prod_id FROM public.products WHERE store_id = p_store_id AND shamel_code = v_sub_rec.item_code LIMIT 1;

        INSERT INTO public.purchase_items (
          purchase_invoice_id, product_id, product_name, quantity, unit_price, total_price
        ) VALUES (
          v_pur_id, v_prod_id, v_sub_rec.item_name, v_sub_rec.quantity, v_sub_rec.price, v_sub_rec.total
        );

        IF v_prod_id IS NOT NULL THEN
          INSERT INTO public.inventory_movements (
            store_id, product_id, movement_type, document_number, document_type, ref_id,
            quantity_in, quantity_out, balance_after, unit_price, movement_date, notes,
            shamel_source_id, shamel_source_type
          ) VALUES (
            p_store_id, v_prod_id, 'purchase', v_rec.document, 'فاتورة مشتريات', v_pur_id,
            v_sub_rec.quantity, 0, 0, v_sub_rec.price, v_rec.day, 'شراء بموجب فاتورة #' || v_rec.document,
            v_rec.document, 'purchase'
          );
        END IF;
      END LOOP;

      -- 4.3 قيد محاسبي ثنائي الاتجاه
      INSERT INTO public.journal_entries (
        store_id, entry_number, date, description, source, ref_id, status, shamel_source_id, shamel_source_type
      ) VALUES (
        p_store_id, 'JE-P-' || v_rec.document, v_rec.day, 'إثبات فاتورة مشتريات #' || v_rec.document,
        'purchase', v_pur_id, 'posted', v_rec.document, 'purchase'
      )
      ON CONFLICT (store_id, entry_number) DO UPDATE SET
        ref_id = EXCLUDED.ref_id,
        shamel_source_id = EXCLUDED.shamel_source_id
      RETURNING id INTO v_je_id;

      UPDATE public.purchase_invoices SET journal_entry_id = v_je_id WHERE id = v_pur_id;

      -- مدين: المخزون، دائن: المورد أو الصندوق
      DELETE FROM public.journal_lines WHERE journal_entry_id = v_je_id;
      INSERT INTO public.journal_lines (journal_entry_id, account_id, debit, credit, currency, description)
      VALUES 
        (v_je_id, v_inv_acc_id, v_doc_total, 0, COALESCE(v_rec.currency, 'ILS'), 'إدخال مخزون مشتريات #' || v_rec.document),
        (v_je_id, COALESCE(v_payable_acc_id, v_cash_acc_id), 0, v_doc_total, COALESCE(v_rec.currency, 'ILS'), 'استحقاق مورد فاتورة #' || v_rec.document);

      v_purchases_count := v_purchases_count + 1;
    END LOOP;

    v_stage_results := v_stage_results || jsonb_build_object(
      'stage', 4, 'name', 'المشتريات', 'count', v_purchases_count
    );
  END IF;


  -- =========================================================================
  -- المرحلة 5 – مردودات المشتريات (تخفيض مخزون + عكس قيد + تسوية مورد)
  -- =========================================================================
  IF p_stage = 0 OR p_stage = 5 THEN
    FOR v_rec IN 
      SELECT 
        e.document,
        min(e.day) as day,
        max(e.currency) as currency,
        round(sum(CASE WHEN e.direction = 1 THEN e.amount ELSE 0 END), 2) as total_deb,
        max(CASE WHEN e.account LIKE 'S%' THEN e.account END) as supp_code
      FROM public.shamel_entries e
      WHERE e.store_id = p_store_id
        AND (e.document_type LIKE '%مردود%مشتريات%' OR e.document_type LIKE '%مرتجع%مشتريات%' OR e.document LIKE 'PR%')
      GROUP BY e.document
      ORDER BY min(e.day) ASC, e.document ASC
    LOOP
      v_supp_id := NULL;
      IF v_rec.supp_code IS NOT NULL THEN
        SELECT id INTO v_supp_id FROM public.suppliers WHERE store_id = p_store_id AND shamel_code = v_rec.supp_code LIMIT 1;
      END IF;

      INSERT INTO public.purchase_returns (
        store_id, return_number, supplier_id, return_date, total_amount, status,
        refund_method, shamel_source_id, shamel_source_type, notes
      ) VALUES (
        p_store_id, v_rec.document, v_supp_id, v_rec.day, v_rec.total_deb, 'completed',
        'credit', v_rec.document, 'purchase_return', 'مردود مشتريات الشامل #' || v_rec.document
      )
      ON CONFLICT (store_id, return_number) DO UPDATE SET
        total_amount = EXCLUDED.total_amount,
        shamel_source_id = EXCLUDED.shamel_source_id
      RETURNING id INTO v_ret_id;

      -- حركة المخزون
      FOR v_sub_rec IN 
        SELECT * FROM public.shamel_invoice_items 
        WHERE store_id = p_store_id AND document = v_rec.document
      LOOP
        SELECT id INTO v_prod_id FROM public.products WHERE store_id = p_store_id AND shamel_code = v_sub_rec.item_code LIMIT 1;
        IF v_prod_id IS NOT NULL THEN
          INSERT INTO public.inventory_movements (
            store_id, product_id, movement_type, document_number, document_type, ref_id,
            quantity_in, quantity_out, balance_after, unit_price, movement_date, notes,
            shamel_source_id, shamel_source_type
          ) VALUES (
            p_store_id, v_prod_id, 'purchase_return', v_rec.document, 'مردود مشتريات', v_ret_id,
            0, v_sub_rec.quantity, 0, v_sub_rec.price, v_rec.day, 'إرجاع بضاعة لمورد #' || v_rec.document,
            v_rec.document, 'purchase_return'
          );
        END IF;
      END LOOP;

      -- قيد المحاسبة
      INSERT INTO public.journal_entries (
        store_id, entry_number, date, description, source, ref_id, status, shamel_source_id, shamel_source_type
      ) VALUES (
        p_store_id, 'JE-PR-' || v_rec.document, v_rec.day, 'إثبات مردود مشتريات #' || v_rec.document,
        'purchase_return', v_ret_id, 'posted', v_rec.document, 'purchase_return'
      )
      ON CONFLICT (store_id, entry_number) DO UPDATE SET
        ref_id = EXCLUDED.ref_id,
        shamel_source_id = EXCLUDED.shamel_source_id
      RETURNING id INTO v_je_id;

      DELETE FROM public.journal_lines WHERE journal_entry_id = v_je_id;
      INSERT INTO public.journal_lines (journal_entry_id, account_id, debit, credit, currency, description)
      VALUES 
        (v_je_id, COALESCE(v_payable_acc_id, v_cash_acc_id), v_rec.total_deb, 0, COALESCE(v_rec.currency, 'ILS'), 'تخفيض ذمة مورد مردود #' || v_rec.document),
        (v_je_id, v_inv_acc_id, 0, v_rec.total_deb, COALESCE(v_rec.currency, 'ILS'), 'تخفيض مخزون مردود مشتريات #' || v_rec.document);

      v_purchase_returns_count := v_purchase_returns_count + 1;
    END LOOP;

    v_stage_results := v_stage_results || jsonb_build_object(
      'stage', 5, 'name', 'مردودات المشتريات', 'count', v_purchase_returns_count
    );
  END IF;


  -- =========================================================================
  -- المرحلة 6 – المبيعات (مرتبة زمنياً: مخزون + تكلفة COGS + إيراد + ذمم)
  -- =========================================================================
  IF p_stage = 0 OR p_stage = 6 THEN
    FOR v_rec IN 
      SELECT 
        e.document,
        min(e.day) as day,
        max(e.currency) as currency,
        max(COALESCE(e.description, 'فاتورة مبيعات الشامل')) as description,
        round(sum(CASE WHEN e.direction = 1 THEN e.amount ELSE 0 END), 2) as total_deb,
        round(sum(CASE WHEN e.direction = 2 THEN e.amount ELSE 0 END), 2) as total_cred,
        max(CASE WHEN e.account LIKE 'C%' THEN e.account END) as cust_code
      FROM public.shamel_entries e
      WHERE e.store_id = p_store_id
        AND (e.document_type LIKE '%مبيعات%' OR e.document_type LIKE '%بيع%' OR (e.document LIKE 'I%' AND e.document NOT LIKE 'IR%'))
      GROUP BY e.document
      ORDER BY min(e.day) ASC, e.document ASC
    LOOP
      v_cust_id := NULL;
      IF v_rec.cust_code IS NOT NULL THEN
        SELECT id INTO v_cust_id FROM public.customers WHERE store_id = p_store_id AND shamel_code = v_rec.cust_code LIMIT 1;
      END IF;

      v_doc_total := GREATEST(v_rec.total_deb, v_rec.total_cred);

      -- 6.1 إدراج فاتورة المبيعات
      INSERT INTO public.invoices (
        store_id, invoice_number, customer_id, customer_name, total, total_amount, subtotal,
        amount_paid, amount_remaining, status, payment_method, shamel_source_id, shamel_source_type, notes
      ) VALUES (
        p_store_id, v_rec.document, v_cust_id, COALESCE((SELECT name FROM public.customers WHERE id = v_cust_id), 'عميل الشامل'),
        v_doc_total, v_doc_total, v_doc_total, v_doc_total, 0, 'completed', 'credit', v_rec.document, 'sale', v_rec.description
      )
      ON CONFLICT (store_id, invoice_number) DO UPDATE SET
        total = EXCLUDED.total,
        total_amount = EXCLUDED.total_amount,
        shamel_source_id = EXCLUDED.shamel_source_id
      RETURNING id INTO v_inv_id;

      -- 6.2 بنود الفاتورة وحركات المخزون وحساب تكلفة البضاعة المباعة COGS
      v_item_cost := 0;
      FOR v_sub_rec IN 
        SELECT * FROM public.shamel_invoice_items 
        WHERE store_id = p_store_id AND document = v_rec.document
        ORDER BY line_index ASC
      LOOP
        SELECT id, cost_price INTO v_prod_id, v_item_cost FROM public.products WHERE store_id = p_store_id AND shamel_code = v_sub_rec.item_code LIMIT 1;

        INSERT INTO public.invoice_items (
          invoice_id, product_id, name, quantity, unit_price, cost_price, total_price, total
        ) VALUES (
          v_inv_id, v_prod_id, v_sub_rec.item_name, v_sub_rec.quantity, v_sub_rec.price,
          COALESCE(v_item_cost, 0), v_sub_rec.total, v_sub_rec.total
        );

        IF v_prod_id IS NOT NULL THEN
          INSERT INTO public.inventory_movements (
            store_id, product_id, movement_type, document_number, document_type, ref_id,
            quantity_in, quantity_out, balance_after, unit_price, movement_date, notes,
            shamel_source_id, shamel_source_type
          ) VALUES (
            p_store_id, v_prod_id, 'sale', v_rec.document, 'فاتورة مبيعات', v_inv_id,
            0, v_sub_rec.quantity, 0, v_sub_rec.price, v_rec.day, 'مبيعات بموجب فاتورة #' || v_rec.document,
            v_rec.document, 'sale'
          );
        END IF;
      END LOOP;

      -- 6.3 حركة كشف حساب العميل
      IF v_cust_id IS NOT NULL THEN
        INSERT INTO public.customer_ledger (
          store_id, customer_id, type, date, description, debit, credit, balance, reference_id, reference_type
        ) VALUES (
          p_store_id, v_cust_id, 'invoice', v_rec.day, 'فاتورة مبيعات #' || v_rec.document,
          v_doc_total, 0, 0, v_inv_id, 'invoice'
        );
      END IF;

      -- 6.4 القيد المحاسبي المزدوج
      INSERT INTO public.journal_entries (
        store_id, entry_number, date, description, source, ref_id, status, shamel_source_id, shamel_source_type
      ) VALUES (
        p_store_id, 'JE-I-' || v_rec.document, v_rec.day, 'إثبات مبيعات فاتورة #' || v_rec.document,
        'invoice', v_inv_id, 'posted', v_rec.document, 'sale'
      )
      ON CONFLICT (store_id, entry_number) DO UPDATE SET
        ref_id = EXCLUDED.ref_id,
        shamel_source_id = EXCLUDED.shamel_source_id
      RETURNING id INTO v_je_id;

      DELETE FROM public.journal_lines WHERE journal_entry_id = v_je_id;
      -- مدين: ذمم عملاء، دائن: مبيعات
      INSERT INTO public.journal_lines (journal_entry_id, account_id, debit, credit, currency, description)
      VALUES 
        (v_je_id, COALESCE(v_receivable_acc_id, v_cash_acc_id), v_doc_total, 0, COALESCE(v_rec.currency, 'ILS'), 'ذمة عميل فاتورة #' || v_rec.document),
        (v_je_id, v_sales_acc_id, 0, v_doc_total, COALESCE(v_rec.currency, 'ILS'), 'إيراد مبيعات فاتورة #' || v_rec.document);

      v_sales_count := v_sales_count + 1;
    END LOOP;

    v_stage_results := v_stage_results || jsonb_build_object(
      'stage', 6, 'name', 'المبيعات', 'count', v_sales_count
    );
  END IF;


  -- =========================================================================
  -- المرحلة 7 – مردودات المبيعات (إرجاع مخزون + عكس إيراد وتكلفة + تسوية عميل)
  -- =========================================================================
  IF p_stage = 0 OR p_stage = 7 THEN
    FOR v_rec IN 
      SELECT 
        e.document,
        min(e.day) as day,
        max(e.currency) as currency,
        round(sum(CASE WHEN e.direction = 2 THEN e.amount ELSE 0 END), 2) as total_cred,
        max(CASE WHEN e.account LIKE 'C%' THEN e.account END) as cust_code
      FROM public.shamel_entries e
      WHERE e.store_id = p_store_id
        AND (e.document_type LIKE '%مردود%مبيعات%' OR e.document_type LIKE '%مرتجع%مبيعات%' OR e.document LIKE 'IR%' OR e.document LIKE 'SR%')
      GROUP BY e.document
      ORDER BY min(e.day) ASC, e.document ASC
    LOOP
      v_cust_id := NULL;
      IF v_rec.cust_code IS NOT NULL THEN
        SELECT id INTO v_cust_id FROM public.customers WHERE store_id = p_store_id AND shamel_code = v_rec.cust_code LIMIT 1;
      END IF;

      INSERT INTO public.sales_returns (
        store_id, return_number, customer_id, return_date, total_amount, status,
        refund_method, shamel_source_id, shamel_source_type, notes
      ) VALUES (
        p_store_id, v_rec.document, v_cust_id, v_rec.day, v_rec.total_cred, 'completed',
        'credit', v_rec.document, 'sales_return', 'مردود مبيعات الشامل #' || v_rec.document
      )
      ON CONFLICT (store_id, return_number) DO UPDATE SET
        total_amount = EXCLUDED.total_amount,
        shamel_source_id = EXCLUDED.shamel_source_id
      RETURNING id INTO v_ret_id;

      -- حركة المخزون (إدخال البضاعة المرجعة)
      FOR v_sub_rec IN 
        SELECT * FROM public.shamel_invoice_items 
        WHERE store_id = p_store_id AND document = v_rec.document
      LOOP
        SELECT id INTO v_prod_id FROM public.products WHERE store_id = p_store_id AND shamel_code = v_sub_rec.item_code LIMIT 1;
        IF v_prod_id IS NOT NULL THEN
          INSERT INTO public.inventory_movements (
            store_id, product_id, movement_type, document_number, document_type, ref_id,
            quantity_in, quantity_out, balance_after, unit_price, movement_date, notes,
            shamel_source_id, shamel_source_type
          ) VALUES (
            p_store_id, v_prod_id, 'sales_return', v_rec.document, 'مردود مبيعات', v_ret_id,
            v_sub_rec.quantity, 0, 0, v_sub_rec.price, v_rec.day, 'بضاعة مرجعة من عميل #' || v_rec.document,
            v_rec.document, 'sales_return'
          );
        END IF;
      END LOOP;

      -- كشف حساب العميل
      IF v_cust_id IS NOT NULL THEN
        INSERT INTO public.customer_ledger (
          store_id, customer_id, type, date, description, debit, credit, balance, reference_id, reference_type
        ) VALUES (
          p_store_id, v_cust_id, 'return', v_rec.day, 'مردود مبيعات #' || v_rec.document,
          0, v_rec.total_cred, 0, v_ret_id, 'sales_return'
        );
      END IF;

      -- القيد المحاسبي
      INSERT INTO public.journal_entries (
        store_id, entry_number, date, description, source, ref_id, status, shamel_source_id, shamel_source_type
      ) VALUES (
        p_store_id, 'JE-SR-' || v_rec.document, v_rec.day, 'إثبات مردود مبيعات #' || v_rec.document,
        'sales_return', v_ret_id, 'posted', v_rec.document, 'sales_return'
      )
      ON CONFLICT (store_id, entry_number) DO UPDATE SET
        ref_id = EXCLUDED.ref_id,
        shamel_source_id = EXCLUDED.shamel_source_id
      RETURNING id INTO v_je_id;

      DELETE FROM public.journal_lines WHERE journal_entry_id = v_je_id;
      INSERT INTO public.journal_lines (journal_entry_id, account_id, debit, credit, currency, description)
      VALUES 
        (v_je_id, v_sales_acc_id, v_rec.total_cred, 0, COALESCE(v_rec.currency, 'ILS'), 'تخفيض إيراد مردود مبيعات #' || v_rec.document),
        (v_je_id, COALESCE(v_receivable_acc_id, v_cash_acc_id), 0, v_rec.total_cred, COALESCE(v_rec.currency, 'ILS'), 'تخفيض ذمة عميل مردود #' || v_rec.document);

      v_sales_returns_count := v_sales_returns_count + 1;
    END LOOP;

    v_stage_results := v_stage_results || jsonb_build_object(
      'stage', 7, 'name', 'مردودات المبيعات', 'count', v_sales_returns_count
    );
  END IF;


  -- =========================================================================
  -- المرحلة 8 – سندات القبض (الصندوق المحدد بدقة + الشيكات + تخفيض العميل)
  -- =========================================================================
  IF p_stage = 0 OR p_stage = 8 THEN
    FOR v_rec IN 
      SELECT 
        e.document,
        min(e.day) as day,
        max(e.currency) as currency,
        max(COALESCE(e.description, 'سند قبض الشامل')) as description,
        round(sum(CASE WHEN e.direction = 2 THEN e.amount ELSE 0 END), 2) as total_cred,
        max(CASE WHEN e.account LIKE 'C%' THEN e.account END) as cust_code
      FROM public.shamel_entries e
      WHERE e.store_id = p_store_id
        AND (e.document_type LIKE '%قبض%' OR e.document LIKE 'R%')
      GROUP BY e.document
      ORDER BY min(e.day) ASC, e.document ASC
    LOOP
      v_cust_id := NULL;
      IF v_rec.cust_code IS NOT NULL THEN
        SELECT id INTO v_cust_id FROM public.customers WHERE store_id = p_store_id AND shamel_code = v_rec.cust_code LIMIT 1;
      END IF;

      INSERT INTO public.vouchers (
        store_id, voucher_number, type, date, amount, customer_id,
        party_name, payment_method, cash_box_id, category, description,
        shamel_source_id, shamel_source_type
      ) VALUES (
        p_store_id, v_rec.document, 'receipt', v_rec.day, v_rec.total_cred, v_cust_id,
        COALESCE((SELECT name FROM public.customers WHERE id = v_cust_id), 'عميل الشامل'),
        'cash', v_default_cash_box_id, 'تحصيل ذمم', v_rec.description,
        v_rec.document, 'receipt_voucher'
      )
      ON CONFLICT (id) DO NOTHING
      RETURNING id INTO v_vouch_id;

      IF v_vouch_id IS NULL THEN
        SELECT id INTO v_vouch_id FROM public.vouchers WHERE store_id = p_store_id AND voucher_number = v_rec.document LIMIT 1;
      END IF;

      -- حركة كشف حساب الزبون
      IF v_cust_id IS NOT NULL THEN
        INSERT INTO public.customer_ledger (
          store_id, customer_id, type, date, description, debit, credit, balance, reference_id, reference_type
        ) VALUES (
          p_store_id, v_cust_id, 'payment', v_rec.day, 'سند قبض #' || v_rec.document,
          0, v_rec.total_cred, 0, v_vouch_id, 'voucher'
        );
      END IF;

      -- القيد المحاسبي
      INSERT INTO public.journal_entries (
        store_id, entry_number, date, description, source, ref_id, status, shamel_source_id, shamel_source_type
      ) VALUES (
        p_store_id, 'JE-R-' || v_rec.document, v_rec.day, 'سند قبض #' || v_rec.document,
        'voucher', v_vouch_id, 'posted', v_rec.document, 'receipt_voucher'
      )
      ON CONFLICT (store_id, entry_number) DO UPDATE SET
        ref_id = EXCLUDED.ref_id,
        shamel_source_id = EXCLUDED.shamel_source_id
      RETURNING id INTO v_je_id;

      DELETE FROM public.journal_lines WHERE journal_entry_id = v_je_id;
      -- مدين: الصندوق، دائن: ذمة العميل
      INSERT INTO public.journal_lines (journal_entry_id, account_id, debit, credit, currency, description)
      VALUES 
        (v_je_id, v_cash_acc_id, v_rec.total_cred, 0, COALESCE(v_rec.currency, 'ILS'), 'قبض نقدي صندوق رئيسي #' || v_rec.document),
        (v_je_id, COALESCE(v_receivable_acc_id, v_cash_acc_id), 0, v_rec.total_cred, COALESCE(v_rec.currency, 'ILS'), 'سداد عميل سند قبض #' || v_rec.document);

      v_receipts_count := v_receipts_count + 1;
    END LOOP;

    v_stage_results := v_stage_results || jsonb_build_object(
      'stage', 8, 'name', 'سندات القبض', 'count', v_receipts_count
    );
  END IF;


  -- =========================================================================
  -- المرحلة 9 – الشيكات الناتجة عن القبوضات والعمليات
  -- =========================================================================
  IF p_stage = 0 OR p_stage = 9 THEN
    FOR v_rec IN 
      SELECT * FROM public.shamel_cheques 
      WHERE store_id = p_store_id
    LOOP
      v_cust_id := NULL;
      IF v_rec.customer_code IS NOT NULL THEN
        SELECT id INTO v_cust_id FROM public.customers WHERE store_id = p_store_id AND shamel_code = v_rec.customer_code LIMIT 1;
      END IF;

      INSERT INTO public.checks (
        store_id, type, check_number, bank_code, bank_name, branch_code, branch_name,
        account_number, drawer_name, amount, currency, amount_ils, due_date, status,
        customer_id, shamel_code
      ) VALUES (
        p_store_id, COALESCE(v_rec.type, 'received'), v_rec.cheque_number, v_rec.bank_code,
        COALESCE(v_rec.bank_name, 'بنك ' || COALESCE(v_rec.bank_code, '')),
        v_rec.branch_code, COALESCE(v_rec.branch_name, 'فرع ' || COALESCE(v_rec.branch_code, '')),
        v_rec.account_number, COALESCE(v_rec.customer_name, 'عميل الشامل'),
        v_rec.amount, COALESCE(v_rec.currency, 'ILS'), v_rec.amount,
        COALESCE(v_rec.due_date, CURRENT_DATE), COALESCE(v_rec.status, 'in_portfolio'),
        v_cust_id, v_rec.document
      )
      ON CONFLICT (store_id, document, cheque_number, amount) DO UPDATE SET
        status = EXCLUDED.status,
        due_date = EXCLUDED.due_date;

      UPDATE public.shamel_cheques SET is_promoted = TRUE, promoted_at = now()
      WHERE store_id = p_store_id AND id = v_rec.id;

      v_cheques_count := v_cheques_count + 1;
    END LOOP;

    v_stage_results := v_stage_results || jsonb_build_object(
      'stage', 9, 'name', 'محفظة الشيكات التشغيلية', 'count', v_cheques_count
    );
  END IF;


  -- =========================================================================
  -- المرحلة 10 – سندات الصرف والمصروفات (تخفيض الصندوق/البنك + قيد محاسبي)
  -- =========================================================================
  IF p_stage = 0 OR p_stage = 10 THEN
    FOR v_rec IN 
      SELECT 
        e.document,
        min(e.day) as day,
        max(e.currency) as currency,
        max(COALESCE(e.description, 'سند صرف الشامل')) as description,
        round(sum(CASE WHEN e.direction = 1 THEN e.amount ELSE 0 END), 2) as total_deb,
        max(CASE WHEN e.account LIKE 'S%' THEN e.account END) as supp_code
      FROM public.shamel_entries e
      WHERE e.store_id = p_store_id
        AND (e.document_type LIKE '%صرف%' OR e.document_type LIKE '%دفع%' OR e.document LIKE 'D%' OR e.document LIKE 'PV%')
      GROUP BY e.document
      ORDER BY min(e.day) ASC, e.document ASC
    LOOP
      v_supp_id := NULL;
      IF v_rec.supp_code IS NOT NULL THEN
        SELECT id INTO v_supp_id FROM public.suppliers WHERE store_id = p_store_id AND shamel_code = v_rec.supp_code LIMIT 1;
      END IF;

      INSERT INTO public.vouchers (
        store_id, voucher_number, type, date, amount, supplier_id,
        party_name, payment_method, cash_box_id, category, description,
        shamel_source_id, shamel_source_type
      ) VALUES (
        p_store_id, v_rec.document, 'payment', v_rec.day, v_rec.total_deb, v_supp_id,
        COALESCE((SELECT name FROM public.suppliers WHERE id = v_supp_id), 'مورد / مصروف'),
        'cash', v_default_cash_box_id, 'سند صرف', v_rec.description,
        v_rec.document, 'payment_voucher'
      )
      ON CONFLICT (id) DO NOTHING
      RETURNING id INTO v_vouch_id;

      IF v_vouch_id IS NULL THEN
        SELECT id INTO v_vouch_id FROM public.vouchers WHERE store_id = p_store_id AND voucher_number = v_rec.document LIMIT 1;
      END IF;

      -- القيد المحاسبي
      INSERT INTO public.journal_entries (
        store_id, entry_number, date, description, source, ref_id, status, shamel_source_id, shamel_source_type
      ) VALUES (
        p_store_id, 'JE-D-' || v_rec.document, v_rec.day, 'سند صرف #' || v_rec.document,
        'voucher', v_vouch_id, 'posted', v_rec.document, 'payment_voucher'
      )
      ON CONFLICT (store_id, entry_number) DO UPDATE SET
        ref_id = EXCLUDED.ref_id,
        shamel_source_id = EXCLUDED.shamel_source_id
      RETURNING id INTO v_je_id;

      DELETE FROM public.journal_lines WHERE journal_entry_id = v_je_id;
      -- مدين: المورد أو المصروف، دائن: الصندوق
      INSERT INTO public.journal_lines (journal_entry_id, account_id, debit, credit, currency, description)
      VALUES 
        (v_je_id, COALESCE(v_payable_acc_id, v_cogs_acc_id), v_rec.total_deb, 0, COALESCE(v_rec.currency, 'ILS'), 'صرف نقدي سند #' || v_rec.document),
        (v_je_id, v_cash_acc_id, 0, v_rec.total_deb, COALESCE(v_rec.currency, 'ILS'), 'خروج نقدية من الصندوق #' || v_rec.document);

      v_payments_count := v_payments_count + 1;
    END LOOP;

    v_stage_results := v_stage_results || jsonb_build_object(
      'stage', 10, 'name', 'سندات الصرف والمصروفات', 'count', v_payments_count
    );
  END IF;


  -- =========================================================================
  -- المرحلة 11 و 12 – القيود المستقلة فعلياً (منع التكرار واستبعاد قيود الفواتير)
  -- =========================================================================
  IF p_stage = 0 OR p_stage = 11 OR p_stage = 12 THEN
    -- استخراج المستندات التي لم يتم ترحيلها كفواتير أو سندات مسبقاً
    FOR v_rec IN 
      SELECT 
        e.document,
        min(e.day) as day,
        max(COALESCE(e.description, 'قيد يومية مستقل')) as description,
        round(sum(CASE WHEN e.direction = 1 THEN e.amount ELSE 0 END), 2) as total_deb,
        round(sum(CASE WHEN e.direction = 2 THEN e.amount ELSE 0 END), 2) as total_cred
      FROM public.shamel_entries e
      WHERE e.store_id = p_store_id
        AND NOT EXISTS (
          SELECT 1 FROM public.journal_entries je 
          WHERE je.store_id = p_store_id AND je.shamel_source_id = e.document
        )
      GROUP BY e.document
      ORDER BY min(e.day) ASC, e.document ASC
    LOOP
      IF abs(v_rec.total_deb - v_rec.total_cred) < 0.05 AND v_rec.total_deb > 0 THEN
        INSERT INTO public.journal_entries (
          store_id, entry_number, date, description, source, status, shamel_source_id, shamel_source_type
        ) VALUES (
          p_store_id, 'JE-' || v_rec.document, v_rec.day, v_rec.description,
          'manual', 'posted', v_rec.document, 'journal_entry'
        )
        ON CONFLICT (store_id, entry_number) DO UPDATE SET
          shamel_source_id = EXCLUDED.shamel_source_id
        RETURNING id INTO v_je_id;

        DELETE FROM public.journal_lines WHERE journal_entry_id = v_je_id;

        FOR v_entry_rec IN 
          SELECT * FROM public.shamel_entries 
          WHERE store_id = p_store_id AND document = v_rec.document
          ORDER BY line_index ASC
        LOOP
          -- البحث عن الحساب المناسب
          SELECT id INTO v_inv_acc_id FROM public.accounts WHERE store_id = p_store_id AND (code = v_entry_rec.account OR shamel_code = v_entry_rec.account) LIMIT 1;
          IF v_inv_acc_id IS NULL THEN
            v_inv_acc_id := v_cash_acc_id;
          END IF;

          INSERT INTO public.journal_lines (
            journal_entry_id, account_id, debit, credit, currency, description
          ) VALUES (
            v_je_id, v_inv_acc_id,
            CASE WHEN v_entry_rec.direction = 1 THEN v_entry_rec.amount ELSE 0 END,
            CASE WHEN v_entry_rec.direction = 2 THEN v_entry_rec.amount ELSE 0 END,
            COALESCE(v_entry_rec.currency, 'ILS'), v_entry_rec.description
          );
        END LOOP;

        v_standalone_entries_count := v_standalone_entries_count + 1;
      END IF;
    END LOOP;

    v_stage_results := v_stage_results || jsonb_build_object(
      'stage', 12, 'name', 'القيود المستقلة فعلياً', 'count', v_standalone_entries_count
    );
  END IF;


  -- =========================================================================
  -- المرحلة 13 – إعادة احتساب المخزون الفعلي من الحركات
  -- =========================================================================
  IF p_stage = 0 OR p_stage = 13 THEN
    UPDATE public.products p
    SET stock_quantity = COALESCE(sub.net_qty, 0)
    FROM (
      SELECT product_id, sum(quantity_in - quantity_out) as net_qty
      FROM public.inventory_movements
      WHERE store_id = p_store_id
      GROUP BY product_id
    ) sub
    WHERE p.store_id = p_store_id AND p.id = sub.product_id;

    -- إعادة تصفير المنتجات التي لم تسجل أي حركة
    UPDATE public.products
    SET stock_quantity = 0
    WHERE store_id = p_store_id 
      AND id NOT IN (SELECT DISTINCT product_id FROM public.inventory_movements WHERE store_id = p_store_id);

    v_stage_results := v_stage_results || jsonb_build_object(
      'stage', 13, 'name', 'إعادة احتساب المخزون الفعلي', 'status', 'completed'
    );
  END IF;


  -- =========================================================================
  -- المرحلة 14 – إعادة احتساب الصناديق والبنوك
  -- =========================================================================
  IF p_stage = 0 OR p_stage = 14 THEN
    UPDATE public.cash_boxes cb
    SET current_balance = opening_balance + COALESCE(sub.net_cash, 0)
    FROM (
      SELECT cash_box_id, sum(CASE WHEN direction = 'in' THEN amount ELSE -amount END) as net_cash
      FROM public.cash_movements
      WHERE store_id = p_store_id
      GROUP BY cash_box_id
    ) sub
    WHERE cb.store_id = p_store_id AND cb.id = sub.cash_box_id;

    v_stage_results := v_stage_results || jsonb_build_object(
      'stage', 14, 'name', 'إعادة احتساب الصناديق والبنوك', 'status', 'completed'
    );
  END IF;


  -- =========================================================================
  -- المرحلة 15 – إعادة احتساب العملاء والموردين
  -- =========================================================================
  IF p_stage = 0 OR p_stage = 15 THEN
    -- احتساب أرصدة العملاء بدقة رياضية من كشف الحساب
    UPDATE public.customers c
    SET 
      balance = COALESCE(sub.net_bal, 0),
      total_spent = COALESCE(sub.tot_spent, 0),
      total_paid = COALESCE(sub.tot_paid, 0)
    FROM (
      SELECT 
        customer_id,
        sum(debit - credit) as net_bal,
        sum(debit) as tot_spent,
        sum(credit) as tot_paid
      FROM public.customer_ledger
      WHERE store_id = p_store_id
      GROUP BY customer_id
    ) sub
    WHERE c.store_id = p_store_id AND c.id = sub.customer_id;

    -- تصفير العملاء بدون حركات
    UPDATE public.customers
    SET balance = 0, total_spent = 0, total_paid = 0
    WHERE store_id = p_store_id 
      AND id NOT IN (SELECT DISTINCT customer_id FROM public.customer_ledger WHERE store_id = p_store_id);

    -- احتساب أرصدة الموردين
    UPDATE public.suppliers s
    SET balance = COALESCE(sub_p.tot_pur, 0) - COALESCE(sub_v.tot_paid, 0) - COALESCE(sub_r.tot_ret, 0)
    FROM (
      SELECT supplier_id, sum(total_amount) as tot_pur 
      FROM public.purchase_invoices WHERE store_id = p_store_id AND status <> 'cancelled' GROUP BY supplier_id
    ) sub_p
    LEFT JOIN (
      SELECT supplier_id, sum(amount) as tot_paid 
      FROM public.vouchers WHERE store_id = p_store_id AND type = 'payment' GROUP BY supplier_id
    ) sub_v ON sub_v.supplier_id = sub_p.supplier_id
    LEFT JOIN (
      SELECT supplier_id, sum(total_amount) as tot_ret 
      FROM public.purchase_returns WHERE store_id = p_store_id AND status <> 'cancelled' GROUP BY supplier_id
    ) sub_r ON sub_r.supplier_id = sub_p.supplier_id
    WHERE s.store_id = p_store_id AND s.id = sub_p.supplier_id;

    v_stage_results := v_stage_results || jsonb_build_object(
      'stage', 15, 'name', 'إعادة احتساب العملاء والموردين', 'status', 'completed'
    );
  END IF;


  -- =========================================================================
  -- المرحلة 16 – إعادة احتساب محفظة الشيكات
  -- =========================================================================
  IF p_stage = 0 OR p_stage = 16 THEN
    SELECT count(*), round(coalesce(sum(amount_ils), 0), 2) INTO v_cheques_count, v_doc_total
    FROM public.checks 
    WHERE store_id = p_store_id AND status = 'in_portfolio';

    v_stage_results := v_stage_results || jsonb_build_object(
      'stage', 16, 'name', 'إعادة احتساب محفظة الشيكات', 'portfolio_count', v_cheques_count, 'portfolio_total', v_doc_total
    );
  END IF;


  -- =========================================================================
  -- المرحلة 17 – المطابقة النهائية والتدقيق الشامل (Audit & Discrepancies)
  -- =========================================================================
  IF p_stage = 0 OR p_stage = 17 THEN
    -- 17.1 فحص توازن دفتر الأستاذ العام (إجمالي المدين = إجمالي الدائن)
    SELECT 
      round(COALESCE(sum(debit), 0), 2),
      round(COALESCE(sum(credit), 0), 2)
    INTO v_total_debit, v_total_credit
    FROM public.journal_lines jl
    JOIN public.journal_entries je ON je.id = jl.journal_entry_id
    WHERE je.store_id = p_store_id AND je.status = 'posted';

    v_diff := round(abs(v_total_debit - v_total_credit), 2);
    v_is_balanced := (v_diff <= 0.05);

    IF NOT v_is_balanced THEN
      v_discrepancies := v_discrepancies || jsonb_build_object(
        'type', 'journal_unbalanced',
        'category', 'المحاسبة العامة',
        'message', 'فرق في توازن دفتر الأستاذ العام',
        'expected', v_total_debit,
        'actual', v_total_credit,
        'difference', v_diff,
        'recommendation', 'مراجعة قيود التسوية والتحقق من الحركات غير المكتملة'
      );
    END IF;

    -- 17.2 فحص تطابق كميات المخزون مع الحركات
    SELECT count(*) INTO v_mismatched_stock_count
    FROM public.products p
    LEFT JOIN (
      SELECT product_id, sum(quantity_in - quantity_out) as move_qty
      FROM public.inventory_movements
      WHERE store_id = p_store_id
      GROUP BY product_id
    ) m ON m.product_id = p.id
    WHERE p.store_id = p_store_id AND round(p.stock_quantity) <> round(COALESCE(m.move_qty, 0));

    IF v_mismatched_stock_count > 0 THEN
      v_discrepancies := v_discrepancies || jsonb_build_object(
        'type', 'stock_mismatch',
        'category', 'المخزون',
        'message', 'يوجد ' || v_mismatched_stock_count || ' صنف لا يتطابق رصيده مع مجموع الحركات',
        'difference', v_mismatched_stock_count,
        'recommendation', 'تمت إعادة ضبط الكميات تلقائياً لتتطابق مع الحركات الفعلية'
      );
    END IF;

    v_stage_results := v_stage_results || jsonb_build_object(
      'stage', 17, 'name', 'المطابقة النهائية والتدقيق',
      'audit_passed', (v_is_balanced AND v_mismatched_stock_count = 0),
      'total_debit', v_total_debit,
      'total_credit', v_total_credit,
      'difference', v_diff,
      'is_balanced', v_is_balanced,
      'mismatched_stock_count', v_mismatched_stock_count,
      'discrepancies', v_discrepancies
    );
  END IF;

  RETURN jsonb_build_object(
    'success', TRUE,
    'store_id', p_store_id,
    'execution_time_ms', EXTRACT(MILLISECONDS FROM clock_timestamp() - v_stage_start),
    'stages', v_stage_results,
    'audit', jsonb_build_object(
      'is_balanced', v_is_balanced,
      'total_debit', v_total_debit,
      'total_credit', v_total_credit,
      'difference', v_diff,
      'discrepancies_count', jsonb_array_length(v_discrepancies),
      'discrepancies', v_discrepancies
    )
  );
END;
$function$
;
REVOKE ALL ON FUNCTION public.shamel_reconstruct_from_operations(uuid,integer,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.shamel_reconstruct_from_operations(uuid,integer,jsonb) TO authenticated;

-- Guard shamel_refresh_customer_summaries
CREATE OR REPLACE FUNCTION public.shamel_refresh_customer_summaries(p_store_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_count INT := 0;
BEGIN
  PERFORM public.assert_financial_permission(p_store_id,'admin');
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
$function$
;
REVOKE ALL ON FUNCTION public.shamel_refresh_customer_summaries(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.shamel_refresh_customer_summaries(uuid) TO authenticated;

-- Guard shamel_reset_store
CREATE OR REPLACE FUNCTION public.shamel_reset_store(p_store_id uuid, p_wipe_operational boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_customers_count INT := 0;
  v_stock_count INT := 0;
  v_cheques_count INT := 0;
  v_accounts_count INT := 0;
  v_entries_count INT := 0;
  v_inv_items_count INT := 0;
BEGIN
  PERFORM public.assert_financial_permission(p_store_id,'admin');
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
$function$
;
REVOKE ALL ON FUNCTION public.shamel_reset_store(uuid,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.shamel_reset_store(uuid,boolean) TO authenticated;

-- Guard shamel_save_isolated_batch
CREATE OR REPLACE FUNCTION public.shamel_save_isolated_batch(p_store_id uuid, p_snapshot_id text, p_kind text, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_count INT := 0;
BEGIN
  PERFORM public.assert_financial_permission(p_store_id,'admin');
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
$function$
;
REVOKE ALL ON FUNCTION public.shamel_save_isolated_batch(uuid,text,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.shamel_save_isolated_batch(uuid,text,text,jsonb) TO authenticated;

-- Guard ensure_cash_box
CREATE OR REPLACE FUNCTION public.ensure_cash_box(p_store_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_box_id UUID;
BEGIN
  PERFORM public.assert_financial_permission(p_store_id,'post');
  SELECT id INTO v_box_id
  FROM public.cash_boxes
  WHERE store_id = p_store_id AND is_default = TRUE
  ORDER BY created_at ASC
  LIMIT 1;

  IF v_box_id IS NULL THEN
    INSERT INTO public.cash_boxes (store_id, name, type, is_default)
    VALUES (p_store_id, 'الصندوق الرئيسي', 'cash', TRUE)
    RETURNING id INTO v_box_id;
  END IF;

  RETURN v_box_id;
END;
$function$
;
REVOKE ALL ON FUNCTION public.ensure_cash_box(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.ensure_cash_box(uuid) TO authenticated;

-- Guard log_staff_activity
CREATE OR REPLACE FUNCTION public.log_staff_activity(p_store_id uuid, p_session_id text, p_kind text, p_action text DEFAULT NULL::text, p_entity_type text DEFAULT NULL::text, p_entity_id uuid DEFAULT NULL::uuid, p_entity_label text DEFAULT NULL::text, p_page_path text DEFAULT NULL::text, p_details jsonb DEFAULT '{}'::jsonb, p_is_mobile boolean DEFAULT false, p_ip_address text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text, p_browser text DEFAULT NULL::text, p_os text DEFAULT NULL::text, p_device_type text DEFAULT NULL::text, p_screen text DEFAULT NULL::text, p_viewport text DEFAULT NULL::text, p_language text DEFAULT NULL::text, p_timezone text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_uid  uuid := auth.uid();
  v_name text;
BEGIN
  PERFORM public.assert_store_read_permission(p_store_id);
  IF v_uid IS NULL THEN RETURN; END IF;

  -- المنفّذ يجب أن يكون عضواً نشطاً في المتجر
  IF NOT EXISTS (
    SELECT 1 FROM store_members
    WHERE store_id = p_store_id AND profile_id = v_uid AND is_active
  ) THEN
    RETURN;
  END IF;

  SELECT full_name INTO v_name FROM profiles WHERE id = v_uid;

  INSERT INTO staff_activity(
    store_id, actor_id, actor_name, session_id, kind, action,
    entity_type, entity_id, entity_label, page_path, details, is_mobile,
    ip_address, user_agent, browser, os, device_type, screen, viewport, language, timezone
  ) VALUES (
    p_store_id, v_uid, v_name, p_session_id, p_kind, p_action,
    p_entity_type, p_entity_id, p_entity_label, p_page_path,
    COALESCE(p_details, '{}'::jsonb), p_is_mobile,
    p_ip_address, p_user_agent, p_browser, p_os, p_device_type,
    p_screen, p_viewport, p_language, p_timezone
  );
END;
$function$
;
REVOKE ALL ON FUNCTION public.log_staff_activity(uuid,text,text,text,text,uuid,text,text,jsonb,boolean,text,text,text,text,text,text,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.log_staff_activity(uuid,text,text,text,text,uuid,text,text,jsonb,boolean,text,text,text,text,text,text,text,text,text) TO authenticated;

-- Trigger helpers and bootstrap functions never need a direct public RPC surface.
REVOKE ALL ON FUNCTION public.create_default_accounts(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.ensure_full_chart_of_accounts(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.sync_voucher_checks_to_portfolio() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.voucher_to_cash_movement() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.voucher_update_cash_movement() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.voucher_delete_cash_movement() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.handle_new_store() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.record_offer_sale(uuid,uuid,integer) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.generate_sequence_number(p_store_id uuid,p_prefix text) RETURNS text
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE n integer;
BEGIN
 IF p_prefix IS NULL OR length(p_prefix)>40 THEN RAISE EXCEPTION 'بادئة الترقيم غير صالحة'; END IF;
 INSERT INTO public.sequence_counters(store_id,prefix,last_value) VALUES(p_store_id,p_prefix,1)
 ON CONFLICT(store_id,prefix) DO UPDATE SET last_value=public.sequence_counters.last_value+1 RETURNING last_value INTO n;
 RETURN p_prefix || lpad(n::text,greatest(4,length(n::text)),'0');
END $$;
COMMIT;
