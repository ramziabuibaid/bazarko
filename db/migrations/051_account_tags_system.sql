-- ==============================================================================
-- Migration: 051_account_tags_system.sql
-- Description: نظام وسوم الحسابات (Account Tags) في شجرة ودليل الحسابات
-- لتعريف الوظيفة التشغيلية لكل حساب وربط القيود التلقائية والتقارير به بمعزل عن الاسم أو الكود
-- ==============================================================================

-- 1. إنشاء جدول وسوم الحسابات المستقل (account_tags)
CREATE TABLE IF NOT EXISTS public.account_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  name_ar TEXT NOT NULL,
  name_en TEXT NOT NULL,
  allowed_account_type TEXT NOT NULL CHECK (allowed_account_type IN ('asset', 'liability', 'equity', 'revenue', 'expense')),
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- سياسات الأمان للقراءة العامة للمستخدمين المصادقين
ALTER TABLE public.account_tags ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'account_tags' AND policyname = 'Allow read account_tags to all authenticated users'
  ) THEN
    CREATE POLICY "Allow read account_tags to all authenticated users"
      ON public.account_tags FOR SELECT
      TO authenticated
      USING (true);
  END IF;
END $$;

-- 2. إضافة حقول الوسم إلى جدول الحسابات (accounts)
ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS account_tag_id UUID REFERENCES public.account_tags(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS account_tag TEXT REFERENCES public.account_tags(code) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_accounts_account_tag_id ON public.accounts(account_tag_id);
CREATE INDEX IF NOT EXISTS idx_accounts_account_tag ON public.accounts(account_tag);
CREATE INDEX IF NOT EXISTS idx_accounts_store_tag ON public.accounts(store_id, account_tag);

-- 3. تريجر لمزامنة account_tag_id مع account_tag والتحقق من توافق النوع (Validation)
CREATE OR REPLACE FUNCTION public.sync_account_tag_fields()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.account_tag_id IS NOT NULL AND (TG_OP = 'INSERT' OR OLD.account_tag_id IS DISTINCT FROM NEW.account_tag_id OR NEW.account_tag IS NULL) THEN
    SELECT code INTO NEW.account_tag FROM public.account_tags WHERE id = NEW.account_tag_id;
  ELSIF NEW.account_tag IS NOT NULL AND (TG_OP = 'INSERT' OR OLD.account_tag IS DISTINCT FROM NEW.account_tag OR NEW.account_tag_id IS NULL) THEN
    SELECT id INTO NEW.account_tag_id FROM public.account_tags WHERE code = NEW.account_tag;
  ELSIF NEW.account_tag_id IS NULL AND NEW.account_tag IS NULL THEN
    -- كلا الحقلين فارغ
  END IF;

  -- فحص التحقق: التأكد من أن نوع الحساب يطابق النوع المسموح به في الوسم
  IF NEW.account_tag_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.account_tags
      WHERE id = NEW.account_tag_id AND allowed_account_type = NEW.type
    ) THEN
      RAISE EXCEPTION 'وسم الحساب المحدد لا يتوافق مع نوع الحساب (%)', NEW.type;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_account_tag_fields ON public.accounts;
CREATE TRIGGER trg_sync_account_tag_fields
BEFORE INSERT OR UPDATE OF account_tag_id, account_tag, type ON public.accounts
FOR EACH ROW EXECUTE FUNCTION public.sync_account_tag_fields();

