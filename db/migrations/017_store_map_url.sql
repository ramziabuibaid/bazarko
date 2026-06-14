-- 017: رابط الخريطة للمتجر
SET search_path = public;

ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS map_url TEXT;
