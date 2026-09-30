BEGIN;
ALTER TABLE public.orders ADD COLUMN checkout_key uuid;
ALTER TABLE public.orders ADD COLUMN checkout_payload jsonb;
CREATE UNIQUE INDEX storefront_checkout_key ON public.orders(store_id,checkout_key) WHERE checkout_key IS NOT NULL;
ALTER TABLE public.order_items ADD COLUMN offer_item_id uuid REFERENCES public.offer_items(id);
CREATE TABLE public.order_stock_reservations (
 order_id uuid NOT NULL REFERENCES public.orders(id),product_id uuid NOT NULL REFERENCES public.products(id),
 quantity integer NOT NULL CHECK(quantity>0),unit_cost numeric(14,2) NOT NULL,
 state text NOT NULL DEFAULT 'reserved' CHECK(state IN ('reserved','released','consumed')),
 PRIMARY KEY(order_id,product_id)
);
ALTER TABLE public.order_stock_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.order_stock_reservations FROM anon,authenticated;

CREATE FUNCTION public.create_storefront_order_atomic(p_payload jsonb,p_key uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE s public.stores%ROWTYPE; existing public.orders%ROWTYPE; p public.products%ROWTYPE;
 z public.delivery_zones%ROWTYPE; m public.shipping_methods%ROWTYPE; offer record;
 item jsonb; qty integer; price numeric; subtotal numeric:=0; shipping numeric:=0; oid uuid:=gen_random_uuid();
 line_items jsonb:='[]'; total numeric; offer_id uuid; phone text; used integer; form jsonb:=p_payload->'form';
BEGIN
 IF p_key IS NULL OR jsonb_typeof(p_payload->'items') IS DISTINCT FROM 'array'
   OR jsonb_array_length(p_payload->'items') NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'بيانات الطلب غير صالحة'; END IF;
 SELECT * INTO s FROM public.stores WHERE id=(p_payload->>'storeId')::uuid;
 IF NOT FOUND OR s.status<>'active' OR s.is_active IS NOT TRUE THEN RAISE EXCEPTION 'المتجر غير متاح'; END IF;
 -- Store lock covers stock, offer limits, shipping changes and duplicate submissions.
 PERFORM pg_advisory_xact_lock(hashtextextended('financial:' || s.id::text,0));
 SELECT * INTO existing FROM public.orders WHERE store_id=s.id AND checkout_key=p_key;
 IF FOUND THEN
   IF existing.checkout_payload IS DISTINCT FROM p_payload THEN RAISE EXCEPTION 'مفتاح الطلب مستخدم ببيانات مختلفة'; END IF;
   RETURN jsonb_build_object('orderId',existing.id);
 END IF;
 phone:=regexp_replace(COALESCE(form->>'phone',''),'[[:space:]]','','g');
 IF NULLIF(btrim(form->>'name'),'') IS NULL OR length(phone)<5 OR length(phone)>30
   OR COALESCE(form->>'payment_method','') NOT IN ('cash','bank_transfer','check','online','credit') THEN
   RAISE EXCEPTION 'بيانات العميل أو وسيلة الدفع غير صالحة'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_payload->'items') i
   WHERE jsonb_typeof(i->'quantity') IS DISTINCT FROM 'number' OR (i->>'quantity')::numeric<=0
   OR (i->>'quantity')::numeric<>trunc((i->>'quantity')::numeric) OR (i->>'quantity')::numeric>1000000
   OR NULLIF(i->>'productId','') IS NULL) THEN RAISE EXCEPTION 'الكمية يجب أن تكون عدداً صحيحاً موجباً'; END IF;
 IF (SELECT count(*) FROM jsonb_array_elements(p_payload->'items')) <>
    (SELECT count(DISTINCT i->>'productId') FROM jsonb_array_elements(p_payload->'items') i) THEN RAISE EXCEPTION 'اجمع كميات المنتج في سطر واحد'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_payload->'items') ORDER BY value->>'productId' LOOP
   SELECT * INTO p FROM public.products WHERE id=(item->>'productId')::uuid AND store_id=s.id FOR UPDATE;
   IF NOT FOUND OR p.is_active IS NOT TRUE OR p.status<>'active' OR p.price IS NULL OR p.price<0 THEN RAISE EXCEPTION 'المنتج غير متاح للشراء'; END IF;
   qty:=(item->>'quantity')::integer;
   IF p.track_stock IS NOT FALSE AND p.allow_backorder IS NOT TRUE AND COALESCE(p.stock_quantity,0)-COALESCE(p.stock_reserved,0)<qty THEN
     RAISE EXCEPTION 'الكمية المطلوبة غير متوفرة: %',p.name; END IF;
   price:=p.price; offer_id:=NULL;
   FOR offer IN SELECT oi.*,o.per_customer_limit FROM public.offer_items oi JOIN public.offers o ON o.id=oi.offer_id
     WHERE oi.product_id=p.id AND o.store_id=s.id AND o.is_active AND now() BETWEEN o.starts_at AND o.ends_at
     ORDER BY oi.offer_price,oi.id FOR UPDATE OF oi LOOP
     IF offer.max_quantity IS NOT NULL AND COALESCE(offer.sold_quantity,0)+qty>offer.max_quantity THEN CONTINUE; END IF;
     IF offer.per_customer_limit IS NOT NULL THEN
       SELECT COALESCE(sum(li.quantity),0) INTO used FROM public.order_items li JOIN public.orders ord ON ord.id=li.order_id
       JOIN public.offer_items old_offer ON old_offer.id=li.offer_item_id
       WHERE ord.store_id=s.id AND ord.customer_phone=phone AND ord.status<>'cancelled' AND old_offer.offer_id=offer.offer_id;
       IF used+qty>offer.per_customer_limit THEN CONTINUE; END IF;
     END IF;
     IF offer.offer_price<=price THEN price:=offer.offer_price; offer_id:=offer.id; EXIT; END IF;
   END LOOP;
   subtotal:=subtotal+price*qty;
   line_items:=line_items || jsonb_build_array(jsonb_build_object('product_id',p.id,'name',p.name,'sku',p.sku,'quantity',qty,
     'price',price,'cost',COALESCE(p.cost_price,0),'offer_id',offer_id,'track_stock',p.track_stock IS NOT FALSE));
 END LOOP;
 IF s.delivery_enabled IS TRUE THEN
   IF NULLIF(p_payload->>'selectedZoneId','') IS NULL AND EXISTS(SELECT 1 FROM public.delivery_zones WHERE store_id=s.id AND is_active) THEN
     RAISE EXCEPTION 'اختر منطقة التوصيل'; END IF;
   IF NULLIF(p_payload->>'selectedZoneId','') IS NOT NULL THEN
     SELECT * INTO z FROM public.delivery_zones WHERE id=(p_payload->>'selectedZoneId')::uuid AND store_id=s.id AND is_active;
     IF NOT FOUND OR z.cost<0 THEN RAISE EXCEPTION 'منطقة التوصيل غير صالحة'; END IF;
     shipping:=z.cost;
     IF NULLIF(p_payload->>'selectedMethodId','') IS NOT NULL THEN
       SELECT * INTO m FROM public.shipping_methods WHERE id=(p_payload->>'selectedMethodId')::uuid AND zone_id=z.id AND store_id=s.id AND is_active;
       IF NOT FOUND OR m.cost<0 THEN RAISE EXCEPTION 'طريقة الشحن غير صالحة'; END IF;
       shipping:=m.cost;
     ELSIF EXISTS(SELECT 1 FROM public.shipping_methods WHERE zone_id=z.id AND store_id=s.id AND is_active) THEN
       RAISE EXCEPTION 'اختر طريقة الشحن'; END IF;
   ELSIF NULLIF(p_payload->>'selectedMethodId','') IS NOT NULL THEN RAISE EXCEPTION 'طريقة الشحن تحتاج منطقة'; END IF;
   IF s.free_delivery_threshold>0 AND subtotal>=s.free_delivery_threshold THEN shipping:=0; END IF;
 ELSIF NULLIF(p_payload->>'selectedZoneId','') IS NOT NULL OR NULLIF(p_payload->>'selectedMethodId','') IS NOT NULL THEN
   RAISE EXCEPTION 'التوصيل غير متاح';
 END IF;
 total:=subtotal+shipping;
 INSERT INTO public.orders(id,store_id,order_number,status,payment_status,payment_method,subtotal,total_amount,amount_paid,
   shipping_amount,shipping_cost,shipping_zone_id,shipping_method_id,shipping_zone_name,shipping_method_name,
   customer_name,customer_phone,shipping_address,shipping_city,customer_notes,source,checkout_key,checkout_payload)
 VALUES(oid,s.id,public.generate_sequence_number(s.id,'WEB2-' || to_char(current_date,'YYYY') || '-'),'pending','unpaid',form->>'payment_method',subtotal,total,0,
   shipping,shipping,z.id,m.id,z.name,m.name,btrim(form->>'name'),phone,form->>'address',COALESCE(form->>'city',z.name),form->>'notes','store',p_key,p_payload);
 FOR item IN SELECT value FROM jsonb_array_elements(line_items) LOOP
   INSERT INTO public.order_items(order_id,product_id,product_name,product_sku,quantity,unit_price,cost_price,total_price,offer_item_id)
   VALUES(oid,(item->>'product_id')::uuid,item->>'name',item->>'sku',(item->>'quantity')::integer,(item->>'price')::numeric,
     (item->>'cost')::numeric,(item->>'price')::numeric*(item->>'quantity')::integer,(item->>'offer_id')::uuid);
   IF (item->>'track_stock')::boolean THEN
     UPDATE public.products SET stock_reserved=COALESCE(stock_reserved,0)+(item->>'quantity')::integer WHERE id=(item->>'product_id')::uuid;
     INSERT INTO public.order_stock_reservations(order_id,product_id,quantity,unit_cost)
       VALUES(oid,(item->>'product_id')::uuid,(item->>'quantity')::integer,(item->>'cost')::numeric);
   END IF;
   IF item->>'offer_id' IS NOT NULL THEN
     UPDATE public.offer_items SET sold_quantity=COALESCE(sold_quantity,0)+(item->>'quantity')::integer WHERE id=(item->>'offer_id')::uuid;
   END IF;
 END LOOP;
 RETURN jsonb_build_object('orderId',oid);
END $$;
REVOKE ALL ON FUNCTION public.create_storefront_order_atomic(jsonb,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_storefront_order_atomic(jsonb,uuid) TO service_role;
COMMIT;
