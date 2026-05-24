-- ============================================================
-- POSシステム リアルタイム同期用テーブル
-- Supabase SQL Editorで実行してください
-- ============================================================

-- blocks テーブル
CREATE TABLE IF NOT EXISTS blocks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  block_type TEXT NOT NULL,
  x REAL NOT NULL,
  y REAL NOT NULL,
  width REAL NOT NULL,
  height REAL NOT NULL,
  rotation REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'empty',
  capacity INTEGER NOT NULL DEFAULT 1,
  started_at TIMESTAMPTZ,
  checked_out_at TIMESTAMPTZ
);

-- sessions テーブル
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
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

-- payments テーブル
CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
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
  paid_item_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  coupon_id TEXT,
  customer_name TEXT,
  session_started_at TIMESTAMPTZ,
  synced_to_sheet_at TIMESTAMPTZ
);

-- layout_elements テーブル
CREATE TABLE IF NOT EXISTS layout_elements (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  x REAL NOT NULL,
  y REAL NOT NULL,
  width REAL NOT NULL,
  height REAL NOT NULL,
  rotation REAL NOT NULL DEFAULT 0,
  label TEXT
);

-- pos_settings テーブル（1行固定）
CREATE TABLE IF NOT EXISTS pos_settings (
  id INTEGER PRIMARY KEY DEFAULT 1,
  store_name TEXT NOT NULL DEFAULT 'ゆとり',
  business_day_start_time TEXT NOT NULL DEFAULT '18:00',
  tax_rate REAL NOT NULL DEFAULT 10,
  checked_out_display_seconds INTEGER NOT NULL DEFAULT 10,
  CONSTRAINT single_row CHECK (id = 1)
);

INSERT INTO pos_settings (id, store_name, business_day_start_time, tax_rate, checked_out_display_seconds)
VALUES (1, 'ゆとり', '18:00', 10, 10)
ON CONFLICT (id) DO NOTHING;

-- coupons テーブル
CREATE TABLE IF NOT EXISTS coupons (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  discount_type TEXT NOT NULL,
  discount_value REAL NOT NULL,
  valid_from TEXT,
  valid_to TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true
);

INSERT INTO coupons (id, name, discount_type, discount_value, is_active) VALUES
  ('c1', 'ウェルカムクーポン', 'amount', 500, true),
  ('c2', 'リピーター割引10%', 'rate', 10, true)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- RLS（Row Level Security）設定
-- anonキーで全操作を許可（店内POS専用）
-- ============================================================

ALTER TABLE blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE layout_elements ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE coupons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_all" ON blocks FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON sessions FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON payments FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON layout_elements FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON pos_settings FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON coupons FOR ALL TO anon USING (true) WITH CHECK (true);

-- daily_expenses テーブル
CREATE TABLE IF NOT EXISTS daily_expenses (
  business_date TEXT PRIMARY KEY,
  receipt_count INTEGER NOT NULL DEFAULT 0,
  amount        INTEGER NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE daily_expenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_all" ON daily_expenses FOR ALL TO anon USING (true) WITH CHECK (true);

-- ============================================================
-- Realtime 有効化
-- ============================================================

ALTER PUBLICATION supabase_realtime ADD TABLE blocks;
ALTER PUBLICATION supabase_realtime ADD TABLE sessions;
ALTER PUBLICATION supabase_realtime ADD TABLE payments;
ALTER PUBLICATION supabase_realtime ADD TABLE layout_elements;
ALTER PUBLICATION supabase_realtime ADD TABLE daily_expenses;
