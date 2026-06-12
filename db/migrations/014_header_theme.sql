SET search_path = public;

-- ─────────────────────────────────────────────────────
-- ثيم هيدر المتجر — يختاره التاجر من الإعدادات
-- ليكون شكل كل متجر فريداً وليس نسخاً متطابقة
-- ─────────────────────────────────────────────────────

ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS header_theme TEXT NOT NULL DEFAULT 'classic'
  CHECK (header_theme IN ('classic', 'ocean', 'sunset', 'emerald', 'royal', 'midnight'));
