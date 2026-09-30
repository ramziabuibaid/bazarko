-- Tested independently before deployment; does not rewrite historical balances.
BEGIN;

CREATE TABLE public.financial_operation_permissions (
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  operation text NOT NULL CHECK (operation IN ('post','check','close','reopen')),
  PRIMARY KEY (store_id, profile_id, operation)
);
ALTER TABLE public.financial_operation_permissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY financial_permissions_read ON public.financial_operation_permissions
  FOR SELECT TO authenticated USING (public.is_store_member(store_id));
-- Grants are administered through privileged deployment tooling until a permission UI exists.
REVOKE INSERT, UPDATE, DELETE ON public.financial_operation_permissions FROM anon, authenticated;

CREATE FUNCTION public.assert_financial_permission(p_store_id uuid, p_operation text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_actor uuid := auth.uid(); v_role text;
BEGIN
  SELECT role INTO v_role FROM public.store_members
  WHERE store_id = p_store_id AND profile_id = v_actor AND is_active IS TRUE;
  IF v_actor IS NULL OR v_role IS NULL OR NOT (
    v_role IN ('owner','admin') OR
    (v_role = 'accountant' AND p_operation IN ('post','check','close')) OR
    EXISTS (SELECT 1 FROM public.financial_operation_permissions
      WHERE store_id = p_store_id AND profile_id = v_actor AND operation = p_operation)
  ) THEN RAISE EXCEPTION 'غير مخول للعملية المالية' USING ERRCODE = '42501'; END IF;
  RETURN v_actor;
END $$;
REVOKE ALL ON FUNCTION public.assert_financial_permission(uuid,text) FROM PUBLIC, anon, authenticated;

ALTER TABLE public.journal_entries ADD COLUMN reversal_of uuid REFERENCES public.journal_entries(id);
ALTER TABLE public.journal_entries ADD COLUMN idempotency_key text;
ALTER TABLE public.journal_entries ADD COLUMN posting_payload jsonb;
CREATE UNIQUE INDEX journal_posting_key ON public.journal_entries(store_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
ALTER TABLE public.journal_entries DROP CONSTRAINT journal_entries_source_check;
ALTER TABLE public.journal_entries ADD CONSTRAINT journal_entries_source_check CHECK
 (source IN ('manual','invoice','purchase','sales_return','purchase_return','voucher','check_op','opening','closing','system','reversal','inventory','transfer'));
ALTER TABLE public.financial_audit_log DROP CONSTRAINT financial_audit_log_entity_type_check;
ALTER TABLE public.financial_audit_log ADD CONSTRAINT financial_audit_log_entity_type_check CHECK
 (entity_type IN ('invoice','voucher','cash_movement','cash_session','journal_entry','check','accounting_period'));

CREATE FUNCTION public.post_journal_entry_atomic(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_store uuid := (p_payload->>'storeId')::uuid;
  v_date date := (p_payload->>'date')::date;
  v_actor uuid;
  v_id uuid;
  v_number text;
  v_source text := p_payload->>'source';
  v_ref uuid := COALESCE(NULLIF(p_payload->>'sourceId',''),NULLIF(p_payload->>'refId',''))::uuid;
  v_rule text := COALESCE(NULLIF(p_payload->>'accountingRule',''), 'MANUAL_JOURNAL');
  v_key text := NULLIF(p_payload->>'idempotencyKey','');
  v_lines jsonb := p_payload->'lines';
  v_existing public.journal_entries%ROWTYPE;
  v_debit numeric; v_credit numeric; v_count integer; v_expected integer;
  v_table text;
  v_payload jsonb := p_payload - 'actorId';
BEGIN
  v_actor := public.assert_financial_permission(v_store, 'post');
  IF v_date IS NULL OR NULLIF(btrim(p_payload->>'description'),'') IS NULL THEN
    RAISE EXCEPTION 'التاريخ والوصف مطلوبان';
  END IF;
  IF jsonb_typeof(v_lines) IS DISTINCT FROM 'array' OR jsonb_array_length(v_lines) < 2 THEN
    RAISE EXCEPTION 'القيد يحتاج سطرين على الأقل';
  END IF;
  -- Serializes posting and period closure for this store, also stabilizes lock order.
  PERFORM pg_advisory_xact_lock(hashtextextended('financial:' || v_store::text, 0));
  IF v_key IS NULL AND v_ref IS NOT NULL THEN
    v_key := v_source || ':' || v_ref::text || ':' || v_rule;
  END IF;
  IF v_key IS NOT NULL THEN
    SELECT * INTO v_existing FROM public.journal_entries
      WHERE store_id = v_store AND idempotency_key = v_key;
    IF FOUND THEN
      IF v_existing.posting_payload IS DISTINCT FROM v_payload THEN
        RAISE EXCEPTION 'مفتاح العملية مستخدم بطلب مختلف';
      END IF;
      RETURN jsonb_build_object('success',true,'entryId',v_existing.id,'entryNumber',v_existing.entry_number);
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM public.accounting_periods WHERE store_id=v_store AND is_closed
      AND v_date BETWEEN start_date AND end_date) THEN RAISE EXCEPTION 'الفترة المحاسبية مقفلة'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(v_lines) AS l(account_id uuid,debit numeric,credit numeric,exchange_rate numeric)
    WHERE account_id IS NULL OR debit IS NULL OR credit IS NULL
      OR debit::text IN ('NaN','Infinity','-Infinity') OR credit::text IN ('NaN','Infinity','-Infinity')
      OR debit < 0 OR credit < 0 OR (debit > 0 AND credit > 0) OR (debit = 0 AND credit = 0)
      OR debit <> round(debit,2) OR credit <> round(credit,2)
      OR (exchange_rate IS NOT NULL AND (exchange_rate <= 0 OR exchange_rate::text IN ('NaN','Infinity','-Infinity')))) THEN
    RAISE EXCEPTION 'سطور القيد تحتوي قيماً مالية غير صالحة';
  END IF;
  SELECT sum(debit),sum(credit),count(DISTINCT account_id) INTO v_debit,v_credit,v_expected
    FROM jsonb_to_recordset(v_lines) AS l(account_id uuid,debit numeric,credit numeric);
  IF v_debit <> v_credit OR v_debit <= 0 THEN RAISE EXCEPTION 'القيد غير متوازن'; END IF;
  PERFORM a.id FROM public.accounts a
    WHERE a.id IN (SELECT (l->>'account_id')::uuid FROM jsonb_array_elements(v_lines) l)
      AND a.store_id=v_store AND a.is_active IS TRUE AND a.is_group IS FALSE
      AND a.normal_balance IN ('debit','credit') ORDER BY a.id FOR UPDATE;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> v_expected THEN RAISE EXCEPTION 'حساب مفقود أو معطل أو تجميعي أو تابع لمتجر آخر'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_lines) l JOIN public.accounts a ON a.id=(l->>'account_id')::uuid
    WHERE NULLIF(l->>'account_tag_used','') IS NOT NULL AND l->>'account_tag_used' IS DISTINCT FROM a.account_tag) THEN
    RAISE EXCEPTION 'وسم السطر لا يطابق الحساب';
  END IF;
  IF v_source='reversal' THEN
    IF NOT EXISTS(SELECT 1 FROM public.journal_entries WHERE id=v_ref AND store_id=v_store AND status='posted' AND reversal_of IS NULL) THEN
      RAISE EXCEPTION 'القيد الأصلي غير صالح للعكس'; END IF;
    IF EXISTS(
      (SELECT account_id,debit,credit FROM jsonb_to_recordset(v_lines) AS l(account_id uuid,debit numeric,credit numeric)
       EXCEPT ALL SELECT account_id,credit,debit FROM public.journal_lines WHERE journal_entry_id=v_ref)
      UNION ALL
      (SELECT account_id,credit,debit FROM public.journal_lines WHERE journal_entry_id=v_ref
       EXCEPT ALL SELECT account_id,debit,credit FROM jsonb_to_recordset(v_lines) AS l(account_id uuid,debit numeric,credit numeric))
    ) THEN RAISE EXCEPTION 'سطور العكس لا تطابق القيد الأصلي'; END IF;
  END IF;
  -- A source link cannot be used to update another store's document.
  v_table := CASE v_source WHEN 'invoice' THEN 'invoices' WHEN 'voucher' THEN 'vouchers'
    WHEN 'purchase' THEN 'purchase_invoices' WHEN 'sales_return' THEN 'sales_returns'
    WHEN 'purchase_return' THEN 'purchase_returns' END;
  IF v_table IS NOT NULL AND v_ref IS NOT NULL THEN
    EXECUTE format('SELECT count(*) FROM public.%I WHERE id=$1 AND store_id=$2',v_table)
      INTO v_count USING v_ref,v_store;
    IF v_count <> 1 THEN RAISE EXCEPTION 'المستند غير موجود في المتجر'; END IF;
  END IF;
  -- Separate namespace avoids collisions with legacy count-based JV numbers.
  v_number := public.generate_sequence_number(v_store,'JV2-' || to_char(v_date,'YYYYMM') || '-');
  INSERT INTO public.journal_entries(store_id,entry_number,date,description,source,ref_id,source_id,
    source_type,source_number,source_url,accounting_rule,source_module,status,created_by,idempotency_key,posting_payload,reversal_of)
  VALUES(v_store,v_number,v_date,btrim(p_payload->>'description'),v_source,v_ref,v_ref,
    COALESCE(p_payload->>'sourceType',v_source),p_payload->>'sourceNumber',p_payload->>'sourceUrl',
    v_rule,p_payload->>'sourceModule','draft',v_actor,v_key,v_payload,CASE WHEN v_source='reversal' THEN v_ref END) RETURNING id INTO v_id;
  INSERT INTO public.journal_lines(journal_entry_id,account_id,debit,credit,currency,exchange_rate,description,sort_order,account_tag_used,source_rule,original_debit,original_credit)
  SELECT v_id,(l->>'account_id')::uuid,(l->>'debit')::numeric,(l->>'credit')::numeric,
    COALESCE(NULLIF(l->>'currency',''),'ILS'),COALESCE((l->>'exchange_rate')::numeric,1),
    COALESCE(l->>'description',p_payload->>'description'),n,a.account_tag,COALESCE(l->>'source_rule',v_rule),
    COALESCE((l->>'original_debit')::numeric,(l->>'debit')::numeric / COALESCE((l->>'exchange_rate')::numeric,1)),
    COALESCE((l->>'original_credit')::numeric,(l->>'credit')::numeric / COALESCE((l->>'exchange_rate')::numeric,1))
  FROM jsonb_array_elements(v_lines) WITH ORDINALITY AS x(l,n)
  JOIN public.accounts a ON a.id=(l->>'account_id')::uuid;
  UPDATE public.accounts a SET balance=COALESCE(a.balance,0)+
    CASE WHEN a.normal_balance='credit' THEN x.credit-x.debit ELSE x.debit-x.credit END, updated_at=now()
  FROM (SELECT account_id,sum(debit) debit,sum(credit) credit FROM public.journal_lines
    WHERE journal_entry_id=v_id GROUP BY account_id) x WHERE a.id=x.account_id;
  IF v_table IS NOT NULL AND v_ref IS NOT NULL THEN
    EXECUTE format('UPDATE public.%I SET journal_entry_id=$1 WHERE id=$2 AND store_id=$3',v_table)
      USING v_id,v_ref,v_store;
  END IF;
  UPDATE public.journal_entries SET status='posted' WHERE id=v_id;
  INSERT INTO public.financial_audit_log(store_id,entity_type,entity_id,entity_label,action,actor_id,details)
    VALUES(v_store,'journal_entry',v_id,v_number,'create',v_actor,
      jsonb_build_object('accounting_rule',v_rule,'source_id',v_ref,'total_debit',v_debit,'idempotency_key',v_key));
  RETURN jsonb_build_object('success',true,'entryId',v_id,'entryNumber',v_number);
END $$;
REVOKE ALL ON FUNCTION public.post_journal_entry_atomic(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_journal_entry_atomic(jsonb) TO authenticated;
COMMIT;
