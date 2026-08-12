-- ハッピーアワー適用フラグを会計側にも残す。
-- sessions.happy_hour は下膳（stripGuestInfo）で false に戻るため、
-- 売上レポートの履歴からは適用有無が分からなくなっていた。
-- is_new_customer と同じく、会計時に sessions の値を payments へコピーする。
--
-- NULL 許容にして「列追加前の会計（不明）」と「未適用（false）」を区別する。
-- 不明の場合はアプリ側が伝票の値へフォールバックする。
ALTER TABLE payments ADD COLUMN IF NOT EXISTS happy_hour BOOLEAN;
