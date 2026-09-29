-- ==============================================================================
-- Migration 049: Cheques Portfolio Lifecycle, Automatic Voucher Sync & Accounting
-- 1. Support target_cashbox_id & recollect, transfer_cashbox in check_operations
-- 2. Support check & check_collect in cash_movements
-- 3. Ensure returned cheques account 1330 (محفظة الشيكات المرتجعة والراجعة)
-- 4. Trigger sync_voucher_checks_to_portfolio on vouchers to auto-register received checks into checks table
-- 5. Backfill any past receipt voucher checks into checks table
-- 6. Atomic function execute_check_lifecycle_operation for complete double-entry accounting on check movements
-- ==============================================================================
SET search_path = public;

-- 1. تحديث جدول check_operations لدعم نقل الشيكات للصناديق
ALTER TABLE public.check_operations
  ADD COLUMN IF NOT EXISTS target_cashbox_id UUID REFERENCES public.cash_boxes(id) ON DELETE SET NULL;

ALTER TABLE public.check_operations
  DROP CONSTRAINT IF EXISTS check_operations_operation_type_check;

ALTER TABLE public.check_operations
  ADD CONSTRAINT check_operations_operation_type_check
  CHECK (operation_type = ANY (ARRAY[
    'deposit'::text,
    'collect'::text,
    'bounce'::text,
    'endorse'::text,
    'return_to_drawer'::text,
    'return_to_customer'::text,
    'supplier_return'::text,
    'recollect'::text,
    'transfer_cashbox'::text,
    'status_change'::text,
    'manual_edit'::text
  ]));

-- 2. تحديث مصادر حركات الخزينة في cash_movements
ALTER TABLE public.cash_movements
  DROP CONSTRAINT IF EXISTS cash_movements_source_check;

ALTER TABLE public.cash_movements
  ADD CONSTRAINT cash_movements_source_check
  CHECK (source IN ('voucher', 'receipt_voucher', 'payment_voucher', 'order', 'invoice', 'manual', 'closing', 'opening', 'transfer', 'check', 'check_collect'));

-- 3. ضمان وجود حساب محفظة الشيكات المرتجعة (1330) في كل متجر
INSERT INTO public.accounts (
  store_id,
  code,
  name,
  type,
  normal_balance,
  currency,
  is_active,
  is_system,
  balance
)
SELECT
  s.id,
  '1330',
  'محفظة الشيكات المرتجعة (شيكات راجعة ومرفوضة)',
  'asset',
  'debit',
  'ILS',
  TRUE,
  TRUE,
  0
FROM public.stores s
WHERE NOT EXISTS (
  SELECT 1 FROM public.accounts a
  WHERE a.store_id = s.id AND (a.code = '1330' OR a.name ILIKE '%شيكات راجعة%' OR a.name ILIKE '%شيكات مرتجعة%')
);

-- 4. مشغل المزامنة التلقائية للشيكات من السندات إلى محفظة الشيكات
CREATE OR REPLACE FUNCTION public.sync_voucher_checks_to_portfolio()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_check JSONB;
  v_check_num TEXT;
  v_amt NUMERIC(14,2);
  v_due_date DATE;
  v_issue_date DATE;
  v_bank_code TEXT;
  v_bank_name TEXT;
  v_branch_code TEXT;
  v_branch_name TEXT;
  v_acc_num TEXT;
  v_drawer TEXT;
  v_payee TEXT;
  v_notes TEXT;
  v_currency TEXT;
  v_rate NUMERIC(10,4);
  v_existing_id UUID;
  v_new_check_id UUID;
