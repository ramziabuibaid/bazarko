-- Migration 039: Shamel Item Card with Customer Names & Stock Search Indices
CREATE INDEX IF NOT EXISTS idx_shamel_invoice_items_lookup 
ON public.shamel_invoice_items (store_id, item_code, day DESC);

CREATE INDEX IF NOT EXISTS idx_shamel_stock_store_search
ON public.shamel_stock (store_id, code, name);

CREATE OR REPLACE FUNCTION public.shamel_item_card(
  p_store_id uuid,
  p_item_code text,
  p_from date DEFAULT NULL::date,
  p_to date DEFAULT NULL::date,
  p_type text DEFAULT 'all'::text,
  p_offset integer DEFAULT 0,
  p_limit integer DEFAULT 100
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
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
$function$;
