BEGIN;

-- 1. Helper function to extract store_id from object name
CREATE OR REPLACE FUNCTION public.get_store_id_from_storage_path(p_name text)
RETURNS uuid LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  parts text[] := storage.foldername(p_name);
  cand text;
BEGIN
  IF parts IS NULL OR array_length(parts, 1) < 1 THEN
    RETURN NULL;
  END IF;

  IF parts[1] = 'stores' THEN
    IF array_length(parts, 1) >= 2 THEN
      cand := parts[2];
    ELSE
      RETURN NULL;
    END IF;
  ELSE
    cand := parts[1];
  END IF;

  IF cand ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN cand::uuid;
  END IF;

  RETURN NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_store_id_from_storage_path(text) TO authenticated, anon;

-- 2. Helper to verify store access for storage operations
CREATE OR REPLACE FUNCTION public.can_manage_store_storage(p_name text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE
  sid uuid := public.get_store_id_from_storage_path(p_name);
BEGIN
  IF sid IS NULL THEN
    RETURN FALSE;
  END IF;

  RETURN public.is_store_member(sid) OR EXISTS (
    SELECT 1 FROM public.stores WHERE id = sid AND owner_id = auth.uid()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.can_manage_store_storage(text) TO authenticated, anon;

-- 3. Policy on storage.buckets so clients can inspect public buckets
DROP POLICY IF EXISTS "public_read_buckets" ON storage.buckets;
CREATE POLICY "public_read_buckets"
ON storage.buckets FOR SELECT TO public
USING (true);

-- 4. Storage policies for storage.objects
DROP POLICY IF EXISTS "public_read_public_buckets" ON storage.objects;
DROP POLICY IF EXISTS "public_read_public_objects" ON storage.objects;
DROP POLICY IF EXISTS "store_member_upload_product_images" ON storage.objects;
DROP POLICY IF EXISTS "store_member_update_product_images" ON storage.objects;
DROP POLICY IF EXISTS "store_member_delete_product_images" ON storage.objects;
DROP POLICY IF EXISTS "public_upload_review_photos" ON storage.objects;
DROP POLICY IF EXISTS "authenticated_upload_checks" ON storage.objects;
DROP POLICY IF EXISTS "authenticated_delete_checks" ON storage.objects;

-- Read: Public objects are readable by everyone
CREATE POLICY "public_read_public_objects"
ON storage.objects FOR SELECT TO public
USING (
  bucket_id IN ('product-images', 'review-photos', 'checks')
);

-- Insert for product-images: Member/owner of the store only
CREATE POLICY "store_member_upload_product_images"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'product-images'
  AND public.can_manage_store_storage(name)
);

-- Update for product-images (Required for upsert: true): Member/owner of the store only
CREATE POLICY "store_member_update_product_images"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'product-images'
  AND public.can_manage_store_storage(name)
)
WITH CHECK (
  bucket_id = 'product-images'
  AND public.can_manage_store_storage(name)
);

-- Delete for product-images: Member/owner of the store only
CREATE POLICY "store_member_delete_product_images"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'product-images'
  AND public.can_manage_store_storage(name)
);

-- Review photos: public upload (customers)
CREATE POLICY "public_upload_review_photos"
ON storage.objects FOR INSERT TO public
WITH CHECK (bucket_id = 'review-photos');

-- Checks: authenticated upload and delete
CREATE POLICY "authenticated_upload_checks"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'checks');

CREATE POLICY "authenticated_delete_checks"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'checks');

COMMIT;
