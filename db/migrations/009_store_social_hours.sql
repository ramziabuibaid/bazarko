-- 009_store_social_hours.sql
-- وسائل التواصل الاجتماعي + ساعات العمل + شارة التوثيق
SET search_path = public;

-- وسائل التواصل الاجتماعي
ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS instagram    TEXT,
  ADD COLUMN IF NOT EXISTS facebook     TEXT,
  ADD COLUMN IF NOT EXISTS tiktok       TEXT,
  ADD COLUMN IF NOT EXISTS telegram     TEXT;

-- ساعات العمل الأسبوعية (JSONB)
ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS business_hours JSONB DEFAULT '{
    "sat": {"open": true,  "from": "09:00", "to": "22:00"},
    "sun": {"open": true,  "from": "09:00", "to": "22:00"},
    "mon": {"open": true,  "from": "09:00", "to": "22:00"},
    "tue": {"open": true,  "from": "09:00", "to": "22:00"},
    "wed": {"open": true,  "from": "09:00", "to": "22:00"},
    "thu": {"open": true,  "from": "09:00", "to": "22:00"},
    "fri": {"open": false, "from": "09:00", "to": "22:00"}
  }'::jsonb;

-- شارة التوثيق — يُعيّنها المشرف فقط عبر لوحة الأدمن
ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT false;
