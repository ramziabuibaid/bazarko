BEGIN;
-- Explicit entity links; no guessing from names or codes and no historical relinking.
ALTER TABLE public.customers ADD COLUMN account_id uuid REFERENCES public.accounts(id);
ALTER TABLE public.suppliers ADD COLUMN account_id uuid REFERENCES public.accounts(id);

CREATE FUNCTION public.resolve_financial_account(p_store uuid,p_tag text,p_entity uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_id uuid; v_count integer; v_tags text[] := ARRAY[p_tag];
BEGIN
  PERFORM public.assert_financial_permission(p_store,'post');
  IF p_tag IN ('CHEQUES_IN_HAND','CHEQUES_RECEIVABLE','CHECKS_PORTFOLIO') THEN
    v_tags := ARRAY['CHEQUES_IN_HAND','CHEQUES_RECEIVABLE','CHECKS_PORTFOLIO'];
  END IF;
  IF p_tag IN ('CASH','PETTY_CASH') THEN
    IF p_entity IS NULL THEN
      SELECT count(*),(array_agg(account_id))[1] INTO v_count,v_id FROM public.cash_boxes
        WHERE store_id=p_store AND is_default IS TRUE AND is_active IS TRUE;
      IF v_count <> 1 THEN RAISE EXCEPTION 'يجب تعيين صندوق افتراضي واحد أو اختيار الصندوق'; END IF;
    ELSE
      SELECT account_id INTO v_id FROM public.cash_boxes WHERE id=p_entity AND store_id=p_store AND is_active IS TRUE;
    END IF;
    v_tags := ARRAY['CASH','PETTY_CASH'];
    IF v_id IS NULL THEN RAISE EXCEPTION 'الصندوق غير صالح أو غير مرتبط بحساب'; END IF;
  ELSIF p_tag='BANK' THEN
    IF p_entity IS NULL THEN RAISE EXCEPTION 'يجب تحديد الحساب البنكي'; END IF;
    SELECT account_id INTO v_id FROM public.bank_accounts WHERE id=p_entity AND store_id=p_store AND is_active IS TRUE;
    IF v_id IS NULL THEN RAISE EXCEPTION 'البنك غير صالح أو غير مرتبط بحساب'; END IF;
  ELSIF p_tag='CUSTOMER_RECEIVABLE' AND p_entity IS NOT NULL THEN
    SELECT account_id INTO v_id FROM public.customers WHERE id=p_entity AND store_id=p_store AND is_active IS TRUE;
    IF NOT FOUND THEN RAISE EXCEPTION 'العميل غير صالح'; END IF;
  ELSIF p_tag='SUPPLIER_PAYABLE' AND p_entity IS NOT NULL THEN
    SELECT account_id INTO v_id FROM public.suppliers WHERE id=p_entity AND store_id=p_store;
    IF NOT FOUND THEN RAISE EXCEPTION 'المورد غير صالح'; END IF;
  END IF;
  IF v_id IS NULL THEN
    -- A single shared control account is valid; subsidiary ledgers carry entity identity.
    SELECT count(*),(array_agg(id))[1] INTO v_count,v_id FROM public.accounts
      WHERE store_id=p_store AND account_tag=ANY(v_tags) AND is_active IS TRUE AND is_group IS FALSE;
    IF v_count <> 1 THEN RAISE EXCEPTION 'الوسم % يحتاج حساباً وحيداً أو ربطاً صريحاً بالكيان',p_tag; END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.accounts WHERE id=v_id AND store_id=p_store
      AND account_tag=ANY(v_tags) AND is_active IS TRUE AND is_group IS FALSE) THEN
    RAISE EXCEPTION 'الحساب المرتبط غير صالح للعملية أو المتجر';
  END IF;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.resolve_financial_account(uuid,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.resolve_financial_account(uuid,text,uuid) TO authenticated;

-- Posted financial values are immutable. This endpoint only edits explanatory text.
-- Financial corrections require a linked reversal and a new source document.
CREATE OR REPLACE FUNCTION public.update_journal_entry_with_sync(
 p_entry_id uuid,p_date date,p_description text,p_lines jsonb,p_actor_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_entry public.journal_entries%ROWTYPE; v_actor uuid; v_before jsonb; v_after jsonb;
BEGIN
 SELECT * INTO v_entry FROM public.journal_entries WHERE id=p_entry_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'القيد غير موجود'; END IF;
 v_actor := public.assert_financial_permission(v_entry.store_id,'post');
 PERFORM pg_advisory_xact_lock(hashtextextended('financial:' || v_entry.store_id::text,0));
 SELECT * INTO v_entry FROM public.journal_entries WHERE id=p_entry_id FOR UPDATE;
 IF v_entry.status <> 'posted' THEN RAISE EXCEPTION 'هذه العملية مخصصة لوصف القيد المرحل'; END IF;
 IF p_date IS DISTINCT FROM v_entry.date OR NULLIF(btrim(p_description),'') IS NULL THEN
   RAISE EXCEPTION 'تغيير التاريخ يتطلب عكس القيد؛ والوصف مطلوب'; END IF;
 IF EXISTS(SELECT 1 FROM public.accounting_periods WHERE store_id=v_entry.store_id AND is_closed
   AND (p_date BETWEEN start_date AND end_date OR v_entry.date BETWEEN start_date AND end_date)) THEN
   RAISE EXCEPTION 'الفترة المحاسبية مقفلة'; END IF;
 SELECT jsonb_agg(jsonb_build_array(account_id,debit,credit,currency,exchange_rate) ORDER BY account_id,debit,credit,currency,exchange_rate)
   INTO v_before FROM public.journal_lines WHERE journal_entry_id=p_entry_id;
 SELECT jsonb_agg(jsonb_build_array(account_id,debit,credit,COALESCE(currency,'ILS'),COALESCE(exchange_rate,1))
   ORDER BY account_id,debit,credit,COALESCE(currency,'ILS'),COALESCE(exchange_rate,1)) INTO v_after
   FROM jsonb_to_recordset(p_lines) AS l(account_id uuid,debit numeric,credit numeric,currency text,exchange_rate numeric);
 IF v_before IS DISTINCT FROM v_after THEN RAISE EXCEPTION 'تغيير مالي في قيد مرحل يتطلب عكساً وإعادة إصدار'; END IF;
 UPDATE public.journal_entries SET description=btrim(p_description) WHERE id=p_entry_id;
 INSERT INTO public.financial_audit_log(store_id,entity_type,entity_id,entity_label,action,actor_id,details)
 VALUES(v_entry.store_id,'journal_entry',p_entry_id,v_entry.entry_number,'update',v_actor,
   jsonb_build_object('before_description',v_entry.description,'after_description',p_description));
 RETURN jsonb_build_object('success',true,'entry_id',p_entry_id);
END $$;
REVOKE ALL ON FUNCTION public.update_journal_entry_with_sync(uuid,date,text,jsonb,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.update_journal_entry_with_sync(uuid,date,text,jsonb,uuid) TO authenticated;
COMMIT;
