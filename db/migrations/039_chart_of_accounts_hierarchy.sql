-- ==============================================================================
-- Migration 039: Chart of Accounts Hierarchy, System Flags, and Normal Balances
-- ==============================================================================
SET search_path = public;

DO $$
BEGIN
  -- 1. إضافة الوصف (Description)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'accounts' AND column_name = 'description'
  ) THEN
    ALTER TABLE public.accounts ADD COLUMN description TEXT;
  END IF;

  -- 2. إضافة حالة التفعيل (is_active)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'accounts' AND column_name = 'is_active'
  ) THEN
    ALTER TABLE public.accounts ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE;
  END IF;

  -- 3. إضافة علامة حساب النظام الأساسي (is_system)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'accounts' AND column_name = 'is_system'
  ) THEN
    ALTER TABLE public.accounts ADD COLUMN is_system BOOLEAN NOT NULL DEFAULT FALSE;
  END IF;

  -- 4. إضافة طبيعة الحساب (طبيعة الرصيد: مدين / دائن)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'accounts' AND column_name = 'normal_balance'
  ) THEN
    ALTER TABLE public.accounts ADD COLUMN normal_balance TEXT NOT NULL DEFAULT 'debit'
      CHECK (normal_balance IN ('debit', 'credit'));
  END IF;
END $$;

-- 5. تحديث طبيعة الحساب التلقائية بحسب نوع الحساب للأرصدة القائمة
UPDATE public.accounts 
SET normal_balance = 'debit' 
WHERE type IN ('asset', 'expense') AND (normal_balance IS NULL OR normal_balance = '');

UPDATE public.accounts 
SET normal_balance = 'credit' 
WHERE type IN ('liability', 'equity', 'revenue') AND (normal_balance IS NULL OR normal_balance = '');

-- 6. وضع علامة حساب نظام أساسي 🔒 على الحسابات المعيارية
UPDATE public.accounts
SET is_system = TRUE
WHERE code IN ('1001', '1002', '1101', '1201', '2001', '4001', '4002', '5001');