-- 4. إدراج وتحديث الوسوم المعيارية في النظام (Standard Predefined Tags)
INSERT INTO public.account_tags (code, name_ar, name_en, allowed_account_type, description)
VALUES
  -- الأصول (Assets)
  ('CASH', 'الصناديق النقدية / الخزينة', 'Cash / Cash Box', 'asset', 'أموال نقدية سائلة في الصناديق والخزائن ونقاط البيع'),
  ('BANK', 'الحسابات البنكية', 'Bank Accounts', 'asset', 'أرصدة الحسابات الجارية والتوفير في البنوك والمصارف'),
  ('CUSTOMER_RECEIVABLE', 'ذمم العملاء / المدينون', 'Accounts Receivable (Customers)', 'asset', 'مستحقات نقدية على الزبائن والعملاء من مبيعات آجلة'),
  ('CHECKS_PORTFOLIO', 'محفظة الشيكات الواردة (أوراق قبض)', 'Checks in Portfolio', 'asset', 'شيكات مقبوضة من الزبائن محتفظ بها في المحفظة ولم تودع أو تجير بعد'),
  ('CHECKS_UNDER_COLLECTION', 'شيكات برسم التحصيل', 'Checks Under Collection', 'asset', 'شيكات مودعة في البنك بانتظار موعد الاستحقاق والتحصيل الفعلي'),
  ('CHECKS_BOUNCED', 'محفظة الشيكات المرتجعة', 'Bounced Checks Portfolio', 'asset', 'شيكات راجعة ومرفوضة من البنك للمتابعة القانونية والتحصيل'),
  ('INVENTORY', 'المخزون السلعي والبضاعة', 'Inventory / Stock', 'asset', 'بضائع معدة للبيع ومسجلة بسعر التكلفة في المستودعات'),
  ('VAT_INPUT', 'ضريبة القيمة المضافة - مدخلات', 'VAT Input', 'asset', 'الضريبة المدفوعة على المشتريات والمصروفات المستردة من الضريبة'),
  ('PREPAID_EXPENSES', 'مصاريف مدفوعة مقدماً', 'Prepaid Expenses', 'asset', 'نفقات مدفوعة مقدماً تخص فترات مالية لاحقة'),
  ('FIXED_ASSETS', 'الأصول الثابتة', 'Fixed Assets', 'asset', 'العقارات والسيارات والأجهزة والمعدات التشغيلية طويلة الأجل'),

  -- الالتزامات (Liabilities)
  ('SUPPLIER_PAYABLE', 'ذمم الموردين / الدائنون', 'Accounts Payable (Suppliers)', 'liability', 'التزامات ومستحقات مالية واجبة السداد للموردين عن مشتريات آجلة'),
  ('VAT_OUTPUT', 'ضريبة القيمة المضافة - مخرجات', 'VAT Output', 'liability', 'الضريبة المحصلة من الزبائن على المبيعات المستحقة للضريبة'),
  ('CHECKS_PAYABLE', 'شيكات صادرة للموردين (أوراق دفع)', 'Checks Payable', 'liability', 'شيكات مسحوبة من المنشأة لصالح الموردين بانتظار صرفها من البنك'),
  ('ACCRUED_EXPENSES', 'مصاريف مستحقة غير مدفوعة', 'Accrued Expenses', 'liability', 'أجور أو فواتير أو مستحقات عن فترات سابقة لم تسدد بعد'),
  ('SHORT_TERM_LOANS', 'قروض والتزامات بنكية قصيرة الأجل', 'Short-term Loans', 'liability', 'تسهيلات أو قروض بنكية مستحقة خلال العام المالي'),

  -- حقوق الملكية (Equity)
  ('CAPITAL', 'رأس المال المدفوع', 'Paid-in Capital', 'equity', 'رأس مال المشروع أو المنشأة المستثمر من المالك أو الشركاء'),
  ('RETAINED_EARNINGS', 'الأرباح والخسائر المدورة', 'Retained Earnings', 'equity', 'الأرباح الصافية المتبقية من السنوات المالية السابقة'),
  ('OWNER_EQUITY', 'جاري المالك / الشركاء', 'Owner / Partner Drawings', 'equity', 'مسحوبات وإيداعات المالك أو الشركاء الجارية'),
  ('CURRENT_YEAR_PROFIT', 'أرباح وخسائر العام الحالي', 'Current Year P&L', 'equity', 'صافي نتائج أعمال الدورة المالية الجارية'),

  -- الإيرادات (Revenue)
  ('SALES_REVENUE', 'إيرادات المبيعات', 'Sales Revenue', 'revenue', 'المبيعات النقدية والآجلة للسلع والمنتجات التجارية'),
  ('SERVICE_REVENUE', 'إيرادات الخدمات والصيانة', 'Service Revenue', 'revenue', 'عائدات تقديم خدمات التصليح، التركيب، أو الصيانة'),
  ('OTHER_REVENUE', 'إيرادات وأرباح متنوعة', 'Other / Misc Revenue', 'revenue', 'عوائد استثنائية أو أرباح بيع أصول أو فروق عملات'),
  ('SALES_DISCOUNT', 'خصم مسموح به (مردودات ومسموحات)', 'Sales Discounts', 'revenue', 'تخفيضات تجارية تمنح للزبائن تقلل من مجمل الإيرادات'),
  ('SALES_RETURNS', 'مردودات المبيعات', 'Sales Returns', 'revenue', 'قيمة البضائع المعادة من الزبائن بعد بيعها'),

  -- المصروفات (Expenses)
  ('COGS', 'تكلفة البضاعة المباعة', 'Cost of Goods Sold (COGS)', 'expense', 'التكلفة المباشرة للسلع والمنتجات التي تم بيعها للزبائن'),
  ('SALARY_EXPENSE', 'رواتب وأجور ومستحقات عاملين', 'Salaries & Wages', 'expense', 'رواتب الموظفين والعمال والبدلات والمكافآت التشغيلية'),
  ('RENT_EXPENSE', 'إيجارات المنشأة والمستودعات', 'Rent Expense', 'expense', 'بدلات إيجار المحلات، المعارض، أو المستودعات'),
  ('UTILITIES_EXPENSE', 'كهرباء ومياه واتصالات', 'Utilities Expense', 'expense', 'فواتير الطاقة والمياه وخطوط الاتصالات والإنترنت'),
  ('MARKETING_EXPENSE', 'دعاية وتسويق وإعلان', 'Marketing & Advertising', 'expense', 'حملات الترويج والإعلانات الرقمية والمطبوعة'),
  ('PURCHASE_DISCOUNT', 'خصم مكتسب على المشتريات', 'Purchase Discounts', 'expense', 'خصومات تجارية أو تعجيل دفع ممنوحة من الموردين تقلل التكلفة'),
  ('PURCHASE_RETURNS', 'مردودات المشتريات', 'Purchase Returns', 'expense', 'بضائع أعيدت للموردين وتخفض التكلفة'),
  ('DEPRECIATION_EXPENSE', 'استهلاك الأصول الثابتة', 'Depreciation Expense', 'expense', 'قسط الإهلاك الدوري للأصول الثابتة والمعدات'),
  ('GENERAL_EXPENSE', 'مصاريف إدارية وتشغيلية متنوعة', 'General & Admin Expense', 'expense', 'مصاريف ضيافة، بوفيه، نقل، وأدوات مكتبية متنوعة')
