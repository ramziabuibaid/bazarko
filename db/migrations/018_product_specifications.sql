-- إضافة عمود المواصفات الفنية للمنتجات (مصفوفة JSON من {name, value})
SET search_path = public;

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS specifications JSONB DEFAULT '[]';

COMMENT ON COLUMN products.specifications IS 'مواصفات فنية مخصصة: [{name: "اللون", value: "أبيض"}, ...]';
