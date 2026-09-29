-- Migration 052: Account Tags Engine, Capability Flags, and Full Accounting Traceability
-- Purpose:
-- 1. Add traceability columns to journal_entries: accounting_rule, source_module.
-- 2. Add traceability columns to journal_lines: account_tag_used, source_rule.
-- 3. Add capabilities array to account_tags and accounts.
-- 4. Backfill capabilities and historical journal traceability data.
-- 5. Update update_journal_entry_with_sync to retain account_tag_used and source_rule.
-- 6. Update execute_check_lifecycle_operation to log exact accounting_rule and account_tag_used.

BEGIN;

-- 1. Columns for journal_entries
ALTER TABLE public.journal_entries
  ADD COLUMN IF NOT EXISTS accounting_rule TEXT,
  ADD COLUMN IF NOT EXISTS source_module TEXT;

CREATE INDEX IF NOT EXISTS idx_journal_entries_accounting_rule ON public.journal_entries(accounting_rule);
CREATE INDEX IF NOT EXISTS idx_journal_entries_source_module ON public.journal_entries(source_module);

-- 2. Columns for journal_lines
ALTER TABLE public.journal_lines
  ADD COLUMN IF NOT EXISTS account_tag_used TEXT,
  ADD COLUMN IF NOT EXISTS source_rule TEXT;

CREATE INDEX IF NOT EXISTS idx_journal_lines_account_tag_used ON public.journal_lines(account_tag_used);

-- 3. Capabilities for accounts and account_tags
ALTER TABLE public.account_tags
  ADD COLUMN IF NOT EXISTS capabilities TEXT[] DEFAULT '{}';

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS capabilities TEXT[] DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_accounts_capabilities ON public.accounts USING GIN (capabilities);

-- 4. Seed Standard Capabilities in account_tags
UPDATE public.account_tags SET capabilities = ARRAY['CAN_RECEIVE_PAYMENT', 'CAN_MAKE_PAYMENT', 'TREASURY_TRANSFERS'] WHERE code = 'CASH';
UPDATE public.account_tags SET capabilities = ARRAY['CAN_RECEIVE_PAYMENT', 'CAN_MAKE_PAYMENT', 'TREASURY_TRANSFERS', 'CHEQUE_DEPOSIT'] WHERE code = 'BANK';
UPDATE public.account_tags SET capabilities = ARRAY['CUSTOMER_SETTLEMENT', 'CREDIT_SALES'] WHERE code = 'CUSTOMER_RECEIVABLE';
UPDATE public.account_tags SET capabilities = ARRAY['SUPPLIER_SETTLEMENT', 'CREDIT_PURCHASES'] WHERE code = 'SUPPLIER_PAYABLE';
UPDATE public.account_tags SET capabilities = ARRAY['CHEQUE_RECEIPT', 'CHEQUE_ENDORSEMENT', 'CHEQUE_DEPOSIT'] WHERE code = 'CHECKS_PORTFOLIO';
UPDATE public.account_tags SET capabilities = ARRAY['CHEQUE_CLEARING', 'CHEQUE_BOUNCE'] WHERE code = 'CHECKS_UNDER_COLLECTION';
UPDATE public.account_tags SET capabilities = ARRAY['CHEQUE_RECOVERY', 'CHEQUE_REDISTRIBUTION'] WHERE code = 'CHECKS_BOUNCED';
UPDATE public.account_tags SET capabilities = ARRAY['CHEQUE_PAYMENT', 'CHEQUE_ISSUANCE'] WHERE code = 'CHECKS_PAYABLE';
UPDATE public.account_tags SET capabilities = ARRAY['INVENTORY_VALUATION', 'STOCK_ADJUSTMENT', 'PURCHASE_RECEIPT'] WHERE code = 'INVENTORY';
UPDATE public.account_tags SET capabilities = ARRAY['EXPENSE_POSTING', 'COST_OF_SALES'] WHERE code = 'COGS';
UPDATE public.account_tags SET capabilities = ARRAY['REVENUE_POSTING', 'SALES_INVOICING'] WHERE code = 'SALES_REVENUE';
UPDATE public.account_tags SET capabilities = ARRAY['REVENUE_POSTING', 'SERVICE_INVOICING'] WHERE code = 'SERVICE_REVENUE';
UPDATE public.account_tags SET capabilities = ARRAY['EXPENSE_POSTING', 'OPERATING_EXPENSE'] WHERE code = 'GENERAL_EXPENSE';

