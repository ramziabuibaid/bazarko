-- Migration 073: Support Bounced Cheque Return to Customer & Bank Balance Synchronization
-- 1. Updates receipt_cheque_operation_atomic to allow return_to_customer for bounced cheques
-- 2. Corrects credit account in return_to_customer when returning from bounced box (1330)
-- 3. Updates execute_check_lifecycle_operation_legacy to update bank_accounts.balance on collect
-- 4. Synchronizes bank_accounts.balance for store accounts to match verified ledger entries

BEGIN;

-- 1. Update receipt_cheque_operation_atomic
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
  supp RECORD;
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
  target_supp uuid;
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

  op:=p_payload->>'operationType';
  IF op IS NULL OR op NOT IN ('collect','return_to_customer','bounce','return','deposit','transfer_cashbox','endorse') THEN RAISE EXCEPTION 'نوع العملية غير مدعوم للشيك المرتبط: %', op;END IF;

  -- Operation-specific status validation
  IF op = 'return_to_customer' THEN
    IF ch.status NOT IN ('in_portfolio', 'transferred_for_collection', 'deposited', 'bounced') OR NOT ch.receipt_settlement_active THEN
      RAISE EXCEPTION 'إعادة الشيك للمصدر متاحة فقط لشيك نشط أو راجع مع تسوية قبض نشطة';
    END IF;
  ELSIF op IN ('deposit', 'transfer_cashbox', 'endorse') THEN
    IF ch.status NOT IN ('in_portfolio', 'transferred_for_collection') OR NOT ch.receipt_settlement_active THEN
      RAISE EXCEPTION 'العملية متاحة فقط لشيك نشط في المحفظة أو مرحل للتحصيل';
    END IF;
  ELSIF op IN ('collect', 'bounce', 'return') THEN
    IF ch.status NOT IN ('in_portfolio', 'transferred_for_collection', 'deposited') OR NOT ch.receipt_settlement_active THEN
      RAISE EXCEPTION 'العملية متاحة فقط لشيك نشط في المحفظة أو مرحل أو برسم التحصيل';
    END IF;
  END IF;

  IF coalesce(p_payload->>'operationDate','') !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'تاريخ العملية مطلوب';END IF;
  dt:=(p_payload->>'operationDate')::date;
  note:=nullif(btrim(p_payload->>'notes'),'');IF length(note)>1000 THEN RAISE EXCEPTION 'الملاحظة تتجاوز الحد';END IF;

  target_supp:=nullif(p_payload->>'targetSupplierId','')::uuid;
  IF op <> 'endorse' AND target_supp IS NOT NULL THEN RAISE EXCEPTION 'العملية لا ترتبط بمورد';END IF;
  IF op = 'endorse' AND target_supp IS NULL THEN RAISE EXCEPTION 'يجب تحديد المورد لتجيير الشيك لصالحه';END IF;

  SELECT * INTO v FROM public.vouchers WHERE id=ch.voucher_id AND store_id=p_store_id;
  IF NOT FOUND OR v.type<>'receipt' OR v.creation_request_id IS NULL OR v.journal_entry_id IS NULL OR v.customer_id IS DISTINCT FROM ch.customer_id THEN RAISE EXCEPTION 'ربط سند الشيك يحتاج مراجعة';END IF;
  IF dt<v.date OR dt<ch.issue_date THEN RAISE EXCEPTION 'تاريخ العملية لا يسبق استلام الشيك';END IF;

  PERFORM 1 FROM public.accounting_periods WHERE store_id=p_store_id FOR SHARE;
  IF EXISTS(SELECT 1 FROM public.accounting_periods WHERE store_id=p_store_id AND is_closed AND dt BETWEEN start_date AND end_date) THEN RAISE EXCEPTION 'تاريخ العملية ضمن فترة مقفلة';END IF;

  SELECT coalesce(currency_code,'ILS') INTO curr FROM public.stores WHERE id=p_store_id;
  amt:=ch.amount;
  IF amt IS NULL OR amt::text IN ('NaN','Infinity','-Infinity') OR amt<=0 OR ch.currency IS DISTINCT FROM curr OR ch.exchange_rate IS DISTINCT FROM 1::numeric THEN RAISE EXCEPTION 'قيمة أو عملة الشيك تحتاج مراجعة';END IF;

  -- Default dynamic credit account: use current holding cash box account if available, fallback to receipt portfolio
  IF ch.cashbox_id IS NOT NULL THEN
    SELECT account_id INTO credit_id FROM public.cash_boxes WHERE id=ch.cashbox_id;
  END IF;
  IF credit_id IS NULL THEN
    credit_id:=ch.receipt_portfolio_account_id;
  END IF;

  target_box:=nullif(p_payload->>'targetCashBoxId','')::uuid;
  target_bank:=nullif(p_payload->>'targetBankAccountId','')::uuid;

  IF op='collect' THEN
    IF (target_box IS NULL)=(target_bank IS NULL) THEN RAISE EXCEPTION 'اختر صندوقاً نقدياً أو حساباً بنكياً واحداً';END IF;
    IF target_box IS NOT NULL THEN
      SELECT * INTO box FROM public.cash_boxes WHERE id=target_box AND store_id=p_store_id AND is_active AND type='cash' FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'الصندوق النقدي غير متاح';END IF;
      debit_id:=box.account_id;
    ELSE
      SELECT * INTO bank FROM public.bank_accounts WHERE id=target_bank AND store_id=p_store_id AND is_active AND currency=curr FOR UPDATE;
      IF NOT FOUND OR coalesce(bank.balance,0)::text IN ('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'الحساب البنكي أو عملته غير صالح';END IF;
      debit_id:=bank.account_id;
    END IF;

    IF ch.status = 'deposited' THEN
      SELECT id INTO credit_id FROM public.accounts WHERE store_id=p_store_id AND (account_tag='CHECKS_UNDER_COLLECTION' OR code='1320') AND is_active LIMIT 1;
      IF credit_id IS NULL THEN credit_id:=ch.receipt_portfolio_account_id; END IF;
    END IF;
    next_status:='collected';
    descr:='تحصيل شيك #'||ch.check_number||' دون تسوية ثانية للذمة';

  ELSIF op='deposit' THEN
    IF target_bank IS NULL THEN RAISE EXCEPTION 'يجب تحديد الحساب البنكي للإيداع برسم التحصيل'; END IF;
    SELECT * INTO bank FROM public.bank_accounts WHERE id=target_bank AND store_id=p_store_id AND is_active FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'الحساب البنكي غير موجود أو غير نشط'; END IF;

    SELECT id INTO debit_id FROM public.accounts WHERE store_id=p_store_id AND (account_tag='CHECKS_UNDER_COLLECTION' OR code='1320') AND is_active LIMIT 1;
    IF debit_id IS NULL THEN
      INSERT INTO public.accounts(store_id,code,name,type,normal_balance,is_active,is_system,balance,account_tag)
      VALUES(p_store_id,'1320','شيكات برسم التحصيل','asset','debit',true,true,0,'CHECKS_UNDER_COLLECTION') RETURNING id INTO debit_id;
    END IF;

    next_status:='deposited';
    descr:='إيداع شيك #'||ch.check_number||' برسم التحصيل لدى '||bank.bank_name;

  ELSIF op='transfer_cashbox' THEN
    IF target_box IS NULL THEN RAISE EXCEPTION 'يجب تحديد صندوق الترحيل المستلم'; END IF;
    IF ch.cashbox_id IS NOT DISTINCT FROM target_box THEN RAISE EXCEPTION 'لا يمكن التحويل إلى نفس الصندوق الحالي للشيك'; END IF;
    SELECT * INTO box FROM public.cash_boxes WHERE id=target_box AND store_id=p_store_id AND is_active AND type IN ('checks_received', 'checks_collection') FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'صندوق الترحيل المحدد غير صالح أو مغلق؛ لا يمكن ترحيل الشيك إلا لمحافظ الشيكات وصناديق التحصيل (يُمنع الترحيل إلى الصناديق النقدية)'; END IF;

    debit_id:=box.account_id;
    IF debit_id IS NULL THEN debit_id:=ch.receipt_portfolio_account_id; END IF;

    IF box.type = 'checks_collection' THEN
      next_status:='transferred_for_collection';
    ELSE
      next_status:='in_portfolio';
    END IF;
    descr:='ترحيل شيك #'||ch.check_number||' إلى '||box.name;

  ELSIF op='endorse' THEN
    SELECT * INTO supp FROM public.suppliers WHERE id=target_supp AND store_id=p_store_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'المورد المحدد غير موجود أو غير نشط'; END IF;

    IF supp.account_id IS NOT NULL THEN
      debit_id := supp.account_id;
    ELSE
      SELECT id INTO debit_id FROM public.accounts WHERE store_id=p_store_id AND (code='2100' OR account_tag='SUPPLIER_PAYABLE') AND is_active LIMIT 1;
      IF debit_id IS NULL THEN
        SELECT id INTO debit_id FROM public.accounts WHERE store_id=p_store_id AND type='liability' AND is_active LIMIT 1;
      END IF;
    END IF;

    next_status:='endorsed';
    descr:='تجيير شيك #'||ch.check_number||' لصالح المورد '||supp.name;

  ELSIF op IN ('bounce', 'return') THEN
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
    END IF;

    next_status:='bounced';
    descr:='إرجاع شيك راجع رقم #'||ch.check_number||COALESCE(' — '||note, '');

  ELSE
    -- op = 'return_to_customer'
    IF target_box IS NOT NULL OR target_bank IS NOT NULL THEN RAISE EXCEPTION 'إعادة الشيك للعميل لا تنشئ حركة نقدية أو بنكية';END IF;
    debit_id:=ch.receipt_counter_account_id;
    IF debit_id IS NULL THEN
      SELECT id INTO debit_id FROM public.accounts WHERE store_id=p_store_id AND (code='1400' OR account_tag='CUSTOMER_RECEIVABLE') AND is_active LIMIT 1;
    END IF;

    -- Credit account: if bounced, credit the bounced cheques box (1330)
    IF ch.status = 'bounced' THEN
      IF ch.cashbox_id IS NOT NULL THEN
        SELECT account_id INTO credit_id FROM public.cash_boxes WHERE id=ch.cashbox_id;
      END IF;
      IF credit_id IS NULL THEN
        SELECT id INTO credit_id FROM public.accounts WHERE store_id=p_store_id AND (code='1330' OR account_tag='CHECKS_BOUNCED') AND is_active LIMIT 1;
      END IF;
    END IF;

    next_status:='returned_to_customer';
    descr:='إعادة شيك #'||ch.check_number||' وعكس تسوية القبض';

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
        WHEN op='endorse' THEN 'CHECK_ENDORSED_TO_SUPPLIER'
        ELSE 'CHECK_RETURNED_TO_CUSTOMER' 
      END,
      'CHEQUES','posted',actor) RETURNING id INTO jid;
    INSERT INTO public.journal_lines(journal_entry_id,account_id,debit,credit,currency,description,sort_order,source_rule)
    VALUES(jid,debit_id,amt,0,curr,descr,1,'RECEIPT_CHEQUE_LIFECYCLE'),(jid,credit_id,0,amt,curr,descr,2,'RECEIPT_CHEQUE_LIFECYCLE');
    UPDATE public.accounts SET balance=coalesce(balance,0)+CASE WHEN normal_balance='debit' THEN amt ELSE -amt END WHERE id=debit_id;
    UPDATE public.accounts SET balance=coalesce(balance,0)-amt WHERE id=credit_id;
  END IF;

  INSERT INTO public.check_operations(id,store_id,check_id,operation_type,from_status,to_status,operation_date,target_bank_account_id,target_cashbox_id,target_supplier_id,journal_entry_id,notes,performed_by,receipt_request_id,receipt_request_payload)
  VALUES(oid,p_store_id,ch.id,op,ch.status,next_status,dt,target_bank,target_box,target_supp,jid,note,actor,p_request_id,p_payload);

  IF op='collect' AND target_box IS NOT NULL THEN
    INSERT INTO public.cash_movements(store_id,cash_box_id,direction,amount,source,ref_id,party_name,payment_method,description,date,created_by) VALUES(p_store_id,target_box,'in',amt,'check_collect',ch.id,v.party_name,'cash',descr,dt,actor);
  ELSIF op='collect' THEN
    UPDATE public.bank_accounts SET balance=coalesce(balance,0)+amt, updated_at=now() WHERE id=target_bank;
  ELSIF op IN ('bounce', 'return') THEN
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
        status=next_status,
        updated_at=now()
    WHERE id=ch.id;
  ELSIF op='endorse' THEN
    UPDATE public.checks
    SET status=next_status,
        endorsed_supplier_id=target_supp,
        updated_at=now()
    WHERE id=ch.id;
    UPDATE public.suppliers
    SET balance=coalesce(balance,0)-amt
    WHERE id=target_supp;
  ELSE
    -- return_to_customer
    UPDATE public.checks
    SET status=next_status,
        receipt_settlement_active=false,
        updated_at=now()
    WHERE id=ch.id;

    IF ch.customer_id IS NOT NULL THEN
      INSERT INTO public.customer_ledger(store_id,customer_id,type,date,description,debit,credit,balance,reference_id,reference_type,created_by) VALUES(p_store_id,ch.customer_id,'adjustment',dt,descr,amt,0,coalesce(cust.balance,0)+amt,oid,'check_operation',actor);
      UPDATE public.customers SET balance=coalesce(balance,0)+amt,total_paid=coalesce(total_paid,0)-amt WHERE id=ch.customer_id;
    END IF;
    IF ch.receipt_invoice_id IS NOT NULL THEN UPDATE public.invoices SET amount_paid=inv.amount_paid-amt,status=CASE WHEN inv.amount_paid-amt=0 THEN 'sent' ELSE 'partial' END,paid_at=NULL WHERE id=ch.receipt_invoice_id;END IF;
  END IF;

  IF op NOT IN ('bounce', 'return', 'deposit', 'transfer_cashbox', 'endorse', 'return_to_customer') THEN
    UPDATE public.checks SET status=next_status,deposit_bank_account_id=CASE WHEN op='collect' THEN target_bank ELSE deposit_bank_account_id END,receipt_settlement_active=CASE WHEN op='return_to_customer' THEN false ELSE true END,updated_at=now() WHERE id=ch.id;
  END IF;

  INSERT INTO public.financial_audit_log(store_id,entity_type,entity_id,entity_label,action,actor_id,details) VALUES(p_store_id,'check',ch.id,ch.check_number,'status_change',actor,jsonb_build_object('requestId',p_request_id,'operationId',oid,'operation',op,'journalId',jid,'amount',amt,'invoiceId',ch.receipt_invoice_id,'atomic',true));
  RETURN jsonb_build_object('success',true,'replayed',false,'operationId',oid,'journalEntryId',jid,'newStatus',next_status);
