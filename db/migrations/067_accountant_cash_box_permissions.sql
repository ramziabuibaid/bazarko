-- Migration 067: Allow accountants and active store members without explicit restrictions to access cash boxes for receipts and payments
BEGIN;

-- 1. Helper function for cash box access check
CREATE OR REPLACE FUNCTION public.can_access_cash_box(p_store_id uuid, p_box_id uuid, p_action text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  actor uuid := auth.uid();
  m_role text;
  has_restrictions boolean;
BEGIN
  IF actor IS NULL THEN RETURN false; END IF;
  
  -- Store owner is always allowed
  IF EXISTS(SELECT 1 FROM public.stores WHERE id = p_store_id AND owner_id = actor) THEN
    RETURN true;
  END IF;
  
  -- Check membership
  SELECT role INTO m_role 
  FROM public.store_members 
  WHERE store_id = p_store_id AND profile_id = actor AND is_active 
  LIMIT 1;

  IF m_role IS NULL THEN RETURN false; END IF;
  
  -- Owner, Admin, and Accountant roles always have full authority over cash boxes
  IF m_role IN ('owner', 'admin', 'accountant') THEN
    RETURN true;
  END IF;

  -- Check if user has explicit restrictions configured
  SELECT EXISTS(
    SELECT 1 FROM public.user_cash_box_permissions 
    WHERE store_id = p_store_id AND user_id = actor
  ) INTO has_restrictions;

  -- If no restrictions configured for this user, default policy allows all boxes
  IF NOT has_restrictions THEN
    RETURN true;
  END IF;

  -- If restrictions exist, check the specific action permission
  IF p_action = 'receipt' THEN
    RETURN EXISTS(
      SELECT 1 FROM public.user_cash_box_permissions 
      WHERE store_id = p_store_id AND user_id = actor AND cash_box_id = p_box_id AND can_receipt
    );
  ELSIF p_action = 'payment' THEN
    RETURN EXISTS(
      SELECT 1 FROM public.user_cash_box_permissions 
      WHERE store_id = p_store_id AND user_id = actor AND cash_box_id = p_box_id AND can_payment
    );
  END IF;

  RETURN false;
END $$;
REVOKE ALL ON FUNCTION public.can_access_cash_box(uuid,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_access_cash_box(uuid,uuid,text) TO authenticated;

-- 2. Update can_manage_cash_permissions to include accountant
CREATE OR REPLACE FUNCTION public.can_manage_cash_permissions(p_store_id uuid) 
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT auth.uid() IS NOT NULL AND (
    EXISTS(SELECT 1 FROM public.stores WHERE id=p_store_id AND owner_id=auth.uid()) 
    OR EXISTS(SELECT 1 FROM public.store_members WHERE store_id=p_store_id AND profile_id=auth.uid() AND is_active AND role IN ('owner','admin','accountant'))
  );
$$;

-- 3. Update create_cash_receipt_atomic
CREATE OR REPLACE FUNCTION public.create_cash_receipt_atomic(p_store_id uuid,p_request_id uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
#variable_conflict use_variable
DECLARE
 actor uuid:=auth.uid(); old public.vouchers%ROWTYPE; cust public.customers%ROWTYPE;
 inv public.invoices%ROWTYPE; box public.cash_boxes%ROWTYPE;
 customer_id uuid; invoice_id uuid; box_id uuid; counter_id uuid; cash_id uuid;
 voucher_id uuid:=gen_random_uuid(); journal_id uuid; curr text; party text; description text; reference text;
 receipt_date date; amount numeric; next_no bigint; voucher_no text; ids uuid[]; source_total numeric; acc record;
BEGIN
 IF actor IS NULL OR NOT EXISTS(SELECT 1 FROM public.stores WHERE id=p_store_id AND owner_id=actor)
 AND NOT EXISTS(SELECT 1 FROM public.store_members WHERE store_id=p_store_id AND profile_id=actor AND is_active) THEN RAISE EXCEPTION 'غير مصرح بالقبض لهذا المتجر';END IF;
 IF p_request_id IS NULL OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN RAISE EXCEPTION 'طلب الحفظ غير صحيح';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_store_id::text,54001));
 SELECT * INTO old FROM public.vouchers WHERE store_id=p_store_id AND creation_request_id=p_request_id;
 IF FOUND THEN
  IF old.creation_request_payload IS DISTINCT FROM p_payload THEN RAISE EXCEPTION 'طلب الحفظ سبق استخدامه ببيانات مختلفة';END IF;
  RETURN jsonb_build_object('voucherId',old.id,'voucherNumber',old.voucher_number,'replayed',true);
 END IF;
 IF p_payload->>'partyType' IS NULL OR p_payload->>'partyType' NOT IN ('customer','other') THEN RAISE EXCEPTION 'حدد نوع الجهة';END IF;
 IF coalesce(p_payload->>'amount','') !~ '^\d+(\.\d{1,2})?$' THEN RAISE EXCEPTION 'أدخل مبلغاً موجباً بمنزلتين عشريتين';END IF;
 amount:=(p_payload->>'amount')::numeric;
 IF amount<=0 OR amount>999999999 THEN RAISE EXCEPTION 'المبلغ خارج الحدود المسموحة';END IF;
 IF coalesce(p_payload->>'date','') !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'تاريخ السند غير صحيح';END IF;
 receipt_date:=(p_payload->>'date')::date;
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
 box_id:=nullif(p_payload->>'boxId','')::uuid;
 SELECT * INTO box FROM public.cash_boxes WHERE id=box_id AND store_id=p_store_id AND is_active AND type='cash' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'اختر صندوقاً نقدياً نشطاً';END IF;
 IF NOT public.can_access_cash_box(p_store_id, box_id, 'receipt') THEN RAISE EXCEPTION 'لا تملك صلاحية القبض في الصندوق المختار';END IF;
 cash_id:=box.account_id;
 PERFORM 1 FROM public.accounts WHERE id IN (cash_id,counter_id) ORDER BY id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.accounts WHERE id IN (cash_id,counter_id) AND coalesce(balance,0)::text IN ('NaN','Infinity','-Infinity')) THEN RAISE EXCEPTION 'رصيد حساب الترحيل يحتاج مراجعة';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.accounts WHERE id=cash_id AND store_id=p_store_id AND is_active AND NOT is_group AND currency=curr AND normal_balance='debit' AND account_tag IN ('CASH','PETTY_CASH')) THEN RAISE EXCEPTION 'حساب الصندوق أو عملته غير صالح';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.accounts WHERE id=counter_id AND store_id=p_store_id AND is_active AND NOT is_group AND currency=curr AND
  ((p_payload->>'partyType'='customer' AND account_tag='CUSTOMER_RECEIVABLE' AND normal_balance='debit') OR (p_payload->>'partyType'='other' AND type IN ('revenue','liability','equity') AND normal_balance='credit'))) THEN RAISE EXCEPTION 'الحساب المقابل أو عملته غير صالح';END IF;
 SELECT coalesce(max(substring(voucher_number FROM '^RCP-([0-9]+)$')::bigint),0)+1 INTO next_no FROM public.vouchers WHERE store_id=p_store_id;
 voucher_no:='RCP-'||lpad(next_no::text,greatest(4,length(next_no::text)),'0');
 INSERT INTO public.vouchers(id,store_id,voucher_number,type,date,amount,cash_amount,checks_amount,customer_id,party_name,payment_method,cash_box_id,invoice_id,category,description,reference,created_by)
 VALUES(voucher_id,p_store_id,voucher_no,'receipt',receipt_date,amount,amount,0,customer_id,party,'cash',box_id,invoice_id,CASE WHEN customer_id IS NULL THEN 'قبض من جهة أخرى' ELSE 'تحصيل ذمة عميل' END,description,reference,actor);
 IF (SELECT count(*) FROM public.cash_movements WHERE store_id=p_store_id AND ref_id=voucher_id)<>1 OR NOT EXISTS(SELECT 1 FROM public.cash_movements WHERE store_id=p_store_id AND ref_id=voucher_id AND direction='in' AND cash_box_id=box_id AND amount=amount AND date=receipt_date AND source IN ('voucher','receipt_voucher')) THEN RAISE EXCEPTION 'لم تتطابق حركة الصندوق مع سند القبض';END IF;
 INSERT INTO public.journal_entries(store_id,entry_number,date,description,source,ref_id,source_type,source_id,source_number,source_url,accounting_rule,source_module,status,created_by)
 VALUES(p_store_id,'JV-RCP-'||voucher_id::text,receipt_date,description,'voucher',voucher_id,'receipt_voucher',voucher_id,voucher_no,'/dashboard/accounting/receipts/print/'||voucher_id::text,CASE WHEN customer_id IS NULL THEN 'CASH_RECEIPT_OTHER' ELSE 'CUSTOMER_PAYMENT_RECEIVED' END,'TREASURY','posted',actor) RETURNING id INTO journal_id;
 INSERT INTO public.journal_lines(journal_entry_id,account_id,debit,credit,currency,description,sort_order,account_tag_used,source_rule)
 VALUES(journal_id,cash_id,amount,0,curr,description,1,'CASH','CASH_RECEIPT_ATOMIC'),(journal_id,counter_id,0,amount,curr,description,2,CASE WHEN customer_id IS NOT NULL THEN 'CUSTOMER_RECEIVABLE' END,'CASH_RECEIPT_ATOMIC');
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
REVOKE ALL ON FUNCTION public.create_cash_receipt_atomic(uuid,uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_cash_receipt_atomic(uuid,uuid,jsonb) TO authenticated;

-- 4. Update create_cash_payment_atomic
CREATE OR REPLACE FUNCTION public.create_cash_payment_atomic(p_store_id uuid,p_request_id uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
#variable_conflict use_variable
DECLARE
 actor uuid:=auth.uid(); old public.vouchers%ROWTYPE; supplier public.suppliers%ROWTYPE;
 inv public.purchase_invoices%ROWTYPE; box public.cash_boxes%ROWTYPE;
 supplier_id uuid; purchase_id uuid; box_id uuid; counter_id uuid; cash_acc uuid;
 voucher_id uuid:=gen_random_uuid(); journal_id uuid; curr text; party text; description text; reference text;
 payment_date date; amount numeric; available numeric; next_no bigint; voucher_no text; ids uuid[]; source_total numeric;
 acc record;
BEGIN
 IF actor IS NULL OR NOT EXISTS(SELECT 1 FROM public.stores WHERE id=p_store_id AND owner_id=actor) AND NOT EXISTS(SELECT 1 FROM public.store_members WHERE store_id=p_store_id AND profile_id=actor AND is_active) THEN RAISE EXCEPTION 'غير مصرح بالصرف لهذا المتجر';END IF;
 IF p_request_id IS NULL OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN RAISE EXCEPTION 'طلب الحفظ غير صحيح';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_store_id::text,54002));
 SELECT * INTO old FROM public.vouchers WHERE store_id=p_store_id AND creation_request_id=p_request_id;
 IF FOUND THEN
  IF old.creation_request_payload IS DISTINCT FROM p_payload THEN RAISE EXCEPTION 'طلب الحفظ سبق استخدامه ببيانات مختلفة';END IF;
  RETURN jsonb_build_object('voucherId',old.id,'voucherNumber',old.voucher_number,'replayed',true);
 END IF;
 IF p_payload->>'partyType' IS NULL OR p_payload->>'partyType' NOT IN ('supplier','other') THEN RAISE EXCEPTION 'حدد نوع الجهة';END IF;
 IF coalesce(p_payload->>'amount','') !~ '^\d+(\.\d{1,2})?$' THEN RAISE EXCEPTION 'أدخل مبلغاً موجباً بمنزلتين عشريتين';END IF;
 amount:=(p_payload->>'amount')::numeric;
 IF amount<=0 OR amount>999999999 THEN RAISE EXCEPTION 'المبلغ خارج الحدود المسموحة';END IF;
 IF coalesce(p_payload->>'date','') !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'تاريخ السند غير صحيح';END IF;
 payment_date:=(p_payload->>'date')::date;
 description:=btrim(p_payload->>'description');reference:=nullif(btrim(p_payload->>'reference'),'');
 IF coalesce(description,'')='' OR length(description)>1000 OR length(reference)>200 THEN RAISE EXCEPTION 'تحقق من البيان والمرجع';END IF;
 PERFORM 1 FROM public.accounting_periods WHERE store_id=p_store_id FOR SHARE;
 IF EXISTS(SELECT 1 FROM public.accounting_periods WHERE store_id=p_store_id AND is_closed AND payment_date BETWEEN start_date AND end_date) THEN RAISE EXCEPTION 'تاريخ الصرف ضمن فترة محاسبية مقفلة';END IF;
 SELECT coalesce(currency_code,'ILS') INTO curr FROM public.stores WHERE id=p_store_id;
 supplier_id:=nullif(p_payload->>'supplierId','')::uuid;purchase_id:=nullif(p_payload->>'purchaseId','')::uuid;
 IF p_payload->>'partyType'='supplier' THEN
  SELECT * INTO supplier FROM public.suppliers WHERE id=supplier_id AND store_id=p_store_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'اختر مورداً من المتجر';END IF;
  IF coalesce(supplier.balance,0)::text IN('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'رصيد المورد يحتاج مراجعة';END IF;
  party:=supplier.name;
  IF purchase_id IS NOT NULL THEN
   SELECT * INTO inv FROM public.purchase_invoices WHERE id=purchase_id AND store_id=p_store_id AND purchase_invoices.supplier_id=supplier_id FOR UPDATE;
   IF NOT FOUND OR inv.status<>'completed' OR inv.currency IS DISTINCT FROM curr OR inv.total_amount IS NULL OR inv.paid_amount IS NULL OR inv.total_amount::text IN('NaN','Infinity','-Infinity') OR inv.paid_amount::text IN('NaN','Infinity','-Infinity') OR inv.total_amount<=0 OR inv.paid_amount<0 OR inv.paid_amount>=inv.total_amount THEN RAISE EXCEPTION 'فاتورة الشراء غير متاحة أو لا تخص المورد أو عملتها غير مطابقة';END IF;
   IF EXISTS(SELECT 1 FROM public.purchase_returns WHERE store_id=p_store_id AND purchase_invoice_id=purchase_id AND status='completed') THEN RAISE EXCEPTION 'فاتورة الشراء لها مرتجعات؛ راجع تسويتها قبل ربط الصرف';END IF;
   IF payment_date<inv.invoice_date THEN RAISE EXCEPTION 'تاريخ الصرف لا يسبق فاتورة الشراء';END IF;
   IF amount>inv.total_amount-inv.paid_amount THEN RAISE EXCEPTION 'المبلغ يتجاوز المتبقي على فاتورة الشراء';END IF;
   SELECT array_agg(DISTINCT l.account_id),sum(l.credit-l.debit) INTO ids,source_total FROM public.journal_lines l JOIN public.journal_entries e ON e.id=l.journal_entry_id JOIN public.accounts a ON a.id=l.account_id
   WHERE e.id=inv.journal_entry_id AND e.store_id=p_store_id AND e.status='posted' AND e.ref_id=inv.id AND e.source_type='purchase_invoice' AND a.store_id=p_store_id AND a.account_tag='SUPPLIER_PAYABLE';
   IF coalesce(cardinality(ids),0)<>1 OR source_total IS DISTINCT FROM inv.total_amount THEN RAISE EXCEPTION 'قيد استحقاق فاتورة الشراء يحتاج مطابقة';END IF;
   IF EXISTS(SELECT 1 FROM public.journal_lines WHERE journal_entry_id=inv.journal_entry_id AND currency IS DISTINCT FROM curr) THEN RAISE EXCEPTION 'عملة قيد فاتورة الشراء غير مطابقة';END IF;
   counter_id:=ids[1];
  ELSE
   SELECT array_agg(id) INTO ids FROM public.accounts WHERE store_id=p_store_id AND is_active AND NOT is_group AND account_tag='SUPPLIER_PAYABLE' AND normal_balance='credit' AND currency=curr AND name=party;
   IF coalesce(cardinality(ids),0)=0 THEN SELECT array_agg(id) INTO ids FROM public.accounts WHERE store_id=p_store_id AND is_active AND NOT is_group AND account_tag='SUPPLIER_PAYABLE' AND normal_balance='credit' AND currency=curr;END IF;
   IF coalesce(cardinality(ids),0)<>1 THEN RAISE EXCEPTION 'حساب ذمة المورد غير محدد؛ اربط فاتورة صحيحة أو راجع المحاسب';END IF;
   counter_id:=ids[1];
  END IF;
 ELSE
  IF supplier_id IS NOT NULL OR purchase_id IS NOT NULL THEN RAISE EXCEPTION 'الجهة الأخرى لا ترتبط بمورد أو فاتورة';END IF;
  party:=btrim(p_payload->>'partyName');counter_id:=nullif(p_payload->>'debitAccountId','')::uuid;
  IF coalesce(party,'')='' OR length(party)>200 THEN RAISE EXCEPTION 'أدخل اسم المستفيد';END IF;
 END IF;
 box_id:=nullif(p_payload->>'boxId','')::uuid;
 SELECT * INTO box FROM public.cash_boxes WHERE id=box_id AND store_id=p_store_id AND is_active AND type='cash' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'اختر صندوقاً نقدياً نشطاً من المتجر';END IF;
 IF NOT public.can_access_cash_box(p_store_id, box_id, 'payment') THEN RAISE EXCEPTION 'لا تملك صلاحية الصرف من الصندوق';END IF;
 IF box.opening_balance::text IN('NaN','Infinity','-Infinity') OR EXISTS(SELECT 1 FROM public.cash_movements m WHERE m.cash_box_id=box_id AND (m.amount IS NULL OR m.amount<0 OR m.amount::text IN('NaN','Infinity','-Infinity') OR m.direction NOT IN('in','out') OR m.date IS NULL OR m.store_id<>p_store_id)) THEN RAISE EXCEPTION 'رصيد الصندوق وحركاته يحتاجان مراجعة';END IF;
 WITH daily AS(SELECT m.date,sum(CASE WHEN m.direction='in' THEN m.amount ELSE -m.amount END) delta FROM public.cash_movements m WHERE m.cash_box_id=box_id GROUP BY m.date),
 future AS(SELECT payment_date AS cash_day,coalesce(sum(delta),0) delta FROM daily WHERE date<=payment_date UNION ALL SELECT date,delta FROM daily WHERE date>payment_date)
 SELECT min(box.opening_balance+running) INTO available FROM(SELECT sum(delta) OVER(ORDER BY cash_day ROWS UNBOUNDED PRECEDING) running FROM future) balances;
 IF available IS NULL OR amount>available THEN RAISE EXCEPTION 'المبلغ يتجاوز رصيد الصندوق في تاريخ الصرف أو حركة لاحقة';END IF;
 cash_acc:=box.account_id;
 PERFORM 1 FROM public.accounts WHERE id IN(cash_acc,counter_id) ORDER BY id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.accounts WHERE id IN(cash_acc,counter_id) AND coalesce(balance,0)::text IN('NaN','Infinity','-Infinity')) THEN RAISE EXCEPTION 'رصيد حساب الترحيل يحتاج مراجعة';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.accounts WHERE id=cash_acc AND store_id=p_store_id AND is_active AND NOT is_group AND type='asset' AND currency=curr AND normal_balance='debit' AND account_tag IN('CASH','PETTY_CASH')) THEN RAISE EXCEPTION 'حساب الصندوق أو عملته غير صالح';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.accounts WHERE id=counter_id AND store_id=p_store_id AND is_active AND NOT is_group AND currency=curr AND
  ((p_payload->>'partyType'='supplier' AND account_tag='SUPPLIER_PAYABLE' AND normal_balance='credit') OR (p_payload->>'partyType'='other' AND type IN('expense','asset') AND normal_balance='debit' AND account_tag NOT IN('CASH','PETTY_CASH','BANK','CUSTOMER_RECEIVABLE','SUPPLIER_PAYABLE','CHECKS_PORTFOLIO')))) THEN RAISE EXCEPTION 'الحساب المقابل أو عملته غير صالح';END IF;
 SELECT coalesce(max(substring(voucher_number FROM '^PAY-([0-9]+)$')::bigint),0)+1 INTO next_no FROM public.vouchers WHERE store_id=p_store_id;
 voucher_no:='PAY-'||lpad(next_no::text,greatest(4,length(next_no::text)),'0');
 INSERT INTO public.vouchers(id,store_id,voucher_number,type,date,amount,cash_amount,checks_amount,supplier_id,party_name,payment_method,cash_box_id,purchase_invoice_id,category,description,reference,created_by)
 VALUES(voucher_id,p_store_id,voucher_no,'payment',payment_date,amount,amount,0,supplier_id,party,'cash',box_id,purchase_id,CASE WHEN supplier_id IS NULL THEN 'صرف لجهة أخرى' ELSE 'سداد ذمة مورد' END,description,reference,actor);
 IF (SELECT count(*) FROM public.cash_movements WHERE store_id=p_store_id AND ref_id=voucher_id)<>1 OR NOT EXISTS(SELECT 1 FROM public.cash_movements WHERE store_id=p_store_id AND ref_id=voucher_id AND direction='out' AND cash_box_id=box_id AND amount=amount AND date=payment_date AND source IN('voucher','payment_voucher')) THEN RAISE EXCEPTION 'لم تتطابق حركة الصندوق مع سند الصرف';END IF;
 INSERT INTO public.journal_entries(store_id,entry_number,date,description,source,ref_id,source_type,source_id,source_number,source_url,accounting_rule,source_module,status,created_by)
 VALUES(p_store_id,'JV-PAY-'||voucher_id::text,payment_date,description,'voucher',voucher_id,'payment_voucher',voucher_id,voucher_no,'/dashboard/accounting/payments/print/'||voucher_id::text,CASE WHEN supplier_id IS NULL THEN 'CASH_PAYMENT_OTHER' ELSE 'SUPPLIER_PAYMENT_MADE' END,'TREASURY','posted',actor) RETURNING id INTO journal_id;
 INSERT INTO public.journal_lines(journal_entry_id,account_id,debit,credit,currency,description,sort_order,account_tag_used,source_rule)
 VALUES(journal_id,counter_id,amount,0,curr,description,1,CASE WHEN supplier_id IS NOT NULL THEN 'SUPPLIER_PAYABLE' END,'CASH_PAYMENT_ATOMIC'),(journal_id,cash_acc,0,amount,curr,description,2,'CASH','CASH_PAYMENT_ATOMIC');
 FOR acc IN SELECT account_id,sum(debit) debit,sum(credit) credit FROM public.journal_lines WHERE journal_entry_id=journal_id GROUP BY account_id LOOP
  UPDATE public.accounts SET balance=coalesce(balance,0)+CASE WHEN normal_balance='credit' THEN acc.credit-acc.debit ELSE acc.debit-acc.credit END WHERE id=acc.account_id;
 END LOOP;
 IF supplier_id IS NOT NULL THEN
  UPDATE public.suppliers SET balance=coalesce(balance,0)-amount WHERE id=supplier_id;
 END IF;
 IF purchase_id IS NOT NULL THEN UPDATE public.purchase_invoices SET paid_amount=inv.paid_amount+amount WHERE id=purchase_id;END IF;
 UPDATE public.vouchers SET journal_entry_id=journal_id,creation_request_id=p_request_id,creation_request_payload=p_payload WHERE id=voucher_id;
 INSERT INTO public.financial_audit_log(store_id,entity_type,entity_id,entity_label,action,actor_id,details)
 VALUES(p_store_id,'voucher',voucher_id,voucher_no,'create',actor,jsonb_build_object('requestId',p_request_id,'amount',amount,'purchaseId',purchase_id,'atomic',true));
 RETURN jsonb_build_object('voucherId',voucher_id,'voucherNumber',voucher_no,'replayed',false);
