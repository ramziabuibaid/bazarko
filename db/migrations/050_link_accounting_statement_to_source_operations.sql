-- Migration 050: Link Accounting Statement & Journal Entries to Original Source Operations
-- Purpose:
-- 1. Add direct, real database references from journal_entries to their originating operations:
--    - source_type (receipt_voucher, payment_voucher, sales_invoice, purchase_invoice, sales_return, purchase_return, inventory_movement, treasury_transfer, check_operation, manual)
--    - source_id (UUID of originating row)
--    - source_number (human-readable document number like RCP-0007, INV-0005, PUR-01, etc.)
--    - source_url (direct web path to open/view/print the source)
-- 2. Add journal_entry_id foreign keys to vouchers and invoices for bidirectional integrity.
-- 3. Automatic backfill of existing journal entries.
-- 4. Triggers to keep source document references and deletions synchronized with journal entries.

BEGIN;

-- 1. Ensure columns exist on journal_entries
ALTER TABLE public.journal_entries
  ADD COLUMN IF NOT EXISTS source_type TEXT,
  ADD COLUMN IF NOT EXISTS source_id UUID,
  ADD COLUMN IF NOT EXISTS source_number TEXT,
  ADD COLUMN IF NOT EXISTS source_url TEXT;

-- 2. Add journal_entry_id to vouchers if missing
ALTER TABLE public.vouchers
  ADD COLUMN IF NOT EXISTS journal_entry_id UUID REFERENCES public.journal_entries(id) ON DELETE SET NULL;

-- 3. Add journal_entry_id to invoices if missing
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS journal_entry_id UUID REFERENCES public.journal_entries(id) ON DELETE SET NULL;

-- 4. Create Indexes
CREATE INDEX IF NOT EXISTS idx_journal_entries_source_id ON public.journal_entries(source_id);
CREATE INDEX IF NOT EXISTS idx_journal_entries_source_type ON public.journal_entries(source_type);
CREATE INDEX IF NOT EXISTS idx_vouchers_journal_entry_id ON public.vouchers(journal_entry_id);
CREATE INDEX IF NOT EXISTS idx_invoices_journal_entry_id ON public.invoices(journal_entry_id);

-- 5. Backfill Existing Journal Entries

-- 5.1 Vouchers (Receipts & Payments) by direct ref_id
UPDATE public.journal_entries je
SET 
  source_type = CASE WHEN v.type = 'receipt' THEN 'receipt_voucher' ELSE 'payment_voucher' END,
  source_id = v.id,
  source_number = v.voucher_number,
  source_url = CASE WHEN v.type = 'receipt' THEN '/dashboard/accounting/receipts/print/' || v.id ELSE '/dashboard/accounting/payments/print/' || v.id END
FROM public.vouchers v
WHERE je.ref_id = v.id AND (je.source = 'voucher' OR je.source IS NULL);

-- Fallback for vouchers matched by voucher_number in description
UPDATE public.journal_entries je
SET 
  source_type = CASE WHEN v.type = 'receipt' THEN 'receipt_voucher' ELSE 'payment_voucher' END,
  source_id = v.id,
  source_number = v.voucher_number,
  source_url = CASE WHEN v.type = 'receipt' THEN '/dashboard/accounting/receipts/print/' || v.id ELSE '/dashboard/accounting/payments/print/' || v.id END
FROM public.vouchers v
WHERE je.source_type IS NULL 
  AND je.description LIKE '%' || v.voucher_number || '%'
  AND v.store_id = je.store_id;

-- Update vouchers.journal_entry_id
UPDATE public.vouchers v
SET journal_entry_id = je.id
FROM public.journal_entries je
WHERE (je.source_id = v.id OR je.ref_id = v.id) AND v.journal_entry_id IS NULL;

-- 5.2 Sales Invoices
UPDATE public.journal_entries je
SET 
  source_type = 'sales_invoice',
  source_id = inv.id,
  source_number = inv.invoice_number,
  source_url = '/dashboard/accounting/invoices/' || inv.id
FROM public.invoices inv
WHERE (je.ref_id = inv.id OR je.description LIKE '%' || inv.invoice_number || '%')
  AND (je.source = 'invoice' OR je.source_type IS NULL);

-- Update invoices.journal_entry_id
UPDATE public.invoices inv
SET journal_entry_id = je.id
FROM public.journal_entries je
WHERE (je.source_id = inv.id OR je.ref_id = inv.id) AND inv.journal_entry_id IS NULL;

