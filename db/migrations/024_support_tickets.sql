-- ==========================================
-- Migration 024: دعم الزبائن (Support Tickets)
-- تذاكر دعم + محادثة لكل تذكرة
-- ==========================================
SET search_path = public;

-- ─────────────────────────────────────────────────
-- 1. تذاكر الدعم
-- ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.support_tickets (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id       UUID        NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  ticket_number  TEXT        NOT NULL,
  customer_id    UUID        REFERENCES public.customers(id) ON DELETE SET NULL,
  customer_name  TEXT,
  customer_phone TEXT,
  subject        TEXT        NOT NULL,
  category       TEXT        NOT NULL DEFAULT 'inquiry'
                 CHECK (category IN ('inquiry','complaint','return','warranty','other')),
  status         TEXT        NOT NULL DEFAULT 'open'
                 CHECK (status IN ('open','in_progress','resolved','closed')),
  priority       TEXT        NOT NULL DEFAULT 'normal'
                 CHECK (priority IN ('normal','urgent')),
  channel        TEXT        NOT NULL DEFAULT 'store'
                 CHECK (channel IN ('store','whatsapp','phone','email','other')),
  assigned_to    TEXT,
  created_by     UUID        REFERENCES auth.users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at    TIMESTAMPTZ,
  UNIQUE(store_id, ticket_number)
);

CREATE INDEX IF NOT EXISTS idx_support_tickets_store  ON public.support_tickets(store_id, status);
CREATE INDEX IF NOT EXISTS idx_support_tickets_cust   ON public.support_tickets(customer_id);

-- ─────────────────────────────────────────────────
-- 2. رسائل/ردود التذكرة (محادثة)
-- ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.support_ticket_messages (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id   UUID        NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  sender      TEXT        NOT NULL DEFAULT 'staff'
              CHECK (sender IN ('staff','customer')),
  body        TEXT        NOT NULL,
  created_by  UUID        REFERENCES auth.users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_support_messages_ticket ON public.support_ticket_messages(ticket_id, created_at);

-- ─────────────────────────────────────────────────
-- 3. RLS — أعضاء المتجر فقط
-- ─────────────────────────────────────────────────
ALTER TABLE public.support_tickets         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_ticket_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "store_member_support_tickets"  ON public.support_tickets;
DROP POLICY IF EXISTS "store_member_support_messages" ON public.support_ticket_messages;

CREATE POLICY "store_member_support_tickets" ON public.support_tickets
  FOR ALL USING (is_store_member(store_id));

CREATE POLICY "store_member_support_messages" ON public.support_ticket_messages
  FOR ALL USING (
    ticket_id IN (SELECT id FROM public.support_tickets WHERE is_store_member(store_id))
  );
