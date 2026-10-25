BEGIN;

-- 1. Update has_store_permission to include sales.below_cost
CREATE OR REPLACE FUNCTION public.has_store_permission(
  p_store_id uuid,
  p_permission text
) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  caller_role text;
BEGIN
  IF caller IS NULL OR p_store_id IS NULL THEN RETURN false; END IF;

  IF EXISTS (
    SELECT 1 FROM public.stores s
    WHERE s.id = p_store_id AND s.owner_id = caller
  ) THEN
    caller_role := 'owner';
  ELSE
    SELECT m.role INTO caller_role
    FROM public.store_members m
    WHERE m.store_id = p_store_id
      AND m.profile_id = caller AND m.is_active = true
    LIMIT 1;

    IF caller_role = 'owner' THEN RETURN false; END IF;
  END IF;

  IF caller_role IS NULL THEN RETURN false; END IF;

  RETURN coalesce(CASE p_permission
    WHEN 'store.read' THEN caller_role IN ('owner','admin','accountant','staff','viewer')
    WHEN 'team.manage' THEN caller_role IN ('owner','admin')
    WHEN 'team.privileged' THEN caller_role = 'owner'
    WHEN 'settings.write' THEN caller_role IN ('owner','admin')
    WHEN 'sales.write' THEN caller_role IN ('owner','admin','staff')
    WHEN 'sales.below_cost' THEN caller_role IN ('owner','admin','accountant')
    WHEN 'purchases.write' THEN caller_role IN ('owner','admin')
    WHEN 'inventory.write' THEN caller_role IN ('owner','admin')
    WHEN 'journal.read' THEN caller_role IN ('owner','accountant')
    WHEN 'journal.write' THEN caller_role IN ('owner','accountant')
    WHEN 'finance.write' THEN caller_role IN ('owner','accountant')
    WHEN 'period.reopen' THEN caller_role = 'owner'
    WHEN 'subscription.write' THEN caller_role = 'owner'
    ELSE false
  END, false);
END;
$$;