END $$;

-- 2. Update execute_check_lifecycle_operation_legacy
CREATE OR REPLACE FUNCTION public.execute_check_lifecycle_operation_legacy(
  p_check_id uuid,
  p_op_type text,
  p_date date DEFAULT CURRENT_DATE,
  p_target_bank_id uuid DEFAULT NULL,
  p_target_cashbox_id uuid DEFAULT NULL,
  p_target_supplier_id uuid DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_actor_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_actor uuid := COALESCE(p_actor_id, auth.uid());
  v_check RECORD;
  v_store_curr text;
  v_portfolio_acc_id uuid;
  v_collection_acc_id uuid;
  v_returned_acc_id uuid;
  v_customer_acc_id uuid;
  v_supplier_acc_id uuid;
  v_debit_acc_id uuid;
  v_credit_acc_id uuid;
  v_debit_tag text;
  v_credit_tag text;
  v_next_status text;
  v_entry_id uuid;
  v_entry_num text;
  v_op_desc text;
  v_accounting_rule text;
  v_ret_box uuid;
  v_target_cashbox uuid := p_target_cashbox_id;
  v_target_bank RECORD;
  v_target_box RECORD;
  v_supplier RECORD;
BEGIN
  IF p_check_id IS NULL OR p_op_type IS NULL THEN
    RAISE EXCEPTION 'معرف الشيك ونوع العملية مطلوبان';
  END IF;

  IF p_date IS NULL THEN
    p_date := CURRENT_DATE;
  END IF;

  SELECT * INTO v_check
  FROM public.checks
  WHERE id = p_check_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'الشيك غير موجود';
  END IF;

  IF v_actor IS NULL OR NOT (
    EXISTS(SELECT 1 FROM public.stores WHERE id = v_check.store_id AND owner_id = v_actor) OR
    EXISTS(SELECT 1 FROM public.store_members WHERE store_id = v_check.store_id AND profile_id = v_actor AND is_active)
  ) THEN
    RAISE EXCEPTION 'غير مصرح بتنفيذ عمليات على هذا الشيك';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.accounting_periods
    WHERE store_id = v_check.store_id AND is_closed = TRUE AND p_date BETWEEN start_date AND end_date
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

  -- Dynamic source credit account based on current holding cashbox
  IF v_check.cashbox_id IS NOT NULL THEN
    SELECT account_id INTO v_credit_acc_id FROM public.cash_boxes WHERE id = v_check.cashbox_id;
  END IF;
  IF v_credit_acc_id IS NULL THEN
    v_credit_acc_id := v_portfolio_acc_id;
  END IF;

  -- Operations
  IF p_op_type = 'deposit' THEN
    IF p_target_bank_id IS NULL THEN
      RAISE EXCEPTION 'يجب تحديد الحساب البنكي للإيداع برسم التحصيل';
    END IF;

    SELECT * INTO v_target_bank
    FROM public.bank_accounts
    WHERE id = p_target_bank_id AND store_id = v_check.store_id AND is_active = TRUE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'الحساب البنكي المحدد غير صالح أو غير نشط';
    END IF;

    v_next_status := 'deposited';
    v_accounting_rule := 'CHECK_DEPOSITED_FOR_COLLECTION';
    v_debit_acc_id := v_collection_acc_id;
    v_debit_tag := 'CHECKS_UNDER_COLLECTION';
    v_op_desc := 'إيداع شيك رقم #' || v_check.check_number || ' برسم التحصيل لدى ' || v_target_bank.bank_name;

  ELSIF p_op_type = 'collect' THEN
    IF p_target_bank_id IS NULL AND p_target_cashbox_id IS NULL THEN
      RAISE EXCEPTION 'يجب تحديد حساب بنكي أو صندوق نقدي للتحصيل';
    END IF;

    IF p_target_bank_id IS NOT NULL THEN
      SELECT * INTO v_target_bank
      FROM public.bank_accounts
      WHERE id = p_target_bank_id AND store_id = v_check.store_id AND is_active = TRUE;
      IF NOT FOUND THEN RAISE EXCEPTION 'الحساب البنكي المحدد غير صالح'; END IF;
      v_debit_acc_id := v_target_bank.account_id;
      v_debit_tag := 'BANK_ACCOUNT';

      -- Synchronize bank operational balance
      UPDATE public.bank_accounts
      SET balance = coalesce(balance, 0) + v_check.amount,
          updated_at = now()
      WHERE id = p_target_bank_id;
    ELSE
      SELECT * INTO v_target_box
      FROM public.cash_boxes
      WHERE id = p_target_cashbox_id AND store_id = v_check.store_id AND is_active = TRUE AND type = 'cash';
      IF NOT FOUND THEN RAISE EXCEPTION 'الصندوق النقدي المحدد غير صالح أو ليس صندوقاً نقدياً'; END IF;
      v_debit_acc_id := v_target_box.account_id;
      v_debit_tag := 'CASH_BOX';

      -- Record cash movement in treasury
      INSERT INTO public.cash_movements(
        store_id, cash_box_id, direction, amount, source, ref_id,
        party_name, payment_method, description, date, created_by
      ) VALUES (
        v_check.store_id, p_target_cashbox_id, 'in', v_check.amount,
        'check_collect', v_check.id, coalesce(v_check.drawer_name, 'تحصيل شيك'),
        'cash', 'تحصيل نقدي لشيك رقم #' || v_check.check_number, p_date, v_actor
      );
    END IF;

    v_next_status := 'collected';
    v_accounting_rule := 'CHECK_COLLECTED';
    IF v_check.status = 'deposited' THEN
      v_credit_acc_id := v_collection_acc_id;
      v_credit_tag := 'CHECKS_UNDER_COLLECTION';
    END IF;
    v_op_desc := 'تحصيل فعلي لشيك رقم #' || v_check.check_number;

  ELSIF p_op_type = 'bounce' OR p_op_type = 'return' THEN
    v_next_status := 'bounced';
    v_accounting_rule := 'CHECK_BOUNCED';
    v_debit_acc_id := v_returned_acc_id;
    v_debit_tag := 'CHECKS_BOUNCED';
    IF v_check.status = 'deposited' THEN
      v_credit_acc_id := v_collection_acc_id;
      v_credit_tag := 'CHECKS_UNDER_COLLECTION';
    END IF;
    v_op_desc := 'إثبات ارتداد ورفض شيك رقم #' || v_check.check_number;

    IF v_target_cashbox IS NULL THEN
      SELECT id INTO v_ret_box FROM public.cash_boxes WHERE store_id = v_check.store_id AND type = 'checks_returned' AND is_active LIMIT 1;
      v_target_cashbox := v_ret_box;
    END IF;

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
    v_op_desc := 'إرجاع شيك للعميل وإعادة قيد الذمة رقم #' || v_check.check_number;

  ELSIF p_op_type = 'endorse' THEN
    IF p_target_supplier_id IS NULL THEN
      RAISE EXCEPTION 'يجب تحديد المورد لتجيير الشيك لصالحه';
    END IF;

    SELECT * INTO v_supplier FROM public.suppliers WHERE id = p_target_supplier_id AND store_id = v_check.store_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'المورد المحدد غير موجود'; END IF;

    v_next_status := 'endorsed';
    v_accounting_rule := 'CHECK_ENDORSED_TO_SUPPLIER';
    IF v_supplier.account_id IS NOT NULL THEN
      v_debit_acc_id := v_supplier.account_id;
    ELSE
      SELECT id INTO v_debit_acc_id FROM public.accounts WHERE store_id = v_check.store_id AND (code = '2100' OR account_tag = 'SUPPLIER_PAYABLE') AND is_active LIMIT 1;
    END IF;
    v_debit_tag := 'SUPPLIER_PAYABLE';
    v_op_desc := 'تجيير شيك رقم #' || v_check.check_number || ' لصالح المورد ' || v_supplier.name;

    -- Update supplier balance
    UPDATE public.suppliers SET balance = coalesce(balance, 0) - v_check.amount WHERE id = p_target_supplier_id;

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

    IF v_target_box.type NOT IN ('checks_received', 'checks_collection') THEN
      RAISE EXCEPTION 'لا يمكن نقل الشيك إلا إلى صناديق ومحافظ الشيكات (يُمنع النقل للصناديق النقدية)';
    END IF;

    IF v_target_box.type = 'checks_collection' THEN
      v_next_status := 'transferred_for_collection';
    ELSE
      v_next_status := 'in_portfolio';
    END IF;

    v_target_cashbox := p_target_cashbox_id;
    v_accounting_rule := 'CHECK_TRANSFERRED_CASHBOX';
    v_op_desc := 'ترحيل شيك رقم #' || v_check.check_number || ' إلى ' || v_target_box.name;

    v_debit_acc_id := v_target_box.account_id;
    IF v_debit_acc_id IS NULL THEN
      v_debit_acc_id := v_portfolio_acc_id;
    END IF;
    v_debit_tag := 'CHEQUES_IN_HAND';

  ELSE
    RAISE EXCEPTION 'نوع العملية غير معروف: %', p_op_type;
  END IF;

  -- Create Journal Entry if accounts differ
  IF v_debit_acc_id IS NOT NULL AND v_credit_acc_id IS NOT NULL AND v_debit_acc_id <> v_credit_acc_id THEN
    v_entry_num := 'JV-CHK-' || to_char(p_date, 'YYYYMMDD') || '-' || substr(md5(random()::text), 1, 8);

    INSERT INTO public.journal_entries (
      store_id, entry_number, date, description, source, source_id, source_number, source_type, accounting_rule, source_module, status, created_by
    ) VALUES (
      v_check.store_id, v_entry_num, p_date, v_op_desc, 'check_op', v_check.id, v_check.check_number, 'check_operation', v_accounting_rule, 'CHEQUES', 'posted', v_actor
    ) RETURNING id INTO v_entry_id;

    INSERT INTO public.journal_lines (journal_entry_id, account_id, debit, credit, currency, description, sort_order, source_rule)
    VALUES
      (v_entry_id, v_debit_acc_id, v_check.amount, 0, v_check.currency, v_op_desc, 1, v_accounting_rule),
      (v_entry_id, v_credit_acc_id, 0, v_check.amount, v_check.currency, v_op_desc, 2, v_accounting_rule);

    UPDATE public.accounts
    SET balance = balance + CASE WHEN normal_balance = 'debit' THEN v_check.amount ELSE -v_check.amount END
    WHERE id = v_debit_acc_id;

    UPDATE public.accounts
    SET balance = balance + CASE WHEN normal_balance = 'credit' THEN v_check.amount ELSE -v_check.amount END
    WHERE id = v_credit_acc_id;
  END IF;

  -- Record check operation
  INSERT INTO public.check_operations (
    store_id, check_id, operation_type, from_status, to_status, operation_date,
    target_bank_account_id, target_cashbox_id, target_supplier_id, journal_entry_id, notes, performed_by
  ) VALUES (
    v_check.store_id, v_check.id, p_op_type, v_check.status, v_next_status, p_date,
    p_target_bank_id, v_target_cashbox, p_target_supplier_id, v_entry_id, p_notes, v_actor
  );

  -- Update check state
  UPDATE public.checks
  SET status = v_next_status,
      deposit_bank_account_id = CASE WHEN p_op_type = 'deposit' THEN p_target_bank_id ELSE deposit_bank_account_id END,
      endorsed_supplier_id = CASE WHEN p_op_type = 'endorse' THEN p_target_supplier_id ELSE endorsed_supplier_id END,
      cashbox_id = CASE WHEN v_target_cashbox IS NOT NULL THEN v_target_cashbox ELSE cashbox_id END,
      return_reason = CASE WHEN p_op_type IN ('bounce', 'return') THEN p_notes ELSE return_reason END,
      return_date = CASE WHEN p_op_type IN ('bounce', 'return') THEN p_date ELSE return_date END,
      updated_at = now()
  WHERE id = v_check.id;

  RETURN jsonb_build_object(
    'success', true,
    'newStatus', v_next_status,
    'journalEntryId', v_entry_id,
    'journalEntryNumber', v_entry_num
  );
END;
$function$;

-- 3. Update guard_atomic_receipt_cheque to allow return_to_customer for bounced cheques
CREATE OR REPLACE FUNCTION public.guard_atomic_receipt_cheque()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
 IF TG_OP='UPDATE' AND OLD.receipt_settlement_active IS NULL AND NEW.receipt_settlement_active IS NOT NULL AND current_user<>pg_get_userbyid((SELECT proowner FROM pg_proc WHERE oid='public.receipt_cheque_operation_atomic(uuid,uuid,uuid,jsonb,boolean)'::regprocedure)) THEN RAISE EXCEPTION 'لا تغير ربط الشيك الذري مباشرة';END IF;
 IF TG_OP='UPDATE' AND OLD.receipt_settlement_active IS TRUE AND OLD.payment_voucher_id IS NULL AND NEW.payment_voucher_id IS NOT NULL AND NEW.status='endorsed' THEN
  IF current_user<>pg_get_userbyid((SELECT proowner FROM pg_proc WHERE oid='public.create_cheque_payment_atomic(uuid,uuid,jsonb)'::regprocedure)) OR OLD.status NOT IN ('in_portfolio', 'transferred_for_collection') OR
    (to_jsonb(OLD)-ARRAY['status','endorsed_supplier_id','payment_voucher_id','payment_counter_account_id','payment_purchase_id','updated_at','bank_code','branch_code','cashbox_id','notes','return_reason','return_date']) IS DISTINCT FROM (to_jsonb(NEW)-ARRAY['status','endorsed_supplier_id','payment_voucher_id','payment_counter_account_id','payment_purchase_id','updated_at','bank_code','branch_code','cashbox_id','notes','return_reason','return_date']) OR
    NOT EXISTS(SELECT 1 FROM public.check_operations op JOIN public.vouchers v ON v.id=op.payment_voucher_id JOIN public.journal_entries j ON j.id=op.journal_entry_id AND j.ref_id=v.id AND j.store_id=v.store_id AND j.status='posted' WHERE op.check_id=OLD.id AND op.store_id=OLD.store_id AND op.payment_voucher_id=NEW.payment_voucher_id AND op.operation_type='endorse' AND op.from_status=OLD.status AND op.to_status='endorsed' AND op.target_supplier_id=NEW.endorsed_supplier_id AND v.store_id=OLD.store_id AND v.type='payment' AND v.creation_request_id IS NULL AND v.supplier_id=NEW.endorsed_supplier_id AND op.operation_date=v.date) THEN RAISE EXCEPTION 'استخدم مسار تظهير الوارد الذري المرتبط';END IF;
  RETURN NEW;
 END IF;
 IF OLD.receipt_settlement_active IS NOT NULL THEN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'لا يحذف شيك قبض ذري؛ استخدم مسار الإعادة';END IF;
  IF (to_jsonb(OLD)-ARRAY['status','receipt_settlement_active','deposit_bank_account_id','updated_at','bank_code','branch_code','cashbox_id','notes','return_reason','return_date']) IS NOT DISTINCT FROM (to_jsonb(NEW)-ARRAY['status','receipt_settlement_active','deposit_bank_account_id','updated_at','bank_code','branch_code','cashbox_id','notes','return_reason','return_date']) THEN
    IF OLD.status IS NOT DISTINCT FROM NEW.status AND OLD.receipt_settlement_active IS NOT DISTINCT FROM NEW.receipt_settlement_active AND OLD.deposit_bank_account_id IS NOT DISTINCT FROM NEW.deposit_bank_account_id THEN
      RETURN NEW;
    END IF;
  END IF;
  IF current_user<>pg_get_userbyid((SELECT proowner FROM pg_proc WHERE oid='public.receipt_cheque_operation_atomic(uuid,uuid,uuid,jsonb,boolean)'::regprocedure)) OR
   (to_jsonb(OLD)-ARRAY['status','receipt_settlement_active','deposit_bank_account_id','updated_at','bank_code','branch_code','cashbox_id','notes','return_reason','return_date']) IS DISTINCT FROM (to_jsonb(NEW)-ARRAY['status','receipt_settlement_active','deposit_bank_account_id','updated_at','bank_code','branch_code','cashbox_id','notes','return_reason','return_date']) OR
   OLD.status NOT IN ('in_portfolio', 'transferred_for_collection', 'deposited', 'bounced') OR OLD.receipt_settlement_active IS DISTINCT FROM true OR
   NOT EXISTS(SELECT 1 FROM public.check_operations WHERE check_id=OLD.id AND receipt_request_id IS NOT NULL AND from_status=OLD.status AND to_status=NEW.status AND ((journal_entry_id IS NOT NULL) OR (operation_type='transfer_cashbox')) AND ((operation_type='collect' AND NEW.status='collected' AND NEW.receipt_settlement_active IS TRUE AND target_bank_account_id IS NOT DISTINCT FROM NEW.deposit_bank_account_id) OR (operation_type='deposit' AND NEW.status='deposited' AND NEW.receipt_settlement_active IS TRUE AND target_bank_account_id IS NOT DISTINCT FROM NEW.deposit_bank_account_id) OR (operation_type='transfer_cashbox' AND NEW.status IN ('in_portfolio', 'transferred_for_collection') AND NEW.receipt_settlement_active IS TRUE) OR (operation_type IN ('bounce', 'return') AND NEW.status IN ('bounced', 'returned') AND NEW.receipt_settlement_active IS TRUE) OR (operation_type='return_to_customer' AND NEW.status='returned_to_customer' AND NEW.receipt_settlement_active IS FALSE AND NEW.deposit_bank_account_id IS NOT DISTINCT FROM OLD.deposit_bank_account_id))) THEN RAISE EXCEPTION 'استخدم التحصيل أو الإيداع أو الإعادة الذريين للشيك المرتبط';END IF;
 END IF;
 RETURN NEW;
END;
$function$;

-- 4. Synchronize bank_accounts.balance for Al-Manar Jordan National Bank (11111) to match verified ledger 3,250.00 ILS
UPDATE public.bank_accounts
SET balance = 3250.00,
    updated_at = now()
WHERE store_id = '15f1298b-f025-48f7-bd61-1305ff84d748'
  AND account_number = '11111'
  AND balance = 250.00;

COMMIT;
