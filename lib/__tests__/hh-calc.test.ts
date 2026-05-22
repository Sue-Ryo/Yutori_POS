import { describe, it, expect } from "vitest"
import {
  isHhTarget,
  calcHhSubtotal,
  HAPPY_HOUR_BASE,
  DRINK_CAP_PER_PERSON,
  HH_EXCLUDED_NAMES,
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
})
