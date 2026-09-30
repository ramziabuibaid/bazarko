BEGIN;
ALTER TABLE public.accounts ADD COLUMN report_section text;
ALTER TABLE public.accounts ADD COLUMN is_cash_equivalent boolean NOT NULL DEFAULT false;
ALTER TABLE public.accounts ADD COLUMN cash_flow_category text CHECK(cash_flow_category IN ('customer','supplier','operating','fixed_asset','capital','loan','drawings'));
ALTER TABLE public.journal_entries ADD COLUMN cash_flow_allocations jsonb;
UPDATE public.accounts SET is_cash_equivalent=account_tag IN ('CASH','PETTY_CASH','BANK') WHERE account_tag IS NOT NULL;
UPDATE public.accounts SET report_section=CASE
 WHEN account_tag IN ('FIXED_ASSETS','ACCUMULATED_DEPRECIATION') THEN 'non_current_asset'
 WHEN type='asset' AND account_tag IS NOT NULL THEN 'current_asset'
 WHEN account_tag='LONG_TERM_LOANS' THEN 'non_current_liability'
 WHEN type='liability' AND account_tag IS NOT NULL THEN 'current_liability'
 WHEN type='equity' THEN 'equity'
 WHEN account_tag IN ('SALES_REVENUE','SERVICE_REVENUE') THEN 'sales'
 WHEN account_tag IN ('SALES_DISCOUNT','SALES_RETURNS') THEN 'contra_sales'
 WHEN account_tag='COGS' THEN 'cogs'
 WHEN account_tag='OTHER_REVENUE' THEN 'other_revenue'
 WHEN type='expense' AND account_tag IS NOT NULL THEN 'operating_expense'
 END;
UPDATE public.accounts SET cash_flow_category=CASE
 WHEN account_tag IN ('CUSTOMER_RECEIVABLE','SALES_REVENUE','SERVICE_REVENUE','SALES_RETURNS','SALES_DISCOUNT','CHEQUES_IN_HAND','CHEQUES_RECEIVABLE','CHECKS_PORTFOLIO','CHECKS_UNDER_COLLECTION','CHECKS_BOUNCED') THEN 'customer'
 WHEN account_tag IN ('SUPPLIER_PAYABLE','INVENTORY','PURCHASE_DISCOUNT','PURCHASE_RETURNS') THEN 'supplier'
 WHEN account_tag IN ('FIXED_ASSETS','ACCUMULATED_DEPRECIATION') THEN 'fixed_asset'
 WHEN account_tag='CAPITAL' THEN 'capital'
 WHEN account_tag IN ('SHORT_TERM_LOANS','LONG_TERM_LOANS') THEN 'loan'
 WHEN account_tag='DRAWINGS' THEN 'drawings'
 WHEN type='expense' THEN 'operating' END;

CREATE FUNCTION public.cash_flow_report_atomic(p_store uuid,p_from date,p_to date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE opening numeric; closing numeric; e record; n integer; category text; allocation jsonb; totals jsonb:='{}'; delta numeric;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.store_members WHERE store_id=p_store AND profile_id=auth.uid() AND is_active IS TRUE) THEN RAISE EXCEPTION 'غير مخول' USING ERRCODE='42501'; END IF;
 IF p_from IS NULL OR p_to IS NULL OR p_from>p_to THEN RAISE EXCEPTION 'نطاق التقرير غير صالح'; END IF;
 SELECT COALESCE(sum(l.debit-l.credit) FILTER(WHERE j.date<p_from),0),COALESCE(sum(l.debit-l.credit),0)
 INTO opening,closing FROM public.journal_lines l JOIN public.journal_entries j ON j.id=l.journal_entry_id
 JOIN public.accounts a ON a.id=l.account_id WHERE j.store_id=p_store AND j.status='posted' AND j.date<=p_to AND a.is_cash_equivalent;
 FOR e IN SELECT j.id,j.cash_flow_allocations,sum(l.debit-l.credit) AS cash_delta
   FROM public.journal_entries j JOIN public.journal_lines l ON l.journal_entry_id=j.id JOIN public.accounts a ON a.id=l.account_id
   WHERE j.store_id=p_store AND j.status='posted' AND j.date BETWEEN p_from AND p_to AND a.is_cash_equivalent
   GROUP BY j.id HAVING sum(l.debit-l.credit)<>0 LOOP
   IF e.cash_flow_allocations IS NOT NULL THEN
     IF jsonb_typeof(e.cash_flow_allocations)<>'object' THEN RAISE EXCEPTION 'توزيع التدفق غير صالح'; END IF;
     IF (SELECT sum(value::numeric) FROM jsonb_each_text(e.cash_flow_allocations)) IS DISTINCT FROM e.cash_delta THEN RAISE EXCEPTION 'توزيع التدفق لا يطابق حركة النقد'; END IF;
     allocation:=e.cash_flow_allocations;
   ELSE
     SELECT count(DISTINCT a.cash_flow_category),min(a.cash_flow_category) INTO n,category
       FROM public.journal_lines l JOIN public.accounts a ON a.id=l.account_id
       WHERE l.journal_entry_id=e.id AND NOT a.is_cash_equivalent AND (l.debit<>0 OR l.credit<>0);
     IF n<>1 OR EXISTS(SELECT 1 FROM public.journal_lines l JOIN public.accounts a ON a.id=l.account_id
       WHERE l.journal_entry_id=e.id AND NOT a.is_cash_equivalent AND a.cash_flow_category IS NULL) THEN
       RAISE EXCEPTION 'التقرير غير مكتمل: القيد % يحتاج تصنيفاً أو توزيعاً صريحاً للتدفق النقدي',e.id;
     END IF;
     allocation:=jsonb_build_object(category,e.cash_delta);
   END IF;
   FOR category,delta IN SELECT key,value::numeric FROM jsonb_each_text(allocation) LOOP
     IF category NOT IN ('customer','supplier','operating','fixed_asset','capital','loan','drawings') THEN RAISE EXCEPTION 'تصنيف تدفق غير معروف'; END IF;
     -- Keep inflows and outflows separate for asset purchases/sales.
     category:=category || CASE WHEN delta>=0 THEN '_in' ELSE '_out' END;
     totals:=jsonb_set(totals,ARRAY[category],to_jsonb(COALESCE((totals->>category)::numeric,0)+abs(delta)));
   END LOOP;
 END LOOP;
 RETURN jsonb_build_object('opening',opening,'closing',closing,'totals',totals);
END $$;
REVOKE ALL ON FUNCTION public.cash_flow_report_atomic(uuid,date,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.cash_flow_report_atomic(uuid,date,date) TO authenticated;
COMMIT;
