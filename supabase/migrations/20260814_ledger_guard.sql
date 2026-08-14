-- ============================================================
-- 台帳（売上・経費）の保護
--
-- 匿名キーはブラウザに配布される公開値のため、アプリ側の制御だけでは
-- 過去データの改ざんを防げない。DB 側で以下を強制する。
--
--   1. 確定した会計は削除できない
--   2. 確定した会計の金額・日付は変更できない（取消・同期状態・備考のみ可）
--   3. 会計の取消は 7 日以内のみ
--   4. 会計は「いま記録したもの」しか追加できない（過去への差し込み禁止）
--   5. 経費は当日の営業日ぶんしか追加・変更できない
--
-- 営業日は店舗ごとの営業開始時刻で決まる（深夜営業のため、暦日とは一致
-- しない）。判定はアプリの getBusinessDate と同じ規則を DB 側にも置く。
-- ============================================================

-- ── 障害対応用のバイパス ──────────────────────────────────────────────
-- 通常の経路（anon / service_role）では発動しない。
-- 保守時に SET LOCAL app.ledger_bypass = 'on'; を明示した接続でのみ解除される。
CREATE OR REPLACE FUNCTION ledger_bypass()
RETURNS boolean
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT coalesce(current_setting('app.ledger_bypass', true), '') = 'on';
$$;

-- ── 店舗の「現在の営業日」──────────────────────────────────────────────
-- lib/pos-store.ts の getBusinessDate と同じ規則。
-- 営業開始時刻より前の時刻は前日の営業日として扱う。
CREATE OR REPLACE FUNCTION current_business_date(p_store_id bigint)
RETURNS text
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT to_char(
    CASE
      WHEN (now() AT TIME ZONE 'Asia/Tokyo')::time >= s.business_day_start_time
        THEN (now() AT TIME ZONE 'Asia/Tokyo')::date
      ELSE (now() AT TIME ZONE 'Asia/Tokyo')::date - 1
    END,
    'YYYY-MM-DD'
  )
  FROM stores s
  WHERE s.id = p_store_id;
$$;

-- ── payments: 列の保護と取消期限 ──────────────────────────────────────
-- 変更してよいのは canceled_at / cancel_reason / synced_to_sheet_at / note のみ。
-- 金額・日付・人数などが1つでも変わる更新は拒否する。
CREATE OR REPLACE FUNCTION payments_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF ledger_bypass() THEN
    RETURN NEW;
  END IF;

  IF NEW.id                 IS DISTINCT FROM OLD.id
  OR NEW.store_id           IS DISTINCT FROM OLD.store_id
  OR NEW.session_id         IS DISTINCT FROM OLD.session_id
  OR NEW.block_id           IS DISTINCT FROM OLD.block_id
  OR NEW.payment_datetime   IS DISTINCT FROM OLD.payment_datetime
  OR NEW.business_date      IS DISTINCT FROM OLD.business_date
  OR NEW.subtotal_amount    IS DISTINCT FROM OLD.subtotal_amount
  OR NEW.discount_amount    IS DISTINCT FROM OLD.discount_amount
  OR NEW.tax_amount         IS DISTINCT FROM OLD.tax_amount
  OR NEW.total_amount       IS DISTINCT FROM OLD.total_amount
  OR NEW.cash_amount        IS DISTINCT FROM OLD.cash_amount
  OR NEW.cashless_amount    IS DISTINCT FROM OLD.cashless_amount
  OR NEW.guest_count        IS DISTINCT FROM OLD.guest_count
  OR NEW.coupon_id          IS DISTINCT FROM OLD.coupon_id
  OR NEW.customer_name      IS DISTINCT FROM OLD.customer_name
  OR NEW.session_started_at IS DISTINCT FROM OLD.session_started_at
  OR NEW.square_payment_id  IS DISTINCT FROM OLD.square_payment_id
  OR NEW.is_new_customer    IS DISTINCT FROM OLD.is_new_customer
  OR NEW.happy_hour         IS DISTINCT FROM OLD.happy_hour
  OR NEW.paid_item_ids      IS DISTINCT FROM OLD.paid_item_ids
  THEN
    RAISE EXCEPTION '確定した会計の内容は変更できません（変更できるのは取消・同期状態・備考のみです）';
  END IF;

  -- 取消は7日以内。締めた後の売上を消せないようにする
  IF OLD.canceled_at IS NULL AND NEW.canceled_at IS NOT NULL
     AND NEW.payment_datetime < now() - interval '7 days'
  THEN
    RAISE EXCEPTION '会計から7日を過ぎた取消はできません';
  END IF;

  -- 取消の取り消し（復活）も認めない
  IF OLD.canceled_at IS NOT NULL AND NEW.canceled_at IS NULL THEN
    RAISE EXCEPTION '取消済みの会計は元に戻せません';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS payments_guard_trigger ON payments;
CREATE TRIGGER payments_guard_trigger
  BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION payments_guard();

-- ── RLS ポリシーの張り替え ────────────────────────────────────────────
-- これまでの anon_all（全操作許可）を、操作ごとの制限に置き換える。

-- payments
DROP POLICY IF EXISTS anon_all ON payments;

CREATE POLICY payments_select ON payments
  FOR SELECT TO anon USING (true);

-- 追加できるのは「いま記録した」会計のみ。過去への差し込みを防ぐ
CREATE POLICY payments_insert ON payments
  FOR INSERT TO anon
  WITH CHECK (
    ledger_bypass()
    OR (
      payment_datetime BETWEEN now() - interval '15 minutes' AND now() + interval '15 minutes'
      AND business_date = current_business_date(store_id)
    )
  );

-- 更新の可否は payments_guard トリガーが判断する
CREATE POLICY payments_update ON payments
  FOR UPDATE TO anon USING (true) WITH CHECK (true);

-- 削除は保守時のみ
CREATE POLICY payments_delete ON payments
  FOR DELETE TO anon USING (ledger_bypass());

-- daily_expenses: 当日の営業日ぶんのみ追加・変更できる
DROP POLICY IF EXISTS anon_all ON daily_expenses;

CREATE POLICY expenses_select ON daily_expenses
  FOR SELECT TO anon USING (true);

CREATE POLICY expenses_insert ON daily_expenses
  FOR INSERT TO anon
  WITH CHECK (ledger_bypass() OR business_date = current_business_date(store_id));

CREATE POLICY expenses_update ON daily_expenses
  FOR UPDATE TO anon
  USING (ledger_bypass() OR business_date = current_business_date(store_id))
  WITH CHECK (ledger_bypass() OR business_date = current_business_date(store_id));

CREATE POLICY expenses_delete ON daily_expenses
  FOR DELETE TO anon USING (ledger_bypass());

-- sessions: 明細の証跡として削除だけ禁止する（営業中は随時更新されるため）
DROP POLICY IF EXISTS anon_all ON sessions;

CREATE POLICY sessions_select ON sessions
  FOR SELECT TO anon USING (true);

CREATE POLICY sessions_insert ON sessions
  FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY sessions_update ON sessions
  FOR UPDATE TO anon USING (true) WITH CHECK (true);

CREATE POLICY sessions_delete ON sessions
  FOR DELETE TO anon USING (ledger_bypass());
