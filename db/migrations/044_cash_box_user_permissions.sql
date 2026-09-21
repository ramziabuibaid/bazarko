-- ========================================================
-- Migration 044: صلاحيات الصناديق والخزينة للمستخدمين
-- Control user-level permissions for cash boxes in vouchers (receipt/payment)
-- ========================================================

SET search_path = public;

-- 1. جدول صلاحيات الصناديق للمستخدمين
CREATE TABLE IF NOT EXISTS public.user_cash_box_permissions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id     UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  cash_box_id  UUID NOT NULL REFERENCES public.cash_boxes(id) ON DELETE CASCADE,
  can_receipt  BOOLEAN NOT NULL DEFAULT TRUE,  -- مسموح بإنشاء سندات قبض
  can_payment  BOOLEAN NOT NULL DEFAULT TRUE,  -- مسموح بإنشاء سندات صرف
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(store_id, user_id, cash_box_id)
);

CREATE INDEX IF NOT EXISTS idx_user_cb_perms_lookup 
  ON public.user_cash_box_permissions(store_id, user_id);

CREATE INDEX IF NOT EXISTS idx_user_cb_perms_box 
  ON public.user_cash_box_permissions(cash_box_id);

-- 2. تفعيل RLS
ALTER TABLE public.user_cash_box_permissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "store_member_cash_box_perms" ON public.user_cash_box_permissions;

CREATE POLICY "store_member_cash_box_perms" ON public.user_cash_box_permissions
  FOR ALL USING (is_store_member(store_id));

-- 3. ربط الشيكات بالسندات والصناديق بدقة إن لم يكن العمود موجوداً
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'checks' AND column_name = 'voucher_id'
  ) THEN
    ALTER TABLE public.checks ADD COLUMN voucher_id UUID REFERENCES public.vouchers(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_checks_voucher ON public.checks(voucher_id);
