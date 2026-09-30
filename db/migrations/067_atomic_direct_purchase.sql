BEGIN;
ALTER TABLE public.purchase_invoices ADD COLUMN create_key uuid;
ALTER TABLE public.purchase_invoices ADD COLUMN create_payload jsonb;
CREATE UNIQUE INDEX purchase_invoice_create_key ON public.purchase_invoices(store_id,create_key) WHERE create_key IS NOT NULL;
CREATE FUNCTION public.create_purchase_invoice_atomic(p_store uuid,p_payload jsonb,p_key uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid; old_invoice public.purchase_invoices%ROWTYPE; product public.products%ROWTYPE;
 item jsonb; qty numeric; purchase_unit_price numeric; total numeric:=0; iid uuid:=gen_random_uuid(); vid uuid;
 num text; vnum text; supplier uuid:=NULLIF(p_payload->>'supplierId','')::uuid;
 purchase_date date:=(p_payload->>'invoiceDate')::date; method text:=p_payload->>'paymentMethod';
 inventory uuid; payable uuid; cash uuid; cash_box uuid; supplier_balance numeric; result jsonb;
BEGIN
 actor:=public.assert_financial_permission(p_store,'post');
 PERFORM pg_advisory_xact_lock(hashtextextended('financial:' || p_store::text,0));
 IF p_key IS NULL OR purchase_date IS NULL OR method NOT IN ('cash','credit') THEN RAISE EXCEPTION 'تاريخ الشراء أو طريقة الدفع غير صالحة'; END IF;
 SELECT * INTO old_invoice FROM public.purchase_invoices WHERE store_id=p_store AND create_key=p_key;
 IF FOUND THEN
   IF old_invoice.create_payload IS DISTINCT FROM p_payload THEN RAISE EXCEPTION 'معرف الشراء مستخدم بطلب مختلف'; END IF;
   RETURN jsonb_build_object('invoiceId',old_invoice.id,'invoiceNumber',old_invoice.invoice_number);
 END IF;
 IF supplier IS NULL OR NOT EXISTS(SELECT 1 FROM public.suppliers WHERE id=supplier AND store_id=p_store) THEN RAISE EXCEPTION 'المورد لا يتبع المتجر'; END IF;
 IF EXISTS(SELECT 1 FROM public.accounting_periods WHERE store_id=p_store AND is_closed AND purchase_date BETWEEN start_date AND end_date) THEN RAISE EXCEPTION 'الفترة المحاسبية مقفلة'; END IF;
 IF jsonb_typeof(p_payload->'items') IS DISTINCT FROM 'array' OR jsonb_array_length(p_payload->'items') NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'بنود الشراء غير صالحة'; END IF;
 inventory:=public.resolve_financial_account(p_store,'INVENTORY');
 payable:=public.resolve_financial_account(p_store,'SUPPLIER_PAYABLE',supplier);
 IF method='cash' THEN
   cash:=public.resolve_financial_account(p_store,'CASH',NULLIF(p_payload->>'cashBoxId','')::uuid);
   SELECT id INTO cash_box FROM public.cash_boxes WHERE store_id=p_store AND account_id=cash AND is_active IS TRUE
     AND (NULLIF(p_payload->>'cashBoxId','') IS NULL OR id=(p_payload->>'cashBoxId')::uuid) LIMIT 1;
   IF cash_box IS NULL THEN RAISE EXCEPTION 'صندوق نقدي نشط مطلوب'; END IF;
 END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_payload->'items') ORDER BY value->>'productId' LOOP
   IF NULLIF(item->>'productId','') IS NULL OR jsonb_typeof(item->'quantity')<>'number' OR jsonb_typeof(item->'unitPrice')<>'number' THEN RAISE EXCEPTION 'بند الشراء غير صالح'; END IF;
   qty:=(item->>'quantity')::numeric;purchase_unit_price:=(item->>'unitPrice')::numeric;
   IF qty<=0 OR qty<>trunc(qty) OR purchase_unit_price<0 OR purchase_unit_price<>round(purchase_unit_price,2) OR qty>1000000 THEN RAISE EXCEPTION 'كمية أو تكلفة غير صالحة'; END IF;
   SELECT * INTO product FROM public.products WHERE id=(item->>'productId')::uuid AND store_id=p_store FOR UPDATE;
   IF NOT FOUND OR product.track_stock IS FALSE OR COALESCE(product.stock_quantity,0)<0 THEN RAISE EXCEPTION 'الصنف غير صالح لاستلام المخزون'; END IF;
   total:=total+round(qty*purchase_unit_price,2);
 END LOOP;
 IF total<=0 THEN RAISE EXCEPTION 'إجمالي الشراء غير صالح'; END IF;
 num:=public.generate_sequence_number(p_store,'PINV2-' || to_char(purchase_date,'YYYY') || '-');
 INSERT INTO public.purchase_invoices(id,store_id,supplier_id,invoice_number,supplier_invoice_number,status,payment_status,payment_method,
   subtotal,total_amount,paid_amount,currency,invoice_date,notes,created_by,create_key,create_payload)
 VALUES(iid,p_store,supplier,num,NULLIF(p_payload->>'supplierInvoiceNumber',''),'completed',CASE WHEN method='cash' THEN 'paid' ELSE 'unpaid' END,method,
   total,total,CASE WHEN method='cash' THEN total ELSE 0 END,'ILS',purchase_date,p_payload->>'notes',actor,p_key,p_payload);
 FOR item IN SELECT value FROM jsonb_array_elements(p_payload->'items') ORDER BY value->>'productId' LOOP
   qty:=(item->>'quantity')::numeric;purchase_unit_price:=(item->>'unitPrice')::numeric;
   SELECT * INTO product FROM public.products WHERE id=(item->>'productId')::uuid FOR UPDATE;
   INSERT INTO public.purchase_items(purchase_invoice_id,product_id,product_name,quantity,unit_price,total_price)
     VALUES(iid,product.id,product.name,qty,purchase_unit_price,round(qty*purchase_unit_price,2));
   UPDATE public.products SET stock_quantity=COALESCE(stock_quantity,0)+qty,
     cost_price=round((COALESCE(stock_quantity,0)*COALESCE(cost_price,0)+qty*purchase_unit_price)/(COALESCE(stock_quantity,0)+qty),2) WHERE id=product.id;
   INSERT INTO public.inventory_movements(store_id,product_id,movement_type,document_number,document_type,ref_id,quantity_in,quantity_out,balance_after,unit_price,unit_cost,movement_date,created_by)
     VALUES(p_store,product.id,'purchase',num,'purchase_invoice',iid,qty,0,COALESCE(product.stock_quantity,0)+qty,purchase_unit_price,purchase_unit_price,purchase_date,actor);
   INSERT INTO public.stock_movements(store_id,product_id,type,quantity,quantity_before,quantity_after,reference_id,reference_type,created_by)
     VALUES(p_store,product.id,'purchase',qty,COALESCE(product.stock_quantity,0),COALESCE(product.stock_quantity,0)+qty,iid,'purchase_invoice',actor);
 END LOOP;
 UPDATE public.suppliers SET balance=COALESCE(balance,0)+total WHERE id=supplier RETURNING balance INTO supplier_balance;
 INSERT INTO public.supplier_ledger(store_id,supplier_id,type,date,description,reference,reference_id,reference_type,debit,credit,balance,created_by)
   VALUES(p_store,supplier,'invoice',purchase_date,'فاتورة شراء ' || num,num,iid,'purchase_invoice',0,total,supplier_balance,actor);
 result:=public.post_journal_entry_atomic(jsonb_build_object('storeId',p_store,'date',purchase_date,'description','فاتورة شراء ' || num,
   'source','purchase','refId',iid,'sourceType','purchase_invoice','sourceNumber',num,'sourceModule','PURCHASES','accountingRule','PURCHASE_POSTED',
   'lines',jsonb_build_array(jsonb_build_object('account_id',inventory,'debit',total,'credit',0),jsonb_build_object('account_id',payable,'debit',0,'credit',total))));
 IF method='cash' THEN
   vid:=gen_random_uuid();vnum:=public.generate_sequence_number(p_store,'PAY2-' || to_char(purchase_date,'YYYY') || '-');
   INSERT INTO public.vouchers(id,store_id,voucher_number,type,date,amount,supplier_id,party_name,payment_method,description,purchase_invoice_id,created_by,cash_box_id,cash_amount)
   VALUES(vid,p_store,vnum,'payment',purchase_date,total,supplier,(SELECT s.name FROM public.suppliers s WHERE s.id=supplier),'cash','تسديد فاتورة شراء ' || num,iid,actor,
     cash_box,total);
   PERFORM public.post_journal_entry_atomic(jsonb_build_object('storeId',p_store,'date',purchase_date,'description','سند صرف ' || vnum,
     'source','voucher','refId',vid,'sourceType','payment_voucher','sourceNumber',vnum,'accountingRule','SUPPLIER_PAYMENT_MADE','sourceModule','TREASURY',
     'lines',jsonb_build_array(jsonb_build_object('account_id',payable,'debit',total,'credit',0),jsonb_build_object('account_id',cash,'debit',0,'credit',total))));
   UPDATE public.suppliers SET balance=COALESCE(balance,0)-total WHERE id=supplier RETURNING balance INTO supplier_balance;
   INSERT INTO public.supplier_ledger(store_id,supplier_id,type,date,description,reference,reference_id,reference_type,debit,credit,balance,created_by)
     VALUES(p_store,supplier,'payment',purchase_date,'سند صرف ' || vnum,vnum,vid,'voucher',total,0,supplier_balance,actor);
 END IF;
 INSERT INTO public.financial_audit_log(store_id,entity_type,entity_id,entity_label,action,actor_id,details)
   VALUES(p_store,'invoice',iid,num,'create',actor,jsonb_build_object('document_type','purchase_invoice','total',total,'payment_method',method));
 RETURN jsonb_build_object('invoiceId',iid,'invoiceNumber',num);
END $$;
REVOKE ALL ON FUNCTION public.create_purchase_invoice_atomic(uuid,jsonb,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_purchase_invoice_atomic(uuid,jsonb,uuid) TO authenticated;
COMMIT;
