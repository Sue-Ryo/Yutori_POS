import { describe, it, expect } from "vitest"
import {
  isHhTarget,
  calcHhSubtotal,
  HAPPY_HOUR_BASE,
  DRINK_CAP_PER_PERSON,
  HH_EXCLUDED_NAMES,
  splitRoundGuestCount,
  type HhItem,
} from "../hh-calc"

const CAT: Record<string, string> = {}

const item = (
  name: string,
  category: string,
  price: number,
  qty = 1,
): HhItem => ({
  id: name,
  productId: name,
  name,
  category,
  subtotal: price * qty,
})

// ── isHhTarget ────────────────────────────────────────────────
describe("isHhTarget", () => {
  it("Shisha (system) → HH対象", () => {
    expect(isHhTarget(item("Shisha", "system", 2800), CAT)).toBe(true)
  })

  it("Charge (system) → HH対象", () => {
    expect(isHhTarget(item("Charge", "system", 500), CAT)).toBe(true)
  })

  it.each(HH_EXCLUDED_NAMES)("%s (system) → HH対象外", (name) => {
    expect(isHhTarget(item(name, "system", 800), CAT)).toBe(false)
  })

  it("drink カテゴリ → HH対象", () => {
    expect(isHhTarget(item("Heineken", "drink", 800), CAT)).toBe(true)
  })

  it("alcohol カテゴリ → HH対象", () => {
    expect(isHhTarget(item("Heineken", "alcohol", 800), CAT)).toBe(true)
  })

  it("softdrink カテゴリ → HH対象", () => {
    expect(isHhTarget(item("Cola", "softdrink", 600), CAT)).toBe(true)
  })

  it("未知カテゴリ → HH対象外", () => {
    expect(isHhTarget(item("Other", "food", 500), CAT)).toBe(false)
  })
})

