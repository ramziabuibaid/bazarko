-- Migration 071: Fix Cashbox Transfers & Cheque Lifecycle
-- 1. Support transfer_cashbox in execute_check_lifecycle_operation_legacy
-- 2. Fix cashed_date / collected_at / bounced_at missing column references
-- 3. Enhance receipt_cheque_operation_atomic & guard_atomic_receipt_cheque for cashbox transfers
-- 4. Provide transfer_cash_between_boxes_atomic for atomic cash transfers between cashboxes

BEGIN;

-- 0. Update journal_entries_source_check to include 'transfer'
ALTER TABLE public.journal_entries DROP CONSTRAINT IF EXISTS journal_entries_source_check;
ALTER TABLE public.journal_entries ADD CONSTRAINT journal_entries_source_check 
  CHECK (source = ANY (ARRAY['manual'::text, 'invoice'::text, 'purchase'::text, 'sales_return'::text, 'purchase_return'::text, 'voucher'::text, 'check_op'::text, 'opening'::text, 'closing'::text, 'system'::text, 'transfer'::text]));

-- 1. Update guard_atomic_receipt_cheque to cleanly support transfer_cashbox without requiring journal_entry_id when accounts match
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
   OLD.status NOT IN ('in_portfolio', 'deposited') OR OLD.receipt_settlement_active IS DISTINCT FROM true OR
   NOT EXISTS(SELECT 1 FROM public.check_operations WHERE check_id=OLD.id AND receipt_request_id IS NOT NULL AND from_status=OLD.status AND to_status=NEW.status AND ((journal_entry_id IS NOT NULL) OR (operation_type='transfer_cashbox')) AND ((operation_type='collect' AND NEW.status='collected' AND NEW.receipt_settlement_active IS TRUE AND target_bank_account_id IS NOT DISTINCT FROM NEW.deposit_bank_account_id) OR (operation_type='deposit' AND NEW.status='deposited' AND NEW.receipt_settlement_active IS TRUE AND target_bank_account_id IS NOT DISTINCT FROM NEW.deposit_bank_account_id) OR (operation_type='transfer_cashbox' AND NEW.status=OLD.status AND NEW.receipt_settlement_active IS TRUE) OR (operation_type IN ('bounce', 'return') AND NEW.status IN ('bounced', 'returned') AND NEW.receipt_settlement_active IS TRUE) OR (operation_type='return_to_customer' AND NEW.status='returned_to_customer' AND NEW.receipt_settlement_active IS FALSE AND NEW.deposit_bank_account_id IS NOT DISTINCT FROM OLD.deposit_bank_account_id))) THEN RAISE EXCEPTION 'استخدم التحصيل أو الإيداع أو الإعادة الذريين للشيك المرتبط';END IF;
 END IF;
 RETURN NEW;
END $function$;

