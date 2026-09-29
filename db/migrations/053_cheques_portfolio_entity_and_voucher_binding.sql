-- Migration 053: Cheques Portfolio Entity Integrity, Voucher Binding, and CHEQUES_IN_HAND Tag
-- Purpose:
-- 1. Register CHEQUES_IN_HAND and CHEQUES_RECEIVABLE in account_tags.
-- 2. Link portfolio accounts to CHEQUES_IN_HAND.
-- 3. Clean up duplicates and enforce unique index on (store_id, voucher_id, check_number) for idempotency.
-- 4. Update execute_check_lifecycle_operation to recognize CHEQUES_IN_HAND.

BEGIN;

-- 1. Insert CHEQUES_IN_HAND and CHEQUES_RECEIVABLE into account_tags
INSERT INTO public.account_tags (code, name_ar, name_en, allowed_account_type, description, capabilities, is_active)
VALUES
  ('CHEQUES_IN_HAND', 'شيكات في المحفظة / أوراق قبض', 'Cheques in Hand / Portfolio', 'asset', 'شيكات مقبوضة من الزبائن ومحفوظة في المحفظة لحين الإيداع أو التحصيل', ARRAY['CHEQUE_RECEIPT', 'CHEQUE_ENDORSEMENT', 'CHEQUE_DEPOSIT', 'CAN_RECEIVE_PAYMENT'], TRUE),
  ('CHEQUES_RECEIVABLE', 'شيكات تحت التحصيل / مقبوضة', 'Cheques Receivable', 'asset', 'شيكات برسم القبض والتحصيل', ARRAY['CHEQUE_RECEIPT', 'CHEQUE_DEPOSIT', 'CAN_RECEIVE_PAYMENT'], TRUE)
ON CONFLICT (code) DO UPDATE SET
  name_ar = EXCLUDED.name_ar,
  capabilities = EXCLUDED.capabilities,
  is_active = TRUE;

-- 2. Update existing accounts tagged CHECKS_PORTFOLIO to also have CHEQUES_IN_HAND or synchronize capabilities
UPDATE public.accounts
SET 
  account_tag = 'CHEQUES_IN_HAND',
  capabilities = ARRAY['CHEQUE_RECEIPT', 'CHEQUE_ENDORSEMENT', 'CHEQUE_DEPOSIT', 'CAN_RECEIVE_PAYMENT']
WHERE account_tag = 'CHECKS_PORTFOLIO';

-- 3. Deduplicate checks on (store_id, voucher_id, check_number) keeping the earliest record
DELETE FROM public.checks c1
WHERE c1.voucher_id IS NOT NULL
  AND c1.id NOT IN (
    SELECT MIN(c2.id::text)::uuid
    FROM public.checks c2
    WHERE c2.voucher_id IS NOT NULL
    GROUP BY c2.store_id, c2.voucher_id, c2.check_number
  );

-- 4. Enforce unique index for idempotent check creation from vouchers
CREATE UNIQUE INDEX IF NOT EXISTS uq_checks_voucher_number
ON public.checks (store_id, voucher_id, check_number)
WHERE (voucher_id IS NOT NULL);

-- 5. Update execute_check_lifecycle_operation to recognize CHEQUES_IN_HAND tag first
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
  -- 1. حساب محفظة الشيكات الواردة (CHEQUES_IN_HAND أو CHECKS_PORTFOLIO)
  SELECT id INTO v_portfolio_acc_id
  FROM public.accounts
  WHERE store_id = v_check.store_id
    AND type = 'asset'
    AND is_group = FALSE
    AND (account_tag IN ('CHEQUES_IN_HAND', 'CHECKS_PORTFOLIO', 'CHEQUES_RECEIVABLE') OR code IN ('1110', '1300') OR name ILIKE '%محفظة الشيكات%' OR name ILIKE '%أوراق قبض%')
    AND NOT (name ILIKE '%صندوق%')
  ORDER BY (account_tag = 'CHEQUES_IN_HAND') DESC, (account_tag = 'CHECKS_PORTFOLIO') DESC, (code = '1110') DESC
  LIMIT 1;

  IF v_portfolio_acc_id IS NULL THEN
    INSERT INTO public.accounts (store_id, code, name, type, normal_balance, is_active, is_system, balance, account_tag)
    VALUES (v_check.store_id, '1110', 'محفظة الشيكات الواردة (أوراق قبض)', 'asset', 'debit', TRUE, TRUE, 0, 'CHEQUES_IN_HAND')
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
    v_credit_tag := 'CHEQUES_IN_HAND';
    v_op_desc := 'إيداع شيك برسم التحصيل رقم #' || v_check.check_number;

  ELSIF p_op_type = 'collect' THEN
    IF p_target_bank_id IS NULL THEN
      RAISE EXCEPTION 'يجب تحديد الحساب البنكي المحصل لصالحه الشيك';
    END IF;

    SELECT account_id INTO v_bank_acc_id FROM public.bank_accounts WHERE id = p_target_bank_id;
    IF v_bank_acc_id IS NULL THEN
      SELECT id INTO v_bank_acc_id FROM public.accounts WHERE store_id = v_check.store_id AND (account_tag = 'BANK' OR (type = 'asset' AND name ILIKE '%بنك%')) LIMIT 1;
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
      v_credit_tag := 'CHEQUES_IN_HAND';
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
      v_credit_tag := 'CHEQUES_IN_HAND';
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
    v_credit_tag := 'CHEQUES_IN_HAND';
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
      v_credit_tag := 'CHEQUES_IN_HAND';
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
      deposit_bank_account_id = COALESCE(p_target_bank_id, deposit_bank_account_id),
      cashed_date = CASE WHEN p_op_type = 'collect' THEN p_date ELSE cashed_date END,
      collected_at = CASE WHEN p_op_type = 'collect' THEN (p_date::text || 'T12:00:00Z')::timestamptz ELSE collected_at END,
      bounced_at = CASE WHEN p_op_type = 'bounce' THEN (p_date::text || 'T12:00:00Z')::timestamptz ELSE bounced_at END,
      notes = COALESCE(p_notes, notes),
      updated_at = NOW()
  WHERE id = p_check_id;

  -- ز) توثيق الحركة في سجل دورة حياة الشيكات
  INSERT INTO public.check_operations (
    check_id, store_id, operation_type, operation_date,
    from_status, to_status, target_bank_account_id, target_cashbox_id,
    target_supplier_id, journal_entry_id, notes, performed_by
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