// ── calcHhSubtotal ────────────────────────────────────────────
describe("calcHhSubtotal", () => {
  it("1名 system(Shisha+Charge)のみ → 基本料金のみ", () => {
    const items = [item("Shisha", "system", 2800), item("Charge", "system", 500)]
    const r = calcHhSubtotal(items, 1, CAT)
    expect(r.happyHourCharge).toBe(HAPPY_HOUR_BASE)
    expect(r.drinkOverage).toBe(0)
    expect(r.nonHhSubtotal).toBe(0)
    expect(r.subtotal).toBe(HAPPY_HOUR_BASE)
  })

  it("2名 system(Shisha+Charge)のみ → 基本料金×2", () => {
    const items = [item("Shisha", "system", 2800), item("Charge", "system", 500)]
    const r = calcHhSubtotal(items, 2, CAT)
    expect(r.happyHourCharge).toBe(HAPPY_HOUR_BASE * 2)
    expect(r.subtotal).toBe(HAPPY_HOUR_BASE * 2)
  })

  it("Dark Leaf → nonHhSubtotal に実額加算", () => {
    const items = [item("Shisha", "system", 2800), item("Dark Leaf", "system", 800)]
    const r = calcHhSubtotal(items, 1, CAT)
    expect(r.nonHhSubtotal).toBe(800)
    expect(r.subtotal).toBe(HAPPY_HOUR_BASE + 800)
  })

  it("Ice Hose → nonHhSubtotal に実額加算", () => {
    const items = [item("Shisha", "system", 2800), item("Ice Hose", "system", 500)]
    const r = calcHhSubtotal(items, 1, CAT)
    expect(r.nonHhSubtotal).toBe(500)
    expect(r.subtotal).toBe(HAPPY_HOUR_BASE + 500)
  })

  it("drink ¥600以下(1名) → 超過なし", () => {
    const items = [item("Shisha", "system", 2800), item("Beer", "drink", 600)]
    const r = calcHhSubtotal(items, 1, CAT)
    expect(r.drinkOverage).toBe(0)
    expect(r.subtotal).toBe(HAPPY_HOUR_BASE)
  })

  it("drink ¥800(1名) → 超過¥200が加算", () => {
    const items = [item("Shisha", "system", 2800), item("Heineken", "drink", 800)]
    const r = calcHhSubtotal(items, 1, CAT)
    expect(r.drinkOverage).toBe(800 - DRINK_CAP_PER_PERSON)
    expect(r.subtotal).toBe(HAPPY_HOUR_BASE + 200)
  })

  it("drink ¥800×2本(1名) → 超過¥1000が加算", () => {
    const items = [
      item("Shisha", "system", 2800),
      item("Heineken", "drink", 800),
      item("Corona", "drink", 800),
    ]
    const r = calcHhSubtotal(items, 1, CAT)
    expect(r.drinkSubtotal).toBe(1600)
    expect(r.drinkOverage).toBe(1600 - DRINK_CAP_PER_PERSON)
    expect(r.subtotal).toBe(HAPPY_HOUR_BASE + 1000)
  })

  it("drink ¥800(2名) → 1人¥400なので超過なし", () => {
    const items = [item("Shisha", "system", 2800), item("Heineken", "drink", 800)]
    const r = calcHhSubtotal(items, 2, CAT)
    expect(r.drinkOverage).toBe(0)
    expect(r.subtotal).toBe(HAPPY_HOUR_BASE * 2)
  })

  it("全商品混在(1名) → 正しく分類される", () => {
    // Shisha: HH対象, Dark Leaf: その他, Heineken(¥800): drink超過¥200
    const items = [
      item("Shisha", "system", 2800),
      item("Dark Leaf", "system", 800),
      item("Heineken", "drink", 800),
    ]
    const r = calcHhSubtotal(items, 1, CAT)
    expect(r.happyHourCharge).toBe(HAPPY_HOUR_BASE)
    expect(r.drinkOverage).toBe(200)
    expect(r.nonHhSubtotal).toBe(800) // Dark Leaf
    expect(r.subtotal).toBe(HAPPY_HOUR_BASE + 200 + 800)
  })

  it("alcohol ¥800(1名) → 超過¥200が加算", () => {
    const items = [item("Shisha", "system", 2800), item("Heineken", "alcohol", 800)]
    const r = calcHhSubtotal(items, 1, CAT)
    expect(r.drinkSubtotal).toBe(800)
    expect(r.drinkOverage).toBe(200)
    expect(r.subtotal).toBe(HAPPY_HOUR_BASE + 200)
  })

  it("softdrink ¥600以下(1名) → 超過なし", () => {
    const items = [item("Shisha", "system", 2800), item("Cola", "softdrink", 500)]
    const r = calcHhSubtotal(items, 1, CAT)
    expect(r.drinkSubtotal).toBe(500)
    expect(r.drinkOverage).toBe(0)
    expect(r.subtotal).toBe(HAPPY_HOUR_BASE)
  })

  it("alcohol+softdrink 合算で上限判定(1名)", () => {
    // alcohol¥400 + softdrink¥400 = ¥800 → 超過¥200
    const items = [
      item("Shisha", "system", 2800),
      item("Beer", "alcohol", 400),
      item("Cola", "softdrink", 400),
    ]
    const r = calcHhSubtotal(items, 1, CAT)
    expect(r.drinkSubtotal).toBe(800)
    expect(r.drinkOverage).toBe(200)
    expect(r.subtotal).toBe(HAPPY_HOUR_BASE + 200)
  })
})

