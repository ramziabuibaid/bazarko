-- ==========================================
-- Migration 022: الصندوق والخزينة (Treasury)
-- صندوق نقدي واحد لكل متجر + دفتر حركات + جلسات إغلاق يومي
-- ==========================================
SET search_path = public;

-- ─────────────────────────────────────────────────
-- 1. الصناديق — صندوق نقدي رئيسي واحد لكل متجر الآن
--    (cash_box_id محفوظ في الحركات لدعم تعدد الصناديق مستقبلاً)
-- ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cash_boxes (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id        UUID          NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  name            TEXT          NOT NULL DEFAULT 'الصندوق الرئيسي',
  type            TEXT          NOT NULL DEFAULT 'cash'
                  CHECK (type IN ('cash','bank','wallet')),
  opening_balance NUMERIC(12,2) NOT NULL DEFAULT 0,   -- الرصيد الافتتاحي اليدوي
  is_active       BOOLEAN       NOT NULL DEFAULT TRUE,
  is_default      BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cash_boxes_store ON public.cash_boxes(store_id);

-- ─────────────────────────────────────────────────
-- 2. حركات الصندوق — مصدر الحقيقة للرصيد والتدفق النقدي
--    كل سند/طلبية/دفعة فاتورة/إيداع/سحب تكتب صفاً هنا
-- ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cash_movements (
  id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id       UUID          NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  cash_box_id    UUID          NOT NULL REFERENCES public.cash_boxes(id) ON DELETE CASCADE,
  session_id     UUID,         -- جلسة الإغلاق اليومي (تُملأ لاحقاً، nullable)
  direction      TEXT          NOT NULL CHECK (direction IN ('in','out')),
  amount         NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  source         TEXT          NOT NULL DEFAULT 'manual'
                 CHECK (source IN ('voucher','order','invoice','manual','closing','opening','transfer')),
  ref_id         UUID,         -- معرّف السند/الطلبية/الفاتورة المرتبط
  party_name     TEXT,
  payment_method TEXT          NOT NULL DEFAULT 'cash'
                 CHECK (payment_method IN ('cash','bank','card','transfer')),
  description    TEXT          NOT NULL,
  date           DATE          NOT NULL DEFAULT CURRENT_DATE,
  created_by     UUID          REFERENCES auth.users(id),
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cash_movements_store    ON public.cash_movements(store_id);
CREATE INDEX IF NOT EXISTS idx_cash_movements_box      ON public.cash_movements(cash_box_id);
CREATE INDEX IF NOT EXISTS idx_cash_movements_date     ON public.cash_movements(store_id, date);
CREATE INDEX IF NOT EXISTS idx_cash_movements_session  ON public.cash_movements(session_id);
CREATE INDEX IF NOT EXISTS idx_cash_movements_ref      ON public.cash_movements(source, ref_id);

-- ─────────────────────────────────────────────────
-- 3. جلسات الإغلاق اليومي — مطابقة الرصيد الفعلي بالمحسوب
-- ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cash_sessions (
  id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id       UUID          NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  cash_box_id    UUID          NOT NULL REFERENCES public.cash_boxes(id) ON DELETE CASCADE,
  status         TEXT          NOT NULL DEFAULT 'open'
                 CHECK (status IN ('open','closed')),
  opened_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
  closed_at      TIMESTAMPTZ,
  opening_amount NUMERIC(12,2) NOT NULL DEFAULT 0,   -- الرصيد عند فتح الجلسة
  total_in       NUMERIC(12,2) NOT NULL DEFAULT 0,   -- مجموع الداخل خلال الجلسة
  total_out      NUMERIC(12,2) NOT NULL DEFAULT 0,   -- مجموع الخارج خلال الجلسة
  system_total   NUMERIC(12,2) NOT NULL DEFAULT 0,   -- الرصيد المحسوب عند الإغلاق
  counted_amount NUMERIC(12,2),                      -- العدّ الفعلي للنقد
  variance       NUMERIC(12,2),                      -- counted - system (فائض/عجز)
  notes          TEXT,
  opened_by      UUID          REFERENCES auth.users(id),
  closed_by      UUID          REFERENCES auth.users(id),
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cash_sessions_store ON public.cash_sessions(store_id);
CREATE INDEX IF NOT EXISTS idx_cash_sessions_open  ON public.cash_sessions(store_id, status);

-- ربط الحركات بالجلسة (FK بعد إنشاء الجدول)
ALTER TABLE public.cash_movements
  DROP CONSTRAINT IF EXISTS cash_movements_session_fk;
ALTER TABLE public.cash_movements
  ADD CONSTRAINT cash_movements_session_fk
  FOREIGN KEY (session_id) REFERENCES public.cash_sessions(id) ON DELETE SET NULL;

-- ─────────────────────────────────────────────────
-- 4. RLS — أعضاء المتجر فقط (إدارة كاملة)
-- ─────────────────────────────────────────────────
ALTER TABLE public.cash_boxes     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_sessions  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "store_member_cash_boxes"     ON public.cash_boxes;
DROP POLICY IF EXISTS "store_member_cash_movements" ON public.cash_movements;
DROP POLICY IF EXISTS "store_member_cash_sessions"  ON public.cash_sessions;

CREATE POLICY "store_member_cash_boxes" ON public.cash_boxes
  FOR ALL USING (is_store_member(store_id));

CREATE POLICY "store_member_cash_movements" ON public.cash_movements
  FOR ALL USING (is_store_member(store_id));

CREATE POLICY "store_member_cash_sessions" ON public.cash_sessions
  FOR ALL USING (is_store_member(store_id));

-- ─────────────────────────────────────────────────
-- 5. دالة: تضمن وجود صندوق افتراضي وتُعيد معرّفه
--    تُستدعى من التطبيق قبل تسجيل أي حركة
-- ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ensure_cash_box(p_store_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_box_id UUID;
BEGIN
  SELECT id INTO v_box_id
  FROM public.cash_boxes
  WHERE store_id = p_store_id AND is_default = TRUE
  ORDER BY created_at ASC
  LIMIT 1;

  IF v_box_id IS NULL THEN
    INSERT INTO public.cash_boxes (store_id, name, type, is_default)
    VALUES (p_store_id, 'الصندوق الرئيسي', 'cash', TRUE)
    RETURNING id INTO v_box_id;
  END IF;

  RETURN v_box_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_cash_box(UUID) TO authenticated;

-- ─────────────────────────────────────────────────
-- 6. Triggers: مزامنة السندات تلقائياً مع دفتر الصندوق
--    سند قبض → حركة داخل، سند صرف → حركة خارج
--    (مصدر حقيقة واحد أياً كان مصدر السند)
-- ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.voucher_to_cash_movement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_box UUID;
BEGIN
  v_box := public.ensure_cash_box(NEW.store_id);

  INSERT INTO public.cash_movements (
    store_id, cash_box_id, direction, amount, source, ref_id,
    party_name, payment_method, description, date, created_by
  ) VALUES (
    NEW.store_id, v_box,
    CASE WHEN NEW.type = 'receipt' THEN 'in' ELSE 'out' END,
    NEW.amount, 'voucher', NEW.id,
    NEW.party_name, NEW.payment_method, NEW.description, NEW.date, NEW.created_by
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_voucher_cash_in ON public.vouchers;
CREATE TRIGGER trg_voucher_cash_in
  AFTER INSERT ON public.vouchers
  FOR EACH ROW EXECUTE PROCEDURE public.voucher_to_cash_movement();

-- حذف السند → حذف حركته المقابلة (تنظيف الرصيد)
CREATE OR REPLACE FUNCTION public.voucher_delete_cash_movement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.cash_movements
  WHERE source = 'voucher' AND ref_id = OLD.id;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_voucher_cash_del ON public.vouchers;
CREATE TRIGGER trg_voucher_cash_del
  AFTER DELETE ON public.vouchers
  FOR EACH ROW EXECUTE PROCEDURE public.voucher_delete_cash_movement();

-- ─────────────────────────────────────────────────
-- 7. Backfill — صندوق افتراضي لكل متجر موجود حالياً
--    ثم ترحيل السندات السابقة كحركات صندوق (مرة واحدة)
-- ─────────────────────────────────────────────────
INSERT INTO public.cash_boxes (store_id, name, type, is_default)
SELECT s.id, 'الصندوق الرئيسي', 'cash', TRUE
FROM public.stores s
WHERE NOT EXISTS (
  SELECT 1 FROM public.cash_boxes cb WHERE cb.store_id = s.id
);

-- ترحيل السندات الموجودة إلى حركات صندوق (يتجاهل المُرحّل مسبقاً)
INSERT INTO public.cash_movements (
  store_id, cash_box_id, direction, amount, source, ref_id,
  party_name, payment_method, description, date, created_by, created_at
)
SELECT
  v.store_id,
  (SELECT id FROM public.cash_boxes cb WHERE cb.store_id = v.store_id AND cb.is_default ORDER BY created_at LIMIT 1),
  CASE WHEN v.type = 'receipt' THEN 'in' ELSE 'out' END,
  v.amount, 'voucher', v.id,
  v.party_name, v.payment_method, v.description, v.date, v.created_by, v.created_at
FROM public.vouchers v
WHERE NOT EXISTS (
  SELECT 1 FROM public.cash_movements cm
  WHERE cm.source = 'voucher' AND cm.ref_id = v.id
);
