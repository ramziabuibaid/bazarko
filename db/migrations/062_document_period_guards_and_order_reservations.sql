BEGIN;
CREATE FUNCTION public.guard_financial_document_period() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE old_row jsonb; new_row jsonb; store uuid; old_date date; new_date date;
BEGIN
 IF TG_OP<>'INSERT' THEN old_row:=to_jsonb(OLD); old_date:=(old_row->>TG_ARGV[0])::date; END IF;
 IF TG_OP<>'DELETE' THEN new_row:=to_jsonb(NEW); new_date:=(new_row->>TG_ARGV[0])::date; END IF;
 store:=COALESCE(new_row->>'store_id',old_row->>'store_id')::uuid;
 IF TG_OP='UPDATE' AND new_row->>'store_id' IS DISTINCT FROM old_row->>'store_id' THEN RAISE EXCEPTION 'نقل مستند بين المتاجر غير مسموح'; END IF;
 PERFORM public.assert_financial_permission(store,'post');
 PERFORM pg_advisory_xact_lock(hashtextextended('financial:' || store::text,0));
 -- A receipt in an open period may settle an older invoice. The invoice's original
 -- financial facts stay fixed; its settlement fields are derived from that receipt.
 IF TG_TABLE_NAME='invoices' AND TG_OP='UPDATE' AND
   (new_row - 'status' - 'amount_paid' - 'amount_remaining' - 'paid_at' - 'paid_date' - 'updated_at') =
   (old_row - 'status' - 'amount_paid' - 'amount_remaining' - 'paid_at' - 'paid_date' - 'updated_at') AND
   EXISTS(SELECT 1 FROM public.vouchers v JOIN public.journal_entries j ON j.ref_id=v.id AND j.store_id=v.store_id
     WHERE v.invoice_id=(new_row->>'id')::uuid AND v.store_id=store AND v.invoice_payment_key IS NOT NULL
       AND v.amount=(COALESCE((new_row->>'amount_paid')::numeric,0)-COALESCE((old_row->>'amount_paid')::numeric,0))
       AND v.created_at=now() AND j.status='posted' AND j.accounting_rule='CUSTOMER_PAYMENT_RECEIVED')
   THEN RETURN NEW; END IF;
 IF TG_TABLE_NAME='purchase_invoices' AND TG_OP='UPDATE' AND
   (new_row - 'payment_status' - 'paid_amount' - 'updated_at') = (old_row - 'payment_status' - 'paid_amount' - 'updated_at') AND
   EXISTS(SELECT 1 FROM public.vouchers v JOIN public.journal_entries j ON j.ref_id=v.id AND j.store_id=v.store_id
     WHERE v.purchase_invoice_id=(new_row->>'id')::uuid AND v.store_id=store AND v.create_key IS NOT NULL
       AND v.amount=(COALESCE((new_row->>'paid_amount')::numeric,0)-COALESCE((old_row->>'paid_amount')::numeric,0))
       AND v.created_at=now() AND j.status='posted' AND j.accounting_rule='SUPPLIER_PAYMENT_MADE')
   THEN RETURN NEW; END IF;
 IF EXISTS(SELECT 1 FROM public.accounting_periods WHERE store_id=store AND is_closed
   AND (old_date BETWEEN start_date AND end_date OR new_date BETWEEN start_date AND end_date)) THEN RAISE EXCEPTION 'الفترة المحاسبية مقفلة'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
DO $$ DECLARE t text; d text; BEGIN
 FOR t,d IN SELECT * FROM (VALUES ('invoices','issue_date'),('purchase_invoices','invoice_date'),('vouchers','date'),
   ('cash_movements','date'),('customer_ledger','date'),('supplier_ledger','date'),('inventory_movements','movement_date'),('stock_movements','created_at')) x LOOP
   EXECUTE format('CREATE TRIGGER financial_period_guard BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.guard_financial_document_period(%L)',t,d);
 END LOOP;
END $$;

CREATE FUNCTION public.transition_order_reservations() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r public.order_stock_reservations%ROWTYPE; product public.products%ROWTYPE; actor uuid;
BEGIN
 IF NEW.checkout_key IS NULL OR NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
 actor:=public.assert_financial_permission(NEW.store_id,'post');
 PERFORM pg_advisory_xact_lock(hashtextextended('financial:' || NEW.store_id::text,0));
 IF OLD.status IN ('cancelled','returned','delivered') THEN RAISE EXCEPTION 'تغيير طلب منتهٍ يحتاج عملية مرتجع أو طلباً جديداً'; END IF;
 IF NEW.status='returned' THEN RAISE EXCEPTION 'مرتجع البيع يحتاج مستند مرتجع'; END IF;
 IF NEW.status IN ('cancelled','delivered') THEN
   FOR r IN SELECT * FROM public.order_stock_reservations WHERE order_id=NEW.id AND state='reserved' ORDER BY product_id FOR UPDATE LOOP
     SELECT * INTO product FROM public.products WHERE id=r.product_id AND store_id=NEW.store_id FOR UPDATE;
     IF NOT FOUND OR COALESCE(product.stock_reserved,0)<r.quantity THEN RAISE EXCEPTION 'حجز المخزون غير متطابق'; END IF;
     IF NEW.status='delivered' AND product.allow_backorder IS NOT TRUE AND COALESCE(product.stock_quantity,0)<r.quantity THEN RAISE EXCEPTION 'المخزون غير كافٍ للتسليم'; END IF;
     UPDATE public.products SET stock_reserved=stock_reserved-r.quantity,
       stock_quantity=COALESCE(stock_quantity,0)-CASE WHEN NEW.status='delivered' THEN r.quantity ELSE 0 END WHERE id=r.product_id;
     UPDATE public.order_stock_reservations SET state=CASE WHEN NEW.status='delivered' THEN 'consumed' ELSE 'released' END WHERE order_id=r.order_id AND product_id=r.product_id;
     IF NEW.status='delivered' THEN
       INSERT INTO public.inventory_movements(store_id,product_id,movement_type,document_number,document_type,ref_id,quantity_in,quantity_out,balance_after,unit_cost,movement_date,created_by)
         VALUES(NEW.store_id,r.product_id,'sale',NEW.order_number,'order',NEW.id,0,r.quantity,COALESCE(product.stock_quantity,0)-r.quantity,r.unit_cost,current_date,actor);
       INSERT INTO public.stock_movements(store_id,product_id,type,quantity,quantity_before,quantity_after,reference_id,reference_type,created_by)
         VALUES(NEW.store_id,r.product_id,'sale',r.quantity,COALESCE(product.stock_quantity,0),COALESCE(product.stock_quantity,0)-r.quantity,NEW.id,'order',actor);
     END IF;
   END LOOP;
   IF NEW.status='cancelled' THEN
     UPDATE public.offer_items oi SET sold_quantity=GREATEST(0,COALESCE(oi.sold_quantity,0)-x.qty)
       FROM (SELECT offer_item_id,sum(quantity)::integer qty FROM public.order_items WHERE order_id=NEW.id AND offer_item_id IS NOT NULL GROUP BY offer_item_id) x
       WHERE oi.id=x.offer_item_id;
   END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER order_reservation_transition BEFORE UPDATE OF status ON public.orders FOR EACH ROW EXECUTE FUNCTION public.transition_order_reservations();
REVOKE ALL ON FUNCTION public.guard_financial_document_period(),public.transition_order_reservations() FROM PUBLIC,anon,authenticated;
COMMIT;