describe("splitRoundGuestCount（分割会計のHH人数配分）", () => {
  // 各回に配分した人数の合計。最終回は残り全部を精算する扱い
  const distribute = (guestCount: number, rounds: number) =>
    Array.from({ length: rounds }, (_, i) =>
      splitRoundGuestCount(guestCount, rounds, i, i === rounds - 1),
    )

  it("人数が回数で割り切れるときは均等に配る", () => {
    expect(distribute(3, 3)).toEqual([1, 1, 1])
    expect(distribute(4, 2)).toEqual([2, 2])
  })

  it("端数は先の回が1名ずつ多く受け持つ", () => {
    expect(distribute(5, 3)).toEqual([2, 2, 1])
    expect(distribute(3, 2)).toEqual([2, 1])
  })

  it("回数が人数より多くても合計は人数に一致する", () => {
    expect(distribute(1, 3)).toEqual([1, 0, 0])
    expect(distribute(2, 5)).toEqual([1, 1, 0, 0, 0])
  })

  it("どの分割でも合計が全体の人数に一致する", () => {
    for (let guests = 1; guests <= 8; guests++) {
      for (let rounds = 1; rounds <= 6; rounds++) {
        const total = distribute(guests, rounds).reduce((s, n) => s + n, 0)
        expect(total).toBe(guests)
      }
    }
  })

  it("途中の回で残り全部を精算したら、未計上の人数をまとめて引き受ける", () => {
    // 3名3分割で1回目を終え、2回目で残り全部を精算 → 2名ぶん
    expect(splitRoundGuestCount(3, 3, 1, true)).toBe(2)
  })

  it("分割の合計金額が一括会計と一致する", () => {
    const guests = 3
    const rounds = 3
    // 3名でビール¥600×6杯（1回あたり2杯）+ シーシャ¥3,000
    const lump = calcHhSubtotal(
      [item("Shisha", "system", 3000), item("Beer", "alcohol", 600, 6)],
      guests,
      CAT,
    )
    const splitTotal = Array.from({ length: rounds }, (_, i) =>
      calcHhSubtotal(
        // シーシャは1回目の会計に含める
        i === 0
          ? [item("Shisha", "system", 3000), item(`Beer${i}`, "alcohol", 600, 2)]
          : [item(`Beer${i}`, "alcohol", 600, 2)],
        splitRoundGuestCount(guests, rounds, i, i === rounds - 1),
        CAT,
      ).subtotal,
    ).reduce((s, n) => s + n, 0)

    expect(lump.subtotal).toBe(HAPPY_HOUR_BASE * guests + 1800)
    expect(splitTotal).toBe(lump.subtotal)
  })
})

describe("3席連結・HH適用・3分割の合計（実運用ケース）", () => {
  // Shisha/Charge/コーラ を3点ずつ。3名で1点ずつ受け持って3分割する
  const SHISHA = 2000
  const CHARGE = 500
  const COLA = 500
  const guests = 3
  const rounds = 3

  it("1回目は1名ぶんだけ計上され、全体の合計にはならない", () => {
    const round1 = calcHhSubtotal(
      [
        item("Shisha", "system", SHISHA),
        item("Charge", "system", CHARGE),
        item("Cola", "softdrink", COLA),
      ],
      splitRoundGuestCount(guests, rounds, 0, false),
      CAT,
    )
    // 1名ぶんの基本料金のみ。ドリンクは¥600/人の上限内で超過なし
    expect(round1.subtotal).toBe(HAPPY_HOUR_BASE)
  })

  it("3回の合計が一括会計と一致する", () => {
    const lump = calcHhSubtotal(
      [
        item("Shisha", "system", SHISHA, 3),
        item("Charge", "system", CHARGE, 3),
        item("Cola", "softdrink", COLA, 3),
      ],
      guests,
      CAT,
    ).subtotal

    const splitTotal = Array.from({ length: rounds }, (_, i) =>
      calcHhSubtotal(
        [
          item("Shisha", "system", SHISHA),
          item("Charge", "system", CHARGE),
          item("Cola", "softdrink", COLA),
        ],
        splitRoundGuestCount(guests, rounds, i, i === rounds - 1),
        CAT,
      ).subtotal,
    ).reduce((s, n) => s + n, 0)

    expect(lump).toBe(HAPPY_HOUR_BASE * guests)
    expect(splitTotal).toBe(lump)
  })
})