END $$;
REVOKE ALL ON FUNCTION public.create_cash_payment_atomic(uuid,uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_cash_payment_atomic(uuid,uuid,jsonb) TO authenticated;

-- 5. Update issued and endorsed cheque payments to allow accountants
CREATE OR REPLACE FUNCTION public.create_issued_cheque_payment_atomic(p_store_id uuid,p_request_id uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
#variable_conflict use_variable
DECLARE
 actor uuid:=auth.uid(); old public.vouchers%ROWTYPE; supplier public.suppliers%ROWTYPE;
 inv public.purchase_invoices%ROWTYPE; portfolio public.cash_boxes%ROWTYPE; box public.cash_boxes%ROWTYPE;
 bank public.bank_accounts%ROWTYPE; supplier_id uuid; purchase_id uuid; portfolio_id uuid; box_id uuid;
 counter_id uuid; payable_acc uuid; cash_acc uuid; voucher_id uuid:=gen_random_uuid(); journal_id uuid;
 curr text; company_name text; party text; description text; reference text; payment_date date;
 cash_amount numeric:=0; cheques_amount numeric:=0; total_amount numeric:=0; available numeric; next_no bigint;
 voucher_no text; ids uuid[]; source_total numeric; role_name text; bank_ids uuid[]:='{}'; bank_accs uuid[]:='{}';
 item jsonb; bank_id uuid; number text; check_amount numeric; issue_date date; due_date date;
 normalized_cheques jsonb:='[]'::jsonb; seen_cheques text[]:='{}'; check_key text; acc record;
BEGIN
 IF actor IS NULL OR NOT EXISTS(SELECT 1 FROM public.stores WHERE id=p_store_id AND owner_id=actor) AND NOT EXISTS(SELECT 1 FROM public.store_members WHERE store_id=p_store_id AND profile_id=actor AND is_active) THEN RAISE EXCEPTION 'غير مصرح بالصرف لهذا المتجر';END IF;
 IF p_request_id IS NULL OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN RAISE EXCEPTION 'طلب الحفظ غير صحيح';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_store_id::text,54003));
 SELECT * INTO old FROM public.vouchers WHERE store_id=p_store_id AND creation_request_id=p_request_id;
 IF FOUND THEN
  IF old.creation_request_payload IS DISTINCT FROM p_payload THEN RAISE EXCEPTION 'طلب الحفظ سبق استخدامه ببيانات مختلفة';END IF;
  RETURN jsonb_build_object('voucherId',old.id,'voucherNumber',old.voucher_number,'replayed',true);
 END IF;
 IF p_payload->>'partyType' IS NULL OR p_payload->>'partyType' NOT IN ('supplier','other') THEN RAISE EXCEPTION 'حدد نوع الجهة';END IF;
 IF p_payload->>'method' IS NULL OR p_payload->>'method' NOT IN ('cheque','split') THEN RAISE EXCEPTION 'اختر شيكات أو صرفاً مختلطاً';END IF;
 IF coalesce(p_payload->>'date','') !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'تاريخ السند غير صحيح';END IF;
 payment_date:=(p_payload->>'date')::date;
 description:=btrim(p_payload->>'description');reference:=nullif(btrim(p_payload->>'reference'),'');
 IF coalesce(description,'')='' OR length(description)>1000 OR length(reference)>200 THEN RAISE EXCEPTION 'تحقق من البيان والمرجع';END IF;
 PERFORM 1 FROM public.accounting_periods WHERE store_id=p_store_id FOR SHARE;
 IF EXISTS(SELECT 1 FROM public.accounting_periods WHERE store_id=p_store_id AND is_closed AND payment_date BETWEEN start_date AND end_date) THEN RAISE EXCEPTION 'تاريخ الصرف ضمن فترة محاسبية مقفلة';END IF;
 SELECT coalesce(currency_code,'ILS'),name INTO curr,company_name FROM public.stores WHERE id=p_store_id;
 SELECT role INTO role_name FROM public.store_members WHERE store_id=p_store_id AND profile_id=actor AND is_active LIMIT 1;
 IF NOT EXISTS(SELECT 1 FROM public.stores WHERE id=p_store_id AND owner_id=actor) AND coalesce(role_name,'') NOT IN('owner','admin','accountant') THEN RAISE EXCEPTION 'إصدار شيكات الشركة يتطلب صلاحية المالك أو المدير أو المحاسب';END IF;
 IF jsonb_typeof(p_payload->'cheques') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'أضف شيكات الإصدار';END IF;
 IF jsonb_array_length(p_payload->'cheques') NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'أضف من شيك واحد إلى 50 شيكاً';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_payload->'cheques') c WHERE c->>'source' IS DISTINCT FROM 'issue') THEN RAISE EXCEPTION 'تظهير الوارد غير متاح للحفظ بعد؛ اختر الإصدار فقط';END IF;
 SELECT array_agg(DISTINCT (c->>'bankId')::uuid) INTO bank_ids FROM jsonb_array_elements(p_payload->'cheques') c;
 PERFORM 1 FROM public.bank_accounts WHERE id=ANY(bank_ids) ORDER BY id FOR UPDATE;
 FOR item IN SELECT * FROM jsonb_array_elements(p_payload->'cheques') LOOP
  bank_id:=nullif(item->>'bankId','')::uuid;
  SELECT * INTO bank FROM public.bank_accounts WHERE id=bank_id AND store_id=p_store_id AND is_active AND currency=curr;
  IF NOT FOUND OR coalesce(btrim(bank.bank_name),'')='' OR coalesce(btrim(bank.account_number),'')='' OR length(bank.bank_name)>200 OR length(bank.account_number)>100 THEN RAISE EXCEPTION 'اختر حساب شركة بنكياً نشطاً بعملة المتجر وبيانات مكتملة';END IF;
  bank_accs:=array_append(bank_accs,bank.account_id);
  number:=btrim(item->>'number');
  IF coalesce(number,'')='' OR length(number)>100 THEN RAISE EXCEPTION 'أدخل رقم الشيك ضمن الحدود';END IF;
  check_key:=bank_id::text||'|'||lower(number);
  IF check_key=ANY(seen_cheques) THEN RAISE EXCEPTION 'رقم الشيك مكرر في السند للحساب البنكي نفسه';END IF;
  seen_cheques:=array_append(seen_cheques,check_key);
  IF EXISTS(SELECT 1 FROM public.checks WHERE store_id=p_store_id AND type='issued' AND bank_account_id=bank_id AND check_number=number) THEN RAISE EXCEPTION 'رقم الشيك مسجل سابقاً للحساب البنكي نفسه';END IF;
  IF coalesce(item->>'amount','') !~ '^\d+(\.\d{1,2})?$' THEN RAISE EXCEPTION 'أدخل مبلغ شيك موجباً بمنزلتين عشريتين';END IF;
  check_amount:=(item->>'amount')::numeric;
  IF check_amount<=0 OR check_amount>999999999 THEN RAISE EXCEPTION 'مبلغ الشيك خارج الحدود المسموحة';END IF;
  IF coalesce(item->>'issueDate','') !~ '^\d{4}-\d{2}-\d{2}$' OR coalesce(item->>'dueDate','') !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'تواريخ الشيك غير صحيحة';END IF;
  issue_date:=(item->>'issueDate')::date;due_date:=(item->>'dueDate')::date;
  IF issue_date>payment_date THEN RAISE EXCEPTION 'تاريخ إصدار الشيك لا يلحق تاريخ السند';END IF;
  IF due_date<issue_date THEN RAISE EXCEPTION 'تاريخ استحقاق الشيك لا يسبق تاريخ إصداره';END IF;
  cheques_amount:=cheques_amount+check_amount;
  normalized_cheques:=normalized_cheques||jsonb_build_array(jsonb_build_object('source','issue','bankId',bank_id,'bankName',bank.bank_name,'bankAccountId',bank.account_id,'accountNumber',bank.account_number,'number',number,'amount',check_amount,'issueDate',issue_date,'dueDate',due_date,'currency',curr));
 END LOOP;
 IF p_payload->>'method'='split' THEN
  IF coalesce(p_payload->>'amount','') !~ '^\d+(\.\d{1,2})?$' THEN RAISE EXCEPTION 'أدخل مبلغاً نقدياً موجباً بمنزلتين عشريتين';END IF;
  cash_amount:=(p_payload->>'amount')::numeric;
  IF cash_amount<=0 OR cash_amount>999999999 THEN RAISE EXCEPTION 'المبلغ النقدي خارج الحدود المسموحة';END IF;
 ELSIF coalesce(p_payload->>'amount','0') NOT IN ('','0','0.00') OR nullif(p_payload->>'boxId','') IS NOT NULL THEN RAISE EXCEPTION 'صرف الشيكات الصافية لا يتضمن صندوقاً أو مبلغاً نقدياً';END IF;
 total_amount:=cash_amount+cheques_amount;
 IF total_amount<=0 OR total_amount>999999999 THEN RAISE EXCEPTION 'إجمالي السند خارج الحدود المسموحة';END IF;
 supplier_id:=nullif(p_payload->>'supplierId','')::uuid;purchase_id:=nullif(p_payload->>'purchaseId','')::uuid;
 IF p_payload->>'partyType'='supplier' THEN
  SELECT * INTO supplier FROM public.suppliers WHERE id=supplier_id AND store_id=p_store_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'اختر مورداً من المتجر';END IF;
  IF coalesce(supplier.balance,0)::text IN('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'رصيد المورد يحتاج مراجعة';END IF;
  party:=supplier.name;
  IF purchase_id IS NOT NULL THEN
   SELECT * INTO inv FROM public.purchase_invoices WHERE id=purchase_id AND store_id=p_store_id AND purchase_invoices.supplier_id=supplier_id FOR UPDATE;
   IF NOT FOUND OR inv.status<>'completed' OR inv.currency IS DISTINCT FROM curr OR inv.total_amount IS NULL OR inv.paid_amount IS NULL OR inv.total_amount::text IN('NaN','Infinity','-Infinity') OR inv.paid_amount::text IN('NaN','Infinity','-Infinity') OR inv.total_amount<=0 OR inv.paid_amount<0 OR inv.paid_amount>=inv.total_amount THEN RAISE EXCEPTION 'فاتورة الشراء غير متاحة أو لا تخص المورد أو عملتها غير مطابقة';END IF;
   IF EXISTS(SELECT 1 FROM public.purchase_returns WHERE store_id=p_store_id AND purchase_invoice_id=purchase_id AND status='completed') THEN RAISE EXCEPTION 'فاتورة الشراء لها مرتجعات؛ راجع تسويتها قبل ربط الصرف';END IF;
   IF payment_date<inv.invoice_date THEN RAISE EXCEPTION 'تاريخ الصرف لا يسبق فاتورة الشراء';END IF;
   IF total_amount>inv.total_amount-inv.paid_amount THEN RAISE EXCEPTION 'إجمالي الصرف يتجاوز المتبقي على فاتورة الشراء';END IF;
   SELECT array_agg(DISTINCT l.account_id),sum(l.credit-l.debit) INTO ids,source_total FROM public.journal_lines l JOIN public.journal_entries e ON e.id=l.journal_entry_id JOIN public.accounts a ON a.id=l.account_id
   WHERE e.id=inv.journal_entry_id AND e.store_id=p_store_id AND e.status='posted' AND e.ref_id=inv.id AND e.source_type='purchase_invoice' AND a.store_id=p_store_id AND a.account_tag='SUPPLIER_PAYABLE';
   IF coalesce(cardinality(ids),0)<>1 OR source_total IS DISTINCT FROM inv.total_amount THEN RAISE EXCEPTION 'قيد استحقاق فاتورة الشراء يحتاج مطابقة';END IF;
   IF EXISTS(SELECT 1 FROM public.journal_lines WHERE journal_entry_id=inv.journal_entry_id AND currency IS DISTINCT FROM curr) THEN RAISE EXCEPTION 'عملة قيد فاتورة الشراء غير مطابقة';END IF;
   counter_id:=ids[1];
  ELSE
   SELECT array_agg(id) INTO ids FROM public.accounts WHERE store_id=p_store_id AND is_active AND NOT is_group AND account_tag='SUPPLIER_PAYABLE' AND normal_balance='credit' AND currency=curr AND name=party;
   IF coalesce(cardinality(ids),0)=0 THEN SELECT array_agg(id) INTO ids FROM public.accounts WHERE store_id=p_store_id AND is_active AND NOT is_group AND account_tag='SUPPLIER_PAYABLE' AND normal_balance='credit' AND currency=curr;END IF;
   IF coalesce(cardinality(ids),0)<>1 THEN RAISE EXCEPTION 'حساب ذمة المورد غير محدد؛ اربط فاتورة صحيحة أو راجع المحاسب';END IF;
   counter_id:=ids[1];
  END IF;
 ELSE
  IF supplier_id IS NOT NULL OR purchase_id IS NOT NULL THEN RAISE EXCEPTION 'الجهة الأخرى لا ترتبط بمورد أو فاتورة';END IF;
  party:=btrim(p_payload->>'partyName');counter_id:=nullif(p_payload->>'debitAccountId','')::uuid;
  IF coalesce(party,'')='' OR length(party)>200 THEN RAISE EXCEPTION 'أدخل اسم المستفيد';END IF;
 END IF;
 portfolio_id:=nullif(p_payload->>'issuedPortfolioId','')::uuid;
 SELECT * INTO portfolio FROM public.cash_boxes WHERE id=portfolio_id AND store_id=p_store_id AND is_active AND type='checks_issued';
 IF NOT FOUND THEN RAISE EXCEPTION 'اختر محفظة شيكات صادرة نشطة';END IF;
 payable_acc:=portfolio.account_id;
 IF cash_amount>0 THEN
  box_id:=nullif(p_payload->>'boxId','')::uuid;
  SELECT * INTO box FROM public.cash_boxes WHERE id=box_id AND store_id=p_store_id AND is_active AND type='cash' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'اختر صندوقاً نقدياً نشطاً من المتجر';END IF;
  IF NOT public.can_access_cash_box(p_store_id, box_id, 'payment') THEN RAISE EXCEPTION 'لا تملك صلاحية الصرف من الصندوق';END IF;
  IF box.opening_balance::text IN('NaN','Infinity','-Infinity') OR EXISTS(SELECT 1 FROM public.cash_movements m WHERE m.cash_box_id=box_id AND (m.amount IS NULL OR m.amount<0 OR m.amount::text IN('NaN','Infinity','-Infinity') OR m.direction NOT IN('in','out') OR m.date IS NULL OR m.store_id<>p_store_id)) THEN RAISE EXCEPTION 'رصيد الصندوق وحركاته يحتاجان مراجعة';END IF;
  WITH daily AS(SELECT m.date,sum(CASE WHEN m.direction='in' THEN m.amount ELSE -m.amount END) delta FROM public.cash_movements m WHERE m.cash_box_id=box_id GROUP BY m.date),
  future AS(SELECT payment_date AS cash_day,coalesce(sum(delta),0) delta FROM daily WHERE date<=payment_date UNION ALL SELECT date,delta FROM daily WHERE date>payment_date)
  SELECT min(box.opening_balance+running) INTO available FROM(SELECT sum(delta) OVER(ORDER BY cash_day ROWS UNBOUNDED PRECEDING) running FROM future) balances;
  IF available IS NULL OR cash_amount>available THEN RAISE EXCEPTION 'المبلغ يتجاوز رصيد الصندوق في تاريخ الصرف أو حركة لاحقة';END IF;
  cash_acc:=box.account_id;
 END IF;
 PERFORM 1 FROM public.accounts WHERE id=ANY(array_cat(ARRAY[cash_acc,counter_id,payable_acc],bank_accs)) ORDER BY id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.accounts WHERE id=ANY(array_cat(ARRAY[cash_acc,counter_id,payable_acc],bank_accs)) AND coalesce(balance,0)::text IN('NaN','Infinity','-Infinity')) THEN RAISE EXCEPTION 'رصيد حساب الترحيل يحتاج مراجعة';END IF;
 IF cash_amount>0 AND NOT EXISTS(SELECT 1 FROM public.accounts WHERE id=cash_acc AND store_id=p_store_id AND is_active AND NOT is_group AND type='asset' AND currency=curr AND normal_balance='debit' AND account_tag IN('CASH','PETTY_CASH')) THEN RAISE EXCEPTION 'حساب الصندوق أو عملته غير صالح';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.accounts WHERE id=payable_acc AND store_id=p_store_id AND is_active AND NOT is_group AND type='liability' AND currency=curr AND normal_balance='credit' AND account_tag='CHECKS_PAYABLE') THEN RAISE EXCEPTION 'حساب محفظة الصادر أو عملته غير صالح';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.accounts WHERE id=counter_id AND store_id=p_store_id AND is_active AND NOT is_group AND currency=curr AND
  ((p_payload->>'partyType'='supplier' AND account_tag='SUPPLIER_PAYABLE' AND normal_balance='credit') OR (p_payload->>'partyType'='other' AND type IN('expense','asset') AND normal_balance='debit' AND account_tag NOT IN('CASH','PETTY_CASH','BANK','CUSTOMER_RECEIVABLE','SUPPLIER_PAYABLE','CHECKS_PORTFOLIO')))) THEN RAISE EXCEPTION 'الحساب المقابل أو عملته غير صالح';END IF;
 SELECT coalesce(max(substring(voucher_number FROM '^PAY-([0-9]+)$')::bigint),0)+1 INTO next_no FROM public.vouchers WHERE store_id=p_store_id;
 voucher_no:='PAY-'||lpad(next_no::text,greatest(4,length(next_no::text)),'0');
 INSERT INTO public.vouchers(id,store_id,voucher_number,type,date,amount,cash_amount,checks_amount,supplier_id,party_name,payment_method,cash_box_id,purchase_invoice_id,category,description,reference,created_by,checks_data)
 VALUES(voucher_id,p_store_id,voucher_no,'payment',payment_date,total_amount,cash_amount,cheques_amount,supplier_id,party,p_payload->>'method',CASE WHEN cash_amount>0 THEN box_id ELSE portfolio_id END,purchase_id,CASE WHEN supplier_id IS NULL THEN 'صرف لجهة أخرى' ELSE 'سداد ذمة مورد' END,description,reference,actor,normalized_cheques);
 IF cash_amount>0 AND ((SELECT count(*) FROM public.cash_movements WHERE store_id=p_store_id AND ref_id=voucher_id)<>1 OR NOT EXISTS(SELECT 1 FROM public.cash_movements WHERE store_id=p_store_id AND ref_id=voucher_id AND direction='out' AND cash_box_id=box_id AND amount=cash_amount AND date=payment_date AND source IN('voucher','payment_voucher'))) THEN RAISE EXCEPTION 'لم تتطابق حركة الصندوق مع سند الصرف';END IF;
 FOR item IN SELECT * FROM jsonb_array_elements(normalized_cheques) LOOP
  INSERT INTO public.checks(store_id,voucher_id,cashbox_id,check_number,bank_name,account_number,drawer_name,amount,currency,issue_date,due_date,status,type,bank_account_id)
  VALUES(p_store_id,voucher_id,portfolio_id,item->>'number',item->>'bankName',item->>'accountNumber',company_name,(item->>'amount')::numeric,curr,(item->>'issueDate')::date,(item->>'dueDate')::date,'under_collection','issued',(item->>'bankId')::uuid);
 END LOOP;
 INSERT INTO public.journal_entries(store_id,entry_number,date,description,source,ref_id,source_type,source_id,source_number,source_url,accounting_rule,source_module,status,created_by)
 VALUES(p_store_id,'JV-PAY-'||voucher_id::text,payment_date,description,'voucher',voucher_id,'payment_voucher',voucher_id,voucher_no,'/dashboard/accounting/payments/print/'||voucher_id::text,CASE WHEN supplier_id IS NULL THEN 'CHEQUE_PAYMENT_OTHER' ELSE 'SUPPLIER_CHEQUE_PAYMENT_MADE' END,'TREASURY','posted',actor) RETURNING id INTO journal_id;
 INSERT INTO public.journal_lines(journal_entry_id,account_id,debit,credit,currency,description,sort_order,account_tag_used,source_rule)
 VALUES(journal_id,counter_id,total_amount,0,curr,description,1,CASE WHEN supplier_id IS NOT NULL THEN 'SUPPLIER_PAYABLE' END,'ISSUED_CHEQUE_PAYMENT_ATOMIC');
 IF cash_amount>0 THEN
  INSERT INTO public.journal_lines(journal_entry_id,account_id,debit,credit,currency,description,sort_order,account_tag_used,source_rule)
  VALUES(journal_id,cash_acc,0,cash_amount,curr,description,2,'CASH','ISSUED_CHEQUE_PAYMENT_ATOMIC');
 END IF;
 INSERT INTO public.journal_lines(journal_entry_id,account_id,debit,credit,currency,description,sort_order,account_tag_used,source_rule)
 VALUES(journal_id,payable_acc,0,cheques_amount,curr,description,CASE WHEN cash_amount>0 THEN 3 ELSE 2 END,'CHECKS_PAYABLE','ISSUED_CHEQUE_PAYMENT_ATOMIC');
 FOR acc IN SELECT account_id,sum(debit) debit,sum(credit) credit FROM public.journal_lines WHERE journal_entry_id=journal_id GROUP BY account_id LOOP
  UPDATE public.accounts SET balance=coalesce(balance,0)+CASE WHEN normal_balance='credit' THEN acc.credit-acc.debit ELSE acc.debit-acc.credit END WHERE id=acc.account_id;
 END LOOP;
 IF supplier_id IS NOT NULL THEN
  UPDATE public.suppliers SET balance=coalesce(balance,0)-total_amount WHERE id=supplier_id;
 END IF;
 IF purchase_id IS NOT NULL THEN UPDATE public.purchase_invoices SET paid_amount=inv.paid_amount+total_amount WHERE id=purchase_id;END IF;
 UPDATE public.vouchers SET journal_entry_id=journal_id,creation_request_id=p_request_id,creation_request_payload=p_payload WHERE id=voucher_id;
 INSERT INTO public.financial_audit_log(store_id,entity_type,entity_id,entity_label,action,actor_id,details)
 VALUES(p_store_id,'voucher',voucher_id,voucher_no,'create',actor,jsonb_build_object('requestId',p_request_id,'amount',total_amount,'purchaseId',purchase_id,'atomic',true,'issuedCheques',jsonb_array_length(normalized_cheques)));
 RETURN jsonb_build_object('voucherId',voucher_id,'voucherNumber',voucher_no,'replayed',false);
END $$;
REVOKE ALL ON FUNCTION public.create_issued_cheque_payment_atomic(uuid,uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_issued_cheque_payment_atomic(uuid,uuid,jsonb) TO authenticated;

NOTIFY pgrst,'reload schema';
COMMIT;
