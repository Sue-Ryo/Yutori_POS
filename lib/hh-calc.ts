export const HAPPY_HOUR_CATEGORIES = ["system", "システム", "drink", "ドリンク", "alcohol", "softdrink"]
export const DRINK_CATEGORIES = ["drink", "ドリンク", "alcohol", "softdrink"]
export const HAPPY_HOUR_BASE = 3000
export const DRINK_CAP_PER_PERSON = 600
// system カテゴリ内で HH 対象外とする商品名（Shisha・Charge 以外）
export const HH_EXCLUDED_NAMES = [
  "Dark Leaf",
  "Ice Hose",
  "Top Exchange",
  "Share",
  "Alcohol Bottle",
  "Juice Bottle",
  "Night Charge",
]
export const NIGHT_CHARGE_NAME = "Night Charge"

export type HhItem = {
  id: string
  productId: string
  name: string
  category?: string
  subtotal: number
}

export function resolveCategory(
  item: Pick<HhItem, "productId" | "category">,
  categoryMap: Record<string, string>,
): string {
  return item.category ?? categoryMap[item.productId] ?? ""
}

export function isHhTarget(
  item: Pick<HhItem, "productId" | "name" | "category">,
  categoryMap: Record<string, string>,
): boolean {
  return (
    HAPPY_HOUR_CATEGORIES.includes(resolveCategory(item, categoryMap)) &&
    !HH_EXCLUDED_NAMES.includes(item.name)
  )
}

export type HhResult = {
  happyHourCharge: number
  drinkSubtotal: number
  drinkOverage: number
  nonHhSubtotal: number
  subtotal: number
}

export function calcHhSubtotal(
  items: HhItem[],
  guestCount: number,
  categoryMap: Record<string, string>,
): HhResult {
  const drinkSubtotal = items
    .filter((i) => DRINK_CATEGORIES.includes(resolveCategory(i, categoryMap)))
    .reduce((sum, i) => sum + i.subtotal, 0)

  const drinkOverage = Math.max(0, drinkSubtotal - DRINK_CAP_PER_PERSON * guestCount)

  const nonHhSubtotal = items
    .filter((i) => !isHhTarget(i, categoryMap))
    .reduce((sum, i) => sum + i.subtotal, 0)

  const happyHourCharge = HAPPY_HOUR_BASE * guestCount

  return {
    happyHourCharge,
    drinkSubtotal,
    drinkOverage,
    nonHhSubtotal,
    subtotal: happyHourCharge + drinkOverage + nonHhSubtotal,
  }
}
