// Square POSアプリ連携（ポイントオブセールAPI / モバイルWebディープリンク）
// 同一端末内で Square POS アプリを起動して決済し、コールバックで結果を受け取る。
// https://developer.squareup.com/docs/pos-api/build-mobile-web
import type { CheckoutData } from "@/lib/pos-types"

export const SQUARE_APP_ID = process.env.NEXT_PUBLIC_SQUARE_APPLICATION_ID

// Squareアプリ側で受け付ける支払い手段。複合会計は複数を渡してアプリ内で分割してもらう
export type SquareTender = "card" | "cash"

const IOS_TENDER: Record<SquareTender, string> = {
  // 日本ではeマネーも CREDIT_CARD 扱い
  card: "CREDIT_CARD",
  cash: "CASH",
}

const ANDROID_TENDER: Record<SquareTender, string> = {
  card: "com.squareup.pos.TENDER_CARD",
  cash: "com.squareup.pos.TENDER_CASH",
}

export type SquarePosResult =
  | { ok: true; transactionId?: string }
  | { ok: false; errorCode: string }

// Point of Sale API は「合計金額を1回渡す」インターフェースで、supported_tender_types に
// 複数指定してもアプリ側で分割はできない。そのため複合会計は
// 現金分 → クレペイ分 の2回に分けてアプリを起動する
export type SquarePhase = "cash" | "cashless"

export interface PendingSquareCheckout {
  sessionId: string
  data: CheckoutData
  createdAt: number
  // 複合会計のときだけ設定される。未設定なら単発の会計
  phase?: SquarePhase
  // 複合会計1段階目（現金）の取引ID。2段階目の完了時に一緒に記録する
  cashTransactionId?: string
  // Square アプリへ渡した金額。復帰できなかったときに決済履歴と照合するのに使う
  amount?: number
}

// 決済後に端末を閉じたまま時間が空くこともあるため長めに保持する。
// 期限内なら復帰時に「未処理の決済」として拾い上げて確認できる
const PENDING_TTL_MS = 3 * 60 * 60 * 1000

const pendingKey = (storeId: number) => `pos_square_pending_${storeId}`

function isIOS(): boolean {
  const ua = navigator.userAgent
  // iPadOS 13+ は Macintosh を名乗るため maxTouchPoints で判定
  return /iPhone|iPad|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1)
}

// Square POS アプリを起動するURLを返す。モバイル端末でなければ null。
// tender が単数なのは Point of Sale API が1回の起動で1つの支払い手段しか
// 精算できないため（複合会計は呼び出し側で2回に分ける）
export function buildSquarePosUrl(
  amount: number,
  callbackUrl: string,
  tender: SquareTender,
  note?: string,
): string | null {
  if (!SQUARE_APP_ID) return null

  if (isIOS()) {
    const data = {
      amount_money: { amount, currency_code: "JPY", currency: "JPY" },
      callback_url: callbackUrl,
      client_id: SQUARE_APP_ID,
      version: "1.3",
      notes: note,
      options: {
        supported_tender_types: [IOS_TENDER[tender]],
      },
    }
    return `square-commerce-v1://payment/create?data=${encodeURIComponent(JSON.stringify(data))}`
  }

  if (/Android/i.test(navigator.userAgent)) {
    return [
      "intent:#Intent",
      "action=com.squareup.pos.action.CHARGE",
      "package=com.squareup",
      `S.browser_fallback_url=${encodeURIComponent(callbackUrl)}`,
      `S.com.squareup.pos.WEB_CALLBACK_URI=${encodeURIComponent(callbackUrl)}`,
      `S.com.squareup.pos.CLIENT_ID=${SQUARE_APP_ID}`,
      "S.com.squareup.pos.API_VERSION=v2.0",
      `i.com.squareup.pos.TOTAL_AMOUNT=${amount}`,
      "S.com.squareup.pos.CURRENCY_CODE=JPY",
      `S.com.squareup.pos.TENDER_TYPES=${ANDROID_TENDER[tender]}`,
      ...(note ? [`S.com.squareup.pos.NOTE=${encodeURIComponent(note)}`] : []),
      "end",
    ].join(";")
  }

  return null
}

export function savePendingSquareCheckout(
  storeId: number,
  pending: Omit<PendingSquareCheckout, "createdAt">,
): void {
  const stored: PendingSquareCheckout = { ...pending, createdAt: Date.now() }
  localStorage.setItem(pendingKey(storeId), JSON.stringify(stored))
}

// 保留中の会計を保存してから Square アプリへ遷移する。
// 起動できない端末では何も保存せず false を返す（会計は記録されない）
export function startSquarePosPayment(
  storeId: number,
  pending: Omit<PendingSquareCheckout, "createdAt">,
  amount: number,
  tender: SquareTender,
): boolean {
  const callbackUrl = `${window.location.origin}${window.location.pathname}`
  const url = buildSquarePosUrl(amount, callbackUrl, tender, pending.data.customerName)
  if (!url) return false

  savePendingSquareCheckout(storeId, { ...pending, amount })
  window.location.href = url
  return true
}

export function loadPendingSquareCheckout(storeId: number): PendingSquareCheckout | null {
  const raw = localStorage.getItem(pendingKey(storeId))
  if (!raw) return null
  try {
    const pending = JSON.parse(raw) as PendingSquareCheckout
    if (Date.now() - pending.createdAt > PENDING_TTL_MS) return null
    return pending
  } catch {
    return null
  }
}

export function clearPendingSquareCheckout(storeId: number): void {
  localStorage.removeItem(pendingKey(storeId))
}

// コールバックURLのクエリから決済結果を取り出す。Square由来のパラメータがなければ null
export function parseSquareCallback(params: URLSearchParams): SquarePosResult | null {
  // Android
  const androidError = params.get("com.squareup.pos.ERROR_CODE")
  if (androidError) return { ok: false, errorCode: androidError }
  const androidTx = params.get("com.squareup.pos.SERVER_TRANSACTION_ID")
    ?? params.get("com.squareup.pos.CLIENT_TRANSACTION_ID")
  if (androidTx) return { ok: true, transactionId: params.get("com.squareup.pos.SERVER_TRANSACTION_ID") ?? undefined }

  // iOS: data=<JSON>
  const raw = params.get("data")
  if (!raw) return null
  try {
    const data = JSON.parse(raw) as {
      status?: string
      error_code?: string
      transaction_id?: string
      client_transaction_id?: string
    }
    if (data.status === "ok") return { ok: true, transactionId: data.transaction_id }
    if (data.status === "error") return { ok: false, errorCode: data.error_code ?? "unknown" }
    return null
  } catch {
    return null
  }
}
