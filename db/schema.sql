-- ═══════════════════════════════════════════════════════
-- Bazarko — Full Database Schema
-- Version: 2.0 | Multi-country + Multi-user
-- ═══════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────
-- 1. الدول
-- ─────────────────────────────────────────────────────
CREATE TABLE countries (
  code            TEXT PRIMARY KEY,
  name_ar         TEXT NOT NULL,
  name_en         TEXT NOT NULL,
  currency_code   TEXT NOT NULL,
  currency_symbol TEXT NOT NULL,
  domain_prefix   TEXT NOT NULL,
  is_active       BOOLEAN DEFAULT TRUE,
  launch_date     DATE,
  settings        JSONB DEFAULT '{}'::jsonb
);

INSERT INTO countries (code, name_ar, name_en, currency_code, currency_symbol, domain_prefix, is_active, launch_date)
VALUES
  ('PS', 'فلسطين', 'Palestine', 'ILS', '₪',   'ps', TRUE, '2026-06-01'),
  ('SY', 'سوريا',  'Syria',     'SYP', 'ل.س', 'sy', TRUE, '2026-08-01');

-- ─────────────────────────────────────────────────────
-- 2. ملفات المستخدمين (امتداد auth.users)
-- ─────────────────────────────────────────────────────
CREATE TABLE profiles (
  id           UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name    TEXT,
  avatar_url   TEXT,
  phone        TEXT,
  country_code TEXT REFERENCES countries(code),
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- trigger: ينشئ profile تلقائياً عند تسجيل مستخدم جديد
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO profiles (id, full_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'avatar_url'
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE handle_new_user();

-- ─────────────────────────────────────────────────────
-- 3. المتاجر
-- ─────────────────────────────────────────────────────
CREATE TABLE stores (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id              UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  country_code          TEXT NOT NULL REFERENCES countries(code),

  name                  TEXT NOT NULL,
  subdomain             TEXT NOT NULL,
  full_subdomain        TEXT GENERATED ALWAYS AS
                        (subdomain || '.' || lower(country_code) || '.bazarko.com') STORED,
  description           TEXT,
  logo_url              TEXT,
  cover_url             TEXT,

  phone                 TEXT,
  whatsapp              TEXT,
  address               TEXT,
  city                  TEXT,
  email                 TEXT,

  currency_code         TEXT NOT NULL,
  tax_number            TEXT,
  tax_rate              DECIMAL(5,2) DEFAULT 0,

  status                TEXT DEFAULT 'active'
                        CHECK (status IN ('active','suspended','pending','closed')),
  plan                  TEXT DEFAULT 'free'
                        CHECK (plan IN ('free','pro','business')),
  plan_expires_at       TIMESTAMPTZ,

  modules               JSONB DEFAULT '{
    "store": true,
    "accounting": true,
    "inventory": true,
    "maintenance": false,
    "marketplace": false
  }'::jsonb,

  settings              JSONB DEFAULT '{
    "order_notification_email": true,
    "low_stock_alert": true,
    "low_stock_threshold": 5,
    "allow_backorder": false,
    "show_stock_count": false
  }'::jsonb,

  marketplace_status    TEXT DEFAULT 'none'
                        CHECK (marketplace_status IN ('none','pending','approved','suspended')),
  marketplace_joined_at TIMESTAMPTZ,

  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(subdomain, country_code)
);

CREATE INDEX idx_stores_country    ON stores(country_code);
CREATE INDEX idx_stores_subdomain  ON stores(subdomain, country_code);
CREATE INDEX idx_stores_owner      ON stores(owner_id);
CREATE INDEX idx_stores_marketplace ON stores(marketplace_status, country_code);

-- ─────────────────────────────────────────────────────
-- 4. أعضاء المتجر (Multi-user)
-- ─────────────────────────────────────────────────────
CREATE TABLE store_members (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id   UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'staff'
             CHECK (role IN ('owner','admin','staff','accountant','viewer')),
  is_active  BOOLEAN DEFAULT TRUE,
  invited_at TIMESTAMPTZ DEFAULT NOW(),
  joined_at  TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(store_id, profile_id)
);

