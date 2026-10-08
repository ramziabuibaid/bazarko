BEGIN;

-- 1. Update guard_atomic_receipt_cheque to allow bank_code and branch_code metadata updates
CREATE OR REPLACE FUNCTION public.guard_atomic_receipt_cheque()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
 IF TG_OP='UPDATE' AND OLD.receipt_settlement_active IS NULL AND NEW.receipt_settlement_active IS NOT NULL AND current_user<>pg_get_userbyid((SELECT proowner FROM pg_proc WHERE oid='public.receipt_cheque_operation_atomic(uuid,uuid,uuid,jsonb,boolean)'::regprocedure)) THEN RAISE EXCEPTION 'لا تغير ربط الشيك الذري مباشرة';END IF;
 IF TG_OP='UPDATE' AND OLD.receipt_settlement_active IS TRUE AND OLD.payment_voucher_id IS NULL AND NEW.payment_voucher_id IS NOT NULL AND NEW.status='endorsed' THEN
  IF current_user<>pg_get_userbyid((SELECT proowner FROM pg_proc WHERE oid='public.create_cheque_payment_atomic(uuid,uuid,jsonb)'::regprocedure)) OR OLD.status<>'in_portfolio' OR
    (to_jsonb(OLD)-ARRAY['status','endorsed_supplier_id','payment_voucher_id','payment_counter_account_id','payment_purchase_id','updated_at','bank_code','branch_code']) IS DISTINCT FROM (to_jsonb(NEW)-ARRAY['status','endorsed_supplier_id','payment_voucher_id','payment_counter_account_id','payment_purchase_id','updated_at','bank_code','branch_code']) OR
    NOT EXISTS(SELECT 1 FROM public.check_operations op JOIN public.vouchers v ON v.id=op.payment_voucher_id JOIN public.journal_entries j ON j.id=op.journal_entry_id AND j.ref_id=v.id AND j.store_id=v.store_id AND j.status='posted' WHERE op.check_id=OLD.id AND op.store_id=OLD.store_id AND op.payment_voucher_id=NEW.payment_voucher_id AND op.operation_type='endorse' AND op.from_status='in_portfolio' AND op.to_status='endorsed' AND op.target_supplier_id=NEW.endorsed_supplier_id AND v.store_id=OLD.store_id AND v.type='payment' AND v.creation_request_id IS NULL AND v.supplier_id=NEW.endorsed_supplier_id AND op.operation_date=v.date) THEN RAISE EXCEPTION 'استخدم مسار تظهير الوارد الذري المرتبط';END IF;
  RETURN NEW;
 END IF;
 IF OLD.receipt_settlement_active IS NOT NULL THEN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'لا يحذف شيك قبض ذري؛ استخدم مسار الإعادة';END IF;
  -- If financial status/settlement is unchanged, permit metadata updates (bank_code / branch_code)
  IF (to_jsonb(OLD)-ARRAY['status','receipt_settlement_active','deposit_bank_account_id','updated_at','bank_code','branch_code']) IS NOT DISTINCT FROM (to_jsonb(NEW)-ARRAY['status','receipt_settlement_active','deposit_bank_account_id','updated_at','bank_code','branch_code']) THEN
    IF OLD.status IS NOT DISTINCT FROM NEW.status AND OLD.receipt_settlement_active IS NOT DISTINCT FROM NEW.receipt_settlement_active AND OLD.deposit_bank_account_id IS NOT DISTINCT FROM NEW.deposit_bank_account_id THEN
      RETURN NEW;
    END IF;
  END IF;
  IF current_user<>pg_get_userbyid((SELECT proowner FROM pg_proc WHERE oid='public.receipt_cheque_operation_atomic(uuid,uuid,uuid,jsonb,boolean)'::regprocedure)) OR
   (to_jsonb(OLD)-ARRAY['status','receipt_settlement_active','deposit_bank_account_id','updated_at','bank_code','branch_code']) IS DISTINCT FROM (to_jsonb(NEW)-ARRAY['status','receipt_settlement_active','deposit_bank_account_id','updated_at','bank_code','branch_code']) OR
   OLD.status<>'in_portfolio' OR OLD.receipt_settlement_active IS DISTINCT FROM true OR
   NOT EXISTS(SELECT 1 FROM public.check_operations WHERE check_id=OLD.id AND receipt_request_id IS NOT NULL AND from_status=OLD.status AND to_status=NEW.status AND journal_entry_id IS NOT NULL AND ((operation_type='collect' AND NEW.status='collected' AND NEW.receipt_settlement_active IS TRUE AND target_bank_account_id IS NOT DISTINCT FROM NEW.deposit_bank_account_id) OR (operation_type='return_to_customer' AND NEW.status='returned_to_customer' AND NEW.receipt_settlement_active IS FALSE AND NEW.deposit_bank_account_id IS NOT DISTINCT FROM OLD.deposit_bank_account_id))) THEN RAISE EXCEPTION 'استخدم التحصيل أو الإعادة الذريين للشيك المرتبط';END IF;
 END IF;
 RETURN NEW;
