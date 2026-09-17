-- ==============================================================================
-- Migration 042: Fix Checks Uniqueness and Cheque Promotion
-- ==============================================================================
SET search_path = public;

-- 1. حذف القيد والفهرس الخاطئ uq_checks_store_bank_number
-- شيكات القبض الواردة (type = 'received') تصدر من زبائن متعددين بحسابات بنكية مختلفة،
-- ومن الطبيعي جداً وجود شيكات بأرقام متطابقة (مثل 1، 7، 20، 55) من نفس البنك ولكن لعملاء وحسابات مختلفة.
DROP INDEX IF EXISTS public.uq_checks_store_bank_number;

-- 2. إنشاء الفهارس الفريدة الصحيحة:
-- أ) منع تكرار شيكات الشامل المستوردة باستخدام shamel_code (رقم المستند document)
DROP INDEX IF EXISTS public.idx_checks_store_shamel_code;
DROP INDEX IF EXISTS public.uq_checks_store_shamel_code;
CREATE UNIQUE INDEX IF NOT EXISTS uq_checks_store_shamel_code 
  ON public.checks(store_id, shamel_code) 
  WHERE shamel_code IS NOT NULL;

-- ب) منع تكرار الشيكات الصادرة من دفتر شيكات المنشأة نفسها (type = 'issued')
DROP INDEX IF EXISTS public.uq_checks_store_issued_number;
CREATE UNIQUE INDEX IF NOT EXISTS uq_checks_store_issued_number 
  ON public.checks(store_id, bank_name, check_number) 
  WHERE type = 'issued';

-- ج) ضمان الفهرسة لأكواد الشامل للزبائن والمنتجات
DROP INDEX IF EXISTS public.idx_customers_store_shamel_code;
DROP INDEX IF EXISTS public.uq_customers_store_shamel_code;
CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_store_shamel_code 
  ON public.customers(store_id, shamel_code) 
  WHERE shamel_code IS NOT NULL;

DROP INDEX IF EXISTS public.idx_products_store_shamel_code;
DROP INDEX IF EXISTS public.uq_products_store_shamel_code;
CREATE UNIQUE INDEX IF NOT EXISTS uq_products_store_shamel_code 
  ON public.products(store_id, shamel_code) 
  WHERE shamel_code IS NOT NULL;


