-- Migration 007: Public read access for active stores and products
-- Required for storefront to work for unauthenticated visitors
-- and for subdomain routing in middleware

SET search_path = public;

-- Allow anyone to read active stores (for storefront + marketplace + middleware subdomain lookup)
CREATE POLICY "stores_public_read" ON stores
  FOR SELECT TO public
  USING (is_active = true);

-- Allow anyone to read active products of active stores (for storefront + marketplace)
-- Note: products already likely has a public policy, but ensure it exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'products' AND policyname = 'products_public_read'
  ) THEN
    EXECUTE '
      CREATE POLICY "products_public_read" ON products
        FOR SELECT TO public
        USING (is_active = true)
    ';
  END IF;
END $$;

-- Allow anyone to read active categories (for storefront filters)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'categories' AND policyname = 'categories_public_read'
  ) THEN
    EXECUTE '
      CREATE POLICY "categories_public_read" ON categories
        FOR SELECT TO public
        USING (is_active = true)
    ';
  END IF;
END $$;
