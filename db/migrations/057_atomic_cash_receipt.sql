BEGIN;
ALTER TABLE public.vouchers ADD COLUMN IF NOT EXISTS creation_request_id uuid;
ALTER TABLE public.vouchers ADD COLUMN IF NOT EXISTS creation_request_payload jsonb;
CREATE UNIQUE INDEX IF NOT EXISTS vouchers_creation_request_unique ON public.vouchers(store_id,creation_request_id) WHERE creation_request_id IS NOT NULL;

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
 -- Same store lock as sales-invoice creation; invoice creators and receipts serialize.
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
 box_id:=nullif(p_payload->>'boxId','')::uuid;
 SELECT * INTO box FROM public.cash_boxes WHERE id=box_id AND store_id=p_store_id AND is_active AND type='cash' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'اختر صندوقاً نقدياً نشطاً';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.stores WHERE id=p_store_id AND owner_id=actor)
 AND NOT EXISTS(SELECT 1 FROM public.store_members WHERE store_id=p_store_id AND profile_id=actor AND is_active AND role IN ('owner','admin'))
 AND NOT EXISTS(SELECT 1 FROM public.user_cash_box_permissions WHERE store_id=p_store_id AND user_id=actor AND cash_box_id=box_id AND can_receipt) THEN RAISE EXCEPTION 'لا تملك صلاحية القبض في الصندوق المختار';END IF;
 cash_id:=box.account_id;
 PERFORM 1 FROM public.accounts WHERE id IN (cash_id,counter_id) ORDER BY id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.accounts WHERE id IN (cash_id,counter_id) AND coalesce(balance,0)::text IN ('NaN','Infinity','-Infinity')) THEN RAISE EXCEPTION 'رصيد حساب الترحيل يحتاج مراجعة';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.accounts WHERE id=cash_id AND store_id=p_store_id AND is_active AND NOT is_group AND currency=curr AND normal_balance='debit' AND account_tag IN ('CASH','PETTY_CASH')) THEN RAISE EXCEPTION 'حساب الصندوق أو عملته غير صالح';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.accounts WHERE id=counter_id AND store_id=p_store_id AND is_active AND NOT is_group AND currency=curr AND
  ((p_payload->>'partyType'='customer' AND account_tag='CUSTOMER_RECEIVABLE' AND normal_balance='debit') OR (p_payload->>'partyType'='other' AND type IN ('revenue','liability','equity') AND normal_balance='credit'))) THEN RAISE EXCEPTION 'الحساب المقابل أو عملته غير صالح';END IF;
 SELECT coalesce(max(substring(voucher_number FROM '^RCP-([0-9]+)$')::bigint),0)+1 INTO next_no FROM public.vouchers WHERE store_id=p_store_id;
 voucher_no:='RCP-'||lpad(next_no::text,greatest(4,length(next_no::text)),'0');
 -- Request identity is attached only after all side effects, so the completed voucher can be immutable.
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

CREATE OR REPLACE FUNCTION public.guard_atomic_cash_receipt() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF OLD.creation_request_id IS NOT NULL THEN RAISE EXCEPTION 'سند قبض ذري؛ التعديل والحذف يتطلبان مسار عكس ذري مستقل';END IF;
 IF TG_OP='DELETE' THEN RETURN OLD;END IF;RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS guard_atomic_cash_receipt ON public.vouchers;
CREATE TRIGGER guard_atomic_cash_receipt BEFORE UPDATE OR DELETE ON public.vouchers FOR EACH ROW EXECUTE FUNCTION public.guard_atomic_cash_receipt();
-- Prevent a member from granting themselves cash authority through the old broad policy.
CREATE OR REPLACE FUNCTION public.can_manage_cash_permissions(p_store_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT auth.uid() IS NOT NULL AND (EXISTS(SELECT 1 FROM public.stores WHERE id=p_store_id AND owner_id=auth.uid()) OR EXISTS(SELECT 1 FROM public.store_members WHERE store_id=p_store_id AND profile_id=auth.uid() AND is_active AND role IN ('owner','admin')));
$$;
REVOKE ALL ON FUNCTION public.can_manage_cash_permissions(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_manage_cash_permissions(uuid) TO authenticated;
DROP POLICY IF EXISTS cash_permissions_manager_insert ON public.user_cash_box_permissions;
DROP POLICY IF EXISTS cash_permissions_manager_update ON public.user_cash_box_permissions;
DROP POLICY IF EXISTS cash_permissions_manager_delete ON public.user_cash_box_permissions;
CREATE POLICY cash_permissions_manager_insert ON public.user_cash_box_permissions AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK(public.can_manage_cash_permissions(store_id));
CREATE POLICY cash_permissions_manager_update ON public.user_cash_box_permissions AS RESTRICTIVE FOR UPDATE TO authenticated USING(public.can_manage_cash_permissions(store_id)) WITH CHECK(public.can_manage_cash_permissions(store_id));
CREATE POLICY cash_permissions_manager_delete ON public.user_cash_box_permissions AS RESTRICTIVE FOR DELETE TO authenticated USING(public.can_manage_cash_permissions(store_id));
NOTIFY pgrst,'reload schema';
COMMIT;
