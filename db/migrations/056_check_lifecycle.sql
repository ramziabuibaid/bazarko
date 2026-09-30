BEGIN;
CREATE TABLE public.supplier_ledger (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),store_id uuid NOT NULL REFERENCES public.stores(id),
 supplier_id uuid NOT NULL REFERENCES public.suppliers(id),type text NOT NULL,
 date date NOT NULL,description text NOT NULL,reference text,reference_id uuid,reference_type text,
 debit numeric(14,2) NOT NULL DEFAULT 0,credit numeric(14,2) NOT NULL DEFAULT 0,balance numeric(14,2) NOT NULL,
 created_by uuid REFERENCES auth.users(id),created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.supplier_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY supplier_ledger_read ON public.supplier_ledger FOR SELECT TO authenticated USING(public.is_store_member(store_id));
REVOKE INSERT,UPDATE,DELETE ON public.supplier_ledger FROM anon,authenticated;

-- One transition table powers previews and execution. No destructive deduplication.
CREATE TABLE public.check_state_transitions (
 operation text NOT NULL, from_status text NOT NULL, to_status text NOT NULL,
 debit_tag text, credit_tag text, PRIMARY KEY(operation,from_status)
);
INSERT INTO public.check_state_transitions VALUES
 ('deposit','in_portfolio','deposited','CHECKS_UNDER_COLLECTION','CHEQUES_IN_HAND'),
 ('collect','deposited','collected','BANK','CHECKS_UNDER_COLLECTION'),
 ('collect','in_portfolio','collected','CASH','CHEQUES_IN_HAND'),
 ('bounce','deposited','bounced','CHECKS_BOUNCED','CHECKS_UNDER_COLLECTION'),
 ('bounce','in_portfolio','bounced','CHECKS_BOUNCED','CHEQUES_IN_HAND'),
 ('return_to_customer','bounced','returned_to_customer','CUSTOMER_RECEIVABLE','CHECKS_BOUNCED'),
 ('return_to_customer','supplier_returned','returned_to_customer','CUSTOMER_RECEIVABLE','CHECKS_BOUNCED'),
 ('recollect','bounced','in_portfolio','CHEQUES_IN_HAND','CHECKS_BOUNCED'),
 ('recollect','supplier_returned','in_portfolio','CHEQUES_IN_HAND','CHECKS_BOUNCED'),
 ('endorse','in_portfolio','endorsed','SUPPLIER_PAYABLE','CHEQUES_IN_HAND'),
 ('supplier_return','endorsed','supplier_returned','CHECKS_BOUNCED','SUPPLIER_PAYABLE'),
 ('transfer_cashbox','in_portfolio','in_portfolio',NULL,NULL),
 ('transfer_cashbox','bounced','bounced',NULL,NULL),
 ('transfer_cashbox','supplier_returned','supplier_returned',NULL,NULL);
ALTER TABLE public.check_state_transitions ENABLE ROW LEVEL SECURITY;
CREATE POLICY check_transitions_read ON public.check_state_transitions FOR SELECT TO authenticated USING(true);
REVOKE INSERT,UPDATE,DELETE ON public.check_state_transitions FROM anon,authenticated;

