BEGIN;

-- 1. Create function to generate purchase invoice sequence number starting with BIL-0001
CREATE OR REPLACE FUNCTION public.generate_purchase_invoice_number(p_store_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_next_num INTEGER;
  v_max_existing INTEGER;
  v_cand TEXT;
BEGIN
  IF p_store_id IS NULL THEN
    RAISE EXCEPTION 'معرف المتجر مطلوب';
  END IF;

  -- Find highest existing number for BIL- prefix in purchase_invoices
  SELECT COALESCE(MAX(
    SUBSTRING(invoice_number FROM '^BIL-0*([0-9]+)$')::INTEGER
  ), 0) INTO v_max_existing
  FROM public.purchase_invoices
  WHERE store_id = p_store_id AND invoice_number ~ '^BIL-[0-9]+$';

  INSERT INTO public.sequence_counters (store_id, prefix, last_value)
  VALUES (p_store_id, 'BIL-', GREATEST(v_max_existing + 1, 1))
  ON CONFLICT (store_id, prefix)
  DO UPDATE SET last_value = GREATEST(public.sequence_counters.last_value + 1, v_max_existing + 1)
  RETURNING last_value INTO v_next_num;

  v_cand := 'BIL-' || LPAD(v_next_num::TEXT, 4, '0');

  -- Ensure candidate does not collide with any existing invoice
  WHILE EXISTS (SELECT 1 FROM public.purchase_invoices WHERE store_id = p_store_id AND invoice_number = v_cand) LOOP
    UPDATE public.sequence_counters
    SET last_value = last_value + 1
    WHERE store_id = p_store_id AND prefix = 'BIL-'
    RETURNING last_value INTO v_next_num;
    v_cand := 'BIL-' || LPAD(v_next_num::TEXT, 4, '0');
  END LOOP;

  RETURN v_cand;
END;
$$;

-- 2. Create preview function that peeks without advancing the counter
CREATE OR REPLACE FUNCTION public.get_next_purchase_invoice_number_preview(p_store_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_val INTEGER;
  v_max_existing INTEGER;
BEGIN
  IF p_store_id IS NULL THEN
    RETURN 'BIL-0001';
  END IF;

  SELECT last_value INTO v_val
  FROM public.sequence_counters
  WHERE store_id = p_store_id AND prefix = 'BIL-';

  SELECT COALESCE(MAX(
    SUBSTRING(invoice_number FROM '^BIL-0*([0-9]+)$')::INTEGER
  ), 0) INTO v_max_existing
  FROM public.purchase_invoices
  WHERE store_id = p_store_id AND invoice_number ~ '^BIL-[0-9]+$';

  IF v_val IS NULL THEN
    v_val := v_max_existing;
  ELSE
    v_val := GREATEST(v_val, v_max_existing);
  END IF;

  RETURN 'BIL-' || LPAD((v_val + 1)::TEXT, 4, '0');
END;
$$;

-- 3. Update create_purchase_invoice_atomic to auto-generate sequence if not provided or empty or AUTO
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
  RETURN jsonb_build_object('ok',true,'invoiceId',existing.id,'replayed',true,'invoiceNumber',existing.invoice_number);
 END IF;
 IF p_payload IS NULL OR jsonb_typeof(p_payload->'items') IS DISTINCT FROM 'array' OR jsonb_array_length(p_payload->'items') NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'أضف بين بند واحد و200 بند';END IF;
 IF p_payload->>'mode' IS NULL OR p_payload->>'mode' NOT IN ('draft','post') THEN RAISE EXCEPTION 'حالة الحفظ غير صحيحة';END IF;
 draft:=p_payload->>'mode'='draft';issue:=(p_payload->>'invoice_date')::date;invoice_no:=btrim(p_payload->>'invoice_number');
 
 -- Auto-generate BIL-xxxx sequence number if empty or AUTO
 IF invoice_no IS NULL OR invoice_no = '' OR invoice_no = 'AUTO' THEN
   invoice_no := public.generate_purchase_invoice_number(p_store_id);
 END IF;

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
 IF draft THEN RETURN jsonb_build_object('ok',true,'invoiceId',inv,'invoiceNumber',invoice_no,'draft',true,'replayed',false);END IF;
 INSERT INTO public.journal_entries(store_id,entry_number,date,description,source,ref_id,source_type,source_id,source_number,source_url,accounting_rule,source_module,status,created_by)
 VALUES(p_store_id,'JV-PUR-'||inv::text,issue,'فاتورة مشتريات '||invoice_no,'purchase',inv,'purchase_invoice',inv,invoice_no,'/dashboard/purchases/print/'||inv::text,'PURCHASE_CREDIT_POSTED','PURCHASES','posted',actor) RETURNING id INTO journal;
 INSERT INTO public.journal_lines(journal_entry_id,account_id,debit,credit,currency,description,account_tag_used,source_rule)
 VALUES(journal,inv_acc,total,0,curr,'مشتريات '||invoice_no,'INVENTORY','PURCHASE_CREDIT_POSTED'),
       (journal,payable,0,total,curr,'ذمم المورد '||supplier.name,'SUPPLIER_PAYABLE','PURCHASE_CREDIT_POSTED');
 FOR rec IN SELECT account_id,sum(debit) d,sum(credit) c FROM public.journal_lines WHERE journal_entry_id=journal GROUP BY account_id LOOP
  UPDATE public.accounts SET balance=coalesce(balance,0)+CASE WHEN normal_balance='credit' THEN rec.c-rec.d ELSE rec.d-rec.c END WHERE id=rec.account_id;
 END LOOP;
 UPDATE public.purchase_invoices SET journal_entry_id=journal WHERE id=inv;
 UPDATE public.suppliers SET balance=coalesce(balance,0)+total-paid WHERE id=supplier.id;
 IF paid>0 THEN
  SELECT generate_sequence_number(p_store_id,'PAY-') INTO voucher_no;
  INSERT INTO public.vouchers(store_id,voucher_number,type,date,cash_box_id,amount,currency,description,supplier_id,created_by,purchase_invoice_id,account_id,payment_method)
  VALUES(p_store_id,voucher_no,'payment',issue,box.id,paid,curr,'دفعة فاتورة مشتريات '||invoice_no,supplier.id,actor,inv,cash_acc,'cash') RETURNING id INTO voucher;
  INSERT INTO public.cash_movements(store_id,cash_box_id,amount,type,reference_id,reference_type,description,created_by,date)
  VALUES(p_store_id,box.id,paid,'out',voucher,'voucher','دفعة فاتورة مشتريات '||invoice_no,actor,issue);
  INSERT INTO public.journal_entries(store_id,entry_number,date,description,source,ref_id,source_type,source_id,source_number,source_url,accounting_rule,source_module,status,created_by)
  VALUES(p_store_id,'JV-PAY-'||voucher::text,issue,'سند صرف مشتريات '||voucher_no,'voucher',voucher,'voucher',voucher,voucher_no,'/dashboard/accounting/payments/print/'||voucher::text,'PURCHASE_PAYMENT_CASH','TREASURY','posted',actor) RETURNING id INTO payment_journal;
  INSERT INTO public.journal_lines(journal_entry_id,account_id,debit,credit,currency,description,account_tag_used,source_rule)
  VALUES(payment_journal,payable,paid,0,curr,'صرف للمورد '||supplier.name,'SUPPLIER_PAYABLE','PURCHASE_PAYMENT_CASH'),
        (payment_journal,cash_acc,0,paid,curr,'صرف من الصندوق '||box.name,'CASH','PURCHASE_PAYMENT_CASH');
  FOR rec IN SELECT account_id,sum(debit) d,sum(credit) c FROM public.journal_lines WHERE journal_entry_id=payment_journal GROUP BY account_id LOOP
   UPDATE public.accounts SET balance=coalesce(balance,0)+CASE WHEN normal_balance='credit' THEN rec.c-rec.d ELSE rec.d-rec.c END WHERE id=rec.account_id;
  END LOOP;
 END IF;
 INSERT INTO public.financial_audit_log(store_id,entity_type,entity_id,entity_label,action,actor_id,details)
 VALUES(p_store_id,'purchase_invoice',inv,invoice_no,'create',actor,jsonb_build_object('total',total,'paid',paid,'mode',p_payload->>'mode','journalId',journal,'voucherId',voucher));
 RETURN jsonb_build_object('ok',true,'invoiceId',inv,'invoiceNumber',invoice_no,'draft',false,'replayed',false);
END;
$$;

GRANT EXECUTE ON FUNCTION public.generate_purchase_invoice_number(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_next_purchase_invoice_number_preview(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_purchase_invoice_atomic(uuid,uuid,jsonb) TO authenticated, service_role;

COMMIT;
