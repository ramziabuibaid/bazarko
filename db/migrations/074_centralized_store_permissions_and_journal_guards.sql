-- Migration 074: Centralized Store Permissions, RPC Guards, and Journal RLS
-- 1. Create centralized permission function has_store_permission
-- 2. Update update_journal_entry_with_sync with permission check, actor check, and atomic pre-validation
-- 3. Replace permissive journal RLS policies with strict role-based policies

BEGIN;

-- 1. Centralized permission checker
CREATE OR REPLACE FUNCTION public.has_store_permission(
  p_store_id uuid,
  p_permission text
) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  caller_role text;
BEGIN
  IF caller IS NULL OR p_store_id IS NULL THEN RETURN false; END IF;

  IF EXISTS (
    SELECT 1 FROM public.stores s
    WHERE s.id = p_store_id AND s.owner_id = caller
  ) THEN
    caller_role := 'owner';
  ELSE
    SELECT m.role INTO caller_role
    FROM public.store_members m
    WHERE m.store_id = p_store_id
      AND m.profile_id = caller AND m.is_active = true
    LIMIT 1;

    -- الملكية لا تُستنتج من دور owner مُدخل على عضوية أخرى دون أن يكون المالك الحقيقي في stores
    IF caller_role = 'owner' THEN RETURN false; END IF;
  END IF;

  IF caller_role IS NULL THEN RETURN false; END IF;

  RETURN coalesce(CASE p_permission
    WHEN 'store.read' THEN caller_role IN ('owner','admin','accountant','staff','viewer')
    WHEN 'team.manage' THEN caller_role IN ('owner','admin')
    WHEN 'team.privileged' THEN caller_role = 'owner'
    WHEN 'settings.write' THEN caller_role IN ('owner','admin')
    WHEN 'sales.write' THEN caller_role IN ('owner','admin','staff')
    WHEN 'purchases.write' THEN caller_role IN ('owner','admin')
    WHEN 'inventory.write' THEN caller_role IN ('owner','admin')
    WHEN 'journal.read' THEN caller_role IN ('owner','accountant')
    WHEN 'journal.write' THEN caller_role IN ('owner','accountant')
    WHEN 'finance.write' THEN caller_role IN ('owner','accountant')
    WHEN 'period.reopen' THEN caller_role = 'owner'
    WHEN 'subscription.write' THEN caller_role = 'owner'
    ELSE false
  END, false);
END;
$$;