-- 2. Create update_purchase_invoice_atomic function
CREATE OR REPLACE FUNCTION public.update_purchase_invoice_atomic(
  p_store_id uuid,
  p_invoice_id uuid,
  p_payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
#variable_conflict use_variable
DECLARE
  actor uuid := auth.uid();
  existing_inv public.purchase_invoices%ROWTYPE;
  old_supplier public.suppliers%ROWTYPE;
  new_supplier public.suppliers%ROWTYPE;
  prod public.products%ROWTYPE;
  v_journal public.journal_entries%ROWTYPE;
  v_acc public.accounts%ROWTYPE;
  v_old_line record;
  acc_rec record;
  old_item record;
  item jsonb;
  
  new_issue date;
  new_due date;
  new_supplier_id uuid;
  new_supp_no text;
  notes_val text;
  curr text;
  
  subtotal numeric := 0;
  discount numeric := 0;
  tax_rate numeric := 0;
  tax numeric := 0;
  total numeric := 0;
  eff_unit_cost numeric := 0;
  stock_after numeric := 0;
  qty numeric;
  price numeric;
  
  inv_acc uuid;
  payable uuid;
  journal_id uuid;
  active_returns int := 0;
BEGIN
  IF actor IS NULL OR NOT public.is_store_member(p_store_id) THEN
    RAISE EXCEPTION 'غير مصرح بتعديل الفاتورة لهذا المتجر';
  END IF;

  IF NOT public.has_store_permission(p_store_id, 'purchases.write') THEN
    RAISE EXCEPTION 'لا تملك صلاحية تعديل فواتير المشتريات';
  END IF;

  -- Lock store purchase modifications
  PERFORM pg_advisory_xact_lock(hashtextextended(p_store_id::text, 55002));

  -- Lock and fetch existing purchase invoice
  SELECT * INTO existing_inv
  FROM public.purchase_invoices
  WHERE id = p_invoice_id AND store_id = p_store_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'فاتورة المشتريات غير موجودة في هذا المتجر';
  END IF;

  IF existing_inv.status = 'cancelled' THEN
    RAISE EXCEPTION 'لا يمكن تعديل فاتورة مشتريات ملغاة';
  END IF;

  -- Check if there are active purchase returns linked to this invoice
  SELECT count(*) INTO active_returns
  FROM public.purchase_returns
  WHERE purchase_invoice_id = p_invoice_id AND status <> 'cancelled';

  IF active_returns > 0 THEN
    RAISE EXCEPTION 'لا يمكن تعديل الفاتورة لوجود مرتجع مشتريات مرتبط بها (% مرتجع)؛ يرجى معالجة المرتجع أولاً', active_returns;
  END IF;

  -- Verify payload items
  IF p_payload IS NULL OR jsonb_typeof(p_payload->'items') IS DISTINCT FROM 'array' OR jsonb_array_length(p_payload->'items') NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'أضف بين بند واحد و200 بند';
  END IF;

  new_issue := (p_payload->>'invoice_date')::date;
  new_due := nullif(p_payload->>'due_date', '')::date;

  IF new_issue IS NULL OR (new_due IS NOT NULL AND new_due < new_issue) THEN
    RAISE EXCEPTION 'تحقق من تاريخ الإصدار والاستحقاق';
  END IF;

  -- Closed periods checks (only for completed invoices, drafts have no financial impact)
  PERFORM 1 FROM public.accounting_periods WHERE store_id = p_store_id FOR SHARE;
  IF existing_inv.status = 'completed' THEN
    IF EXISTS(SELECT 1 FROM public.accounting_periods WHERE store_id = p_store_id AND is_closed AND existing_inv.invoice_date BETWEEN start_date AND end_date) THEN
      RAISE EXCEPTION 'تاريخ الفاتورة الأصلي يقع ضمن فترة محاسبية مقفلة';
    END IF;
    IF EXISTS(SELECT 1 FROM public.accounting_periods WHERE store_id = p_store_id AND is_closed AND new_issue BETWEEN start_date AND end_date) THEN
      RAISE EXCEPTION 'تاريخ الفاتورة الجديد يقع ضمن فترة محاسبية مقفلة';
    END IF;
  END IF;

  -- Supplier handling
  new_supplier_id := (p_payload->>'supplier_id')::uuid;
  SELECT * INTO new_supplier FROM public.suppliers WHERE id = new_supplier_id AND store_id = p_store_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'المورد غير موجود في هذا المتجر';
  END IF;

  IF existing_inv.supplier_id IS DISTINCT FROM new_supplier_id THEN
    SELECT * INTO old_supplier FROM public.suppliers WHERE id = existing_inv.supplier_id AND store_id = p_store_id FOR UPDATE;
  END IF;

  SELECT coalesce(currency_code, 'ILS') INTO curr FROM public.stores WHERE id = p_store_id;

  -- Lock products of new items
  PERFORM 1 FROM public.products p
  WHERE p.store_id = p_store_id
    AND p.id IN (SELECT (v->>'product_id')::uuid FROM jsonb_array_elements(p_payload->'items') v)
  ORDER BY p.id FOR UPDATE;

  -- Check duplicate products in payload
  IF (SELECT count(*) FROM jsonb_array_elements(p_payload->'items')) <> (SELECT count(DISTINCT v->>'product_id') FROM jsonb_array_elements(p_payload->'items') v) THEN
    RAISE EXCEPTION 'لا يمكن تكرار نفس الصنف في بنود الفاتورة';
  END IF;

  -- Validate items and calculate subtotal
  FOR item IN SELECT value FROM jsonb_array_elements(p_payload->'items') LOOP
    qty := (item->>'quantity')::numeric;
    price := (item->>'unit_price')::numeric;
    IF qty IS NULL OR price IS NULL OR qty <= 0 OR price < 0 OR qty <> round(qty, 2) OR price <> round(price, 2) THEN
      RAISE EXCEPTION 'الكميات أو الأسعار غير صحيحة';
    END IF;
    SELECT * INTO prod FROM public.products WHERE id = (item->>'product_id')::uuid AND store_id = p_store_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'أحد الأصناف غير موجود في المتجر';
    END IF;
    IF prod.track_stock AND qty <> trunc(qty) THEN
      RAISE EXCEPTION 'الصنف المخزني يتطلب كمية صحيحة';
    END IF;
    subtotal := subtotal + round(qty * price, 2);
  END LOOP;

  discount := coalesce((p_payload->>'discount')::numeric, 0);
  tax_rate := coalesce((p_payload->>'tax')::numeric, 0);
  IF discount < 0 OR discount > subtotal THEN
    RAISE EXCEPTION 'الخصم غير صحيح ولا يمكن أن يتجاوز قيمة الفاتورة';
  END IF;
  discount := round(discount, 2);

  tax := round((subtotal - discount) * tax_rate / 100, 2);
  total := subtotal - discount + tax;

  IF total <= 0 THEN
    RAISE EXCEPTION 'إجمالي الفاتورة يجب أن يكون موجباً';
  END IF;

  -- Check paid amount constraint: new total cannot be less than already paid amount
  IF total < coalesce(existing_inv.paid_amount, 0) THEN
    RAISE EXCEPTION 'لا يمكن تخفيض إجمالي الفاتورة (%) ليصبح أقل من المبلغ المدفوع مسبقاً (%)؛ يرجى مراجعة سندات الصرف المرتبطة أولاً', total, existing_inv.paid_amount;
  END IF;

  new_supp_no := nullif(btrim(p_payload->>'supplier_number'), '');
  notes_val := nullif(btrim(p_payload->>'notes'), '');

  -- IF COMPLETED: Manage Inventory, Supplier Ledger, and Journal Entries
  IF existing_inv.status = 'completed' THEN
    -- Lock products of existing items
    PERFORM 1 FROM public.products
    WHERE store_id = p_store_id
      AND id IN (SELECT product_id FROM public.purchase_items WHERE purchase_invoice_id = p_invoice_id AND product_id IS NOT NULL)
    ORDER BY id FOR UPDATE;

    -- 1. Revert previous stock quantities
    FOR old_item IN SELECT * FROM public.purchase_items WHERE purchase_invoice_id = p_invoice_id AND product_id IS NOT NULL LOOP
      SELECT * INTO prod FROM public.products WHERE id = old_item.product_id AND store_id = p_store_id;
      IF prod.track_stock THEN
        -- Check if removing the purchased stock would cause negative stock
        IF (coalesce(prod.stock_quantity, 0) - old_item.quantity < 0) AND NOT coalesce(prod.allow_backorder, false) THEN
          RAISE EXCEPTION 'لا يمكن تقليل كمية الصنف (%) لأن الكمية المتوفرة حالياً (%) لا تكفي بعد سحب كمية الشراء السابقة', prod.name, prod.stock_quantity;
        END IF;
        UPDATE public.products
        SET stock_quantity = coalesce(stock_quantity, 0) - old_item.quantity
        WHERE id = old_item.product_id;
      END IF;
    END LOOP;

    -- Delete old inventory movements
    DELETE FROM public.inventory_movements WHERE store_id = p_store_id AND ref_id = p_invoice_id;

    -- 2. Apply new stock and record new movements
    FOR item IN SELECT value FROM jsonb_array_elements(p_payload->'items') LOOP
      qty := (item->>'quantity')::numeric;
      price := (item->>'unit_price')::numeric;
      eff_unit_cost := CASE
        WHEN subtotal > 0 THEN round(price * (subtotal - discount) / subtotal, 2)
        ELSE price
      END;

      SELECT * INTO prod FROM public.products WHERE id = (item->>'product_id')::uuid AND store_id = p_store_id;
      UPDATE public.products
      SET cost_price = eff_unit_cost,
          stock_quantity = CASE WHEN track_stock THEN coalesce(stock_quantity, 0) + qty ELSE stock_quantity END
      WHERE id = prod.id
      RETURNING stock_quantity INTO stock_after;

      IF prod.track_stock THEN
        INSERT INTO public.inventory_movements(
          store_id, product_id, movement_type, document_number, document_type, ref_id,
          entity_name, quantity_in, quantity_out, balance_after, unit_price, movement_date, created_by
        ) VALUES (
          p_store_id, prod.id, 'purchase', existing_inv.invoice_number, 'فاتورة مشتريات (معدلة)', p_invoice_id,
          new_supplier.name, qty, 0, stock_after, eff_unit_cost, new_issue, actor
        );
      END IF;
    END LOOP;

    -- 3. Update Supplier Balance
    IF existing_inv.supplier_id = new_supplier_id THEN
      UPDATE public.suppliers
      SET balance = coalesce(balance, 0) - (existing_inv.total_amount - coalesce(existing_inv.paid_amount, 0)) + (total - coalesce(existing_inv.paid_amount, 0))
      WHERE id = new_supplier.id;
    ELSE
      -- Revert from old supplier
      UPDATE public.suppliers
      SET balance = coalesce(balance, 0) - (existing_inv.total_amount - coalesce(existing_inv.paid_amount, 0))
      WHERE id = existing_inv.supplier_id;
      -- Apply to new supplier
      UPDATE public.suppliers
      SET balance = coalesce(balance, 0) + (total - coalesce(existing_inv.paid_amount, 0))
      WHERE id = new_supplier.id;
    END IF;

    -- 4. Update Journal Entry
    SELECT id INTO inv_acc FROM public.accounts WHERE store_id = p_store_id AND account_tag = 'INVENTORY' AND is_active AND NOT is_group AND normal_balance = 'debit' ORDER BY created_at, id LIMIT 1;
    SELECT id INTO payable FROM public.accounts WHERE store_id = p_store_id AND account_tag = 'SUPPLIER_PAYABLE' AND is_active AND NOT is_group AND normal_balance = 'credit' ORDER BY (name = new_supplier.name) DESC, created_at, id LIMIT 1;

    IF inv_acc IS NULL OR payable IS NULL THEN
      RAISE EXCEPTION 'أكمل إعداد حسابي المخزون وذمم الموردين';
    END IF;

    SELECT * INTO v_journal
    FROM public.journal_entries
    WHERE id = existing_inv.journal_entry_id
       OR (store_id = p_store_id AND ref_id = p_invoice_id AND source = 'purchase' AND status = 'posted')
    ORDER BY (id = existing_inv.journal_entry_id) DESC LIMIT 1 FOR UPDATE;

    IF FOUND THEN
      journal_id := v_journal.id;
      -- Revert old journal lines
      FOR v_old_line IN SELECT * FROM public.journal_lines WHERE journal_entry_id = journal_id LOOP
        SELECT * INTO v_acc FROM public.accounts WHERE id = v_old_line.account_id;
        UPDATE public.accounts
        SET balance = balance - (
          CASE WHEN v_acc.normal_balance = 'credit'
               THEN (v_old_line.credit - v_old_line.debit)
               ELSE (v_old_line.debit - v_old_line.credit)
          END
        ),
        updated_at = now()
        WHERE id = v_old_line.account_id;
      END LOOP;

      DELETE FROM public.journal_lines WHERE journal_entry_id = journal_id;

      UPDATE public.journal_entries
      SET date = new_issue, description = 'فاتورة مشتريات ' || existing_inv.invoice_number
      WHERE id = journal_id;

      -- Insert updated lines
      INSERT INTO public.journal_lines(journal_entry_id, account_id, debit, credit, currency, description, account_tag_used, source_rule)
      VALUES
        (journal_id, inv_acc, total, 0, curr, 'مشتريات ' || existing_inv.invoice_number, 'INVENTORY', 'PURCHASE_CREDIT_POSTED'),
        (journal_id, payable, 0, total, curr, 'ذمم المورد ' || new_supplier.name, 'SUPPLIER_PAYABLE', 'PURCHASE_CREDIT_POSTED');

      -- Apply new lines to accounts balance
      FOR acc_rec IN SELECT l.account_id, sum(l.debit) as debit, sum(l.credit) as credit FROM public.journal_lines l WHERE l.journal_entry_id = journal_id GROUP BY l.account_id LOOP
        UPDATE public.accounts
        SET balance = balance + (
          CASE WHEN normal_balance = 'credit'
               THEN acc_rec.credit - acc_rec.debit
               ELSE acc_rec.debit - acc_rec.credit
          END
        ),
        updated_at = now()
        WHERE id = acc_rec.account_id;
      END LOOP;
    ELSE
      -- Create journal entry if missing
      INSERT INTO public.journal_entries(
        store_id, entry_number, date, description, source, ref_id, source_type, source_id, source_number, source_url, accounting_rule, source_module, status, created_by
      ) VALUES (
        p_store_id, 'JV-PUR-' || p_invoice_id::text, new_issue, 'فاتورة مشتريات ' || existing_inv.invoice_number,
        'purchase', p_invoice_id, 'purchase_invoice', p_invoice_id, existing_inv.invoice_number,
        '/dashboard/purchases/print/' || p_invoice_id::text, 'PURCHASE_CREDIT_POSTED', 'PURCHASES', 'posted', actor
      ) RETURNING id INTO journal_id;

      INSERT INTO public.journal_lines(journal_entry_id, account_id, debit, credit, currency, description, account_tag_used, source_rule)
      VALUES
        (journal_id, inv_acc, total, 0, curr, 'مشتريات ' || existing_inv.invoice_number, 'INVENTORY', 'PURCHASE_CREDIT_POSTED'),
        (journal_id, payable, 0, total, curr, 'ذمم المورد ' || new_supplier.name, 'SUPPLIER_PAYABLE', 'PURCHASE_CREDIT_POSTED');

      FOR acc_rec IN SELECT l.account_id, sum(l.debit) as debit, sum(l.credit) as credit FROM public.journal_lines l WHERE l.journal_entry_id = journal_id GROUP BY l.account_id LOOP
        UPDATE public.accounts
        SET balance = balance + (
          CASE WHEN normal_balance = 'credit'
               THEN acc_rec.credit - acc_rec.debit
               ELSE acc_rec.debit - acc_rec.credit
          END
        ),
        updated_at = now()
        WHERE id = acc_rec.account_id;
      END LOOP;

      UPDATE public.purchase_invoices SET journal_entry_id = journal_id WHERE id = p_invoice_id;
    END IF;
  END IF;

  -- 5. Delete old purchase items and insert new items
  DELETE FROM public.purchase_items WHERE purchase_invoice_id = p_invoice_id;

  FOR item IN SELECT value FROM jsonb_array_elements(p_payload->'items') LOOP
    qty := (item->>'quantity')::numeric;
    price := (item->>'unit_price')::numeric;
    SELECT * INTO prod FROM public.products WHERE id = (item->>'product_id')::uuid AND store_id = p_store_id;

    INSERT INTO public.purchase_items(
      purchase_invoice_id, product_id, product_name, quantity, unit_price, total_price, notes
    ) VALUES (
      p_invoice_id, prod.id, prod.name, qty, price, round(qty * price, 2), nullif(btrim(item->>'notes'), '')
    );
  END LOOP;

  -- 6. Update purchase_invoices table
  UPDATE public.purchase_invoices
  SET
    supplier_id = new_supplier.id,
    supplier_invoice_number = new_supp_no,
    invoice_date = new_issue,
    due_date = new_due,
    subtotal = subtotal,
    discount = discount,
    tax_amount = tax,
    total_amount = total,
    payment_status = CASE
      WHEN coalesce(paid_amount, 0) >= total THEN 'paid'
      WHEN coalesce(paid_amount, 0) > 0 THEN 'partial'
      ELSE 'unpaid'
    END,
    notes = notes_val,
    updated_at = now()
  WHERE id = p_invoice_id;

  -- 7. Audit Log
  INSERT INTO public.financial_audit_log(
    store_id, entity_type, entity_id, entity_label, action, actor_id, details
  ) VALUES (
    p_store_id, 'purchase_invoice', p_invoice_id, existing_inv.invoice_number, 'update', actor,
    jsonb_build_object(
      'old_total', existing_inv.total_amount,
      'new_total', total,
      'old_supplier_id', existing_inv.supplier_id,
      'new_supplier_id', new_supplier.id,
      'status', existing_inv.status,
      'items_count', jsonb_array_length(p_payload->'items'),
      'atomic', true
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'invoiceId', p_invoice_id,
    'invoiceNumber', existing_inv.invoice_number,
    'total', total,
    'status', existing_inv.status,
    'journalEntryId', journal_id
  );
END $$;

REVOKE ALL ON FUNCTION public.update_purchase_invoice_atomic(uuid,uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.update_purchase_invoice_atomic(uuid,uuid,jsonb) TO authenticated;
NOTIFY pgrst,'reload schema';

COMMIT;
