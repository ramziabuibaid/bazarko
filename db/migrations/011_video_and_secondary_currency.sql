-- ───────────────────────────────────────────────────────────────
-- Migration 011 — فيديو المنتج + العملة الثانوية
-- ───────────────────────────────────────────────────────────────
SET search_path = public;

-- رابط فيديو اختياري لكل منتج (TikTok / YouTube / Reels)
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS video_url TEXT;

-- العملة الثانوية لعرض الأسعار المزدوجة في المتجر
ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS secondary_currency_code TEXT,
  ADD COLUMN IF NOT EXISTS exchange_rate DECIMAL(12,4);