-- 3. ترقية دالة ترحيل الشامل shamel_promote_entity لدعم ترحيل شيكات زبون محدد أو شيك محدد أو الكل بأمان تام
CREATE OR REPLACE FUNCTION public.shamel_promote_entity(
  p_store_id UUID,
  p_entity TEXT, -- 'customers' | 'stock' | 'cheques' | 'accounts'
  p_code TEXT DEFAULT NULL -- NULL: الكل، أو كود العنصر، أو كود الزبون في حالة الشيكات
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
BEGIN
  IF auth.role() <> 'service_role' AND NOT is_store_member(p_store_id) THEN
    RAISE EXCEPTION 'Not authorized for this store';
  END IF;

  -- 1. Promote Customers
  IF p_entity = 'customers' THEN
    FOR v_rec IN 
      SELECT * FROM public.shamel_customers 
      WHERE store_id = p_store_id AND (p_code IS NULL OR code = p_code)
    LOOP
      IF EXISTS (SELECT 1 FROM public.customers WHERE store_id = p_store_id AND shamel_code = v_rec.code) THEN
        UPDATE public.customers
        SET name = v_rec.name,
            phone = COALESCE(v_rec.phone, phone),
            address = COALESCE(v_rec.address, address),
            balance = COALESCE(v_rec.equivalent_balance, v_rec.balance)
        WHERE store_id = p_store_id AND shamel_code = v_rec.code;
      ELSE
        INSERT INTO public.customers (
          store_id, name, phone, address, balance, shamel_code
        ) VALUES (
          p_store_id, v_rec.name, v_rec.phone, v_rec.address, COALESCE(v_rec.equivalent_balance, v_rec.balance), v_rec.code
        );
      END IF;

      UPDATE public.shamel_customers 
      SET is_promoted = TRUE, promoted_at = now() 
      WHERE store_id = p_store_id AND code = v_rec.code;

      v_count := v_count + 1;
    END LOOP;

  -- 2. Promote Stock/Products
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
            stock_quantity = ROUND(v_rec.quantity)::int,
            status = 'active'
        WHERE store_id = p_store_id AND shamel_code = v_rec.code;
      ELSE
        v_slug := 'shamel-' || lower(regexp_replace(v_rec.code, '[^a-zA-Z0-9]', '', 'g')) || '-' || substr(md5(random()::text), 1, 6);
        INSERT INTO public.products (
          store_id, name, slug, sku, barcode, price, cost_price, stock_quantity, shamel_code, status
        ) VALUES (
          p_store_id, v_rec.name, v_slug, v_rec.code, v_rec.barcode,
          v_rec.price, v_rec.cost_price, ROUND(v_rec.quantity)::int, v_rec.code, 'active'
        );
      END IF;

      UPDATE public.shamel_stock 
      SET is_promoted = TRUE, promoted_at = now() 
      WHERE store_id = p_store_id AND code = v_rec.code;

      v_count := v_count + 1;
    END LOOP;

  -- 3. Promote Cheques (دعم ترحيل شيك محدد بالمستند، أو كافة شيكات زبون معين بكود العميل، أو كافة شيكات المتجر)
  ELSIF p_entity = 'cheques' THEN
    FOR v_rec IN 
      SELECT * FROM public.shamel_cheques 
      WHERE store_id = p_store_id 
        AND (
          p_code IS NULL 
          OR document = p_code 
          OR customer_code = p_code
        )
    LOOP
      v_cust_id := NULL;
      v_supp_id := NULL;

      IF v_rec.customer_code IS NOT NULL AND v_rec.customer_code <> '' THEN
        -- البحث عن العميل في جدول الزبائن
        SELECT id INTO v_cust_id FROM public.customers WHERE store_id = p_store_id AND shamel_code = v_rec.customer_code LIMIT 1;
        
        -- الترحيل التلقائي للزبون إذا لم يكن مرحلاً بعد حتى يرتبط الشيك به بشكل سليم
        IF v_cust_id IS NULL AND v_rec.customer_code LIKE 'C%' THEN
          IF NOT EXISTS (
            SELECT 1 FROM public.customers 
            WHERE store_id = p_store_id AND shamel_code = v_rec.customer_code
          ) THEN
            INSERT INTO public.customers (store_id, name, phone, address, balance, shamel_code)
            SELECT p_store_id, sc.name, sc.phone, sc.address, COALESCE(sc.equivalent_balance, sc.balance), sc.code
            FROM public.shamel_customers sc
            WHERE sc.store_id = p_store_id AND sc.code = v_rec.customer_code;
          END IF;

          SELECT id INTO v_cust_id FROM public.customers WHERE store_id = p_store_id AND shamel_code = v_rec.customer_code LIMIT 1;
        END IF;

        IF v_cust_id IS NULL THEN
          SELECT id INTO v_supp_id FROM public.suppliers WHERE store_id = p_store_id AND shamel_code = v_rec.customer_code LIMIT 1;
        END IF;
      END IF;

      -- التحقق مما إذا كان الشيك مرحلاً مسبقاً بموجب كود الشامل الفريد (document)
      IF EXISTS (
        SELECT 1 FROM public.checks 
        WHERE store_id = p_store_id AND shamel_code = v_rec.document
      ) THEN
        UPDATE public.checks
        SET type = v_rec.type,
            check_number = v_rec.cheque_number,
            bank_code = v_rec.bank_code,
            bank_name = v_rec.bank_name,
            branch_code = v_rec.branch_code,
            branch_name = v_rec.branch_name,
            account_number = v_rec.account_number,
            drawer_name = COALESCE(v_rec.customer_name, drawer_name, 'عميل الشامل'),
            amount = v_rec.amount,
            currency = v_rec.currency,
            amount_ils = v_rec.amount,
            due_date = COALESCE(v_rec.due_date, CURRENT_DATE),
            status = v_rec.status,
            customer_id = COALESCE(v_cust_id, customer_id),
            supplier_id = COALESCE(v_supp_id, supplier_id),
            updated_at = now()
        WHERE store_id = p_store_id AND shamel_code = v_rec.document;
      ELSE
        INSERT INTO public.checks (
          store_id, type, check_number, bank_code, bank_name, branch_code, branch_name,
          account_number, drawer_name, amount, currency, amount_ils, due_date, status,
          customer_id, supplier_id, shamel_code
        ) VALUES (
          p_store_id, v_rec.type, v_rec.cheque_number, v_rec.bank_code, v_rec.bank_name,
          v_rec.branch_code, v_rec.branch_name, v_rec.account_number,
          COALESCE(v_rec.customer_name, 'عميل الشامل'), v_rec.amount, v_rec.currency,
          v_rec.amount, COALESCE(v_rec.due_date, CURRENT_DATE), v_rec.status,
          v_cust_id, v_supp_id, v_rec.document
        );
      END IF;

      UPDATE public.shamel_cheques 
      SET is_promoted = TRUE, promoted_at = now() 
      WHERE store_id = p_store_id AND id = v_rec.id;

      v_count := v_count + 1;
    END LOOP;

  -- 4. Promote Chart of Accounts
  ELSIF p_entity = 'accounts' THEN
    FOR v_rec IN 
      SELECT * FROM public.shamel_accounts 
      WHERE store_id = p_store_id AND (p_code IS NULL OR code = p_code)
    LOOP
      INSERT INTO public.accounts (
        store_id, code, name, type, is_group, currency, balance, shamel_code, is_active
      ) VALUES (
        p_store_id, v_rec.code, v_rec.name, v_rec.type, v_rec.is_group,
        v_rec.currency, v_rec.balance, v_rec.code, TRUE
      )
      ON CONFLICT (store_id, code) DO UPDATE SET
        name = EXCLUDED.name,
        type = EXCLUDED.type,
        is_group = EXCLUDED.is_group,
        balance = EXCLUDED.balance,
        shamel_code = EXCLUDED.shamel_code;

      UPDATE public.shamel_accounts 
      SET is_promoted = TRUE, promoted_at = now() 
      WHERE store_id = p_store_id AND code = v_rec.code;

      v_count := v_count + 1;
    END LOOP;

    -- Link parent IDs
    UPDATE public.accounts a
    SET parent_id = p.id
    FROM public.accounts p
    JOIN public.shamel_accounts sa ON sa.parent_code = p.code AND sa.store_id = p_store_id
    WHERE a.store_id = p_store_id AND a.code = sa.code AND a.parent_id IS DISTINCT FROM p.id;

  END IF;

  RETURN jsonb_build_object('success', TRUE, 'promoted_count', v_count);
END;
$$;