-- Backfill accounts capabilities from account_tags
UPDATE public.accounts a
SET capabilities = t.capabilities
FROM public.account_tags t
WHERE a.account_tag = t.code
  AND (a.capabilities IS NULL OR a.capabilities = '{}');

-- 5. Backfill Existing Journal Entries and Lines Traceability
UPDATE public.journal_entries
SET 
  accounting_rule = CASE 
    WHEN source_type = 'sales_invoice' OR source = 'invoice' THEN 'SALE_POSTED'
    WHEN source_type = 'purchase_invoice' OR source = 'purchase' THEN 'PURCHASE_POSTED'
    WHEN source_type = 'receipt_voucher' THEN 'CUSTOMER_PAYMENT_RECEIVED'
    WHEN source_type = 'payment_voucher' THEN 'SUPPLIER_PAYMENT_MADE'
    WHEN source_type = 'sales_return' THEN 'SALES_RETURNED'
    WHEN source_type = 'purchase_return' THEN 'PURCHASE_RETURNED'
    WHEN source_type = 'check_operation' OR source = 'check_op' THEN 'CHECK_OPERATION'
    WHEN source_type = 'inventory_movement' OR source = 'inventory' THEN 'INVENTORY_MOVEMENT'
    WHEN source_type = 'treasury_transfer' OR source = 'transfer' THEN 'TREASURY_TRANSFER'
    ELSE 'MANUAL_JOURNAL'
  END,
  source_module = CASE 
    WHEN source_type = 'sales_invoice' OR source = 'invoice' THEN 'SALES'
    WHEN source_type = 'purchase_invoice' OR source = 'purchase' THEN 'PURCHASES'
    WHEN source_type IN ('receipt_voucher', 'payment_voucher', 'voucher') THEN 'TREASURY'
    WHEN source_type = 'sales_return' THEN 'SALES'
    WHEN source_type = 'purchase_return' THEN 'PURCHASES'
    WHEN source_type = 'check_operation' OR source = 'check_op' THEN 'CHEQUES'
    WHEN source_type = 'inventory_movement' OR source = 'inventory' THEN 'INVENTORY'
    WHEN source_type = 'treasury_transfer' OR source = 'transfer' THEN 'TREASURY'
    ELSE 'MANUAL'
  END
WHERE accounting_rule IS NULL;

-- Backfill journal_lines.account_tag_used from linked accounts
UPDATE public.journal_lines jl
SET account_tag_used = a.account_tag
FROM public.accounts a
WHERE jl.account_id = a.id
  AND jl.account_tag_used IS NULL
  AND a.account_tag IS NOT NULL;

-- 6. Trigger to automatically populate account_tag_used on journal_lines insert if not specified
CREATE OR REPLACE FUNCTION public.sync_journal_line_tag()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.account_tag_used IS NULL AND NEW.account_id IS NOT NULL THEN
    SELECT account_tag INTO NEW.account_tag_used
    FROM public.accounts
    WHERE id = NEW.account_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_journal_line_tag ON public.journal_lines;
CREATE TRIGGER trg_sync_journal_line_tag
BEFORE INSERT OR UPDATE ON public.journal_lines
FOR EACH ROW
EXECUTE FUNCTION public.sync_journal_line_tag();

