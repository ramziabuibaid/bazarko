BEGIN;
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('receipt-attachments','receipt-attachments',false,5242880,ARRAY['application/pdf','image/jpeg','image/png','image/webp'])
ON CONFLICT(id) DO UPDATE SET public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
-- Restrictive policies prevent broad legacy policies from exposing this bucket.
DROP POLICY IF EXISTS receipt_files_server_only ON storage.objects;
CREATE POLICY receipt_files_server_only ON storage.objects AS RESTRICTIVE FOR ALL TO anon,authenticated
USING(bucket_id<>'receipt-attachments') WITH CHECK(bucket_id<>'receipt-attachments');
CREATE TABLE IF NOT EXISTS public.receipt_attachments(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 store_id uuid NOT NULL REFERENCES public.stores(id),
 voucher_id uuid NOT NULL REFERENCES public.vouchers(id),
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 filename text NOT NULL CHECK(length(filename) BETWEEN 1 AND 200 AND filename !~ '[[:cntrl:]/\\]'),
 bytes integer NOT NULL CHECK(bytes BETWEEN 1 AND 5242880),
 content_type text NOT NULL CHECK(content_type IN ('application/pdf','image/jpeg','image/png','image/webp')),
 object_path text NOT NULL UNIQUE,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','ready')),
 created_by uuid NOT NULL REFERENCES auth.users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 ready_at timestamptz,
 UNIQUE(voucher_id,sha256),
 CHECK(object_path=store_id::text||'/'||voucher_id::text||'/'||sha256),
 CHECK((status='ready')=(ready_at IS NOT NULL))
);
ALTER TABLE public.receipt_attachments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.receipt_attachments FROM anon,authenticated;
GRANT SELECT ON public.receipt_attachments TO authenticated;
GRANT ALL ON public.receipt_attachments TO service_role;
DROP POLICY IF EXISTS receipt_files_managers_read ON public.receipt_attachments;
CREATE POLICY receipt_files_managers_read ON public.receipt_attachments FOR SELECT TO authenticated USING(public.can_manage_cash_permissions(store_id));
CREATE OR REPLACE FUNCTION public.reserve_receipt_attachment(p_store_id uuid,p_voucher_id uuid,p_sha256 text,p_filename text,p_bytes integer,p_content_type text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE result public.receipt_attachments; total bigint; count_files integer;
BEGIN
 IF auth.uid() IS NULL OR NOT public.can_manage_cash_permissions(p_store_id) THEN RAISE EXCEPTION 'مرفقات القبض متاحة للمالك والمدير النشط فقط'; END IF;
 IF p_sha256 IS NULL OR p_sha256 !~ '^[a-f0-9]{64}$' OR p_filename IS NULL OR length(p_filename) NOT BETWEEN 1 AND 200 OR p_filename ~ '[[:cntrl:]/\\]' OR p_bytes IS NULL OR p_bytes NOT BETWEEN 1 AND 5242880 OR p_content_type IS NULL OR p_content_type NOT IN ('application/pdf','image/jpeg','image/png','image/webp') THEN RAISE EXCEPTION 'بيانات المرفق غير صحيحة';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_voucher_id::text,61001));
 IF NOT EXISTS(SELECT 1 FROM public.vouchers WHERE id=p_voucher_id AND store_id=p_store_id AND type='receipt' AND payment_method='bank' AND creation_request_id IS NOT NULL AND bank_account_id IS NOT NULL AND journal_entry_id IS NOT NULL) THEN RAISE EXCEPTION 'اختر سند قبض بنكي محفوظاً من المتجر';END IF;
 SELECT * INTO result FROM public.receipt_attachments WHERE voucher_id=p_voucher_id AND sha256=p_sha256;
 IF FOUND THEN
  IF result.bytes<>p_bytes OR result.content_type<>p_content_type THEN RAISE EXCEPTION 'محتوى المرفق لا يطابق الطلب السابق';END IF;
  RETURN to_jsonb(result);
 END IF;
 SELECT count(*),coalesce(sum(bytes),0) INTO count_files,total FROM public.receipt_attachments WHERE voucher_id=p_voucher_id;
 IF count_files>=5 OR total+p_bytes>15728640 THEN RAISE EXCEPTION 'حد المرفقات خمسة ملفات و15 ميغابايت إجمالاً، بما فيها الرفع غير المكتمل';END IF;
 INSERT INTO public.receipt_attachments(store_id,voucher_id,sha256,filename,bytes,content_type,object_path,created_by)
 VALUES(p_store_id,p_voucher_id,p_sha256,p_filename,p_bytes,p_content_type,p_store_id::text||'/'||p_voucher_id::text||'/'||p_sha256,auth.uid()) RETURNING * INTO result;
 RETURN to_jsonb(result);
END $$;
REVOKE ALL ON FUNCTION public.reserve_receipt_attachment(uuid,uuid,text,text,integer,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.reserve_receipt_attachment(uuid,uuid,text,text,integer,text) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
