BEGIN;
CREATE UNIQUE INDEX journal_one_reversal ON public.journal_entries(reversal_of) WHERE reversal_of IS NOT NULL;

CREATE FUNCTION public.guard_journal_history() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE e public.journal_entries%ROWTYPE; v_store uuid; v_old date; v_new date;
BEGIN
 IF TG_TABLE_NAME='journal_lines' THEN
   SELECT * INTO e FROM public.journal_entries WHERE id=CASE WHEN TG_OP='DELETE' THEN OLD.journal_entry_id ELSE NEW.journal_entry_id END;
   v_store:=e.store_id; v_old:=e.date; v_new:=e.date;
   IF e.status='posted' THEN RAISE EXCEPTION 'سطور القيد المرحل محفوظة؛ استخدم القيد العكسي'; END IF;
   IF TG_OP='UPDATE' AND NEW.journal_entry_id IS DISTINCT FROM OLD.journal_entry_id THEN RAISE EXCEPTION 'نقل السطر بين القيود غير مسموح'; END IF;
   IF TG_OP<>'DELETE' AND NOT EXISTS(SELECT 1 FROM public.accounts WHERE id=NEW.account_id AND store_id=e.store_id AND is_active IS TRUE AND is_group IS FALSE) THEN
     RAISE EXCEPTION 'حساب السطر غير صالح أو يتبع متجراً آخر'; END IF;
 ELSE
   v_store:=CASE WHEN TG_OP='DELETE' THEN OLD.store_id ELSE NEW.store_id END;
   IF TG_OP<>'INSERT' THEN
     v_old:=OLD.date;
     IF TG_OP='DELETE' AND OLD.status='posted' THEN RAISE EXCEPTION 'لا يمكن حذف قيد مرحل'; END IF;
     IF TG_OP='UPDATE' AND (NEW.store_id IS DISTINCT FROM OLD.store_id OR (OLD.status='posted' AND
       (to_jsonb(NEW)-'description') IS DISTINCT FROM (to_jsonb(OLD)-'description'))) THEN
       RAISE EXCEPTION 'القيد المرحل محفوظ؛ استخدم القيد العكسي'; END IF;
   END IF;
   IF TG_OP<>'DELETE' THEN v_new:=NEW.date; END IF;
 END IF;
 PERFORM public.assert_financial_permission(v_store,'post');
 PERFORM pg_advisory_xact_lock(hashtextextended('financial:' || v_store::text,0));
 IF EXISTS(SELECT 1 FROM public.accounting_periods WHERE store_id=v_store AND is_closed
   AND (v_old BETWEEN start_date AND end_date OR v_new BETWEEN start_date AND end_date)) THEN RAISE EXCEPTION 'الفترة المحاسبية مقفلة'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER journal_history_guard BEFORE INSERT OR UPDATE OR DELETE ON public.journal_entries FOR EACH ROW EXECUTE FUNCTION public.guard_journal_history();
CREATE TRIGGER journal_lines_history_guard BEFORE INSERT OR UPDATE OR DELETE ON public.journal_lines FOR EACH ROW EXECUTE FUNCTION public.guard_journal_history();

CREATE FUNCTION public.assert_posted_journal_balanced() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE n integer; d numeric; c numeric;
BEGIN
 IF EXISTS(SELECT 1 FROM public.journal_entries WHERE id=NEW.id AND status='posted') THEN
   SELECT count(*),sum(debit),sum(credit) INTO n,d,c FROM public.journal_lines WHERE journal_entry_id=NEW.id;
   IF n<2 OR d IS DISTINCT FROM c OR d<=0 THEN RAISE EXCEPTION 'القيد المرحل غير مكتمل أو غير متوازن'; END IF;
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER journal_balance_at_commit AFTER INSERT OR UPDATE ON public.journal_entries
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_posted_journal_balanced();