END $function$;

-- 2. Update create_cheque_receipt_atomic to record bank_code and branch_code in checks_data and public.checks
CREATE OR REPLACE FUNCTION public.create_cheque_receipt_atomic(p_store_id uuid,p_request_id uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
#variable_conflict use_variable
DECLARE
 actor uuid:=auth.uid(); old public.vouchers%ROWTYPE; cust public.customers%ROWTYPE;
 inv public.invoices%ROWTYPE; box public.cash_boxes%ROWTYPE;
 customer_id uuid; invoice_id uuid; box_id uuid; counter_id uuid; cash_id uuid;
 voucher_id uuid:=gen_random_uuid(); journal_id uuid; curr text; party text; description text; reference text;
 receipt_date date; amount numeric; cash_amount numeric; cheque_amount numeric:=0; method text; portfolio public.cash_boxes%ROWTYPE; portfolio_id uuid; portfolio_acc uuid; cheque jsonb; cheques jsonb:='[]'::jsonb; seen text[]:='{}'; cheque_key text; check_amt numeric; issue_date date; due_date date; next_no bigint; voucher_no text; ids uuid[]; source_total numeric; acc record;
BEGIN
 IF actor IS NULL OR NOT EXISTS(SELECT 1 FROM public.stores WHERE id=p_store_id AND owner_id=actor)
 AND NOT EXISTS(SELECT 1 FROM public.store_members WHERE store_id=p_store_id AND profile_id=actor AND is_active) THEN RAISE EXCEPTION 'غير مصرح بالقبض لهذا المتجر';END IF;
 IF p_request_id IS NULL OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN RAISE EXCEPTION 'طلب الحفظ غير صحيح';END IF;
 -- Same store lock as sales-invoice creation; invoice creators and receipts serialize.
 PERFORM pg_advisory_xact_lock(hashtextextended(p_store_id::text,54001));
 SELECT * INTO old FROM public.vouchers WHERE store_id=p_store_id AND creation_request_id=p_request_id;
 IF FOUND THEN
  IF old.creation_request_payload IS DISTINCT FROM p_payload THEN RAISE EXCEPTION 'طلب الحفظ سبق استخدامه ببيانات مختلفة';END IF;
  RETURN jsonb_build_object('voucherId',old.id,'voucherNumber',old.voucher_number,'replayed',true);
 END IF;
 IF p_payload->>'partyType' IS NULL OR p_payload->>'partyType' NOT IN ('customer','other') THEN RAISE EXCEPTION 'حدد نوع الجهة';END IF;
 method:=p_payload->>'method';
 IF method IS NULL OR method NOT IN ('cheque','split') THEN RAISE EXCEPTION 'اختر شيكات أو قبضاً مختلطاً';END IF;
 IF coalesce(p_payload->>'date','') !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'تاريخ السند غير صحيح';END IF;
 receipt_date:=(p_payload->>'date')::date;
 IF jsonb_typeof(p_payload->'cheques') IS DISTINCT FROM 'array' OR jsonb_array_length(p_payload->'cheques') NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'أضف بين شيك واحد و50 شيكاً';END IF;
 cash_amount:=0;
 IF method='split' THEN
  IF coalesce(p_payload->>'amount','') !~ '^\d+(\.\d{1,2})?$' THEN RAISE EXCEPTION 'المبلغ النقدي غير صحيح';END IF;
  cash_amount:=(p_payload->>'amount')::numeric;
  IF cash_amount<=0 OR cash_amount>999999999 THEN RAISE EXCEPTION 'المبلغ النقدي يجب أن يكون موجباً';END IF;
 ELSIF coalesce(p_payload->>'amount','0') NOT IN ('','0','0.00') OR nullif(p_payload->>'boxId','') IS NOT NULL THEN RAISE EXCEPTION 'قبض الشيكات لا يتضمن صندوقاً أو مبلغاً نقدياً';END IF;
 FOR cheque IN SELECT value FROM jsonb_array_elements(p_payload->'cheques') LOOP
  IF coalesce(btrim(cheque->>'check_number'),'')='' OR length(cheque->>'check_number')>100 OR coalesce(btrim(cheque->>'bank_name'),'')='' OR length(cheque->>'bank_name')>200 OR coalesce(btrim(cheque->>'account_number'),'')='' OR length(cheque->>'account_number')>100 OR length(cheque->>'branch_name')>200 OR length(cheque->>'drawer_name')>200 OR length(cheque->>'bank_code')>50 OR length(cheque->>'branch_code')>50 THEN RAISE EXCEPTION 'تحقق من رقم الشيك والبنك وحساب الساحب';END IF;
  cheque_key:=lower(btrim(cheque->>'check_number'))||'|'||lower(btrim(cheque->>'bank_name'))||'|'||lower(btrim(cheque->>'account_number'));
  IF cheque_key=ANY(seen) OR EXISTS(SELECT 1 FROM public.checks WHERE store_id=p_store_id AND type='received' AND lower(btrim(check_number))=lower(btrim(cheque->>'check_number')) AND lower(btrim(bank_name))=lower(btrim(cheque->>'bank_name')) AND lower(btrim(account_number))=lower(btrim(cheque->>'account_number'))) THEN RAISE EXCEPTION 'الشيك مكرر في السند أو مسجل سابقاً';END IF;
  -- Legacy sync identifies checks by voucher+number, so numbers must be unique within this voucher too.
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(cheques) v WHERE v->>'check_number'=btrim(cheque->>'check_number')) THEN RAISE EXCEPTION 'رقم الشيك مكرر داخل السند';END IF;
  seen:=array_append(seen,cheque_key);
  IF coalesce(cheque->>'amount','') !~ '^\d+(\.\d{1,2})?$' THEN RAISE EXCEPTION 'قيمة الشيك غير صحيحة';END IF;
  check_amt:=(cheque->>'amount')::numeric;
  IF check_amt<=0 OR check_amt>999999999 THEN RAISE EXCEPTION 'قيمة الشيك يجب أن تكون موجبة';END IF;
  IF coalesce(cheque->>'issue_date','') !~ '^\d{4}-\d{2}-\d{2}$' OR coalesce(cheque->>'due_date','') !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'تواريخ الشيك مطلوبة';END IF;
  issue_date:=(cheque->>'issue_date')::date;due_date:=(cheque->>'due_date')::date;
  IF due_date<issue_date OR issue_date>receipt_date THEN RAISE EXCEPTION 'راجع إصدار الشيك واستحقاقه';END IF;
  cheque_amount:=cheque_amount+check_amt;
  cheques:=cheques||jsonb_build_array(jsonb_build_object(
    'check_number',btrim(cheque->>'check_number'),
    'bank_name',btrim(cheque->>'bank_name'),
    'bank_code',nullif(btrim(cheque->>'bank_code'),''),
    'branch_name',nullif(btrim(cheque->>'branch_name'),''),
    'branch_code',nullif(btrim(cheque->>'branch_code'),''),
    'account_number',btrim(cheque->>'account_number'),
    'drawer_name',nullif(btrim(cheque->>'drawer_name'),''),
    'amount',check_amt,
    'date',issue_date,
    'due_date',due_date
  ));
 END LOOP;
 amount:=cash_amount+cheque_amount;
 IF amount>999999999 THEN RAISE EXCEPTION 'إجمالي السند خارج الحدود';END IF;
 description:=btrim(p_payload->>'description'); reference:=nullif(btrim(p_payload->>'reference'),'');
 IF coalesce(description,'')='' OR length(description)>1000 OR length(reference)>200 THEN RAISE EXCEPTION 'تحقق من البيان والمرجع';END IF;
 PERFORM 1 FROM public.accounting_periods WHERE store_id=p_store_id FOR SHARE;
 IF EXISTS(SELECT 1 FROM public.accounting_periods WHERE store_id=p_store_id AND is_closed AND receipt_date BETWEEN start_date AND end_date) THEN RAISE EXCEPTION 'تاريخ القبض ضمن فترة محاسبية مقفلة';END IF;
 SELECT coalesce(currency_code,'ILS') INTO curr FROM public.stores WHERE id=p_store_id;
 customer_id:=nullif(p_payload->>'customerId','')::uuid; invoice_id:=nullif(p_payload->>'invoiceId','')::uuid;
 IF p_payload->>'partyType'='customer' THEN
  SELECT * INTO cust FROM public.customers WHERE id=customer_id AND store_id=p_store_id AND is_active FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'اختر عميلاً نشطاً من المتجر';END IF;
  IF coalesce(cust.balance,0)::text IN ('NaN','Infinity','-Infinity') OR coalesce(cust.total_paid,0)::text IN ('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'رصيد العميل يحتاج مراجعة';END IF;
  party:=cust.name;
  IF invoice_id IS NOT NULL THEN
   SELECT * INTO inv FROM public.invoices WHERE id=invoice_id AND store_id=p_store_id AND invoices.customer_id=customer_id FOR UPDATE;
   IF NOT FOUND OR inv.status IN ('draft','cancelled') OR inv.total IS NULL OR inv.amount_paid IS NULL OR inv.total::text IN ('NaN','Infinity','-Infinity') OR inv.amount_paid::text IN ('NaN','Infinity','-Infinity') OR inv.total<=0 OR inv.amount_paid<0 OR inv.amount_paid>inv.total THEN RAISE EXCEPTION 'الفاتورة غير متاحة أو لا تخص العميل';END IF;
   IF receipt_date<inv.issue_date THEN RAISE EXCEPTION 'تاريخ القبض لا يسبق الفاتورة';END IF;
   IF amount>inv.total-inv.amount_paid THEN RAISE EXCEPTION 'المبلغ يتجاوز المتبقي على الفاتورة';END IF;
   -- Reuse the exact receivable from the original posted sale; never guess for a linked invoice.
   SELECT array_agg(DISTINCT l.account_id),sum(l.debit-l.credit) INTO ids,source_total
   FROM public.journal_lines l JOIN public.journal_entries e ON e.id=l.journal_entry_id JOIN public.accounts a ON a.id=l.account_id
   WHERE e.id=inv.journal_entry_id AND e.store_id=p_store_id AND e.status='posted' AND a.store_id=p_store_id AND a.account_tag='CUSTOMER_RECEIVABLE';
   IF coalesce(cardinality(ids),0)<>1 OR source_total IS DISTINCT FROM inv.total THEN RAISE EXCEPTION 'قيد استحقاق الفاتورة يحتاج مطابقة قبل القبض';END IF;
   IF EXISTS(SELECT 1 FROM public.journal_lines WHERE journal_entry_id=inv.journal_entry_id AND currency IS DISTINCT FROM curr) THEN RAISE EXCEPTION 'عملة قيد الفاتورة لا تطابق عملة المتجر';END IF;
   counter_id:=ids[1];
  ELSE
   SELECT array_agg(id) INTO ids FROM public.accounts WHERE store_id=p_store_id AND is_active AND NOT is_group AND account_tag='CUSTOMER_RECEIVABLE' AND name=party AND currency=curr AND normal_balance='debit';
   IF coalesce(cardinality(ids),0)=0 THEN
    SELECT array_agg(id) INTO ids FROM public.accounts WHERE store_id=p_store_id AND is_active AND NOT is_group AND account_tag='CUSTOMER_RECEIVABLE' AND currency=curr AND normal_balance='debit';
   END IF;
   IF coalesce(cardinality(ids),0)<>1 THEN RAISE EXCEPTION 'حساب ذمة العميل غير محدد؛ اربط فاتورة صحيحة أو راجع المحاسب';END IF;
   counter_id:=ids[1];
  END IF;
 ELSE
  IF customer_id IS NOT NULL OR invoice_id IS NOT NULL THEN RAISE EXCEPTION 'الجهة الأخرى لا ترتبط بعميل أو فاتورة';END IF;
  party:=btrim(p_payload->>'partyName'); counter_id:=nullif(p_payload->>'creditAccountId','')::uuid;
  IF coalesce(party,'')='' OR length(party)>200 THEN RAISE EXCEPTION 'أدخل اسم الجهة المستلم منها';END IF;
 END IF;
 portfolio_id:=nullif(p_payload->>'portfolioId','')::uuid;
 SELECT * INTO portfolio FROM public.cash_boxes WHERE id=portfolio_id AND store_id=p_store_id AND is_active AND type='checks_received' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'اختر محفظة شيكات واردة نشطة';END IF;
 portfolio_acc:=portfolio.account_id;
 IF NOT public.can_manage_cash_permissions(p_store_id) AND NOT EXISTS(SELECT 1 FROM public.user_cash_box_permissions WHERE store_id=p_store_id AND user_id=actor AND cash_box_id=portfolio_id AND can_receipt) THEN RAISE EXCEPTION 'لا تملك صلاحية القبض في المحفظة';END IF;
 IF cash_amount>0 THEN
  box_id:=nullif(p_payload->>'boxId','')::uuid;
  SELECT * INTO box FROM public.cash_boxes WHERE id=box_id AND store_id=p_store_id AND is_active AND type='cash' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'اختر صندوقاً نقدياً نشطاً';END IF;
  IF NOT public.can_manage_cash_permissions(p_store_id) AND NOT EXISTS(SELECT 1 FROM public.user_cash_box_permissions WHERE store_id=p_store_id AND user_id=actor AND cash_box_id=box_id AND can_receipt) THEN RAISE EXCEPTION 'لا تملك صلاحية القبض في الصندوق المختار';END IF;
  cash_id:=box.account_id;
 END IF;
 PERFORM 1 FROM public.accounts WHERE id IN (cash_id,counter_id,portfolio_acc) ORDER BY id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.accounts WHERE id IN (cash_id,counter_id,portfolio_acc) AND coalesce(balance,0)::text IN ('NaN','Infinity','-Infinity')) THEN RAISE EXCEPTION 'رصيد حساب الترحيل يحتاج مراجعة';END IF;
 IF cash_amount>0 AND NOT EXISTS(SELECT 1 FROM public.accounts WHERE id=cash_id AND store_id=p_store_id AND is_active AND NOT is_group AND currency=curr AND normal_balance='debit' AND account_tag IN ('CASH','PETTY_CASH')) THEN RAISE EXCEPTION 'حساب الصندوق أو عملته غير صالح';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.accounts WHERE id=portfolio_acc AND store_id=p_store_id AND is_active AND NOT is_group AND currency=curr AND type='asset' AND normal_balance='debit' AND account_tag='CHECKS_PORTFOLIO') THEN RAISE EXCEPTION 'حساب المحفظة أو عملته غير صالح';END IF;
 SELECT coalesce(jsonb_agg(v||jsonb_build_object('currency',curr,'exchange_rate',1)), '[]'::jsonb) INTO cheques FROM jsonb_array_elements(cheques) v;
 IF NOT EXISTS(SELECT 1 FROM public.accounts WHERE id=counter_id AND store_id=p_store_id AND is_active AND NOT is_group AND currency=curr AND
  ((p_payload->>'partyType'='customer' AND account_tag='CUSTOMER_RECEIVABLE' AND normal_balance='debit') OR (p_payload->>'partyType'='other' AND type IN ('revenue','liability','equity') AND normal_balance='credit'))) THEN RAISE EXCEPTION 'الحساب المقابل أو عملته غير صالح';END IF;
 SELECT coalesce(max(substring(voucher_number FROM '^RCP-([0-9]+)$')::bigint),0)+1 INTO next_no FROM public.vouchers WHERE store_id=p_store_id;
 voucher_no:='RCP-'||lpad(next_no::text,greatest(4,length(next_no::text)),'0');
 -- Request identity is attached only after all side effects, so the completed voucher can be immutable.
 INSERT INTO public.vouchers(id,store_id,voucher_number,type,date,amount,cash_amount,checks_amount,customer_id,party_name,payment_method,cash_box_id,invoice_id,category,description,reference,created_by,checks_data,cheque_portfolio_id)
 VALUES(voucher_id,p_store_id,voucher_no,'receipt',receipt_date,amount,cash_amount,cheque_amount,customer_id,party,method,CASE WHEN cash_amount>0 THEN box_id ELSE portfolio_id END,invoice_id,CASE WHEN customer_id IS NULL THEN 'قبض من جهة أخرى' ELSE 'تحصيل ذمة عميل' END,description,reference,actor,cheques,portfolio_id);
 IF (SELECT count(*) FROM public.cash_movements WHERE store_id=p_store_id AND ref_id=voucher_id)<>(CASE WHEN cash_amount>0 THEN 1 ELSE 0 END) OR (cash_amount>0 AND NOT EXISTS(SELECT 1 FROM public.cash_movements cm WHERE cm.store_id=p_store_id AND cm.ref_id=voucher_id AND cm.direction='in' AND cm.cash_box_id=box_id AND cm.amount=cash_amount AND cm.date=receipt_date)) THEN RAISE EXCEPTION 'لم تتطابق حركة النقد مع السند';END IF;
 IF (SELECT count(*) FROM public.checks WHERE store_id=p_store_id AND checks.voucher_id=voucher_id)<>jsonb_array_length(cheques) OR (SELECT coalesce(sum(checks.amount),0) FROM public.checks WHERE store_id=p_store_id AND checks.voucher_id=voucher_id)<>cheque_amount THEN RAISE EXCEPTION 'لم تتطابق الشيكات مع السند';END IF;
 
 -- Update checks with portfolio linking and ensure bank_code / branch_code are set
 UPDATE public.checks c
 SET
   cashbox_id = portfolio_id,
   receipt_counter_account_id = counter_id,
   receipt_portfolio_account_id = portfolio_acc,
   receipt_invoice_id = invoice_id,
   receipt_settlement_active = true,
   bank_code = coalesce(c.bank_code, nullif(btrim(elem->>'bank_code'), '')),
   branch_code = coalesce(c.branch_code, nullif(btrim(elem->>'branch_code'), ''))
 FROM jsonb_array_elements(cheques) elem
 WHERE c.store_id = p_store_id
   AND c.voucher_id = voucher_id
   AND c.check_number = elem->>'check_number';

 INSERT INTO public.journal_entries(store_id,entry_number,date,description,source,ref_id,source_type,source_id,source_number,source_url,accounting_rule,source_module,status,created_by)
 VALUES(p_store_id,'JV-RCP-'||voucher_id::text,receipt_date,description,'voucher',voucher_id,'receipt_voucher',voucher_id,voucher_no,'/dashboard/accounting/receipts/print/'||voucher_id::text,CASE WHEN customer_id IS NULL THEN 'CASH_RECEIPT_OTHER' ELSE 'CUSTOMER_PAYMENT_RECEIVED' END,'TREASURY','posted',actor) RETURNING id INTO journal_id;
 INSERT INTO public.journal_lines(journal_entry_id,account_id,debit,credit,currency,description,sort_order,account_tag_used,source_rule)
 VALUES(journal_id,portfolio_acc,cheque_amount,0,curr,description,1,'CHECKS_PORTFOLIO','CHEQUE_RECEIPT_ATOMIC'),(journal_id,counter_id,0,amount,curr,description,2,CASE WHEN customer_id IS NOT NULL THEN 'CUSTOMER_RECEIVABLE' END,'CHEQUE_RECEIPT_ATOMIC');
 IF cash_amount>0 THEN INSERT INTO public.journal_lines(journal_entry_id,account_id,debit,credit,currency,description,sort_order,account_tag_used,source_rule) VALUES(journal_id,cash_id,cash_amount,0,curr,description,3,'CASH','CHEQUE_RECEIPT_ATOMIC');END IF;
 FOR acc IN SELECT account_id,sum(debit) debit,sum(credit) credit FROM public.journal_lines WHERE journal_entry_id=journal_id GROUP BY account_id LOOP
  UPDATE public.accounts SET balance=coalesce(balance,0)+CASE WHEN normal_balance='credit' THEN acc.credit-acc.debit ELSE acc.debit-acc.credit END WHERE id=acc.account_id;
 END LOOP;
 IF customer_id IS NOT NULL THEN
  INSERT INTO public.customer_ledger(store_id,customer_id,type,date,description,debit,credit,balance,reference_id,reference_type,created_by)
  VALUES(p_store_id,customer_id,'payment',receipt_date,description,0,amount,coalesce(cust.balance,0)-amount,voucher_id,'voucher',actor);
  UPDATE public.customers SET balance=coalesce(balance,0)-amount,total_paid=coalesce(total_paid,0)+amount WHERE id=customer_id;
 END IF;
 IF invoice_id IS NOT NULL THEN UPDATE public.invoices SET amount_paid=inv.amount_paid+amount,status=CASE WHEN inv.amount_paid+amount=inv.total THEN 'paid' ELSE 'partial' END,paid_at=CASE WHEN inv.amount_paid+amount=inv.total THEN now() ELSE NULL END WHERE id=invoice_id;END IF;
 UPDATE public.vouchers SET journal_entry_id=journal_id,creation_request_id=p_request_id,creation_request_payload=p_payload WHERE id=voucher_id;
 INSERT INTO public.financial_audit_log(store_id,entity_type,entity_id,entity_label,action,actor_id,details)
 VALUES(p_store_id,'voucher',voucher_id,voucher_no,'create',actor,jsonb_build_object('requestId',p_request_id,'amount',amount,'invoiceId',invoice_id,'atomic',true));
 RETURN jsonb_build_object('voucherId',voucher_id,'voucherNumber',voucher_no,'replayed',false);
