-- Invoice creation, stock, receivable, receipt and journals commit together.
-- Cash movements are created exclusively by the existing voucher trigger.
BEGIN;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS creation_request_id uuid;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS creation_request_payload jsonb;
CREATE UNIQUE INDEX IF NOT EXISTS invoices_creation_request_unique ON public.invoices(store_id,creation_request_id) WHERE creation_request_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.create_sales_invoice_atomic(p_store_id uuid,p_request_id uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
#variable_conflict use_variable
DECLARE
 actor uuid:=auth.uid(); inv_id uuid; voucher_id uuid; invoice_no text; voucher_no text;
 issue date; due date; customer_id uuid; box_id uuid; order_id uuid; quote_id uuid;
 customer_name text; customer_phone text; curr text; role_name text;
 subtotal numeric:=0; discount numeric; total numeric; paid numeric; cost numeric:=0;
 qty numeric; price numeric; line_total numeric; product_cost numeric; stock_after numeric;
 item jsonb; prod public.products%ROWTYPE; cust public.customers%ROWTYPE; box public.cash_boxes%ROWTYPE;
 existing public.invoices%ROWTYPE; ar uuid; cash_acc uuid; revenue uuid; cogs uuid; inventory uuid;
 journal uuid; receipt_journal uuid; account_record record; next_no bigint; idx int:=0;
BEGIN
 IF actor IS NULL OR NOT public.is_store_member(p_store_id) THEN RAISE EXCEPTION 'غير مصرح بإنشاء فاتورة لهذا المتجر'; END IF;
 IF p_request_id IS NULL THEN RAISE EXCEPTION 'معرف طلب الحفظ مطلوب'; END IF;
 -- Serialize this store's invoice creators and their document numbering.
 PERFORM pg_advisory_xact_lock(hashtextextended(p_store_id::text,54001));
 SELECT * INTO existing FROM public.invoices WHERE store_id=p_store_id AND creation_request_id=p_request_id;
 IF FOUND THEN
   IF existing.creation_request_payload IS DISTINCT FROM p_payload THEN RAISE EXCEPTION 'طلب الحفظ سبق استخدامه ببيانات مختلفة'; END IF;
   RETURN jsonb_build_object('invoiceId',existing.id,'invoiceNumber',existing.invoice_number,'replayed',true);
 END IF;
 IF p_payload IS NULL OR jsonb_typeof(p_payload->'items') IS DISTINCT FROM 'array' OR jsonb_array_length(p_payload->'items') NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'أضف بين بند واحد و200 بند'; END IF;
 issue:=(p_payload->>'issueDate')::date; due:=nullif(p_payload->>'dueDate','')::date;
 IF issue IS NULL OR due<issue THEN RAISE EXCEPTION 'تحقق من تاريخ الإصدار والاستحقاق'; END IF;
 -- Lock existing periods while checking: closing them cannot race this transaction.
 PERFORM 1 FROM public.accounting_periods WHERE store_id=p_store_id FOR SHARE;
 IF EXISTS(SELECT 1 FROM public.accounting_periods WHERE store_id=p_store_id AND is_closed AND issue BETWEEN start_date AND end_date) THEN RAISE EXCEPTION 'تاريخ الفاتورة ضمن فترة محاسبية مقفلة'; END IF;
 SELECT currency_code INTO curr FROM public.stores WHERE id=p_store_id;
 curr:=coalesce(curr,'ILS');
 customer_id:=nullif(p_payload->>'customerId','')::uuid;
 order_id:=nullif(p_payload->>'orderId','')::uuid; quote_id:=nullif(p_payload->>'quotationId','')::uuid;
 IF order_id IS NOT NULL AND quote_id IS NOT NULL THEN RAISE EXCEPTION 'اختر مصدراً واحداً للفاتورة'; END IF;
 IF customer_id IS NOT NULL THEN
   SELECT * INTO cust FROM public.customers WHERE id=customer_id AND store_id=p_store_id AND is_active FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'الزبون غير موجود أو غير نشط في هذا المتجر'; END IF;
   customer_name:=cust.name; customer_phone:=cust.phone;
 ELSE customer_name:=nullif(btrim(p_payload->>'customerName'),'');customer_phone:=nullif(btrim(p_payload->>'customerPhone'),''); END IF;
 IF order_id IS NOT NULL THEN
   PERFORM 1 FROM public.orders WHERE id=order_id AND store_id=p_store_id AND status NOT IN ('cancelled','returned') FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'الطلبية غير متاحة للتحويل'; END IF;
   IF EXISTS(SELECT 1 FROM public.invoices i WHERE i.store_id=p_store_id AND i.order_id=order_id) THEN RAISE EXCEPTION 'توجد فاتورة لهذه الطلبية؛ افتح الفاتورة الحالية'; END IF;
   IF EXISTS(SELECT 1 FROM public.orders o WHERE o.id=order_id AND o.amount_paid>0)
     OR EXISTS(SELECT 1 FROM public.inventory_movements m WHERE m.store_id=p_store_id AND m.ref_id=order_id)
     OR EXISTS(SELECT 1 FROM public.cash_movements m WHERE m.store_id=p_store_id AND m.ref_id=order_id)
     OR EXISTS(SELECT 1 FROM public.journal_entries j WHERE j.store_id=p_store_id AND j.ref_id=order_id AND j.status='posted')
     OR EXISTS(SELECT 1 FROM public.customer_ledger l WHERE l.store_id=p_store_id AND l.reference_id=order_id)
   THEN RAISE EXCEPTION 'الطلبية لها أثر مالي أو مخزني سابق؛ يلزم مراجعتها قبل التحويل لمنع التكرار'; END IF;
 END IF;
 IF quote_id IS NOT NULL THEN
   PERFORM 1 FROM public.quotations WHERE id=quote_id AND store_id=p_store_id AND status NOT IN ('converted','rejected','expired') AND converted_invoice_id IS NULL FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'عرض السعر غير متاح للتحويل أو حُوّل سابقاً'; END IF;
   IF EXISTS(SELECT 1 FROM public.invoices i WHERE i.store_id=p_store_id AND i.quotation_id=quote_id) THEN RAISE EXCEPTION 'توجد فاتورة لعرض السعر'; END IF;
 END IF;
 -- Lock all products in a stable order; only server catalog cost is trusted.
 PERFORM 1 FROM public.products p WHERE p.store_id=p_store_id AND p.id IN (SELECT nullif(v->>'product_id','')::uuid FROM jsonb_array_elements(p_payload->'items') v) ORDER BY p.id FOR UPDATE;
 FOR item IN SELECT value FROM jsonb_array_elements(p_payload->'items') LOOP
   qty:=(item->>'quantity')::numeric;price:=(item->>'unit_price')::numeric;
   IF qty IS NULL OR price IS NULL OR qty::text IN ('NaN','Infinity','-Infinity') OR price::text IN ('NaN','Infinity','-Infinity') OR qty<=0 OR qty>1000000 OR qty<>round(qty,2) OR price<0 OR price>100000000 OR price<>round(price,2) OR coalesce(btrim(item->>'name'),'')='' THEN RAISE EXCEPTION 'تحقق من وصف البنود والكميات والأسعار'; END IF;
   subtotal:=subtotal+round(qty*price,2);
   IF nullif(item->>'product_id','') IS NOT NULL THEN
     SELECT * INTO prod FROM public.products WHERE id=(item->>'product_id')::uuid AND store_id=p_store_id AND is_active;
     IF NOT FOUND THEN RAISE EXCEPTION 'منتج غير موجود أو غير نشط في هذا المتجر'; END IF;
     IF prod.track_stock AND qty<>trunc(qty) THEN RAISE EXCEPTION 'المنتج المخزني يتطلب كمية صحيحة'; END IF;
     IF prod.track_stock THEN cost:=cost+round(qty*coalesce(prod.cost_price,0),2); END IF;
   END IF;
 END LOOP;
 IF p_payload->>'discountType' NOT IN ('amount','percent') OR p_payload->>'discountType' IS NULL THEN RAISE EXCEPTION 'نوع الخصم غير صحيح'; END IF;
 discount:=(p_payload->>'discountValue')::numeric;
 IF discount IS NULL OR discount::text IN ('NaN','Infinity','-Infinity') OR discount<0 OR (p_payload->>'discountType'='percent' AND discount>100) THEN RAISE EXCEPTION 'الخصم غير صحيح'; END IF;
 IF p_payload->>'discountType'='percent' THEN discount:=round(subtotal*discount/100,2);ELSE discount:=round(discount,2);END IF;
 total:=subtotal-discount;
 IF total<=0 OR discount>subtotal THEN RAISE EXCEPTION 'الإجمالي يجب أن يكون موجباً والخصم لا يتجاوز الفاتورة'; END IF;
 IF p_payload->>'collectionMode' NOT IN ('full','partial','none') OR p_payload->>'collectionMode' IS NULL THEN RAISE EXCEPTION 'اختر حالة التحصيل'; END IF;
 paid:=CASE p_payload->>'collectionMode' WHEN 'full' THEN total WHEN 'none' THEN 0 ELSE (p_payload->>'amountPaid')::numeric END;
 IF paid IS NULL OR paid::text IN ('NaN','Infinity','-Infinity') OR paid<0 OR paid>total OR paid<>round(paid,2) OR (p_payload->>'collectionMode'='partial' AND (paid<=0 OR paid>=total)) THEN RAISE EXCEPTION 'تحقق من قيمة الدفعة'; END IF;
 IF paid<total AND customer_id IS NULL THEN RAISE EXCEPTION 'اختر زبوناً مسجلاً للبيع الآجل أو الدفعة الجزئية'; END IF;
 IF paid>0 THEN
   box_id:=nullif(p_payload->>'cashBoxId','')::uuid;
   SELECT * INTO box FROM public.cash_boxes WHERE id=box_id AND store_id=p_store_id AND is_active AND type='cash' FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'اختر صندوقاً نقدياً نشطاً'; END IF;
   SELECT role INTO role_name FROM public.store_members WHERE store_id=p_store_id AND profile_id=actor AND is_active LIMIT 1;
   IF NOT EXISTS(SELECT 1 FROM public.stores WHERE id=p_store_id AND owner_id=actor) AND coalesce(role_name,'') NOT IN ('owner','admin') AND NOT EXISTS(SELECT 1 FROM public.user_cash_box_permissions WHERE store_id=p_store_id AND user_id=actor AND cash_box_id=box_id AND can_receipt) THEN RAISE EXCEPTION 'لا تملك صلاحية القبض في الصندوق المختار'; END IF;
   cash_acc:=box.account_id;
   IF NOT EXISTS(SELECT 1 FROM public.accounts WHERE id=cash_acc AND store_id=p_store_id AND is_active AND NOT is_group AND account_tag IN ('CASH','PETTY_CASH') AND normal_balance='debit') THEN RAISE EXCEPTION 'الصندوق يحتاج حساباً نقدياً نشطاً مرتبطاً به'; END IF;
 END IF;
 SELECT id INTO ar FROM public.accounts WHERE store_id=p_store_id AND account_tag='CUSTOMER_RECEIVABLE' AND is_active AND NOT is_group AND normal_balance='debit' ORDER BY (customer_id IS NOT NULL AND name=customer_name) DESC,created_at,id LIMIT 1;
 SELECT id INTO revenue FROM public.accounts WHERE store_id=p_store_id AND account_tag='SALES_REVENUE' AND is_active AND NOT is_group AND normal_balance='credit' ORDER BY created_at,id LIMIT 1;
 IF ar IS NULL OR revenue IS NULL THEN RAISE EXCEPTION 'أكمل إعداد حسابي ذمم الزبائن وإيرادات المبيعات'; END IF;
 IF cost>0 THEN
   SELECT id INTO cogs FROM public.accounts WHERE store_id=p_store_id AND account_tag='COGS' AND is_active AND NOT is_group AND normal_balance='debit' ORDER BY created_at,id LIMIT 1;
   SELECT id INTO inventory FROM public.accounts WHERE store_id=p_store_id AND account_tag='INVENTORY' AND is_active AND NOT is_group AND normal_balance='debit' ORDER BY created_at,id LIMIT 1;
   IF cogs IS NULL OR inventory IS NULL THEN RAISE EXCEPTION 'أكمل إعداد حسابي تكلفة المبيعات والمخزون'; END IF;
 END IF;
 PERFORM 1 FROM public.accounts WHERE id IN (ar,revenue,cash_acc,cogs,inventory) ORDER BY id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.accounts WHERE id IN (ar,revenue,cash_acc,cogs,inventory) AND (NOT is_active OR is_group)) THEN RAISE EXCEPTION 'أحد حسابات الترحيل معطل أو تجميعي';END IF;
 IF EXISTS(SELECT 1 FROM public.accounts WHERE id IN (ar,revenue,cash_acc,cogs,inventory) AND currency<>curr) THEN RAISE EXCEPTION 'عملة الحسابات يجب أن تطابق عملة المتجر؛ التحويل بين العملات غير مدعوم في هذا المسار';END IF;
 -- Max suffix, not row count, avoids numbering reuse after deletes.
 SELECT coalesce(max(substring(invoice_number FROM '^INV-([0-9]+)$')::bigint),0)+1 INTO next_no FROM public.invoices WHERE store_id=p_store_id;
 invoice_no:='INV-'||lpad(next_no::text,greatest(4,length(next_no::text)),'0');
 INSERT INTO public.invoices(store_id,invoice_number,order_id,quotation_id,customer_id,customer_name,customer_phone,customer_address,issue_date,due_date,status,subtotal,discount_type,discount_value,discount_amount,total,total_amount,amount_paid,payment_method,notes,created_by,paid_at,creation_request_id,creation_request_payload)
 VALUES(p_store_id,invoice_no,order_id,quote_id,customer_id,customer_name,customer_phone,nullif(btrim(p_payload->>'customerAddress'),''),issue,due,CASE WHEN paid=total THEN 'paid' WHEN paid>0 THEN 'partial' ELSE 'sent' END,subtotal,p_payload->>'discountType',(p_payload->>'discountValue')::numeric,discount,total,total,paid,CASE WHEN paid=total THEN 'cash' ELSE 'credit' END,nullif(btrim(p_payload->>'notes'),''),actor,CASE WHEN paid=total THEN now() END,p_request_id,p_payload) RETURNING id INTO inv_id;
 FOR item IN SELECT value FROM jsonb_array_elements(p_payload->'items') LOOP
   qty:=(item->>'quantity')::numeric;price:=(item->>'unit_price')::numeric; product_cost:=0;
   IF nullif(item->>'product_id','') IS NOT NULL THEN
     SELECT * INTO prod FROM public.products WHERE id=(item->>'product_id')::uuid AND store_id=p_store_id;
     product_cost:=coalesce(prod.cost_price,0);
     IF prod.track_stock THEN
       IF coalesce(prod.stock_quantity,0)-coalesce(prod.stock_reserved,0)<qty AND NOT coalesce(prod.allow_backorder,false) THEN RAISE EXCEPTION 'المخزون المتاح لا يكفي للمنتج: %',prod.name;END IF;
       stock_after:=coalesce(prod.stock_quantity,0)-qty;
       UPDATE public.products SET stock_quantity=stock_after WHERE id=prod.id;
       INSERT INTO public.inventory_movements(store_id,product_id,movement_type,document_number,document_type,ref_id,entity_name,quantity_in,quantity_out,balance_after,unit_price,movement_date,created_by)
       VALUES(p_store_id,prod.id,'sale',invoice_no,'فاتورة مبيعات',inv_id,coalesce(customer_name,'عميل نقدي'),0,qty,stock_after,price,issue,actor);
     END IF;
   END IF;
   idx:=idx+1;
   INSERT INTO public.invoice_items(invoice_id,product_id,name,description,sku,quantity,unit_price,total,total_price,cost_price,sort_order)
   VALUES(inv_id,nullif(item->>'product_id','')::uuid,item->>'name',item->>'name',nullif(item->>'sku',''),qty,price,round(qty*price,2),round(qty*price,2),product_cost,idx);
 END LOOP;
 IF customer_id IS NOT NULL THEN
   INSERT INTO public.customer_ledger(store_id,customer_id,type,date,description,debit,credit,balance,reference_id,reference_type,created_by)
   VALUES(p_store_id,customer_id,'invoice',issue,'فاتورة '||invoice_no,total,0,coalesce(cust.balance,0)+total,inv_id,'invoice',actor);
 END IF;
 -- One journal for the sale and inventory cost, a separate receipt journal.
 INSERT INTO public.journal_entries(store_id,entry_number,date,description,source,ref_id,source_type,source_id,source_number,source_url,accounting_rule,source_module,status,created_by)
 VALUES(p_store_id,'JV-SALE-'||inv_id::text,issue,'فاتورة '||invoice_no,'invoice',inv_id,'sales_invoice',inv_id,invoice_no,'/dashboard/accounting/invoices/'||inv_id::text,'SALE_CREDIT_POSTED','SALES','posted',actor) RETURNING id INTO journal;
 INSERT INTO public.journal_lines(journal_entry_id,account_id,debit,credit,currency,description,sort_order,account_tag_used,source_rule)
 VALUES(journal,ar,total,0,curr,'استحقاق فاتورة '||invoice_no,1,'CUSTOMER_RECEIVABLE','SALE_CREDIT_POSTED'),(journal,revenue,0,total,curr,'إيراد فاتورة '||invoice_no,2,'SALES_REVENUE','SALE_CREDIT_POSTED');
 IF cost>0 THEN
   INSERT INTO public.journal_lines(journal_entry_id,account_id,debit,credit,currency,description,sort_order,account_tag_used,source_rule)
   VALUES(journal,cogs,cost,0,curr,'تكلفة مبيعات '||invoice_no,3,'COGS','SALE_COGS'),(journal,inventory,0,cost,curr,'إخراج مخزون '||invoice_no,4,'INVENTORY','INVENTORY_OUT');
 END IF;
 UPDATE public.invoices SET journal_entry_id=journal WHERE id=inv_id;
 IF paid>0 THEN
   SELECT coalesce(max(substring(voucher_number FROM '^RCP-([0-9]+)$')::bigint),0)+1 INTO next_no FROM public.vouchers WHERE store_id=p_store_id;
   voucher_no:='RCP-'||lpad(next_no::text,greatest(4,length(next_no::text)),'0');
   INSERT INTO public.vouchers(store_id,voucher_number,type,date,amount,cash_amount,checks_amount,customer_id,party_name,payment_method,cash_box_id,invoice_id,category,description,reference,created_by)
   VALUES(p_store_id,voucher_no,'receipt',issue,paid,paid,0,customer_id,coalesce(customer_name,'عميل نقدي'),'cash',box_id,inv_id,'تحصيل فاتورة','دفعة على فاتورة '||invoice_no,invoice_no,actor) RETURNING id INTO voucher_id;
   IF (SELECT count(*) FROM public.cash_movements WHERE store_id=p_store_id AND ref_id=voucher_id AND source IN ('voucher','receipt_voucher') AND direction='in' AND amount=paid AND cash_box_id=box_id)<>1 THEN RAISE EXCEPTION 'لم تتطابق حركة الصندوق مع سند القبض'; END IF;
   INSERT INTO public.journal_entries(store_id,entry_number,date,description,source,ref_id,source_type,source_id,source_number,source_url,accounting_rule,source_module,status,created_by)
   VALUES(p_store_id,'JV-RCP-'||voucher_id::text,issue,'قبض فاتورة '||invoice_no,'voucher',voucher_id,'receipt_voucher',voucher_id,voucher_no,'/dashboard/accounting/receipts/print/'||voucher_id::text,'CUSTOMER_PAYMENT_RECEIVED','TREASURY','posted',actor) RETURNING id INTO receipt_journal;
   INSERT INTO public.journal_lines(journal_entry_id,account_id,debit,credit,currency,description,sort_order,account_tag_used,source_rule)
   VALUES(receipt_journal,cash_acc,paid,0,curr,'قبض فاتورة '||invoice_no,1,'CASH','CUSTOMER_PAYMENT_RECEIVED'),(receipt_journal,ar,0,paid,curr,'تسوية فاتورة '||invoice_no,2,'CUSTOMER_RECEIVABLE','CUSTOMER_PAYMENT_RECEIVED');
   UPDATE public.vouchers SET journal_entry_id=receipt_journal WHERE id=voucher_id;
   IF customer_id IS NOT NULL THEN
     INSERT INTO public.customer_ledger(store_id,customer_id,type,date,description,debit,credit,balance,reference_id,reference_type,created_by)
     VALUES(p_store_id,customer_id,'payment',issue,'قبض '||voucher_no,0,paid,coalesce(cust.balance,0)+total-paid,voucher_id,'voucher',actor);
   END IF;
 END IF;
 -- Aggregate every line before updating: shared account IDs cannot overwrite balances.
 FOR account_record IN SELECT l.account_id,sum(l.debit) debit,sum(l.credit) credit FROM public.journal_lines l WHERE l.journal_entry_id IN (journal,receipt_journal) GROUP BY l.account_id LOOP
   UPDATE public.accounts SET balance=coalesce(balance,0)+CASE WHEN normal_balance='credit' THEN account_record.credit-account_record.debit ELSE account_record.debit-account_record.credit END WHERE id=account_record.account_id;
 END LOOP;
 IF customer_id IS NOT NULL THEN UPDATE public.customers SET balance=coalesce(balance,0)+total-paid,total_invoiced=coalesce(total_invoiced,0)+total,total_paid=coalesce(total_paid,0)+paid WHERE id=customer_id;END IF;
 IF quote_id IS NOT NULL THEN UPDATE public.quotations SET status='converted',converted_invoice_id=inv_id WHERE id=quote_id;END IF;
 INSERT INTO public.financial_audit_log(store_id,entity_type,entity_id,entity_label,action,actor_id,details)
 VALUES(p_store_id,'invoice',inv_id,invoice_no,'create',actor,jsonb_build_object('requestId',p_request_id,'total',total,'amountPaid',paid,'voucherId',voucher_id,'atomic',true));
 RETURN jsonb_build_object('invoiceId',inv_id,'invoiceNumber',invoice_no,'voucherId',voucher_id,'total',total,'amountPaid',paid,'replayed',false);
END $$;
REVOKE ALL ON FUNCTION public.create_sales_invoice_atomic(uuid,uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_sales_invoice_atomic(uuid,uuid,jsonb) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
