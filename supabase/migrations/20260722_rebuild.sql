-- ============================================================
-- 2026-07-22 DB刷新マイグレーション
-- 目的: payments が旧設計（bigint id / block_session_id）のままで
--       アプリの書き込み（text id / session_id / block_id 等）が
--       全件失敗していたため、現行コードに合わせて売上系を再構築する。
-- 保持: stores / products / coupons / blocks / layout_elements（データ無傷）
-- 破棄: payments / sessions / daily_expenses（再作成）+ 旧設計の遺物7テーブル
-- 実行前バックアップ: supabase/backup-20260722/*.json
-- ============================================================

-- ── 1. 旧設計の遺物テーブルを削除（現行コードは一切参照していない） ──
DROP TABLE IF EXISTS block_sessions CASCADE;
DROP TABLE IF EXISTS order_items CASCADE;
DROP TABLE IF EXISTS payment_items CASCADE;
DROP TABLE IF EXISTS daily_reports CASCADE;
DROP TABLE IF EXISTS product_categories CASCADE;
DROP TABLE IF EXISTS service_blocks CASCADE;
DROP TABLE IF EXISTS sheet_registry CASCADE;

-- ── 2. 売上系テーブルを現行コードの形で再作成 ──────────────────────

DROP TABLE IF EXISTS payments CASCADE;
DROP TABLE IF EXISTS sessions CASCADE;
DROP TABLE IF EXISTS daily_expenses CASCADE;

-- sessions: lib/api/sessions.ts の sessionToRow / rowToSession と一致
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  store_id BIGINT NOT NULL DEFAULT 1 REFERENCES stores(id),
  block_id TEXT NOT NULL,
  linked_block_ids TEXT[],
  order_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  guest_count INTEGER NOT NULL DEFAULT 1,
  note TEXT,
  customer_name TEXT,
  happy_hour BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX idx_sessions_store ON sessions (store_id);

-- payments: lib/api/payments-db.ts の paymentToRow / rowToPayment と一致
CREATE TABLE payments (
  id TEXT PRIMARY KEY,
  store_id BIGINT NOT NULL DEFAULT 1 REFERENCES stores(id),
  session_id TEXT NOT NULL,
  block_id TEXT NOT NULL,
  payment_datetime TIMESTAMPTZ NOT NULL,
  business_date TEXT NOT NULL,
  subtotal_amount INTEGER NOT NULL,
  discount_amount INTEGER NOT NULL DEFAULT 0,
  tax_amount INTEGER NOT NULL DEFAULT 0,
  total_amount INTEGER NOT NULL,
  cash_amount INTEGER NOT NULL DEFAULT 0,
  cashless_amount INTEGER NOT NULL DEFAULT 0,
  guest_count INTEGER NOT NULL DEFAULT 1,
  note TEXT,
  canceled_at TIMESTAMPTZ,
  cancel_reason TEXT,
  paid_item_ids JSONB,
  coupon_id TEXT,
  customer_name TEXT,
  session_started_at TIMESTAMPTZ,
  synced_to_sheet_at TIMESTAMPTZ,
  square_payment_id TEXT
);
CREATE INDEX idx_payments_store_date ON payments (store_id, business_date);
CREATE INDEX idx_payments_unsynced ON payments (store_id)
  WHERE synced_to_sheet_at IS NULL AND canceled_at IS NULL;

-- daily_expenses: lib/api/expenses-db.ts と一致（店舗×営業日で1行）
CREATE TABLE daily_expenses (
  store_id BIGINT NOT NULL DEFAULT 1 REFERENCES stores(id),
  business_date TEXT NOT NULL,
  receipt_count INTEGER NOT NULL DEFAULT 0,
  amount INTEGER NOT NULL DEFAULT 0,
  handover_note TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, business_date)
);

-- ── 3. RLS: 全テーブルのポリシーを anon_all（TO anon）に統一 ────────
-- アプリは anon キーのみ使用。GAS は service_role で RLS をバイパスする。

DO $$
DECLARE p record;
BEGIN
  FOR p IN SELECT tablename, policyname FROM pg_policies WHERE schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, p.tablename);
  END LOOP;
END $$;

ALTER TABLE stores          ENABLE ROW LEVEL SECURITY;
ALTER TABLE products        ENABLE ROW LEVEL SECURITY;
ALTER TABLE coupons         ENABLE ROW LEVEL SECURITY;
ALTER TABLE blocks          ENABLE ROW LEVEL SECURITY;
ALTER TABLE layout_elements ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments        ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_expenses  ENABLE ROW LEVEL SECURITY;

CREATE POLICY anon_all ON stores          FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY anon_all ON products        FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY anon_all ON coupons         FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY anon_all ON blocks          FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY anon_all ON layout_elements FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY anon_all ON sessions        FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY anon_all ON payments        FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY anon_all ON daily_expenses  FOR ALL TO anon USING (true) WITH CHECK (true);

-- ── 4. Realtime: アプリが購読する全テーブルを publication に登録 ────

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['stores','products','coupons','blocks','layout_elements','sessions','payments','daily_expenses']
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;

-- RLS 有効テーブルで postgres_changes を受信するために必須
ALTER TABLE stores          REPLICA IDENTITY FULL;
ALTER TABLE products        REPLICA IDENTITY FULL;
ALTER TABLE coupons         REPLICA IDENTITY FULL;
ALTER TABLE blocks          REPLICA IDENTITY FULL;
ALTER TABLE layout_elements REPLICA IDENTITY FULL;
ALTER TABLE sessions        REPLICA IDENTITY FULL;
ALTER TABLE payments        REPLICA IDENTITY FULL;
ALTER TABLE daily_expenses  REPLICA IDENTITY FULL;
