-- ==============================================================================
-- Migration 045: Fix Vouchers & Cash Movements Sync, Constraints & Invoice Items Cost
-- 1. Support cheque, check, split in cash_movements payment_method
-- 2. Support receipt_voucher, payment_voucher in cash_movements source
-- 3. Trigger updates: only insert cash portion into cash_movements
-- 4. Trigger on voucher UPDATE to sync cash movements
-- 5. Ensure invoice_items has cost_price column
-- ==============================================================================
SET search_path = public;

-- 1. تحديث قيود جدول cash_movements لدعم الشيكات والمدفوعات المجزأة
ALTER TABLE public.cash_movements
  DROP CONSTRAINT IF EXISTS cash_movements_payment_method_check;

ALTER TABLE public.cash_movements
  ADD CONSTRAINT cash_movements_payment_method_check
  CHECK (payment_method IN ('cash', 'bank', 'card', 'transfer', 'cheque', 'check', 'split'));

ALTER TABLE public.cash_movements
  DROP CONSTRAINT IF EXISTS cash_movements_source_check;

ALTER TABLE public.cash_movements
  ADD CONSTRAINT cash_movements_source_check
  CHECK (source IN ('voucher', 'receipt_voucher', 'payment_voucher', 'order', 'invoice', 'manual', 'closing', 'opening', 'transfer'));

-- 2. التأكد من وجود عمود cost_price في بنود الفواتير invoice_items
ALTER TABLE public.invoice_items
  ADD COLUMN IF NOT EXISTS cost_price NUMERIC(12,2) NOT NULL DEFAULT 0;

-- 3. تحديث مشغل إدراج السندات (Insert Trigger):
-- يتم تسجيل حركة الخزينة فقط في حال وجود مبلغ نقدي فعلي
CREATE OR REPLACE FUNCTION public.voucher_to_cash_movement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_box UUID;
  v_cash_amt NUMERIC(12,2) := 0;
BEGIN
  -- حساب المبلغ النقدي الفعلي
  IF NEW.payment_method = 'cash' THEN
    v_cash_amt := COALESCE(NEW.cash_amount, NEW.amount);
  ELSIF NEW.payment_method = 'split' THEN
    v_cash_amt := COALESCE(NEW.cash_amount, 0);
  ELSE
    -- cheque, check, bank, transfer -> ليس حركة صندوق نقدي مباشر
    v_cash_amt := 0;
  END IF;

  -- إذا كان هناك جزء نقدي موجب، ننشئ حركة الصندوق
  IF v_cash_amt > 0 THEN
    -- استخدام الصندوق المحدد في السند إن وجد، أو الافتراضي
    v_box := COALESCE(NEW.cash_box_id, public.ensure_cash_box(NEW.store_id));

    INSERT INTO public.cash_movements (
      store_id,
      cash_box_id,
      direction,
      amount,
      source,
      ref_id,
      party_name,
      payment_method,
      description,
      date,
      created_by
    ) VALUES (
      NEW.store_id,
      v_box,
      CASE WHEN NEW.type = 'receipt' THEN 'in' ELSE 'out' END,
      v_cash_amt,
      'voucher',
      NEW.id,
      NEW.party_name,
      'cash',
      NEW.description,
      NEW.date,
      NEW.created_by
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_voucher_cash_in ON public.vouchers;
CREATE TRIGGER trg_voucher_cash_in
  AFTER INSERT ON public.vouchers
  FOR EACH ROW EXECUTE PROCEDURE public.voucher_to_cash_movement();

-- 4. مشغل تحديث السندات (Update Trigger):
-- عند تعديل السند يتم تحديث حركة الصندوق المرتبطة أو إنشاؤها/حذفها بحسب طريقة الدفع والمبلغ
CREATE OR REPLACE FUNCTION public.voucher_update_cash_movement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_box UUID;
  v_cash_amt NUMERIC(12,2) := 0;
  v_exists BOOLEAN;
BEGIN
  -- حساب المبلغ النقدي الجديد
  IF NEW.payment_method = 'cash' THEN
    v_cash_amt := COALESCE(NEW.cash_amount, NEW.amount);
  ELSIF NEW.payment_method = 'split' THEN
    v_cash_amt := COALESCE(NEW.cash_amount, 0);
  ELSE
    v_cash_amt := 0;
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM public.cash_movements
    WHERE ref_id = NEW.id AND source IN ('voucher', 'receipt_voucher', 'payment_voucher')
  ) INTO v_exists;

  IF v_cash_amt > 0 THEN
    v_box := COALESCE(NEW.cash_box_id, public.ensure_cash_box(NEW.store_id));

    IF v_exists THEN
      -- تحديث الحركة القائمة
      UPDATE public.cash_movements
      SET
        cash_box_id = v_box,
        direction = CASE WHEN NEW.type = 'receipt' THEN 'in' ELSE 'out' END,
        amount = v_cash_amt,
        party_name = NEW.party_name,
        description = NEW.description,
        date = NEW.date
      WHERE ref_id = NEW.id AND source IN ('voucher', 'receipt_voucher', 'payment_voucher');
    ELSE
      -- إنشاء حركة جديدة إذا تم تحويل السند إلى نقدي
      INSERT INTO public.cash_movements (
        store_id,
        cash_box_id,
        direction,
        amount,
        source,
        ref_id,
        party_name,
        payment_method,
        description,
        date,
        created_by
      ) VALUES (
        NEW.store_id,
        v_box,
        CASE WHEN NEW.type = 'receipt' THEN 'in' ELSE 'out' END,
        v_cash_amt,
        'voucher',
        NEW.id,
        NEW.party_name,
        'cash',
        NEW.description,
        NEW.date,
        NEW.created_by
      );
    END IF;
  ELSE
    -- إذا تغيرت طريقة الدفع إلى شيك 100% أو بنك، نحذف الحركة النقدية
    IF v_exists THEN
      DELETE FROM public.cash_movements
      WHERE ref_id = NEW.id AND source IN ('voucher', 'receipt_voucher', 'payment_voucher');
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_voucher_cash_upd ON public.vouchers;
CREATE TRIGGER trg_voucher_cash_upd
  AFTER UPDATE ON public.vouchers
  FOR EACH ROW EXECUTE PROCEDURE public.voucher_update_cash_movement();

-- 5. مشغل حذف السندات (Delete Trigger)
CREATE OR REPLACE FUNCTION public.voucher_delete_cash_movement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.cash_movements
  WHERE ref_id = OLD.id AND source IN ('voucher', 'receipt_voucher', 'payment_voucher');
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_voucher_cash_del ON public.vouchers;
CREATE TRIGGER trg_voucher_cash_del
  AFTER DELETE ON public.vouchers
  FOR EACH ROW EXECUTE PROCEDURE public.voucher_delete_cash_movement();
