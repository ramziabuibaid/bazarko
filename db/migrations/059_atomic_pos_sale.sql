BEGIN;
ALTER TABLE public.invoice_items ADD COLUMN cost_snapshot_at timestamptz;
ALTER TABLE public.inventory_movements ADD COLUMN unit_cost numeric(14,2);
ALTER TABLE public.orders ADD COLUMN sale_key uuid;
ALTER TABLE public.orders ADD COLUMN sale_payload jsonb;
CREATE UNIQUE INDEX pos_sale_key ON public.orders(store_id,sale_key) WHERE sale_key IS NOT NULL;
CREATE FUNCTION public.create_pos_sale_atomic(p_store uuid,p_payload jsonb,p_key uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid; existing public.orders%ROWTYPE; product public.products%ROWTYPE; customer public.customers%ROWTYPE;
 item jsonb; payment jsonb; payments jsonb; qty integer; price numeric; total numeric:=0; cost numeric:=0; paid numeric:=0; amount numeric;
 oid uuid:=gen_random_uuid(); iid uuid:=gen_random_uuid(); vid uuid; onum text; inum text; vnum text;
 cid uuid:=NULLIF(p_payload->>'customerId','')::uuid; name text; lines jsonb; result jsonb; ar uuid; sales uuid; destination uuid; box uuid; bank uuid;
 check_data jsonb; method text; account_tag text; current_balance numeric; invoice_method text;
BEGIN
 actor:=public.assert_financial_permission(p_store,'post');
 PERFORM pg_advisory_xact_lock(hashtextextended('financial:' || p_store::text,0));
 IF p_key IS NULL THEN RAISE EXCEPTION 'معرف الطلب مطلوب'; END IF;
 SELECT * INTO existing FROM public.orders WHERE store_id=p_store AND sale_key=p_key;
 IF FOUND THEN
   IF existing.sale_payload IS DISTINCT FROM p_payload THEN RAISE EXCEPTION 'مفتاح العملية مستخدم بطلب مختلف'; END IF;
   SELECT id,invoice_number INTO iid,inum FROM public.invoices WHERE order_id=existing.id AND store_id=p_store;
   RETURN jsonb_build_object('orderId',existing.id,'orderNumber',existing.order_number,'invoiceId',iid,'invoiceNumber',inum);
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.stores WHERE id=p_store AND status='active' AND is_active IS TRUE) THEN RAISE EXCEPTION 'المتجر غير نشط'; END IF;
 IF jsonb_typeof(p_payload->'items') IS DISTINCT FROM 'array' OR jsonb_array_length(p_payload->'items') NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'بنود البيع غير صالحة'; END IF;
 IF cid IS NOT NULL THEN
   SELECT * INTO customer FROM public.customers WHERE id=cid AND store_id=p_store AND is_active IS TRUE FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'العميل غير صالح للمتجر'; END IF;
 END IF;
 name:=COALESCE(customer.name,NULLIF(btrim(p_payload->>'customerName'),''),'عميل نقدي');
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_payload->'items') i WHERE
   jsonb_typeof(i->'quantity') IS DISTINCT FROM 'number' OR (i->>'quantity')::numeric<=0
   OR (i->>'quantity')::numeric<>trunc((i->>'quantity')::numeric) OR (i->>'quantity')::numeric>1000000
   OR jsonb_typeof(i->'unitPrice') IS DISTINCT FROM 'number' OR (i->>'unitPrice')::numeric<0
   OR (i->>'unitPrice')::numeric<>round((i->>'unitPrice')::numeric,2)) THEN RAISE EXCEPTION 'الكمية أو السعر غير صالح'; END IF;
 IF (SELECT count(*) FROM jsonb_array_elements(p_payload->'items'))<>(SELECT count(DISTINCT i->>'productId') FROM jsonb_array_elements(p_payload->'items') i) THEN RAISE EXCEPTION 'اجمع كمية المنتج في سطر واحد'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_payload->'items') ORDER BY value->>'productId' LOOP
   SELECT * INTO product FROM public.products WHERE id=(item->>'productId')::uuid AND store_id=p_store AND status='active' FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'منتج غير متاح في المتجر'; END IF;
   qty:=(item->>'quantity')::integer; price:=(item->>'unitPrice')::numeric;
   IF product.track_stock IS NOT FALSE AND product.allow_backorder IS NOT TRUE AND COALESCE(product.stock_quantity,0)-COALESCE(product.stock_reserved,0)<qty THEN RAISE EXCEPTION 'الكمية غير متوفرة: %',product.name; END IF;
   IF product.cost_price IS NULL OR product.cost_price<0 THEN RAISE EXCEPTION 'تكلفة المنتج غير محددة'; END IF;
   total:=total+price*qty;
   IF product.track_stock IS NOT FALSE THEN cost:=cost+product.cost_price*qty; END IF;
 END LOOP;
 IF total<=0 THEN RAISE EXCEPTION 'قيمة الفاتورة يجب أن تكون موجبة'; END IF;
 payments:=p_payload->'payments';
 IF payments IS NULL THEN
   amount:=COALESCE((p_payload->>'amountPaid')::numeric,0);
   IF amount<0 OR amount>total THEN RAISE EXCEPTION 'المبلغ المدفوع غير صالح'; END IF;
   IF p_payload->>'paymentMethod' IN ('online','credit') AND amount>0 THEN RAISE EXCEPTION 'حدد وسيلة التسديد المؤكدة صراحةً'; END IF;
   payments:=CASE WHEN amount=0 THEN '[]'::jsonb ELSE jsonb_build_array(jsonb_build_object('method',p_payload->>'paymentMethod','amount',amount,
     'cashBoxId',p_payload->>'cashBoxId','bankAccountId',p_payload->>'bankAccountId','confirmed',p_payload->'confirmed','check',p_payload->'check')) END;
 END IF;
 IF jsonb_typeof(payments) IS DISTINCT FROM 'array' OR jsonb_array_length(payments)>50 THEN RAISE EXCEPTION 'توزيع الدفع غير صالح'; END IF;
 FOR payment IN SELECT value FROM jsonb_array_elements(payments) LOOP
   IF jsonb_typeof(payment->'amount') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'مبلغ الدفع غير صالح'; END IF;
   amount:=(payment->>'amount')::numeric;
   IF amount<=0 OR amount<>round(amount,2) OR COALESCE(payment->>'method','') NOT IN ('cash','bank_transfer','check') THEN RAISE EXCEPTION 'وسيلة الدفع أو المبلغ غير صالح'; END IF;
   paid:=paid+amount;
 END LOOP;
 IF paid>total OR (paid<total AND cid IS NULL) THEN RAISE EXCEPTION 'التوزيع يتجاوز الفاتورة أو يحتاج عميلاً للمتبقي'; END IF;
 ar:=public.resolve_financial_account(p_store,'CUSTOMER_RECEIVABLE',cid);
 sales:=public.resolve_financial_account(p_store,'SALES_REVENUE');
 onum:=public.generate_sequence_number(p_store,'POS2-' || to_char(current_date,'YYYY') || '-');
 inum:=public.generate_sequence_number(p_store,'INV2-' || to_char(current_date,'YYYY') || '-');
 method:=CASE WHEN jsonb_array_length(payments)=1 THEN payments->0->>'method' ELSE 'credit' END;
 invoice_method:=CASE method WHEN 'bank_transfer' THEN 'bank' ELSE method END;
 INSERT INTO public.orders(id,store_id,customer_id,order_number,status,source,payment_method,payment_status,subtotal,total_amount,amount_paid,customer_name,customer_phone,customer_email,internal_notes,sale_key,sale_payload)
 VALUES(oid,p_store,cid,onum,'delivered','dashboard',method,CASE WHEN paid=total THEN 'paid' WHEN paid>0 THEN 'partial' ELSE 'unpaid' END,total,total,paid,name,
   COALESCE(customer.phone,p_payload->>'customerPhone'),COALESCE(customer.email,p_payload->>'customerEmail'),p_payload->>'notes',p_key,p_payload);
 INSERT INTO public.invoices(id,store_id,invoice_number,order_id,customer_id,customer_name,customer_phone,issue_date,payment_method,status,subtotal,total,total_amount,amount_paid,created_by)
 VALUES(iid,p_store,inum,oid,cid,name,COALESCE(customer.phone,p_payload->>'customerPhone'),current_date,invoice_method,
   CASE WHEN paid=total THEN 'paid' WHEN paid>0 THEN 'partial' ELSE 'sent' END,total,total,total,paid,actor);
 FOR item IN SELECT value FROM jsonb_array_elements(p_payload->'items') ORDER BY value->>'productId' LOOP
   SELECT * INTO product FROM public.products WHERE id=(item->>'productId')::uuid;
   qty:=(item->>'quantity')::integer; price:=(item->>'unitPrice')::numeric;
   INSERT INTO public.order_items(order_id,product_id,product_name,product_sku,quantity,unit_price,cost_price,total_price)
     VALUES(oid,product.id,product.name,product.sku,qty,price,product.cost_price,price*qty);
   INSERT INTO public.invoice_items(invoice_id,product_id,description,name,sku,quantity,unit_price,total_price,total,cost_price,cost_snapshot_at)
     VALUES(iid,product.id,product.name,product.name,product.sku,qty,price,price*qty,price*qty,product.cost_price,now());
   IF product.track_stock IS NOT FALSE THEN
     UPDATE public.products SET stock_quantity=COALESCE(stock_quantity,0)-qty WHERE id=product.id;
     INSERT INTO public.inventory_movements(store_id,product_id,movement_type,document_number,document_type,ref_id,entity_name,quantity_in,quantity_out,balance_after,unit_price,unit_cost,movement_date,created_by)
       VALUES(p_store,product.id,'sale',inum,'invoice',iid,name,0,qty,COALESCE(product.stock_quantity,0)-qty,price,product.cost_price,current_date,actor);
     INSERT INTO public.stock_movements(store_id,product_id,type,quantity,quantity_before,quantity_after,reference_id,reference_type,created_by)
       VALUES(p_store,product.id,'sale',qty,COALESCE(product.stock_quantity,0),COALESCE(product.stock_quantity,0)-qty,iid,'invoice',actor);
   END IF;
 END LOOP;
 lines:=jsonb_build_array(jsonb_build_object('account_id',ar,'debit',total,'credit',0),jsonb_build_object('account_id',sales,'debit',0,'credit',total));
 IF cost>0 THEN lines:=lines || jsonb_build_array(
   jsonb_build_object('account_id',public.resolve_financial_account(p_store,'COGS'),'debit',cost,'credit',0),
   jsonb_build_object('account_id',public.resolve_financial_account(p_store,'INVENTORY'),'debit',0,'credit',cost)); END IF;
 result:=public.post_journal_entry_atomic(jsonb_build_object('storeId',p_store,'date',current_date,'description','فاتورة ' || inum,
   'source','invoice','refId',iid,'sourceType','sales_invoice','sourceNumber',inum,'accountingRule','SALE_POSTED','sourceModule','SALES','lines',lines));
 IF cid IS NOT NULL THEN
   UPDATE public.customers SET balance=COALESCE(balance,0)+total,total_invoiced=COALESCE(total_invoiced,0)+total,
     total_orders=COALESCE(total_orders,0)+1,last_order_at=now() WHERE id=cid RETURNING balance INTO current_balance;
   INSERT INTO public.customer_ledger(store_id,customer_id,type,date,description,debit,credit,balance,reference_id,reference_type,created_by)
     VALUES(p_store,cid,'invoice',current_date,'فاتورة ' || inum,total,0,current_balance,iid,'invoice',actor);
 END IF;
 FOR payment IN SELECT value FROM jsonb_array_elements(payments) LOOP
   amount:=(payment->>'amount')::numeric; method:=payment->>'method'; box:=NULL;bank:=NULL;check_data:='[]';
   IF method='cash' THEN
     box:=NULLIF(payment->>'cashBoxId','')::uuid;
     destination:=public.resolve_financial_account(p_store,'CASH',box);
     IF box IS NULL THEN SELECT id INTO box FROM public.cash_boxes WHERE store_id=p_store AND is_default IS TRUE AND is_active IS TRUE; END IF;
     IF box IS NULL THEN RAISE EXCEPTION 'صندوق نقدي نشط مطلوب'; END IF;
   ELSIF method='bank_transfer' THEN
     IF COALESCE((payment->>'confirmed')::boolean,false) IS NOT TRUE THEN RAISE EXCEPTION 'التحويل البنكي يحتاج تأكيداً'; END IF;
     bank:=NULLIF(payment->>'bankAccountId','')::uuid;
     destination:=public.resolve_financial_account(p_store,'BANK',bank);
   ELSE
     IF cid IS NULL OR NULLIF(payment->'check'->>'check_number','') IS NULL OR NULLIF(payment->'check'->>'bank_name','') IS NULL
       OR NULLIF(payment->'check'->>'due_date','') IS NULL THEN RAISE EXCEPTION 'بيانات الشيك والعميل مطلوبة'; END IF;
     PERFORM (payment->'check'->>'due_date')::date;
     check_data:=jsonb_build_array((payment->'check') || jsonb_build_object('amount',amount,'currency','ILS','exchange_rate',1));
     destination:=public.resolve_financial_account(p_store,'CHEQUES_IN_HAND');
   END IF;
   vid:=gen_random_uuid(); vnum:=public.generate_sequence_number(p_store,'RCPT2-' || to_char(current_date,'YYYY') || '-');
   INSERT INTO public.vouchers(id,store_id,voucher_number,type,date,amount,customer_id,party_name,payment_method,description,created_by,
     bank_account_id,cash_box_id,cash_amount,checks_amount,checks_data,invoice_id)
   VALUES(vid,p_store,vnum,'receipt',current_date,amount,cid,name,CASE method WHEN 'bank_transfer' THEN 'bank' ELSE method END,'تسديد فاتورة ' || inum,actor,
     bank,box,CASE WHEN method='cash' THEN amount ELSE 0 END,CASE WHEN method='check' THEN amount ELSE 0 END,check_data,iid);
   -- Existing voucher triggers create exactly the cash movement or bound cheque, in this transaction.
   result:=public.post_journal_entry_atomic(jsonb_build_object('storeId',p_store,'date',current_date,'description','سند قبض ' || vnum,
     'source','voucher','refId',vid,'sourceType','receipt_voucher','sourceNumber',vnum,'accountingRule','CUSTOMER_PAYMENT_RECEIVED','sourceModule','TREASURY',
     'lines',jsonb_build_array(jsonb_build_object('account_id',destination,'debit',amount,'credit',0),jsonb_build_object('account_id',ar,'debit',0,'credit',amount))));
   IF bank IS NOT NULL THEN UPDATE public.bank_accounts SET balance=COALESCE(balance,0)+amount,updated_at=now() WHERE id=bank; END IF;
   IF cid IS NOT NULL THEN
     UPDATE public.customers SET balance=COALESCE(balance,0)-amount,total_paid=COALESCE(total_paid,0)+amount WHERE id=cid RETURNING balance INTO current_balance;
     INSERT INTO public.customer_ledger(store_id,customer_id,type,date,description,debit,credit,balance,reference_id,reference_type,created_by)
       VALUES(p_store,cid,'payment',current_date,'سند قبض ' || vnum,0,amount,current_balance,vid,'voucher',actor);
   END IF;
 END LOOP;
 IF NULLIF(btrim(p_payload->>'customerEmail'),'') IS NOT NULL THEN
   INSERT INTO public.order_email_outbox(order_id,store_id,recipient)
   VALUES(oid,p_store,btrim(p_payload->>'customerEmail'));
 END IF;
 RETURN jsonb_build_object('orderId',oid,'orderNumber',onum,'invoiceId',iid,'invoiceNumber',inum);
END $$;
REVOKE ALL ON FUNCTION public.create_pos_sale_atomic(uuid,jsonb,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_pos_sale_atomic(uuid,jsonb,uuid) TO authenticated;
COMMIT;
