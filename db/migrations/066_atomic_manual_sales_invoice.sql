BEGIN;
ALTER TABLE public.invoices ADD COLUMN create_key uuid;
ALTER TABLE public.invoices ADD COLUMN create_payload jsonb;
CREATE UNIQUE INDEX invoice_create_key ON public.invoices(store_id,create_key) WHERE create_key IS NOT NULL;
CREATE FUNCTION public.create_sales_invoice_atomic(p_store uuid,p_payload jsonb,p_key uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid; old_invoice public.invoices%ROWTYPE; product public.products%ROWTYPE; ord public.orders%ROWTYPE;
 item jsonb; qty numeric; price numeric; subtotal numeric:=0; discount numeric; total numeric; cost numeric:=0; paid numeric:=0;
 iid uuid:=gen_random_uuid(); vid uuid; num text; vnum text; customer uuid:=NULLIF(p_payload->>'customerId','')::uuid;
 order_id uuid:=NULLIF(p_payload->>'orderId','')::uuid; quotation uuid:=NULLIF(p_payload->>'quotationId','')::uuid;
 ar uuid; revenue uuid; cash uuid; cash_box uuid; lines jsonb; new_balance numeric; sale_date date:=(p_payload->>'issueDate')::date;
 method text:=p_payload->>'paymentMethod'; name text; discount_type text:=p_payload->>'discountType';
BEGIN
 actor:=public.assert_financial_permission(p_store,'post');
 PERFORM pg_advisory_xact_lock(hashtextextended('financial:' || p_store::text,0));
 IF p_key IS NULL OR sale_date IS NULL OR method NOT IN ('cash','credit') THEN RAISE EXCEPTION 'تاريخ الفاتورة أو وسيلة الدفع غير صالحة'; END IF;
 SELECT * INTO old_invoice FROM public.invoices WHERE store_id=p_store AND create_key=p_key;
 IF FOUND THEN
   IF old_invoice.create_payload IS DISTINCT FROM p_payload THEN RAISE EXCEPTION 'معرف الفاتورة مستخدم بطلب مختلف'; END IF;
   RETURN jsonb_build_object('invoiceId',old_invoice.id,'invoiceNumber',old_invoice.invoice_number);
 END IF;
 IF EXISTS(SELECT 1 FROM public.accounting_periods WHERE store_id=p_store AND is_closed AND sale_date BETWEEN start_date AND end_date) THEN RAISE EXCEPTION 'الفترة المحاسبية مقفلة'; END IF;
 IF jsonb_typeof(p_payload->'items') IS DISTINCT FROM 'array' OR jsonb_array_length(p_payload->'items') NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'بنود الفاتورة غير صالحة'; END IF;
 IF customer IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.customers WHERE id=customer AND store_id=p_store AND is_active IS TRUE) THEN RAISE EXCEPTION 'العميل لا يتبع المتجر'; END IF;
 IF order_id IS NOT NULL THEN
   SELECT * INTO ord FROM public.orders WHERE id=order_id AND store_id=p_store FOR UPDATE;
   IF NOT FOUND OR ord.status<>'delivered' THEN RAISE EXCEPTION 'لا يمكن فوترة طلب لم يسلم فعلياً'; END IF;
   IF EXISTS(SELECT 1 FROM public.invoices WHERE order_id=order_id AND store_id=p_store) THEN RAISE EXCEPTION 'الطلب مفوتر مسبقاً'; END IF;
   IF EXISTS(SELECT 1 FROM public.order_stock_reservations WHERE order_id=order_id AND state='reserved') THEN RAISE EXCEPTION 'حجز الطلب لم يصرف بعد'; END IF;
   IF (SELECT count(*) FROM public.order_items WHERE order_id=order_id) <> jsonb_array_length(p_payload->'items') OR
      EXISTS(SELECT 1 FROM jsonb_array_elements(p_payload->'items') i WHERE
     NOT EXISTS(SELECT 1 FROM public.order_items oi WHERE oi.order_id=order_id AND oi.product_id IS NOT DISTINCT FROM NULLIF(i->>'product_id','')::uuid AND oi.quantity=(i->>'quantity')::numeric AND oi.unit_price=(i->>'unit_price')::numeric)) THEN
     RAISE EXCEPTION 'بنود الفاتورة لا تطابق الطلب المسلم'; END IF;
 END IF;
 IF quotation IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.quotations WHERE id=quotation AND store_id=p_store AND converted_invoice_id IS NULL) THEN RAISE EXCEPTION 'عرض السعر محول أو غير صالح'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_payload->'items') ORDER BY value->>'product_id' LOOP
   IF NULLIF(btrim(item->>'name'),'') IS NULL OR jsonb_typeof(item->'quantity')<>'number' OR jsonb_typeof(item->'unit_price')<>'number' THEN RAISE EXCEPTION 'بند الفاتورة غير صالح'; END IF;
   qty:=(item->>'quantity')::numeric;price:=(item->>'unit_price')::numeric;
   IF qty<=0 OR qty<>trunc(qty) OR qty>1000000 OR price<0 OR price<>round(price,2) THEN RAISE EXCEPTION 'كمية أو سعر غير صالح'; END IF;
   IF NULLIF(item->>'product_id','') IS NOT NULL THEN
     SELECT * INTO product FROM public.products WHERE id=(item->>'product_id')::uuid AND store_id=p_store FOR UPDATE;
     IF NOT FOUND OR product.cost_price IS NULL OR product.cost_price<0 THEN RAISE EXCEPTION 'المنتج أو تكلفته غير صالح'; END IF;
     IF order_id IS NULL AND product.track_stock IS NOT FALSE AND product.allow_backorder IS NOT TRUE AND COALESCE(product.stock_quantity,0)-COALESCE(product.stock_reserved,0)<qty THEN RAISE EXCEPTION 'مخزون غير كافٍ'; END IF;
     IF order_id IS NOT NULL THEN
       SELECT cost_price INTO product.cost_price FROM public.order_items WHERE order_id=order_id AND product_id=product.id LIMIT 1;
       IF product.cost_price IS NULL THEN RAISE EXCEPTION 'تكلفة صرف الطلب الأصلي غير محفوظة'; END IF;
     END IF;
     IF product.track_stock IS NOT FALSE THEN cost:=cost+qty*product.cost_price; END IF;
   END IF;
   subtotal:=subtotal+qty*price;
 END LOOP;
 IF subtotal<=0 THEN RAISE EXCEPTION 'المجموع غير صالح'; END IF;
 IF discount_type IN ('percentage','percent') THEN discount:=round(subtotal*COALESCE((p_payload->>'discountValue')::numeric,0)/100,2);
 ELSIF discount_type IN ('fixed','amount') THEN discount:=COALESCE((p_payload->>'discountValue')::numeric,0);
 ELSE discount:=0; END IF;
 IF discount<0 OR discount>=subtotal THEN RAISE EXCEPTION 'الخصم غير صالح'; END IF;
 total:=subtotal-discount;paid:=CASE WHEN method='cash' THEN total ELSE 0 END;
 IF method='credit' AND customer IS NULL THEN RAISE EXCEPTION 'البيع الآجل يحتاج عميلاً مسجلاً'; END IF;
 IF method='cash' AND NULLIF(p_payload->>'cashBoxId','') IS NULL THEN
   cash:=public.resolve_financial_account(p_store,'CASH');
 ELSE
   cash:=CASE WHEN method='cash' THEN public.resolve_financial_account(p_store,'CASH',(p_payload->>'cashBoxId')::uuid) END;
 END IF;
 IF method='cash' THEN
   SELECT id INTO cash_box FROM public.cash_boxes WHERE store_id=p_store AND account_id=cash AND is_active IS TRUE
     AND (NULLIF(p_payload->>'cashBoxId','') IS NULL OR id=(p_payload->>'cashBoxId')::uuid) LIMIT 1;
   IF cash_box IS NULL THEN RAISE EXCEPTION 'صندوق نقدي نشط مطلوب'; END IF;
 END IF;
 ar:=public.resolve_financial_account(p_store,'CUSTOMER_RECEIVABLE',customer);
 revenue:=public.resolve_financial_account(p_store,'SALES_REVENUE');
 name:=COALESCE((SELECT c.name FROM public.customers c WHERE c.id=customer),NULLIF(btrim(p_payload->>'customerName'),''),'عميل نقدي');
 num:=public.generate_sequence_number(p_store,'INV2-' || to_char(sale_date,'YYYY') || '-');
 INSERT INTO public.invoices(id,store_id,invoice_number,order_id,quotation_id,customer_id,customer_name,customer_phone,customer_address,
   issue_date,due_date,payment_method,status,subtotal,discount_type,discount_value,discount_amount,total,total_amount,amount_paid,notes,created_by,create_key,create_payload)
 VALUES(iid,p_store,num,order_id,quotation,customer,name,p_payload->>'customerPhone',p_payload->>'customerAddress',sale_date,
   NULLIF(p_payload->>'dueDate','')::date,method,CASE WHEN paid=total THEN 'paid' ELSE 'sent' END,subtotal,discount_type,
   COALESCE((p_payload->>'discountValue')::numeric,0),discount,total,total,paid,p_payload->>'notes',actor,p_key,p_payload);
 FOR item IN SELECT value FROM jsonb_array_elements(p_payload->'items') ORDER BY value->>'product_id' LOOP
   qty:=(item->>'quantity')::numeric;price:=(item->>'unit_price')::numeric;
   IF NULLIF(item->>'product_id','') IS NOT NULL THEN
     SELECT * INTO product FROM public.products WHERE id=(item->>'product_id')::uuid;
     IF order_id IS NOT NULL THEN SELECT cost_price INTO product.cost_price FROM public.order_items WHERE order_id=order_id AND product_id=product.id LIMIT 1; END IF;
   END IF;
   INSERT INTO public.invoice_items(invoice_id,product_id,description,name,sku,quantity,unit_price,total_price,total,cost_price,cost_snapshot_at)
   VALUES(iid,NULLIF(item->>'product_id','')::uuid,item->>'name',item->>'name',item->>'sku',qty,price,qty*price,qty*price,
     CASE WHEN NULLIF(item->>'product_id','') IS NOT NULL THEN product.cost_price ELSE 0 END,now());
   IF order_id IS NULL AND NULLIF(item->>'product_id','') IS NOT NULL AND product.track_stock IS NOT FALSE THEN
     UPDATE public.products SET stock_quantity=COALESCE(stock_quantity,0)-qty WHERE id=product.id;
     INSERT INTO public.inventory_movements(store_id,product_id,movement_type,document_number,document_type,ref_id,entity_name,quantity_in,quantity_out,balance_after,unit_price,unit_cost,movement_date,created_by)
       VALUES(p_store,product.id,'sale',num,'invoice',iid,name,0,qty,COALESCE(product.stock_quantity,0)-qty,price,product.cost_price,sale_date,actor);
     INSERT INTO public.stock_movements(store_id,product_id,type,quantity,quantity_before,quantity_after,reference_id,reference_type,created_by)
       VALUES(p_store,product.id,'sale',qty,COALESCE(product.stock_quantity,0),COALESCE(product.stock_quantity,0)-qty,iid,'invoice',actor);
   END IF;
 END LOOP;
 lines:=jsonb_build_array(jsonb_build_object('account_id',ar,'debit',total,'credit',0),jsonb_build_object('account_id',revenue,'debit',0,'credit',total));
 IF cost>0 THEN lines:=lines || jsonb_build_array(
   jsonb_build_object('account_id',public.resolve_financial_account(p_store,'COGS'),'debit',round(cost,2),'credit',0),
   jsonb_build_object('account_id',public.resolve_financial_account(p_store,'INVENTORY'),'debit',0,'credit',round(cost,2))); END IF;
 PERFORM public.post_journal_entry_atomic(jsonb_build_object('storeId',p_store,'date',sale_date,'description','فاتورة ' || num,
   'source','invoice','refId',iid,'sourceType','sales_invoice','sourceNumber',num,'accountingRule','SALE_POSTED','sourceModule','SALES','lines',lines));
 IF customer IS NOT NULL THEN
   UPDATE public.customers SET balance=COALESCE(balance,0)+total,total_invoiced=COALESCE(total_invoiced,0)+total WHERE id=customer RETURNING balance INTO new_balance;
   INSERT INTO public.customer_ledger(store_id,customer_id,type,date,description,debit,credit,balance,reference_id,reference_type,created_by)
     VALUES(p_store,customer,'invoice',sale_date,'فاتورة ' || num,total,0,new_balance,iid,'invoice',actor);
 END IF;
 IF method='cash' THEN
   vid:=gen_random_uuid();vnum:=public.generate_sequence_number(p_store,'RCP2-' || to_char(sale_date,'YYYY') || '-');
   INSERT INTO public.vouchers(id,store_id,voucher_number,type,date,amount,customer_id,party_name,payment_method,description,invoice_id,created_by,cash_box_id,cash_amount)
   VALUES(vid,p_store,vnum,'receipt',sale_date,total,customer,name,'cash','تسديد فاتورة ' || num,iid,actor,cash_box,total);
   PERFORM public.post_journal_entry_atomic(jsonb_build_object('storeId',p_store,'date',sale_date,'description','سند قبض ' || vnum,
     'source','voucher','refId',vid,'sourceType','receipt_voucher','sourceNumber',vnum,'accountingRule','CUSTOMER_PAYMENT_RECEIVED','sourceModule','TREASURY',
     'lines',jsonb_build_array(jsonb_build_object('account_id',cash,'debit',total,'credit',0),jsonb_build_object('account_id',ar,'debit',0,'credit',total))));
   IF customer IS NOT NULL THEN
     UPDATE public.customers SET balance=COALESCE(balance,0)-total,total_paid=COALESCE(total_paid,0)+total WHERE id=customer RETURNING balance INTO new_balance;
     INSERT INTO public.customer_ledger(store_id,customer_id,type,date,description,debit,credit,balance,reference_id,reference_type,created_by)
       VALUES(p_store,customer,'payment',sale_date,'سند قبض ' || vnum,0,total,new_balance,vid,'voucher',actor);
   END IF;
 END IF;
 IF quotation IS NOT NULL THEN UPDATE public.quotations SET status='converted',converted_invoice_id=iid WHERE id=quotation; END IF;
 INSERT INTO public.financial_audit_log(store_id,entity_type,entity_id,entity_label,action,actor_id,details)
 VALUES(p_store,'invoice',iid,num,'create',actor,jsonb_build_object('total',total,'discount',discount,'source_order',order_id));
 RETURN jsonb_build_object('invoiceId',iid,'invoiceNumber',num);
END $$;
REVOKE ALL ON FUNCTION public.create_sales_invoice_atomic(uuid,jsonb,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_sales_invoice_atomic(uuid,jsonb,uuid) TO authenticated;
COMMIT;
