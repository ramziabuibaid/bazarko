SET search_path = public;

-- جدول أحداث تحليلات المتجر
CREATE TABLE IF NOT EXISTS store_analytics (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id    uuid        NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  visitor_id  text        NOT NULL,   -- UUID ثابت في localStorage (يعرّف الزائر عبر الجلسات)
  session_id  text        NOT NULL,   -- UUID في sessionStorage (جلسة واحدة = نافذة واحدة)
  event_type  text        NOT NULL,   -- store_visit | product_view | add_to_cart | add_to_wishlist | search | checkout_start
  product_id  uuid        REFERENCES products(id) ON DELETE SET NULL,
  category_id uuid        REFERENCES categories(id) ON DELETE SET NULL,
  search_query text,
  page_path   text,
  is_mobile   boolean     NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_store_analytics_store_id    ON store_analytics(store_id);
CREATE INDEX IF NOT EXISTS idx_store_analytics_created_at  ON store_analytics(created_at);
CREATE INDEX IF NOT EXISTS idx_store_analytics_visitor_id  ON store_analytics(visitor_id);
CREATE INDEX IF NOT EXISTS idx_store_analytics_event_type  ON store_analytics(event_type);
CREATE INDEX IF NOT EXISTS idx_store_analytics_store_event ON store_analytics(store_id, event_type, created_at);

ALTER TABLE store_analytics ENABLE ROW LEVEL SECURITY;

-- الزوار (anon) يستطيعون الإدراج فقط
CREATE POLICY "anyone can insert analytics" ON store_analytics
  FOR INSERT TO anon, authenticated
  WITH CHECK (true);

-- أصحاب المتاجر يستطيعون القراءة فقط
CREATE POLICY "store members can read analytics" ON store_analytics
  FOR SELECT USING (is_store_member(store_id));

-- دالة RPC لتسجيل الأحداث (SECURITY DEFINER لضمان عمل الـ anon INSERT)
CREATE OR REPLACE FUNCTION track_store_event(
  p_store_id    uuid,
  p_visitor_id  text,
  p_session_id  text,
  p_event_type  text,
  p_product_id  uuid    DEFAULT NULL,
  p_category_id uuid    DEFAULT NULL,
  p_search_query text   DEFAULT NULL,
  p_page_path   text    DEFAULT NULL,
  p_is_mobile   boolean DEFAULT false
) RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO store_analytics(
    store_id, visitor_id, session_id, event_type,
    product_id, category_id, search_query, page_path, is_mobile
  ) VALUES (
    p_store_id, p_visitor_id, p_session_id, p_event_type,
    p_product_id, p_category_id, p_search_query, p_page_path, p_is_mobile
  );
$$;

GRANT EXECUTE ON FUNCTION track_store_event(uuid, text, text, text, uuid, uuid, text, text, boolean)
  TO anon, authenticated;
