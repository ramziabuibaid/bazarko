BEGIN;
CREATE FUNCTION public.guard_posted_invoice_document() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE posted boolean; paid_delta numeric;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'احتفظ بالمستند الأصلي وأنشئ قيداً عكسياً'; END IF;
 IF TG_TABLE_NAME='invoices' THEN
   posted:=EXISTS(SELECT 1 FROM public.journal_entries WHERE store_id=OLD.store_id AND status='posted' AND
     (id=OLD.journal_entry_id OR (ref_id=OLD.id AND source='invoice')));
   IF NOT posted THEN RETURN NEW; END IF;
   IF (to_jsonb(NEW) - 'status' - 'amount_paid' - 'amount_remaining' - 'paid_at' - 'paid_date' - 'updated_at' - 'notes' - 'terms' - 'footer_text') IS DISTINCT FROM
      (to_jsonb(OLD) - 'status' - 'amount_paid' - 'amount_remaining' - 'paid_at' - 'paid_date' - 'updated_at' - 'notes' - 'terms' - 'footer_text') THEN
     RAISE EXCEPTION 'الحقائق المالية للفاتورة المرحلة ثابتة؛ أنشئ عكساً ومستنداً جديداً'; END IF;
   IF NEW.status='cancelled' AND OLD.status<>'cancelled' AND NOT EXISTS
      (SELECT 1 FROM public.journal_entries WHERE reversal_of=OLD.journal_entry_id AND store_id=OLD.store_id AND status='posted') THEN
     RAISE EXCEPTION 'إلغاء الفاتورة يحتاج قيداً عكسياً'; END IF;
   paid_delta:=COALESCE(NEW.amount_paid,0)-COALESCE(OLD.amount_paid,0);
   IF paid_delta<>0 AND NOT EXISTS(SELECT 1 FROM public.vouchers v JOIN public.journal_entries j ON j.ref_id=v.id AND j.store_id=v.store_id
       WHERE v.store_id=OLD.store_id AND v.invoice_id=OLD.id AND v.amount=abs(paid_delta) AND v.created_at=now() AND
         j.status='posted' AND j.accounting_rule='CUSTOMER_PAYMENT_RECEIVED') THEN
     RAISE EXCEPTION 'تغيير المدفوع يحتاج سند قبض مرحلاً في المعاملة'; END IF;
 ELSE
   posted:=EXISTS(SELECT 1 FROM public.journal_entries WHERE store_id=OLD.store_id AND status='posted' AND
     (id=OLD.journal_entry_id OR (ref_id=OLD.id AND source='purchase')));
   IF NOT posted THEN RETURN NEW; END IF;
   IF (to_jsonb(NEW) - 'payment_status' - 'paid_amount' - 'updated_at' - 'notes') IS DISTINCT FROM
      (to_jsonb(OLD) - 'payment_status' - 'paid_amount' - 'updated_at' - 'notes') THEN
     RAISE EXCEPTION 'حقائق فاتورة الشراء المرحلة ثابتة'; END IF;
   paid_delta:=COALESCE(NEW.paid_amount,0)-COALESCE(OLD.paid_amount,0);
   IF paid_delta<>0 AND NOT EXISTS(SELECT 1 FROM public.vouchers v JOIN public.journal_entries j ON j.ref_id=v.id AND j.store_id=v.store_id
       WHERE v.store_id=OLD.store_id AND v.purchase_invoice_id=OLD.id AND v.amount=abs(paid_delta) AND v.created_at=now() AND
         j.status='posted' AND j.accounting_rule='SUPPLIER_PAYMENT_MADE') THEN
     RAISE EXCEPTION 'تغيير المسدد يحتاج سند صرف مرحلاً في المعاملة'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER posted_invoice_immutable BEFORE UPDATE OR DELETE ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.guard_posted_invoice_document();
CREATE TRIGGER posted_purchase_immutable BEFORE UPDATE OR DELETE ON public.purchase_invoices FOR EACH ROW EXECUTE FUNCTION public.guard_posted_invoice_document();

CREATE FUNCTION public.guard_posted_document_item() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE parent_id uuid; doc_table text; posted boolean;
BEGIN
 parent_id:=CASE WHEN TG_OP='DELETE' THEN (to_jsonb(OLD)->>CASE WHEN TG_TABLE_NAME='invoice_items' THEN 'invoice_id' ELSE 'purchase_invoice_id' END)::uuid
   ELSE (to_jsonb(NEW)->>CASE WHEN TG_TABLE_NAME='invoice_items' THEN 'invoice_id' ELSE 'purchase_invoice_id' END)::uuid END;
 doc_table:=CASE WHEN TG_TABLE_NAME='invoice_items' THEN 'invoices' ELSE 'purchase_invoices' END;
 EXECUTE format('SELECT EXISTS(SELECT 1 FROM public.%I d JOIN public.journal_entries j ON j.store_id=d.store_id AND (j.id=d.journal_entry_id OR j.ref_id=d.id) WHERE d.id=$1 AND j.status=''posted'')',doc_table)
   INTO posted USING parent_id;
 IF posted THEN RAISE EXCEPTION 'بنود المستند المرحل ثابتة؛ أنشئ عكساً ومستنداً جديداً'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER posted_sales_items_immutable BEFORE INSERT OR UPDATE OR DELETE ON public.invoice_items FOR EACH ROW EXECUTE FUNCTION public.guard_posted_document_item();
CREATE TRIGGER posted_purchase_items_immutable BEFORE INSERT OR UPDATE OR DELETE ON public.purchase_items FOR EACH ROW EXECUTE FUNCTION public.guard_posted_document_item();

CREATE FUNCTION public.guard_posted_voucher() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.journal_entries WHERE store_id=OLD.store_id AND status='posted' AND
   (id=OLD.journal_entry_id OR (ref_id=OLD.id AND source='voucher'))) THEN
   IF TG_OP='DELETE' THEN RAISE EXCEPTION 'السند المرحل لا يُحذف؛ يلزم سند عكسي'; END IF;
   IF (to_jsonb(NEW) - 'description' - 'reference') IS DISTINCT FROM (to_jsonb(OLD) - 'description' - 'reference') THEN
     RAISE EXCEPTION 'البيانات المالية للسند المرحل ثابتة'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER posted_voucher_immutable BEFORE UPDATE OR DELETE ON public.vouchers FOR EACH ROW EXECUTE FUNCTION public.guard_posted_voucher();
REVOKE ALL ON FUNCTION public.guard_posted_invoice_document(),public.guard_posted_document_item(),public.guard_posted_voucher() FROM PUBLIC,anon,authenticated;
COMMIT;
