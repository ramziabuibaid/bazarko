-- 015: إضافة status للمنتجات (active / draft / hidden / archived)
-- يُشغَّل في Supabase SQL Editor
SET search_path = public;

-- 1. إضافة عمود status
ALTER TABLE products
  ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
  CHECK (status IN ('active', 'draft', 'hidden', 'archived'));

-- 2. ترحيل البيانات الحالية
UPDATE products
  SET status = CASE WHEN is_active THEN 'active' ELSE 'draft' END;

-- 3. حذف الـ policies التي تعتمد على is_active
DROP POLICY IF EXISTS products_public_read ON products;

-- 4. حذف is_active الأصلي وإعادته كعمود محسوب
--    بذلك تستمر queries الواجهة الأمامية (.eq('is_active', true)) بدون أي تعديل
ALTER TABLE products DROP COLUMN is_active;

ALTER TABLE products
  ADD COLUMN is_active BOOLEAN GENERATED ALWAYS AS (status = 'active') STORED;

-- 5. إعادة إنشاء الـ policy على العمود الجديد المحسوب
CREATE POLICY products_public_read ON products
  FOR SELECT TO public
  USING (is_active = true);

-- 6. فهرس للفلترة السريعة
CREATE INDEX IF NOT EXISTS idx_products_status ON products(store_id, status);
