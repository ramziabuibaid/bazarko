-- ==============================================================================
-- Migration 057: Shamel Hybrid Sync Mode & Customer Phone Matching
-- نموذج العمل الهجين: استمرار الشامل المحاسبي مع بازاركو كأداة تسجيل وتطوير
-- ومزامنة الأصناف والزبائن ومطابقة الهواتف تلقائياً
-- ==============================================================================
SET search_path = public;

-- 1. إضافة عمود نموذج المزامنة في جدول إعدادات الشامل
-- 'hybrid_sync' (المحاسبة في الشامل، بازاركو للتسجيل والمبيعات، مزامنة يومية)
-- 'full_migration' (هجرة كاملة إلى بازاركو)
ALTER TABLE public.shamel_sync_configs
  ADD COLUMN IF NOT EXISTS sync_model TEXT NOT NULL DEFAULT 'hybrid_sync'
  CHECK (sync_model IN ('hybrid_sync', 'full_migration'));

-- 2. ترقية دالة ترحيل ومزامنة الكيانات shamel_promote_entity
-- تدعم الآن المطابقة التلقائية برقم الهاتف عند مزامنة الزبائن:
-- إذا كان الزبون مسجلاً في بازاركو (مثلاً من خلال الموظفين بدون رقم شامل)
-- وتطابق رقم الهاتف مع زبون قادم من الشامل، يتم تحديث رقم الشامل للزبون الموجود
-- دون إضافة زبون مكرر!
CREATE OR REPLACE FUNCTION public.shamel_promote_entity(
  p_store_id UUID,
  p_entity TEXT, -- 'customers' | 'stock' | 'cheques' | 'accounts' | 'reconstruct'
  p_code TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count INT := 0;
  v_rec RECORD;
  v_slug TEXT;
  v_cust_id UUID;
  v_supp_id UUID;
  v_clean_phone TEXT;
BEGIN
  IF auth.role() <> 'service_role' AND NOT is_store_member(p_store_id) THEN
    RAISE EXCEPTION 'غير مصرح لك بالوصول لهذا المتجر';
  END IF;

  -- إذا طلب الترحيل الشامل، استدعاء محرك إعادة البناء الفعلي من العمليات
  IF p_entity = 'reconstruct' THEN
    RETURN public.shamel_reconstruct_from_operations(p_store_id, 0);
  END IF;

  -- ─────────────────────────────────────────────────────────
  -- 1. ترحيل وتحديث الزبائن والموردين
  -- ─────────────────────────────────────────────────────────
  IF p_entity = 'customers' THEN
    FOR v_rec IN 
      SELECT * FROM public.shamel_customers 
      WHERE store_id = p_store_id AND (p_code IS NULL OR code = p_code)
    LOOP
      -- تنظيف رقم الهاتف للمقارنة
      v_clean_phone := regexp_replace(COALESCE(v_rec.phone, ''), '[^0-9]', '', 'g');

      -- إذا كان مورد (يبدأ بالكود S)
      IF v_rec.code LIKE 'S%' THEN
        IF EXISTS (SELECT 1 FROM public.suppliers WHERE store_id = p_store_id AND shamel_code = v_rec.code) THEN
          UPDATE public.suppliers
          SET name = v_rec.name, 
              phone = COALESCE(NULLIF(v_rec.phone, ''), phone), 
              address = COALESCE(NULLIF(v_rec.address, ''), address)
          WHERE store_id = p_store_id AND shamel_code = v_rec.code;
        ELSE
          INSERT INTO public.suppliers (store_id, name, phone, address, balance, shamel_code)
          VALUES (p_store_id, v_rec.name, v_rec.phone, v_rec.address, 0, v_rec.code);
        END IF;

      -- إذا كان زبون
      ELSE
        -- الحالة أ: الزبون مسجل مسبقاً برقم الشامل -> تحديث بياناته
        IF EXISTS (SELECT 1 FROM public.customers WHERE store_id = p_store_id AND shamel_code = v_rec.code) THEN
          UPDATE public.customers
          SET name = v_rec.name, 
              phone = COALESCE(NULLIF(v_rec.phone, ''), phone), 
              address = COALESCE(NULLIF(v_rec.address, ''), address)
          WHERE store_id = p_store_id AND shamel_code = v_rec.code;

        -- الحالة ب: الزبون أضيف في بازاركو بدون رقم شامل وتطابق رقم الهاتف معه!
        -- يربط الزبون برقم الشامل دون إنشاء زبون مكرر
        ELSIF length(v_clean_phone) >= 7 AND EXISTS (
          SELECT 1 FROM public.customers 
          WHERE store_id = p_store_id 
            AND shamel_code IS NULL 
            AND regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g') = v_clean_phone
        ) THEN
          UPDATE public.customers
          SET shamel_code = v_rec.code,
              address = COALESCE(address, NULLIF(v_rec.address, ''))
          WHERE id = (
            SELECT id FROM public.customers 
            WHERE store_id = p_store_id 
              AND shamel_code IS NULL 
              AND regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g') = v_clean_phone
            LIMIT 1
          );

        -- الحالة ج: زبون جديد تماماً -> إضافته مع رقم الشامل ورصيد أولي 0
        ELSE
          INSERT INTO public.customers (
            store_id, name, phone, address, balance, shamel_code
          ) VALUES (
            p_store_id, v_rec.name, v_rec.phone, v_rec.address, 0, v_rec.code
          );
        END IF;
      END IF;

      UPDATE public.shamel_customers 
      SET is_promoted = TRUE, promoted_at = now() 
      WHERE store_id = p_store_id AND code = v_rec.code;

      v_count := v_count + 1;
    END LOOP;

  -- ─────────────────────────────────────────────────────────
  -- 2. ترحيل وتحديث الأصناف (المخزون)
  -- ─────────────────────────────────────────────────────────
  ELSIF p_entity = 'stock' THEN
    FOR v_rec IN 
      SELECT * FROM public.shamel_stock 
      WHERE store_id = p_store_id AND (p_code IS NULL OR code = p_code)
    LOOP
      IF EXISTS (SELECT 1 FROM public.products WHERE store_id = p_store_id AND shamel_code = v_rec.code) THEN
        UPDATE public.products
        SET name = v_rec.name,
            barcode = COALESCE(NULLIF(v_rec.barcode, ''), barcode),
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

  -- ─────────────────────────────────────────────────────────
  -- 3. ترحيل الشيكات
  -- ─────────────────────────────────────────────────────────
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

  -- ─────────────────────────────────────────────────────────
  -- 4. ترحيل شجرة الحسابات
  -- ─────────────────────────────────────────────────────────
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
$$;

GRANT EXECUTE ON FUNCTION public.shamel_promote_entity TO authenticated, service_role;
