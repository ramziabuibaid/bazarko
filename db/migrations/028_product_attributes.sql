-- ==========================================
-- Migration 028: خصائص المنتجات المرنة + الفلترة
-- التاجر يعرّف خصائص (لون/مادة/غرفة...) وقيمها، ويسندها للمنتجات.
-- الفلاتر في المتجر تُبنى تلقائياً من هذه البيانات.
-- ==========================================
SET search_path = public;

-- ─────────────────────────────────────────────────
-- 1. تعريف الخاصية (مثل: اللون)
-- ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.product_attributes (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id    UUID        NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  sort_order  INTEGER     NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_product_attributes_store ON public.product_attributes(store_id, sort_order);

-- ─────────────────────────────────────────────────
-- 2. قيم الخاصية (مثل: أحمر، أزرق)
-- ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.product_attribute_values (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  attribute_id UUID        NOT NULL REFERENCES public.product_attributes(id) ON DELETE CASCADE,
  store_id     UUID        NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  value        TEXT        NOT NULL,
  sort_order   INTEGER     NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_attr_values_attribute ON public.product_attribute_values(attribute_id, sort_order);

-- ─────────────────────────────────────────────────
-- 3. ربط المنتج بقيمة (منتج قد يحمل عدة قيم لنفس الخاصية)
-- ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.product_attribute_links (
  product_id UUID NOT NULL REFERENCES public.products(id)                 ON DELETE CASCADE,
  value_id   UUID NOT NULL REFERENCES public.product_attribute_values(id) ON DELETE CASCADE,
  store_id   UUID NOT NULL REFERENCES public.stores(id)                   ON DELETE CASCADE,
  PRIMARY KEY (product_id, value_id)
);
CREATE INDEX IF NOT EXISTS idx_attr_links_value   ON public.product_attribute_links(value_id);
CREATE INDEX IF NOT EXISTS idx_attr_links_product ON public.product_attribute_links(product_id);

-- ─────────────────────────────────────────────────
-- 4. RLS — التاجر إدارة كاملة، والزبون قراءة فقط (لبناء الفلاتر)
-- ─────────────────────────────────────────────────
ALTER TABLE public.product_attributes        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_attribute_values  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_attribute_links   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "attr_public_read"   ON public.product_attributes;
DROP POLICY IF EXISTS "attr_member_all"    ON public.product_attributes;
CREATE POLICY "attr_public_read" ON public.product_attributes FOR SELECT USING (true);
CREATE POLICY "attr_member_all"  ON public.product_attributes FOR ALL    USING (is_store_member(store_id));

DROP POLICY IF EXISTS "attrval_public_read" ON public.product_attribute_values;
DROP POLICY IF EXISTS "attrval_member_all"  ON public.product_attribute_values;
CREATE POLICY "attrval_public_read" ON public.product_attribute_values FOR SELECT USING (true);
CREATE POLICY "attrval_member_all"  ON public.product_attribute_values FOR ALL    USING (is_store_member(store_id));

DROP POLICY IF EXISTS "attrlink_public_read" ON public.product_attribute_links;
DROP POLICY IF EXISTS "attrlink_member_all"  ON public.product_attribute_links;
CREATE POLICY "attrlink_public_read" ON public.product_attribute_links FOR SELECT USING (true);
CREATE POLICY "attrlink_member_all"  ON public.product_attribute_links FOR ALL    USING (is_store_member(store_id));