-- 2. Enhanced receipt_cheque_operation_atomic (removes bounced_at, fixes accounting rule for transfer_cashbox, inserts operation before check update)
CREATE OR REPLACE FUNCTION public.receipt_cheque_operation_atomic(
  p_store_id uuid,
  p_check_id uuid,
  p_request_id uuid,
  p_payload jsonb,
  p_execute boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
 actor uuid:=auth.uid();
 old RECORD;
 ch RECORD;
 v RECORD;
 cust RECORD;
 inv RECORD;
 box RECORD;
 bank RECORD;
 ret_box RECORD;
 debit_acc RECORD;
 credit_acc RECORD;
 coll_acc RECORD;
 dt date;
 op text;
 note text;
 amt numeric;
 curr text;
 credit_id uuid;
 debit_id uuid;
 target_box uuid;
 target_bank uuid;
 next_status text;
 descr text;
 jid uuid;
 oid uuid:=gen_random_uuid();
 result jsonb;
BEGIN
 IF p_store_id IS NULL OR p_check_id IS NULL THEN RAISE EXCEPTION 'معرفات العملية مطلوبة';END IF;
 IF actor IS NULL OR NOT (EXISTS(SELECT 1 FROM public.stores WHERE id=p_store_id AND owner_id=actor) OR EXISTS(SELECT 1 FROM public.store_members WHERE store_id=p_store_id AND profile_id=actor AND is_active)) THEN RAISE EXCEPTION 'غير مصرح';END IF;
 IF p_request_id IS NULL OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' OR p_execute IS NULL THEN RAISE EXCEPTION 'طلب العملية غير صحيح';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_store_id::text,54001));

 SELECT * INTO old FROM public.check_operations WHERE store_id=p_store_id AND receipt_request_id=p_request_id;
 IF FOUND THEN
  IF old.check_id IS DISTINCT FROM p_check_id OR old.receipt_request_payload IS DISTINCT FROM p_payload THEN RAISE EXCEPTION 'معرف العملية سبق استخدامه ببيانات مختلفة';END IF;
  RETURN jsonb_build_object('success',true,'replayed',true,'operationId',old.id,'journalEntryId',old.journal_entry_id,'newStatus',old.to_status);
 END IF;

 SELECT * INTO ch FROM public.checks WHERE id=p_check_id AND store_id=p_store_id FOR UPDATE;
 IF NOT FOUND OR ch.receipt_settlement_active IS NULL OR ch.type<>'received' THEN RAISE EXCEPTION 'اختر شيك قبض مرتبطاً من هذا المتجر';END IF;
 IF ch.status NOT IN ('in_portfolio', 'deposited') OR NOT ch.receipt_settlement_active THEN RAISE EXCEPTION 'العملية متاحة فقط لشيك نشط في المحفظة أو برسم التحصيل';END IF;

 op:=p_payload->>'operationType';
 IF op IS NULL OR op NOT IN ('collect','return_to_customer','bounce','return','deposit','transfer_cashbox') THEN RAISE EXCEPTION 'نوع العملية غير مدعوم للشيك المرتبط: %', op;END IF;
 IF coalesce(p_payload->>'operationDate','') !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'تاريخ العملية مطلوب';END IF;
 dt:=(p_payload->>'operationDate')::date;
 note:=nullif(btrim(p_payload->>'notes'),'');IF length(note)>1000 THEN RAISE EXCEPTION 'الملاحظة تتجاوز الحد';END IF;
 IF nullif(p_payload->>'targetSupplierId','') IS NOT NULL THEN RAISE EXCEPTION 'العملية لا ترتبط بمورد';END IF;

 SELECT * INTO v FROM public.vouchers WHERE id=ch.voucher_id AND store_id=p_store_id;
 IF NOT FOUND OR v.type<>'receipt' OR v.creation_request_id IS NULL OR v.journal_entry_id IS NULL OR v.customer_id IS DISTINCT FROM ch.customer_id THEN RAISE EXCEPTION 'ربط سند الشيك يحتاج مراجعة';END IF;
 IF dt<v.date OR dt<ch.issue_date THEN RAISE EXCEPTION 'تاريخ العملية لا يسبق استلام الشيك';END IF;

 PERFORM 1 FROM public.accounting_periods WHERE store_id=p_store_id FOR SHARE;
 IF EXISTS(SELECT 1 FROM public.accounting_periods WHERE store_id=p_store_id AND is_closed AND dt BETWEEN start_date AND end_date) THEN RAISE EXCEPTION 'تاريخ العملية ضمن فترة مقفلة';END IF;

 SELECT coalesce(currency_code,'ILS') INTO curr FROM public.stores WHERE id=p_store_id;
 amt:=ch.amount;
 IF amt IS NULL OR amt::text IN ('NaN','Infinity','-Infinity') OR amt<=0 OR ch.currency IS DISTINCT FROM curr OR ch.exchange_rate IS DISTINCT FROM 1::numeric THEN RAISE EXCEPTION 'قيمة أو عملة الشيك تحتاج مراجعة';END IF;

 credit_id:=ch.receipt_portfolio_account_id;
 target_box:=nullif(p_payload->>'targetCashBoxId','')::uuid;
 target_bank:=nullif(p_payload->>'targetBankAccountId','')::uuid;

 IF op='collect' THEN
  IF (target_box IS NULL)=(target_bank IS NULL) THEN RAISE EXCEPTION 'اختر صندوقاً نقدياً أو حساباً بنكياً واحداً';END IF;
  IF target_box IS NOT NULL THEN
   SELECT * INTO box FROM public.cash_boxes WHERE id=target_box AND store_id=p_store_id AND is_active AND type='cash' FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'الصندوق النقدي غير متاح';END IF;debit_id:=box.account_id;
  ELSE
   SELECT * INTO bank FROM public.bank_accounts WHERE id=target_bank AND store_id=p_store_id AND is_active AND currency=curr FOR UPDATE;
   IF NOT FOUND OR coalesce(bank.balance,0)::text IN ('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'الحساب البنكي أو عملته غير صالح';END IF;debit_id:=bank.account_id;
  END IF;
  IF ch.status = 'deposited' THEN
   SELECT id INTO credit_id FROM public.accounts WHERE store_id=p_store_id AND (account_tag='CHECKS_UNDER_COLLECTION' OR code='1320') AND is_active LIMIT 1;
   IF credit_id IS NULL THEN credit_id:=ch.receipt_portfolio_account_id; END IF;
  END IF;
  next_status:='collected';descr:='تحصيل شيك #'||ch.check_number||' دون تسوية ثانية للذمة';

 ELSIF op='deposit' THEN
  -- Deposit for collection in bank
  IF target_bank IS NULL THEN RAISE EXCEPTION 'يجب تحديد الحساب البنكي للإيداع برسم التحصيل'; END IF;
  SELECT * INTO bank FROM public.bank_accounts WHERE id=target_bank AND store_id=p_store_id AND is_active FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'الحساب البنكي غير موجود أو غير نشط'; END IF;

  SELECT id INTO debit_id FROM public.accounts WHERE store_id=p_store_id AND (account_tag='CHECKS_UNDER_COLLECTION' OR code='1320') AND is_active LIMIT 1;
  IF debit_id IS NULL THEN
   INSERT INTO public.accounts(store_id,code,name,type,normal_balance,is_active,is_system,balance,account_tag)
   VALUES(p_store_id,'1320','شيكات برسم التحصيل','asset','debit',true,true,0,'CHECKS_UNDER_COLLECTION') RETURNING id INTO debit_id;
  END IF;

  credit_id:=ch.receipt_portfolio_account_id;
  next_status:='deposited';
  descr:='إيداع شيك #'||ch.check_number||' برسم التحصيل لدى '||bank.bank_name;

 ELSIF op='transfer_cashbox' THEN
  -- Internal transfer between cashboxes/portfolios
  IF target_box IS NULL THEN RAISE EXCEPTION 'يجب تحديد صندوق الترحيل المستلم'; END IF;
  IF ch.cashbox_id IS NOT DISTINCT FROM target_box THEN RAISE EXCEPTION 'لا يمكن التحويل إلى نفس الصندوق الحالي للشيك'; END IF;
  SELECT * INTO box FROM public.cash_boxes WHERE id=target_box AND store_id=p_store_id AND is_active AND type<>'checks_returned' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'صندوق الترحيل المحدد غير صالح أو مغلق'; END IF;

  debit_id:=box.account_id;
  IF debit_id IS NULL THEN debit_id:=ch.receipt_portfolio_account_id; END IF;
  IF ch.cashbox_id IS NOT NULL THEN
    SELECT account_id INTO credit_id FROM public.cash_boxes WHERE id=ch.cashbox_id;
  END IF;
  IF credit_id IS NULL THEN credit_id:=ch.receipt_portfolio_account_id; END IF;
  next_status:=ch.status;
  descr:='ترحيل شيك #'||ch.check_number||' إلى '||box.name;

 ELSIF op IN ('bounce', 'return') THEN
  -- Operation: Bounce/Return to Returned Cheques Box
  IF target_box IS NOT NULL THEN
   SELECT * INTO ret_box FROM public.cash_boxes WHERE id=target_box AND store_id=p_store_id AND is_active AND type='checks_returned' FOR UPDATE;
  ELSE
   SELECT * INTO ret_box FROM public.cash_boxes WHERE store_id=p_store_id AND is_active AND type='checks_returned' LIMIT 1 FOR UPDATE;
  END IF;

  IF ret_box.id IS NULL THEN
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

  IF ch.status = 'deposited' THEN
   SELECT id INTO credit_id FROM public.accounts WHERE store_id=p_store_id AND (account_tag='CHECKS_UNDER_COLLECTION' OR code='1320') AND is_active LIMIT 1;
   IF credit_id IS NULL THEN credit_id:=ch.receipt_portfolio_account_id; END IF;
  ELSE
   credit_id:=ch.receipt_portfolio_account_id;
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
 SELECT * INTO credit_acc FROM public.accounts WHERE id=credit_id AND store_id=p_store_id AND is_active AND NOT is_group;
 IF NOT FOUND OR coalesce(credit_acc.balance,0)::text IN ('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'حساب المحفظة غير صالح';END IF;

 result:=jsonb_build_object('success',true,'preview',jsonb_build_object('debitAccountName',debit_acc.name,'debitAccountCode',debit_acc.code,'creditAccountName',credit_acc.name,'creditAccountCode',credit_acc.code,'amount',amt,'currency',curr,'date',dt,'description',descr,'operationType',op,'fromStatus',ch.status,'toStatus',next_status));
 IF NOT p_execute THEN RETURN result;END IF;

 IF debit_id IS DISTINCT FROM credit_id THEN
  INSERT INTO public.journal_entries(store_id,entry_number,date,description,source,ref_id,source_type,source_id,source_number,source_url,accounting_rule,source_module,status,created_by)
  VALUES(p_store_id,'JV-CHK-'||oid::text,dt,descr,'check_op',ch.id,'check_operation',ch.id,ch.check_number,'/dashboard/cheques',
    CASE 
      WHEN op='collect' THEN 'CHECK_COLLECTED' 
      WHEN op='deposit' THEN 'CHECK_DEPOSITED_FOR_COLLECTION' 
      WHEN op IN ('bounce','return') THEN 'CHECK_BOUNCED' 
      WHEN op='transfer_cashbox' THEN 'CHECK_TRANSFERRED_CASHBOX'
      ELSE 'CHECK_RETURNED_TO_CUSTOMER' 
    END,
    'CHEQUES','posted',actor) RETURNING id INTO jid;
  INSERT INTO public.journal_lines(journal_entry_id,account_id,debit,credit,currency,description,sort_order,source_rule)
  VALUES(jid,debit_id,amt,0,curr,descr,1,'RECEIPT_CHEQUE_LIFECYCLE'),(jid,credit_id,0,amt,curr,descr,2,'RECEIPT_CHEQUE_LIFECYCLE');
  UPDATE public.accounts SET balance=coalesce(balance,0)+CASE WHEN normal_balance='debit' THEN amt ELSE -amt END WHERE id=debit_id;
  UPDATE public.accounts SET balance=coalesce(balance,0)-amt WHERE id=credit_id;
 END IF;

 -- Insert check operation record BEFORE updating check metadata to ensure guard trigger passes
 INSERT INTO public.check_operations(id,store_id,check_id,operation_type,from_status,to_status,operation_date,target_bank_account_id,target_cashbox_id,journal_entry_id,notes,performed_by,receipt_request_id,receipt_request_payload)
 VALUES(oid,p_store_id,ch.id,op,ch.status,next_status,dt,target_bank,target_box,jid,note,actor,p_request_id,p_payload);

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
      updated_at=now()
  WHERE id=ch.id;
 ELSIF op='deposit' THEN
  UPDATE public.checks
  SET status=next_status,
      deposit_bank_account_id=target_bank,
      updated_at=now()
  WHERE id=ch.id;
 ELSIF op='transfer_cashbox' THEN
  UPDATE public.checks
  SET cashbox_id=target_box,
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

 IF op NOT IN ('bounce', 'return', 'deposit', 'transfer_cashbox') THEN
  UPDATE public.checks SET status=next_status,deposit_bank_account_id=CASE WHEN op='collect' THEN target_bank ELSE deposit_bank_account_id END,receipt_settlement_active=CASE WHEN op='return_to_customer' THEN false ELSE true END,updated_at=now() WHERE id=ch.id;
 END IF;

 INSERT INTO public.financial_audit_log(store_id,entity_type,entity_id,entity_label,action,actor_id,details) VALUES(p_store_id,'check',ch.id,ch.check_number,'status_change',actor,jsonb_build_object('requestId',p_request_id,'operationId',oid,'operation',op,'journalId',jid,'amount',amt,'invoiceId',ch.receipt_invoice_id,'atomic',true));
 RETURN jsonb_build_object('success',true,'replayed',false,'operationId',oid,'journalEntryId',jid,'newStatus',next_status);
END $$;

-- 3. Update execute_check_lifecycle_operation_legacy
-- - Adds full transfer_cashbox support
-- - Removes references to non-existent columns cashed_date, collected_at, bounced_at
CREATE OR REPLACE FUNCTION public.execute_check_lifecycle_operation_legacy(
  p_check_id uuid,
  p_op_type text,
  p_date date,
  p_target_bank_id uuid DEFAULT NULL::uuid,
  p_target_cashbox_id uuid DEFAULT NULL::uuid,
  p_target_supplier_id uuid DEFAULT NULL::uuid,
  p_notes text DEFAULT NULL::text,
  p_actor_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
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
  v_target_cashbox UUID := p_target_cashbox_id;
  v_target_box RECORD;
  v_ret_box UUID;
BEGIN
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

  IF EXISTS (
    SELECT 1 FROM public.accounting_periods
    WHERE store_id = v_check.store_id
      AND is_closed = TRUE
      AND p_date BETWEEN start_date AND end_date
  ) THEN
    RAISE EXCEPTION 'لا يمكن تنفيذ العملية: التاريخ يقع ضمن فترة محاسبية مقفلة';
  END IF;

  -- 1. حساب محفظة الشيكات الواردة
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

  -- 2. حساب شيكات برسم التحصيل
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

  -- 3. حساب محفظة الشيكات المرتجعة
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

  -- 4. حساب ذمم العملاء
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

  -- 5. حساب ذمم الموردين
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

  -- Operations branching
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

  ELSIF p_op_type = 'bounce' OR p_op_type = 'return' THEN
    v_next_status := 'bounced';
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

    -- Lookup returned cash box if not provided
    IF v_target_cashbox IS NULL THEN
      SELECT id INTO v_ret_box FROM public.cash_boxes WHERE store_id = v_check.store_id AND type = 'checks_returned' AND is_active LIMIT 1;
      v_target_cashbox := v_ret_box;
    END IF;

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
    v_next_status := 'returned_to_customer';
    v_accounting_rule := 'CHECK_RETURNED_TO_CUSTOMER';
    v_debit_acc_id := v_customer_acc_id;
    v_debit_tag := 'CUSTOMER_RECEIVABLE';
    IF v_check.status IN ('returned', 'bounced') THEN
      v_credit_acc_id := v_returned_acc_id;
      v_credit_tag := 'CHECKS_BOUNCED';
    ELSE
      v_credit_acc_id := v_portfolio_acc_id;
      v_credit_tag := 'CHEQUES_IN_HAND';
    END IF;
    v_op_desc := 'إرجاع شيك للعميل وإعادة ترصيده رقم #' || v_check.check_number;

  ELSIF p_op_type = 'transfer_cashbox' THEN
    IF p_target_cashbox_id IS NULL THEN
      RAISE EXCEPTION 'يجب تحديد الصندوق المحول إليه الشيك';
    END IF;

    IF v_check.cashbox_id IS NOT DISTINCT FROM p_target_cashbox_id THEN
      RAISE EXCEPTION 'لا يمكن التحويل إلى نفس الصندوق الحالي للشيك';
    END IF;

    SELECT * INTO v_target_box
    FROM public.cash_boxes
    WHERE id = p_target_cashbox_id AND store_id = v_check.store_id AND is_active = TRUE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'صندوق الترحيل المحدد غير صالح أو مغلق';
    END IF;

    IF v_target_box.type = 'checks_returned' THEN
      RAISE EXCEPTION 'لا يمكن نقل الشيك النشط إلى صندوق الشيكات الراجعة؛ استخدم خيار الارتداد';
    END IF;

    v_next_status := v_check.status;
    v_target_cashbox := p_target_cashbox_id;
    v_accounting_rule := 'CHECK_TRANSFERRED_CASHBOX';
    v_op_desc := 'ترحيل شيك رقم #' || v_check.check_number || ' إلى ' || v_target_box.name;

    -- Debit account: Target box account or portfolio fallback
    v_debit_acc_id := v_target_box.account_id;
    IF v_debit_acc_id IS NULL THEN
      v_debit_acc_id := v_portfolio_acc_id;
    END IF;
    v_debit_tag := 'CHEQUES_IN_HAND';

    -- Credit account: Source box account or portfolio fallback
    IF v_check.cashbox_id IS NOT NULL THEN
      SELECT account_id INTO v_credit_acc_id FROM public.cash_boxes WHERE id = v_check.cashbox_id;
    END IF;
    IF v_credit_acc_id IS NULL THEN
      v_credit_acc_id := v_portfolio_acc_id;
    END IF;
    v_credit_tag := 'CHEQUES_IN_HAND';

  ELSE
    RAISE EXCEPTION 'نوع العملية غير مدعوم: %', p_op_type;
  END IF;

  -- Create balanced journal entry if debit and credit accounts differ
  IF v_debit_acc_id IS NOT NULL AND v_credit_acc_id IS NOT NULL AND v_debit_acc_id IS DISTINCT FROM v_credit_acc_id THEN
    v_entry_num := 'JV-CHK-' || TO_CHAR(p_date, 'YYYYMMDD') || '-' || SUBSTRING(gen_random_uuid()::text, 1, 8);

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
  END IF;

  -- Update checks table (without non-existent columns cashed_date, collected_at, bounced_at)
  UPDATE public.checks
  SET status = v_next_status,
      deposit_bank_account_id = COALESCE(p_target_bank_id, deposit_bank_account_id),
      cashbox_id = CASE WHEN p_op_type IN ('bounce', 'return', 'transfer_cashbox') THEN COALESCE(v_target_cashbox, cashbox_id) ELSE cashbox_id END,
      return_reason = CASE WHEN p_op_type IN ('bounce', 'return') THEN COALESCE(p_notes, return_reason) ELSE return_reason END,
      return_date = CASE WHEN p_op_type IN ('bounce', 'return') THEN p_date ELSE return_date END,
      notes = COALESCE(p_notes, notes),
      updated_at = NOW()
  WHERE id = p_check_id;

  INSERT INTO public.check_operations (
    check_id, store_id, operation_type, operation_date,
    from_status, to_status, target_bank_account_id, target_cashbox_id,
    target_supplier_id, journal_entry_id, notes, performed_by
  ) VALUES (
    p_check_id, v_check.store_id, p_op_type, p_date,
    v_check.status, v_next_status, p_target_bank_id, v_target_cashbox,
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

-- 4. Atomic General Cash Transfer between Cashboxes (تحويل النقد بين الصناديق والخزائن)
CREATE OR REPLACE FUNCTION public.transfer_cash_between_boxes_atomic(
  p_store_id uuid,
  p_request_id uuid,
  p_from_box_id uuid,
  p_to_box_id uuid,
  p_amount numeric,
  p_date date DEFAULT CURRENT_DATE,
  p_notes text DEFAULT NULL,
  p_actor_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  v_actor uuid := COALESCE(p_actor_id, auth.uid());
  v_from_box RECORD;
  v_to_box RECORD;
  v_from_acc_id uuid;
  v_to_acc_id uuid;
  v_from_acc RECORD;
  v_to_acc RECORD;
  v_currency text;
  v_entry_id uuid;
  v_entry_num text;
  v_desc text;
  v_existing_entry RECORD;
  v_mov_out_id uuid;
  v_mov_in_id uuid;
BEGIN
  -- 1. Validation & Permissions
  IF p_store_id IS NULL OR p_from_box_id IS NULL OR p_to_box_id IS NULL OR p_request_id IS NULL THEN
    RAISE EXCEPTION 'معرفات العملية والصناديق مطلوبة بالكامل';
  END IF;

  IF v_actor IS NULL OR NOT (
    EXISTS(SELECT 1 FROM public.stores WHERE id = p_store_id AND owner_id = v_actor) OR
    EXISTS(SELECT 1 FROM public.store_members WHERE store_id = p_store_id AND profile_id = v_actor AND is_active)
  ) THEN
    RAISE EXCEPTION 'غير مصرح بتنفيذ عمليات التحويل في هذا المتجر';
  END IF;

  IF p_from_box_id = p_to_box_id THEN
    RAISE EXCEPTION 'لا يمكن تحويل الأموال إلى نفس الصندوق المصدر';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 OR p_amount::text IN ('NaN', 'Infinity', '-Infinity') THEN
    RAISE EXCEPTION 'مبلغ التحويل يجب أن يكون قيمة موجبة صحيحة أكبر من الصفر';
  END IF;

  IF p_date IS NULL THEN
    p_date := CURRENT_DATE;
  END IF;

  -- 2. Concurrency advisory lock per store to prevent race conditions
  PERFORM pg_advisory_xact_lock(hashtextextended(p_store_id::text, 54002));

  -- 3. Idempotency Check: if request already succeeded, return existing result
  SELECT id, entry_number INTO v_existing_entry
  FROM public.journal_entries
  WHERE store_id = p_store_id AND ref_id = p_request_id AND source = 'transfer';

  IF FOUND THEN
    RETURN jsonb_build_object(
      'success', true,
      'replayed', true,
      'journalEntryId', v_existing_entry.id,
      'entryNumber', v_existing_entry.entry_number
    );
  END IF;

  -- 4. Check Closed Accounting Periods
  IF EXISTS (
    SELECT 1 FROM public.accounting_periods
    WHERE store_id = p_store_id AND is_closed = TRUE AND p_date BETWEEN start_date AND end_date
  ) THEN
    RAISE EXCEPTION 'لا يمكن إجراء التحويل: تاريخ العملية يقع ضمن فترة محاسبية مقفلة';
  END IF;

  -- 5. Lock Cashboxes in deterministic order to prevent deadlocks
  IF p_from_box_id < p_to_box_id THEN
    SELECT * INTO v_from_box FROM public.cash_boxes WHERE id = p_from_box_id AND store_id = p_store_id AND is_active FOR UPDATE;
    SELECT * INTO v_to_box FROM public.cash_boxes WHERE id = p_to_box_id AND store_id = p_store_id AND is_active FOR UPDATE;
  ELSE
    SELECT * INTO v_to_box FROM public.cash_boxes WHERE id = p_to_box_id AND store_id = p_store_id AND is_active FOR UPDATE;
    SELECT * INTO v_from_box FROM public.cash_boxes WHERE id = p_from_box_id AND store_id = p_store_id AND is_active FOR UPDATE;
  END IF;

  IF v_from_box.id IS NULL THEN
    RAISE EXCEPTION 'الصندوق المصدر المحول منه غير موجود أو غير نشط';
  END IF;
  IF v_to_box.id IS NULL THEN
    RAISE EXCEPTION 'الصندوق المستلم المحول إليه غير موجود أو غير نشط';
  END IF;

  -- Validate box types
  IF v_from_box.type IN ('checks_returned', 'checks_received') OR v_to_box.type IN ('checks_returned', 'checks_received') THEN
    RAISE EXCEPTION 'تحويل النقد متاح فقط للصناديق النقدية والخزائن وليس لمحفظة الشيكات';
  END IF;

  -- 6. Resolve & Lock Ledger Accounts
  v_from_acc_id := v_from_box.account_id;
  v_to_acc_id := v_to_box.account_id;

  IF v_from_acc_id IS NULL THEN
    SELECT id INTO v_from_acc_id FROM public.accounts WHERE store_id = p_store_id AND (account_tag = 'CASH' OR code = '1100') AND is_active LIMIT 1;
  END IF;
  IF v_to_acc_id IS NULL THEN
    SELECT id INTO v_to_acc_id FROM public.accounts WHERE store_id = p_store_id AND (account_tag = 'CASH' OR code = '1100') AND is_active LIMIT 1;
  END IF;

  IF v_from_acc_id IS NULL OR v_to_acc_id IS NULL THEN
    RAISE EXCEPTION 'الحسابات المحاسبية المرتبطة بالصناديق غير متوفرة';
  END IF;

  IF v_from_acc_id = v_to_acc_id THEN
    RAISE EXCEPTION 'الصندوقان يشتركان في نفس الحساب المحاسبي؛ يجب ربط كل صندوق بحسابه الخاص في دفتر الأستاذ';
  END IF;

  -- Lock accounts in deterministic order
  IF v_from_acc_id < v_to_acc_id THEN
    SELECT * INTO v_from_acc FROM public.accounts WHERE id = v_from_acc_id AND store_id = p_store_id FOR UPDATE;
    SELECT * INTO v_to_acc FROM public.accounts WHERE id = v_to_acc_id AND store_id = p_store_id FOR UPDATE;
  ELSE
    SELECT * INTO v_to_acc FROM public.accounts WHERE id = v_to_acc_id AND store_id = p_store_id FOR UPDATE;
    SELECT * INTO v_from_acc FROM public.accounts WHERE id = v_from_acc_id AND store_id = p_store_id FOR UPDATE;
  END IF;

  SELECT COALESCE(currency_code, 'ILS') INTO v_currency FROM public.stores WHERE id = p_store_id;

  -- 7. Double-Entry Accounting Journal Entry
  -- Entry format: Debit To-Box, Credit From-Box
  v_entry_num := 'JV-TRF-' || TO_CHAR(p_date, 'YYYYMMDD') || '-' || SUBSTRING(p_request_id::text, 1, 6);
  v_desc := 'تحويل نقدية من ' || v_from_box.name || ' إلى ' || v_to_box.name || COALESCE(' — ' || NULLIF(TRIM(p_notes), ''), '');

  INSERT INTO public.journal_entries (
    store_id, entry_number, date, description,
    source, ref_id, source_type, source_id, source_number, source_url,
    status, created_by, accounting_rule, source_module
  ) VALUES (
    p_store_id, v_entry_num, p_date, v_desc,
    'transfer', p_request_id, 'treasury_transfer', p_request_id, 'تحويل #' || SUBSTRING(p_request_id::text, 1, 8),
    '/dashboard/accounting/treasury',
    'posted', v_actor, 'TREASURY_TRANSFER', 'TREASURY'
  )
  RETURNING id INTO v_entry_id;

  -- Line 1: Debit Destination Box (زيادة في رصيد الصندوق المستلم)
  INSERT INTO public.journal_lines (
    journal_entry_id, account_id, debit, credit,
    currency, exchange_rate, original_debit, original_credit,
    description, sort_order, account_tag_used, source_rule
  ) VALUES (
    v_entry_id, v_to_acc_id, p_amount, 0,
    v_currency, 1.0, p_amount, 0,
    v_desc, 1, 'CASH', 'TREASURY_TRANSFER'
  );

  UPDATE public.accounts
  SET balance = balance + CASE WHEN normal_balance = 'debit' THEN p_amount ELSE -p_amount END,
      updated_at = NOW()
  WHERE id = v_to_acc_id;

  -- Line 2: Credit Source Box (نقص في رصيد الصندوق المصدر)
  INSERT INTO public.journal_lines (
    journal_entry_id, account_id, debit, credit,
    currency, exchange_rate, original_debit, original_credit,
    description, sort_order, account_tag_used, source_rule
  ) VALUES (
    v_entry_id, v_from_acc_id, 0, p_amount,
    v_currency, 1.0, 0, p_amount,
    v_desc, 2, 'CASH', 'TREASURY_TRANSFER'
  );

  UPDATE public.accounts
  SET balance = balance + CASE WHEN normal_balance = 'credit' THEN p_amount ELSE -p_amount END,
      updated_at = NOW()
  WHERE id = v_from_acc_id;

  -- 8. Record Twin Cash Movements in Treasury
  -- Outflow from Source Box
  INSERT INTO public.cash_movements (
    store_id, cash_box_id, direction, amount,
    source, ref_id, party_name, payment_method,
    description, date, created_by
  ) VALUES (
    p_store_id, p_from_box_id, 'out', p_amount,
    'transfer', v_entry_id, v_to_box.name, 'cash',
    v_desc, p_date, v_actor
  )
  RETURNING id INTO v_mov_out_id;

  -- Inflow to Destination Box
  INSERT INTO public.cash_movements (
    store_id, cash_box_id, direction, amount,
    source, ref_id, party_name, payment_method,
    description, date, created_by
  ) VALUES (
    p_store_id, p_to_box_id, 'in', p_amount,
    'transfer', v_entry_id, v_from_box.name, 'cash',
    v_desc, p_date, v_actor
  )
  RETURNING id INTO v_mov_in_id;

  -- 9. Audit Logging
  INSERT INTO public.financial_audit_log (
    store_id, entity_type, entity_id, entity_label,
    action, actor_id, details
  ) VALUES (
    p_store_id, 'cash_movement', v_mov_out_id, v_entry_num,
    'create', v_actor,
    jsonb_build_object(
      'requestId', p_request_id,
      'journalEntryId', v_entry_id,
      'fromBoxId', p_from_box_id,
      'fromBoxName', v_from_box.name,
      'toBoxId', p_to_box_id,
      'toBoxName', v_to_box.name,
      'amount', p_amount,
      'currency', v_currency,
      'date', p_date,
      'atomic', true
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'replayed', false,
    'journalEntryId', v_entry_id,
    'entryNumber', v_entry_num,
    'amount', p_amount,
    'fromBoxName', v_from_box.name,
    'toBoxName', v_to_box.name
  );
END;
$$;

-- Grant permissions on new function
GRANT EXECUTE ON FUNCTION public.transfer_cash_between_boxes_atomic(UUID, UUID, UUID, UUID, NUMERIC, DATE, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.transfer_cash_between_boxes_atomic(UUID, UUID, UUID, UUID, NUMERIC, DATE, TEXT, UUID) TO service_role;

COMMIT;
