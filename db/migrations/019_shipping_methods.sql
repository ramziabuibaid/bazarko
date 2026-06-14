SET search_path = public;

-- ── أنواع الشحن لكل منطقة توصيل ─────────────────────────────
CREATE TABLE IF NOT EXISTS shipping_methods (
  id         uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_id    uuid          NOT NULL REFERENCES delivery_zones(id) ON DELETE CASCADE,
  store_id   uuid          NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name       text          NOT NULL,            -- "توصيل عادي" / "توصيل سريع"
  cost       NUMERIC(10,2) NOT NULL DEFAULT 0,
  min_days   smallint,
  max_days   smallint,
  is_active  boolean       NOT NULL DEFAULT true,
  sort_order smallint      NOT NULL DEFAULT 0,
  created_at timestamptz   NOT NULL DEFAULT NOW()
);

ALTER TABLE shipping_methods ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members_manage_shipping_methods"
  ON shipping_methods FOR ALL TO authenticated
  USING  (is_store_member(store_id))
  WITH CHECK (is_store_member(store_id));

-- الزبون يقرأ الأنواع المتاحة في Checkout (بدون login)
CREATE POLICY "public_read_active_shipping_methods"
  ON shipping_methods FOR SELECT TO anon
  USING (is_active = true);

CREATE INDEX IF NOT EXISTS shipping_methods_zone_idx  ON shipping_methods(zone_id);
CREATE INDEX IF NOT EXISTS shipping_methods_store_idx ON shipping_methods(store_id);

-- ── قراءة عامة لمناطق التوصيل في Checkout ───────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'delivery_zones'
      AND policyname = 'public_read_active_delivery_zones'
  ) THEN
    EXECUTE $p$
      CREATE POLICY "public_read_active_delivery_zones"
        ON delivery_zones FOR SELECT TO anon
        USING (is_active = true)
    $p$;
  END IF;
END $$;

-- ── حقول الشحن في جدول orders ────────────────────────────────
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS shipping_zone_id     uuid          REFERENCES delivery_zones(id),
  ADD COLUMN IF NOT EXISTS shipping_method_id   uuid,
  ADD COLUMN IF NOT EXISTS shipping_cost        NUMERIC(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS shipping_zone_name   text,
  ADD COLUMN IF NOT EXISTS shipping_method_name text;