ON CONFLICT (code) DO UPDATE SET
  name_ar = EXCLUDED.name_ar,
  name_en = EXCLUDED.name_en,
  allowed_account_type = EXCLUDED.allowed_account_type,
  description = EXCLUDED.description,
  is_active = TRUE;

-- 5. إسناد الوسوم تلقائياً للحسابات الحالية في جميع المتاجر (Backfill)
UPDATE public.accounts a
SET account_tag = 'CASH'
WHERE (code = '1001' OR code = '1100' OR name ILIKE '%صندوق%')
  AND type = 'asset'
  AND is_group = FALSE
  AND account_tag IS NULL;

UPDATE public.accounts a
SET account_tag = 'BANK'
WHERE (code = '1200' OR (name ILIKE '%بنك%' AND type = 'asset'))
  AND type = 'asset'
  AND is_group = FALSE
  AND account_tag IS NULL;

UPDATE public.accounts a
SET account_tag = 'CHECKS_PORTFOLIO'
WHERE (code = '1110' OR code = '1300' OR name ILIKE '%محفظة الشيكات%' OR name ILIKE '%أوراق قبض%')
  AND type = 'asset'
  AND account_tag IS NULL;

UPDATE public.accounts a
SET account_tag = 'CHECKS_UNDER_COLLECTION'
WHERE (code = '1320' OR name ILIKE '%برسم التحصيل%')
  AND type = 'asset'
  AND account_tag IS NULL;

UPDATE public.accounts a
SET account_tag = 'CHECKS_BOUNCED'
WHERE (code = '1330' OR name ILIKE '%شيكات راجعة%' OR name ILIKE '%شيكات مرتجعة%')
  AND type = 'asset'
  AND account_tag IS NULL;

