BEGIN;
INSERT INTO public.account_tags(code,name_ar,name_en,allowed_account_type,description,capabilities)
 VALUES('CHEQUES_ISSUED','شيكات صادرة مستحقة','Issued Cheques Payable','liability','شيكات أصدرها المتجر ولم تُحصّل بعد',ARRAY['CHEQUE_PAYMENT'])
 ON CONFLICT(code) DO NOTHING;
ALTER TABLE public.vouchers ADD COLUMN create_key uuid;
ALTER TABLE public.vouchers ADD COLUMN create_payload jsonb;
CREATE UNIQUE INDEX voucher_create_key ON public.vouchers(store_id,create_key) WHERE create_key IS NOT NULL;
CREATE FUNCTION public.create_voucher_atomic(p_store uuid,p_payload jsonb,p_key uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid; old_v public.vouchers%ROWTYPE; inv public.invoices%ROWTYPE; pinv public.purchase_invoices%ROWTYPE;
 vid uuid:=gen_random_uuid(); vnum text; vdate date:=(p_payload->>'date')::date; kind text:=p_payload->>'type';
 method text:=p_payload->>'payment_method'; amount numeric:=(p_payload->>'amount')::numeric;
 cash_amount numeric:=COALESCE((p_payload->>'cash_amount')::numeric,0); check_amount numeric:=COALESCE((p_payload->>'checks_amount')::numeric,0);
 box uuid:=NULLIF(p_payload->>'cash_box_id','')::uuid; bank uuid:=NULLIF(p_payload->>'bank_account_id','')::uuid;
 customer uuid:=NULLIF(p_payload->>'customer_id','')::uuid; supplier uuid:=NULLIF(p_payload->>'supplier_id','')::uuid;
 invoice uuid:=NULLIF(p_payload->>'invoice_id','')::uuid; purchase uuid:=NULLIF(p_payload->>'purchase_invoice_id','')::uuid;
 checks jsonb:=COALESCE(p_payload->'checks','[]'::jsonb); check_item jsonb; seen text[]:='{}';
 cash_account uuid; bank_account uuid; cheque_account uuid; counter_account uuid; lines jsonb:='[]';
 new_balance numeric; remaining numeric; rule text;
BEGIN
 actor:=public.assert_financial_permission(p_store,'post');
 PERFORM pg_advisory_xact_lock(hashtextextended('financial:' || p_store::text,0));
 IF p_key IS NULL THEN RAISE EXCEPTION 'معرف محاولة السند مطلوب'; END IF;
 SELECT * INTO old_v FROM public.vouchers WHERE store_id=p_store AND create_key=p_key;
 IF FOUND THEN
   IF old_v.create_payload IS DISTINCT FROM p_payload THEN RAISE EXCEPTION 'معرف السند مستخدم بطلب مختلف'; END IF;
   RETURN jsonb_build_object('id',old_v.id,'voucher_number',old_v.voucher_number);
 END IF;
 IF kind NOT IN ('receipt','payment') OR method NOT IN ('cash','bank','transfer','cheque','split') OR vdate IS NULL OR
    amount IS NULL OR amount<=0 OR amount<>round(amount,2) OR NULLIF(btrim(p_payload->>'description'),'') IS NULL THEN
   RAISE EXCEPTION 'نوع السند أو تاريخه أو مبلغه غير صالح'; END IF;
 IF customer IS NOT NULL AND supplier IS NOT NULL THEN RAISE EXCEPTION 'السند يرتبط بعميل أو مورد واحد فقط'; END IF;
 IF method NOT IN ('bank','transfer') AND bank IS NOT NULL THEN RAISE EXCEPTION 'لا تربط حساباً بنكياً بسند غير بنكي'; END IF;
 IF method IN ('bank','transfer') AND box IS NOT NULL THEN RAISE EXCEPTION 'لا تربط صندوقاً بسند بنكي'; END IF;
 IF EXISTS(SELECT 1 FROM public.accounting_periods WHERE store_id=p_store AND is_closed AND vdate BETWEEN start_date AND end_date) THEN RAISE EXCEPTION 'الفترة المحاسبية مقفلة'; END IF;
 IF method='cash' THEN cash_amount:=amount;check_amount:=0;
 ELSIF method IN ('bank','transfer') THEN cash_amount:=0;check_amount:=0;
 ELSIF method='cheque' THEN cash_amount:=0;check_amount:=amount;
 END IF;
 IF cash_amount<0 OR check_amount<0 OR cash_amount<>round(cash_amount,2) OR check_amount<>round(check_amount,2) THEN RAISE EXCEPTION 'توزيع السداد غير صالح'; END IF;
 IF method='split' AND (cash_amount<=0 OR check_amount<=0 OR cash_amount+check_amount<>amount) THEN RAISE EXCEPTION 'المبلغ النقدي والشيكات لا يطابقان السند'; END IF;
 IF kind='payment' AND check_amount>0 THEN RAISE EXCEPTION 'صرف شيك صادر يحتاج دورة إصدار وتسوية مستقلة؛ استخدم تحويلًا مؤكداً أو نقداً'; END IF;
 IF check_amount>0 THEN
   IF jsonb_typeof(checks)<>'array' OR jsonb_array_length(checks)=0 THEN RAISE EXCEPTION 'بيانات الشيكات مطلوبة'; END IF;
   IF (SELECT COALESCE(sum((x->>'amount')::numeric),0) FROM jsonb_array_elements(checks) x)<>check_amount THEN RAISE EXCEPTION 'إجمالي الشيكات غير مطابق'; END IF;
   FOR check_item IN SELECT value FROM jsonb_array_elements(checks) LOOP
     IF NULLIF(btrim(check_item->>'check_number'),'') IS NULL OR NULLIF(btrim(check_item->>'bank_name'),'') IS NULL OR
        NULLIF(check_item->>'due_date','') IS NULL OR (check_item->>'amount')::numeric<=0 OR check_item->>'check_number'=ANY(seen) THEN RAISE EXCEPTION 'بيانات شيك غير صالحة أو مكررة'; END IF;
     PERFORM (check_item->>'due_date')::date;
     seen:=array_append(seen,check_item->>'check_number');
   END LOOP;
 ELSIF checks<>'[]'::jsonb THEN RAISE EXCEPTION 'الشيكات لا تطابق وسيلة الدفع'; END IF;
 IF customer IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.customers WHERE id=customer AND store_id=p_store) THEN RAISE EXCEPTION 'العميل لا يتبع المتجر'; END IF;
 IF supplier IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.suppliers WHERE id=supplier AND store_id=p_store) THEN RAISE EXCEPTION 'المورد لا يتبع المتجر'; END IF;
 IF invoice IS NOT NULL THEN
   IF kind<>'receipt' OR customer IS NULL THEN RAISE EXCEPTION 'ربط فاتورة المبيعات يتطلب سند قبض للعميل'; END IF;
   SELECT * INTO inv FROM public.invoices WHERE id=invoice AND store_id=p_store FOR UPDATE;
   IF NOT FOUND OR inv.customer_id IS DISTINCT FROM customer OR inv.status='cancelled' THEN RAISE EXCEPTION 'الفاتورة لا تطابق العميل'; END IF;
   remaining:=COALESCE(inv.total,inv.total_amount,0)-COALESCE(inv.amount_paid,0);
   IF amount>remaining THEN RAISE EXCEPTION 'السند يتجاوز متبقي الفاتورة'; END IF;
 END IF;
 IF purchase IS NOT NULL THEN
   IF kind<>'payment' OR supplier IS NULL THEN RAISE EXCEPTION 'ربط فاتورة الشراء يتطلب سند صرف للمورد'; END IF;
   SELECT * INTO pinv FROM public.purchase_invoices WHERE id=purchase AND store_id=p_store FOR UPDATE;
   IF NOT FOUND OR pinv.supplier_id IS DISTINCT FROM supplier THEN RAISE EXCEPTION 'فاتورة الشراء لا تطابق المورد'; END IF;
   remaining:=COALESCE(pinv.total_amount,0)-COALESCE(pinv.paid_amount,0);
   IF amount>remaining THEN RAISE EXCEPTION 'السند يتجاوز متبقي فاتورة الشراء'; END IF;
 END IF;
 IF invoice IS NOT NULL AND purchase IS NOT NULL THEN RAISE EXCEPTION 'لا يمكن ربط سند واحد بفاتورتي بيع وشراء'; END IF;
 IF cash_amount>0 THEN
   cash_account:=public.resolve_financial_account(p_store,'CASH',box);
   IF box IS NULL THEN SELECT id INTO box FROM public.cash_boxes WHERE store_id=p_store AND account_id=cash_account AND is_active IS TRUE LIMIT 1; END IF;
   IF box IS NULL THEN RAISE EXCEPTION 'الصندوق النقدي النشط مطلوب'; END IF;
   IF EXISTS(SELECT 1 FROM public.user_cash_box_permissions WHERE store_id=p_store AND user_id=actor) AND
      NOT EXISTS(SELECT 1 FROM public.store_members WHERE store_id=p_store AND profile_id=actor AND role IN ('owner','admin')) AND
      NOT EXISTS(SELECT 1 FROM public.user_cash_box_permissions WHERE store_id=p_store AND user_id=actor AND cash_box_id=box AND
        CASE WHEN kind='receipt' THEN can_receipt ELSE can_payment END) THEN RAISE EXCEPTION 'لا تملك صلاحية الصندوق المحدد'; END IF;
 END IF;
 IF method IN ('bank','transfer') THEN
   IF bank IS NULL THEN RAISE EXCEPTION 'الحساب البنكي مطلوب'; END IF;
   bank_account:=public.resolve_financial_account(p_store,'BANK',bank);
 END IF;
 IF check_amount>0 THEN cheque_account:=public.resolve_financial_account(p_store,CASE WHEN kind='receipt' THEN 'CHEQUES_IN_HAND' ELSE 'CHEQUES_ISSUED' END); END IF;
 IF kind='receipt' THEN
   counter_account:=public.resolve_financial_account(p_store,CASE WHEN customer IS NOT NULL THEN 'CUSTOMER_RECEIVABLE' ELSE 'OTHER_REVENUE' END,customer);
   rule:=CASE WHEN customer IS NOT NULL THEN 'CUSTOMER_PAYMENT_RECEIVED' ELSE 'OTHER_RECEIPT' END;
 ELSE
   counter_account:=public.resolve_financial_account(p_store,CASE WHEN supplier IS NOT NULL THEN 'SUPPLIER_PAYABLE' ELSE 'GENERAL_EXPENSE' END,supplier);
   rule:=CASE WHEN supplier IS NOT NULL THEN 'SUPPLIER_PAYMENT_MADE' ELSE 'GENERAL_PAYMENT' END;
 END IF;
 vnum:=public.generate_sequence_number(p_store,CASE WHEN kind='receipt' THEN 'RCP2-' ELSE 'PAY2-' END || to_char(vdate,'YYYY') || '-');
 INSERT INTO public.vouchers(id,store_id,voucher_number,type,date,amount,cash_amount,checks_amount,checks_data,cash_box_id,bank_account_id,
   customer_id,supplier_id,invoice_id,purchase_invoice_id,party_name,payment_method,category,description,reference,created_by,
   create_key,create_payload,invoice_payment_key,invoice_payment_payload)
 VALUES(vid,p_store,vnum,kind,vdate,amount,cash_amount,check_amount,checks,box,bank,customer,supplier,invoice,purchase,
   NULLIF(btrim(p_payload->>'party_name'),''),method,p_payload->>'category',p_payload->>'description',p_payload->>'reference',actor,
   p_key,p_payload,CASE WHEN invoice IS NOT NULL THEN p_key END,CASE WHEN invoice IS NOT NULL THEN p_payload END);
 IF kind='receipt' THEN
   IF cash_amount>0 THEN lines:=lines || jsonb_build_array(jsonb_build_object('account_id',cash_account,'debit',cash_amount,'credit',0)); END IF;
   IF check_amount>0 THEN lines:=lines || jsonb_build_array(jsonb_build_object('account_id',cheque_account,'debit',check_amount,'credit',0)); END IF;
   IF bank_account IS NOT NULL THEN lines:=lines || jsonb_build_array(jsonb_build_object('account_id',bank_account,'debit',amount,'credit',0)); END IF;
   lines:=lines || jsonb_build_array(jsonb_build_object('account_id',counter_account,'debit',0,'credit',amount));
 ELSE
   lines:=jsonb_build_array(jsonb_build_object('account_id',counter_account,'debit',amount,'credit',0));
   IF cash_amount>0 THEN lines:=lines || jsonb_build_array(jsonb_build_object('account_id',cash_account,'debit',0,'credit',cash_amount)); END IF;
   IF check_amount>0 THEN lines:=lines || jsonb_build_array(jsonb_build_object('account_id',cheque_account,'debit',0,'credit',check_amount)); END IF;
   IF bank_account IS NOT NULL THEN lines:=lines || jsonb_build_array(jsonb_build_object('account_id',bank_account,'debit',0,'credit',amount)); END IF;
 END IF;
 PERFORM public.post_journal_entry_atomic(jsonb_build_object('storeId',p_store,'date',vdate,'description','سند ' || vnum,
   'source','voucher','refId',vid,'sourceType',CASE WHEN kind='receipt' THEN 'receipt_voucher' ELSE 'payment_voucher' END,
   'sourceNumber',vnum,'accountingRule',rule,'sourceModule','TREASURY','lines',lines));
 IF bank IS NOT NULL THEN UPDATE public.bank_accounts SET balance=COALESCE(balance,0)+CASE WHEN kind='receipt' THEN amount ELSE -amount END,updated_at=now() WHERE id=bank; END IF;
 IF customer IS NOT NULL THEN
   UPDATE public.customers SET balance=COALESCE(balance,0)+CASE WHEN kind='receipt' THEN -amount ELSE amount END,
      total_paid=COALESCE(total_paid,0)+CASE WHEN kind='receipt' THEN amount ELSE 0 END WHERE id=customer RETURNING balance INTO new_balance;
   INSERT INTO public.customer_ledger(store_id,customer_id,type,date,description,debit,credit,balance,reference_id,reference_type,created_by)
     VALUES(p_store,customer,CASE WHEN kind='receipt' THEN 'payment' ELSE 'refund' END,vdate,'سند ' || vnum,
       CASE WHEN kind='payment' THEN amount ELSE 0 END,CASE WHEN kind='receipt' THEN amount ELSE 0 END,new_balance,vid,'voucher',actor);
 END IF;
 IF supplier IS NOT NULL THEN
   UPDATE public.suppliers SET balance=COALESCE(balance,0)+CASE WHEN kind='receipt' THEN amount ELSE -amount END WHERE id=supplier RETURNING balance INTO new_balance;
   INSERT INTO public.supplier_ledger(store_id,supplier_id,type,date,description,reference,reference_id,reference_type,debit,credit,balance,created_by)
     VALUES(p_store,supplier,CASE WHEN kind='payment' THEN 'payment' ELSE 'refund' END,vdate,'سند ' || vnum,vnum,vid,'voucher',
       CASE WHEN kind='payment' THEN amount ELSE 0 END,CASE WHEN kind='receipt' THEN amount ELSE 0 END,new_balance,actor);
 END IF;
 IF invoice IS NOT NULL THEN UPDATE public.invoices SET amount_paid=COALESCE(amount_paid,0)+amount,
   status=CASE WHEN amount=remaining THEN 'paid' ELSE 'partial' END,
   paid_at=CASE WHEN amount=remaining THEN now() ELSE paid_at END,updated_at=now() WHERE id=invoice; END IF;
 IF purchase IS NOT NULL THEN UPDATE public.purchase_invoices SET paid_amount=COALESCE(paid_amount,0)+amount,
   payment_status=CASE WHEN amount=remaining THEN 'paid' ELSE 'partial' END,updated_at=now() WHERE id=purchase; END IF;
 INSERT INTO public.financial_audit_log(store_id,entity_type,entity_id,entity_label,action,actor_id,details)
   VALUES(p_store,'voucher',vid,vnum,'create',actor,jsonb_build_object('amount',amount,'method',method,'invoice',invoice,'purchase',purchase));
 RETURN jsonb_build_object('id',vid,'voucher_number',vnum);
END $$;
REVOKE ALL ON FUNCTION public.create_voucher_atomic(uuid,jsonb,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_voucher_atomic(uuid,jsonb,uuid) TO authenticated;
COMMIT;
