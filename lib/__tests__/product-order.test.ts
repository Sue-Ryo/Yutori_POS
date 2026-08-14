import { describe, it, expect } from "vitest"
import type { Product } from "../pos-types"
import { groupByCategory, moveProduct, moveCategory, changedOrders } from "../product-order"

const product = (id: string, category: string, displayOrder: number): Product => ({
  id,
  category,
  name: id,
  price: 100,
  isActive: true,
  displayOrder,
})

// system: s1, s2 / drink: d1, d2, d3
const base: Product[] = [
  product("s1", "system", 1),
  product("s2", "system", 2),
  product("d1", "drink", 3),
  product("d2", "drink", 4),
  product("d3", "drink", 5),
]

/** 表示順どおりの id 一覧 */
const order = (products: Product[]) =>
  [...products].sort((a, b) => a.displayOrder - b.displayOrder).map((p) => p.id)

describe("groupByCategory", () => {
  it("カテゴリは最初に現れた順、中身は表示順", () => {
    const blocks = groupByCategory(base)
    expect(blocks.map((b) => b.category)).toEqual(["system", "drink"])
    expect(blocks[1].products.map((p) => p.id)).toEqual(["d1", "d2", "d3"])
  })

  it("displayOrder が飛んでいても順序を保つ", () => {
    const messy = [product("b", "x", 50), product("a", "x", 10), product("c", "y", 30)]
    const blocks = groupByCategory(messy)
    expect(blocks.map((b) => b.category)).toEqual(["x", "y"])
    expect(blocks[0].products.map((p) => p.id)).toEqual(["a", "b"])
  })
})

describe("moveProduct", () => {
  it("同じカテゴリ内で1つ上へ", () => {
    expect(order(moveProduct(base, "d2", -1))).toEqual(["s1", "s2", "d2", "d1", "d3"])
  })

  it("同じカテゴリ内で1つ下へ", () => {
    expect(order(moveProduct(base, "d1", 1))).toEqual(["s1", "s2", "d2", "d1", "d3"])
  })

  it("カテゴリ先頭の商品は上へ動かない（前のカテゴリへ移らない）", () => {
    expect(moveProduct(base, "d1", -1)).toBe(base)
  })

  it("カテゴリ末尾の商品は下へ動かない", () => {
    expect(moveProduct(base, "d3", 1)).toBe(base)
  })

  it("存在しないIDは何もしない", () => {
    expect(moveProduct(base, "zzz", 1)).toBe(base)
  })

  it("displayOrder は1から連番で振り直される", () => {
    const moved = moveProduct(base, "d2", -1)
    expect([...moved].sort((a, b) => a.displayOrder - b.displayOrder).map((p) => p.displayOrder))
      .toEqual([1, 2, 3, 4, 5])
  })

  it("カテゴリの構成は変わらない", () => {
    const moved = moveProduct(base, "d2", -1)
    expect(groupByCategory(moved).map((b) => b.category)).toEqual(["system", "drink"])
  })
})

describe("moveCategory", () => {
  it("カテゴリごとまとめて上へ動く", () => {
    expect(order(moveCategory(base, "drink", -1))).toEqual(["d1", "d2", "d3", "s1", "s2"])
  })

  it("カテゴリごとまとめて下へ動く", () => {
    expect(order(moveCategory(base, "system", 1))).toEqual(["d1", "d2", "d3", "s1", "s2"])
  })

  it("先頭カテゴリは上へ動かない", () => {
    expect(moveCategory(base, "system", -1)).toBe(base)
  })

  it("末尾カテゴリは下へ動かない", () => {
    expect(moveCategory(base, "drink", 1)).toBe(base)
  })

  it("カテゴリ内の並びは維持される", () => {
    const moved = moveCategory(base, "drink", -1)
    expect(groupByCategory(moved)[0].products.map((p) => p.id)).toEqual(["d1", "d2", "d3"])
  })

  it("3カテゴリでも隣とだけ入れ替わる", () => {
    const three = [...base, product("f1", "food", 6)]
    expect(groupByCategory(moveCategory(three, "food", -1)).map((b) => b.category))
      .toEqual(["system", "food", "drink"])
  })
})

describe("changedOrders", () => {
  it("displayOrder が変わった商品だけ返す", () => {
    const moved = moveProduct(base, "d2", -1)
    expect(changedOrders(base, moved).map((p) => p.id).sort()).toEqual(["d1", "d2"])
  })

  it("変化がなければ空", () => {
    expect(changedOrders(base, base)).toEqual([])
  })
})
