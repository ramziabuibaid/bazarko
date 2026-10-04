BEGIN;
-- Metadata finalization must not rewrite an unchanged cash movement.
DROP TRIGGER IF EXISTS trg_voucher_cash_upd ON public.vouchers;
CREATE TRIGGER trg_voucher_cash_upd AFTER UPDATE ON public.vouchers FOR EACH ROW
WHEN (ROW(OLD.payment_method,OLD.cash_amount,OLD.amount,OLD.cash_box_id,OLD.type,OLD.party_name,OLD.description,OLD.date,OLD.store_id)
 IS DISTINCT FROM ROW(NEW.payment_method,NEW.cash_amount,NEW.amount,NEW.cash_box_id,NEW.type,NEW.party_name,NEW.description,NEW.date,NEW.store_id))
EXECUTE FUNCTION public.voucher_update_cash_movement();
-- Every cash movement writer participates in the box lock, including legacy writers.
CREATE OR REPLACE FUNCTION public.lock_cash_movement_box() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE old_box uuid; new_box uuid;
BEGIN
 IF TG_OP<>'INSERT' THEN old_box:=OLD.cash_box_id;END IF;
 IF TG_OP<>'DELETE' THEN new_box:=NEW.cash_box_id;END IF;
 PERFORM 1 FROM public.cash_boxes WHERE id IN(old_box,new_box) ORDER BY id FOR UPDATE;
 IF TG_OP<>'INSERT' AND EXISTS(SELECT 1 FROM public.vouchers WHERE id=OLD.ref_id AND type='payment' AND creation_request_id IS NOT NULL) THEN RAISE EXCEPTION 'حركة صرف ذرية؛ يلزم مسار عكس مستقل';END IF;
 IF TG_OP<>'DELETE' AND EXISTS(SELECT 1 FROM public.vouchers WHERE id=NEW.ref_id AND type='payment' AND creation_request_id IS NOT NULL) THEN RAISE EXCEPTION 'لا يمكن إضافة حركة إلى سند صرف مكتمل';END IF;
 IF TG_OP='DELETE' THEN RETURN OLD;END IF;RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS lock_cash_movement_box ON public.cash_movements;
