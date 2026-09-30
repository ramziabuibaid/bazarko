BEGIN;
ALTER TABLE public.vouchers ADD COLUMN invoice_payment_key uuid;
ALTER TABLE public.vouchers ADD COLUMN invoice_payment_payload jsonb;
CREATE UNIQUE INDEX voucher_invoice_payment_key ON public.vouchers(store_id,invoice_payment_key) WHERE invoice_payment_key IS NOT NULL;
CREATE FUNCTION public.record_invoice_payment_atomic(p_invoice uuid,p_amount numeric,p_method text,p_cashbox uuid,p_bank uuid,p_confirmed boolean,p_key uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE inv public.invoices%ROWTYPE; old_v public.vouchers%ROWTYPE; actor uuid; vid uuid:=gen_random_uuid(); number text; destination uuid; ar uuid; remaining numeric; new_balance numeric; rule text;
 payload jsonb:=jsonb_build_object('amount',p_amount,'method',p_method,'cashbox',p_cashbox,'bank',p_bank,'confirmed',p_confirmed);
BEGIN
 SELECT * INTO inv FROM public.invoices WHERE id=p_invoice;
 IF NOT FOUND THEN RAISE EXCEPTION 'الفاتورة غير موجودة'; END IF;
 actor:=public.assert_financial_permission(inv.store_id,'post');
 PERFORM pg_advisory_xact_lock(hashtextextended('financial:' || inv.store_id::text,0));
 SELECT * INTO inv FROM public.invoices WHERE id=p_invoice FOR UPDATE;
 IF p_key IS NULL THEN RAISE EXCEPTION 'معرف محاولة الدفع مطلوب'; END IF;
 SELECT * INTO old_v FROM public.vouchers WHERE store_id=inv.store_id AND invoice_payment_key=p_key;
 IF FOUND THEN
   IF old_v.invoice_id IS DISTINCT FROM p_invoice OR old_v.invoice_payment_payload IS DISTINCT FROM payload THEN RAISE EXCEPTION 'معرف الدفع مستخدم بطلب مختلف'; END IF;
   RETURN jsonb_build_object('ok',true,'voucherId',old_v.id);
 END IF;
 IF inv.status='cancelled' THEN RAISE EXCEPTION 'الفاتورة ملغاة'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.journal_entries WHERE id=inv.journal_entry_id AND store_id=inv.store_id AND status='posted' AND ref_id=p_invoice) THEN
   RAISE EXCEPTION 'الفاتورة تحتاج ترحيل مبيعات صحيح قبل التسديد'; END IF;
 IF p_amount IS NULL OR p_amount<=0 OR p_amount<>round(p_amount,2) THEN RAISE EXCEPTION 'مبلغ الدفع غير صالح'; END IF;
 remaining:=COALESCE(inv.total,inv.total_amount,0)-COALESCE(inv.amount_paid,0);
 IF p_amount>remaining THEN RAISE EXCEPTION 'الدفع يتجاوز المتبقي'; END IF;
 IF p_method='cash' THEN
   destination:=public.resolve_financial_account(inv.store_id,'CASH',p_cashbox);
   IF p_cashbox IS NULL THEN SELECT id INTO p_cashbox FROM public.cash_boxes WHERE store_id=inv.store_id AND is_default IS TRUE AND is_active IS TRUE; END IF;
   IF p_cashbox IS NULL THEN RAISE EXCEPTION 'صندوق نقدي نشط مطلوب'; END IF;
 ELSIF p_method IN ('bank','transfer','card') THEN
   IF p_confirmed IS NOT TRUE THEN RAISE EXCEPTION 'التحصيل البنكي يحتاج تأكيداً'; END IF;
   destination:=public.resolve_financial_account(inv.store_id,'BANK',p_bank);
 ELSE RAISE EXCEPTION 'وسيلة الدفع غير صالحة'; END IF;
 ar:=public.resolve_financial_account(inv.store_id,'CUSTOMER_RECEIVABLE',inv.customer_id);
 number:=public.generate_sequence_number(inv.store_id,'RCP2-' || to_char(current_date,'YYYY') || '-');
 INSERT INTO public.vouchers(id,store_id,voucher_number,type,date,amount,customer_id,party_name,payment_method,description,invoice_id,created_by,cash_box_id,bank_account_id,cash_amount,invoice_payment_key,invoice_payment_payload)
 VALUES(vid,inv.store_id,number,'receipt',current_date,p_amount,inv.customer_id,inv.customer_name,p_method,'تسديد فاتورة ' || inv.invoice_number,p_invoice,actor,p_cashbox,p_bank,
   CASE WHEN p_method='cash' THEN p_amount ELSE 0 END,p_key,payload);
 PERFORM public.post_journal_entry_atomic(jsonb_build_object('storeId',inv.store_id,'date',current_date,'description','سند قبض ' || number,
   'source','voucher','refId',vid,'sourceType','receipt_voucher','sourceNumber',number,'accountingRule','CUSTOMER_PAYMENT_RECEIVED','sourceModule','TREASURY',
   'lines',jsonb_build_array(jsonb_build_object('account_id',destination,'debit',p_amount,'credit',0),jsonb_build_object('account_id',ar,'debit',0,'credit',p_amount))));
 UPDATE public.invoices SET amount_paid=COALESCE(amount_paid,0)+p_amount,
   status=CASE WHEN p_amount=remaining THEN 'paid' ELSE 'partial' END,
   paid_at=CASE WHEN p_amount=remaining THEN now() ELSE paid_at END,updated_at=now() WHERE id=p_invoice;
 IF p_bank IS NOT NULL THEN UPDATE public.bank_accounts SET balance=COALESCE(balance,0)+p_amount,updated_at=now() WHERE id=p_bank; END IF;
 IF inv.customer_id IS NOT NULL THEN
   UPDATE public.customers SET balance=COALESCE(balance,0)-p_amount,total_paid=COALESCE(total_paid,0)+p_amount
     WHERE id=inv.customer_id AND store_id=inv.store_id RETURNING balance INTO new_balance;
   INSERT INTO public.customer_ledger(store_id,customer_id,type,date,description,debit,credit,balance,reference_id,reference_type,created_by)
     VALUES(inv.store_id,inv.customer_id,'payment',current_date,'سند قبض ' || number,0,p_amount,new_balance,vid,'voucher',actor);
 END IF;
 INSERT INTO public.financial_audit_log(store_id,entity_type,entity_id,entity_label,action,actor_id,details)
 VALUES(inv.store_id,'invoice',p_invoice,inv.invoice_number,'payment',actor,jsonb_build_object('amount',p_amount,'method',p_method,'voucher_id',vid));
 RETURN jsonb_build_object('ok',true,'voucherId',vid);
END $$;
REVOKE ALL ON FUNCTION public.record_invoice_payment_atomic(uuid,numeric,text,uuid,uuid,boolean,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.record_invoice_payment_atomic(uuid,numeric,text,uuid,uuid,boolean,uuid) TO authenticated;
COMMIT;
