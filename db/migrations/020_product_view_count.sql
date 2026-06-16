SET search_path = public;

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS view_count INTEGER NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION increment_product_views(p_product_id UUID)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE products SET view_count = view_count + 1 WHERE id = p_product_id;
$$;

GRANT EXECUTE ON FUNCTION increment_product_views(UUID) TO anon, authenticated;
