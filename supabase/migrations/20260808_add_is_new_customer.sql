-- 新規客フラグ: その来店が新規客かどうかを記録する。
-- sessions は接客中の目印用、payments は日報・スプレッドシートの集計用。
-- 会計時に sessions の値を payments へコピーする。
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS is_new_customer BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS is_new_customer BOOLEAN NOT NULL DEFAULT false;