CREATE INDEX idx_store_members_store   ON store_members(store_id);
CREATE INDEX idx_store_members_profile ON store_members(profile_id);

-- ─────────────────────────────────────────────────────
-- 5. الفئات
-- ─────────────────────────────────────────────────────
CREATE TABLE categories (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id   UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  slug       TEXT NOT NULL,
  parent_id  UUID REFERENCES categories(id) ON DELETE SET NULL,
  image_url  TEXT,
  sort_order INTEGER DEFAULT 0,
  is_active  BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(store_id, slug)
);

CREATE INDEX idx_categories_store ON categories(store_id);

-- ─────────────────────────────────────────────────────
-- 6. المنتجات
-- ─────────────────────────────────────────────────────
CREATE TABLE products (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id        UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  category_id     UUID REFERENCES categories(id) ON DELETE SET NULL,

  name            TEXT NOT NULL,
  slug            TEXT NOT NULL,
  description     TEXT,
  sku             TEXT,
  barcode         TEXT,

  price           DECIMAL(12,2) NOT NULL,
  compare_price   DECIMAL(12,2),
  cost_price      DECIMAL(12,2),

  stock_quantity  INTEGER NOT NULL DEFAULT 0,
  stock_reserved  INTEGER DEFAULT 0,
  stock_available INTEGER GENERATED ALWAYS AS
                  (stock_quantity - COALESCE(stock_reserved, 0)) STORED,
  track_stock     BOOLEAN DEFAULT TRUE,
  allow_backorder BOOLEAN DEFAULT FALSE,
  low_stock_alert INTEGER DEFAULT 5,

  weight          DECIMAL(8,2),
  dimensions      JSONB,

  images          TEXT[] DEFAULT ARRAY[]::TEXT[],
  thumbnail_url   TEXT,

  tags            TEXT[] DEFAULT ARRAY[]::TEXT[],
  is_active       BOOLEAN DEFAULT TRUE,
  is_featured     BOOLEAN DEFAULT FALSE,
  sort_order      INTEGER DEFAULT 0,

  metadata        JSONB DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(store_id, slug)
);

CREATE INDEX idx_products_store    ON products(store_id);
CREATE INDEX idx_products_category ON products(category_id);
CREATE INDEX idx_products_sku      ON products(store_id, sku) WHERE sku IS NOT NULL;
CREATE INDEX idx_products_active   ON products(store_id, is_active);