END $$;
REVOKE ALL ON FUNCTION public.create_cheque_receipt_atomic(uuid,uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_cheque_receipt_atomic(uuid,uuid,jsonb) TO authenticated;

-- 3. Backfill bank codes for known Palestinian banks on existing checks
UPDATE public.checks
SET bank_code = CASE
  WHEN lower(bank_name) LIKE '%فلسطين%' AND lower(bank_name) NOT LIKE '%استثمار%' AND lower(bank_name) NOT LIKE '%إسلامي%' THEN '01'
  WHEN lower(bank_name) LIKE '%عربي%' OR lower(bank_name) LIKE '%arab bank%' THEN '02'
  WHEN lower(bank_name) LIKE '%قاهرة عمان%' OR lower(bank_name) LIKE '%cairo amman%' THEN '03'
  WHEN lower(bank_name) LIKE '%قدس%' OR lower(bank_name) LIKE '%quds%' THEN '04'
  WHEN lower(bank_name) LIKE '%استثمار%' THEN '05'
  WHEN lower(bank_name) LIKE '%وطني%' OR lower(bank_name) LIKE '%national bank%' THEN '06'
  WHEN lower(bank_name) LIKE '%إسلامي فلسطيني%' OR lower(bank_name) LIKE '%palestine islamic%' THEN '07'
  WHEN lower(bank_name) LIKE '%إسلامي عربي%' OR lower(bank_name) LIKE '%arab islamic%' THEN '08'
  WHEN lower(bank_name) LIKE '%أردن%' OR lower(bank_name) LIKE '%bank of jordan%' THEN '09'
  WHEN lower(bank_name) LIKE '%إسكان%' OR lower(bank_name) LIKE '%housing bank%' THEN '10'
  ELSE bank_code
END
WHERE bank_code IS NULL;

COMMIT;
