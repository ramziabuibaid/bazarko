-- إضافة حقل إيميل الزبون للطلبية
-- مطلوب لإرسال فاتورة بالبريد الإلكتروني لكل طلبية
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS customer_email TEXT;
