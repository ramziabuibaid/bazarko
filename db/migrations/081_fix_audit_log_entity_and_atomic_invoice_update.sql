BEGIN;

-- 1. Fix financial_audit_log check constraint to allow journal_entry and all financial entities
ALTER TABLE public.financial_audit_log DROP CONSTRAINT IF EXISTS financial_audit_log_entity_type_check;
ALTER TABLE public.financial_audit_log ADD CONSTRAINT financial_audit_log_entity_type_check 
  CHECK (entity_type IN ('invoice','voucher','cash_movement','cash_session','purchase_invoice','purchase_return','sales_return','check','journal_entry','order','quotation','transfer'));

-- 2. Create update_sales_invoice_atomic function
CREATE OR REPLACE FUNCTION public.update_sales_invoice_atomic(
  p_store_id uuid,
  p_invoice_id uuid,
  p_payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public AS $$
#variable_conflict use_variable
DECLARE
  actor uuid := auth.uid();
  existing_inv public.invoices%ROWTYPE;
  v_journal public.journal_entries%ROWTYPE;
  v_acc public.accounts%ROWTYPE;
  v_old_line record;
  acc_rec record;
  old_item record;
  prod public.products%ROWTYPE;
  new_cust public.customers%ROWTYPE;
  
  new_issue date;
  new_due date;
  new_customer_id uuid;
  new_customer_name text;
  new_customer_phone text;
  new_customer_address text;
  pay_method text;
  new_status text;
  curr text;
  
  subtotal numeric := 0;
  disc_type text;
  disc_val numeric := 0;
  discount_amt numeric := 0;
  total numeric := 0;
  paid numeric := 0;
  cost numeric := 0;
  
  qty numeric;
  price numeric;
  product_cost numeric;
  stock_after numeric;
  idx int := 0;
  item jsonb;
  
  journal_id uuid;
  debit_acc uuid;
  debit_tag text;
  ar uuid;
  revenue uuid;
  cogs uuid;
  inventory uuid;
BEGIN
  IF actor IS NULL OR NOT public.is_store_member(p_store_id) THEN
    RAISE EXCEPTION 'غير مصرح بتعديل الفاتورة لهذا المتجر';
  END IF;

  -- Lock store invoice modifications
  PERFORM pg_advisory_xact_lock(hashtextextended(p_store_id::text, 54002));

  -- Lock and fetch existing invoice
  SELECT * INTO existing_inv
  FROM public.invoices
  WHERE id = p_invoice_id AND store_id = p_store_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'الفاتورة غير موجودة في هذا المتجر';
  END IF;

  IF existing_inv.status = 'cancelled' THEN
    RAISE EXCEPTION 'لا يمكن تعديل فاتورة ملغاة';
  END IF;

  -- Verify payload
  IF p_payload IS NULL OR jsonb_typeof(p_payload->'items') IS DISTINCT FROM 'array' OR jsonb_array_length(p_payload->'items') NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'أضف بين بند واحد و200 بند';
  END IF;

  new_issue := (p_payload->>'issueDate')::date;
  new_due := nullif(p_payload->>'dueDate', '')::date;

  IF new_issue IS NULL OR (new_due IS NOT NULL AND new_due < new_issue) THEN
    RAISE EXCEPTION 'تحقق من تاريخ الإصدار والاستحقاق';
  END IF;

  -- Period checks
  PERFORM 1 FROM public.accounting_periods WHERE store_id = p_store_id FOR SHARE;
  IF EXISTS(SELECT 1 FROM public.accounting_periods WHERE store_id = p_store_id AND is_closed AND existing_inv.issue_date BETWEEN start_date AND end_date) THEN
    RAISE EXCEPTION 'تاريخ الفاتورة الأصلي يقع ضمن فترة محاسبية مقفلة';
  END IF;
  IF EXISTS(SELECT 1 FROM public.accounting_periods WHERE store_id = p_store_id AND is_closed AND new_issue BETWEEN start_date AND end_date) THEN
    RAISE EXCEPTION 'تاريخ الفاتورة الجديد يقع ضمن فترة محاسبية مقفلة';
  END IF;

  SELECT coalesce(currency_code, 'ILS') INTO curr FROM public.stores WHERE id = p_store_id;

  -- Customer handling
  new_customer_id := nullif(p_payload->>'customerId', '')::uuid;
  IF new_customer_id IS NOT NULL THEN
    SELECT * INTO new_cust FROM public.customers WHERE id = new_customer_id AND store_id = p_store_id AND is_active FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'الزبون غير موجود أو غير نشط في هذا المتجر';
    END IF;
    new_customer_name := new_cust.name;
    new_customer_phone := new_cust.phone;
    new_customer_address := new_cust.address;
  ELSE
    new_customer_name := nullif(btrim(p_payload->>'customerName'), '');
    new_customer_phone := nullif(btrim(p_payload->>'customerPhone'), '');
    new_customer_address := nullif(btrim(p_payload->>'customerAddress'), '');
  END IF;

  -- 1. Inventory reversal for existing items
  PERFORM 1 FROM public.products WHERE store_id = p_store_id AND id IN (SELECT product_id FROM public.invoice_items WHERE invoice_id = p_invoice_id AND product_id IS NOT NULL) ORDER BY id FOR UPDATE;

  FOR old_item IN SELECT * FROM public.invoice_items WHERE invoice_id = p_invoice_id AND product_id IS NOT NULL LOOP
    UPDATE public.products
    SET stock_quantity = coalesce(stock_quantity, 0) + old_item.quantity
    WHERE id = old_item.product_id AND track_stock;
  END LOOP;

  DELETE FROM public.inventory_movements WHERE store_id = p_store_id AND ref_id = p_invoice_id;

  -- 2. Validate new items and calculate subtotal & catalog cost
  PERFORM 1 FROM public.products p WHERE p.store_id = p_store_id AND p.id IN (SELECT nullif(v->>'product_id', '')::uuid FROM jsonb_array_elements(p_payload->'items') v) ORDER BY p.id FOR UPDATE;

  FOR item IN SELECT value FROM jsonb_array_elements(p_payload->'items') LOOP
    qty := (item->>'quantity')::numeric;
    price := (item->>'unit_price')::numeric;
    IF qty IS NULL OR price IS NULL OR qty::text IN ('NaN', 'Infinity', '-Infinity') OR price::text IN ('NaN', 'Infinity', '-Infinity') OR qty <= 0 OR qty > 1000000 OR price < 0 OR price > 100000000 OR coalesce(btrim(item->>'name'), '') = '' THEN
      RAISE EXCEPTION 'تحقق من وصف البنود والكميات والأسعار';
    END IF;
    subtotal := subtotal + round(qty * price, 2);
    IF nullif(item->>'product_id', '') IS NOT NULL THEN
      SELECT * INTO prod FROM public.products WHERE id = (item->>'product_id')::uuid AND store_id = p_store_id AND is_active;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'منتج غير موجود أو غير نشط في هذا المتجر';
      END IF;
      IF prod.track_stock AND qty <> trunc(qty) THEN
        RAISE EXCEPTION 'المنتج المخزني يتطلب كمية صحيحة';
      END IF;
      IF prod.track_stock THEN
        cost := cost + round(qty * coalesce(prod.cost_price, 0), 2);
      END IF;
    END IF;
  END LOOP;

  -- 3. Calculate discount and total
  disc_type := coalesce(p_payload->>'discountType', 'amount');
  IF disc_type NOT IN ('amount', 'percent') THEN
    RAISE EXCEPTION 'نوع الخصم غير صحيح';
  END IF;
  disc_val := coalesce((p_payload->>'discountValue')::numeric, 0);
  IF disc_val < 0 OR (disc_type = 'percent' AND disc_val > 100) THEN
    RAISE EXCEPTION 'قيمة الخصم غير صحيحة';
  END IF;
  IF disc_type = 'percent' THEN
    discount_amt := round(subtotal * disc_val / 100, 2);
  ELSE
    discount_amt := round(disc_val, 2);
  END IF;
  total := subtotal - discount_amt;
  IF total <= 0 OR discount_amt > subtotal THEN
    RAISE EXCEPTION 'الإجمالي يجب أن يكون موجباً والخصم لا يتجاوز الفاتورة';
  END IF;

  -- 4. Calculate payment method and paid amount
  pay_method := coalesce(p_payload->>'paymentMethod', existing_inv.payment_method, 'credit');
  IF pay_method = 'cash' THEN
    paid := total;
    new_status := 'paid';
  ELSE
    paid := round(coalesce((p_payload->>'amountPaid')::numeric, existing_inv.amount_paid, 0), 2);
    IF paid > total THEN paid := total; END IF;
    IF paid >= total THEN
      new_status := 'paid';
    ELSIF paid > 0 THEN
      new_status := 'partial';
    ELSE
      new_status := 'sent';
    END IF;
  END IF;

  IF paid < total AND new_customer_id IS NULL THEN
    RAISE EXCEPTION 'اختر زبوناً مسجلاً للبيع الآجل أو الدفعة الجزئية';
  END IF;

  -- 5. Delete old invoice items & insert new invoice items + deduct stock
  DELETE FROM public.invoice_items WHERE invoice_id = p_invoice_id;

  idx := 0;
  FOR item IN SELECT value FROM jsonb_array_elements(p_payload->'items') LOOP
    qty := (item->>'quantity')::numeric;
    price := (item->>'unit_price')::numeric;
    product_cost := 0;
    IF nullif(item->>'product_id', '') IS NOT NULL THEN
      SELECT * INTO prod FROM public.products WHERE id = (item->>'product_id')::uuid AND store_id = p_store_id;
      product_cost := coalesce(prod.cost_price, 0);
      IF prod.track_stock THEN
        IF (coalesce(prod.stock_quantity, 0) - coalesce(prod.stock_reserved, 0) < qty) AND NOT coalesce(prod.allow_backorder, false) THEN
          RAISE EXCEPTION 'المخزون المتاح لا يكفي للمنتج: %', prod.name;
        END IF;
        stock_after := coalesce(prod.stock_quantity, 0) - qty;
        UPDATE public.products SET stock_quantity = stock_after WHERE id = prod.id;
        INSERT INTO public.inventory_movements(
          store_id, product_id, movement_type, document_number, document_type, ref_id,
          entity_name, quantity_in, quantity_out, balance_after, unit_price, movement_date, created_by
        ) VALUES (
          p_store_id, prod.id, 'sale', existing_inv.invoice_number, 'فاتورة مبيعات (معدلة)', p_invoice_id,
          coalesce(new_customer_name, 'عميل نقدي'), 0, qty, stock_after, price, new_issue, actor
        );
      END IF;
    END IF;
    idx := idx + 1;
    INSERT INTO public.invoice_items(
      invoice_id, product_id, name, description, sku, quantity, unit_price, total, total_price, cost_price, sort_order
    ) VALUES (
      p_invoice_id, nullif(item->>'product_id', '')::uuid, item->>'name', item->>'name',
      nullif(item->>'sku', ''), qty, price, round(qty * price, 2), round(qty * price, 2), product_cost, idx
    );
  END LOOP;

  -- 6. Update invoices table
  UPDATE public.invoices
  SET
    customer_id = new_customer_id,
    customer_name = new_customer_name,
    customer_phone = new_customer_phone,
    customer_address = new_customer_address,
    issue_date = new_issue,
    due_date = new_due,
    payment_method = pay_method,
    subtotal = subtotal,
    discount_type = disc_type,
    discount_value = disc_val,
    discount_amount = discount_amt,
    total = total,
    total_amount = total,
    amount_paid = paid,
    status = new_status,
    notes = nullif(btrim(p_payload->>'notes'), ''),
    paid_at = CASE WHEN paid >= total THEN coalesce(paid_at, now()) ELSE NULL END,
    updated_at = now()
  WHERE id = p_invoice_id;

  -- 7. Sync Customer Ledger & Customer Balances
  -- Replace the invoice debit entry in customer ledger
  DELETE FROM public.customer_ledger
  WHERE store_id = p_store_id AND reference_id = p_invoice_id AND type = 'invoice';

  IF new_customer_id IS NOT NULL THEN
    INSERT INTO public.customer_ledger(
      store_id, customer_id, type, date, description, debit, credit, balance, reference_id, reference_type, created_by
    ) VALUES (
      p_store_id, new_customer_id, 'invoice', new_issue, 'فاتورة ' || existing_inv.invoice_number, total, 0, 0, p_invoice_id, 'invoice', actor
    );

    UPDATE public.customers c
    SET
      balance = coalesce((SELECT sum(debit - credit) FROM public.customer_ledger WHERE customer_id = c.id), 0),
      total_invoiced = coalesce((SELECT sum(debit) FROM public.customer_ledger WHERE customer_id = c.id AND type = 'invoice'), 0),
      total_paid = coalesce((SELECT sum(credit) FROM public.customer_ledger WHERE customer_id = c.id AND type = 'payment'), 0),
      updated_at = now()
    WHERE c.id = new_customer_id;
  END IF;

  IF existing_inv.customer_id IS NOT NULL AND existing_inv.customer_id IS DISTINCT FROM new_customer_id THEN
    UPDATE public.customers c
    SET
      balance = coalesce((SELECT sum(debit - credit) FROM public.customer_ledger WHERE customer_id = c.id), 0),
      total_invoiced = coalesce((SELECT sum(debit) FROM public.customer_ledger WHERE customer_id = c.id AND type = 'invoice'), 0),
      total_paid = coalesce((SELECT sum(credit) FROM public.customer_ledger WHERE customer_id = c.id AND type = 'payment'), 0),
      updated_at = now()
    WHERE c.id = existing_inv.customer_id;
  END IF;

  -- 8. Resolve GL Accounts for Sales Journal
  SELECT id INTO ar FROM public.accounts WHERE store_id = p_store_id AND account_tag = 'CUSTOMER_RECEIVABLE' AND is_active AND NOT is_group AND normal_balance = 'debit' ORDER BY (new_customer_id IS NOT NULL AND name = new_customer_name) DESC, created_at, id LIMIT 1;
  SELECT id INTO revenue FROM public.accounts WHERE store_id = p_store_id AND account_tag = 'SALES_REVENUE' AND is_active AND NOT is_group AND normal_balance = 'credit' ORDER BY created_at, id LIMIT 1;
  IF cost > 0 THEN
    SELECT id INTO cogs FROM public.accounts WHERE store_id = p_store_id AND account_tag = 'COGS' AND is_active AND NOT is_group AND normal_balance = 'debit' ORDER BY created_at, id LIMIT 1;
    SELECT id INTO inventory FROM public.accounts WHERE store_id = p_store_id AND account_tag = 'INVENTORY' AND is_active AND NOT is_group AND normal_balance = 'debit' ORDER BY created_at, id LIMIT 1;
  END IF;

  IF ar IS NULL OR revenue IS NULL THEN
    RAISE EXCEPTION 'أكمل إعداد حسابي ذمم الزبائن وإيرادات المبيعات';
  END IF;

  -- Find or create linked journal entry
  SELECT * INTO v_journal
  FROM public.journal_entries
  WHERE id = existing_inv.journal_entry_id
     OR (store_id = p_store_id AND ref_id = p_invoice_id AND source = 'invoice' AND status = 'posted')
  ORDER BY (id = existing_inv.journal_entry_id) DESC LIMIT 1 FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.journal_entries(
      store_id, entry_number, date, description, source, ref_id, source_type, source_id, source_number, source_url, accounting_rule, source_module, status, created_by
    ) VALUES (
      p_store_id, 'JV-SALE-' || p_invoice_id::text, new_issue, 'فاتورة ' || existing_inv.invoice_number, 'invoice', p_invoice_id, 'sales_invoice', p_invoice_id, existing_inv.invoice_number, '/dashboard/accounting/invoices/' || p_invoice_id::text, 'SALE_CREDIT_POSTED', 'SALES', 'posted', actor
    ) RETURNING id INTO journal_id;
  ELSE
    journal_id := v_journal.id;
    -- Revert old journal lines from account balances
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
    SET date = new_issue, description = 'فاتورة ' || existing_inv.invoice_number
    WHERE id = journal_id;
  END IF;

  -- Determine debit account (CASH only if walk-in customer with cash payment, otherwise CUSTOMER_RECEIVABLE)
  IF new_customer_id IS NULL AND pay_method = 'cash' THEN
    SELECT id INTO debit_acc FROM public.accounts WHERE store_id = p_store_id AND account_tag IN ('CASH', 'PETTY_CASH') AND is_active AND NOT is_group AND normal_balance = 'debit' ORDER BY created_at, id LIMIT 1;
    debit_tag := 'CASH';
  ELSE
    debit_acc := ar;
    debit_tag := 'CUSTOMER_RECEIVABLE';
  END IF;

  -- Insert updated journal lines
  INSERT INTO public.journal_lines(journal_entry_id, account_id, debit, credit, currency, description, sort_order, account_tag_used, source_rule)
  VALUES
    (journal_id, debit_acc, total, 0, curr, 'استحقاق فاتورة ' || existing_inv.invoice_number, 1, debit_tag, 'SALE_CREDIT_POSTED'),
    (journal_id, revenue, 0, total, curr, 'إيراد فاتورة ' || existing_inv.invoice_number, 2, 'SALES_REVENUE', 'SALE_CREDIT_POSTED');

  IF cost > 0 AND cogs IS NOT NULL AND inventory IS NOT NULL THEN
    INSERT INTO public.journal_lines(journal_entry_id, account_id, debit, credit, currency, description, sort_order, account_tag_used, source_rule)
    VALUES
      (journal_id, cogs, cost, 0, curr, 'تكلفة مبيعات ' || existing_inv.invoice_number, 3, 'COGS', 'SALE_COGS'),
      (journal_id, inventory, 0, cost, curr, 'إخراج مخزون ' || existing_inv.invoice_number, 4, 'INVENTORY', 'INVENTORY_OUT');
  END IF;

  -- Apply new journal lines to accounts.balance
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

  UPDATE public.invoices SET journal_entry_id = journal_id WHERE id = p_invoice_id;

  -- 9. Financial Audit Log
  INSERT INTO public.financial_audit_log(
    store_id, entity_type, entity_id, entity_label, action, actor_id, details
  ) VALUES (
    p_store_id, 'invoice', p_invoice_id, existing_inv.invoice_number, 'update', actor,
    jsonb_build_object(
      'old_total', existing_inv.total,
      'new_total', total,
      'old_amount_paid', existing_inv.amount_paid,
      'new_amount_paid', paid,
      'old_status', existing_inv.status,
      'new_status', new_status,
      'journal_entry_id', journal_id,
      'atomic', true
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'invoiceId', p_invoice_id,
    'invoiceNumber', existing_inv.invoice_number,
    'total', total,
    'amountPaid', paid,
    'status', new_status,
    'journalEntryId', journal_id
  );
END $$;

REVOKE ALL ON FUNCTION public.update_sales_invoice_atomic(uuid,uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.update_sales_invoice_atomic(uuid,uuid,jsonb) TO authenticated;
NOTIFY pgrst,'reload schema';

COMMIT;
