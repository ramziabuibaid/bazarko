-- ==============================================================================
-- Migration 047: Bazarko Al-Shamel ERP Operational Reconstruction Engine (17 Stages)
-- محرك إعادة بناء وتكوين النظام من العمليات الفعلية للشامل المحاسبي بدون أرصدة افتتاحية
-- ==============================================================================
SET search_path = public;

-- ─────────────────────────────────────────────────────────────
-- 1. إضافة حقول التتبع ثنائي الاتجاه (Source ID & Source Type)
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.invoices            ADD COLUMN IF NOT EXISTS shamel_source_id TEXT;
ALTER TABLE public.invoices            ADD COLUMN IF NOT EXISTS shamel_source_type TEXT;

ALTER TABLE public.purchase_invoices   ADD COLUMN IF NOT EXISTS shamel_source_id TEXT;
ALTER TABLE public.purchase_invoices   ADD COLUMN IF NOT EXISTS shamel_source_type TEXT;

ALTER TABLE public.purchase_returns    ADD COLUMN IF NOT EXISTS shamel_source_id TEXT;
ALTER TABLE public.purchase_returns    ADD COLUMN IF NOT EXISTS shamel_source_type TEXT;

ALTER TABLE public.sales_returns       ADD COLUMN IF NOT EXISTS shamel_source_id TEXT;
ALTER TABLE public.sales_returns       ADD COLUMN IF NOT EXISTS shamel_source_type TEXT;

ALTER TABLE public.vouchers            ADD COLUMN IF NOT EXISTS shamel_source_id TEXT;
ALTER TABLE public.vouchers            ADD COLUMN IF NOT EXISTS shamel_source_type TEXT;

ALTER TABLE public.journal_entries     ADD COLUMN IF NOT EXISTS shamel_source_id TEXT;
ALTER TABLE public.journal_entries     ADD COLUMN IF NOT EXISTS shamel_source_type TEXT;

ALTER TABLE public.inventory_movements ADD COLUMN IF NOT EXISTS shamel_source_id TEXT;
ALTER TABLE public.inventory_movements ADD COLUMN IF NOT EXISTS shamel_source_type TEXT;

-- فهارس التتبع السريع
CREATE INDEX IF NOT EXISTS idx_inv_shamel_src      ON public.invoices(store_id, shamel_source_id);
CREATE INDEX IF NOT EXISTS idx_pur_shamel_src      ON public.purchase_invoices(store_id, shamel_source_id);
CREATE INDEX IF NOT EXISTS idx_pur_ret_shamel_src  ON public.purchase_returns(store_id, shamel_source_id);
CREATE INDEX IF NOT EXISTS idx_sal_ret_shamel_src  ON public.sales_returns(store_id, shamel_source_id);
CREATE INDEX IF NOT EXISTS idx_vouch_shamel_src    ON public.vouchers(store_id, shamel_source_id);
CREATE INDEX IF NOT EXISTS idx_je_shamel_src       ON public.journal_entries(store_id, shamel_source_id);
CREATE INDEX IF NOT EXISTS idx_im_shamel_src       ON public.inventory_movements(store_id, shamel_source_id);

-- ─────────────────────────────────────────────────────────────
-- 2. دالة الحذف والانعكاس التبادلي للعمليات المستوردة (Cascade Deletion / Reversal)
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.shamel_delete_operational_document(
  p_store_id UUID,
  p_source_type TEXT,
  p_source_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rec RECORD;
  v_cust_id UUID;
  v_supp_id UUID;
BEGIN
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
$$;

-- ─────────────────────────────────────────────────────────────
-- 3. محرك إعادة البناء الفعلي الشامل (17 مرحلة)
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.shamel_reconstruct_from_operations(
  p_store_id UUID,
  p_stage INT DEFAULT 0, -- 0 = تنفيذ كامل المراحل الـ 17 بالتتابع، 1..17 = تنفيذ مرحلة محددة
  p_options JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
$$;

-- منح الصلاحيات
GRANT EXECUTE ON FUNCTION public.shamel_delete_operational_document TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.shamel_reconstruct_from_operations TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────
-- 4. ترقية دالة الترحيل shamel_promote_entity لضمان تصفير الأرصدة الافتتاحية ودعم التكوين التشغيلي
-- ─────────────────────────────────────────────────────────────
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
BEGIN
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
$$;

GRANT EXECUTE ON FUNCTION public.shamel_promote_entity TO authenticated, service_role;

