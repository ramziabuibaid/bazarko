BEGIN;

CREATE OR REPLACE FUNCTION public.post_purchase_invoice_atomic(p_store_id uuid, p_invoice_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
#variable_conflict use_variable
DECLARE
  actor uuid := auth.uid();
  inv public.purchase_invoices%ROWTYPE;
  supplier public.suppliers%ROWTYPE;
  prod public.products%ROWTYPE;
  item record;
  rec record;
  journal uuid;
  inv_acc uuid;
  payable uuid;
  curr text;
  stock_after numeric;
  eff_unit_cost numeric;
BEGIN
  IF actor IS NULL OR NOT public.is_store_member(p_store_id) THEN
    RAISE EXCEPTION 'غير مصرح باعتماد الفاتورة لهذا المتجر';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_store_id::text, 55001));

  SELECT * INTO inv FROM public.purchase_invoices WHERE id = p_invoice_id AND store_id = p_store_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'فاتورة المشتريات غير موجودة';
  END IF;

  IF inv.status = 'completed' THEN
    RETURN jsonb_build_object('ok', true, 'invoiceId', inv.id, 'already_completed', true);
  END IF;

  IF inv.status <> 'draft' THEN
    RAISE EXCEPTION 'لا يمكن اعتماد فاتورة بحالة غير مسودة (الحالة الحالية: %)', inv.status;
  END IF;

  PERFORM 1 FROM public.accounting_periods WHERE store_id = p_store_id FOR SHARE;
  IF EXISTS(SELECT 1 FROM public.accounting_periods WHERE store_id = p_store_id AND is_closed AND inv.invoice_date BETWEEN start_date AND end_date) THEN
    RAISE EXCEPTION 'الفترة المحاسبية مقفلة';
  END IF;

  SELECT * INTO supplier FROM public.suppliers WHERE id = inv.supplier_id AND store_id = p_store_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'المورد غير موجود في المتجر';
  END IF;

  SELECT coalesce(currency_code, 'ILS') INTO curr FROM public.stores WHERE id = p_store_id;

  SELECT id INTO inv_acc FROM public.accounts WHERE store_id = p_store_id AND account_tag = 'INVENTORY' AND is_active AND NOT is_group AND normal_balance = 'debit' ORDER BY created_at, id LIMIT 1;
  SELECT id INTO payable FROM public.accounts WHERE store_id = p_store_id AND account_tag = 'SUPPLIER_PAYABLE' AND is_active AND NOT is_group AND normal_balance = 'credit' ORDER BY (name = supplier.name) DESC, created_at, id LIMIT 1;
  IF inv_acc IS NULL OR payable IS NULL THEN
    RAISE EXCEPTION 'أكمل إعداد حسابي المخزون وذمم الموردين';
  END IF;

  PERFORM 1 FROM public.accounts WHERE id IN (inv_acc, payable) ORDER BY id FOR UPDATE;
  IF EXISTS(SELECT 1 FROM public.accounts WHERE id IN (inv_acc, payable) AND (currency <> curr OR NOT is_active OR is_group)) THEN
    RAISE EXCEPTION 'راجع عملة وحالة حسابات الترحيل';
  END IF;

  IF NOT EXISTS(SELECT 1 FROM public.purchase_items WHERE purchase_invoice_id = inv.id) THEN
    RAISE EXCEPTION 'الفاتورة لا تحتوي على أي بنود';
  END IF;

  PERFORM 1 FROM public.products WHERE store_id = p_store_id AND id IN (SELECT product_id FROM public.purchase_items WHERE purchase_invoice_id = inv.id) ORDER BY id FOR UPDATE;

  FOR item IN SELECT * FROM public.purchase_items WHERE purchase_invoice_id = inv.id ORDER BY id LOOP
    SELECT * INTO prod FROM public.products WHERE id = item.product_id AND store_id = p_store_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'أحد الأصناف غير موجود في المتجر';
    END IF;

    eff_unit_cost := CASE
      WHEN coalesce(inv.subtotal, 0) > 0 THEN round(item.unit_price * (inv.subtotal - coalesce(inv.discount, 0)) / inv.subtotal, 2)
      ELSE item.unit_price
    END;

    -- Update product cost and quantity
    UPDATE public.products
    SET cost_price = eff_unit_cost,
        stock_quantity = CASE WHEN track_stock THEN coalesce(stock_quantity, 0) + item.quantity ELSE stock_quantity END
    WHERE id = prod.id
    RETURNING stock_quantity INTO stock_after;

    IF prod.track_stock THEN
      INSERT INTO public.inventory_movements(
        store_id, product_id, movement_type, document_number, document_type, ref_id, entity_name,
        quantity_in, quantity_out, balance_after, unit_price, movement_date, created_by
      ) VALUES (
        p_store_id, prod.id, 'purchase', inv.invoice_number, 'فاتورة مشتريات', inv.id, supplier.name,
        item.quantity, 0, stock_after, eff_unit_cost, inv.invoice_date, actor
      );
    END IF;
  END LOOP;

  -- Create Journal Entry
  INSERT INTO public.journal_entries(
    store_id, entry_number, date, description, source, ref_id, source_type, source_id, source_number, source_url, accounting_rule, source_module, status, created_by
  ) VALUES (
    p_store_id, 'JV-PUR-' || inv.id::text, inv.invoice_date, 'فاتورة مشتريات ' || inv.invoice_number,
    'purchase', inv.id, 'purchase_invoice', inv.id, inv.invoice_number,
    '/dashboard/purchases/print/' || inv.id::text, 'PURCHASE_CREDIT_POSTED', 'PURCHASES', 'posted', actor
  ) RETURNING id INTO journal;

  INSERT INTO public.journal_lines(journal_entry_id, account_id, debit, credit, currency, description, account_tag_used, source_rule)
  VALUES
    (journal, inv_acc, inv.total_amount, 0, curr, 'مشتريات', 'INVENTORY', 'PURCHASE_CREDIT_POSTED'),
    (journal, payable, 0, inv.total_amount, curr, 'ذمم المورد', 'SUPPLIER_PAYABLE', 'PURCHASE_CREDIT_POSTED');

  UPDATE public.purchase_invoices
  SET status = 'completed',
      journal_entry_id = journal,
      updated_at = now()
  WHERE id = inv.id;

  UPDATE public.suppliers
  SET balance = coalesce(balance, 0) + inv.total_amount - coalesce(inv.paid_amount, 0)
  WHERE id = supplier.id;

  FOR rec IN SELECT account_id, sum(debit) d, sum(credit) c FROM public.journal_lines WHERE journal_entry_id = journal GROUP BY account_id LOOP
    UPDATE public.accounts
    SET balance = coalesce(balance, 0) + CASE WHEN normal_balance = 'credit' THEN rec.c - rec.d ELSE rec.d - rec.c END
    WHERE id = rec.account_id;
  END LOOP;

  INSERT INTO public.financial_audit_log(store_id, entity_type, entity_id, entity_label, action, actor_id, details)
  VALUES (
    p_store_id, 'purchase_invoice', inv.id, inv.invoice_number, 'status_change', actor,
    jsonb_build_object('action', 'post_draft', 'from_status', 'draft', 'to_status', 'completed', 'total', inv.total_amount, 'journalId', journal)
  );

  RETURN jsonb_build_object('ok', true, 'invoiceId', inv.id, 'journalId', journal);
