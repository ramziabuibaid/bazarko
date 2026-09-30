BEGIN;
CREATE TABLE public.order_email_outbox(
 order_id uuid PRIMARY KEY REFERENCES public.orders(id) ON DELETE CASCADE,
 store_id uuid NOT NULL REFERENCES public.stores(id),
 recipient text NOT NULL,
 attempts integer NOT NULL DEFAULT 0,
 lease_until timestamptz,
 sent_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.order_email_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.order_email_outbox FROM anon,authenticated;
CREATE FUNCTION public.claim_order_email(p_order uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_recipient text; v_store uuid;
BEGIN
 UPDATE public.order_email_outbox SET attempts=attempts+1,lease_until=now()+interval '2 minutes'
 WHERE order_id=p_order AND sent_at IS NULL AND (lease_until IS NULL OR lease_until<now())
 RETURNING recipient,store_id INTO v_recipient,v_store;
 IF NOT FOUND THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('recipient',v_recipient,'storeId',v_store);
END $$;
REVOKE ALL ON FUNCTION public.claim_order_email(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_order_email(uuid) TO service_role;
COMMIT;