-- ─────────────────────────────────────────────────────
-- 7. حركات المخزون
-- ─────────────────────────────────────────────────────
CREATE TABLE stock_movements (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id        UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  product_id      UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  type            TEXT NOT NULL CHECK (type IN (
    'purchase','sale','return','adjustment','damage','transfer'
  )),
  quantity        INTEGER NOT NULL,
  quantity_before INTEGER NOT NULL,
  quantity_after  INTEGER NOT NULL,
  reference_id    UUID,
  reference_type  TEXT,
  notes           TEXT,
  created_by      UUID REFERENCES profiles(id),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_stock_movements_product ON stock_movements(product_id);
CREATE INDEX idx_stock_movements_store   ON stock_movements(store_id, created_at);

-- ─────────────────────────────────────────────────────
-- 8. الزبائن
-- ─────────────────────────────────────────────────────
CREATE TABLE customers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id        UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,

  name            TEXT NOT NULL,
  phone           TEXT,
  phone_alt       TEXT,
  email           TEXT,
  address         TEXT,
  city            TEXT,
  national_id     TEXT,
  notes           TEXT,

  credit_limit    DECIMAL(12,2) DEFAULT 0,
  balance         DECIMAL(12,2) DEFAULT 0,

  total_orders    INTEGER DEFAULT 0,
  total_invoiced  DECIMAL(12,2) DEFAULT 0,
  total_paid      DECIMAL(12,2) DEFAULT 0,
  last_order_at   TIMESTAMPTZ,
  last_payment_at TIMESTAMPTZ,

  customer_type   TEXT DEFAULT 'retail'
                  CHECK (customer_type IN ('retail','wholesale','vip')),
  is_active       BOOLEAN DEFAULT TRUE,

  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_customers_store   ON customers(store_id);
CREATE INDEX idx_customers_phone   ON customers(store_id, phone);
CREATE INDEX idx_customers_balance ON customers(store_id, balance) WHERE balance != 0;

-- ─────────────────────────────────────────────────────
-- 9. شركات التوصيل
-- ─────────────────────────────────────────────────────
CREATE TABLE delivery_companies (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code TEXT NOT NULL REFERENCES countries(code),
  store_id     UUID REFERENCES stores(id),
  name         TEXT NOT NULL,
  phone        TEXT,
  website      TEXT,
  base_cost    DECIMAL(8,2) DEFAULT 0,
  is_active    BOOLEAN DEFAULT TRUE,
  sort_order   INTEGER DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────
-- 10. الطلبيات
-- ─────────────────────────────────────────────────────
CREATE TABLE orders (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id            UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  customer_id         UUID REFERENCES customers(id) ON DELETE SET NULL,
  order_number        TEXT NOT NULL,

  status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending','confirmed','processing','ready','shipped','delivered','cancelled','returned'
  )),

  payment_status      TEXT DEFAULT 'unpaid'
                      CHECK (payment_status IN ('unpaid','partial','paid','refunded')),
  payment_method      TEXT CHECK (payment_method IN
                      ('cash','bank_transfer','check','online','credit')),
  subtotal            DECIMAL(12,2) NOT NULL,
  discount_type       TEXT CHECK (discount_type IN ('fixed','percentage')),
  discount_value      DECIMAL(12,2) DEFAULT 0,
  discount_amount     DECIMAL(12,2) DEFAULT 0,
  shipping_amount     DECIMAL(12,2) DEFAULT 0,
  tax_amount          DECIMAL(12,2) DEFAULT 0,
  total_amount        DECIMAL(12,2) NOT NULL,
  amount_paid         DECIMAL(12,2) DEFAULT 0,
  amount_remaining    DECIMAL(12,2) GENERATED ALWAYS AS
                      (total_amount - amount_paid) STORED,

  delivery_company_id UUID REFERENCES delivery_companies(id),
  tracking_number     TEXT,
  shipping_address    TEXT,
  shipping_city       TEXT,
  expected_delivery   DATE,

  source              TEXT DEFAULT 'store'
                      CHECK (source IN ('store','dashboard','phone','whatsapp','marketplace')),

  customer_notes      TEXT,
  internal_notes      TEXT,

  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(store_id, order_number)
);

CREATE INDEX idx_orders_store      ON orders(store_id);
CREATE INDEX idx_orders_customer   ON orders(customer_id);
CREATE INDEX idx_orders_status     ON orders(store_id, status);
CREATE INDEX idx_orders_created    ON orders(store_id, created_at);

