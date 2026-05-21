-- إضافة حقول اسم وهاتف الزبون مباشرةً في الطلبية
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS customer_name  TEXT,
  ADD COLUMN IF NOT EXISTS customer_phone TEXT;
