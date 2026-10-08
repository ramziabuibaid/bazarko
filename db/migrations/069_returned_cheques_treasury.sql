BEGIN;

-- 1. Add 'checks_returned' to cash_boxes type check constraint
ALTER TABLE public.cash_boxes DROP CONSTRAINT IF EXISTS cash_boxes_type_check;
ALTER TABLE public.cash_boxes ADD CONSTRAINT cash_boxes_type_check
  CHECK (type = ANY (ARRAY['cash', 'bank', 'wallet', 'personal', 'checks_collection', 'checks_received', 'checks_issued', 'checks_returned']));

-- 2. Add return_reason and return_date columns to checks table
ALTER TABLE public.checks ADD COLUMN IF NOT EXISTS return_reason text;
ALTER TABLE public.checks ADD COLUMN IF NOT EXISTS return_date date;

-- 3. Update checks_status_check constraint to allow 'returned' and all return statuses
ALTER TABLE public.checks DROP CONSTRAINT IF EXISTS checks_status_check;
ALTER TABLE public.checks ADD CONSTRAINT checks_status_check
  CHECK (status = ANY (ARRAY['in_portfolio', 'deposited', 'collected', 'bounced', 'returned', 'endorsed', 'returned_to_drawer', 'returned_to_customer', 'supplier_returned']));

-- 4. Automatically provision 'صندوق الشيكات الراجعة' for each store if not already present
INSERT INTO public.cash_boxes (store_id, name, type, account_id, opening_balance, is_default, is_active)
SELECT
  s.id,
  'صندوق الشيكات الراجعة',
  'checks_returned',
  (
    SELECT a.id FROM public.accounts a
    WHERE a.store_id = s.id
      AND (a.code = '1330' OR a.account_tag = 'CHECKS_BOUNCED' OR lower(a.name) LIKE '%مرتجع%' OR lower(a.name) LIKE '%راجع%')
      AND a.is_active
    LIMIT 1
  ),
  0,
  false,
  true
FROM public.stores s
WHERE NOT EXISTS (
  SELECT 1 FROM public.cash_boxes cb
  WHERE cb.store_id = s.id AND cb.type = 'checks_returned'
);

