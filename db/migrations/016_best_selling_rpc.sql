-- 016: دالة عامة لإحصاء مبيعات المنتجات لكل متجر
-- مطلوبة لفرز "الأكثر مبيعاً" في الواجهة الأمامية (anon) واللوحة (authenticated)
SET search_path = public;

CREATE OR REPLACE FUNCTION get_product_sales(p_store_id UUID)
RETURNS TABLE(product_id UUID, sold_count BIGINT)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT oi.product_id, SUM(oi.quantity)::BIGINT AS sold_count
  FROM order_items oi
  JOIN orders o ON o.id = oi.order_id
  WHERE o.store_id = p_store_id
    AND o.status != 'cancelled'
  GROUP BY oi.product_id
  ORDER BY sold_count DESC;
$$;

GRANT EXECUTE ON FUNCTION get_product_sales(UUID) TO anon, authenticated;