-- 7. Update update_journal_entry_with_sync to accept and retain account_tag_used and source_rule
CREATE OR REPLACE FUNCTION public.update_journal_entry_with_sync(
  p_entry_id UUID,
  p_date DATE,
  p_description TEXT,
  p_lines JSONB,
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry RECORD;
  v_voucher RECORD;
  v_old_line RECORD;
  v_line JSONB;
  v_acc RECORD;
  v_acc_id UUID;
  v_debit NUMERIC(14,2);
  v_credit NUMERIC(14,2);
  v_total_debit NUMERIC(14,2) := 0;
  v_total_credit NUMERIC(14,2) := 0;
  v_line_desc TEXT;
  v_currency TEXT;
  v_rate NUMERIC(10,4);
  v_orig_debit NUMERIC(14,2);
  v_orig_credit NUMERIC(14,2);
  v_tag_used TEXT;
  v_rule TEXT;
  v_idx INT := 1;
  v_new_box_id UUID;
BEGIN
  -- 1. جلب القيد مع القفل الحصري لمنع التعارض التزامني
  SELECT * INTO v_entry
  FROM public.journal_entries
  WHERE id = p_entry_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'القيد المحاسبي غير موجود';
  END IF;

  IF v_entry.status = 'voided' THEN
    RAISE EXCEPTION 'لا يمكن تعديل قيد ملغي (Voided)';
  END IF;

  -- 2. التحقق من إقفال الفترات المحاسبية للتاريخ القديم والجديد
  IF EXISTS (
    SELECT 1 FROM public.accounting_periods
    WHERE store_id = v_entry.store_id
      AND is_closed = TRUE
      AND (
        (p_date BETWEEN start_date AND end_date) OR
        (v_entry.date BETWEEN start_date AND end_date)
      )
  ) THEN
    RAISE EXCEPTION 'لا يمكن تعديل القيد: التاريخ يقع ضمن فترة محاسبية مقفلة';
  END IF;

  -- 3. عكس الأثر القديم للسطور من أرصدة شجرة الحسابات
  FOR v_old_line IN
    SELECT * FROM public.journal_lines WHERE journal_entry_id = p_entry_id
  LOOP
    UPDATE public.accounts
    SET balance = balance - (
      CASE WHEN normal_balance = 'credit'
           THEN (COALESCE(v_old_line.credit, 0) - COALESCE(v_old_line.debit, 0))
           ELSE (COALESCE(v_old_line.debit, 0) - COALESCE(v_old_line.credit, 0))
      END
    ),
    updated_at = NOW()
    WHERE id = v_old_line.account_id;
  END LOOP;

  -- حذف السطور القديمة
  DELETE FROM public.journal_lines WHERE journal_entry_id = p_entry_id;

  -- 4. فحص السطور الجديدة والتحقق من التوازن الحسابي الدقيق
  IF jsonb_array_length(p_lines) < 2 THEN
    RAISE EXCEPTION 'يجب أن يحتوي القيد على طرفين على الأقل (مدين ودائن)';
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_debit := COALESCE((v_line->>'debit')::numeric, 0);
    v_credit := COALESCE((v_line->>'credit')::numeric, 0);
    v_total_debit := v_total_debit + v_debit;
    v_total_credit := v_total_credit + v_credit;
  END LOOP;

  IF ABS(v_total_debit - v_total_credit) > 0.01 OR v_total_debit <= 0 THEN
    RAISE EXCEPTION 'القيد غير متوازن: إجمالي المدين (%) لا يساوي إجمالي الدائن (%)', v_total_debit, v_total_credit;
  END IF;

  -- 5. إدراج السطور الجديدة وتحديث أرصدة الحسابات
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_acc_id := (v_line->>'account_id')::uuid;
    v_debit := COALESCE((v_line->>'debit')::numeric, 0);
    v_credit := COALESCE((v_line->>'credit')::numeric, 0);
    v_line_desc := COALESCE(v_line->>'description', p_description);
    v_currency := COALESCE(v_line->>'currency', 'ILS');
    v_rate := COALESCE((v_line->>'exchange_rate')::numeric, 1.0);
    v_orig_debit := COALESCE((v_line->>'original_debit')::numeric, v_debit);
    v_orig_credit := COALESCE((v_line->>'original_credit')::numeric, v_credit);
    v_tag_used := v_line->>'account_tag_used';
    v_rule := v_line->>'source_rule';

    SELECT * INTO v_acc FROM public.accounts WHERE id = v_acc_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'الحساب المحاسبي غير موجود (%)', v_acc_id;
    END IF;

    IF v_acc.is_group = TRUE THEN
      RAISE EXCEPTION 'لا يجوز الترحيل على حساب رئيسي تجميعي (%)', v_acc.name;
    END IF;

    IF v_tag_used IS NULL THEN
      v_tag_used := v_acc.account_tag;
    END IF;

    -- إدراج السطر
    INSERT INTO public.journal_lines (
      journal_entry_id, account_id, debit, credit,
      currency, exchange_rate, original_debit, original_credit,
      description, sort_order, account_tag_used, source_rule
    ) VALUES (
      p_entry_id, v_acc_id, v_debit, v_credit,
      v_currency, v_rate, v_orig_debit, v_orig_credit,
      v_line_desc, v_idx, v_tag_used, v_rule
    );

    -- تطبيق الأثر المالي الجديد
    UPDATE public.accounts
    SET balance = balance + (
      CASE WHEN v_acc.normal_balance = 'credit'
           THEN (v_credit - v_debit)
           ELSE (v_debit - v_credit)
      END
    ),
    updated_at = NOW()
    WHERE id = v_acc_id;

    v_idx := v_idx + 1;
  END LOOP;

  -- 6. تحديث رأس القيد
  UPDATE public.journal_entries
  SET
    date = p_date,
    description = p_description
  WHERE id = p_entry_id;

  -- 7. المزامنة المتتالية مع المستندات التشغيلية الأصلية
  IF v_entry.source = 'voucher' OR v_entry.source_type IN ('receipt_voucher', 'payment_voucher') THEN
    SELECT * INTO v_voucher FROM public.vouchers WHERE id = v_entry.ref_id OR id = v_entry.source_id;
    IF FOUND THEN
      UPDATE public.vouchers
      SET
        amount = v_total_debit,
        date = p_date,
        description = p_description
      WHERE id = v_voucher.id;

      UPDATE public.cash_movements
      SET
        amount = v_total_debit,
        movement_date = p_date,
        description = p_description
      WHERE ref_id = v_voucher.id;

      IF v_voucher.customer_id IS NOT NULL THEN
        UPDATE public.customer_ledger
        SET
          amount = v_total_debit,
          date = p_date,
          description = p_description
        WHERE ref_id = v_voucher.id;

        UPDATE public.customers
        SET balance = (
          SELECT COALESCE(SUM(
            CASE WHEN type = 'debit' THEN amount
                 WHEN type = 'credit' THEN -amount
                 ELSE 0 END
          ), 0)
          FROM public.customer_ledger
          WHERE customer_id = v_voucher.customer_id
        )
        WHERE id = v_voucher.customer_id;
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'entry_id', p_entry_id,
    'total_amount', v_total_debit,
    'date', p_date,
    'lines_count', jsonb_array_length(p_lines)
  );