-- 5. Update guard_atomic_receipt_cheque to permit cashbox_id, return_reason, and return_date metadata and bounce/return operations
CREATE OR REPLACE FUNCTION public.guard_atomic_receipt_cheque()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
 IF TG_OP='UPDATE' AND OLD.receipt_settlement_active IS NULL AND NEW.receipt_settlement_active IS NOT NULL AND current_user<>pg_get_userbyid((SELECT proowner FROM pg_proc WHERE oid='public.receipt_cheque_operation_atomic(uuid,uuid,uuid,jsonb,boolean)'::regprocedure)) THEN RAISE EXCEPTION 'لا تغير ربط الشيك الذري مباشرة';END IF;
 IF TG_OP='UPDATE' AND OLD.receipt_settlement_active IS TRUE AND OLD.payment_voucher_id IS NULL AND NEW.payment_voucher_id IS NOT NULL AND NEW.status='endorsed' THEN
  IF current_user<>pg_get_userbyid((SELECT proowner FROM pg_proc WHERE oid='public.create_cheque_payment_atomic(uuid,uuid,jsonb)'::regprocedure)) OR OLD.status<>'in_portfolio' OR
    (to_jsonb(OLD)-ARRAY['status','endorsed_supplier_id','payment_voucher_id','payment_counter_account_id','payment_purchase_id','updated_at','bank_code','branch_code','cashbox_id','notes','return_reason','return_date']) IS DISTINCT FROM (to_jsonb(NEW)-ARRAY['status','endorsed_supplier_id','payment_voucher_id','payment_counter_account_id','payment_purchase_id','updated_at','bank_code','branch_code','cashbox_id','notes','return_reason','return_date']) OR
    NOT EXISTS(SELECT 1 FROM public.check_operations op JOIN public.vouchers v ON v.id=op.payment_voucher_id JOIN public.journal_entries j ON j.id=op.journal_entry_id AND j.ref_id=v.id AND j.store_id=v.store_id AND j.status='posted' WHERE op.check_id=OLD.id AND op.store_id=OLD.store_id AND op.payment_voucher_id=NEW.payment_voucher_id AND op.operation_type='endorse' AND op.from_status='in_portfolio' AND op.to_status='endorsed' AND op.target_supplier_id=NEW.endorsed_supplier_id AND v.store_id=OLD.store_id AND v.type='payment' AND v.creation_request_id IS NULL AND v.supplier_id=NEW.endorsed_supplier_id AND op.operation_date=v.date) THEN RAISE EXCEPTION 'استخدم مسار تظهير الوارد الذري المرتبط';END IF;
  RETURN NEW;
 END IF;
 IF OLD.receipt_settlement_active IS NOT NULL THEN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'لا يحذف شيك قبض ذري؛ استخدم مسار الإعادة';END IF;
  -- If financial status/settlement is unchanged, permit metadata updates (bank_code / branch_code / cashbox_id / notes / return_reason / return_date)
  IF (to_jsonb(OLD)-ARRAY['status','receipt_settlement_active','deposit_bank_account_id','updated_at','bank_code','branch_code','cashbox_id','notes','return_reason','return_date']) IS NOT DISTINCT FROM (to_jsonb(NEW)-ARRAY['status','receipt_settlement_active','deposit_bank_account_id','updated_at','bank_code','branch_code','cashbox_id','notes','return_reason','return_date']) THEN
    IF OLD.status IS NOT DISTINCT FROM NEW.status AND OLD.receipt_settlement_active IS NOT DISTINCT FROM NEW.receipt_settlement_active AND OLD.deposit_bank_account_id IS NOT DISTINCT FROM NEW.deposit_bank_account_id THEN
      RETURN NEW;
    END IF;
  END IF;
  IF current_user<>pg_get_userbyid((SELECT proowner FROM pg_proc WHERE oid='public.receipt_cheque_operation_atomic(uuid,uuid,uuid,jsonb,boolean)'::regprocedure)) OR
   (to_jsonb(OLD)-ARRAY['status','receipt_settlement_active','deposit_bank_account_id','updated_at','bank_code','branch_code','cashbox_id','notes','return_reason','return_date']) IS DISTINCT FROM (to_jsonb(NEW)-ARRAY['status','receipt_settlement_active','deposit_bank_account_id','updated_at','bank_code','branch_code','cashbox_id','notes','return_reason','return_date']) OR
   OLD.status<>'in_portfolio' OR OLD.receipt_settlement_active IS DISTINCT FROM true OR
   NOT EXISTS(SELECT 1 FROM public.check_operations WHERE check_id=OLD.id AND receipt_request_id IS NOT NULL AND from_status=OLD.status AND to_status=NEW.status AND journal_entry_id IS NOT NULL AND ((operation_type='collect' AND NEW.status='collected' AND NEW.receipt_settlement_active IS TRUE AND target_bank_account_id IS NOT DISTINCT FROM NEW.deposit_bank_account_id) OR (operation_type IN ('bounce', 'return') AND NEW.status IN ('bounced', 'returned') AND NEW.receipt_settlement_active IS TRUE) OR (operation_type='return_to_customer' AND NEW.status='returned_to_customer' AND NEW.receipt_settlement_active IS FALSE AND NEW.deposit_bank_account_id IS NOT DISTINCT FROM OLD.deposit_bank_account_id))) THEN RAISE EXCEPTION 'استخدم التحصيل أو الإعادة الذريين للشيك المرتبط';END IF;
 END IF;
 RETURN NEW;
END $function$;

