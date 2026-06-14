-- 016: سعر ثانوي يدوي للمنتج + خيار تفضيل عملة الأساسية
-- يُشغَّل في Supabase SQL Editor
SET search_path = public;

-- سعر يدوي اختياري للمنتج بالعملة الثانية
-- إن لم يُملأ يُحسب تلقائياً: price × exchange_rate
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS price_secondary DECIMAL(12,2);

-- عندما يُفعَّل، يُعرض سعر العملة الثانية أولاً (أكبر) والسعر الأصلي ثانياً (أصغر)
ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS prefer_secondary BOOLEAN NOT NULL DEFAULT false;
