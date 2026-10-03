BEGIN;
ALTER TABLE public.financial_audit_log DROP CONSTRAINT IF EXISTS financial_audit_log_entity_type_check;
ALTER TABLE public.financial_audit_log ADD CONSTRAINT financial_audit_log_entity_type_check CHECK (entity_type IN ('invoice','voucher','cash_movement','cash_session','purchase_invoice'));
ALTER TABLE public.purchase_invoices ADD COLUMN IF NOT EXISTS creation_request_id uuid;
ALTER TABLE public.purchase_invoices ADD COLUMN IF NOT EXISTS creation_request_payload jsonb;
CREATE UNIQUE INDEX IF NOT EXISTS purchases_creation_request_unique ON public.purchase_invoices(store_id,creation_request_id) WHERE creation_request_id IS NOT NULL;
CREATE OR REPLACE FUNCTION public.create_purchase_invoice_atomic(p_store_id uuid,p_request_id uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
#variable_conflict use_variable
DECLARE
 actor uuid:=auth.uid(); existing public.purchase_invoices%ROWTYPE; supplier public.suppliers%ROWTYPE; prod public.products%ROWTYPE; box public.cash_boxes%ROWTYPE;
 inv uuid; voucher uuid; journal uuid; payment_journal uuid; inv_acc uuid; payable uuid; cash_acc uuid;
 invoice_no text; voucher_no text; curr text; role_name text; issue date; draft boolean; item jsonb; rec record;
 qty numeric; price numeric; subtotal numeric:=0; discount numeric; tax_rate numeric; tax numeric; total numeric; paid numeric; stock_after numeric; next_no bigint;
BEGIN
 IF actor IS NULL OR NOT public.is_store_member(p_store_id) THEN RAISE EXCEPTION 'غير مصرح بإنشاء فاتورة لهذا المتجر';END IF;
 IF p_request_id IS NULL THEN RAISE EXCEPTION 'معرف طلب الحفظ مطلوب';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_store_id::text,55001));
 SELECT * INTO existing FROM public.purchase_invoices WHERE store_id=p_store_id AND creation_request_id=p_request_id;
 IF FOUND THEN
  IF existing.creation_request_payload IS DISTINCT FROM p_payload THEN RAISE EXCEPTION 'طلب الحفظ سبق استخدامه ببيانات مختلفة';END IF;
  RETURN jsonb_build_object('invoiceId',existing.id,'replayed',true);
 END IF;
 IF p_payload IS NULL OR jsonb_typeof(p_payload->'items') IS DISTINCT FROM 'array' OR jsonb_array_length(p_payload->'items') NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'أضف بين بند واحد و200 بند';END IF;
 IF p_payload->>'mode' IS NULL OR p_payload->>'mode' NOT IN ('draft','post') THEN RAISE EXCEPTION 'حالة الحفظ غير صحيحة';END IF;
 draft:=p_payload->>'mode'='draft';issue:=(p_payload->>'invoice_date')::date;invoice_no:=btrim(p_payload->>'invoice_number');
 IF issue IS NULL OR coalesce(invoice_no,'')='' OR length(invoice_no)>100 THEN RAISE EXCEPTION 'تحقق من رقم الفاتورة وتاريخها';END IF;
 PERFORM 1 FROM public.accounting_periods WHERE store_id=p_store_id FOR SHARE;
 IF NOT draft AND EXISTS(SELECT 1 FROM public.accounting_periods WHERE store_id=p_store_id AND is_closed AND issue BETWEEN start_date AND end_date) THEN RAISE EXCEPTION 'الفترة المحاسبية مقفلة';END IF;
 SELECT * INTO supplier FROM public.suppliers WHERE id=(p_payload->>'supplier_id')::uuid AND store_id=p_store_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'المورد غير موجود في المتجر';END IF;
 SELECT coalesce(currency_code,'ILS') INTO curr FROM public.stores WHERE id=p_store_id;
 PERFORM 1 FROM public.products WHERE store_id=p_store_id AND id IN (SELECT (v->>'product_id')::uuid FROM jsonb_array_elements(p_payload->'items') v) ORDER BY id FOR UPDATE;
 IF (SELECT count(*) FROM jsonb_array_elements(p_payload->'items'))<>(SELECT count(DISTINCT v->>'product_id') FROM jsonb_array_elements(p_payload->'items') v) THEN RAISE EXCEPTION 'الصنف مكرر';END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_payload->'items') LOOP
  qty:=(item->>'quantity')::numeric;price:=(item->>'unit_price')::numeric;
  IF qty IS NULL OR price IS NULL OR qty::text IN ('NaN','Infinity','-Infinity') OR price::text IN ('NaN','Infinity','-Infinity') OR qty<=0 OR qty>999999 OR qty<>round(qty,2) OR price<0 OR price>999999999 OR price<>round(price,2) THEN RAISE EXCEPTION 'الكميات أو التكاليف غير صحيحة';END IF;
  SELECT * INTO prod FROM public.products WHERE id=(item->>'product_id')::uuid AND store_id=p_store_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'الصنف غير موجود في المتجر';END IF;
  IF prod.track_stock AND qty<>trunc(qty) THEN RAISE EXCEPTION 'الصنف المخزني يتطلب كمية صحيحة';END IF;
  subtotal:=subtotal+round(qty*price,2);
 END LOOP;
 discount:=(p_payload->>'discount')::numeric;tax_rate:=(p_payload->>'tax')::numeric;
 IF discount IS NULL OR tax_rate IS NULL OR discount::text IN ('NaN','Infinity','-Infinity') OR tax_rate::text IN ('NaN','Infinity','-Infinity') OR discount<0 OR discount>subtotal OR discount<>round(discount,2) OR tax_rate<0 OR tax_rate>100 OR tax_rate<>round(tax_rate,2) THEN RAISE EXCEPTION 'الخصم أو الضريبة غير صحيح';END IF;
 -- Recoverable VAT needs a separate configured account and policy; fail closed for now.
 IF tax_rate<>0 THEN RAISE EXCEPTION 'الضريبة غير مدعومة في الترحيل الحالي؛ يلزم إعداد حساب ضريبة المشتريات أولاً';END IF;
 tax:=round((subtotal-discount)*tax_rate/100,2);total:=subtotal-discount+tax;
 IF total<=0 THEN RAISE EXCEPTION 'الإجمالي يجب أن يكون موجباً';END IF;
 IF p_payload->>'method' IS NULL OR p_payload->>'method' NOT IN ('credit','cash','partial') THEN RAISE EXCEPTION 'طريقة الدفع غير صحيحة';END IF;
 paid:=CASE WHEN draft OR p_payload->>'method'='credit' THEN 0 WHEN p_payload->>'method'='cash' THEN total ELSE (p_payload->>'paid')::numeric END;
 IF paid IS NULL OR paid::text IN ('NaN','Infinity','-Infinity') OR paid<0 OR paid>total OR paid<>round(paid,2) OR (NOT draft AND p_payload->>'method'='partial' AND (paid<=0 OR paid>=total)) THEN RAISE EXCEPTION 'قيمة الدفعة غير صحيحة';END IF;
 IF NOT draft THEN
  SELECT id INTO inv_acc FROM public.accounts WHERE store_id=p_store_id AND account_tag='INVENTORY' AND is_active AND NOT is_group AND normal_balance='debit' ORDER BY created_at,id LIMIT 1;
  SELECT id INTO payable FROM public.accounts WHERE store_id=p_store_id AND account_tag='SUPPLIER_PAYABLE' AND is_active AND NOT is_group AND normal_balance='credit' ORDER BY (name=supplier.name) DESC,created_at,id LIMIT 1;
  IF inv_acc IS NULL OR payable IS NULL THEN RAISE EXCEPTION 'أكمل إعداد حسابي المخزون وذمم الموردين';END IF;
  IF paid>0 THEN
   SELECT * INTO box FROM public.cash_boxes WHERE id=nullif(p_payload->>'cash_box_id','')::uuid AND store_id=p_store_id AND is_active AND type='cash' FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'اختر صندوقاً نقدياً نشطاً';END IF;
   SELECT role INTO role_name FROM public.store_members WHERE store_id=p_store_id AND profile_id=actor AND is_active LIMIT 1;
   IF NOT EXISTS(SELECT 1 FROM public.stores WHERE id=p_store_id AND owner_id=actor) AND coalesce(role_name,'') NOT IN ('owner','admin') AND NOT EXISTS(SELECT 1 FROM public.user_cash_box_permissions WHERE store_id=p_store_id AND user_id=actor AND cash_box_id=box.id AND can_payment) THEN RAISE EXCEPTION 'لا تملك صلاحية الصرف من الصندوق';END IF;
   cash_acc:=box.account_id;
   IF NOT EXISTS(SELECT 1 FROM public.accounts WHERE id=cash_acc AND store_id=p_store_id AND account_tag IN ('CASH','PETTY_CASH') AND is_active AND NOT is_group AND normal_balance='debit') THEN RAISE EXCEPTION 'الصندوق يحتاج حساباً نقدياً نشطاً';END IF;
  END IF;
  PERFORM 1 FROM public.accounts WHERE id IN (inv_acc,payable,cash_acc) ORDER BY id FOR UPDATE;
  IF EXISTS(SELECT 1 FROM public.accounts WHERE id IN (inv_acc,payable,cash_acc) AND (currency<>curr OR NOT is_active OR is_group)) THEN RAISE EXCEPTION 'راجع عملة وحالة حسابات الترحيل';END IF;
 END IF;
 INSERT INTO public.purchase_invoices(store_id,supplier_id,invoice_number,supplier_invoice_number,status,payment_status,payment_method,subtotal,discount,tax_amount,total_amount,paid_amount,currency,invoice_date,notes,created_by,creation_request_id,creation_request_payload)
 VALUES(p_store_id,supplier.id,invoice_no,nullif(btrim(p_payload->>'supplier_number'),''),CASE WHEN draft THEN 'draft' ELSE 'completed' END,CASE WHEN paid=total THEN 'paid' WHEN paid>0 THEN 'partial' ELSE 'unpaid' END,CASE WHEN paid=total THEN 'cash' ELSE 'credit' END,subtotal,discount,tax,total,paid,curr,issue,nullif(btrim(p_payload->>'notes'),''),actor,p_request_id,p_payload) RETURNING id INTO inv;
 FOR item IN SELECT value FROM jsonb_array_elements(p_payload->'items') LOOP
  qty:=(item->>'quantity')::numeric;price:=(item->>'unit_price')::numeric;
  SELECT * INTO prod FROM public.products WHERE id=(item->>'product_id')::uuid AND store_id=p_store_id;
  INSERT INTO public.purchase_items(purchase_invoice_id,product_id,product_name,quantity,unit_price,total_price) VALUES(inv,prod.id,prod.name,qty,price,round(qty*price,2));
  IF NOT draft THEN
   -- Discount is allocated proportionally to update the last purchase unit cost.
   UPDATE public.products SET cost_price=round(price*(subtotal-discount)/subtotal,2),stock_quantity=CASE WHEN track_stock THEN coalesce(stock_quantity,0)+qty ELSE stock_quantity END WHERE id=prod.id RETURNING stock_quantity INTO stock_after;
   IF prod.track_stock THEN INSERT INTO public.inventory_movements(store_id,product_id,movement_type,document_number,document_type,ref_id,entity_name,quantity_in,quantity_out,balance_after,unit_price,movement_date,created_by) VALUES(p_store_id,prod.id,'purchase',invoice_no,'فاتورة مشتريات',inv,supplier.name,qty,0,stock_after,round(price*(subtotal-discount)/subtotal,2),issue,actor);END IF;
  END IF;
 END LOOP;
 IF draft THEN RETURN jsonb_build_object('invoiceId',inv,'draft',true,'replayed',false);END IF;
 INSERT INTO public.journal_entries(store_id,entry_number,date,description,source,ref_id,source_type,source_id,source_number,source_url,accounting_rule,source_module,status,created_by)
 VALUES(p_store_id,'JV-PUR-'||inv::text,issue,'فاتورة مشتريات '||invoice_no,'purchase',inv,'purchase_invoice',inv,invoice_no,'/dashboard/purchases/print/'||inv::text,'PURCHASE_CREDIT_POSTED','PURCHASES','posted',actor) RETURNING id INTO journal;
 INSERT INTO public.journal_lines(journal_entry_id,account_id,debit,credit,currency,description,account_tag_used,source_rule) VALUES(journal,inv_acc,total,0,curr,'مشتريات','INVENTORY','PURCHASE_CREDIT_POSTED'),(journal,payable,0,total,curr,'ذمم المورد','SUPPLIER_PAYABLE','PURCHASE_CREDIT_POSTED');
 UPDATE public.purchase_invoices SET journal_entry_id=journal WHERE id=inv;
 IF paid>0 THEN
  SELECT coalesce(max(substring(voucher_number FROM '^PAY-([0-9]+)$')::bigint),0)+1 INTO next_no FROM public.vouchers WHERE store_id=p_store_id;
  voucher_no:='PAY-'||lpad(next_no::text,greatest(4,length(next_no::text)),'0');
  INSERT INTO public.vouchers(store_id,voucher_number,type,date,amount,cash_amount,checks_amount,supplier_id,party_name,payment_method,cash_box_id,purchase_invoice_id,category,description,reference,created_by)
  VALUES(p_store_id,voucher_no,'payment',issue,paid,paid,0,supplier.id,supplier.name,'cash',box.id,inv,'دفعة مشتريات','دفعة على فاتورة '||invoice_no,invoice_no,actor) RETURNING id INTO voucher;
  IF (SELECT count(*) FROM public.cash_movements WHERE store_id=p_store_id AND ref_id=voucher AND direction='out' AND amount=paid AND cash_box_id=box.id)<>1 THEN RAISE EXCEPTION 'لم تتطابق حركة الصندوق مع سند الصرف';END IF;
  INSERT INTO public.journal_entries(store_id,entry_number,date,description,source,ref_id,source_type,source_id,source_number,source_url,accounting_rule,source_module,status,created_by)
  VALUES(p_store_id,'JV-PAY-'||voucher::text,issue,'صرف مشتريات '||invoice_no,'voucher',voucher,'payment_voucher',voucher,voucher_no,'/dashboard/accounting/payments/print/'||voucher::text,'SUPPLIER_PAYMENT_MADE','TREASURY','posted',actor) RETURNING id INTO payment_journal;
  INSERT INTO public.journal_lines(journal_entry_id,account_id,debit,credit,currency,description,account_tag_used,source_rule) VALUES(payment_journal,payable,paid,0,curr,'دفعة للمورد','SUPPLIER_PAYABLE','SUPPLIER_PAYMENT_MADE'),(payment_journal,cash_acc,0,paid,curr,'صرف نقدي','CASH','SUPPLIER_PAYMENT_MADE');
  UPDATE public.vouchers SET journal_entry_id=payment_journal WHERE id=voucher;
 END IF;
 UPDATE public.suppliers SET balance=coalesce(balance,0)+total-paid WHERE id=supplier.id;
 FOR rec IN SELECT account_id,sum(debit) d,sum(credit) c FROM public.journal_lines WHERE journal_entry_id IN (journal,payment_journal) GROUP BY account_id LOOP
  UPDATE public.accounts SET balance=coalesce(balance,0)+CASE WHEN normal_balance='credit' THEN rec.c-rec.d ELSE rec.d-rec.c END WHERE id=rec.account_id;
 END LOOP;
 INSERT INTO public.financial_audit_log(store_id,entity_type,entity_id,entity_label,action,actor_id,details) VALUES(p_store_id,'purchase_invoice',inv,invoice_no,'create',actor,jsonb_build_object('atomic',true,'requestId',p_request_id,'voucherId',voucher,'total',total,'paid',paid));
 RETURN jsonb_build_object('invoiceId',inv,'voucherId',voucher,'total',total,'paid',paid,'replayed',false);
END $$;
REVOKE ALL ON FUNCTION public.create_purchase_invoice_atomic(uuid,uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_purchase_invoice_atomic(uuid,uuid,jsonb) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
