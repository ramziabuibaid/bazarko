BEGIN;
CREATE FUNCTION public.receive_purchase_order_atomic(p_po uuid,p_receive boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE po public.purchase_orders%ROWTYPE; item public.purchase_order_items%ROWTYPE; product public.products%ROWTYPE;
 actor uuid; iid uuid:=gen_random_uuid(); num text; total numeric:=0; supplier_balance numeric; result jsonb; inventory uuid; payable uuid;
BEGIN
 SELECT * INTO po FROM public.purchase_orders WHERE id=p_po;
 IF NOT FOUND THEN RAISE EXCEPTION 'أمر الشراء غير موجود'; END IF;
 actor:=public.assert_financial_permission(po.store_id,'post');
 PERFORM pg_advisory_xact_lock(hashtextextended('financial:' || po.store_id::text,0));
 SELECT * INTO po FROM public.purchase_orders WHERE id=p_po FOR UPDATE;
 IF po.converted_invoice_id IS NOT NULL THEN RETURN jsonb_build_object('ok',true,'invoiceId',po.converted_invoice_id); END IF;
 IF p_receive IS NOT TRUE THEN RAISE EXCEPTION 'يلزم تأكيد الاستلام الفعلي؛ إنشاء الفاتورة وحده لا يستلم المخزون'; END IF;
 IF po.status <> 'confirmed' THEN RAISE EXCEPTION 'يجب اعتماد أمر الشراء قبل استلامه'; END IF;
 IF po.supplier_id IS NULL THEN RAISE EXCEPTION 'المورد مطلوب'; END IF;
 -- Tax and header discounts need an explicit allocation policy; never silently capitalize them.
 IF po.tax_amount<>0 OR po.discount_amount<>0 THEN RAISE EXCEPTION 'يلزم توزيع الضريبة والخصم على بنود أمر الشراء قبل الاستلام'; END IF;
 inventory:=public.resolve_financial_account(po.store_id,'INVENTORY');
 payable:=public.resolve_financial_account(po.store_id,'SUPPLIER_PAYABLE',po.supplier_id);
 FOR item IN SELECT * FROM public.purchase_order_items WHERE purchase_order_id=p_po ORDER BY product_id,id FOR UPDATE LOOP
   IF item.product_id IS NULL OR item.quantity<=0 OR item.quantity<>trunc(item.quantity) OR item.unit_price<0
      OR item.discount_amount<>0 OR item.total<>round(item.quantity*item.unit_price,2) THEN RAISE EXCEPTION 'بند شراء غير صالح أو يحتاج توزيع خصم'; END IF;
   SELECT * INTO product FROM public.products WHERE id=item.product_id AND store_id=po.store_id FOR UPDATE;
   IF NOT FOUND OR product.track_stock IS FALSE OR COALESCE(product.stock_quantity,0)<0 THEN RAISE EXCEPTION 'صنف غير مخزني أو مخزون سالب يحتاج معالجة التكلفة قبل الاستلام'; END IF;
   total:=total+item.total;
 END LOOP;
 IF total<=0 OR total<>po.total THEN RAISE EXCEPTION 'إجمالي البنود لا يطابق أمر الشراء'; END IF;
 num:=public.generate_sequence_number(po.store_id,'PINV2-' || to_char(current_date,'YYYY') || '-');
 INSERT INTO public.purchase_invoices(id,store_id,supplier_id,invoice_number,status,payment_status,payment_method,subtotal,total_amount,paid_amount,invoice_date,created_by,notes)
 VALUES(iid,po.store_id,po.supplier_id,num,'completed','unpaid','credit',total,total,0,current_date,actor,'استلام أمر الشراء ' || po.order_number);
 FOR item IN SELECT * FROM public.purchase_order_items WHERE purchase_order_id=p_po ORDER BY product_id,id LOOP
   SELECT * INTO product FROM public.products WHERE id=item.product_id;
   INSERT INTO public.purchase_items(purchase_invoice_id,product_id,product_name,quantity,unit_price,total_price)
     VALUES(iid,product.id,product.name,item.quantity,item.unit_price,item.total);
   UPDATE public.products SET stock_quantity=COALESCE(stock_quantity,0)+item.quantity,
     cost_price=round((COALESCE(stock_quantity,0)*COALESCE(cost_price,0)+item.total)/(COALESCE(stock_quantity,0)+item.quantity),2) WHERE id=product.id;
   INSERT INTO public.inventory_movements(store_id,product_id,movement_type,document_number,document_type,ref_id,quantity_in,quantity_out,balance_after,unit_price,unit_cost,movement_date,created_by)
     VALUES(po.store_id,product.id,'purchase',num,'purchase_invoice',iid,item.quantity,0,COALESCE(product.stock_quantity,0)+item.quantity,item.unit_price,item.unit_price,current_date,actor);
   INSERT INTO public.stock_movements(store_id,product_id,type,quantity,quantity_before,quantity_after,reference_id,reference_type,created_by)
     VALUES(po.store_id,product.id,'purchase',item.quantity,COALESCE(product.stock_quantity,0),COALESCE(product.stock_quantity,0)+item.quantity,iid,'purchase_invoice',actor);
 END LOOP;
 UPDATE public.suppliers SET balance=COALESCE(balance,0)+total WHERE id=po.supplier_id AND store_id=po.store_id RETURNING balance INTO supplier_balance;
 INSERT INTO public.supplier_ledger(store_id,supplier_id,type,date,description,reference,reference_id,reference_type,debit,credit,balance,created_by)
 VALUES(po.store_id,po.supplier_id,'invoice',current_date,'فاتورة شراء ' || num,num,iid,'purchase_invoice',0,total,supplier_balance,actor);
 result:=public.post_journal_entry_atomic(jsonb_build_object('storeId',po.store_id,'date',current_date,'description','فاتورة شراء ' || num,
   'source','purchase','refId',iid,'sourceType','purchase_invoice','sourceNumber',num,'sourceModule','PURCHASES','accountingRule','PURCHASE_POSTED',
   'lines',jsonb_build_array(jsonb_build_object('account_id',inventory,'debit',total,'credit',0),jsonb_build_object('account_id',payable,'debit',0,'credit',total))));
 UPDATE public.purchase_orders SET status='received',converted_invoice_id=iid,updated_at=now() WHERE id=p_po;
 RETURN jsonb_build_object('ok',true,'invoiceId',iid);
END $$;
REVOKE ALL ON FUNCTION public.receive_purchase_order_atomic(uuid,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.receive_purchase_order_atomic(uuid,boolean) TO authenticated;
COMMIT;