UPDATE public.accounts a
SET account_tag = 'CUSTOMER_RECEIVABLE'
WHERE (code = '1400' OR code = '1101' OR name ILIKE '%ذمم مدين%' OR name ILIKE '%ذمم الزبائن%' OR name ILIKE '%ذمم العملاء%')
  AND type = 'asset'
  AND account_tag IS NULL;

UPDATE public.accounts a
SET account_tag = 'INVENTORY'
WHERE (code = '1201' AND name ILIKE '%مخزون%')
  AND type = 'asset'
  AND account_tag IS NULL;

UPDATE public.accounts a
SET account_tag = 'SUPPLIER_PAYABLE'
WHERE (code = '2100' OR code = '2001' OR code = '2101' OR name ILIKE '%ذمم الموردين%')
  AND type = 'liability'
  AND account_tag IS NULL;

UPDATE public.accounts a
SET account_tag = 'CHECKS_PAYABLE'
WHERE (code = '2110' OR name ILIKE '%أوراق دفع%' OR name ILIKE '%شيكات صادرة%')
  AND type = 'liability'
  AND account_tag IS NULL;

UPDATE public.accounts a
SET account_tag = 'VAT_OUTPUT'
WHERE (code = '2120' OR name ILIKE '%ضريبة القيمة المضافة%')
  AND type = 'liability'
  AND account_tag IS NULL;

UPDATE public.accounts a
SET account_tag = 'CAPITAL'
WHERE (code = '3101' OR name ILIKE '%رأس المال%')
  AND type = 'equity'
  AND account_tag IS NULL;

UPDATE public.accounts a
SET account_tag = 'OWNER_EQUITY'
WHERE (code = '3102' OR name ILIKE '%جاري المالك%' OR name ILIKE '%جاري الشركاء%')
  AND type = 'equity'
  AND account_tag IS NULL;

UPDATE public.accounts a
SET account_tag = 'RETAINED_EARNINGS'
WHERE (code = '3103' OR name ILIKE '%أرباح وخسائر مدورة%')
  AND type = 'equity'
  AND account_tag IS NULL;

UPDATE public.accounts a
SET account_tag = 'SALES_REVENUE'
WHERE (code = '4001' OR code = '4100' OR (name ILIKE '%إيرادات المبيعات%' AND NOT name ILIKE '%مردود%'))
  AND type = 'revenue'
  AND account_tag IS NULL;

UPDATE public.accounts a
SET account_tag = 'SERVICE_REVENUE'
WHERE (code = '4002' OR code = '4200' OR name ILIKE '%إيرادات الخدمات%')
  AND type = 'revenue'
  AND account_tag IS NULL;

UPDATE public.accounts a
SET account_tag = 'OTHER_REVENUE'
WHERE (code = '4003' OR name ILIKE '%إيرادات وأرباح متنوعة%')
  AND type = 'revenue'
  AND account_tag IS NULL;

UPDATE public.accounts a
SET account_tag = 'COGS'
WHERE (code = '5001' OR name ILIKE '%تكلفة البضاعة%')
  AND type = 'expense'
  AND account_tag IS NULL;

UPDATE public.accounts a
SET account_tag = 'SALARY_EXPENSE'
WHERE (code = '5101' OR name ILIKE '%رواتب%' OR name ILIKE '%أجور%')
  AND type = 'expense'
  AND account_tag IS NULL;

UPDATE public.accounts a
SET account_tag = 'GENERAL_EXPENSE'
WHERE (code = '5199' OR name ILIKE '%مصاريف إدارية%')
  AND type = 'expense'
  AND account_tag IS NULL;