CREATE TRIGGER lock_cash_movement_box BEFORE INSERT OR UPDATE OR DELETE ON public.cash_movements FOR EACH ROW EXECUTE FUNCTION public.lock_cash_movement_box();
CREATE OR REPLACE FUNCTION public.create_cash_payment_atomic(p_store_id uuid,p_request_id uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
#variable_conflict use_variable
DECLARE
 actor uuid:=auth.uid(); old public.vouchers%ROWTYPE; supplier public.suppliers%ROWTYPE; inv public.purchase_invoices%ROWTYPE; box public.cash_boxes%ROWTYPE;
 supplier_id uuid; purchase_id uuid; box_id uuid; counter_id uuid; cash_acc uuid; ids uuid[]; source_total numeric;
 voucher_id uuid:=gen_random_uuid(); journal_id uuid; curr text; party text; description text; reference text; role_name text;
 payment_date date; amount numeric; available numeric; next_no bigint; voucher_no text; acc record;
BEGIN
 IF actor IS NULL OR NOT EXISTS(SELECT 1 FROM public.stores WHERE id=p_store_id AND owner_id=actor) AND NOT EXISTS(SELECT 1 FROM public.store_members WHERE store_id=p_store_id AND profile_id=actor AND is_active) THEN RAISE EXCEPTION 'غير مصرح بالصرف لهذا المتجر';END IF;
 IF p_request_id IS NULL OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN RAISE EXCEPTION 'طلب الحفظ غير صحيح';END IF;
 -- Purchases and their payment numbering share the same lock.
 PERFORM pg_advisory_xact_lock(hashtextextended(p_store_id::text,55001));
 SELECT * INTO old FROM public.vouchers WHERE store_id=p_store_id AND creation_request_id=p_request_id;
 IF FOUND THEN
  IF old.type<>'payment' OR old.creation_request_payload IS DISTINCT FROM p_payload THEN RAISE EXCEPTION 'طلب الحفظ سبق استخدامه ببيانات مختلفة';END IF;
  RETURN jsonb_build_object('voucherId',old.id,'voucherNumber',old.voucher_number,'replayed',true);
 END IF;
 IF p_payload->>'partyType' IS NULL OR p_payload->>'partyType' NOT IN('supplier','other') THEN RAISE EXCEPTION 'حدد نوع المستفيد';END IF;
 IF coalesce(p_payload->>'amount','') !~ '^\d+(\.\d{1,2})?$' THEN RAISE EXCEPTION 'أدخل مبلغاً موجباً بمنزلتين عشريتين';END IF;
 amount:=(p_payload->>'amount')::numeric;
 IF amount<=0 OR amount>999999999 THEN RAISE EXCEPTION 'المبلغ خارج الحدود المسموحة';END IF;
 IF coalesce(p_payload->>'date','') !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'تاريخ الصرف غير صحيح';END IF;
 payment_date:=(p_payload->>'date')::date;description:=btrim(p_payload->>'description');reference:=nullif(btrim(p_payload->>'reference'),'');
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
 SELECT role INTO role_name FROM public.store_members WHERE store_id=p_store_id AND profile_id=actor AND is_active LIMIT 1;
 IF NOT EXISTS(SELECT 1 FROM public.stores WHERE id=p_store_id AND owner_id=actor) AND coalesce(role_name,'') NOT IN('owner','admin') AND NOT EXISTS(SELECT 1 FROM public.user_cash_box_permissions WHERE store_id=p_store_id AND user_id=actor AND cash_box_id=box_id AND can_payment) THEN RAISE EXCEPTION 'لا تملك صلاحية الصرف من الصندوق';END IF;
 IF box.opening_balance::text IN('NaN','Infinity','-Infinity') OR EXISTS(SELECT 1 FROM public.cash_movements m WHERE m.cash_box_id=box_id AND (m.amount IS NULL OR m.amount<0 OR m.amount::text IN('NaN','Infinity','-Infinity') OR m.direction NOT IN('in','out') OR m.date IS NULL OR m.store_id<>p_store_id)) THEN RAISE EXCEPTION 'رصيد الصندوق وحركاته يحتاجان مراجعة';END IF;
 -- Minimum balance from payment date onward prevents backdating into cash that arrived later.
 WITH daily AS(SELECT m.date,sum(CASE WHEN m.direction='in' THEN m.amount ELSE -m.amount END) delta FROM public.cash_movements m WHERE m.cash_box_id=box_id GROUP BY m.date),
 future AS(SELECT payment_date AS cash_day,coalesce(sum(delta),0) delta FROM daily WHERE date<=payment_date UNION ALL SELECT date,delta FROM daily WHERE date>payment_date)
 SELECT min(box.opening_balance+running) INTO available FROM(SELECT sum(delta) OVER(ORDER BY cash_day ROWS UNBOUNDED PRECEDING) running FROM future) balances;
 IF available IS NULL OR amount>available THEN RAISE EXCEPTION 'المبلغ يتجاوز رصيد الصندوق في تاريخ الصرف أو حركة لاحقة';END IF;
 cash_acc:=box.account_id;
 PERFORM 1 FROM public.accounts WHERE id IN(cash_acc,counter_id) ORDER BY id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.accounts WHERE id IN(cash_acc,counter_id) AND coalesce(balance,0)::text IN('NaN','Infinity','-Infinity')) THEN RAISE EXCEPTION 'رصيد حساب الترحيل يحتاج مراجعة';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.accounts WHERE id=cash_acc AND store_id=p_store_id AND is_active AND NOT is_group AND type='asset' AND currency=curr AND normal_balance='debit' AND account_tag IN('CASH','PETTY_CASH')) THEN RAISE EXCEPTION 'حساب الصندوق أو عملته غير صالح';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.accounts WHERE id=counter_id AND store_id=p_store_id AND is_active AND NOT is_group AND currency=curr AND ((p_payload->>'partyType'='supplier' AND type='liability' AND account_tag='SUPPLIER_PAYABLE' AND normal_balance='credit') OR (p_payload->>'partyType'='other' AND type IN('expense','asset') AND normal_balance='debit' AND coalesce(account_tag,'') NOT IN('CASH','PETTY_CASH','BANK','CUSTOMER_RECEIVABLE','SUPPLIER_PAYABLE','CHECKS_PORTFOLIO')))) THEN RAISE EXCEPTION 'الحساب المقابل أو عملته غير صالح';END IF;
 SELECT coalesce(max(substring(voucher_number FROM '^PAY-([0-9]+)$')::bigint),0)+1 INTO next_no FROM public.vouchers WHERE store_id=p_store_id;
 voucher_no:='PAY-'||lpad(next_no::text,greatest(4,length(next_no::text)),'0');
 INSERT INTO public.vouchers(id,store_id,voucher_number,type,date,amount,cash_amount,checks_amount,supplier_id,party_name,payment_method,cash_box_id,purchase_invoice_id,category,description,reference,created_by)
 VALUES(voucher_id,p_store_id,voucher_no,'payment',payment_date,amount,amount,0,supplier_id,party,'cash',box_id,purchase_id,CASE WHEN supplier_id IS NULL THEN 'صرف لجهة أخرى' ELSE 'دفعة للمورد' END,description,reference,actor);
 IF (SELECT count(*) FROM public.cash_movements WHERE ref_id=voucher_id)<>1 OR NOT EXISTS(SELECT 1 FROM public.cash_movements m WHERE m.store_id=p_store_id AND m.ref_id=voucher_id AND m.cash_box_id=box_id AND m.direction='out' AND m.amount=amount) THEN RAISE EXCEPTION 'لم تتطابق حركة الصندوق مع سند الصرف';END IF;
 INSERT INTO public.journal_entries(store_id,entry_number,date,description,source,ref_id,source_type,source_id,source_number,source_url,accounting_rule,source_module,status,created_by)
 VALUES(p_store_id,'JV-PAY-'||voucher_id::text,payment_date,description,'voucher',voucher_id,'payment_voucher',voucher_id,voucher_no,'/dashboard/accounting/payments/print/'||voucher_id::text,CASE WHEN supplier_id IS NULL THEN 'CASH_PAYMENT_OTHER' ELSE 'SUPPLIER_PAYMENT_MADE' END,'TREASURY','posted',actor) RETURNING id INTO journal_id;
 INSERT INTO public.journal_lines(journal_entry_id,account_id,debit,credit,currency,description,sort_order,account_tag_used,source_rule)
 VALUES(journal_id,counter_id,amount,0,curr,description,1,CASE WHEN supplier_id IS NOT NULL THEN 'SUPPLIER_PAYABLE' END,'CASH_PAYMENT_ATOMIC'),(journal_id,cash_acc,0,amount,curr,description,2,'CASH','CASH_PAYMENT_ATOMIC');
 FOR acc IN SELECT account_id,sum(debit) debit,sum(credit) credit FROM public.journal_lines WHERE journal_entry_id=journal_id GROUP BY account_id LOOP UPDATE public.accounts SET balance=coalesce(balance,0)+CASE WHEN normal_balance='credit' THEN acc.credit-acc.debit ELSE acc.debit-acc.credit END WHERE id=acc.account_id;END LOOP;
 IF supplier_id IS NOT NULL THEN UPDATE public.suppliers SET balance=coalesce(balance,0)-amount WHERE id=supplier_id;END IF;
 IF purchase_id IS NOT NULL THEN UPDATE public.purchase_invoices SET paid_amount=inv.paid_amount+amount,payment_status=CASE WHEN inv.paid_amount+amount=inv.total_amount THEN 'paid' ELSE 'partial' END WHERE id=purchase_id;END IF;
 UPDATE public.vouchers SET journal_entry_id=journal_id,creation_request_id=p_request_id,creation_request_payload=p_payload WHERE id=voucher_id;
 INSERT INTO public.financial_audit_log(store_id,entity_type,entity_id,entity_label,action,actor_id,details) VALUES(p_store_id,'voucher',voucher_id,voucher_no,'create',actor,jsonb_build_object('atomic',true,'requestId',p_request_id,'amount',amount,'purchaseId',purchase_id));
 RETURN jsonb_build_object('voucherId',voucher_id,'voucherNumber',voucher_no,'replayed',false);
END $$;
REVOKE ALL ON FUNCTION public.create_cash_payment_atomic(uuid,uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_cash_payment_atomic(uuid,uuid,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.guard_atomic_cash_receipt() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF OLD.creation_request_id IS NOT NULL THEN
  IF OLD.type='payment' THEN RAISE EXCEPTION 'سند صرف ذري؛ التعديل والحذف يتطلبان مسار عكس ذري مستقل';END IF;
  RAISE EXCEPTION 'سند قبض ذري؛ التعديل والحذف يتطلبان مسار عكس ذري مستقل';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD;END IF;RETURN NEW;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
