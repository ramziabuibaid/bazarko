SET search_path = public;

-- إضافة حقل رابط حساب التواصل الاجتماعي للزبون (إنستغرام أو فيسبوك)
ALTER TABLE customers ADD COLUMN IF NOT EXISTS social_url TEXT;
