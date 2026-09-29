-- ==============================================================================
-- Migration 048: Journal Entry Editing, Atomic Reversal, and Document Sync
-- 1. Atomic function update_journal_entry_with_sync:
--    - Verifies period lock & validates debits = credits
--    - Reverses old journal lines from accounts.balance
--    - Deletes old lines and inserts new lines
--    - Applies new lines to accounts.balance
--    - Updates journal_entries header (date, description)
--    - Cascades updates to linked operational documents (vouchers, cash_movements, customer_ledger, customers)
-- ==============================================================================
SET search_path = public;

-- Ensure accounts table has updated_at column
ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

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
    RAISE EXCEPTION 'القيد المحاسبي غير متوازن! إجمالي المدين (%) لا يتطابق مع إجمالي الدائن (%)', v_total_debit, v_total_credit;
  END IF;

  -- 5. إدراج السطور الجديدة وتطبيق أثرها على أرصدة الحسابات
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_acc_id := (v_line->>'account_id')::uuid;
    v_debit := ROUND(COALESCE((v_line->>'debit')::numeric, 0), 2);
    v_credit := ROUND(COALESCE((v_line->>'credit')::numeric, 0), 2);
    v_line_desc := COALESCE(NULLIF(TRIM(v_line->>'description'), ''), p_description);
    v_currency := COALESCE(NULLIF(TRIM(v_line->>'currency'), ''), 'ILS');
    v_rate := COALESCE((v_line->>'exchange_rate')::numeric, 1.0);
    v_orig_debit := COALESCE((v_line->>'original_debit')::numeric, v_debit);
    v_orig_credit := COALESCE((v_line->>'original_credit')::numeric, v_credit);

    SELECT * INTO v_acc FROM public.accounts WHERE id = v_acc_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'الحساب المحاسبي المحدد غير موجود: %', v_acc_id;
    END IF;

    IF v_acc.is_group THEN
      RAISE EXCEPTION 'لا يجوز الترحيل المباشر على الحساب التجميعي (% - %)', v_acc.name, v_acc.code;
    END IF;

    INSERT INTO public.journal_lines (
      journal_entry_id,
      account_id,
      debit,
      credit,
      currency,
      exchange_rate,
      description,
      sort_order,
      original_debit,
      original_credit
    ) VALUES (
      p_entry_id,
      v_acc_id,
      v_debit,
      v_credit,
      v_currency,
      v_rate,
      v_line_desc,
      v_idx,
      v_orig_debit,
      v_orig_credit
    );

    UPDATE public.accounts
    SET balance = balance + (
      CASE WHEN normal_balance = 'credit'
           THEN (v_credit - v_debit)
           ELSE (v_debit - v_credit)
      END
    ),
    is_active = TRUE,
    updated_at = NOW()
    WHERE id = v_acc_id;

    v_idx := v_idx + 1;
  END LOOP;

  -- 6. تحديث رأس القيد
  UPDATE public.journal_entries
  SET date = p_date,
      description = p_description
  WHERE id = p_entry_id;

  -- 7. المزامنة العكسية مع المستندات التشغيلية المرتبطة
  IF v_entry.source = 'voucher' AND v_entry.ref_id IS NOT NULL THEN
    SELECT * INTO v_voucher FROM public.vouchers WHERE id = v_entry.ref_id FOR UPDATE;
    IF FOUND THEN
      -- البحث هل ارتبط القيد بصندوق جديد
      SELECT cb.id INTO v_new_box_id
      FROM public.journal_lines jl
      JOIN public.cash_boxes cb ON cb.account_id = jl.account_id
      WHERE jl.journal_entry_id = p_entry_id
      LIMIT 1;

      UPDATE public.vouchers
      SET date = p_date,
          amount = v_total_debit,
          cash_box_id = COALESCE(v_new_box_id, cash_box_id),
          cash_amount = CASE WHEN payment_method = 'cash' THEN v_total_debit ELSE cash_amount END,
          description = p_description
      WHERE id = v_entry.ref_id;

      -- مزامنة كشف حساب العميل إن كان السند لعميل
      IF v_voucher.customer_id IS NOT NULL THEN
        IF v_voucher.type = 'receipt' THEN
          UPDATE public.customer_ledger
          SET credit = v_total_debit,
              date = p_date,
              description = 'سند قبض ' || v_voucher.voucher_number || ' — ' || p_description
          WHERE reference_id = v_entry.ref_id;
        ELSE
          UPDATE public.customer_ledger
          SET debit = v_total_debit,
              date = p_date,
              description = 'سند صرف ' || v_voucher.voucher_number || ' — ' || p_description
          WHERE reference_id = v_entry.ref_id;
        END IF;

        -- إعادة احتساب رصيد العميل وإجمالي مدفوعاته بدقة من حركات كشف حسابه
        UPDATE public.customers c
        SET balance = (
          SELECT COALESCE(SUM(debit - credit), 0)
          FROM public.customer_ledger cl
          WHERE cl.customer_id = v_voucher.customer_id
        ),
        total_paid = (
          SELECT COALESCE(SUM(credit), 0)
          FROM public.customer_ledger cl
          WHERE cl.customer_id = v_voucher.customer_id AND cl.type = 'payment'
        ),
        updated_at = NOW()
        WHERE c.id = v_voucher.customer_id;
      END IF;
    END IF;
  ELSIF v_entry.source = 'invoice' AND v_entry.ref_id IS NOT NULL THEN
    UPDATE public.invoices
    SET issue_date = p_date
    WHERE id = v_entry.ref_id;
  END IF;

  -- 8. التوثيق المالي في سجل التدقيق إن وجد الجدول
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'financial_audit_logs') THEN
    INSERT INTO public.financial_audit_logs (
      store_id, entity_type, entity_id, entity_label, action, actor_id, details
    ) VALUES (
      v_entry.store_id, 'journal_entry', p_entry_id, v_entry.entry_number, 'update', p_actor_id,
      jsonb_build_object('action', 'update_journal_entry_with_sync', 'new_date', p_date, 'new_total', v_total_debit)
    );
  END IF;

  RETURN jsonb_build_object(
    'success', TRUE,
    'entry_id', p_entry_id,
    'entry_number', v_entry.entry_number,
    'date', p_date,
    'total_amount', v_total_debit
  );
END;
$$;

-- Grant execution to authenticated users & service role
GRANT EXECUTE ON FUNCTION public.update_journal_entry_with_sync(UUID, DATE, TEXT, JSONB, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_journal_entry_with_sync(UUID, DATE, TEXT, JSONB, UUID) TO service_role;
