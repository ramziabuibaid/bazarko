-- Migration 066: Support dual WhatsApp country prefixes (+972 and +970) and preference persistence

ALTER TABLE public.customers
ADD COLUMN IF NOT EXISTS whatsapp_prefix TEXT DEFAULT NULL;

CREATE TABLE IF NOT EXISTS public.phone_whatsapp_preferences (
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  phone_clean TEXT NOT NULL,
  preferred_prefix TEXT NOT NULL CHECK (preferred_prefix IN ('972', '970')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (store_id, phone_clean)
);

CREATE INDEX IF NOT EXISTS idx_phone_whatsapp_pref ON public.phone_whatsapp_preferences (store_id, phone_clean);

ALTER TABLE public.phone_whatsapp_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "phone_whatsapp_pref_policy" ON public.phone_whatsapp_preferences;
CREATE POLICY "phone_whatsapp_pref_policy" ON public.phone_whatsapp_preferences
  FOR ALL TO authenticated
  USING (is_store_member(store_id))
  WITH CHECK (is_store_member(store_id));
