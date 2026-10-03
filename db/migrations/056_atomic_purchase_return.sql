BEGIN;
ALTER TABLE public.purchase_returns ADD COLUMN IF NOT EXISTS creation_request_id uuid;
ALTER TABLE public.purchase_returns ADD COLUMN IF NOT EXISTS creation_request_payload jsonb;
ALTER TABLE public.purchase_returns ADD COLUMN IF NOT EXISTS currency text;
ALTER TABLE public.purchase_returns ADD COLUMN IF NOT EXISTS receipt_voucher_id uuid REFERENCES public.vouchers(id);
ALTER TABLE public.purchase_return_items ADD COLUMN IF NOT EXISTS purchase_item_id uuid REFERENCES public.purchase_items(id);
ALTER TABLE public.vouchers ADD COLUMN IF NOT EXISTS purchase_return_id uuid REFERENCES public.purchase_returns(id);
CREATE UNIQUE INDEX IF NOT EXISTS purchase_returns_request_unique ON public.purchase_returns(store_id,creation_request_id) WHERE creation_request_id IS NOT NULL;
ALTER TABLE public.financial_audit_log DROP CONSTRAINT IF EXISTS financial_audit_log_entity_type_check;
ALTER TABLE public.financial_audit_log ADD CONSTRAINT financial_audit_log_entity_type_check CHECK(entity_type IN ('invoice','voucher','cash_movement','cash_session','purchase_invoice','purchase_return'));
CREATE OR REPLACE FUNCTION public.create_purchase_return_atomic(p_store_id uuid,p_request_id uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
#variable_conflict use_variable
DECLARE
 actor uuid:=auth.uid(); old public.purchase_returns%ROWTYPE; source public.purchase_invoices%ROWTYPE;
 supplier public.suppliers%ROWTYPE; prod public.products%ROWTYPE; box public.cash_boxes%ROWTYPE;
 item jsonb; line record; rec record; qty numeric; previous_qty numeric; previous_value numeric;
 net_line numeric; line_value numeric; total numeric:=0; stock_after numeric; line_sum numeric;
 inv_acc uuid; payable uuid; cash_acc uuid; doc uuid:=gen_random_uuid(); journal uuid; receipt uuid; receipt_journal uuid;
 issue date; method text; reason_text text; number_text text; voucher_no text; role_name text;
BEGIN
 IF actor IS NULL OR NOT public.is_store_member(p_store_id) THEN RAISE EXCEPTION 'غير مصرح بالمرتجع لهذا المتجر';END IF;
 IF p_request_id IS NULL THEN RAISE EXCEPTION 'معرف طلب الحفظ مطلوب';END IF;
 -- Same ordering as the purchase writer: store, supplier, products, cash box, accounts.
 PERFORM pg_advisory_xact_lock(hashtextextended(p_store_id::text,55001));
 SELECT * INTO old FROM public.purchase_returns WHERE store_id=p_store_id AND creation_request_id=p_request_id;
 IF FOUND THEN
  IF old.creation_request_payload IS DISTINCT FROM p_payload THEN RAISE EXCEPTION 'طلب الحفظ سبق استخدامه ببيانات مختلفة';END IF;
  RETURN jsonb_build_object('returnId',old.id,'voucherId',old.receipt_voucher_id,'total',old.total_amount,'replayed',true);
 END IF;
 IF p_payload IS NULL OR jsonb_typeof(p_payload->'items') IS DISTINCT FROM 'array' OR jsonb_array_length(p_payload->'items') NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'حدد بين بند واحد و200 بند';END IF;
 method:=p_payload->>'method';issue:=(p_payload->>'return_date')::date;reason_text:=btrim(p_payload->>'reason');
 IF method IS NULL OR method NOT IN ('credit','cash') OR issue IS NULL OR coalesce(reason_text,'')='' OR length(reason_text)>500 THEN RAISE EXCEPTION 'تحقق من التسوية والتاريخ وسبب الإرجاع';END IF;
 SELECT * INTO source FROM public.purchase_invoices WHERE id=(p_payload->>'purchase_invoice_id')::uuid AND store_id=p_store_id FOR UPDATE;
 IF NOT FOUND OR source.status<>'completed' OR source.supplier_id IS NULL THEN RAISE EXCEPTION 'اختر فاتورة مشتريات معتمدة من المتجر';END IF;
 IF issue<source.invoice_date THEN RAISE EXCEPTION 'تاريخ المرتجع لا يسبق الفاتورة';END IF;
 IF source.currency IS DISTINCT FROM (SELECT coalesce(currency_code,'ILS') FROM public.stores WHERE id=p_store_id) THEN RAISE EXCEPTION 'عملة الفاتورة لا تطابق عملة حساب المورد في المتجر';END IF;
 IF source.subtotal::text IN ('NaN','Infinity','-Infinity') OR source.total_amount::text IN ('NaN','Infinity','-Infinity') OR source.discount::text IN ('NaN','Infinity','-Infinity') OR source.tax_amount<>0 OR source.subtotal<=0 OR source.discount<0 OR source.discount>=source.subtotal OR source.total_amount<>source.subtotal-source.discount THEN RAISE EXCEPTION 'الفاتورة تحتاج مراجعة مبالغ أو تسوية ضريبية';END IF;
 PERFORM 1 FROM public.accounting_periods WHERE store_id=p_store_id FOR SHARE;
 IF EXISTS(SELECT 1 FROM public.accounting_periods WHERE store_id=p_store_id AND is_closed AND issue BETWEEN start_date AND end_date) THEN RAISE EXCEPTION 'الفترة المحاسبية مقفلة';END IF;
 SELECT * INTO supplier FROM public.suppliers WHERE id=source.supplier_id AND store_id=p_store_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'المورد غير موجود في المتجر';END IF;
 PERFORM 1 FROM public.purchase_items WHERE purchase_invoice_id=source.id ORDER BY id FOR UPDATE;
 SELECT sum(total_price) INTO line_sum FROM public.purchase_items WHERE purchase_invoice_id=source.id;
 IF line_sum IS DISTINCT FROM source.subtotal OR EXISTS(SELECT 1 FROM public.purchase_items WHERE purchase_invoice_id=source.id AND (quantity<=0 OR total_price<>round(quantity*unit_price,2) OR unit_price<0)) THEN RAISE EXCEPTION 'بنود الفاتورة لا تطابق إجماليها';END IF;
 IF EXISTS(SELECT 1 FROM public.purchase_return_items i JOIN public.purchase_returns r ON r.id=i.purchase_return_id WHERE r.purchase_invoice_id=source.id AND r.status='completed' AND i.purchase_item_id IS NULL) THEN RAISE EXCEPTION 'يوجد مرتجع سابق يحتاج ربطاً ببند الفاتورة ومراجعة قيمته';END IF;
 IF (SELECT count(*) FROM jsonb_array_elements(p_payload->'items'))<>(SELECT count(DISTINCT v->>'purchase_item_id') FROM jsonb_array_elements(p_payload->'items') v) THEN RAISE EXCEPTION 'بند المرتجع مكرر';END IF;
 PERFORM 1 FROM public.products WHERE store_id=p_store_id AND id IN(SELECT product_id FROM public.purchase_items WHERE purchase_invoice_id=source.id) ORDER BY id FOR UPDATE;
 -- Use the accounts of the posted purchase, not a possibly different current default.
 SELECT l.account_id INTO inv_acc FROM public.journal_lines l JOIN public.accounts a ON a.id=l.account_id WHERE l.journal_entry_id=source.journal_entry_id AND a.store_id=p_store_id AND a.account_tag='INVENTORY' AND a.normal_balance='debit' AND l.debit=source.total_amount AND l.credit=0;
 SELECT l.account_id INTO payable FROM public.journal_lines l JOIN public.accounts a ON a.id=l.account_id WHERE l.journal_entry_id=source.journal_entry_id AND a.store_id=p_store_id AND a.account_tag='SUPPLIER_PAYABLE' AND a.normal_balance='credit' AND l.credit=source.total_amount AND l.debit=0;
 IF inv_acc IS NULL OR payable IS NULL OR NOT EXISTS(SELECT 1 FROM public.journal_entries WHERE id=source.journal_entry_id AND store_id=p_store_id AND status='posted') THEN RAISE EXCEPTION 'القيد الأصلي يحتاج مراجعة حسابات المخزون وذمم الموردين';END IF;
 IF method='cash' THEN
  SELECT * INTO box FROM public.cash_boxes WHERE id=nullif(p_payload->>'cash_box_id','')::uuid AND store_id=p_store_id AND is_active AND type='cash' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'اختر صندوقاً نقدياً نشطاً';END IF;
  SELECT role INTO role_name FROM public.store_members WHERE store_id=p_store_id AND profile_id=actor AND is_active LIMIT 1;
  IF NOT EXISTS(SELECT 1 FROM public.stores WHERE id=p_store_id AND owner_id=actor) AND coalesce(role_name,'') NOT IN ('owner','admin') AND NOT EXISTS(SELECT 1 FROM public.user_cash_box_permissions WHERE store_id=p_store_id AND user_id=actor AND cash_box_id=box.id AND can_receipt) THEN RAISE EXCEPTION 'لا تملك صلاحية القبض في الصندوق';END IF;
  cash_acc:=box.account_id;
  IF NOT EXISTS(SELECT 1 FROM public.accounts WHERE id=cash_acc AND store_id=p_store_id AND account_tag IN ('CASH','PETTY_CASH') AND normal_balance='debit') THEN RAISE EXCEPTION 'الصندوق يحتاج حساباً نقدياً';END IF;
 END IF;
 PERFORM 1 FROM public.accounts WHERE id IN(inv_acc,payable,cash_acc) ORDER BY id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.accounts WHERE id IN(inv_acc,payable,cash_acc) AND (currency IS DISTINCT FROM source.currency OR NOT is_active OR is_group)) THEN RAISE EXCEPTION 'راجع عملة وحالة حسابات الترحيل';END IF;
 number_text:='PR-'||doc::text;
 INSERT INTO public.purchase_returns(id,store_id,supplier_id,purchase_invoice_id,return_number,status,refund_method,total_amount,return_date,reason,created_by,currency,creation_request_id,creation_request_payload)
 VALUES(doc,p_store_id,supplier.id,source.id,number_text,'completed',method,0,issue,reason_text,actor,source.currency,p_request_id,p_payload);
 FOR item IN SELECT value FROM jsonb_array_elements(p_payload->'items') LOOP
  qty:=(item->>'quantity')::numeric;
  IF qty IS NULL OR qty::text IN ('NaN','Infinity','-Infinity') OR qty<=0 OR qty>999999 OR qty<>round(qty,2) THEN RAISE EXCEPTION 'كمية المرتجع غير صحيحة';END IF;
  -- Difference of rounded cumulative allocations preserves every cent of the invoice discount.
  SELECT i.* INTO line FROM public.purchase_items i WHERE i.purchase_invoice_id=source.id AND i.id=(item->>'purchase_item_id')::uuid;
  IF NOT FOUND OR line.product_id IS NULL THEN RAISE EXCEPTION 'بند المرتجع غير موجود في الفاتورة';END IF;
  SELECT * INTO prod FROM public.products WHERE id=line.product_id AND store_id=p_store_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'الصنف غير موجود في المتجر';END IF;
  IF (SELECT count(*) FROM public.purchase_items WHERE purchase_invoice_id=source.id AND product_id=prod.id)<>1 THEN RAISE EXCEPTION 'الصنف مكرر في الفاتورة؛ يلزم مراجعة';END IF;
  SELECT coalesce(sum(i.quantity),0),coalesce(sum(i.total_price),0) INTO previous_qty,previous_value FROM public.purchase_return_items i JOIN public.purchase_returns r ON r.id=i.purchase_return_id WHERE r.purchase_invoice_id=source.id AND r.status='completed' AND i.purchase_item_id=line.id;
  IF qty+previous_qty>line.quantity THEN RAISE EXCEPTION 'تجاوز الكمية غير المرتجعة';END IF;
  IF prod.track_stock AND (qty<>trunc(qty) OR qty>coalesce(prod.stock_quantity,0)-coalesce(prod.stock_reserved,0)) THEN RAISE EXCEPTION 'الكمية تتجاوز المخزون المتاح أو ليست كمية صحيحة';END IF;
  SELECT coalesce(sum(total_price),0) INTO line_sum FROM public.purchase_items WHERE purchase_invoice_id=source.id AND id<=line.id;
  net_line:=round(line_sum*source.total_amount/source.subtotal,2)-round((line_sum-line.total_price)*source.total_amount/source.subtotal,2);
  line_value:=round(net_line*(previous_qty+qty)/line.quantity,2)-previous_value;
  IF line_value<0 THEN RAISE EXCEPTION 'قيمة المرتجع السابق تحتاج مراجعة';END IF;
  total:=total+line_value;
  INSERT INTO public.purchase_return_items(purchase_return_id,purchase_item_id,product_id,product_name,quantity,unit_price,total_price) VALUES(doc,line.id,prod.id,line.product_name,qty,round(net_line/line.quantity,2),line_value);
  IF prod.track_stock THEN
   UPDATE public.products SET stock_quantity=stock_quantity-qty WHERE id=prod.id RETURNING stock_quantity INTO stock_after;
   INSERT INTO public.inventory_movements(store_id,product_id,movement_type,document_number,document_type,ref_id,entity_name,quantity_in,quantity_out,balance_after,unit_price,movement_date,created_by) VALUES(p_store_id,prod.id,'purchase_return',number_text,'مرتجع مشتريات',doc,supplier.name,0,qty,stock_after,round(line_value/qty,2),issue,actor);
  END IF;
 END LOOP;
 IF (p_payload->>'expected_total')::numeric IS DISTINCT FROM total THEN RAISE EXCEPTION 'قيمة المرتجع تغيرت؛ حدّث الصفحة وراجع المبلغ من جديد';END IF;
 IF total<=0 THEN RAISE EXCEPTION 'المرتجع بلا قيمة مالية يحتاج معالجة مستقلة';END IF;
 UPDATE public.purchase_returns SET total_amount=total WHERE id=doc;
 INSERT INTO public.journal_entries(store_id,entry_number,date,description,source,ref_id,source_type,source_id,source_number,source_url,accounting_rule,source_module,status,created_by)
 VALUES(p_store_id,'JV-PR-'||doc::text,issue,'مرتجع مشتريات '||number_text,'purchase_return',doc,'purchase_return',doc,number_text,'/dashboard/purchases/returns/print/'||doc::text,'PURCHASE_RETURN_POSTED','PURCHASES','posted',actor) RETURNING id INTO journal;
 INSERT INTO public.journal_lines(journal_entry_id,account_id,debit,credit,currency,description,account_tag_used,source_rule) VALUES(journal,payable,total,0,source.currency,'تخفيض ذمم المورد','SUPPLIER_PAYABLE','PURCHASE_RETURN_POSTED'),(journal,inv_acc,0,total,source.currency,'إرجاع المخزون','INVENTORY','PURCHASE_RETURN_POSTED');
 UPDATE public.purchase_returns SET journal_entry_id=journal WHERE id=doc;
 IF method='cash' THEN
  voucher_no:='REC-PR-'||doc::text;
  INSERT INTO public.vouchers(store_id,voucher_number,type,date,amount,cash_amount,checks_amount,supplier_id,party_name,payment_method,cash_box_id,purchase_return_id,category,description,reference,created_by)
  VALUES(p_store_id,voucher_no,'receipt',issue,total,total,0,supplier.id,supplier.name,'cash',box.id,doc,'استرداد مشتريات','استرداد مرتجع '||number_text,number_text,actor) RETURNING id INTO receipt;
  IF (SELECT count(*) FROM public.cash_movements WHERE store_id=p_store_id AND ref_id=receipt AND direction='in' AND amount=total AND cash_box_id=box.id)<>1 THEN RAISE EXCEPTION 'لم تتطابق حركة الصندوق مع سند القبض';END IF;
  INSERT INTO public.journal_entries(store_id,entry_number,date,description,source,ref_id,source_type,source_id,source_number,source_url,accounting_rule,source_module,status,created_by)
  VALUES(p_store_id,'JV-REC-'||receipt::text,issue,'استرداد من المورد '||number_text,'voucher',receipt,'receipt_voucher',receipt,voucher_no,'/dashboard/accounting/receipts/print/'||receipt::text,'SUPPLIER_REFUND_RECEIVED','TREASURY','posted',actor) RETURNING id INTO receipt_journal;
  INSERT INTO public.journal_lines(journal_entry_id,account_id,debit,credit,currency,description,account_tag_used,source_rule) VALUES(receipt_journal,cash_acc,total,0,source.currency,'قبض نقدي','CASH','SUPPLIER_REFUND_RECEIVED'),(receipt_journal,payable,0,total,source.currency,'استرداد من المورد','SUPPLIER_PAYABLE','SUPPLIER_REFUND_RECEIVED');
  UPDATE public.vouchers SET journal_entry_id=receipt_journal WHERE id=receipt;
  UPDATE public.purchase_returns SET receipt_voucher_id=receipt WHERE id=doc;
 ELSE
  UPDATE public.suppliers SET balance=coalesce(balance,0)-total WHERE id=supplier.id;
 END IF;
 FOR rec IN SELECT account_id,sum(debit) d,sum(credit) c FROM public.journal_lines WHERE journal_entry_id IN(journal,receipt_journal) GROUP BY account_id LOOP
  UPDATE public.accounts SET balance=coalesce(balance,0)+CASE WHEN normal_balance='credit' THEN rec.c-rec.d ELSE rec.d-rec.c END WHERE id=rec.account_id;
 END LOOP;
 INSERT INTO public.financial_audit_log(store_id,entity_type,entity_id,entity_label,action,actor_id,details) VALUES(p_store_id,'purchase_return',doc,number_text,'create',actor,jsonb_build_object('atomic',true,'requestId',p_request_id,'invoiceId',source.id,'voucherId',receipt,'total',total,'method',method));
 RETURN jsonb_build_object('returnId',doc,'voucherId',receipt,'total',total,'replayed',false);
END $$;
REVOKE ALL ON FUNCTION public.create_purchase_return_atomic(uuid,uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_purchase_return_atomic(uuid,uuid,jsonb) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
