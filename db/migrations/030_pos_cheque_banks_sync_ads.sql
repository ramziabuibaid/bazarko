-- ==============================================================================
-- Migration 030: POS Receipt, Cheque & Bank Links, Inventory Sync & Ads
-- ==============================================================================
SET search_path = public;

-- ─────────────────────────────────────────────────────────────
-- 1. حقول تخصيص إيصال نقطة البيع في جدول stores
-- ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'stores' AND column_name = 'pos_receipt_header'
  ) THEN
    ALTER TABLE public.stores ADD COLUMN pos_receipt_header TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'stores' AND column_name = 'pos_receipt_footer'
  ) THEN
    ALTER TABLE public.stores ADD COLUMN pos_receipt_footer TEXT DEFAULT 'شكراً لتعاملكم معنا، البضاعة المباعة تستبدل خلال 3 أيام بشرط وجود الفاتورة الأصلية';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'stores' AND column_name = 'api_sync_key'
  ) THEN
    ALTER TABLE public.stores ADD COLUMN api_sync_key TEXT;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────
-- 2. ربط سندات القبض والصرف بحسابات بنوك الشركة
-- ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'vouchers' AND column_name = 'bank_account_id'
  ) THEN
    ALTER TABLE public.vouchers ADD COLUMN bank_account_id UUID REFERENCES public.bank_accounts(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────
-- 3. جدول حملات وإعلانات واتساب (WhatsApp Ads Campaigns)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ads_campaigns (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id         UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  title            TEXT NOT NULL,
  message_template TEXT NOT NULL,
  product_id       UUID REFERENCES public.products(id) ON DELETE SET NULL,
  offer_id         UUID REFERENCES public.offers(id) ON DELETE SET NULL,
  image_url        TEXT,
  action_url       TEXT,
  discount_badge   TEXT,
  price            NUMERIC(14,2),
  compare_price    NUMERIC(14,2),
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'draft', 'archived')),
  total_sent       INTEGER NOT NULL DEFAULT 0,
  last_sent_at     TIMESTAMPTZ,
  created_by       UUID REFERENCES auth.users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ads_campaigns_store ON public.ads_campaigns(store_id);

ALTER TABLE public.ads_campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "store members can manage ads campaigns"
  ON public.ads_campaigns
  FOR ALL
  USING (is_store_member(store_id));

-- ─────────────────────────────────────────────────────────────
-- 4. جدول سجل مزامنة المخزون مع النظام الرئيسي (Inventory Sync Logs)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.inventory_sync_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id        UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  source          TEXT NOT NULL DEFAULT 'api', -- 'api' | 'excel' | 'webhook'
  status          TEXT NOT NULL DEFAULT 'success' CHECK (status IN ('success', 'failed', 'partial')),
  items_processed INTEGER NOT NULL DEFAULT 0,
  items_updated   INTEGER NOT NULL DEFAULT 0,
  items_created   INTEGER NOT NULL DEFAULT 0,
  errors          JSONB NOT NULL DEFAULT '[]'::jsonb,
  details         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inventory_sync_logs_store ON public.inventory_sync_logs(store_id, created_at DESC);

ALTER TABLE public.inventory_sync_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "store members can view sync logs"
  ON public.inventory_sync_logs
  FOR ALL
  USING (is_store_member(store_id));
