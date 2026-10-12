-- Migration 076: Fix Shamel ERP customer ledger discrepancies, foreign currency conversion rates, and orphaned entries

-- 1. Remove cancelled/orphaned entries that were deleted in Shamel ERP
DELETE FROM public.shamel_entries WHERE document = 'J0016528';

-- 2. Correct invoice I0012545 header entry to match invoice items total (4,320.00)
UPDATE public.shamel_entries 
SET amount = 4320.00, nis_amount = 4320.00 
WHERE document = 'I0012545' AND account = 'C0002584';

-- 3. Fix foreign currency conversion rates for large JOD transactions (e.g., R0007283 2500 JOD cheque payment)
UPDATE public.shamel_entries
SET exchange_rate = 4.78, nis_amount = round(amount * 4.78, 2)
WHERE document = 'R0007283' AND currency = 'JOD';

-- Ensure small cash/check entries marked at par remain at par
UPDATE public.shamel_entries
SET exchange_rate = 1.0, nis_amount = amount
WHERE document IN ('R0006593', 'R0005545', 'J0008427');

-- 4. Re-calculate customer summaries and equivalent balances accurately
UPDATE public.shamel_customers c
SET 
  equivalent_balance = coalesce(sub.eq_bal, c.balance),
  has_balance = (abs(coalesce(sub.eq_bal, c.balance)) > 0.001),
  last_invoice_date = sub.last_inv,
  last_receipt_date = sub.last_rec
FROM (
  SELECT 
    store_id,
    account,
    round(sum(
      CASE 
        WHEN direction = 1 THEN coalesce(nullif(nis_amount, 0), amount * coalesce(exchange_rate, 1.0), amount)
        WHEN direction = 2 THEN -coalesce(nullif(nis_amount, 0), amount * coalesce(exchange_rate, 1.0), amount)
        ELSE 0
      END
    ), 2) as eq_bal,
    max(CASE WHEN document_type LIKE '%مبيعات%' OR document LIKE 'I%' THEN day END) as last_inv,
    max(CASE WHEN document_type LIKE '%قبض%' OR document LIKE 'R%' THEN day END) as last_rec
  FROM public.shamel_entries
  GROUP BY store_id, account
) sub
WHERE c.store_id = sub.store_id AND c.code = sub.account;
