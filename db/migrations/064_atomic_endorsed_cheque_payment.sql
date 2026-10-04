BEGIN;
DROP TRIGGER IF EXISTS trg_voucher_sync_checks ON public.vouchers;
CREATE TRIGGER trg_voucher_sync_checks AFTER INSERT OR UPDATE OF checks_data,amount,customer_id,cash_box_id ON public.vouchers FOR EACH ROW WHEN(NEW.creation_request_id IS NULL) EXECUTE FUNCTION public.sync_voucher_checks_to_portfolio();
CREATE OR REPLACE FUNCTION public.create_cheque_payment_atomic(p_store_id uuid,p_request_id uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
#variable_conflict use_variable
DECLARE
 actor uuid:=auth.uid(); old public.vouchers%ROWTYPE; supplier public.suppliers%ROWTYPE; inv public.purchase_invoices%ROWTYPE; box public.cash_boxes%ROWTYPE;
 supplier_id uuid; purchase_id uuid; box_id uuid; counter_id uuid; cash_acc uuid; portfolio public.cash_boxes%ROWTYPE; portfolio_id uuid; payable_acc uuid; bank public.bank_accounts%ROWTYPE; bank_id uuid; bank_ids uuid[]:='{}'; bank_accs uuid[]:='{}'; check_data jsonb:='[]'; item jsonb; cash_amount numeric; cheque_amount numeric:=0; method text; check_amount numeric; number text; seen text[]:='{}'; issue_date date; due_date date; ids uuid[]; source_total numeric; incoming_ids uuid[]:='{}'; incoming_accounts uuid[]:='{}'; incoming_boxes uuid[]:='{}'; incoming_amount numeric:=0; issued_amount numeric:=0; issued_data jsonb:='[]'; incoming_check public.checks%ROWTYPE; receipt public.vouchers%ROWTYPE; check_id uuid; has_issued boolean;
 voucher_id uuid:=gen_random_uuid(); journal_id uuid; curr text; company_name text; party text; description text; reference text; role_name text;
 payment_date date; amount numeric; available numeric; next_no bigint; voucher_no text; acc record;
BEGIN
 IF actor IS NULL OR NOT EXISTS(SELECT 1 FROM public.stores WHERE id=p_store_id AND owner_id=actor) AND NOT EXISTS(SELECT 1 FROM public.store_members WHERE store_id=p_store_id AND profile_id=actor AND is_active) THEN RAISE EXCEPTION 'غير مصرح بالصرف لهذا المتجر';END IF;
 IF p_request_id IS NULL OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN RAISE EXCEPTION 'طلب الحفظ غير صحيح';END IF;
 -- Purchases and their payment numbering share the same lock.
 PERFORM pg_advisory_xact_lock(hashtextextended(p_store_id::text,55001));
 PERFORM pg_advisory_xact_lock(hashtextextended(p_store_id::text,54001));
 SELECT * INTO old FROM public.vouchers WHERE store_id=p_store_id AND creation_request_id=p_request_id;
 IF FOUND THEN
  IF old.type<>'payment' OR old.payment_method NOT IN('cheque','split') OR old.creation_request_payload IS DISTINCT FROM p_payload THEN RAISE EXCEPTION 'طلب الحفظ سبق استخدامه ببيانات مختلفة';END IF;
  RETURN jsonb_build_object('voucherId',old.id,'voucherNumber',old.voucher_number,'replayed',true);
 END IF;
 IF p_payload->>'partyType' IS NULL OR p_payload->>'partyType' NOT IN('supplier','other') THEN RAISE EXCEPTION 'حدد نوع المستفيد';END IF;
 method:=p_payload->>'method';
 IF method IS NULL OR method NOT IN('cheque','split') THEN RAISE EXCEPTION 'اختر صرف شيكات أو صرفاً مختلطاً';END IF;
 IF coalesce(p_payload->>'amount','') !~ '^\d+(\.\d{1,2})?$' THEN RAISE EXCEPTION 'راجع الجزء النقدي';END IF;
 cash_amount:=(p_payload->>'amount')::numeric;
 IF (method='cheque' AND cash_amount<>0) OR (method='split' AND cash_amount<=0) OR cash_amount>999999999 THEN RAISE EXCEPTION 'راجع الجزء النقدي للصرف';END IF;
 IF coalesce(p_payload->>'date','') !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'تاريخ الصرف غير صحيح';END IF;
 payment_date:=(p_payload->>'date')::date;description:=btrim(p_payload->>'description');reference:=nullif(btrim(p_payload->>'reference'),'');
 IF coalesce(description,'')='' OR length(description)>1000 OR length(reference)>200 THEN RAISE EXCEPTION 'تحقق من البيان والمرجع';END IF;
 PERFORM 1 FROM public.accounting_periods WHERE store_id=p_store_id FOR SHARE;
 IF EXISTS(SELECT 1 FROM public.accounting_periods WHERE store_id=p_store_id AND is_closed AND payment_date BETWEEN start_date AND end_date) THEN RAISE EXCEPTION 'تاريخ الصرف ضمن فترة محاسبية مقفلة';END IF;
 SELECT coalesce(currency_code,'ILS'),name INTO curr,company_name FROM public.stores WHERE id=p_store_id;
 -- Bank accounts are selected from trusted rows; the payload cannot override their identity.
 SELECT role INTO role_name FROM public.store_members WHERE store_id=p_store_id AND profile_id=actor AND is_active LIMIT 1;

 IF jsonb_typeof(p_payload->'cheques') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'أضف شيكات الإصدار';END IF;
 IF jsonb_array_length(p_payload->'cheques') NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'أضف من شيك واحد إلى 50 شيكاً';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_payload->'cheques') c WHERE coalesce(c->>'source','') NOT IN('issue','endorse')) THEN RAISE EXCEPTION 'حدد مصدر كل شيك';END IF;
 has_issued:=EXISTS(SELECT 1 FROM jsonb_array_elements(p_payload->'cheques') c WHERE c->>'source'='issue');
 IF has_issued AND NOT EXISTS(SELECT 1 FROM public.stores WHERE id=p_store_id AND owner_id=actor) AND coalesce(role_name,'') NOT IN('owner','admin') THEN RAISE EXCEPTION 'إصدار شيكات الشركة يتطلب صلاحية المالك أو المدير';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_payload->'cheques') c WHERE c->>'source'='endorse') AND p_payload->>'partyType'<>'supplier' THEN RAISE EXCEPTION 'التظهير متاح لمورد مسجل فقط';END IF;
 SELECT array_agg(nullif(c->>'checkId','')::uuid) INTO incoming_ids FROM jsonb_array_elements(p_payload->'cheques') c WHERE c->>'source'='endorse';
 IF array_position(incoming_ids,NULL) IS NOT NULL THEN RAISE EXCEPTION 'اختر شيك قبض مرتبطاً ومتاحاً للتظهير';END IF;
 IF coalesce(cardinality(incoming_ids),0)<>(SELECT count(DISTINCT id) FROM unnest(incoming_ids) id) THEN RAISE EXCEPTION 'الشيك الوارد مكرر داخل السند';END IF;
 PERFORM 1 FROM public.checks WHERE id=ANY(incoming_ids) ORDER BY id FOR UPDATE;
 -- Lock selected banks in a stable order, before their ledger accounts.
 SELECT array_agg(DISTINCT (c->>'bankId')::uuid) INTO bank_ids FROM jsonb_array_elements(p_payload->'cheques') c WHERE c->>'source'='issue';
 PERFORM 1 FROM public.bank_accounts WHERE id=ANY(bank_ids) ORDER BY id FOR UPDATE;
 FOR item IN SELECT * FROM jsonb_array_elements(p_payload->'cheques') LOOP
  IF item->>'source'='endorse' THEN
   check_id:=nullif(item->>'checkId','')::uuid;
   SELECT * INTO incoming_check FROM public.checks WHERE id=check_id AND store_id=p_store_id;
   IF NOT FOUND OR incoming_check.type<>'received' OR incoming_check.status<>'in_portfolio' OR incoming_check.receipt_settlement_active IS DISTINCT FROM true OR incoming_check.payment_voucher_id IS NOT NULL OR incoming_check.endorsed_supplier_id IS NOT NULL THEN RAISE EXCEPTION 'اختر شيك قبض مرتبطاً ومتاحاً للتظهير من المتجر';END IF;
   SELECT * INTO receipt FROM public.vouchers WHERE id=incoming_check.voucher_id AND store_id=p_store_id;
   IF NOT FOUND OR receipt.type<>'receipt' OR receipt.creation_request_id IS NULL OR receipt.journal_entry_id IS NULL OR receipt.cheque_portfolio_id IS DISTINCT FROM incoming_check.cashbox_id OR receipt.customer_id IS DISTINCT FROM incoming_check.customer_id OR receipt.invoice_id IS DISTINCT FROM incoming_check.receipt_invoice_id THEN RAISE EXCEPTION 'ربط سند قبض الشيك يحتاج مراجعة';END IF;
   IF incoming_check.issue_date IS NULL OR incoming_check.due_date IS NULL OR incoming_check.issue_date>payment_date OR receipt.date>payment_date OR incoming_check.due_date<incoming_check.issue_date THEN RAISE EXCEPTION 'تاريخ التظهير لا يسبق إصدار الشيك أو قبضه';END IF;
   IF incoming_check.amount IS NULL OR incoming_check.amount::text IN('NaN','Infinity','-Infinity') OR incoming_check.amount<=0 OR incoming_check.amount>999999999 OR incoming_check.amount<>round(incoming_check.amount,2) OR incoming_check.currency IS DISTINCT FROM curr OR incoming_check.exchange_rate IS DISTINCT FROM 1::numeric OR coalesce(btrim(incoming_check.check_number),'')='' OR coalesce(btrim(incoming_check.bank_name),'')='' OR coalesce(btrim(incoming_check.account_number),'')='' THEN RAISE EXCEPTION 'قيمة أو بيانات أو عملة الشيك الوارد تحتاج مراجعة';END IF;
   IF NOT EXISTS(SELECT 1 FROM public.journal_entries WHERE id=receipt.journal_entry_id AND store_id=p_store_id AND ref_id=receipt.id AND source='voucher' AND status='posted') OR NOT EXISTS(SELECT 1 FROM public.journal_lines WHERE journal_entry_id=receipt.journal_entry_id AND account_id=incoming_check.receipt_counter_account_id AND credit=receipt.amount AND currency=curr) OR NOT EXISTS(SELECT 1 FROM public.journal_lines WHERE journal_entry_id=receipt.journal_entry_id AND account_id=incoming_check.receipt_portfolio_account_id AND debit=receipt.checks_amount AND currency=curr) THEN RAISE EXCEPTION 'قيد القبض الأصلي يحتاج مطابقة';END IF;
   incoming_boxes:=array_append(incoming_boxes,incoming_check.cashbox_id);incoming_accounts:=array_append(incoming_accounts,incoming_check.receipt_portfolio_account_id);
   incoming_amount:=incoming_amount+incoming_check.amount;cheque_amount:=cheque_amount+incoming_check.amount;
   check_data:=check_data||jsonb_build_array(jsonb_build_object('source','endorse','check_id',incoming_check.id,'check_number',incoming_check.check_number,'bank_name',incoming_check.bank_name,'account_number',incoming_check.account_number,'drawer_name',incoming_check.drawer_name,'amount',incoming_check.amount,'currency',curr,'exchange_rate',1,'date',incoming_check.issue_date,'issue_date',incoming_check.issue_date,'due_date',incoming_check.due_date));
   CONTINUE;
  END IF;
  bank_id:=nullif(item->>'bankId','')::uuid;
  SELECT * INTO bank FROM public.bank_accounts WHERE id=bank_id AND store_id=p_store_id AND is_active AND currency=curr;
  IF NOT FOUND OR coalesce(btrim(bank.bank_name),'')='' OR coalesce(btrim(bank.account_number),'')='' OR length(bank.bank_name)>200 OR length(bank.account_number)>100 THEN RAISE EXCEPTION 'اختر حساب شركة بنكياً نشطاً بعملة المتجر وبيانات مكتملة';END IF;
  bank_accs:=array_append(bank_accs,bank.account_id);
  number:=btrim(item->>'number');
  IF coalesce(number,'')='' OR length(number)>100 THEN RAISE EXCEPTION 'أدخل رقم الشيك ضمن الحدود';END IF;
  -- Existing voucher and issued-bank indexes are deliberately preserved.
  IF lower(number)=ANY(seen) THEN RAISE EXCEPTION 'رقم الشيك مكرر داخل السند';END IF;seen:=array_append(seen,lower(number));
  IF EXISTS(SELECT 1 FROM public.checks ch WHERE ch.store_id=p_store_id AND ch.type='issued' AND lower(btrim(ch.bank_name))=lower(btrim(bank.bank_name)) AND lower(btrim(ch.check_number))=lower(number)) THEN RAISE EXCEPTION 'رقم الشيك صادر مسبقاً لدى البنك نفسه';END IF;
  IF coalesce(item->>'amount','') !~ '^\d+(\.\d{1,2})?$' THEN RAISE EXCEPTION 'أدخل قيمة شيك موجبة بمنزلتين عشريتين';END IF;
  check_amount:=(item->>'amount')::numeric;
  IF check_amount<=0 OR check_amount>999999999 THEN RAISE EXCEPTION 'قيمة الشيك خارج الحدود';END IF;
  IF coalesce(item->>'issueDate','') !~ '^\d{4}-\d{2}-\d{2}$' OR coalesce(item->>'dueDate','') !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'راجع إصدار الشيك واستحقاقه';END IF;
  issue_date:=(item->>'issueDate')::date;due_date:=(item->>'dueDate')::date;
  IF issue_date>payment_date OR due_date<issue_date THEN RAISE EXCEPTION 'راجع إصدار الشيك واستحقاقه';END IF;
  cheque_amount:=cheque_amount+check_amount;
  check_data:=check_data||jsonb_build_array(jsonb_build_object('check_number',number,'bank_name',btrim(bank.bank_name),'bank_code',bank.bank_code,'branch_name',bank.branch_name,'drawer_name',company_name,'account_number',btrim(bank.account_number),'amount',check_amount,'currency',curr,'exchange_rate',1,'date',issue_date,'issue_date',issue_date,'due_date',due_date,'payment_bank_account_id',bank_id,'source','issue'));
 END LOOP;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(check_data) c GROUP BY lower(btrim(c->>'check_number')),lower(btrim(c->>'bank_name')),lower(btrim(c->>'account_number')) HAVING count(*)>1) THEN RAISE EXCEPTION 'بيانات الشيك مكررة داخل السند';END IF;
 issued_amount:=cheque_amount-incoming_amount;
 SELECT coalesce(jsonb_agg(c),'[]'::jsonb) INTO issued_data FROM jsonb_array_elements(check_data) c WHERE c->>'source'='issue';
 amount:=cash_amount+cheque_amount;
 IF amount>999999999 THEN RAISE EXCEPTION 'إجمالي السند خارج الحدود';END IF;
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
 SELECT jsonb_agg(c||jsonb_build_object('payee_name',party)) INTO check_data FROM jsonb_array_elements(check_data) c;
 SELECT coalesce(jsonb_agg(c),'[]'::jsonb) INTO issued_data FROM jsonb_array_elements(check_data) c WHERE c->>'source'='issue';
 portfolio_id:=nullif(p_payload->>'issuedPortfolioId','')::uuid;
 box_id:=nullif(p_payload->>'boxId','')::uuid;
 PERFORM 1 FROM public.cash_boxes WHERE id=ANY(array_cat(incoming_boxes,ARRAY[portfolio_id,CASE WHEN cash_amount>0 THEN box_id END])) ORDER BY id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.checks c WHERE c.id=ANY(incoming_ids) AND NOT EXISTS(SELECT 1 FROM public.cash_boxes b WHERE b.id=c.cashbox_id AND b.store_id=p_store_id AND b.is_active AND b.type='checks_received' AND b.account_id=c.receipt_portfolio_account_id)) THEN RAISE EXCEPTION 'محفظة الشيك الوارد غير صالحة';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.stores WHERE id=p_store_id AND owner_id=actor) AND coalesce(role_name,'') NOT IN('owner','admin') AND EXISTS(SELECT 1 FROM unnest(incoming_boxes) b WHERE NOT EXISTS(SELECT 1 FROM public.user_cash_box_permissions WHERE store_id=p_store_id AND user_id=actor AND cash_box_id=b AND can_payment)) THEN RAISE EXCEPTION 'لا تملك صلاحية التظهير من المحفظة';END IF;
 IF has_issued THEN
 SELECT * INTO portfolio FROM public.cash_boxes WHERE id=portfolio_id AND store_id=p_store_id AND is_active AND type='checks_issued';
 IF NOT FOUND THEN RAISE EXCEPTION 'اختر محفظة شيكات صادرة نشطة';END IF;
 payable_acc:=portfolio.account_id;
 ELSE portfolio_id:=incoming_boxes[1];END IF;
 IF cash_amount>0 THEN
 box_id:=nullif(p_payload->>'boxId','')::uuid;
 SELECT * INTO box FROM public.cash_boxes WHERE id=box_id AND store_id=p_store_id AND is_active AND type='cash' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'اختر صندوقاً نقدياً نشطاً من المتجر';END IF;
 SELECT role INTO role_name FROM public.store_members WHERE store_id=p_store_id AND profile_id=actor AND is_active LIMIT 1;
 IF NOT EXISTS(SELECT 1 FROM public.stores WHERE id=p_store_id AND owner_id=actor) AND coalesce(role_name,'') NOT IN('owner','admin') AND NOT EXISTS(SELECT 1 FROM public.user_cash_box_permissions WHERE store_id=p_store_id AND user_id=actor AND cash_box_id=box_id AND can_payment) THEN RAISE EXCEPTION 'لا تملك صلاحية الصرف من الصندوق';END IF;
 IF box.opening_balance::text IN('NaN','Infinity','-Infinity') OR EXISTS(SELECT 1 FROM public.cash_movements m WHERE m.cash_box_id=box_id AND (m.amount IS NULL OR m.amount<0 OR m.amount::text IN('NaN','Infinity','-Infinity') OR m.direction NOT IN('in','out') OR m.date IS NULL OR m.store_id<>p_store_id)) THEN RAISE EXCEPTION 'رصيد الصندوق وحركاته يحتاجان مراجعة';END IF;
 -- Minimum balance from payment date onward prevents backdating into cash that arrived later.
 WITH daily AS(SELECT m.date,sum(CASE WHEN m.direction='in' THEN m.amount ELSE -m.amount END) delta FROM public.cash_movements m WHERE m.cash_box_id=box_id GROUP BY m.date),
 future AS(SELECT payment_date AS cash_day,coalesce(sum(delta),0) delta FROM daily WHERE date<=payment_date UNION ALL SELECT date,delta FROM daily WHERE date>payment_date)
 SELECT min(box.opening_balance+running) INTO available FROM(SELECT sum(delta) OVER(ORDER BY cash_day ROWS UNBOUNDED PRECEDING) running FROM future) balances;
 IF available IS NULL OR cash_amount>available THEN RAISE EXCEPTION 'المبلغ يتجاوز رصيد الصندوق في تاريخ الصرف أو حركة لاحقة';END IF;
 cash_acc:=box.account_id;
 END IF;
 PERFORM 1 FROM public.accounts WHERE id=ANY(array_cat(ARRAY[cash_acc,counter_id,payable_acc],array_cat(bank_accs,incoming_accounts))) ORDER BY id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.accounts WHERE id=ANY(array_cat(ARRAY[cash_acc,counter_id,payable_acc],array_cat(bank_accs,incoming_accounts))) AND coalesce(balance,0)::text IN('NaN','Infinity','-Infinity')) THEN RAISE EXCEPTION 'رصيد حساب الترحيل يحتاج مراجعة';END IF;
 IF cash_amount>0 AND NOT EXISTS(SELECT 1 FROM public.accounts WHERE id=cash_acc AND store_id=p_store_id AND is_active AND NOT is_group AND type='asset' AND currency=curr AND normal_balance='debit' AND account_tag IN('CASH','PETTY_CASH')) THEN RAISE EXCEPTION 'حساب الصندوق أو عملته غير صالح';END IF;
 IF has_issued AND NOT EXISTS(SELECT 1 FROM public.accounts WHERE id=payable_acc AND store_id=p_store_id AND is_active AND NOT is_group AND type='liability' AND currency=curr AND normal_balance='credit' AND account_tag='CHECKS_PAYABLE') THEN RAISE EXCEPTION 'حساب محفظة الصادر أو عملته غير صالح';END IF;
 IF EXISTS(SELECT 1 FROM public.bank_accounts b WHERE b.id=ANY(bank_ids) AND NOT EXISTS(SELECT 1 FROM public.accounts a WHERE a.id=b.account_id AND a.store_id=p_store_id AND a.is_active AND NOT a.is_group AND a.type='asset' AND a.currency=curr AND a.normal_balance='debit' AND a.account_tag='BANK')) THEN RAISE EXCEPTION 'حساب البنك المحاسبي أو عملته غير صالح';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.accounts WHERE id=counter_id AND store_id=p_store_id AND is_active AND NOT is_group AND currency=curr AND ((p_payload->>'partyType'='supplier' AND type='liability' AND account_tag='SUPPLIER_PAYABLE' AND normal_balance='credit') OR (p_payload->>'partyType'='other' AND type IN('expense','asset') AND normal_balance='debit' AND coalesce(account_tag,'') NOT IN('CASH','PETTY_CASH','BANK','CUSTOMER_RECEIVABLE','SUPPLIER_PAYABLE','CHECKS_PORTFOLIO')))) THEN RAISE EXCEPTION 'الحساب المقابل أو عملته غير صالح';END IF;
 IF EXISTS(SELECT 1 FROM public.checks c WHERE c.id=ANY(incoming_ids) AND NOT EXISTS(SELECT 1 FROM public.accounts a WHERE a.id=c.receipt_portfolio_account_id AND a.store_id=p_store_id AND a.is_active AND NOT a.is_group AND a.type='asset' AND a.currency=curr AND a.normal_balance='debit' AND a.account_tag='CHECKS_PORTFOLIO')) THEN RAISE EXCEPTION 'حساب محفظة الوارد أو عملته غير صالح';END IF;
 IF EXISTS(SELECT 1 FROM public.checks c JOIN public.accounts a ON a.id=c.receipt_portfolio_account_id WHERE c.id=ANY(incoming_ids) GROUP BY a.id,a.balance HAVING sum(c.amount)>coalesce(a.balance,0)) THEN RAISE EXCEPTION 'رصيد حساب محفظة الوارد لا يغطي التظهير';END IF;
 SELECT coalesce(max(substring(voucher_number FROM '^PAY-([0-9]+)$')::bigint),0)+1 INTO next_no FROM public.vouchers WHERE store_id=p_store_id;
 voucher_no:='PAY-'||lpad(next_no::text,greatest(4,length(next_no::text)),'0');
 INSERT INTO public.vouchers(id,store_id,voucher_number,type,date,amount,cash_amount,checks_amount,supplier_id,party_name,payment_method,cash_box_id,purchase_invoice_id,category,description,reference,created_by,checks_data,cheque_portfolio_id)
 VALUES(voucher_id,p_store_id,voucher_no,'payment',payment_date,amount,cash_amount,cheque_amount,supplier_id,party,method,CASE WHEN cash_amount>0 THEN box_id ELSE portfolio_id END,purchase_id,CASE WHEN supplier_id IS NULL THEN 'صرف لجهة أخرى' ELSE 'دفعة للمورد' END,description,reference,actor,issued_data,portfolio_id);
 IF (SELECT count(*) FROM public.cash_movements m WHERE m.ref_id=voucher_id)<>(CASE WHEN cash_amount>0 THEN 1 ELSE 0 END) OR (cash_amount>0 AND NOT EXISTS(SELECT 1 FROM public.cash_movements m WHERE m.store_id=p_store_id AND m.ref_id=voucher_id AND m.cash_box_id=box_id AND m.direction='out' AND m.amount=cash_amount AND m.date=payment_date)) THEN RAISE EXCEPTION 'لم تتطابق حركة النقد مع السند';END IF;
 IF (SELECT count(*) FROM public.checks ch WHERE ch.store_id=p_store_id AND ch.voucher_id=voucher_id)<>jsonb_array_length(issued_data) OR (SELECT coalesce(sum(ch.amount),0) FROM public.checks ch WHERE ch.store_id=p_store_id AND ch.voucher_id=voucher_id)<>issued_amount THEN RAISE EXCEPTION 'لم تتطابق الشيكات مع السند';END IF;
 INSERT INTO public.journal_entries(store_id,entry_number,date,description,source,ref_id,source_type,source_id,source_number,source_url,accounting_rule,source_module,status,created_by)
 VALUES(p_store_id,'JV-PAY-'||voucher_id::text,payment_date,description,'voucher',voucher_id,'payment_voucher',voucher_id,voucher_no,'/dashboard/accounting/payments/print/'||voucher_id::text,CASE WHEN supplier_id IS NULL THEN 'CHEQUE_PAYMENT_OTHER' ELSE 'SUPPLIER_PAYMENT_MADE' END,'TREASURY','posted',actor) RETURNING id INTO journal_id;
 INSERT INTO public.journal_lines(journal_entry_id,account_id,debit,credit,currency,description,sort_order,account_tag_used,source_rule)
 VALUES(journal_id,counter_id,amount,0,curr,description,1,CASE WHEN supplier_id IS NOT NULL THEN 'SUPPLIER_PAYABLE' END,'CHEQUE_PAYMENT_ATOMIC');
 IF issued_amount>0 THEN INSERT INTO public.journal_lines(journal_entry_id,account_id,debit,credit,currency,description,sort_order,account_tag_used,source_rule) VALUES(journal_id,payable_acc,0,issued_amount,curr,description,2,'CHECKS_PAYABLE','CHEQUE_PAYMENT_ATOMIC');END IF;
 INSERT INTO public.journal_lines(journal_entry_id,account_id,debit,credit,currency,description,sort_order,account_tag_used,source_rule) SELECT journal_id,c.receipt_portfolio_account_id,0,sum(c.amount),curr,description,4,'CHECKS_PORTFOLIO','CHEQUE_PAYMENT_ATOMIC' FROM public.checks c WHERE c.id=ANY(incoming_ids) GROUP BY c.receipt_portfolio_account_id;
 IF cash_amount>0 THEN INSERT INTO public.journal_lines(journal_entry_id,account_id,debit,credit,currency,description,sort_order,account_tag_used,source_rule) VALUES(journal_id,cash_acc,0,cash_amount,curr,description,3,'CASH','CHEQUE_PAYMENT_ATOMIC');END IF;
 FOR item IN SELECT * FROM jsonb_array_elements(issued_data) LOOP
  UPDATE public.checks ch SET cashbox_id=portfolio_id,drawer_name=company_name,payee_name=party,payment_voucher_id=voucher_id,payment_bank_account_id=(item->>'payment_bank_account_id')::uuid,payment_payable_account_id=payable_acc,payment_counter_account_id=counter_id,payment_purchase_id=purchase_id WHERE ch.store_id=p_store_id AND ch.voucher_id=voucher_id AND ch.check_number=item->>'check_number';
 END LOOP;
 UPDATE public.check_operations op SET payment_voucher_id=voucher_id,journal_entry_id=journal_id WHERE op.store_id=p_store_id AND op.check_id IN(SELECT ch.id FROM public.checks ch WHERE ch.payment_voucher_id=voucher_id);
 FOR incoming_check IN SELECT * FROM public.checks WHERE id=ANY(incoming_ids) ORDER BY id LOOP
  INSERT INTO public.check_operations(store_id,check_id,operation_type,from_status,to_status,operation_date,target_supplier_id,journal_entry_id,notes,performed_by,payment_voucher_id) VALUES(p_store_id,incoming_check.id,'endorse','in_portfolio','endorsed',payment_date,supplier_id,journal_id,description,actor,voucher_id);
  UPDATE public.checks SET status='endorsed',endorsed_supplier_id=supplier_id,payment_voucher_id=voucher_id,payment_counter_account_id=counter_id,payment_purchase_id=purchase_id,updated_at=now() WHERE id=incoming_check.id;
 END LOOP;
 IF (SELECT count(*) FROM public.check_operations op WHERE op.payment_voucher_id=voucher_id AND op.journal_entry_id=journal_id)<>jsonb_array_length(check_data) THEN RAISE EXCEPTION 'لم تتطابق عمليات الشيكات مع القيد';END IF;
 FOR acc IN SELECT account_id,sum(debit) debit,sum(credit) credit FROM public.journal_lines WHERE journal_entry_id=journal_id GROUP BY account_id LOOP UPDATE public.accounts SET balance=coalesce(balance,0)+CASE WHEN normal_balance='credit' THEN acc.credit-acc.debit ELSE acc.debit-acc.credit END WHERE id=acc.account_id;END LOOP;
 IF supplier_id IS NOT NULL THEN UPDATE public.suppliers SET balance=coalesce(balance,0)-amount WHERE id=supplier_id;END IF;
 IF purchase_id IS NOT NULL THEN UPDATE public.purchase_invoices SET paid_amount=inv.paid_amount+amount,payment_status=CASE WHEN inv.paid_amount+amount=inv.total_amount THEN 'paid' ELSE 'partial' END WHERE id=purchase_id;END IF;
 UPDATE public.vouchers SET checks_data=check_data,journal_entry_id=journal_id,creation_request_id=p_request_id,creation_request_payload=p_payload WHERE id=voucher_id;
 INSERT INTO public.financial_audit_log(store_id,entity_type,entity_id,entity_label,action,actor_id,details) VALUES(p_store_id,'voucher',voucher_id,voucher_no,'create',actor,jsonb_build_object('atomic',true,'requestId',p_request_id,'amount',amount,'purchaseId',purchase_id));
 RETURN jsonb_build_object('voucherId',voucher_id,'voucherNumber',voucher_no,'replayed',false);
