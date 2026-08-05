import { describe, it, expect, beforeAll, afterEach } from "vitest"
import type { SquareTender } from "../square-pos-link"

// SQUARE_APP_ID はモジュール読み込み時に確定するため、import より前に環境変数を入れる
process.env.NEXT_PUBLIC_SQUARE_APPLICATION_ID = "sq0idp-test"

type BuildFn = (
  amount: number,
  callbackUrl: string,
  tender: SquareTender,
  note?: string,
) => string | null

let buildSquarePosUrl: BuildFn

beforeAll(async () => {
  ;({ buildSquarePosUrl } = await import("../square-pos-link"))
})

function setUserAgent(userAgent: string, maxTouchPoints = 0) {
  Object.defineProperty(globalThis, "navigator", {
    value: { userAgent, maxTouchPoints },
    configurable: true,
  })
}

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15"
const IPAD = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15"
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36"
const DESKTOP = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"

const CALLBACK = "https://pos.example.com/"

// iOS の deep link から options.supported_tender_types を取り出す
function iosTenders(url: string): string[] {
  const json = decodeURIComponent(url.replace("square-commerce-v1://payment/create?data=", ""))
  return JSON.parse(json).options.supported_tender_types
}

// Android intent URL から任意のキーの値を取り出す
function intentValue(url: string, key: string): string | undefined {
  return url.split(";").find((p) => p.startsWith(`${key}=`))?.slice(key.length + 1)
}

afterEach(() => {
  Object.defineProperty(globalThis, "navigator", { value: undefined, configurable: true })
})

describe("buildSquarePosUrl / iOS", () => {
  it("現金会計は CASH のみを許可する", () => {
    setUserAgent(IPHONE)
    expect(iosTenders(buildSquarePosUrl(3000, CALLBACK, "cash")!)).toEqual(["CASH"])
  })

  it("カード会計は CREDIT_CARD のみを許可する", () => {
    setUserAgent(IPHONE)
    expect(iosTenders(buildSquarePosUrl(3000, CALLBACK, "card")!)).toEqual(["CREDIT_CARD"])
  })

  it("金額・コールバック・備考を渡す", () => {
    setUserAgent(IPHONE)
    const url = buildSquarePosUrl(4200, CALLBACK, "cash", "山田様")!
    const data = JSON.parse(
      decodeURIComponent(url.replace("square-commerce-v1://payment/create?data=", "")),
    )
    expect(data.amount_money).toEqual({ amount: 4200, currency_code: "JPY", currency: "JPY" })
    expect(data.callback_url).toBe(CALLBACK)
    expect(data.notes).toBe("山田様")
  })

  it("iPadOS はタッチ数で iOS と判定する", () => {
    setUserAgent(IPAD, 5)
    expect(buildSquarePosUrl(3000, CALLBACK, "cash")).toMatch(/^square-commerce-v1:/)
  })

  // Point of Sale API は1回の起動で1つの tender しか精算できないため、
  // 複合会計は現金分・クレペイ分を別々の金額で2回起動する
  it("複合会計は現金分とクレペイ分を別々の金額・tenderで起動する", () => {
    setUserAgent(IPHONE)
    const cashLeg = buildSquarePosUrl(2000, CALLBACK, "cash")!
    const cardLeg = buildSquarePosUrl(1800, CALLBACK, "card")!

    expect(iosTenders(cashLeg)).toEqual(["CASH"])
    expect(iosTenders(cardLeg)).toEqual(["CREDIT_CARD"])

    const amountOf = (url: string) =>
      JSON.parse(decodeURIComponent(url.replace("square-commerce-v1://payment/create?data=", "")))
        .amount_money.amount
    expect(amountOf(cashLeg)).toBe(2000)
    expect(amountOf(cardLeg)).toBe(1800)
  })
})

describe("buildSquarePosUrl / Android", () => {
  it("現金会計は TENDER_CASH を渡す", () => {
    setUserAgent(ANDROID)
    const url = buildSquarePosUrl(3000, CALLBACK, "cash")!
    expect(intentValue(url, "S.com.squareup.pos.TENDER_TYPES")).toBe("com.squareup.pos.TENDER_CASH")
  })

  it("カード会計は TENDER_CARD を渡す", () => {
    setUserAgent(ANDROID)
    const url = buildSquarePosUrl(3000, CALLBACK, "card")!
    expect(intentValue(url, "S.com.squareup.pos.TENDER_TYPES")).toBe("com.squareup.pos.TENDER_CARD")
  })

  it("金額とコールバックを渡す", () => {
    setUserAgent(ANDROID)
    const url = buildSquarePosUrl(4200, CALLBACK, "card")!
    expect(intentValue(url, "i.com.squareup.pos.TOTAL_AMOUNT")).toBe("4200")
    expect(intentValue(url, "S.com.squareup.pos.WEB_CALLBACK_URI")).toBe(encodeURIComponent(CALLBACK))
  })
})

describe("buildSquarePosUrl / 起動できない場合", () => {
  it("PCブラウザでは null を返す", () => {
    setUserAgent(DESKTOP)
    expect(buildSquarePosUrl(3000, CALLBACK, "cash")).toBeNull()
  })
})
