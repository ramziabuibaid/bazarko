SET search_path = public;

-- ─────────────────────────────────────────────────────
-- تحسينات العروض الحصرية:
-- مخزون مخصص للعرض + حد لكل زبون + عداد مشاهدات
-- ─────────────────────────────────────────────────────

ALTER TABLE offers
  ADD COLUMN IF NOT EXISTS per_customer_limit INTEGER CHECK (per_customer_limit IS NULL OR per_customer_limit > 0),
  ADD COLUMN IF NOT EXISTS view_count         INTEGER NOT NULL DEFAULT 0;

ALTER TABLE offer_items
  ADD COLUMN IF NOT EXISTS max_quantity  INTEGER CHECK (max_quantity IS NULL OR max_quantity > 0),
  ADD COLUMN IF NOT EXISTS sold_quantity INTEGER NOT NULL DEFAULT 0;

-- ─────────────────────────────────────────────────────
-- عداد المشاهدات — يُستدعى من صفحة العرض العامة بدون auth
-- SECURITY DEFINER لأن الزائر anon لا يملك UPDATE على offers
-- ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION increment_offer_views(p_offer_id UUID)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE offers SET view_count = view_count + 1
  WHERE id = p_offer_id AND is_active = true;
$$;

GRANT EXECUTE ON FUNCTION increment_offer_views(UUID) TO anon, authenticated;

-- ─────────────────────────────────────────────────────
-- تسجيل مبيعات العرض — يُستدعى من checkout بعد إنشاء الطلبية
-- يزيد sold_quantity فقط للعروض الجارية حالياً
-- ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION record_offer_sale(p_store_id UUID, p_product_id UUID, p_qty INTEGER)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE offer_items oi
  SET sold_quantity = oi.sold_quantity + GREATEST(p_qty, 0)
  FROM offers o
  WHERE o.id = oi.offer_id
    AND o.store_id = p_store_id
    AND oi.product_id = p_product_id
    AND o.is_active = true
    AND NOW() BETWEEN o.starts_at AND o.ends_at;
$$;

GRANT EXECUTE ON FUNCTION record_offer_sale(UUID, UUID, INTEGER) TO anon, authenticated;