BEGIN
  IF NEW.checks_data IS NOT NULL AND jsonb_array_length(NEW.checks_data) > 0 THEN
    FOR v_check IN SELECT * FROM jsonb_array_elements(NEW.checks_data)
    LOOP
      v_check_num := NULLIF(TRIM(v_check->>'check_number'), '');
      IF v_check_num IS NOT NULL THEN
        v_amt := COALESCE((v_check->>'amount')::numeric, 0);
        IF v_amt > 0 THEN
          v_bank_code := NULLIF(TRIM(v_check->>'bank_code'), '');
          v_bank_name := COALESCE(NULLIF(TRIM(v_check->>'bank_name'), ''), 'بنك غير محدد');
          v_branch_code := NULLIF(TRIM(v_check->>'branch_code'), '');
          v_branch_name := NULLIF(TRIM(v_check->>'branch_name'), '');
          v_acc_num := NULLIF(TRIM(v_check->>'account_number'), '');
          v_drawer := COALESCE(NULLIF(TRIM(v_check->>'drawer_name'), ''), NEW.party_name);
          v_payee := NULLIF(TRIM(v_check->>'payee_name'), '');
          v_notes := NULLIF(TRIM(v_check->>'notes'), '');
          v_currency := COALESCE(NULLIF(TRIM(v_check->>'currency'), ''), 'ILS');
          v_rate := COALESCE((v_check->>'exchange_rate')::numeric, 1.0);

          -- استخراج التواريخ بأمان
          BEGIN
            v_due_date := (v_check->>'due_date')::date;
          EXCEPTION WHEN OTHERS THEN
            v_due_date := NEW.date;
          END;

          BEGIN
            v_issue_date := COALESCE((v_check->>'date')::date, NEW.date);
          EXCEPTION WHEN OTHERS THEN
            v_issue_date := NEW.date;
          END;

          -- فحص وجود الشيك مسبقاً بهذا السند
          SELECT id INTO v_existing_id
          FROM public.checks
          WHERE voucher_id = NEW.id AND check_number = v_check_num
          LIMIT 1;

          IF v_existing_id IS NOT NULL THEN
            UPDATE public.checks
            SET
              bank_code = v_bank_code,
              bank_name = v_bank_name,
              branch_code = v_branch_code,
              branch_name = v_branch_name,
              account_number = v_acc_num,
              drawer_name = v_drawer,
              payee_name = v_payee,
              amount = v_amt,
              currency = v_currency,
              exchange_rate = v_rate,
              amount_ils = v_amt * v_rate,
              due_date = v_due_date,
              issue_date = v_issue_date,
              cashbox_id = NEW.cash_box_id,
              customer_id = NEW.customer_id,
              supplier_id = NEW.supplier_id,
              notes = v_notes,
              updated_at = NOW()
            WHERE id = v_existing_id;
          ELSE
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
              payee_name,
              amount,
              currency,
              exchange_rate,
              amount_ils,
              due_date,
              issue_date,
              status,
              customer_id,
              supplier_id,
              cashbox_id,
              voucher_id,
              notes,
              created_by
            ) VALUES (
              NEW.store_id,
              CASE WHEN NEW.type = 'receipt' THEN 'received' ELSE 'issued' END,
              v_check_num,
              v_bank_code,
              v_bank_name,
              v_branch_code,
              v_branch_name,
              v_acc_num,
              v_drawer,
              v_payee,
              v_amt,
              v_currency,
              v_rate,
              v_amt * v_rate,
              v_due_date,
              v_issue_date,
              'in_portfolio',
              NEW.customer_id,
              NEW.supplier_id,
              NEW.cash_box_id,
              NEW.id,
              v_notes,
              NEW.created_by
            ) RETURNING id INTO v_new_check_id;

            -- إضافة حركة افتتاحية في سجل عمليات الشيك
            INSERT INTO public.check_operations (
              store_id,
              check_id,
              operation_type,
              from_status,
              to_status,
              operation_date,
              notes,
              performed_by
            ) VALUES (
              NEW.store_id,
              v_new_check_id,
              'status_change',
              'none',
              'in_portfolio',
              NEW.date,
              'استلام شيك بموجب سند ' || CASE WHEN NEW.type = 'receipt' THEN 'قبض' ELSE 'صرف' END || ' رقم ' || NEW.voucher_number,
              NEW.created_by
            );
          END IF;
        END IF;
      END IF;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_voucher_sync_checks ON public.vouchers;
CREATE TRIGGER trg_voucher_sync_checks
  AFTER INSERT OR UPDATE OF checks_data, amount, customer_id, cash_box_id ON public.vouchers
  FOR EACH ROW
  EXECUTE PROCEDURE public.sync_voucher_checks_to_portfolio();

-- 5. مزامنة تاريخية فورية للشيكات السابقة المسجلة في السندات
DO $$
DECLARE
  r RECORD;
  v_item JSONB;
  v_chk_num TEXT;
  v_amt NUMERIC;
  v_due_date DATE;
  v_iss_date DATE;
  v_chk_id UUID;
