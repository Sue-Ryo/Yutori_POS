import type { Product } from "@/lib/pos-types"

/**
 * 商品マスタの並び替え。
 *
 * 表示順は products.displayOrder だけで決まり、カテゴリの並びは
 * 「displayOrder 昇順で最初に現れた順」（オーダー追加画面・商品マスタ共通）。
 * そのためカテゴリ単位のブロックに分けて入れ替え、最後に通し番号を振り直す。
 */

export type CategoryBlock = {
  category: string
  products: Product[]
}

/** カテゴリ単位のブロックに分ける。ブロックも中身も表示順どおりに並ぶ */
export function groupByCategory(products: Product[]): CategoryBlock[] {
  const blocks: CategoryBlock[] = []
  const byCategory = new Map<string, CategoryBlock>()
  ;[...products]
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .forEach((product) => {
      let block = byCategory.get(product.category)
      if (!block) {
        block = { category: product.category, products: [] }
        byCategory.set(product.category, block)
        blocks.push(block)
      }
      block.products.push(product)
    })
  return blocks
}

/** ブロックを平坦化し、displayOrder を 1 から振り直す */
function flatten(blocks: CategoryBlock[]): Product[] {
  return blocks
    .flatMap((block) => block.products)
    .map((product, i) => ({ ...product, displayOrder: i + 1 }))
}

function swap<T>(list: T[], i: number, j: number): T[] {
  const next = [...list]
  const tmp = next[i]
  next[i] = next[j]
  next[j] = tmp
  return next
}

/**
 * 商品を同じカテゴリ内で1つ上（-1）／下（+1）へ動かす。
 * 端にいるときや対象が無いときは元の配列をそのまま返す（呼び出し側で保存を省ける）
 */
export function moveProduct(products: Product[], id: string, direction: -1 | 1): Product[] {
  const blocks = groupByCategory(products)
  const blockIndex = blocks.findIndex((b) => b.products.some((p) => p.id === id))
  if (blockIndex < 0) return products

  const block = blocks[blockIndex]
  const from = block.products.findIndex((p) => p.id === id)
  const to = from + direction
  if (to < 0 || to >= block.products.length) return products

  return flatten(
    blocks.map((b, i) =>
      i === blockIndex ? { ...b, products: swap(b.products, from, to) } : b,
    ),
  )
}

/** カテゴリを所属商品ごと1つ上（-1）／下（+1）へ動かす */
export function moveCategory(products: Product[], category: string, direction: -1 | 1): Product[] {
  const blocks = groupByCategory(products)
  const from = blocks.findIndex((b) => b.category === category)
  if (from < 0) return products

  const to = from + direction
  if (to < 0 || to >= blocks.length) return products

  return flatten(swap(blocks, from, to))
}

/** 並び替えで displayOrder が変わった商品だけを返す（保存対象の絞り込み用） */
export function changedOrders(prev: Product[], next: Product[]): Product[] {
  const prevById = new Map(prev.map((p) => [p.id, p.displayOrder]))
  return next.filter((p) => prevById.get(p.id) !== p.displayOrder)
}
