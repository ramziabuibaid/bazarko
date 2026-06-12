SET search_path = public;

-- إضافة حقل إعدادات الـ Footer للمتاجر
ALTER TABLE stores ADD COLUMN IF NOT EXISTS footer_settings JSONB DEFAULT '{
  "tagline": "",
  "show_contact": true,
  "show_social": true,
  "show_hours": true,
  "show_powered_by": true,
  "copyright": ""
}'::jsonb;