CREATE TABLE order_items (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id     UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id   UUID REFERENCES products(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  product_sku  TEXT,
  quantity     INTEGER NOT NULL CHECK (quantity > 0),
  unit_price   DECIMAL(12,2) NOT NULL,
  cost_price   DECIMAL(12,2),
  discount     DECIMAL(12,2) DEFAULT 0,
  total_price  DECIMAL(12,2) NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_order_items_order ON order_items(order_id);

CREATE TABLE order_tracking (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status      TEXT NOT NULL,
  title       TEXT NOT NULL,
  description TEXT,
  location    TEXT,
  is_public   BOOLEAN DEFAULT TRUE,
  created_by  UUID REFERENCES profiles(id),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────
-- 11. دليل الحسابات
-- ─────────────────────────────────────────────────────
CREATE TABLE accounts (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id   UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  code       TEXT NOT NULL,
  name       TEXT NOT NULL,
  type       TEXT NOT NULL CHECK (type IN (
    'asset','liability','equity','revenue','expense'
  )),
  parent_id  UUID REFERENCES accounts(id),
  is_active  BOOLEAN DEFAULT TRUE,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(store_id, code)
);

CREATE INDEX idx_accounts_store ON accounts(store_id);

-- ─────────────────────────────────────────────────────
-- 12. الموردون
-- ─────────────────────────────────────────────────────
CREATE TABLE suppliers (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id   UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  phone      TEXT,
  address    TEXT,
  balance    DECIMAL(12,2) DEFAULT 0,
  notes      TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_suppliers_store ON suppliers(store_id);

-- ─────────────────────────────────────────────────────
-- 13. الفواتير
-- ─────────────────────────────────────────────────────
CREATE TABLE invoices (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id         UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  customer_id      UUID REFERENCES customers(id),
  order_id         UUID REFERENCES orders(id),
  invoice_number   TEXT NOT NULL,
  type             TEXT DEFAULT 'sale'
                   CHECK (type IN ('sale','service','return','proforma')),
  status           TEXT DEFAULT 'draft'
                   CHECK (status IN ('draft','sent','partial','paid','overdue','cancelled')),

  issue_date       DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date         DATE,
  paid_date        DATE,

  subtotal         DECIMAL(12,2) NOT NULL,
  discount_type    TEXT CHECK (discount_type IN ('fixed','percentage')),
  discount_value   DECIMAL(12,2) DEFAULT 0,
  discount_amount  DECIMAL(12,2) DEFAULT 0,
  tax_rate         DECIMAL(5,2) DEFAULT 0,
  tax_amount       DECIMAL(12,2) DEFAULT 0,
  total_amount     DECIMAL(12,2) NOT NULL,
  amount_paid      DECIMAL(12,2) DEFAULT 0,
  amount_remaining DECIMAL(12,2) GENERATED ALWAYS AS
                   (total_amount - amount_paid) STORED,

  notes            TEXT,
  terms            TEXT,
  footer_text      TEXT,

  created_by       UUID REFERENCES profiles(id),
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(store_id, invoice_number)
);

CREATE INDEX idx_invoices_store    ON invoices(store_id);
CREATE INDEX idx_invoices_customer ON invoices(customer_id);
CREATE INDEX idx_invoices_status   ON invoices(store_id, status);

CREATE TABLE invoice_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id  UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  product_id  UUID REFERENCES products(id),
  description TEXT NOT NULL,
  quantity    DECIMAL(10,3) NOT NULL,
  unit        TEXT DEFAULT 'قطعة',
  unit_price  DECIMAL(12,2) NOT NULL,
  discount    DECIMAL(12,2) DEFAULT 0,
  total_price DECIMAL(12,2) NOT NULL,
  sort_order  INTEGER DEFAULT 0
);

-- ─────────────────────────────────────────────────────
-- 14. سندات القبض
-- ─────────────────────────────────────────────────────
CREATE TABLE receipt_vouchers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id        UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  voucher_number  TEXT NOT NULL,
  voucher_date    DATE NOT NULL DEFAULT CURRENT_DATE,

  customer_id     UUID REFERENCES customers(id),
  received_from   TEXT NOT NULL,

  amount          DECIMAL(12,2) NOT NULL CHECK (amount > 0),
  currency        TEXT NOT NULL,
  payment_method  TEXT NOT NULL CHECK (payment_method IN
                  ('cash','bank_transfer','check','online')),
  bank_name       TEXT,
  check_number    TEXT,
  reference       TEXT,

  order_id        UUID REFERENCES orders(id),
  invoice_id      UUID REFERENCES invoices(id),
  account_id      UUID NOT NULL REFERENCES accounts(id),

  description     TEXT,
  notes           TEXT,

  status          TEXT DEFAULT 'confirmed'
                  CHECK (status IN ('draft','confirmed','cancelled')),
  cancelled_at    TIMESTAMPTZ,
  cancel_reason   TEXT,

  created_by      UUID REFERENCES profiles(id),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(store_id, voucher_number)
);

CREATE INDEX idx_rv_store    ON receipt_vouchers(store_id);
CREATE INDEX idx_rv_customer ON receipt_vouchers(customer_id);
CREATE INDEX idx_rv_date     ON receipt_vouchers(store_id, voucher_date);
CREATE INDEX idx_rv_invoice  ON receipt_vouchers(invoice_id);

-- ─────────────────────────────────────────────────────
-- 15. سندات الصرف
-- ─────────────────────────────────────────────────────
CREATE TABLE payment_vouchers (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id           UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  voucher_number     TEXT NOT NULL,
  voucher_date       DATE NOT NULL DEFAULT CURRENT_DATE,

  paid_to            TEXT NOT NULL,
  supplier_id        UUID REFERENCES suppliers(id),
  expense_category   TEXT,

  amount             DECIMAL(12,2) NOT NULL CHECK (amount > 0),
  currency           TEXT NOT NULL,
  payment_method     TEXT NOT NULL CHECK (payment_method IN
                     ('cash','bank_transfer','check')),
  bank_name          TEXT,
  check_number       TEXT,
  reference          TEXT,

  account_id         UUID NOT NULL REFERENCES accounts(id),
  expense_account_id UUID REFERENCES accounts(id),

  description        TEXT NOT NULL,
  notes              TEXT,

  status             TEXT DEFAULT 'confirmed'
                     CHECK (status IN ('draft','confirmed','cancelled')),
  cancelled_at       TIMESTAMPTZ,
  cancel_reason      TEXT,

  created_by         UUID REFERENCES profiles(id),
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(store_id, voucher_number)
);

CREATE INDEX idx_pv_store ON payment_vouchers(store_id);
CREATE INDEX idx_pv_date  ON payment_vouchers(store_id, voucher_date);

-- ─────────────────────────────────────────────────────
-- 16. دفتر الزبون (Customer Ledger)
-- ─────────────────────────────────────────────────────
CREATE TABLE customer_ledger (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id       UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  customer_id    UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,

  type           TEXT NOT NULL CHECK (type IN (
    'invoice','payment','return','adjustment','credit_note'
  )),

  date           DATE NOT NULL DEFAULT CURRENT_DATE,
  description    TEXT NOT NULL,

  debit          DECIMAL(12,2) DEFAULT 0,
  credit         DECIMAL(12,2) DEFAULT 0,
  balance        DECIMAL(12,2) NOT NULL,

  reference_id   UUID,
  reference_type TEXT,

  created_by     UUID REFERENCES profiles(id),
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ledger_customer ON customer_ledger(customer_id, date);
CREATE INDEX idx_ledger_store    ON customer_ledger(store_id, date);

-- ─────────────────────────────────────────────────────
-- 17. نظام الصيانة
-- ─────────────────────────────────────────────────────
CREATE TABLE maintenance_requests (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id             UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  customer_id          UUID REFERENCES customers(id),
  request_number       TEXT NOT NULL,
  received_date        DATE NOT NULL DEFAULT CURRENT_DATE,
  promised_date        DATE,

  device_type          TEXT NOT NULL,
  device_brand         TEXT,
  device_model         TEXT,
  serial_number        TEXT,
  device_color         TEXT,
  device_condition     TEXT,

  problem_description  TEXT NOT NULL,
  technician_notes     TEXT,
  diagnosis            TEXT,

  estimated_cost       DECIMAL(12,2),
  actual_cost          DECIMAL(12,2),
  parts_cost           DECIMAL(12,2) DEFAULT 0,
  labor_cost           DECIMAL(12,2) DEFAULT 0,

  advance_paid         DECIMAL(12,2) DEFAULT 0,
  payment_status       TEXT DEFAULT 'unpaid'
                       CHECK (payment_status IN ('unpaid','partial','paid')),

  status               TEXT DEFAULT 'received' CHECK (status IN (
    'received','diagnosing','waiting_approval','waiting_parts',
    'in_progress','testing','ready','delivered','cancelled','unrepairable'
  )),

  images               TEXT[] DEFAULT ARRAY[]::TEXT[],
  attachments          TEXT[] DEFAULT ARRAY[]::TEXT[],

  assigned_to          UUID REFERENCES profiles(id),
  warranty_period      INTEGER DEFAULT 0,
  delivered_at         TIMESTAMPTZ,

  notes                TEXT,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(store_id, request_number)
);

CREATE INDEX idx_maintenance_store    ON maintenance_requests(store_id);
CREATE INDEX idx_maintenance_status   ON maintenance_requests(store_id, status);
CREATE INDEX idx_maintenance_customer ON maintenance_requests(customer_id);

CREATE TABLE maintenance_parts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id  UUID NOT NULL REFERENCES maintenance_requests(id) ON DELETE CASCADE,
  product_id  UUID REFERENCES products(id),
  part_name   TEXT NOT NULL,
  quantity    DECIMAL(10,2) DEFAULT 1,
  unit_cost   DECIMAL(12,2) NOT NULL,
  total_cost  DECIMAL(12,2) NOT NULL,
  source      TEXT DEFAULT 'stock'
              CHECK (source IN ('stock','purchased','other')),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE maintenance_status_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id      UUID NOT NULL REFERENCES maintenance_requests(id) ON DELETE CASCADE,
  status          TEXT NOT NULL,
  notes           TEXT,
  notify_customer BOOLEAN DEFAULT FALSE,
  created_by      UUID REFERENCES profiles(id),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────
-- 18. فئات وتقييمات الـ Marketplace
-- ─────────────────────────────────────────────────────
CREATE TABLE marketplace_categories (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code TEXT NOT NULL REFERENCES countries(code),
  name         TEXT NOT NULL,
  slug         TEXT NOT NULL,
  parent_id    UUID REFERENCES marketplace_categories(id),
  icon         TEXT,
  sort_order   INTEGER DEFAULT 0,
  UNIQUE(country_code, slug)
);

CREATE TABLE store_marketplace_categories (
  store_id    UUID REFERENCES stores(id) ON DELETE CASCADE,
  category_id UUID REFERENCES marketplace_categories(id),
  PRIMARY KEY (store_id, category_id)
);

CREATE TABLE store_reviews (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id    UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  order_id    UUID REFERENCES orders(id),
  rating      INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment     TEXT,
  is_verified BOOLEAN DEFAULT FALSE,
  is_visible  BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────
-- 19. عداد أرقام المستندات (Atomic sequence)
-- ─────────────────────────────────────────────────────
CREATE TABLE sequence_counters (
  store_id   UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  prefix     TEXT NOT NULL,
  last_value INTEGER DEFAULT 0,
  PRIMARY KEY (store_id, prefix)
);

CREATE OR REPLACE FUNCTION generate_sequence_number(
  p_store_id UUID,
  p_prefix   TEXT
) RETURNS TEXT
LANGUAGE plpgsql AS $$
DECLARE
  v_next_num INTEGER;
BEGIN
  INSERT INTO sequence_counters (store_id, prefix, last_value)
  VALUES (p_store_id, p_prefix, 1)
  ON CONFLICT (store_id, prefix)
  DO UPDATE SET last_value = sequence_counters.last_value + 1
  RETURNING last_value INTO v_next_num;

  RETURN p_prefix || LPAD(v_next_num::TEXT, 4, '0');
END;
$$;

-- ─────────────────────────────────────────────────────
-- 20. دليل الحسابات الافتراضي (يُنشأ لكل متجر جديد)
-- ─────────────────────────────────────────────────────
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

-- trigger: ينشئ الحسابات الافتراضية عند إنشاء متجر جديد
CREATE OR REPLACE FUNCTION handle_new_store()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- المالك أولاً حتى تنجح RLS عند إنشاء الحسابات
  INSERT INTO store_members (store_id, profile_id, role, joined_at)
  VALUES (NEW.id, NEW.owner_id, 'owner', NOW());

  PERFORM create_default_accounts(NEW.id);

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_store_created
  AFTER INSERT ON stores
  FOR EACH ROW EXECUTE PROCEDURE handle_new_store();

-- ─────────────────────────────────────────────────────
-- 21. Row Level Security (RLS)
-- ─────────────────────────────────────────────────────

ALTER TABLE profiles        ENABLE ROW LEVEL SECURITY;
ALTER TABLE stores          ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_members   ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories      ENABLE ROW LEVEL SECURITY;
ALTER TABLE products        ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers       ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders          ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items     ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts        ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices        ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_items   ENABLE ROW LEVEL SECURITY;
ALTER TABLE receipt_vouchers ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_vouchers ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers       ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance_parts    ENABLE ROW LEVEL SECURITY;

-- helper: هل المستخدم عضو في هذا المتجر؟
CREATE OR REPLACE FUNCTION is_store_member(p_store_id UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM store_members
    WHERE store_id = p_store_id
      AND profile_id = auth.uid()
      AND is_active = TRUE
  );
$$;

-- profiles: كل مستخدم يقرأ ويعدّل ملفه فقط
CREATE POLICY "profiles_select" ON profiles FOR SELECT USING (id = auth.uid());
CREATE POLICY "profiles_update" ON profiles FOR UPDATE USING (id = auth.uid());

-- stores: الأعضاء يقرؤون، المالك يعدّل
CREATE POLICY "stores_select" ON stores FOR SELECT
  USING (is_store_member(id));
CREATE POLICY "stores_insert" ON stores FOR INSERT
  WITH CHECK (owner_id = auth.uid());
CREATE POLICY "stores_update" ON stores FOR UPDATE
  USING (owner_id = auth.uid());

-- store_members
CREATE POLICY "members_select" ON store_members FOR SELECT
  USING (is_store_member(store_id));
CREATE POLICY "members_insert" ON store_members FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM stores WHERE id = store_id AND owner_id = auth.uid())
  );

-- سياسة عامة للجداول التابعة للمتجر
CREATE POLICY "categories_all"     ON categories     USING (is_store_member(store_id));
CREATE POLICY "products_all"       ON products       USING (is_store_member(store_id));
CREATE POLICY "stock_mvt_all"      ON stock_movements USING (is_store_member(store_id));
CREATE POLICY "customers_all"      ON customers      USING (is_store_member(store_id));
CREATE POLICY "orders_all"         ON orders         USING (is_store_member(store_id));
CREATE POLICY "order_items_all"    ON order_items    USING (
  EXISTS (SELECT 1 FROM orders o WHERE o.id = order_id AND is_store_member(o.store_id))
);
CREATE POLICY "accounts_all"       ON accounts       USING (is_store_member(store_id));
CREATE POLICY "invoices_all"       ON invoices       USING (is_store_member(store_id));
CREATE POLICY "invoice_items_all"  ON invoice_items  USING (
  EXISTS (SELECT 1 FROM invoices i WHERE i.id = invoice_id AND is_store_member(i.store_id))
);
CREATE POLICY "rv_all"             ON receipt_vouchers USING (is_store_member(store_id));
CREATE POLICY "pv_all"             ON payment_vouchers USING (is_store_member(store_id));
CREATE POLICY "ledger_all"         ON customer_ledger  USING (is_store_member(store_id));
CREATE POLICY "suppliers_all"      ON suppliers        USING (is_store_member(store_id));
CREATE POLICY "maintenance_all"    ON maintenance_requests USING (is_store_member(store_id));
CREATE POLICY "maint_parts_all"    ON maintenance_parts USING (
  EXISTS (SELECT 1 FROM maintenance_requests mr WHERE mr.id = request_id AND is_store_member(mr.store_id))
);

-- الجداول العامة (قراءة لأي مستخدم)
ALTER TABLE countries                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_companies          ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketplace_categories      ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_reviews               ENABLE ROW LEVEL SECURITY;
ALTER TABLE sequence_counters           ENABLE ROW LEVEL SECURITY;

CREATE POLICY "countries_public"        ON countries           FOR SELECT USING (TRUE);
CREATE POLICY "delivery_public"         ON delivery_companies  FOR SELECT USING (TRUE);
CREATE POLICY "mkt_categories_public"   ON marketplace_categories FOR SELECT USING (TRUE);
CREATE POLICY "reviews_public"          ON store_reviews       FOR SELECT USING (is_visible = TRUE);
CREATE POLICY "seq_counters_member"     ON sequence_counters   USING (is_store_member(store_id));