-- 5.3 Purchases
UPDATE public.journal_entries je
SET 
  source_type = 'purchase_invoice',
  source_id = p.id,
  source_number = p.invoice_number,
  source_url = '/dashboard/purchases/' || p.id
FROM public.purchase_invoices p
WHERE (je.ref_id = p.id OR je.description LIKE '%' || p.invoice_number || '%')
  AND (je.source = 'purchase' OR je.source_type IS NULL);

UPDATE public.purchase_invoices p
SET journal_entry_id = je.id
FROM public.journal_entries je
WHERE (je.source_id = p.id OR je.ref_id = p.id) AND p.journal_entry_id IS NULL;

-- 5.4 Sales Returns
UPDATE public.journal_entries je
SET 
  source_type = 'sales_return',
  source_id = sr.id,
  source_number = sr.return_number,
  source_url = '/dashboard/invoices/returns/print/' || sr.id
FROM public.sales_returns sr
WHERE (je.ref_id = sr.id OR je.description LIKE '%' || sr.return_number || '%');

UPDATE public.sales_returns sr
SET journal_entry_id = je.id
FROM public.journal_entries je
WHERE (je.source_id = sr.id OR je.ref_id = sr.id) AND sr.journal_entry_id IS NULL;

-- 5.5 Purchase Returns
UPDATE public.journal_entries je
SET 
  source_type = 'purchase_return',
  source_id = pr.id,
  source_number = pr.return_number,
  source_url = '/dashboard/purchases/returns/print/' || pr.id
FROM public.purchase_returns pr
WHERE (je.ref_id = pr.id OR je.description LIKE '%' || pr.return_number || '%');

UPDATE public.purchase_returns pr
SET journal_entry_id = je.id
FROM public.journal_entries je
WHERE (je.source_id = pr.id OR je.ref_id = pr.id) AND pr.journal_entry_id IS NULL;

-- 5.6 Check Operations & Checks
UPDATE public.journal_entries je
SET 
  source_type = 'check_operation',
  source_id = c.id,
  source_number = 'شيك #' || c.check_number,
  source_url = '/dashboard/cheques/print/' || c.id
FROM public.check_operations co
JOIN public.checks c ON c.id = co.check_id
WHERE (je.ref_id = co.id OR je.ref_id = c.id OR je.id = co.journal_entry_id);

-- 5.7 Manual Entries
UPDATE public.journal_entries je
SET 
  source_type = 'manual',
  source_id = je.id,
  source_number = je.entry_number,
  source_url = '/dashboard/accounting/journal/' || je.id || '/edit'
WHERE (je.source = 'manual' OR je.source_type IS NULL);

-- 6. Trigger to automatically keep source_id and ref_id synced
CREATE OR REPLACE FUNCTION public.sync_journal_entry_source_fields()
RETURNS TRIGGER AS $$
DECLARE
  v_rec RECORD;