CREATE FUNCTION public.preview_check_lifecycle_operation(p_check_id uuid,p_op_type text,p_date date,
 p_target_bank_id uuid DEFAULT NULL,p_target_cashbox_id uuid DEFAULT NULL,p_target_supplier_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE c public.checks%ROWTYPE; t public.check_state_transitions%ROWTYPE;
 d uuid; cr uuid; d_entity uuid; cr_entity uuid; supplier uuid; result jsonb;
BEGIN
 SELECT * INTO c FROM public.checks WHERE id=p_check_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'الشيك غير موجود'; END IF;
 PERFORM public.assert_financial_permission(c.store_id,'check');
 IF c.type <> 'received' THEN RAISE EXCEPTION 'هذه الدورة خاصة بالشيكات الواردة'; END IF;
 SELECT * INTO t FROM public.check_state_transitions WHERE operation=p_op_type AND from_status=c.status;
 IF NOT FOUND THEN RAISE EXCEPTION 'الانتقال غير مسموح من الحالة الحالية'; END IF;
 IF p_date IS NULL OR COALESCE(c.amount_ils,c.amount,0)<=0 THEN RAISE EXCEPTION 'التاريخ أو المبلغ غير صالح'; END IF;
 IF EXISTS(SELECT 1 FROM public.accounting_periods WHERE store_id=c.store_id AND is_closed AND p_date BETWEEN start_date AND end_date) THEN
   RAISE EXCEPTION 'الفترة المحاسبية مقفلة'; END IF;
 IF p_target_bank_id IS NOT NULL THEN
   PERFORM public.resolve_financial_account(c.store_id,'BANK',p_target_bank_id);
 END IF;
 IF p_target_cashbox_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.cash_boxes WHERE id=p_target_cashbox_id AND store_id=c.store_id AND is_active IS TRUE) THEN
   RAISE EXCEPTION 'الصندوق غير صالح'; END IF;
 IF p_target_supplier_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.suppliers WHERE id=p_target_supplier_id AND store_id=c.store_id) THEN
   RAISE EXCEPTION 'المورد غير صالح'; END IF;
 IF p_op_type='deposit' AND p_target_bank_id IS NULL THEN RAISE EXCEPTION 'حدد البنك'; END IF;
 IF p_op_type='collect' THEN
   IF c.status='deposited' AND (p_target_bank_id IS NULL OR p_target_bank_id IS DISTINCT FROM c.deposit_bank_account_id OR p_target_cashbox_id IS NOT NULL) THEN
     RAISE EXCEPTION 'التحصيل المودع يكون في بنك الإيداع المحدد'; END IF;
   IF c.status='in_portfolio' AND (p_target_cashbox_id IS NULL OR p_target_bank_id IS NOT NULL) THEN
     RAISE EXCEPTION 'التحصيل المباشر يحتاج صندوقاً؛ التحصيل البنكي يسبقه الإيداع'; END IF;
   d_entity := COALESCE(p_target_bank_id,p_target_cashbox_id);
 END IF;
 IF p_op_type='endorse' THEN
   IF p_target_supplier_id IS NULL THEN RAISE EXCEPTION 'حدد المورد'; END IF;
   d_entity := p_target_supplier_id;
 END IF;
 IF p_op_type='supplier_return' THEN
   IF c.endorsed_supplier_id IS NULL THEN RAISE EXCEPTION 'المورد الأصلي غير مرتبط بالشيك'; END IF;
   IF p_target_supplier_id IS NOT NULL AND p_target_supplier_id IS DISTINCT FROM c.endorsed_supplier_id THEN RAISE EXCEPTION 'المورد لا يطابق التجيير'; END IF;
   cr_entity := c.endorsed_supplier_id;
 END IF;
 IF p_op_type='return_to_customer' THEN
   IF c.customer_id IS NULL THEN RAISE EXCEPTION 'العميل الأصلي غير مرتبط بالشيك'; END IF;
   d_entity := c.customer_id;
 END IF;
 IF p_op_type='transfer_cashbox' THEN
   IF p_target_cashbox_id IS NULL OR p_target_cashbox_id IS NOT DISTINCT FROM c.cashbox_id THEN RAISE EXCEPTION 'حدد صندوق عهدة مختلفاً'; END IF;
 ELSE
   d := public.resolve_financial_account(c.store_id,t.debit_tag,d_entity);
   cr := public.resolve_financial_account(c.store_id,t.credit_tag,cr_entity);
 END IF;
 SELECT jsonb_build_object('debitAccountId',d,'creditAccountId',cr,
   'debitAccountName',COALESCE(da.name,'نقل عهدة دون قيد مالي'),'debitAccountCode',COALESCE(da.code,''),
   'creditAccountName',COALESCE(ca.name,''),'creditAccountCode',COALESCE(ca.code,''),
   'amount',COALESCE(c.amount_ils,c.amount),'currency','ILS','date',p_date,
   'description',p_op_type || ' — ' || c.check_number,'operationType',p_op_type,
   'fromStatus',c.status,'toStatus',t.to_status,'debitTag',da.account_tag,'creditTag',ca.account_tag)
 INTO result FROM (SELECT 1) x LEFT JOIN public.accounts da ON da.id=d LEFT JOIN public.accounts ca ON ca.id=cr;
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.execute_check_lifecycle_operation(p_check_id uuid,p_op_type text,p_date date,
 p_target_bank_id uuid DEFAULT NULL,p_target_cashbox_id uuid DEFAULT NULL,p_target_supplier_id uuid DEFAULT NULL,
 p_notes text DEFAULT NULL,p_actor_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE c public.checks%ROWTYPE; actor uuid; plan jsonb; posting jsonb;
 op uuid := gen_random_uuid(); amount numeric; new_balance numeric; supplier uuid;
BEGIN
 SELECT * INTO c FROM public.checks WHERE id=p_check_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'الشيك غير موجود'; END IF;
 actor := public.assert_financial_permission(c.store_id,'check');
 PERFORM pg_advisory_xact_lock(hashtextextended('financial:' || c.store_id::text,0));
 SELECT * INTO c FROM public.checks WHERE id=p_check_id FOR UPDATE;
 plan := public.preview_check_lifecycle_operation(p_check_id,p_op_type,p_date,p_target_bank_id,p_target_cashbox_id,p_target_supplier_id);
 amount := (plan->>'amount')::numeric;
 IF p_op_type <> 'transfer_cashbox' THEN
   posting := public.post_journal_entry_atomic(jsonb_build_object('storeId',c.store_id,'date',p_date,
     'description',plan->>'description','source','check_op','refId',p_check_id,
     'sourceType','check_operation','sourceNumber',c.check_number,'sourceModule','CHEQUES',
     'accountingRule','CHECK_' || upper(p_op_type),'idempotencyKey','check-operation:' || op,
     'lines',jsonb_build_array(
       jsonb_build_object('account_id',plan->>'debitAccountId','debit',amount,'credit',0,'account_tag_used',plan->>'debitTag'),
       jsonb_build_object('account_id',plan->>'creditAccountId','debit',0,'credit',amount,'account_tag_used',plan->>'creditTag'))));
 END IF;
 IF p_op_type='return_to_customer' THEN
   UPDATE public.customers SET balance=COALESCE(balance,0)+amount WHERE id=c.customer_id AND store_id=c.store_id RETURNING balance INTO new_balance;
   INSERT INTO public.customer_ledger(store_id,customer_id,type,date,description,debit,credit,balance,reference_id,reference_type,created_by)
   VALUES(c.store_id,c.customer_id,'adjustment',p_date,plan->>'description',amount,0,new_balance,op,'check_operation',actor);
 END IF;
 IF p_op_type IN ('endorse','supplier_return') THEN
   supplier := CASE WHEN p_op_type='endorse' THEN p_target_supplier_id ELSE c.endorsed_supplier_id END;
   UPDATE public.suppliers SET balance=COALESCE(balance,0)+CASE WHEN p_op_type='endorse' THEN -amount ELSE amount END
     WHERE id=supplier AND store_id=c.store_id RETURNING balance INTO new_balance;
   INSERT INTO public.supplier_ledger(store_id,supplier_id,type,date,description,reference_id,reference_type,debit,credit,balance,created_by)
     VALUES(c.store_id,supplier,'check_operation',p_date,plan->>'description',op,'check_operation',
       CASE WHEN p_op_type='endorse' THEN amount ELSE 0 END,CASE WHEN p_op_type='supplier_return' THEN amount ELSE 0 END,new_balance,actor);
 END IF;
 IF p_op_type='collect' AND p_target_cashbox_id IS NOT NULL THEN
   INSERT INTO public.cash_movements(store_id,cash_box_id,direction,amount,source,ref_id,payment_method,description,date,created_by)
   VALUES(c.store_id,p_target_cashbox_id,'in',amount,'check_collect',p_check_id,'cash',plan->>'description',p_date,actor);
 ELSIF p_op_type='collect' AND p_target_bank_id IS NOT NULL THEN
   UPDATE public.bank_accounts SET balance=COALESCE(balance,0)+amount,updated_at=now() WHERE id=p_target_bank_id AND store_id=c.store_id;
 END IF;
 UPDATE public.checks SET status=plan->>'toStatus',
   deposit_bank_account_id=CASE WHEN p_op_type='deposit' THEN p_target_bank_id ELSE deposit_bank_account_id END,
   endorsed_supplier_id=CASE WHEN p_op_type='endorse' THEN p_target_supplier_id ELSE endorsed_supplier_id END,
   cashbox_id=CASE WHEN p_op_type='transfer_cashbox' THEN p_target_cashbox_id ELSE cashbox_id END,
   notes=COALESCE(p_notes,notes),updated_at=now() WHERE id=p_check_id;
 INSERT INTO public.check_operations(id,check_id,store_id,operation_type,operation_date,from_status,to_status,
   target_bank_account_id,target_cashbox_id,target_supplier_id,journal_entry_id,notes,performed_by)
 VALUES(op,p_check_id,c.store_id,p_op_type,p_date,c.status,plan->>'toStatus',p_target_bank_id,p_target_cashbox_id,
   COALESCE(supplier,p_target_supplier_id),(posting->>'entryId')::uuid,p_notes,actor);
 INSERT INTO public.financial_audit_log(store_id,entity_type,entity_id,action,actor_id,details)
 VALUES(c.store_id,'check',p_check_id,'status_change',actor,jsonb_build_object('operation_id',op,'plan',plan,'reason',p_notes));
 RETURN jsonb_build_object('success',true,'operation_id',op,'new_status',plan->>'toStatus','journal_entry_id',posting->>'entryId');
END $$;
REVOKE ALL ON FUNCTION public.preview_check_lifecycle_operation(uuid,text,date,uuid,uuid,uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.execute_check_lifecycle_operation(uuid,text,date,uuid,uuid,uuid,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.preview_check_lifecycle_operation(uuid,text,date,uuid,uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.execute_check_lifecycle_operation(uuid,text,date,uuid,uuid,uuid,text,uuid) TO authenticated;
COMMIT;
