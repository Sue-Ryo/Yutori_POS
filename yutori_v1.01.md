# 要件定義書：店舗向け卓番管理＆会計システム（最新版）

---

# 1. システム概要

飲食店、バー、シーシャ店などの小規模店舗向けに、  
店舗レイアウト上で卓（利用ブロック）を管理し、注文・提供・会計までを一元管理するPOSシステム。

スタッフが直感的に操作できるUIを重視し、画面遷移を最小限に抑える。  
深夜営業店舗に対応した営業日管理、個別会計、自由なレイアウト編集機能を備える。

本システムでは、レイアウト上に配置された各ブロックを注文・滞在・会計の管理単位とする。

---

# 2. 利用者区分

| 区分 | 利用内容 |
|---|---|
| スタッフ | 卓管理、注文登録、提供管理、会計 |
| 店長 | 売上確認、日計確認、会計修正 |
| 管理者 | 商品設定、クーポン設定、レイアウト編集、店舗設定 |

---

# 3. 画面一覧

| 画面ID | 画面名 |
|---|---|
| SCR-01 | フロア管理画面 |
| SCR-02 | 注文入力画面 |
| SCR-03 | 会計画面 |
| SCR-04 | 日計画面 |
| SCR-05 | 商品マスタ管理画面 |
| SCR-06 | レイアウト編集画面 |
| SCR-07 | 店舗設定画面 |

---

# 4. 機能要件

---

# 4.1 フロア管理機能（メイン画面）

## 概要
店舗レイアウトを表示し、各利用ブロックの状態をリアルタイム管理する。

## 表示項目
- ブロック名
- ステータス
- 滞在時間
- 提供経過時間

## ステータス表示

| 状態 | 色 | 説明 |
|---|---|---|
| 空席 | グレー | 利用なし |
| 使用中 | 赤 | 注文あり |
| 提供待ち | 黄 | 未提供商品あり |
| 会計済 | 青 | 会計完了直後（一定時間表示） |

## 操作機能
- ブロックタップで操作メニュー表示
- 注文追加
- 会計開始
- 利用情報確認
- ブロック移動（任意）

## 滞在時間表示
- 利用開始時刻から現在までの経過時間を自動表示する

## 提供経過時間表示
- シーシャ等の商品提供開始後、提供開始時刻からの経過時間を表示する
- スタッフが炭替え・様子確認の目安として利用する

---

# 4.2 注文管理機能

## 商品選択
- 商品カテゴリごとに一覧表示
- 商品タップで注文追加
- 数量変更（＋ / －）

## 注文情報
1明細ごとに以下を保持する。

- 商品名
- 単価
- 数量
- 小計
- オプションメモ
- 注文時刻
- 提供状態
- 提供開始時刻

## オプション管理
- メモ入力可能  
  例：氷少なめ、甘さ控えめ、フレーバー変更

## 提供管理
- 提供済 / 未提供 をワンタップ切替

## 提供開始記録
- 商品提供開始時刻を記録する
- 提供経過時間の算出基準とする

## 注文取消
- 未会計商品のみ取消可能

---

# 4.3 会計機能

## 決済区分
- 現金
- クレペイ（カード、QR、電子決済）

## 会計処理
- 合計金額表示
- 税込計算
- 割引適用
- 預かり金入力
- 釣銭計算

## 個別会計
- 商品明細単位で支払対象を選択可能
- 支払済商品は再選択不可

## 会計完了時処理
- 対象明細を会計済へ更新
- 利用ブロックを空席化
- 売上データへ反映
- 利用終了時刻を記録

## 会計取消
- 完了済会計を取消可能
- 対象明細を未会計へ戻す
- 利用ブロックを使用中へ戻す

---

# 4.4 日計・集計機能

## 表示項目
- 売上合計
- 現金売上
- クレペイ売上
- 客数
- 組数
- 客単価
- 経費
- 利益
- 引継ぎメモ

## 条件
- 営業日単位で表示
- CSV出力可能

---

# 4.5 レイアウト編集機能

## 概要
店舗フロアをブロック単位で自由に作成・編集する。

