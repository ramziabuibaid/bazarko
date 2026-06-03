SET search_path = public;

-- حقول التوصيل في جدول stores
ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS delivery_enabled        BOOLEAN        NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS free_delivery_threshold NUMERIC(10,2);

-- جدول مناطق التوصيل
CREATE TABLE IF NOT EXISTS delivery_zones (
  id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id       UUID          NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name           TEXT          NOT NULL,
  cost           NUMERIC(10,2) NOT NULL DEFAULT 0,
  is_active      BOOLEAN       NOT NULL DEFAULT true,
  estimated_days TEXT,
  sort_order     INTEGER       NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

ALTER TABLE delivery_zones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "store_members_manage_delivery_zones"
  ON delivery_zones FOR ALL TO authenticated
  USING  (is_store_member(store_id))
  WITH CHECK (is_store_member(store_id));

CREATE INDEX IF NOT EXISTS delivery_zones_store_id_idx ON delivery_zones(store_id);
