SET search_path = public;

-- ─────────────────────────────────────────────────────
-- العروض الحصرية — Flash Sales / Offers
-- ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS offers (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id    UUID        NOT NULL REFERENCES stores(id) ON DELETE CASCADE,

  title       TEXT        NOT NULL,
  description TEXT,
  banner_url  TEXT,

  starts_at   TIMESTAMPTZ NOT NULL,
  ends_at     TIMESTAMPTZ NOT NULL,
  is_active   BOOLEAN     NOT NULL DEFAULT true,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CHECK (ends_at > starts_at)
);

CREATE TABLE IF NOT EXISTS offer_items (
  id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id    UUID          NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  product_id  UUID          NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  offer_price NUMERIC(12,2) NOT NULL CHECK (offer_price >= 0),
  UNIQUE(offer_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_offers_store       ON offers(store_id);
CREATE INDEX IF NOT EXISTS idx_offers_active      ON offers(store_id, is_active, ends_at);
CREATE INDEX IF NOT EXISTS idx_offer_items_offer  ON offer_items(offer_id);

-- ─────────────────────────────────────────────────────
-- RLS
-- ─────────────────────────────────────────────────────

ALTER TABLE offers      ENABLE ROW LEVEL SECURITY;
ALTER TABLE offer_items ENABLE ROW LEVEL SECURITY;

-- التاجر: صلاحية كاملة
CREATE POLICY "store_members_manage_offers"
  ON offers FOR ALL TO authenticated
  USING  (is_store_member(store_id))
  WITH CHECK (is_store_member(store_id));

CREATE POLICY "store_members_manage_offer_items"
  ON offer_items FOR ALL TO authenticated
  USING  (EXISTS (SELECT 1 FROM offers o WHERE o.id = offer_id AND is_store_member(o.store_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM offers o WHERE o.id = offer_id AND is_store_member(o.store_id)));

-- الزبون: قراءة العروض الفعّالة فقط (الـ storefront بدون auth)
CREATE POLICY "offers_public_read"
  ON offers FOR SELECT TO public
  USING (is_active = true);

CREATE POLICY "offer_items_public_read"
  ON offer_items FOR SELECT TO public
  USING (EXISTS (SELECT 1 FROM offers o WHERE o.id = offer_id AND o.is_active = true));