END;
$$;

-- 8. Update execute_check_lifecycle_operation to log exact accounting_rule and account_tag_used
CREATE OR REPLACE FUNCTION public.execute_check_lifecycle_operation(
  p_check_id UUID,
  p_op_type TEXT,
  p_date DATE,
  p_target_bank_id UUID DEFAULT NULL,
  p_target_cashbox_id UUID DEFAULT NULL,
  p_target_supplier_id UUID DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_check RECORD;
  v_amount NUMERIC(14,2);
  v_currency TEXT;
  v_rate NUMERIC(10,4);
  v_next_status TEXT;
  v_debit_acc_id UUID;
  v_credit_acc_id UUID;
  v_portfolio_acc_id UUID;
  v_collection_acc_id UUID;
  v_returned_acc_id UUID;
  v_customer_acc_id UUID;
  v_supplier_acc_id UUID;
  v_bank_acc_id UUID;
  v_cash_acc_id UUID;
  v_op_desc TEXT;
  v_entry_id UUID;
  v_entry_num TEXT;
  v_cust_bal NUMERIC(14,2);
  v_supp_bal NUMERIC(14,2);
  v_bank_bal NUMERIC(14,2);
  v_accounting_rule TEXT;
  v_debit_tag TEXT;
  v_credit_tag TEXT;
BEGIN
  -- أ) جلب الشيك مع القفل الحصري لمنع أي تعارض تزامني
  SELECT * INTO v_check
  FROM public.checks
  WHERE id = p_check_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'الشيك المطلوب غير موجود';
  END IF;

  v_amount := COALESCE(v_check.amount_ils, v_check.amount, 0);
  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'مبلغ الشيك غير صالح';
  END IF;

  v_currency := COALESCE(v_check.currency, 'ILS');
  v_rate := COALESCE(v_check.exchange_rate, 1.0);

  -- ب) فحص الفترة المحاسبية
  IF EXISTS (
    SELECT 1 FROM public.accounting_periods
    WHERE store_id = v_check.store_id
      AND is_closed = TRUE
      AND p_date BETWEEN start_date AND end_date
  ) THEN
    RAISE EXCEPTION 'لا يمكن تنفيذ العملية: التاريخ يقع ضمن فترة محاسبية مقفلة';
  END IF;

  -- ج) استنتاج الحسابات المحاسبية الأساسية من شجرة حسابات المتجر
  -- 1. حساب محفظة الشيكات الواردة (CHECKS_PORTFOLIO)
  SELECT id INTO v_portfolio_acc_id
  FROM public.accounts
  WHERE store_id = v_check.store_id
    AND type = 'asset'
    AND is_group = FALSE
    AND (account_tag = 'CHECKS_PORTFOLIO' OR code = '1110' OR code = '1300' OR name ILIKE '%محفظة الشيكات%' OR name ILIKE '%أوراق قبض%')
    AND NOT (name ILIKE '%صندوق%')
  ORDER BY (account_tag = 'CHECKS_PORTFOLIO') DESC, (code = '1110') DESC
  LIMIT 1;

  IF v_portfolio_acc_id IS NULL THEN
    INSERT INTO public.accounts (store_id, code, name, type, normal_balance, is_active, is_system, balance, account_tag)
    VALUES (v_check.store_id, '1110', 'محفظة الشيكات الواردة (أوراق قبض)', 'asset', 'debit', TRUE, TRUE, 0, 'CHECKS_PORTFOLIO')
    RETURNING id INTO v_portfolio_acc_id;
  END IF;

  -- 2. حساب شيكات برسم التحصيل (CHECKS_UNDER_COLLECTION)
  SELECT id INTO v_collection_acc_id
  FROM public.accounts
  WHERE store_id = v_check.store_id
    AND type = 'asset'
    AND is_group = FALSE
    AND (account_tag = 'CHECKS_UNDER_COLLECTION' OR code = '1320' OR name ILIKE '%شيكات برسم التحصيل%')
  ORDER BY (account_tag = 'CHECKS_UNDER_COLLECTION') DESC
  LIMIT 1;

  IF v_collection_acc_id IS NULL THEN
    INSERT INTO public.accounts (store_id, code, name, type, normal_balance, is_active, is_system, balance, account_tag)
    VALUES (v_check.store_id, '1320', 'شيكات برسم التحصيل', 'asset', 'debit', TRUE, TRUE, 0, 'CHECKS_UNDER_COLLECTION')
    RETURNING id INTO v_collection_acc_id;
  END IF;

  -- 3. حساب محفظة الشيكات المرتجعة (CHECKS_BOUNCED)
  SELECT id INTO v_returned_acc_id
  FROM public.accounts
  WHERE store_id = v_check.store_id
    AND type = 'asset'
    AND is_group = FALSE
    AND (account_tag = 'CHECKS_BOUNCED' OR code = '1330' OR name ILIKE '%شيكات راجعة%' OR name ILIKE '%شيكات مرتجعة%')
  ORDER BY (account_tag = 'CHECKS_BOUNCED') DESC
  LIMIT 1;

  IF v_returned_acc_id IS NULL THEN
    INSERT INTO public.accounts (store_id, code, name, type, normal_balance, is_active, is_system, balance, account_tag)
    VALUES (v_check.store_id, '1330', 'محفظة الشيكات المرتجعة (شيكات راجعة ومرفوضة)', 'asset', 'debit', TRUE, TRUE, 0, 'CHECKS_BOUNCED')
    RETURNING id INTO v_returned_acc_id;
  END IF;

  -- 4. حساب ذمم العملاء (CUSTOMER_RECEIVABLE)
  SELECT id INTO v_customer_acc_id
  FROM public.accounts
  WHERE store_id = v_check.store_id
    AND type = 'asset'
    AND is_group = FALSE
    AND (account_tag = 'CUSTOMER_RECEIVABLE' OR code = '1400' OR name ILIKE '%ذمم مدينة%' OR name ILIKE '%ذمم الزبائن%' OR name ILIKE '%ذمم العملاء%')
    AND NOT (name ILIKE '%صندوق%' OR name ILIKE '%بنك%' OR name ILIKE '%شيك%')
  ORDER BY (account_tag = 'CUSTOMER_RECEIVABLE') DESC
  LIMIT 1;

  IF v_customer_acc_id IS NULL THEN
    INSERT INTO public.accounts (store_id, code, name, type, normal_balance, is_active, is_system, balance, account_tag)
    VALUES (v_check.store_id, '1400', 'ذمم مدينة', 'asset', 'debit', TRUE, TRUE, 0, 'CUSTOMER_RECEIVABLE')
    RETURNING id INTO v_customer_acc_id;
  END IF;

  -- 5. حساب ذمم الموردين (SUPPLIER_PAYABLE)
  SELECT id INTO v_supplier_acc_id
  FROM public.accounts
  WHERE store_id = v_check.store_id
    AND type = 'liability'
    AND is_group = FALSE
    AND (account_tag = 'SUPPLIER_PAYABLE' OR code = '2100' OR code = '2001' OR name ILIKE '%ذمم الموردين%')
  ORDER BY (account_tag = 'SUPPLIER_PAYABLE') DESC
  LIMIT 1;

  IF v_supplier_acc_id IS NULL THEN
    INSERT INTO public.accounts (store_id, code, name, type, normal_balance, is_active, is_system, balance, account_tag)
    VALUES (v_check.store_id, '2100', 'ذمم الموردين', 'liability', 'credit', TRUE, TRUE, 0, 'SUPPLIER_PAYABLE')
    RETURNING id INTO v_supplier_acc_id;
  END IF;

  -- د) معالجة نوع العملية وتحديد الأطراف المحاسبية والحالة القادمة
  IF p_op_type = 'deposit' THEN
    IF p_target_bank_id IS NULL THEN
      RAISE EXCEPTION 'يجب تحديد الحساب البنكي المراد إيداع الشيك برسم التحصيل لصالحه';
    END IF;

    v_next_status := 'deposited';
    v_accounting_rule := 'CHECK_DEPOSITED_FOR_COLLECTION';
    v_debit_acc_id := v_collection_acc_id;
    v_debit_tag := 'CHECKS_UNDER_COLLECTION';
    v_credit_acc_id := v_portfolio_acc_id;
    v_credit_tag := 'CHECKS_PORTFOLIO';
    v_op_desc := 'إيداع شيك برسم التحصيل رقم #' || v_check.check_number;

  ELSIF p_op_type = 'collect' THEN
    IF p_target_bank_id IS NULL THEN
      RAISE EXCEPTION 'يجب تحديد الحساب البنكي المحصل لصالحه الشيك';
    END IF;

    SELECT account_id INTO v_bank_acc_id FROM public.bank_accounts WHERE id = p_target_bank_id;
    IF v_bank_acc_id IS NULL THEN
      SELECT id INTO v_bank_acc_id FROM public.accounts WHERE store_id = v_check.store_id AND (account_tag = 'BANK' OR type = 'asset' AND name ILIKE '%بنك%') LIMIT 1;
    END IF;

    IF v_bank_acc_id IS NULL THEN
      INSERT INTO public.accounts (store_id, code, name, type, normal_balance, is_active, is_system, balance, account_tag)
      VALUES (v_check.store_id, '1200', 'حساب البنك الجاري', 'asset', 'debit', TRUE, TRUE, 0, 'BANK')
      RETURNING id INTO v_bank_acc_id;
    END IF;

    v_next_status := 'collected';
    v_accounting_rule := 'CHECK_COLLECTED_TO_BANK';
    v_debit_acc_id := v_bank_acc_id;
    v_debit_tag := 'BANK';
    IF v_check.status = 'deposited' THEN
      v_credit_acc_id := v_collection_acc_id;
      v_credit_tag := 'CHECKS_UNDER_COLLECTION';
    ELSE
      v_credit_acc_id := v_portfolio_acc_id;
      v_credit_tag := 'CHECKS_PORTFOLIO';
    END IF;
    v_op_desc := 'تحصيل بنكي فعلي لشيك رقم #' || v_check.check_number;

  ELSIF p_op_type = 'bounce' THEN
    v_next_status := 'returned';
    v_accounting_rule := 'CHECK_BOUNCED';
    v_debit_acc_id := v_returned_acc_id;
    v_debit_tag := 'CHECKS_BOUNCED';
    IF v_check.status = 'deposited' THEN
      v_credit_acc_id := v_collection_acc_id;
      v_credit_tag := 'CHECKS_UNDER_COLLECTION';
    ELSE
      v_credit_acc_id := v_portfolio_acc_id;
      v_credit_tag := 'CHECKS_PORTFOLIO';
    END IF;
    v_op_desc := 'إثبات ارتداد ورفض شيك رقم #' || v_check.check_number;

  ELSIF p_op_type = 'endorse' THEN
    IF p_target_supplier_id IS NULL THEN
      RAISE EXCEPTION 'يجب تحديد المورد لتجيير الشيك لصالحه';
    END IF;

    v_next_status := 'endorsed';
    v_accounting_rule := 'CHECK_ENDORSED_TO_SUPPLIER';
    v_debit_acc_id := v_supplier_acc_id;
    v_debit_tag := 'SUPPLIER_PAYABLE';
    v_credit_acc_id := v_portfolio_acc_id;
    v_credit_tag := 'CHECKS_PORTFOLIO';
    v_op_desc := 'تجيير شيك رقم #' || v_check.check_number || ' لصالح المورد';

  ELSIF p_op_type = 'return_to_customer' THEN
    v_next_status := 'returned';
    v_accounting_rule := 'CHECK_RETURNED_TO_CUSTOMER';
    v_debit_acc_id := v_customer_acc_id;
    v_debit_tag := 'CUSTOMER_RECEIVABLE';
    IF v_check.status = 'returned' THEN
      v_credit_acc_id := v_returned_acc_id;
      v_credit_tag := 'CHECKS_BOUNCED';
    ELSE
      v_credit_acc_id := v_portfolio_acc_id;
      v_credit_tag := 'CHECKS_PORTFOLIO';
    END IF;
    v_op_desc := 'إرجاع شيك للعميل وإعادة ترصيده رقم #' || v_check.check_number;

  ELSE
    RAISE EXCEPTION 'نوع العملية غير مدعوم: %', p_op_type;
  END IF;

  -- هـ) توليد رقم القيد اليومي وإدراجه مع وسوم التتبع
  v_entry_num := 'JV-CHK-' || TO_CHAR(p_date, 'YYYYMMDD') || '-' || SUBSTRING(p_check_id::text, 1, 6);

  INSERT INTO public.journal_entries (
    store_id, entry_number, date, description,
    source, ref_id, source_type, source_id, source_number, source_url,
    status, created_by, accounting_rule, source_module
  ) VALUES (
    v_check.store_id, v_entry_num, p_date, v_op_desc,
    'check_op', p_check_id, 'check_operation', p_check_id, 'شيك #' || v_check.check_number,
    '/dashboard/cheques/print/' || p_check_id,
    'posted', p_actor_id, v_accounting_rule, 'CHEQUES'
  )
  RETURNING id INTO v_entry_id;

  -- سطر المدين
  INSERT INTO public.journal_lines (
    journal_entry_id, account_id, debit, credit,
    currency, exchange_rate, original_debit, original_credit,
    description, sort_order, account_tag_used, source_rule
  ) VALUES (
    v_entry_id, v_debit_acc_id, v_amount, 0,
    v_currency, v_rate, v_amount, 0,
    v_op_desc, 1, v_debit_tag, v_accounting_rule
  );

  UPDATE public.accounts
  SET balance = balance + CASE WHEN normal_balance = 'debit' THEN v_amount ELSE -v_amount END,
      updated_at = NOW()
  WHERE id = v_debit_acc_id;

  -- سطر الدائن
  INSERT INTO public.journal_lines (
    journal_entry_id, account_id, debit, credit,
    currency, exchange_rate, original_debit, original_credit,
    description, sort_order, account_tag_used, source_rule
  ) VALUES (
    v_entry_id, v_credit_acc_id, 0, v_amount,
    v_currency, v_rate, 0, v_amount,
    v_op_desc, 2, v_credit_tag, v_accounting_rule
  );

  UPDATE public.accounts
  SET balance = balance + CASE WHEN normal_balance = 'credit' THEN v_amount ELSE -v_amount END,
      updated_at = NOW()
  WHERE id = v_credit_acc_id;

  -- و) تحديث سجل الشيك
  UPDATE public.checks
  SET status = v_next_status,
      bank_account_id = COALESCE(p_target_bank_id, bank_account_id),
      cashed_date = CASE WHEN p_op_type = 'collect' THEN p_date ELSE cashed_date END,
      collected_at = CASE WHEN p_op_type = 'collect' THEN (p_date::text || 'T12:00:00Z')::timestamptz ELSE collected_at END,
      bounced_at = CASE WHEN p_op_type = 'bounce' THEN (p_date::text || 'T12:00:00Z')::timestamptz ELSE bounced_at END,
      notes = COALESCE(p_notes, notes),
      updated_at = NOW()
  WHERE id = p_check_id;

  -- ز) توثيق الحركة في سجل دورة حياة الشيكات
  INSERT INTO public.check_operations (
    check_id, store_id, operation_type, operation_date,
    previous_status, new_status, target_bank_id, target_cashbox_id,
    target_supplier_id, journal_entry_id, notes, created_by
  ) VALUES (
    p_check_id, v_check.store_id, p_op_type, p_date,
    v_check.status, v_next_status, p_target_bank_id, p_target_cashbox_id,
    p_target_supplier_id, v_entry_id, p_notes, p_actor_id
  );

  RETURN jsonb_build_object(
    'success', true,
    'check_id', p_check_id,
    'operation', p_op_type,
    'previous_status', v_check.status,
    'new_status', v_next_status,
    'journal_entry_id', v_entry_id,
    'entry_number', v_entry_num,
    'amount', v_amount,
    'accounting_rule', v_accounting_rule
  );
END;
$function$;

COMMIT;