REVOKE ALL ON FUNCTION public.has_store_permission(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_store_permission(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_store_permission(uuid,text) TO service_role;

-- 2. Update update_journal_entry_with_sync with permission & actor check, plus strict line pre-validation
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
  v_session_actor UUID := auth.uid();
BEGIN
  -- 1. جلب القيد مع القفل الحصري لمنع التعارض التزامني
  SELECT * INTO v_entry
  FROM public.journal_entries
  WHERE id = p_entry_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'القيد المحاسبي غير موجود';
  END IF;

  -- 2. التحقق من صلاحية تعديل القيود ومطابقة هوية المنفذ
  IF NOT public.has_store_permission(v_entry.store_id, 'journal.write') THEN
    RAISE EXCEPTION 'لا تملك صلاحية تعديل القيود';
  END IF;

  IF p_actor_id IS NOT NULL AND p_actor_id IS DISTINCT FROM v_session_actor THEN
    RAISE EXCEPTION 'هوية منفذ العملية غير مطابقة للجلسة';
  END IF;

  IF v_entry.status = 'voided' THEN
    RAISE EXCEPTION 'لا يمكن تعديل قيد ملغي (Voided)';
  END IF;

  -- 3. التحقق من إقفال الفترات المحاسبية للتاريخ القديم والجديد
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

  -- 4. التحقق المسبق الصارم من السطور والحسابات قبل المساس بالبيانات القديمة
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) < 2 THEN
    RAISE EXCEPTION 'يجب أن يحتوي القيد على طرفين على الأقل (مدين ودائن)';
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_acc_id := (v_line->>'account_id')::uuid;
    IF v_acc_id IS NULL THEN
      RAISE EXCEPTION 'معرف الحساب المحاسبي مطلوب لكل طرف';
    END IF;

    SELECT * INTO v_acc FROM public.accounts WHERE id = v_acc_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'الحساب المحاسبي غير موجود (%)', v_acc_id;
    END IF;

    IF v_acc.store_id IS DISTINCT FROM v_entry.store_id OR v_acc.is_active IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'الحساب غير متاح في هذا المتجر';
    END IF;

    IF v_acc.is_group = TRUE THEN
      RAISE EXCEPTION 'لا يجوز الترحيل على حساب رئيسي تجميعي (%)', v_acc.name;
    END IF;

    IF (v_line->>'debit') IS NULL OR (v_line->>'credit') IS NULL THEN
      RAISE EXCEPTION 'قيم أطراف القيد مطلوبة';
    END IF;

    IF (v_line->>'debit') IN ('NaN','Infinity','-Infinity') OR (v_line->>'credit') IN ('NaN','Infinity','-Infinity') THEN
      RAISE EXCEPTION 'قيم طرف القيد غير صالحة';
    END IF;

    v_debit := (v_line->>'debit')::numeric;
    v_credit := (v_line->>'credit')::numeric;

    IF v_debit < 0 OR v_credit < 0 OR (v_debit = 0 AND v_credit = 0) OR (v_debit > 0 AND v_credit > 0) THEN
      RAISE EXCEPTION 'قيم طرف القيد غير صالحة';
    END IF;

    v_total_debit := v_total_debit + v_debit;
    v_total_credit := v_total_credit + v_credit;
  END LOOP;

  IF ABS(v_total_debit - v_total_credit) > 0.01 OR v_total_debit <= 0 THEN
    RAISE EXCEPTION 'القيد غير متوازن: إجمالي المدين (%) لا يساوي إجمالي الدائن (%)', v_total_debit, v_total_credit;
  END IF;

  -- 5. عكس الأثر القديم للسطور من أرصدة شجرة الحسابات
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

  -- 6. إدراج السطور الجديدة وتحديث أرصدة الحسابات
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_acc_id := (v_line->>'account_id')::uuid;
    v_debit := (v_line->>'debit')::numeric;
    v_credit := (v_line->>'credit')::numeric;
    v_line_desc := COALESCE(v_line->>'description', p_description);
    v_currency := COALESCE(v_line->>'currency', 'ILS');
    v_rate := COALESCE((v_line->>'exchange_rate')::numeric, 1.0);
    v_orig_debit := COALESCE((v_line->>'original_debit')::numeric, v_debit);
    v_orig_credit := COALESCE((v_line->>'original_credit')::numeric, v_credit);
    v_tag_used := v_line->>'account_tag_used';
    v_rule := v_line->>'source_rule';

    SELECT * INTO v_acc FROM public.accounts WHERE id = v_acc_id;

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

  -- 7. تحديث رأس القيد وتوثيق المنفذ
  UPDATE public.journal_entries
  SET
    date = p_date,
    description = p_description,
    created_by = COALESCE(v_session_actor, created_by)
  WHERE id = p_entry_id;

  -- 8. المزامنة مع المستندات التشغيلية الأصلية إن وجدت
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

  -- 9. تسجيل التدقيق المالي
  INSERT INTO public.financial_audit_log (
    store_id, entity_type, entity_id, entity_label, action, actor_id, details
  ) VALUES (
    v_entry.store_id, 'journal_entry', p_entry_id, v_entry.entry_number, 'update', v_session_actor,
    jsonb_build_object(
      'action', 'update_journal_entry_with_sync',
      'old_date', v_entry.date,
      'new_date', p_date,
      'new_total', v_total_debit,
      'lines_count', jsonb_array_length(p_lines)
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'entry_id', p_entry_id,
    'total_amount', v_total_debit,
    'date', p_date,
    'lines_count', jsonb_array_length(p_lines)
  );
END;
$$;

-- 3. Replace permissive journal policies with strict role-based policies
DROP POLICY IF EXISTS journal_entries_store_member ON public.journal_entries;
DROP POLICY IF EXISTS journal_lines_store_member ON public.journal_lines;

-- Policies for journal_entries
CREATE POLICY journal_entries_select ON public.journal_entries
  FOR SELECT TO authenticated
  USING (public.has_store_permission(store_id, 'journal.read'));

CREATE POLICY journal_entries_insert ON public.journal_entries
  FOR INSERT TO authenticated
  WITH CHECK (public.has_store_permission(store_id, 'journal.write'));

CREATE POLICY journal_entries_update ON public.journal_entries
  FOR UPDATE TO authenticated
  USING (public.has_store_permission(store_id, 'journal.write'))
  WITH CHECK (public.has_store_permission(store_id, 'journal.write'));

CREATE POLICY journal_entries_delete ON public.journal_entries
  FOR DELETE TO authenticated
  USING (public.has_store_permission(store_id, 'journal.write'));

-- Policies for journal_lines
CREATE POLICY journal_lines_select ON public.journal_lines
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.journal_entries je
      WHERE je.id = journal_lines.journal_entry_id
        AND public.has_store_permission(je.store_id, 'journal.read')
    )
  );

CREATE POLICY journal_lines_insert ON public.journal_lines
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.journal_entries je
      WHERE je.id = journal_lines.journal_entry_id
        AND public.has_store_permission(je.store_id, 'journal.write')
    )
  );

CREATE POLICY journal_lines_update ON public.journal_lines
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.journal_entries je
      WHERE je.id = journal_lines.journal_entry_id
        AND public.has_store_permission(je.store_id, 'journal.write')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.journal_entries je
      WHERE je.id = journal_lines.journal_entry_id
        AND public.has_store_permission(je.store_id, 'journal.write')
    )
  );

CREATE POLICY journal_lines_delete ON public.journal_lines
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.journal_entries je
      WHERE je.id = journal_lines.journal_entry_id
        AND public.has_store_permission(je.store_id, 'journal.write')
    )
  );

COMMIT;
