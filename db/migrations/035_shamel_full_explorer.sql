-- ==============================================================================
-- Migration 035: Shamel Full Explorer, Cheque Stats & Statement RPCs
-- حساب الإحصائيات الدقيقة لكافة الشيكات وكشوف الحسابات وبطاقات الأصناف
-- ==============================================================================
SET search_path = public;

-- 1. دالة احتساب إحصائيات الشيكات الدقيقة لجميع الشيكات (بدون تقييد الـ 1000)
CREATE OR REPLACE FUNCTION public.shamel_get_cheque_stats(
  p_store_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_stats JSONB;
BEGIN
  IF NOT is_store_member(p_store_id) THEN
    RAISE EXCEPTION 'Not authorized for this store';
  END IF;

  SELECT jsonb_build_object(
    'total_count', count(*),
    'total_amount', COALESCE(sum(amount), 0),
    'in_portfolio_count', count(*) FILTER (WHERE status = 'in_portfolio'),
    'in_portfolio_amount', COALESCE(sum(amount) FILTER (WHERE status = 'in_portfolio'), 0),
    'endorsed_count', count(*) FILTER (WHERE status = 'endorsed'),
    'endorsed_amount', COALESCE(sum(amount) FILTER (WHERE status = 'endorsed'), 0),
    'collected_count', count(*) FILTER (WHERE status = 'collected'),
    'collected_amount', COALESCE(sum(amount) FILTER (WHERE status = 'collected'), 0),
    'bounced_count', count(*) FILTER (WHERE status = 'bounced'),
    'bounced_amount', COALESCE(sum(amount) FILTER (WHERE status = 'bounced'), 0)
  ) INTO v_stats
  FROM public.shamel_cheques
  WHERE store_id = p_store_id;

  RETURN v_stats;
END;
$$;
