-- ==========================================
-- Migration 027: تقييمات المنتجات (Product Reviews)
-- نجوم 1..5 + تعليق + صور من العملاء + مراجعة/اعتماد من التاجر
-- ==========================================
SET search_path = public;

-- ─────────────────────────────────────────────────
-- 1. جدول التقييمات
-- ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.product_reviews (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id      UUID        NOT NULL REFERENCES public.stores(id)   ON DELETE CASCADE,
  product_id    UUID        NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  order_id      UUID        REFERENCES public.orders(id) ON DELETE SET NULL,
  customer_name TEXT        NOT NULL,
  rating        SMALLINT    NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment       TEXT,
  photos        TEXT[]      NOT NULL DEFAULT '{}',
  status        TEXT        NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','approved','rejected')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_product_reviews_product ON public.product_reviews(product_id, status);
CREATE INDEX IF NOT EXISTS idx_product_reviews_store   ON public.product_reviews(store_id, status);

-- ─────────────────────────────────────────────────
-- 2. RLS
--   • الزبون (anon): يقرأ المعتمد فقط + يضيف تقييماً بحالة pending
--   • التاجر: إدارة كاملة عبر is_store_member
-- ─────────────────────────────────────────────────
ALTER TABLE public.product_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public_read_approved_reviews" ON public.product_reviews;
CREATE POLICY "public_read_approved_reviews" ON public.product_reviews
  FOR SELECT USING (status = 'approved');

DROP POLICY IF EXISTS "public_insert_reviews" ON public.product_reviews;
CREATE POLICY "public_insert_reviews" ON public.product_reviews
  FOR INSERT WITH CHECK (status = 'pending');

DROP POLICY IF EXISTS "store_member_reviews" ON public.product_reviews;
CREATE POLICY "store_member_reviews" ON public.product_reviews
  FOR ALL USING (is_store_member(store_id));

-- ─────────────────────────────────────────────────
-- 3. Storage — bucket عام لصور تقييمات العملاء
--   (الزبون غير مسجّل، لذلك يحتاج صلاحية رفع عامة منفصلة عن product-images)
-- ─────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('review-photos', 'review-photos', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "public can upload review photos" ON storage.objects;
CREATE POLICY "public can upload review photos"
ON storage.objects FOR INSERT TO public
WITH CHECK (bucket_id = 'review-photos');

DROP POLICY IF EXISTS "public can read review photos" ON storage.objects;
CREATE POLICY "public can read review photos"
ON storage.objects FOR SELECT TO public
USING (bucket_id = 'review-photos');
