-- Migration 077: Fix customer C0000567 (عماد عبد الله / الزبابدة) ledger discrepancy
-- 1. Remove ghost purchase return entry M0000644 that was erroneously duplicated under customer C0000567
-- 2. Correct USD receipt R0005029 exchange rate to 3.50 (5,775.00 NIS) matching Shamel ERP ledger
-- 3. Update customer summary balance to 0.00 NIS

BEGIN;

-- 1. Remove ghost purchase return entry M0000644 from customer C0000567
DELETE FROM public.shamel_entries 
WHERE document = 'M0000644' 
  AND account = 'C0000567'
  AND store_id IN (SELECT store_id FROM public.shamel_customers WHERE code = 'C0000567');

-- 2. Correct receipt R0005029 exchange rate to 3.50 (1,650 USD * 3.50 = 5,775.00 NIS)
UPDATE public.shamel_entries 
SET exchange_rate = 3.50, nis_amount = 5775.00 
WHERE document = 'R0005029'
  AND account = 'C0000567'
  AND currency = 'USD'
  AND store_id IN (SELECT store_id FROM public.shamel_customers WHERE code = 'C0000567');

-- 3. Recalculate customer summary, equivalent balance and activity dates for C0000567
UPDATE public.shamel_customers c
SET 
  balance = coalesce(sub.eq_bal, 0.0),
  equivalent_balance = coalesce(sub.eq_bal, 0.0),
  has_balance = (abs(coalesce(sub.eq_bal, 0.0)) > 0.001),
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
  WHERE store_id IN (SELECT store_id FROM public.shamel_customers WHERE code = 'C0000567')
    AND account = 'C0000567'
  GROUP BY store_id, account
) sub
WHERE c.store_id = sub.store_id AND c.code = sub.account;

COMMIT;