-- 6. تحديث دالة دورة حياة الشيكات لتعتمد على وسوم الحسابات (Account Tags) أولاً
CREATE OR REPLACE FUNCTION public.execute_check_lifecycle_operation(
  p_check_id UUID,
  p_op_type TEXT,
  p_date DATE,
  p_target_bank_id UUID DEFAULT NULL,
  p_target_cashbox_id UUID DEFAULT NULL,
  p_target_supplier_id UUID DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_check RECORD;
  v_amount NUMERIC(14,2);
  v_currency TEXT;
  v_rate NUMERIC(10,4);
  v_next_status TEXT;
  v_debit_acc_id UUID;
  v_credit_acc_id UUID;
  v_portfolio_acc_id UUID;
  v_collection_acc_id UUID;
  v_returned_acc_id UUID;
  v_customer_acc_id UUID;
  v_supplier_acc_id UUID;
  v_bank_acc_id UUID;
  v_cash_acc_id UUID;
  v_op_desc TEXT;
  v_entry_id UUID;
  v_entry_num TEXT;
  v_cust_bal NUMERIC(14,2);
  v_supp_bal NUMERIC(14,2);
  v_bank_bal NUMERIC(14,2);
BEGIN
  -- أ) جلب الشيك مع القفل الحصري لمنع أي تعارض تزامني
  SELECT * INTO v_check
  FROM public.checks
  WHERE id = p_check_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'الشيك المطلوب غير موجود';
  END IF;

  v_amount := COALESCE(v_check.amount_ils, v_check.amount, 0);
  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'مبلغ الشيك غير صالح';
  END IF;

  v_currency := COALESCE(v_check.currency, 'ILS');
  v_rate := COALESCE(v_check.exchange_rate, 1.0);

  -- ب) فحص الفترة المحاسبية
  IF EXISTS (
    SELECT 1 FROM public.accounting_periods
    WHERE store_id = v_check.store_id
      AND is_closed = TRUE
      AND p_date BETWEEN start_date AND end_date
  ) THEN
    RAISE EXCEPTION 'لا يمكن تنفيذ العملية: التاريخ يقع ضمن فترة محاسبية مقفلة';
  END IF;

  -- ج) استنتاج الحسابات المحاسبية الأساسية من شجرة حسابات المتجر بالاعتماد على وسوم الحسابات (Account Tags) أولاً
  -- 1. حساب محفظة الشيكات الواردة (CHECKS_PORTFOLIO أو 1110)
  SELECT id INTO v_portfolio_acc_id
  FROM public.accounts
  WHERE store_id = v_check.store_id
    AND type = 'asset'
    AND is_group = FALSE
    AND (account_tag = 'CHECKS_PORTFOLIO' OR code = '1110' OR code = '1300' OR name ILIKE '%محفظة الشيكات%' OR name ILIKE '%أوراق قبض%')
    AND NOT (name ILIKE '%صندوق%')
  ORDER BY (account_tag = 'CHECKS_PORTFOLIO') DESC, (code = '1110') DESC
  LIMIT 1;

  IF v_portfolio_acc_id IS NULL THEN
    INSERT INTO public.accounts (store_id, code, name, type, normal_balance, is_active, is_system, balance, account_tag)
    VALUES (v_check.store_id, '1110', 'محفظة الشيكات الواردة (أوراق قبض)', 'asset', 'debit', TRUE, TRUE, 0, 'CHECKS_PORTFOLIO')
    RETURNING id INTO v_portfolio_acc_id;
  END IF;

  -- 2. حساب شيكات برسم التحصيل (CHECKS_UNDER_COLLECTION أو 1320)
  SELECT id INTO v_collection_acc_id
  FROM public.accounts
  WHERE store_id = v_check.store_id
    AND type = 'asset'
    AND is_group = FALSE
    AND (account_tag = 'CHECKS_UNDER_COLLECTION' OR code = '1320' OR name ILIKE '%شيكات برسم التحصيل%')
  ORDER BY (account_tag = 'CHECKS_UNDER_COLLECTION') DESC
  LIMIT 1;

  IF v_collection_acc_id IS NULL THEN
    INSERT INTO public.accounts (store_id, code, name, type, normal_balance, is_active, is_system, balance, account_tag)
    VALUES (v_check.store_id, '1320', 'شيكات برسم التحصيل', 'asset', 'debit', TRUE, TRUE, 0, 'CHECKS_UNDER_COLLECTION')
    RETURNING id INTO v_collection_acc_id;
  END IF;

  -- 3. حساب محفظة الشيكات المرتجعة (CHECKS_BOUNCED أو 1330)
  SELECT id INTO v_returned_acc_id
  FROM public.accounts
  WHERE store_id = v_check.store_id
    AND type = 'asset'
    AND is_group = FALSE
    AND (account_tag = 'CHECKS_BOUNCED' OR code = '1330' OR name ILIKE '%شيكات راجعة%' OR name ILIKE '%شيكات مرتجعة%')
  ORDER BY (account_tag = 'CHECKS_BOUNCED') DESC
  LIMIT 1;

  IF v_returned_acc_id IS NULL THEN
    INSERT INTO public.accounts (store_id, code, name, type, normal_balance, is_active, is_system, balance, account_tag)
    VALUES (v_check.store_id, '1330', 'محفظة الشيكات المرتجعة (شيكات راجعة ومرفوضة)', 'asset', 'debit', TRUE, TRUE, 0, 'CHECKS_BOUNCED')
    RETURNING id INTO v_returned_acc_id;
  END IF;

  -- 4. حساب ذمم العملاء (CUSTOMER_RECEIVABLE أو 1400)
  SELECT id INTO v_customer_acc_id
  FROM public.accounts
  WHERE store_id = v_check.store_id
    AND type = 'asset'
    AND is_group = FALSE
    AND (account_tag = 'CUSTOMER_RECEIVABLE' OR code = '1400' OR name ILIKE '%ذمم مدينة%' OR name ILIKE '%ذمم الزبائن%' OR name ILIKE '%ذمم العملاء%')
    AND NOT (name ILIKE '%صندوق%' OR name ILIKE '%بنك%' OR name ILIKE '%شيك%')
  ORDER BY (account_tag = 'CUSTOMER_RECEIVABLE') DESC
  LIMIT 1;

  IF v_customer_acc_id IS NULL THEN
    INSERT INTO public.accounts (store_id, code, name, type, normal_balance, is_active, is_system, balance, account_tag)
    VALUES (v_check.store_id, '1400', 'ذمم مدينة', 'asset', 'debit', TRUE, TRUE, 0, 'CUSTOMER_RECEIVABLE')
    RETURNING id INTO v_customer_acc_id;
  END IF;

  -- 5. حساب ذمم الموردين (SUPPLIER_PAYABLE أو 2100)
  SELECT id INTO v_supplier_acc_id
  FROM public.accounts
  WHERE store_id = v_check.store_id
    AND type = 'liability'
    AND is_group = FALSE
    AND (account_tag = 'SUPPLIER_PAYABLE' OR code = '2100' OR code = '2001' OR name ILIKE '%ذمم الموردين%')
  ORDER BY (account_tag = 'SUPPLIER_PAYABLE') DESC
  LIMIT 1;

  IF v_supplier_acc_id IS NULL THEN
    INSERT INTO public.accounts (store_id, code, name, type, normal_balance, is_active, is_system, balance, account_tag)
    VALUES (v_check.store_id, '2100', 'ذمم الموردين', 'liability', 'credit', TRUE, TRUE, 0, 'SUPPLIER_PAYABLE')
    RETURNING id INTO v_supplier_acc_id;
  END IF;

  -- د) معالجة نوع العملية وتحديد الأطراف المحاسبية والحالة القادمة
  IF p_op_type = 'deposit' THEN
    -- إيداع الشيك برسم التحصيل لدى البنك
    IF p_target_bank_id IS NULL THEN
      RAISE EXCEPTION 'يجب تحديد الحساب البنكي المراد إيداع الشيك برسم التحصيل لصالحه';
    END IF;

    v_next_status := 'deposited';
    v_debit_acc_id := v_collection_acc_id;
    v_credit_acc_id := v_portfolio_acc_id;
    v_op_desc := 'إيداع شيك رقم ' || v_check.check_number || ' برسم التحصيل لدى البنك';

  ELSIF p_op_type = 'collect' THEN
    -- تحصيل الشيك
    v_next_status := 'collected';

    -- إذا كان تحصيل نقدي في صندوق
    IF p_target_cashbox_id IS NOT NULL THEN
      SELECT account_id INTO v_cash_acc_id FROM public.cash_boxes WHERE id = p_target_cashbox_id;
      IF v_cash_acc_id IS NULL THEN
        SELECT id INTO v_cash_acc_id FROM public.accounts WHERE store_id = v_check.store_id AND (account_tag = 'CASH' OR code = '1001' OR code = '1100') ORDER BY (account_tag = 'CASH') DESC LIMIT 1;
      END IF;
      v_debit_acc_id := v_cash_acc_id;
      v_op_desc := 'تحصيل نقدي بالصندوق لشيك رقم ' || v_check.check_number;

      -- إضافة حركة خزينة نقدية فعلية بالصندوق
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
        v_check.store_id,
        p_target_cashbox_id,
        'in',
        v_amount,
        'check_collect',
        v_check.id,
        v_check.drawer_name,
        'cash',
        v_op_desc,
        p_date,
        p_actor_id
      );

    -- وإلا تحصيل في حساب بنكي
    ELSE
      IF p_target_bank_id IS NOT NULL THEN
        SELECT account_id INTO v_bank_acc_id FROM public.bank_accounts WHERE id = p_target_bank_id;
        UPDATE public.bank_accounts SET balance = balance + v_amount WHERE id = p_target_bank_id;
      END IF;

      IF v_bank_acc_id IS NULL THEN
        SELECT id INTO v_bank_acc_id FROM public.accounts WHERE store_id = v_check.store_id AND (account_tag = 'BANK' OR code = '1200' OR code = '1201') ORDER BY (account_tag = 'BANK') DESC LIMIT 1;
      END IF;

      v_debit_acc_id := v_bank_acc_id;
      v_op_desc := 'تحصيل بنكي وإيداع لشيك رقم ' || v_check.check_number;
    END IF;

    -- الطرف الدائن: إما شيكات برسم التحصيل إذا كان مودعاً مسبقاً، أو محفظة الشيكات مباشرة
    v_credit_acc_id := CASE WHEN v_check.status = 'deposited' THEN v_collection_acc_id ELSE v_portfolio_acc_id END;

  ELSIF p_op_type = 'endorse' THEN
    -- تجيير الشيك لمورد
    IF p_target_supplier_id IS NULL THEN
      RAISE EXCEPTION 'يجب تحديد المورد المراد تجيير الشيك لصالحه';
    END IF;

    v_next_status := 'endorsed';
    v_debit_acc_id := v_supplier_acc_id;
    v_credit_acc_id := v_portfolio_acc_id;
    v_op_desc := 'تجيير شيك رقم ' || v_check.check_number || ' لصالح المورد';

    -- تخفيض رصيد ذمة المورد
    UPDATE public.suppliers
    SET balance = balance - v_amount
    WHERE id = p_target_supplier_id;

  ELSIF p_op_type = 'bounce' THEN
    -- ارتداد الشيك ونقله إلى محفظة الشيكات المرتجعة
    v_next_status := 'bounced';
    v_debit_acc_id := v_returned_acc_id;
    v_credit_acc_id := CASE WHEN v_check.status = 'deposited' THEN v_collection_acc_id ELSE v_portfolio_acc_id END;
    v_op_desc := 'ارتداد شيك راجع رقم ' || v_check.check_number || ' ونقله إلى محفظة الشيكات المرتجعة';

  ELSIF p_op_type = 'return_to_customer' THEN
    -- إرجاع الشيك الراجع للعميل وإعادة قيد الذمة عليه
    v_next_status := 'returned_to_customer';
    v_debit_acc_id := v_customer_acc_id;
    v_credit_acc_id := v_returned_acc_id;
    v_op_desc := 'إرجاع شيك راجع رقم ' || v_check.check_number || ' إلى العميل وإعادة قيد الذمة';

    IF v_check.customer_id IS NOT NULL THEN
      UPDATE public.customers
      SET balance = balance + v_amount
      WHERE id = v_check.customer_id;

      INSERT INTO public.customer_ledger (
        store_id,
        customer_id,
        type,
        date,
        description,
        debit,
        credit,
        balance,
        reference_id,
        reference_type,
        created_by
      ) VALUES (
        v_check.store_id,
        v_check.customer_id,
        'refund',
        p_date,
        v_op_desc,
        v_amount,
        0,
        (SELECT balance FROM customers WHERE id = v_check.customer_id),
        v_check.id,
        'check',
        p_actor_id
      );
    END IF;

  ELSIF p_op_type = 'recollect' THEN
    -- إعادة استلام الشيك في محفظة الشيكات النشطة
    v_next_status := 'in_portfolio';
    v_debit_acc_id := v_portfolio_acc_id;
    v_credit_acc_id := v_returned_acc_id;
    v_op_desc := 'إعادة استلام وقبض شيك رقم ' || v_check.check_number || ' في محفظة الشيكات';

  ELSIF p_op_type = 'transfer_cashbox' THEN
    -- نقل الشيك إلى صندوق/فرع آخر
    IF p_target_cashbox_id IS NULL THEN
      RAISE EXCEPTION 'يجب تحديد الصندوق المحول إليه الشيك';
    END IF;
    v_next_status := v_check.status;
    v_op_desc := 'نقل شيك رقم ' || v_check.check_number || ' إلى صندوق/فرع آخر';

  ELSE
    RAISE EXCEPTION 'نوع العملية غير معروف: %', p_op_type;
  END IF;

  -- هـ) إنشاء القيد المحاسبي المزدوج المتوازن للعمليات المالية
  IF v_debit_acc_id IS NOT NULL AND v_credit_acc_id IS NOT NULL THEN
    v_entry_num := 'JV-CHK-' || TO_CHAR(p_date, 'YYYYMM') || '-' || LPAD(FLOOR(RANDOM() * 9000 + 1000)::text, 4, '0');

    INSERT INTO public.journal_entries (
      store_id,
      entry_number,
      date,
      description,
      source,
      ref_id,
      status,
      created_by
    ) VALUES (
      v_check.store_id,
      v_entry_num,
      p_date,
      v_op_desc || COALESCE(' — ' || NULLIF(TRIM(p_notes), ''), ''),
      'check_op',
      v_check.id,
      'posted',
      p_actor_id
    ) RETURNING id INTO v_entry_id;

    -- السطر المدين
    INSERT INTO public.journal_lines (
      journal_entry_id,
      account_id,
      debit,
      credit,
      currency,
      exchange_rate,
      description,
      sort_order
    ) VALUES (
      v_entry_id,
      v_debit_acc_id,
      v_amount,
      0,
      v_currency,
      v_rate,
      v_op_desc,
      1
    );

    -- السطر الدائن
    INSERT INTO public.journal_lines (
      journal_entry_id,
      account_id,
      debit,
      credit,
      currency,
      exchange_rate,
      description,
      sort_order
    ) VALUES (
      v_entry_id,
      v_credit_acc_id,
      0,
      v_amount,
      v_currency,
      v_rate,
      v_op_desc,
      2
    );

    -- تحديث أرصدة الحسابات بدقة
    UPDATE public.accounts
    SET balance = balance + (CASE WHEN normal_balance = 'credit' THEN -v_amount ELSE v_amount END),
        updated_at = NOW()
    WHERE id = v_debit_acc_id;

    UPDATE public.accounts
    SET balance = balance + (CASE WHEN normal_balance = 'credit' THEN v_amount ELSE -v_amount END),
        updated_at = NOW()
    WHERE id = v_credit_acc_id;
  END IF;

  -- و) توثيق الحركة في check_operations
  INSERT INTO public.check_operations (
    store_id,
    check_id,
    operation_type,
    from_status,
    to_status,
    operation_date,
    target_bank_account_id,
    target_supplier_id,
    target_cashbox_id,
    journal_entry_id,
    notes,
    performed_by
  ) VALUES (
    v_check.store_id,
    v_check.id,
    p_op_type,
    v_check.status,
    v_next_status,
    p_date,
    p_target_bank_id,
    p_target_supplier_id,
    p_target_cashbox_id,
    v_entry_id,
    COALESCE(NULLIF(TRIM(p_notes), ''), v_op_desc),
    p_actor_id
  );

  -- ز) تحديث سجل الشيك الأصلي
  UPDATE public.checks
  SET
    status = v_next_status,
    deposit_bank_account_id = COALESCE(p_target_bank_id, deposit_bank_account_id),
    endorsed_supplier_id = COALESCE(p_target_supplier_id, endorsed_supplier_id),
    cashbox_id = COALESCE(p_target_cashbox_id, cashbox_id),
    updated_at = NOW()
  WHERE id = v_check.id;

  RETURN jsonb_build_object(
    'success', TRUE,
    'check_id', v_check.id,
    'check_number', v_check.check_number,
    'operation_type', p_op_type,
    'new_status', v_next_status,
    'journal_entry_id', v_entry_id,
    'amount', v_amount
  );
END;
$function$;