END $$;
REVOKE ALL ON FUNCTION public.create_cheque_payment_atomic(uuid,uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_cheque_payment_atomic(uuid,uuid,jsonb) TO authenticated;


CREATE OR REPLACE FUNCTION public.guard_atomic_payment_cheque() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP<>'INSERT' AND OLD.payment_voucher_id IS NOT NULL THEN RAISE EXCEPTION 'شيك صرف ذري؛ يلزم مسار تسديد أو عكس مرتبط مستقل';END IF;
 IF TG_OP='DELETE' THEN RETURN OLD;END IF;
 IF EXISTS(SELECT 1 FROM public.vouchers v WHERE v.id=NEW.voucher_id AND v.type='payment' AND v.creation_request_id IS NOT NULL) THEN RAISE EXCEPTION 'لا تضف أو تغير شيكاً في سند صرف مكتمل';END IF;
 IF NEW.payment_voucher_id IS NOT NULL OR NEW.payment_bank_account_id IS NOT NULL OR NEW.payment_payable_account_id IS NOT NULL OR NEW.payment_counter_account_id IS NOT NULL OR NEW.payment_purchase_id IS NOT NULL THEN
  IF current_user<>pg_get_userbyid((SELECT proowner FROM pg_proc WHERE oid='public.create_cheque_payment_atomic(uuid,uuid,jsonb)'::regprocedure)) OR NOT EXISTS(SELECT 1 FROM public.vouchers v WHERE v.id=NEW.payment_voucher_id AND (v.id=NEW.voucher_id OR (NEW.type='received' AND NEW.receipt_settlement_active IS TRUE AND NEW.status='endorsed' AND NEW.endorsed_supplier_id=v.supplier_id AND EXISTS(SELECT 1 FROM public.check_operations op WHERE op.check_id=NEW.id AND op.payment_voucher_id=v.id AND op.operation_type='endorse' AND op.to_status='endorsed'))) AND v.store_id=NEW.store_id AND v.type='payment' AND v.payment_method IN('cheque','split') AND v.creation_request_id IS NULL) THEN RAISE EXCEPTION 'لا تغير ربط شيك الصرف الذري مباشرة';END IF;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS guard_atomic_payment_cheque ON public.checks;
CREATE TRIGGER guard_atomic_payment_cheque BEFORE INSERT OR UPDATE OR DELETE ON public.checks FOR EACH ROW EXECUTE FUNCTION public.guard_atomic_payment_cheque();
CREATE OR REPLACE FUNCTION public.guard_payment_cheque_operation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE linked uuid;
BEGIN
 IF TG_OP<>'INSERT' AND OLD.payment_voucher_id IS NOT NULL THEN RAISE EXCEPTION 'عملية إصدار الشيك الذرية لا تقبل التعديل أو الحذف';END IF;
 IF TG_OP='DELETE' THEN RETURN OLD;END IF;
 SELECT payment_voucher_id INTO linked FROM public.checks WHERE id=NEW.check_id;
 IF linked IS NOT NULL OR NEW.payment_voucher_id IS NOT NULL THEN
  IF current_user<>pg_get_userbyid((SELECT proowner FROM pg_proc WHERE oid='public.create_cheque_payment_atomic(uuid,uuid,jsonb)'::regprocedure)) OR (linked IS DISTINCT FROM NEW.payment_voucher_id AND NOT (linked IS NULL AND NEW.operation_type='endorse' AND NEW.from_status='in_portfolio' AND NEW.to_status='endorsed' AND EXISTS(SELECT 1 FROM public.checks c WHERE c.id=NEW.check_id AND c.store_id=NEW.store_id AND c.type='received' AND c.status='in_portfolio' AND c.receipt_settlement_active IS TRUE))) OR NOT EXISTS(SELECT 1 FROM public.vouchers v JOIN public.journal_entries j ON j.ref_id=v.id AND j.id=NEW.journal_entry_id AND j.store_id=v.store_id AND j.status='posted' WHERE v.id=NEW.payment_voucher_id AND v.store_id=NEW.store_id AND (NEW.operation_type<>'endorse' OR (v.supplier_id=NEW.target_supplier_id AND v.date=NEW.operation_date)) AND v.type='payment' AND v.creation_request_id IS NULL) THEN RAISE EXCEPTION 'استخدم مسار عملية شيك الصرف المرتبط';END IF;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS guard_payment_cheque_operation ON public.check_operations;
CREATE TRIGGER guard_payment_cheque_operation BEFORE INSERT OR UPDATE OR DELETE ON public.check_operations FOR EACH ROW EXECUTE FUNCTION public.guard_payment_cheque_operation();
CREATE OR REPLACE FUNCTION public.guard_atomic_receipt_cheque()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP='UPDATE' AND OLD.receipt_settlement_active IS NULL AND NEW.receipt_settlement_active IS NOT NULL AND current_user<>pg_get_userbyid((SELECT proowner FROM pg_proc WHERE oid='public.receipt_cheque_operation_atomic(uuid,uuid,uuid,jsonb,boolean)'::regprocedure)) THEN RAISE EXCEPTION 'لا تغير ربط الشيك الذري مباشرة';END IF;
 IF TG_OP='UPDATE' AND OLD.receipt_settlement_active IS TRUE AND OLD.payment_voucher_id IS NULL AND NEW.payment_voucher_id IS NOT NULL AND NEW.status='endorsed' THEN
  IF current_user<>pg_get_userbyid((SELECT proowner FROM pg_proc WHERE oid='public.create_cheque_payment_atomic(uuid,uuid,jsonb)'::regprocedure)) OR OLD.status<>'in_portfolio' OR
    (to_jsonb(OLD)-ARRAY['status','endorsed_supplier_id','payment_voucher_id','payment_counter_account_id','payment_purchase_id','updated_at']) IS DISTINCT FROM (to_jsonb(NEW)-ARRAY['status','endorsed_supplier_id','payment_voucher_id','payment_counter_account_id','payment_purchase_id','updated_at']) OR
    NOT EXISTS(SELECT 1 FROM public.check_operations op JOIN public.vouchers v ON v.id=op.payment_voucher_id JOIN public.journal_entries j ON j.id=op.journal_entry_id AND j.ref_id=v.id AND j.store_id=v.store_id AND j.status='posted' WHERE op.check_id=OLD.id AND op.store_id=OLD.store_id AND op.payment_voucher_id=NEW.payment_voucher_id AND op.operation_type='endorse' AND op.from_status='in_portfolio' AND op.to_status='endorsed' AND op.target_supplier_id=NEW.endorsed_supplier_id AND v.store_id=OLD.store_id AND v.type='payment' AND v.creation_request_id IS NULL AND v.supplier_id=NEW.endorsed_supplier_id AND op.operation_date=v.date) THEN RAISE EXCEPTION 'استخدم مسار تظهير الوارد الذري المرتبط';END IF;
  RETURN NEW;
 END IF;
 IF OLD.receipt_settlement_active IS NOT NULL THEN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'لا يحذف شيك قبض ذري؛ استخدم مسار الإعادة';END IF;
  IF current_user<>pg_get_userbyid((SELECT proowner FROM pg_proc WHERE oid='public.receipt_cheque_operation_atomic(uuid,uuid,uuid,jsonb,boolean)'::regprocedure)) OR
   (to_jsonb(OLD)-ARRAY['status','receipt_settlement_active','deposit_bank_account_id','updated_at']) IS DISTINCT FROM (to_jsonb(NEW)-ARRAY['status','receipt_settlement_active','deposit_bank_account_id','updated_at']) OR
   OLD.status<>'in_portfolio' OR OLD.receipt_settlement_active IS DISTINCT FROM true OR
   NOT EXISTS(SELECT 1 FROM public.check_operations WHERE check_id=OLD.id AND receipt_request_id IS NOT NULL AND from_status=OLD.status AND to_status=NEW.status AND journal_entry_id IS NOT NULL AND ((operation_type='collect' AND NEW.status='collected' AND NEW.receipt_settlement_active IS TRUE AND target_bank_account_id IS NOT DISTINCT FROM NEW.deposit_bank_account_id) OR (operation_type='return_to_customer' AND NEW.status='returned_to_customer' AND NEW.receipt_settlement_active IS FALSE AND NEW.deposit_bank_account_id IS NOT DISTINCT FROM OLD.deposit_bank_account_id))) THEN RAISE EXCEPTION 'استخدم التحصيل أو الإعادة الذريين للشيك المرتبط';END IF;
 END IF;
 RETURN NEW;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