BEGIN
  -- Default source_id to ref_id if empty
  IF NEW.source_id IS NULL AND NEW.ref_id IS NOT NULL THEN
    NEW.source_id := NEW.ref_id;
  END IF;

  -- Default ref_id to source_id if empty
  IF NEW.ref_id IS NULL AND NEW.source_id IS NOT NULL THEN
    NEW.ref_id := NEW.source_id;
  END IF;

  -- Auto-resolve source_type, source_number, and source_url if not provided
  IF NEW.source_type IS NULL OR NEW.source_number IS NULL OR NEW.source_url IS NULL THEN
    IF NEW.source = 'voucher' OR NEW.source_type IN ('receipt_voucher', 'payment_voucher', 'voucher') THEN
      SELECT id, voucher_number, type INTO v_rec FROM public.vouchers WHERE id = NEW.source_id;
      IF FOUND THEN
        NEW.source_type := CASE WHEN v_rec.type = 'receipt' THEN 'receipt_voucher' ELSE 'payment_voucher' END;
        NEW.source_number := COALESCE(NEW.source_number, v_rec.voucher_number);
        NEW.source_url := COALESCE(NEW.source_url, CASE WHEN v_rec.type = 'receipt' THEN '/dashboard/accounting/receipts/print/' || v_rec.id ELSE '/dashboard/accounting/payments/print/' || v_rec.id END);
      END IF;
    ELSIF NEW.source = 'invoice' OR NEW.source_type = 'sales_invoice' THEN
      SELECT id, invoice_number INTO v_rec FROM public.invoices WHERE id = NEW.source_id;
      IF FOUND THEN
        NEW.source_type := 'sales_invoice';
        NEW.source_number := COALESCE(NEW.source_number, v_rec.invoice_number);
        NEW.source_url := COALESCE(NEW.source_url, '/dashboard/accounting/invoices/' || v_rec.id);
      END IF;
    ELSIF NEW.source = 'purchase' OR NEW.source_type = 'purchase_invoice' THEN
      SELECT id, invoice_number INTO v_rec FROM public.purchase_invoices WHERE id = NEW.source_id;
      IF FOUND THEN
        NEW.source_type := 'purchase_invoice';
        NEW.source_number := COALESCE(NEW.source_number, v_rec.invoice_number);
        NEW.source_url := COALESCE(NEW.source_url, '/dashboard/purchases/' || v_rec.id);
      END IF;
    ELSIF NEW.source = 'check_op' OR NEW.source_type = 'check_operation' THEN
      SELECT id, check_number INTO v_rec FROM public.checks WHERE id = NEW.source_id;
      IF FOUND THEN
        NEW.source_type := 'check_operation';
        NEW.source_number := COALESCE(NEW.source_number, 'شيك #' || v_rec.check_number);
        NEW.source_url := COALESCE(NEW.source_url, '/dashboard/cheques/print/' || v_rec.id);
      END IF;
    ELSIF NEW.source = 'sales_return' OR NEW.source_type = 'sales_return' THEN
      SELECT id, return_number INTO v_rec FROM public.sales_returns WHERE id = NEW.source_id;
      IF FOUND THEN
        NEW.source_type := 'sales_return';
        NEW.source_number := COALESCE(NEW.source_number, v_rec.return_number);
        NEW.source_url := COALESCE(NEW.source_url, '/dashboard/invoices/returns/print/' || v_rec.id);
      END IF;
    ELSIF NEW.source = 'purchase_return' OR NEW.source_type = 'purchase_return' THEN
      SELECT id, return_number INTO v_rec FROM public.purchase_returns WHERE id = NEW.source_id;
      IF FOUND THEN
        NEW.source_type := 'purchase_return';
        NEW.source_number := COALESCE(NEW.source_number, v_rec.return_number);
        NEW.source_url := COALESCE(NEW.source_url, '/dashboard/purchases/returns/print/' || v_rec.id);
      END IF;
    ELSIF NEW.source = 'inventory' OR NEW.source_type = 'inventory_movement' THEN
      NEW.source_type := 'inventory_movement';
      NEW.source_url := COALESCE(NEW.source_url, '/dashboard/inventory/movements');
    ELSIF NEW.source = 'transfer' OR NEW.source_type = 'treasury_transfer' THEN
      NEW.source_type := 'treasury_transfer';
      NEW.source_url := COALESCE(NEW.source_url, '/dashboard/accounting/treasury');
    ELSE
      NEW.source_type := 'manual';
      NEW.source_number := COALESCE(NEW.source_number, NEW.entry_number);
      NEW.source_url := COALESCE(NEW.source_url, '/dashboard/accounting/journal/' || NEW.id || '/edit');
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_journal_entry_source_fields ON public.journal_entries;
CREATE TRIGGER trg_sync_journal_entry_source_fields
BEFORE INSERT OR UPDATE ON public.journal_entries
FOR EACH ROW
EXECUTE FUNCTION public.sync_journal_entry_source_fields();

-- 7. Database Function: get_journal_entry_origin(p_entry_id UUID)
-- Returns comprehensive resolved source metadata for any journal entry
CREATE OR REPLACE FUNCTION public.get_journal_entry_origin(p_entry_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_entry RECORD;
BEGIN
  SELECT * INTO v_entry FROM public.journal_entries WHERE id = p_entry_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  RETURN jsonb_build_object(
    'found', true,
    'entry_id', v_entry.id,
    'entry_number', v_entry.entry_number,
    'date', v_entry.date,
    'description', v_entry.description,
    'source', v_entry.source,
    'source_type', COALESCE(v_entry.source_type, v_entry.source, 'manual'),
    'source_id', COALESCE(v_entry.source_id, v_entry.ref_id),
    'source_number', v_entry.source_number,
    'source_url', v_entry.source_url,
    'is_manual', (COALESCE(v_entry.source_type, v_entry.source, 'manual') = 'manual')
  );
END;
$$ LANGUAGE plpgsql STABLE;

COMMIT;