-- 6. Update receipt_cheque_operation_atomic to support 'bounce' / 'return' into returned cheques box
CREATE OR REPLACE FUNCTION public.receipt_cheque_operation_atomic(p_store_id uuid,p_check_id uuid,p_request_id uuid,p_payload jsonb,p_execute boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
 actor uuid:=auth.uid(); ch public.checks%ROWTYPE; v public.vouchers%ROWTYPE; cust public.customers%ROWTYPE; inv public.invoices%ROWTYPE;
 old public.check_operations%ROWTYPE; box public.cash_boxes%ROWTYPE; bank public.bank_accounts%ROWTYPE;
 op text; dt date; curr text; amt numeric; target_bank uuid; target_box uuid; debit_id uuid; credit_id uuid;
 next_status text; note text; descr text; jid uuid; oid uuid:=gen_random_uuid(); debit_acc public.accounts%ROWTYPE; credit_acc public.accounts%ROWTYPE; result jsonb;
 ret_box public.cash_boxes%ROWTYPE;
BEGIN
 IF actor IS NULL OR NOT public.can_manage_cash_permissions(p_store_id) THEN RAISE EXCEPTION 'التحصيل والإعادة يتطلبان مالك المتجر أو المدير';END IF;
 IF p_request_id IS NULL OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' OR p_execute IS NULL THEN RAISE EXCEPTION 'طلب العملية غير صحيح';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_store_id::text,54001));
 SELECT * INTO old FROM public.check_operations WHERE store_id=p_store_id AND receipt_request_id=p_request_id;
 IF FOUND THEN
  IF old.check_id IS DISTINCT FROM p_check_id OR old.receipt_request_payload IS DISTINCT FROM p_payload THEN RAISE EXCEPTION 'معرف العملية سبق استخدامه ببيانات مختلفة';END IF;
  RETURN jsonb_build_object('success',true,'replayed',true,'operationId',old.id,'journalEntryId',old.journal_entry_id,'newStatus',old.to_status);
 END IF;
 SELECT * INTO ch FROM public.checks WHERE id=p_check_id AND store_id=p_store_id FOR UPDATE;
 IF NOT FOUND OR ch.receipt_settlement_active IS NULL OR ch.type<>'received' THEN RAISE EXCEPTION 'اختر شيك قبض مرتبطاً من هذا المتجر';END IF;
 IF ch.status<>'in_portfolio' OR NOT ch.receipt_settlement_active THEN RAISE EXCEPTION 'العملية متاحة فقط لشيك غير محصل في المحفظة';END IF;
 op:=p_payload->>'operationType';
 IF op IS NULL OR op NOT IN ('collect','return_to_customer','bounce','return') THEN RAISE EXCEPTION 'نوع العملية غير مدعوم للشيك المرتبط';END IF;
 IF coalesce(p_payload->>'operationDate','') !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'تاريخ العملية مطلوب';END IF;
 dt:=(p_payload->>'operationDate')::date;
 note:=nullif(btrim(p_payload->>'notes'),'');IF length(note)>1000 THEN RAISE EXCEPTION 'الملاحظة تتجاوز الحد';END IF;
 IF nullif(p_payload->>'targetSupplierId','') IS NOT NULL THEN RAISE EXCEPTION 'العملية لا ترتبط بمورد';END IF;
 SELECT * INTO v FROM public.vouchers WHERE id=ch.voucher_id AND store_id=p_store_id;
 IF NOT FOUND OR v.type<>'receipt' OR v.creation_request_id IS NULL OR v.journal_entry_id IS NULL OR v.cheque_portfolio_id IS DISTINCT FROM ch.cashbox_id OR v.customer_id IS DISTINCT FROM ch.customer_id OR v.invoice_id IS DISTINCT FROM ch.receipt_invoice_id THEN RAISE EXCEPTION 'ربط سند الشيك يحتاج مراجعة';END IF;
 IF dt<v.date OR dt<ch.issue_date THEN RAISE EXCEPTION 'تاريخ العملية لا يسبق استلام الشيك';END IF;
 PERFORM 1 FROM public.accounting_periods WHERE store_id=p_store_id FOR SHARE;
 IF EXISTS(SELECT 1 FROM public.accounting_periods WHERE store_id=p_store_id AND is_closed AND dt BETWEEN start_date AND end_date) THEN RAISE EXCEPTION 'تاريخ العملية ضمن فترة مقفلة';END IF;
 SELECT coalesce(currency_code,'ILS') INTO curr FROM public.stores WHERE id=p_store_id;
 amt:=ch.amount;
 IF amt IS NULL OR amt::text IN ('NaN','Infinity','-Infinity') OR amt<=0 OR ch.currency IS DISTINCT FROM curr OR ch.exchange_rate IS DISTINCT FROM 1::numeric THEN RAISE EXCEPTION 'قيمة أو عملة الشيك تحتاج مراجعة';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.cash_boxes WHERE id=ch.cashbox_id AND store_id=p_store_id AND type='checks_received' AND is_active AND account_id=ch.receipt_portfolio_account_id) THEN RAISE EXCEPTION 'محفظة الشيك غير صالحة';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.journal_entries WHERE id=v.journal_entry_id AND store_id=p_store_id AND status='posted') OR NOT EXISTS(SELECT 1 FROM public.journal_lines WHERE journal_entry_id=v.journal_entry_id AND account_id=ch.receipt_counter_account_id AND credit=v.amount AND currency=curr) OR NOT EXISTS(SELECT 1 FROM public.journal_lines WHERE journal_entry_id=v.journal_entry_id AND account_id=ch.receipt_portfolio_account_id AND debit=v.checks_amount AND currency=curr) THEN RAISE EXCEPTION 'قيد القبض الأصلي يحتاج مطابقة';END IF;
 credit_id:=ch.receipt_portfolio_account_id;
 target_box:=nullif(p_payload->>'targetCashBoxId','')::uuid;target_bank:=nullif(p_payload->>'targetBankAccountId','')::uuid;
 
 IF op='collect' THEN
  IF (target_box IS NULL)=(target_bank IS NULL) THEN RAISE EXCEPTION 'اختر صندوقاً نقدياً أو حساباً بنكياً واحداً';END IF;
  IF target_box IS NOT NULL THEN
   SELECT * INTO box FROM public.cash_boxes WHERE id=target_box AND store_id=p_store_id AND is_active AND type='cash' FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'الصندوق النقدي غير متاح';END IF;debit_id:=box.account_id;
  ELSE
   SELECT * INTO bank FROM public.bank_accounts WHERE id=target_bank AND store_id=p_store_id AND is_active AND currency=curr FOR UPDATE;
   IF NOT FOUND OR coalesce(bank.balance,0)::text IN ('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'الحساب البنكي أو عملته غير صالح';END IF;debit_id:=bank.account_id;
  END IF;
  next_status:='collected';descr:='تحصيل شيك #'||ch.check_number||' دون تسوية ثانية للذمة';

 ELSIF op IN ('bounce', 'return') THEN
  -- Operation: Bounce/Return to Returned Cheques Box
  IF target_box IS NOT NULL THEN
   SELECT * INTO ret_box FROM public.cash_boxes WHERE id=target_box AND store_id=p_store_id AND is_active AND type='checks_returned' FOR UPDATE;
  ELSE
   SELECT * INTO ret_box FROM public.cash_boxes WHERE store_id=p_store_id AND is_active AND type='checks_returned' LIMIT 1 FOR UPDATE;
  END IF;

  IF ret_box.id IS NULL THEN
   -- Fallback or auto-lookup returned cheques account (1330)
   SELECT * INTO debit_acc FROM public.accounts WHERE store_id=p_store_id AND (code='1330' OR account_tag='CHECKS_BOUNCED' OR name ILIKE '%مرتجع%') AND is_active LIMIT 1;
   IF debit_acc.id IS NULL THEN RAISE EXCEPTION 'لم يتم العثور على صندوق أو حساب الشيكات الراجعة'; END IF;
   debit_id:=debit_acc.id;
  ELSE
   target_box:=ret_box.id;
   debit_id:=ret_box.account_id;
   IF debit_id IS NULL THEN
    SELECT id INTO debit_id FROM public.accounts WHERE store_id=p_store_id AND (code='1330' OR account_tag='CHECKS_BOUNCED') AND is_active LIMIT 1;
   END IF;
  END IF;

  next_status:='bounced';
  descr:='إرجاع شيك راجع رقم #'||ch.check_number||COALESCE(' — '||note, '');

 ELSE
  -- op = 'return_to_customer'
  IF target_box IS NOT NULL OR target_bank IS NOT NULL THEN RAISE EXCEPTION 'إعادة الشيك للعميل لا تنشئ حركة نقدية أو بنكية';END IF;
  debit_id:=ch.receipt_counter_account_id;next_status:='returned_to_customer';descr:='إعادة شيك #'||ch.check_number||' وعكس تسوية القبض';
  IF ch.customer_id IS NOT NULL THEN
   SELECT * INTO cust FROM public.customers WHERE id=ch.customer_id AND store_id=p_store_id FOR UPDATE;
   IF NOT FOUND OR coalesce(cust.balance,0)::text IN ('NaN','Infinity','-Infinity') OR coalesce(cust.total_paid,0)::text IN ('NaN','Infinity','-Infinity') OR coalesce(cust.total_paid,0)<amt THEN RAISE EXCEPTION 'تسوية العميل تحتاج مراجعة';END IF;
  END IF;
  IF ch.receipt_invoice_id IS NOT NULL THEN
   SELECT * INTO inv FROM public.invoices WHERE id=ch.receipt_invoice_id AND store_id=p_store_id AND customer_id=ch.customer_id FOR UPDATE;
   IF NOT FOUND OR inv.status IN ('draft','cancelled') OR inv.total IS NULL OR inv.total<=0 OR inv.amount_paid<0 OR inv.total::text IN ('NaN','Infinity','-Infinity') OR inv.amount_paid::text IN ('NaN','Infinity','-Infinity') OR inv.amount_paid IS NULL OR inv.amount_paid<amt OR inv.amount_paid>inv.total THEN RAISE EXCEPTION 'تسوية الفاتورة تحتاج مراجعة';END IF;
  END IF;
 END IF;

 PERFORM 1 FROM public.accounts WHERE id IN (debit_id,credit_id) ORDER BY id FOR UPDATE;
 SELECT * INTO debit_acc FROM public.accounts WHERE id=debit_id AND store_id=p_store_id AND is_active;
 IF NOT FOUND OR coalesce(debit_acc.balance,0)::text IN ('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'الحساب المدين غير صالح';END IF;
 SELECT * INTO credit_acc FROM public.accounts WHERE id=credit_id AND store_id=p_store_id AND is_active AND NOT is_group AND currency=curr;
 IF NOT FOUND OR coalesce(credit_acc.balance,0)::text IN ('NaN','Infinity','-Infinity') OR credit_id=debit_id THEN RAISE EXCEPTION 'حساب المحفظة غير صالح';END IF;

 result:=jsonb_build_object('success',true,'preview',jsonb_build_object('debitAccountName',debit_acc.name,'debitAccountCode',debit_acc.code,'creditAccountName',credit_acc.name,'creditAccountCode',credit_acc.code,'amount',amt,'currency',curr,'date',dt,'description',descr,'operationType',op,'fromStatus',ch.status,'toStatus',next_status));
 IF NOT p_execute THEN RETURN result;END IF;

 INSERT INTO public.journal_entries(store_id,entry_number,date,description,source,ref_id,source_type,source_id,source_number,source_url,accounting_rule,source_module,status,created_by)
 VALUES(p_store_id,'JV-CHK-'||oid::text,dt,descr,'check_op',ch.id,'check_operation',ch.id,ch.check_number,'/dashboard/cheques',CASE WHEN op='collect' THEN 'CHECK_COLLECTED' WHEN op IN ('bounce','return') THEN 'CHECK_BOUNCED' ELSE 'CHECK_RETURNED_TO_CUSTOMER' END,'CHEQUES','posted',actor) RETURNING id INTO jid;
 INSERT INTO public.journal_lines(journal_entry_id,account_id,debit,credit,currency,description,sort_order,source_rule)
 VALUES(jid,debit_id,amt,0,curr,descr,1,'RECEIPT_CHEQUE_LIFECYCLE'),(jid,credit_id,0,amt,curr,descr,2,'RECEIPT_CHEQUE_LIFECYCLE');
 UPDATE public.accounts SET balance=coalesce(balance,0)+CASE WHEN normal_balance='debit' THEN amt ELSE -amt END WHERE id=debit_id;
 UPDATE public.accounts SET balance=coalesce(balance,0)-amt WHERE id=credit_id;

 IF op='collect' AND target_box IS NOT NULL THEN
  INSERT INTO public.cash_movements(store_id,cash_box_id,direction,amount,source,ref_id,party_name,payment_method,description,date,created_by) VALUES(p_store_id,target_box,'in',amt,'check_collect',ch.id,v.party_name,'cash',descr,dt,actor);
 ELSIF op='collect' THEN
  UPDATE public.bank_accounts SET balance=coalesce(balance,0)+amt WHERE id=target_bank;
 ELSIF op IN ('bounce', 'return') THEN
  -- Bounced into returned cheques box
  UPDATE public.checks
  SET status=next_status,
      cashbox_id=COALESCE(target_box, cashbox_id),
      return_reason=note,
      return_date=dt,
      bounced_at=(dt::text || 'T12:00:00Z')::timestamptz,
      updated_at=now()
  WHERE id=ch.id;
 ELSE
  -- return_to_customer
  IF ch.customer_id IS NOT NULL THEN
   INSERT INTO public.customer_ledger(store_id,customer_id,type,date,description,debit,credit,balance,reference_id,reference_type,created_by) VALUES(p_store_id,ch.customer_id,'adjustment',dt,descr,amt,0,coalesce(cust.balance,0)+amt,oid,'check_operation',actor);
   UPDATE public.customers SET balance=coalesce(balance,0)+amt,total_paid=coalesce(total_paid,0)-amt WHERE id=ch.customer_id;
  END IF;
  IF ch.receipt_invoice_id IS NOT NULL THEN UPDATE public.invoices SET amount_paid=inv.amount_paid-amt,status=CASE WHEN inv.amount_paid-amt=0 THEN 'sent' ELSE 'partial' END,paid_at=NULL WHERE id=ch.receipt_invoice_id;END IF;
 END IF;

 INSERT INTO public.check_operations(id,store_id,check_id,operation_type,from_status,to_status,operation_date,target_bank_account_id,target_cashbox_id,journal_entry_id,notes,performed_by,receipt_request_id,receipt_request_payload)
 VALUES(oid,p_store_id,ch.id,op,ch.status,next_status,dt,target_bank,target_box,jid,note,actor,p_request_id,p_payload);

 IF op NOT IN ('bounce', 'return') THEN
  UPDATE public.checks SET status=next_status,deposit_bank_account_id=CASE WHEN op='collect' THEN target_bank ELSE deposit_bank_account_id END,receipt_settlement_active=CASE WHEN op='return_to_customer' THEN false ELSE true END,updated_at=now() WHERE id=ch.id;
 END IF;

 INSERT INTO public.financial_audit_log(store_id,entity_type,entity_id,entity_label,action,actor_id,details) VALUES(p_store_id,'check',ch.id,ch.check_number,'status_change',actor,jsonb_build_object('requestId',p_request_id,'operationId',oid,'operation',op,'journalId',jid,'amount',amt,'invoiceId',ch.receipt_invoice_id,'atomic',true));
 RETURN jsonb_build_object('success',true,'replayed',false,'operationId',oid,'journalEntryId',jid,'newStatus',next_status);
END $$;
REVOKE ALL ON FUNCTION public.receipt_cheque_operation_atomic(uuid,uuid,uuid,jsonb,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.receipt_cheque_operation_atomic(uuid,uuid,uuid,jsonb,boolean) TO authenticated;

-- 7. Update execute_check_lifecycle_operation router
CREATE OR REPLACE FUNCTION public.execute_check_lifecycle_operation(p_check_id uuid, p_op_type text, p_date date, p_target_bank_id uuid DEFAULT NULL::uuid, p_target_cashbox_id uuid DEFAULT NULL::uuid, p_target_supplier_id uuid DEFAULT NULL::uuid, p_notes text DEFAULT NULL::text, p_actor_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE linked boolean; sid uuid; payment_link uuid; req_id uuid:=gen_random_uuid(); payload jsonb;
BEGIN
 SELECT receipt_settlement_active,store_id,payment_voucher_id INTO linked,sid,payment_link FROM public.checks WHERE id=p_check_id;
 IF auth.uid() IS NULL OR sid IS NULL OR NOT (EXISTS(SELECT 1 FROM public.stores WHERE id=sid AND owner_id=auth.uid()) OR EXISTS(SELECT 1 FROM public.store_members WHERE store_id=sid AND profile_id=auth.uid() AND is_active)) THEN RAISE EXCEPTION 'غير مصرح بعملية الشيك';END IF;
 IF payment_link IS NOT NULL THEN RAISE EXCEPTION 'شيك صرف ذري؛ يلزم مسار تسديد أو عكس مرتبط مستقل';END IF;
 
 IF linked IS NOT NULL THEN
  payload := jsonb_build_object(
    'operationType', p_op_type,
    'operationDate', p_date,
    'targetBankAccountId', p_target_bank_id,
    'targetCashBoxId', p_target_cashbox_id,
    'targetSupplierId', p_target_supplier_id,
    'notes', p_notes
  );
  RETURN public.receipt_cheque_operation_atomic(sid, p_check_id, req_id, payload, true);
 END IF;

 RETURN public.execute_check_lifecycle_operation_legacy(p_check_id,p_op_type,p_date,p_target_bank_id,p_target_cashbox_id,p_target_supplier_id,p_notes,auth.uid());
END $function$;

COMMIT;