## ブロック定義
レイアウト上の1つの表示ブロックを、注文・滞在・会計の管理単位とする。

## 配置可能ブロック例
- 椅子席
- ソファ席
- カウンター席
- 個室
- 壁
- カウンター設備
- 通路

## 操作機能
- ドラッグ配置
- サイズ変更
- 回転（90度単位）
- 削除
- 保存

## レイアウト例
- 椅子席：1x1サイズ
- ソファ席：2x1サイズ
- 大卓：2x2サイズ
- カウンター席：1x1サイズを連続配置

---

# 4.6 マスタ管理機能

## 商品マスタ
- 商品名
- 金額
- カテゴリ
- 表示順
- 有効 / 無効

## クーポンマスタ
- クーポン名
- 割引額
- 割引率
- 有効期限
- 有効 / 無効

---

# 4.7 店舗設定機能

## 設定項目
- 店舗名
- 営業開始時刻
- 営業終了時刻
- 税率
- 会計済表示時間
- CSV出力設定

---

# 5. 非機能要件

## 性能
- ブロックタップ後1秒以内に操作メニュー表示
- 会計確定3秒以内

## 利便性
- タブレット対応
- PC対応
- スマホ簡易対応

## セキュリティ
- ログイン認証あり
- 権限別メニュー制御
- 会計取消ログ保存

## バックアップ
- 日次自動バックアップ

---

# 6. データベース設計

---

# stores
- id
- name
- business_day_start_time
- created_at
- updated_at

# users
- id
- store_id
- name
- role
- email
- password_hash
- is_active
- created_at
- updated_at

# service_blocks
- id
- store_id
- block_code
- block_name
- block_type
- capacity
- pos_x
- pos_y
- width
- height
- rotation
- is_active
- created_at
- updated_at

# block_sessions
- id
- store_id
- service_block_id
- status
- started_at
- ended_at
- guest_count
- memo
- created_by
- created_at
- updated_at

# product_categories
- id
- store_id
- name
- display_order
- created_at
- updated_at

# products
- id
- store_id
- category_id
- name
- price
- is_active
- display_order
- created_at
- updated_at

# coupons
- id
- store_id
- name
- discount_type
- discount_value
- valid_from
- valid_to
- is_active
- created_at
- updated_at

# order_items
- id
- store_id
- block_session_id
- product_id
- product_name_snapshot
- unit_price_snapshot
- quantity
- subtotal_amount
- option_memo
- serving_status
- served_at
- is_paid
- paid_at
- created_at
- updated_at

# payments
- id
- store_id
- block_session_id
- payment_datetime
- business_date
- subtotal_amount
- discount_amount
- total_amount
- cash_amount
- cashless_amount
- guest_count
- note
- canceled_at
- canceled_by
- cancel_reason
- created_by
- created_at
- updated_at

# payment_items
- id
- payment_id
- order_item_id
- amount
- created_at

# daily_reports
- id
- store_id
- business_date
- sales_amount
- cash_amount
- cashless_amount
- guest_count
- group_count
- expense_amount
- profit_amount
- handover_note
- created_at
- updated_at

---

# 7. 固有ロジック

## 営業日判定
設定された営業開始時刻を跨ぐまでを同一営業日とする。

例：営業開始時刻 18:00

| 時刻 | 営業日 |
|---|---|
| 4/1 23:00 | 4/1営業 |
| 4/2 02:00 | 4/1営業 |
| 4/2 18:30 | 4/2営業 |

## 滞在時間計測
- 利用開始時に `started_at` を記録する
- 会計完了時に `ended_at` を記録する
- 滞在時間 = ended_at - started_at

## 提供経過時間計測
- 商品提供開始時に `served_at` を記録する
- 現在時刻との差分を提供経過時間として表示する

## 客単価計算
客単価 = 売上 ÷ 客数

## 利益計算
利益 = 売上 - 経費

---

# 8. 今後追加候補（拡張機能）

- キッチンモニター連携
- レシート印刷
- 在庫管理
- スタッフ勤怠連携
- モバイルオーダー
- LINE予約連携
- 顧客管理
- ポイント機能
- 指名管理
- 売上分析ダッシュボード