END $$;

CREATE OR REPLACE FUNCTION public.cancel_purchase_invoice_draft(p_store_id uuid, p_invoice_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
#variable_conflict use_variable
DECLARE
  actor uuid := auth.uid();
  inv public.purchase_invoices%ROWTYPE;
BEGIN
  IF actor IS NULL OR NOT public.is_store_member(p_store_id) THEN
    RAISE EXCEPTION 'غير مصرح بإلغاء الفاتورة لهذا المتجر';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_store_id::text, 55001));

  SELECT * INTO inv FROM public.purchase_invoices WHERE id = p_invoice_id AND store_id = p_store_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'فاتورة المشتريات غير موجودة';
  END IF;

  IF inv.status = 'cancelled' THEN
    RETURN jsonb_build_object('ok', true, 'invoiceId', inv.id, 'already_cancelled', true);
  END IF;

  IF inv.status <> 'draft' THEN
    RAISE EXCEPTION 'لا يمكن إلغاء فاتورة معتمدة أو غير مسودة (الحالة الحالية: %)', inv.status;
  END IF;

  UPDATE public.purchase_invoices
  SET status = 'cancelled',
      updated_at = now()
  WHERE id = inv.id;

  INSERT INTO public.financial_audit_log(store_id, entity_type, entity_id, entity_label, action, actor_id, details)
  VALUES (
    p_store_id, 'purchase_invoice', inv.id, inv.invoice_number, 'cancel', actor,
    jsonb_build_object('action', 'cancel_draft', 'previous_status', 'draft')
  );

  RETURN jsonb_build_object('ok', true, 'invoiceId', inv.id);
END $$;

REVOKE ALL ON FUNCTION public.post_purchase_invoice_atomic(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.post_purchase_invoice_atomic(uuid,uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.cancel_purchase_invoice_draft(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.cancel_purchase_invoice_draft(uuid,uuid) TO authenticated;

NOTIFY pgrst,'reload schema';

COMMIT;
