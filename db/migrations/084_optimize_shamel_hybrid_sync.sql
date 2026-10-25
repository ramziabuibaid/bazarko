-- ==============================================================================
-- Migration 084: High-Performance Set-Based Shamel Hybrid Sync
-- تسريع مزامنة الشامل الهجينة من خلال معالجة دفعية فائقة السرعة
-- بدلاً من الحلقات التكرارية البطيئة لتجنب انتهاء المهلة (statement_timeout)
-- ==============================================================================
SET search_path = public;

CREATE OR REPLACE FUNCTION public.shamel_execute_hybrid_sync(
  p_store_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_customers_matched_phone INT := 0;
  v_customers_updated INT := 0;
  v_customers_inserted INT := 0;
  v_products_updated INT := 0;
  v_products_inserted INT := 0;
BEGIN
  -- 1. Match customers by clean phone if shamel_code is NULL
  WITH candidates AS (
    SELECT 
      c.id AS customer_id,
      sc.code AS shamel_code,
      sc.address AS shamel_address,
      sc.balance AS shamel_balance,
      sc.last_invoice_date,
      sc.last_receipt_date,
      ROW_NUMBER() OVER(PARTITION BY c.id ORDER BY sc.code) as rn
    FROM public.customers c
    JOIN public.shamel_customers sc 
      ON sc.store_id = p_store_id 
     AND sc.code NOT LIKE 'S%'
     AND length(regexp_replace(COALESCE(c.phone, ''), '[^0-9]', '', 'g')) >= 7
     AND regexp_replace(COALESCE(c.phone, ''), '[^0-9]', '', 'g') = regexp_replace(COALESCE(sc.phone, ''), '[^0-9]', '', 'g')
    WHERE c.store_id = p_store_id
      AND c.shamel_code IS NULL
  ),
  matched AS (
    UPDATE public.customers c
    SET shamel_code = cand.shamel_code,
        address = COALESCE(c.address, NULLIF(cand.shamel_address, '')),
        balance = COALESCE(cand.shamel_balance, 0),
        last_order_at = CASE WHEN cand.last_invoice_date IS NOT NULL THEN (cand.last_invoice_date || 'T00:00:00.000Z')::timestamptz ELSE c.last_order_at END,
        last_payment_at = CASE WHEN cand.last_receipt_date IS NOT NULL THEN (cand.last_receipt_date || 'T00:00:00.000Z')::timestamptz ELSE c.last_payment_at END,
        updated_at = now()
    FROM candidates cand
    WHERE c.id = cand.customer_id AND cand.rn = 1
    RETURNING c.id
  )
  SELECT count(*) INTO v_customers_matched_phone FROM matched;

  -- 2. Update existing customers with shamel_code
  WITH updated_cust AS (
    UPDATE public.customers c
    SET name = sc.name,
        phone = COALESCE(NULLIF(sc.phone, ''), c.phone),
        address = COALESCE(NULLIF(sc.address, ''), c.address),
        balance = COALESCE(sc.balance, 0),
        last_order_at = CASE WHEN sc.last_invoice_date IS NOT NULL THEN (sc.last_invoice_date || 'T00:00:00.000Z')::timestamptz ELSE c.last_order_at END,
        last_payment_at = CASE WHEN sc.last_receipt_date IS NOT NULL THEN (sc.last_receipt_date || 'T00:00:00.000Z')::timestamptz ELSE c.last_payment_at END,
        updated_at = now()
    FROM public.shamel_customers sc
    WHERE c.store_id = p_store_id
      AND sc.store_id = p_store_id
      AND c.shamel_code = sc.code
      AND sc.code NOT LIKE 'S%'
    RETURNING c.id
  )
  SELECT count(*) INTO v_customers_updated FROM updated_cust;

  -- 3. Insert new customers that do not exist in Bazarko
  WITH new_cust AS (
    INSERT INTO public.customers (
      store_id, name, phone, address, balance, shamel_code, customer_type, is_active,
      last_order_at, last_payment_at
    )
    SELECT 
      p_store_id,
      sc.name,
      COALESCE(sc.phone, ''),
      COALESCE(sc.address, ''),
      COALESCE(sc.balance, 0),
      sc.code,
      'retail',
      TRUE,
      CASE WHEN sc.last_invoice_date IS NOT NULL THEN (sc.last_invoice_date || 'T00:00:00.000Z')::timestamptz ELSE NULL END,
      CASE WHEN sc.last_receipt_date IS NOT NULL THEN (sc.last_receipt_date || 'T00:00:00.000Z')::timestamptz ELSE NULL END
    FROM public.shamel_customers sc
    WHERE sc.store_id = p_store_id
      AND sc.code NOT LIKE 'S%'
      AND NOT EXISTS (
        SELECT 1 FROM public.customers c 
        WHERE c.store_id = p_store_id 
          AND c.shamel_code = sc.code
      )
    ON CONFLICT (store_id, shamel_code) WHERE (shamel_code IS NOT NULL) DO NOTHING
    RETURNING id
  )
  SELECT count(*) INTO v_customers_inserted FROM new_cust;

  -- 4. Update existing products by shamel_code or sku
  WITH updated_prod AS (
    UPDATE public.products p
    SET name = s.name,
        sku = s.code,
        shamel_code = s.code,
        barcode = COALESCE(NULLIF(s.barcode, ''), p.barcode),
        cost_price = CASE WHEN COALESCE(s.cost_price, 0) > 0 THEN s.cost_price ELSE p.cost_price END,
        price = CASE 
                  WHEN COALESCE(s.cost_price, 0) > 0 THEN 
                    CASE 
                      WHEN s.cost_price < 100 THEN CEIL((s.cost_price * 1.35) / 10.0) * 10.0
                      WHEN s.cost_price <= 1000 THEN CEIL((s.cost_price * 1.35) / 50.0) * 50.0
                      ELSE CEIL((s.cost_price * 1.35) / 100.0) * 100.0
                    END
                  WHEN COALESCE(s.price, 0) > 0 THEN s.price 
                  ELSE p.price 
                END,
        stock_quantity = GREATEST(0, ROUND(COALESCE(s.quantity, 0))::INT),
        track_stock = TRUE,
        status = CASE WHEN ROUND(COALESCE(s.quantity, 0)) > 0 THEN 'active' ELSE 'hidden' END,
        updated_at = now()
    FROM public.shamel_stock s
    WHERE p.store_id = p_store_id
      AND s.store_id = p_store_id
      AND (p.shamel_code = s.code OR (p.shamel_code IS NULL AND p.sku = s.code))
    RETURNING p.id
  )
  SELECT count(*) INTO v_products_updated FROM updated_prod;

  -- 5. Insert new products that have stock > 0 and do not yet exist
  WITH new_prod AS (
    INSERT INTO public.products (
      store_id, name, slug, sku, shamel_code, barcode, price, cost_price,
      stock_quantity, track_stock, status
    )
    SELECT 
      p_store_id,
      s.name,
      'shamel-' || lower(regexp_replace(s.code, '[^a-zA-Z0-9]', '', 'g')) || '-' || substr(md5(random()::text), 1, 6),
      s.code,
      s.code,
      COALESCE(s.barcode, ''),
      CASE 
        WHEN COALESCE(s.cost_price, 0) > 0 THEN 
          CASE 
            WHEN s.cost_price < 100 THEN CEIL((s.cost_price * 1.35) / 10.0) * 10.0
            WHEN s.cost_price <= 1000 THEN CEIL((s.cost_price * 1.35) / 50.0) * 50.0
            ELSE CEIL((s.cost_price * 1.35) / 100.0) * 100.0
          END
        ELSE COALESCE(s.price, 0)
      END,
      COALESCE(s.cost_price, 0),
      GREATEST(0, ROUND(COALESCE(s.quantity, 0))::INT),
      TRUE,
      'active'
    FROM public.shamel_stock s
    WHERE s.store_id = p_store_id
      AND ROUND(COALESCE(s.quantity, 0)) > 0
      AND NOT EXISTS (
        SELECT 1 FROM public.products p 
        WHERE p.store_id = p_store_id 
          AND (p.shamel_code = s.code OR p.sku = s.code)
      )
    ON CONFLICT (store_id, shamel_code) WHERE (shamel_code IS NOT NULL) DO NOTHING
    RETURNING id
  )
  SELECT count(*) INTO v_products_inserted FROM new_prod;

  -- 6. Mark shamel records as promoted
  UPDATE public.shamel_customers SET is_promoted = TRUE, promoted_at = now() WHERE store_id = p_store_id;
  UPDATE public.shamel_stock SET is_promoted = TRUE, promoted_at = now() WHERE store_id = p_store_id;

  RETURN jsonb_build_object(
    'customersMatchedByPhone', v_customers_matched_phone,
    'customersInserted', v_customers_inserted,
    'customersUpdated', v_customers_updated,
    'productsInserted', v_products_inserted,
    'productsUpdated', v_products_updated
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.shamel_execute_hybrid_sync(UUID) TO authenticated, service_role;