BEGIN
  FOR r IN SELECT * FROM public.vouchers WHERE jsonb_array_length(COALESCE(checks_data, '[]'::jsonb)) > 0
  LOOP
    FOR v_item IN SELECT * FROM jsonb_array_elements(r.checks_data)
    LOOP
      v_chk_num := NULLIF(TRIM(v_item->>'check_number'), '');
      IF v_chk_num IS NOT NULL THEN
        v_amt := COALESCE((v_item->>'amount')::numeric, 0);
        IF v_amt > 0 AND NOT EXISTS (SELECT 1 FROM public.checks WHERE voucher_id = r.id AND check_number = v_chk_num) THEN
          BEGIN
            v_due_date := (v_item->>'due_date')::date;
          EXCEPTION WHEN OTHERS THEN
            v_due_date := r.date;
          END;

          BEGIN
            v_iss_date := COALESCE((v_item->>'date')::date, r.date);
          EXCEPTION WHEN OTHERS THEN
            v_iss_date := r.date;
          END;

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
            exchange_rate,
            amount_ils,
            due_date,
            issue_date,
            status,
            customer_id,
            supplier_id,
            cashbox_id,
            voucher_id,
            notes,
            created_by
          ) VALUES (
            r.store_id,
            CASE WHEN r.type = 'receipt' THEN 'received' ELSE 'issued' END,
            v_chk_num,
            NULLIF(TRIM(v_item->>'bank_code'), ''),
            COALESCE(NULLIF(TRIM(v_item->>'bank_name'), ''), 'البنك'),
            NULLIF(TRIM(v_item->>'branch_code'), ''),
            NULLIF(TRIM(v_item->>'branch_name'), ''),
            NULLIF(TRIM(v_item->>'account_number'), ''),
            COALESCE(NULLIF(TRIM(v_item->>'drawer_name'), ''), r.party_name),
            v_amt,
            COALESCE(NULLIF(TRIM(v_item->>'currency'), ''), 'ILS'),
            1.0,
            v_amt,
            v_due_date,
            v_iss_date,
            'in_portfolio',
            r.customer_id,
            r.supplier_id,
            r.cash_box_id,
            r.id,
            NULLIF(TRIM(v_item->>'notes'), ''),
            r.created_by
          ) RETURNING id INTO v_chk_id;

          INSERT INTO public.check_operations (
            store_id,
            check_id,
            operation_type,
            from_status,
            to_status,
            operation_date,
            notes,
            performed_by
          ) VALUES (
            r.store_id,
            v_chk_id,
            'status_change',
            'none',
            'in_portfolio',
            r.date,
            'استلام شيك بموجب سند قبض رقم ' || r.voucher_number,
            r.created_by
          );
        END IF;
      END IF;
    END LOOP;
  END LOOP;
END;
$$;

