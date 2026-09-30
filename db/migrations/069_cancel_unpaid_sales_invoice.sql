BEGIN;
CREATE FUNCTION public.cancel_unpaid_sales_invoice_atomic(p_invoice uuid,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE inv public.invoices%ROWTYPE; item public.invoice_items%ROWTYPE; product public.products%ROWTYPE;
 actor uuid; new_balance numeric; movement_count integer; reversal jsonb;
BEGIN
 SELECT * INTO inv FROM public.invoices WHERE id=p_invoice;
 IF NOT FOUND THEN RAISE EXCEPTION 'الفاتورة غير موجودة'; END IF;
 actor:=public.assert_financial_permission(inv.store_id,'post');
 PERFORM pg_advisory_xact_lock(hashtextextended('financial:' || inv.store_id::text,0));
 SELECT * INTO inv FROM public.invoices WHERE id=p_invoice FOR UPDATE;
 IF inv.status='cancelled' THEN RETURN jsonb_build_object('ok',true,'alreadyCancelled',true); END IF;
 IF NULLIF(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'سبب الإلغاء مطلوب'; END IF;
 IF inv.order_id IS NOT NULL THEN RAISE EXCEPTION 'فاتورة طلب مُسلّم تحتاج مسار مرتجع مرتبط بالطلب'; END IF;
 IF COALESCE(inv.amount_paid,0)<>0 OR EXISTS(SELECT 1 FROM public.vouchers WHERE invoice_id=p_invoice AND store_id=inv.store_id) THEN
   RAISE EXCEPTION 'الفاتورة المسددة تحتاج ردّ المبلغ أولاً'; END IF;
 IF EXISTS(SELECT 1 FROM public.accounting_periods WHERE store_id=inv.store_id AND is_closed AND inv.issue_date BETWEEN start_date AND end_date) THEN RAISE EXCEPTION 'الفترة المحاسبية مقفلة'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.journal_entries WHERE id=inv.journal_entry_id AND store_id=inv.store_id AND status='posted' AND accounting_rule='SALE_POSTED') THEN
   RAISE EXCEPTION 'لا يمكن إلغاء فاتورة بلا قيد مبيعات صحيح'; END IF;
 FOR item IN SELECT * FROM public.invoice_items WHERE invoice_id=p_invoice ORDER BY product_id,id LOOP
   IF item.product_id IS NOT NULL THEN
     SELECT * INTO product FROM public.products WHERE id=item.product_id AND store_id=inv.store_id FOR UPDATE;
     IF NOT FOUND THEN RAISE EXCEPTION 'صنف الفاتورة غير موجود'; END IF;
     IF product.track_stock IS NOT FALSE THEN
       SELECT count(*) INTO movement_count FROM public.inventory_movements WHERE store_id=inv.store_id AND ref_id=p_invoice AND product_id=item.product_id AND movement_type='sale';
       IF movement_count=0 THEN RAISE EXCEPTION 'حركة صرف الصنف مفقودة؛ يلزم تدقيق قبل الإلغاء'; END IF;
       UPDATE public.products SET stock_quantity=COALESCE(stock_quantity,0)+item.quantity WHERE id=product.id;
       INSERT INTO public.inventory_movements(store_id,product_id,movement_type,document_number,document_type,ref_id,quantity_in,quantity_out,balance_after,unit_price,unit_cost,movement_date,created_by)
         VALUES(inv.store_id,product.id,'sales_return',inv.invoice_number,'invoice_cancellation',p_invoice,item.quantity,0,COALESCE(product.stock_quantity,0)+item.quantity,item.unit_price,item.cost_price,current_date,actor);
       INSERT INTO public.stock_movements(store_id,product_id,type,quantity,quantity_before,quantity_after,reference_id,reference_type,created_by)
         VALUES(inv.store_id,product.id,'return',item.quantity,COALESCE(product.stock_quantity,0),COALESCE(product.stock_quantity,0)+item.quantity,p_invoice,'invoice_cancellation',actor);
     END IF;
   END IF;
 END LOOP;
 reversal:=public.reverse_journals_for_source(inv.store_id,p_invoice,'invoice',p_reason,current_date);
 IF inv.customer_id IS NOT NULL THEN
   UPDATE public.customers SET balance=COALESCE(balance,0)-COALESCE(inv.total,inv.total_amount,0),
     total_invoiced=COALESCE(total_invoiced,0)-COALESCE(inv.total,inv.total_amount,0)
     WHERE id=inv.customer_id AND store_id=inv.store_id RETURNING balance INTO new_balance;
   INSERT INTO public.customer_ledger(store_id,customer_id,type,date,description,debit,credit,balance,reference_id,reference_type,created_by)
     VALUES(inv.store_id,inv.customer_id,'return',current_date,'إلغاء فاتورة ' || inv.invoice_number,0,COALESCE(inv.total,inv.total_amount,0),new_balance,p_invoice,'invoice_cancellation',actor);
 END IF;
 UPDATE public.invoices SET status='cancelled',updated_at=now() WHERE id=p_invoice;
 IF inv.quotation_id IS NOT NULL THEN UPDATE public.quotations SET status='accepted',converted_invoice_id=NULL WHERE id=inv.quotation_id AND store_id=inv.store_id AND converted_invoice_id=p_invoice; END IF;
 INSERT INTO public.financial_audit_log(store_id,entity_type,entity_id,entity_label,action,actor_id,details)
   VALUES(inv.store_id,'invoice',p_invoice,inv.invoice_number,'cancel',actor,jsonb_build_object('reason',p_reason,'reversal',reversal));
 RETURN jsonb_build_object('ok',true,'reversal',reversal);
END $$;
REVOKE ALL ON FUNCTION public.cancel_unpaid_sales_invoice_atomic(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.cancel_unpaid_sales_invoice_atomic(uuid,text) TO authenticated;
COMMIT;