CREATE FUNCTION public.guard_accounting_period() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid; operation text;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'احتفظ بالفترة وسجل إعادة فتحها بدلاً من حذفها'; END IF;
 IF NEW.start_date>NEW.end_date THEN RAISE EXCEPTION 'نطاق الفترة غير صالح'; END IF;
 IF TG_OP='UPDATE' AND (NEW.store_id IS DISTINCT FROM OLD.store_id OR NEW.start_date IS DISTINCT FROM OLD.start_date OR NEW.end_date IS DISTINCT FROM OLD.end_date) THEN
   RAISE EXCEPTION 'لا يمكن تغيير متجر أو نطاق الفترة بعد إنشائها'; END IF;
 operation:=CASE WHEN TG_OP='UPDATE' AND OLD.is_closed AND NOT NEW.is_closed THEN 'reopen' ELSE 'close' END;
 actor:=public.assert_financial_permission(NEW.store_id,operation);
 PERFORM pg_advisory_xact_lock(hashtextextended('financial:' || NEW.store_id::text,0));
 IF EXISTS(SELECT 1 FROM public.accounting_periods WHERE store_id=NEW.store_id AND id<>NEW.id
   AND start_date<=NEW.end_date AND end_date>=NEW.start_date) THEN RAISE EXCEPTION 'الفترة تتداخل مع فترة أخرى'; END IF;
 IF operation='reopen' AND (NULLIF(btrim(NEW.notes),'') IS NULL OR NEW.notes IS NOT DISTINCT FROM OLD.notes) THEN
   RAISE EXCEPTION 'سبب إعادة الفتح مطلوب'; END IF;
 IF NEW.is_closed THEN
   IF EXISTS(SELECT 1 FROM public.journal_entries WHERE store_id=NEW.store_id AND date BETWEEN NEW.start_date AND NEW.end_date AND status='draft') THEN
     RAISE EXCEPTION 'توجد قيود غير مرحلة في الفترة'; END IF;
   IF EXISTS(SELECT 1 FROM public.journal_entries e LEFT JOIN public.journal_lines l ON l.journal_entry_id=e.id
     WHERE e.store_id=NEW.store_id AND e.status='posted' AND e.date BETWEEN NEW.start_date AND NEW.end_date
     GROUP BY e.id HAVING count(l.id)<2 OR sum(l.debit)<>sum(l.credit) OR sum(l.debit)<=0) THEN RAISE EXCEPTION 'الفترة تحتوي قيوداً غير سليمة'; END IF;
   NEW.closed_at:=now(); NEW.closed_by:=actor;
 END IF;
 INSERT INTO public.financial_audit_log(store_id,entity_type,entity_id,action,actor_id,details)
 VALUES(NEW.store_id,'accounting_period',NEW.id,'status_change',actor,jsonb_build_object('operation',operation,'is_closed',NEW.is_closed,'reason',NEW.notes));
 RETURN NEW;
END $$;
CREATE TRIGGER accounting_period_guard BEFORE INSERT OR UPDATE OR DELETE ON public.accounting_periods FOR EACH ROW EXECUTE FUNCTION public.guard_accounting_period();

CREATE FUNCTION public.reverse_journals_for_source(p_store uuid,p_ref uuid,p_source text,p_reason text,p_date date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE e public.journal_entries%ROWTYPE; result jsonb; lines jsonb; ids jsonb:='[]'; existing uuid;
BEGIN
 PERFORM public.assert_financial_permission(p_store,'post');
 IF NULLIF(btrim(p_reason),'') IS NULL OR p_date IS NULL THEN RAISE EXCEPTION 'سبب العكس وتاريخه مطلوبان'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('financial:' || p_store::text,0));
 FOR e IN SELECT * FROM public.journal_entries WHERE store_id=p_store AND ref_id=p_ref AND source=p_source ORDER BY id FOR UPDATE LOOP
   IF e.status='draft' THEN DELETE FROM public.journal_entries WHERE id=e.id; CONTINUE; END IF;
   IF e.status<>'posted' THEN RAISE EXCEPTION 'حالة القيد غير قابلة للعكس'; END IF;
   SELECT id INTO existing FROM public.journal_entries WHERE reversal_of=e.id;
   IF FOUND THEN ids:=ids || jsonb_build_array(existing); CONTINUE; END IF;
   SELECT jsonb_agg(jsonb_build_object('account_id',account_id,'debit',credit,'credit',debit,'currency',currency,'exchange_rate',exchange_rate)
     ORDER BY sort_order,id) INTO lines FROM public.journal_lines WHERE journal_entry_id=e.id;
   result:=public.post_journal_entry_atomic(jsonb_build_object('storeId',p_store,'date',p_date,'description',p_reason,
     'source','reversal','refId',e.id,'accountingRule','JOURNAL_REVERSED','sourceModule','ACCOUNTING',
     'idempotencyKey','reversal:' || e.id,'lines',lines));
   ids:=ids || jsonb_build_array(result->>'entryId');
 END LOOP;
 RETURN jsonb_build_object('success',true,'reversalIds',ids);
END $$;
REVOKE ALL ON FUNCTION public.reverse_journals_for_source(uuid,uuid,text,text,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.reverse_journals_for_source(uuid,uuid,text,text,date) TO authenticated;
-- Trigger functions have no directly callable surface.
REVOKE ALL ON FUNCTION public.guard_journal_history(),public.assert_posted_journal_balanced(),public.guard_accounting_period() FROM PUBLIC,anon,authenticated;
COMMIT;