-- 6. الإجراء المخزن الذري لتنفيذ عمليات ونقل الشيكات مع القيود المزدوجة والمزامنة الشاملة
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
AS $$
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
  -- 1. حساب محفظة الشيكات الواردة (1110 أو 1300)
  SELECT id INTO v_portfolio_acc_id
  FROM public.accounts
  WHERE store_id = v_check.store_id
    AND type = 'asset'
    AND is_group = FALSE
    AND NOT (name ILIKE '%صندوق%')
    AND (code = '1110' OR code = '1300' OR name ILIKE '%محفظة الشيكات%' OR name ILIKE '%أوراق قبض%')
  ORDER BY (code = '1110') DESC
  LIMIT 1;

  IF v_portfolio_acc_id IS NULL THEN
    INSERT INTO public.accounts (store_id, code, name, type, normal_balance, is_active, is_system, balance)
    VALUES (v_check.store_id, '1110', 'محفظة الشيكات الواردة (أوراق قبض)', 'asset', 'debit', TRUE, TRUE, 0)
    RETURNING id INTO v_portfolio_acc_id;
  END IF;

  -- 2. حساب شيكات برسم التحصيل (1320)
  SELECT id INTO v_collection_acc_id
  FROM public.accounts
  WHERE store_id = v_check.store_id
    AND type = 'asset'
    AND is_group = FALSE
    AND (code = '1320' OR name ILIKE '%شيكات برسم التحصيل%')
  LIMIT 1;

  IF v_collection_acc_id IS NULL THEN
    INSERT INTO public.accounts (store_id, code, name, type, normal_balance, is_active, is_system, balance)
    VALUES (v_check.store_id, '1320', 'شيكات برسم التحصيل', 'asset', 'debit', TRUE, TRUE, 0)
    RETURNING id INTO v_collection_acc_id;
  END IF;

  -- 3. حساب محفظة الشيكات المرتجعة (1330)
  SELECT id INTO v_returned_acc_id
  FROM public.accounts
  WHERE store_id = v_check.store_id
    AND type = 'asset'
    AND is_group = FALSE
    AND (code = '1330' OR name ILIKE '%شيكات راجعة%' OR name ILIKE '%شيكات مرتجعة%')
  LIMIT 1;

  IF v_returned_acc_id IS NULL THEN
    INSERT INTO public.accounts (store_id, code, name, type, normal_balance, is_active, is_system, balance)
    VALUES (v_check.store_id, '1330', 'محفظة الشيكات المرتجعة (شيكات راجعة ومرفوضة)', 'asset', 'debit', TRUE, TRUE, 0)
    RETURNING id INTO v_returned_acc_id;
  END IF;

  -- 4. حساب ذمم العملاء (1400)
  SELECT id INTO v_customer_acc_id
  FROM public.accounts
  WHERE store_id = v_check.store_id
    AND type = 'asset'
    AND is_group = FALSE
    AND NOT (name ILIKE '%صندوق%' OR name ILIKE '%بنك%' OR name ILIKE '%شيك%')
    AND (code = '1400' OR name ILIKE '%ذمم مدينة%' OR name ILIKE '%ذمم الزبائن%' OR name ILIKE '%ذمم العملاء%')
  LIMIT 1;

  IF v_customer_acc_id IS NULL THEN
    INSERT INTO public.accounts (store_id, code, name, type, normal_balance, is_active, is_system, balance)
    VALUES (v_check.store_id, '1400', 'ذمم مدينة', 'asset', 'debit', TRUE, TRUE, 0)
    RETURNING id INTO v_customer_acc_id;
  END IF;

  -- 5. حساب ذمم الموردين (2100)
  SELECT id INTO v_supplier_acc_id
  FROM public.accounts
  WHERE store_id = v_check.store_id
    AND type = 'liability'
    AND is_group = FALSE
    AND (code = '2100' OR code = '2001' OR name ILIKE '%ذمم الموردين%')
  LIMIT 1;

  IF v_supplier_acc_id IS NULL THEN
    INSERT INTO public.accounts (store_id, code, name, type, normal_balance, is_active, is_system, balance)
    VALUES (v_check.store_id, '2100', 'ذمم الموردين', 'liability', 'credit', TRUE, TRUE, 0)
    RETURNING id INTO v_supplier_acc_id;
  END IF;

  -- د) معالجة نوع العملية وتحديد الأطراف المحاسبية والحالة القادمة
  IF p_op_type = 'deposit' THEN
    -- إيداع الشيك برسم التحصيل
    v_next_status := 'deposited';
    v_debit_acc_id := v_collection_acc_id;
    v_credit_acc_id := v_portfolio_acc_id;
    v_op_desc := 'إيداع شيك رقم ' || v_check.check_number || ' برسم التحصيل لدى البنك';

  ELSIF p_op_type = 'collect' THEN
    -- تحصيل الشيك
    v_next_status := 'collected';

    -- إذا تم التحصيل نقداً في صندوق
    IF p_target_cashbox_id IS NOT NULL THEN
      SELECT account_id INTO v_cash_acc_id FROM public.cash_boxes WHERE id = p_target_cashbox_id;
      IF v_cash_acc_id IS NULL THEN
        SELECT id INTO v_cash_acc_id FROM public.accounts WHERE store_id = v_check.store_id AND code = '1100' LIMIT 1;
      END IF;
      v_debit_acc_id := v_cash_acc_id;
      v_op_desc := 'تحصيل نقدي بالصندوق لشيك رقم ' || v_check.check_number;

      -- إضافة حركة خزينة نقدية فعلية بالصندوق
      INSERT INTO public.cash_movements (
        store_id,
        cash_box_id,
        direction,
        amount,
        source,
        ref_id,
        party_name,
        payment_method,
        description,
        date,
        created_by
      ) VALUES (
        v_check.store_id,
        p_target_cashbox_id,
        'in',
        v_amount,
        'check_collect',
        v_check.id,
        v_check.drawer_name,
        'cash',
        v_op_desc,
        p_date,
        p_actor_id
      );

    -- وإلا تحصيل في حساب بنكي
    ELSE
      IF p_target_bank_id IS NOT NULL THEN
        SELECT account_id INTO v_bank_acc_id FROM public.bank_accounts WHERE id = p_target_bank_id;
        UPDATE public.bank_accounts SET balance = balance + v_amount WHERE id = p_target_bank_id;
      END IF;

      IF v_bank_acc_id IS NULL THEN
        SELECT id INTO v_bank_acc_id FROM public.accounts WHERE store_id = v_check.store_id AND (code = '1200' OR code = '1201') LIMIT 1;
      END IF;

      v_debit_acc_id := v_bank_acc_id;
      v_op_desc := 'تحصيل بنكي وإيداع لشيك رقم ' || v_check.check_number;
    END IF;

    -- الطرف الدائن: إما شيكات برسم التحصيل إذا كان مودعاً مسبقاً، أو محفظة الشيكات مباشرة
    v_credit_acc_id := CASE WHEN v_check.status = 'deposited' THEN v_collection_acc_id ELSE v_portfolio_acc_id END;

  ELSIF p_op_type = 'endorse' THEN
    -- تجيير الشيك لمورد
    IF p_target_supplier_id IS NULL THEN
      RAISE EXCEPTION 'يجب تحديد المورد المراد تجيير الشيك لصالحه';
    END IF;

    v_next_status := 'endorsed';
    v_debit_acc_id := v_supplier_acc_id;
    v_credit_acc_id := v_portfolio_acc_id;
    v_op_desc := 'تجيير شيك رقم ' || v_check.check_number || ' لصالح المورد';

    -- تخفيض رصيد ذمة المورد
    UPDATE public.suppliers
    SET balance = balance - v_amount
    WHERE id = p_target_supplier_id;

  ELSIF p_op_type = 'bounce' THEN
    -- ارتداد الشيك ونقله إلى محفظة الشيكات المرتجعة
    v_next_status := 'bounced';
    v_debit_acc_id := v_returned_acc_id;
    v_credit_acc_id := CASE WHEN v_check.status = 'deposited' THEN v_collection_acc_id ELSE v_portfolio_acc_id END;
    v_op_desc := 'ارتداد شيك راجع رقم ' || v_check.check_number || ' ونقله إلى محفظة الشيكات المرتجعة';

  ELSIF p_op_type = 'return_to_customer' THEN
    -- إرجاع الشيك الراجع للعميل وإعادة قيد الذمة عليه
    v_next_status := 'returned_to_customer';
    v_debit_acc_id := v_customer_acc_id;
    v_credit_acc_id := v_returned_acc_id;
    v_op_desc := 'إرجاع شيك راجع رقم ' || v_check.check_number || ' إلى العميل وإعادة قيد الذمة';

    IF v_check.customer_id IS NOT NULL THEN
      UPDATE public.customers
      SET balance = balance + v_amount
      WHERE id = v_check.customer_id;

      INSERT INTO public.customer_ledger (
        store_id,
        customer_id,
        type,
        date,
        description,
        debit,
        credit,
        balance,
        reference_id,
        reference_type,
        created_by
      ) VALUES (
        v_check.store_id,
        v_check.customer_id,
        'refund',
        p_date,
        v_op_desc,
        v_amount,
        0,
        (SELECT balance FROM customers WHERE id = v_check.customer_id),
        v_check.id,
        'check',
        p_actor_id
      );
    END IF;

  ELSIF p_op_type = 'recollect' THEN
    -- إعادة استلام الشيك في محفظة الشيكات النشطة
    v_next_status := 'in_portfolio';
    v_debit_acc_id := v_portfolio_acc_id;
    v_credit_acc_id := v_returned_acc_id;
    v_op_desc := 'إعادة استلام وقبض شيك رقم ' || v_check.check_number || ' في محفظة الشيكات';

  ELSIF p_op_type = 'transfer_cashbox' THEN
    -- نقل الشيك إلى صندوق/فرع آخر
    IF p_target_cashbox_id IS NULL THEN
      RAISE EXCEPTION 'يجب تحديد الصندوق المحول إليه الشيك';
    END IF;
    v_next_status := v_check.status;
    v_op_desc := 'نقل شيك رقم ' || v_check.check_number || ' إلى صندوق/فرع آخر';

  ELSE
    RAISE EXCEPTION 'نوع العملية غير معروف: %', p_op_type;
  END IF;

  -- هـ) إنشاء القيد المحاسبي المزدوج المتوازن للعمليات المالية
  IF v_debit_acc_id IS NOT NULL AND v_credit_acc_id IS NOT NULL THEN
    v_entry_num := 'JV-CHK-' || TO_CHAR(p_date, 'YYYYMM') || '-' || LPAD(FLOOR(RANDOM() * 9000 + 1000)::text, 4, '0');

    INSERT INTO public.journal_entries (
      store_id,
      entry_number,
      date,
      description,
      source,
      ref_id,
      status,
      created_by
    ) VALUES (
      v_check.store_id,
      v_entry_num,
      p_date,
      v_op_desc || COALESCE(' — ' || NULLIF(TRIM(p_notes), ''), ''),
      'check_op',
      v_check.id,
      'posted',
      p_actor_id
    ) RETURNING id INTO v_entry_id;

    -- السطر المدين
    INSERT INTO public.journal_lines (
      journal_entry_id,
      account_id,
      debit,
      credit,
      currency,
      exchange_rate,
      description,
      sort_order
    ) VALUES (
      v_entry_id,
      v_debit_acc_id,
      v_amount,
      0,
      v_currency,
      v_rate,
      v_op_desc,
      1
    );

    -- السطر الدائن
    INSERT INTO public.journal_lines (
      journal_entry_id,
      account_id,
      debit,
      credit,
      currency,
      exchange_rate,
      description,
      sort_order
    ) VALUES (
      v_entry_id,
      v_credit_acc_id,
      0,
      v_amount,
      v_currency,
      v_rate,
      v_op_desc,
      2
    );

    -- تحديث أرصدة الحسابات بدقة
    UPDATE public.accounts
    SET balance = balance + (CASE WHEN normal_balance = 'credit' THEN -v_amount ELSE v_amount END),
        updated_at = NOW()
    WHERE id = v_debit_acc_id;

    UPDATE public.accounts
    SET balance = balance + (CASE WHEN normal_balance = 'credit' THEN v_amount ELSE -v_amount END),
        updated_at = NOW()
    WHERE id = v_credit_acc_id;
  END IF;

  -- و) توثيق الحركة في check_operations
  INSERT INTO public.check_operations (
    store_id,
    check_id,
    operation_type,
    from_status,
    to_status,
    operation_date,
    target_bank_account_id,
    target_supplier_id,
    target_cashbox_id,
    journal_entry_id,
    notes,
    performed_by
  ) VALUES (
    v_check.store_id,
    v_check.id,
    p_op_type,
    v_check.status,
    v_next_status,
    p_date,
    p_target_bank_id,
    p_target_supplier_id,
    p_target_cashbox_id,
    v_entry_id,
    COALESCE(NULLIF(TRIM(p_notes), ''), v_op_desc),
    p_actor_id
  );

  -- ز) تحديث سجل الشيك الأصلي
  UPDATE public.checks
  SET
    status = v_next_status,
    deposit_bank_account_id = COALESCE(p_target_bank_id, deposit_bank_account_id),
    endorsed_supplier_id = COALESCE(p_target_supplier_id, endorsed_supplier_id),
    cashbox_id = COALESCE(p_target_cashbox_id, cashbox_id),
    updated_at = NOW()
  WHERE id = v_check.id;

  RETURN jsonb_build_object(
    'success', TRUE,
    'check_id', v_check.id,
    'check_number', v_check.check_number,
    'operation_type', p_op_type,
    'new_status', v_next_status,
    'journal_entry_id', v_entry_id,
    'amount', v_amount
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.execute_check_lifecycle_operation(UUID, TEXT, DATE, UUID, UUID, UUID, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.execute_check_lifecycle_operation(UUID, TEXT, DATE, UUID, UUID, UUID, TEXT, UUID) TO service_role;
