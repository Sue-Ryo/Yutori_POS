// Square POSアプリ連携（ポイントオブセールAPI / モバイルWebディープリンク）
// 同一端末内で Square POS アプリを起動して決済し、コールバックで結果を受け取る。
// https://developer.squareup.com/docs/pos-api/build-mobile-web
import type { CheckoutData } from "@/lib/pos-types"

export const SQUARE_APP_ID = process.env.NEXT_PUBLIC_SQUARE_APPLICATION_ID

export type SquarePosResult =
  | { ok: true; transactionId?: string }
  | { ok: false; errorCode: string }

export interface PendingSquareCheckout {
  sessionId: string
  data: CheckoutData
  createdAt: number
}

// 起動から復帰までの想定上限。これを超えた保留会計は破棄する
const PENDING_TTL_MS = 15 * 60 * 1000

const pendingKey = (storeId: number) => `pos_square_pending_${storeId}`

function isIOS(): boolean {
  const ua = navigator.userAgent
  // iPadOS 13+ は Macintosh を名乗るため maxTouchPoints で判定
  return /iPhone|iPad|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1)
}

// Square POS アプリを起動するURLを返す。モバイル端末でなければ null
export function buildSquarePosUrl(amount: number, callbackUrl: string, note?: string): string | null {
  if (!SQUARE_APP_ID) return null

  if (isIOS()) {
    const data = {
      amount_money: { amount, currency_code: "JPY", currency: "JPY" },
      callback_url: callbackUrl,
      client_id: SQUARE_APP_ID,
      version: "1.3",
      notes: note,
      options: {
        // カード決済（日本ではeマネーも CREDIT_CARD 扱い）
        supported_tender_types: ["CREDIT_CARD"],
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
      "S.com.squareup.pos.TENDER_TYPES=com.squareup.pos.TENDER_CARD",
      ...(note ? [`S.com.squareup.pos.NOTE=${encodeURIComponent(note)}`] : []),
      "end",
    ].join(";")
  }

  return null
}

export function savePendingSquareCheckout(storeId: number, sessionId: string, data: CheckoutData): void {
  const pending: PendingSquareCheckout = { sessionId, data, createdAt: Date.now() }
  localStorage.setItem(pendingKey(storeId), JSON.stringify(pending))
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
