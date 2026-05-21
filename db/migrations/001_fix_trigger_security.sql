-- Migration 001: إصلاح SECURITY DEFINER للـ triggers
-- شغّل هذا إذا ظهر خطأ "violates row-level security policy for table accounts"

CREATE OR REPLACE FUNCTION create_default_accounts(p_store_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO accounts (store_id, code, name, type, sort_order) VALUES
    (p_store_id, '1001', 'الصندوق',             'asset',   1),
    (p_store_id, '1002', 'البنك',                'asset',   2),
    (p_store_id, '1101', 'ذمم الزبائن',          'asset',   3),
    (p_store_id, '1201', 'المخزون',              'asset',   4),
    (p_store_id, '2001', 'ذمم الموردين',         'liability',1),
    (p_store_id, '4001', 'إيرادات المبيعات',     'revenue', 1),
    (p_store_id, '4002', 'إيرادات الخدمات',      'revenue', 2),
    (p_store_id, '5001', 'تكلفة البضاعة المباعة','expense', 1),
    (p_store_id, '5101', 'مصاريف الشحن',         'expense', 2),
    (p_store_id, '5102', 'مصاريف الإيجار',       'expense', 3),
    (p_store_id, '5103', 'مصاريف الرواتب',       'expense', 4),
    (p_store_id, '5199', 'مصاريف متنوعة',        'expense', 5);
END;
$$;

CREATE OR REPLACE FUNCTION handle_new_store()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO store_members (store_id, profile_id, role, joined_at)
  VALUES (NEW.id, NEW.owner_id, 'owner', NOW());

  PERFORM create_default_accounts(NEW.id);

  RETURN NEW;
END;
$$;
