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

/**
 * 個別会計（分割会計）で、その回が受け持つ人数を返す。
 * ハッピーアワーは 1人あたり定額 + 1人あたりのドリンク上限で計算するため、
 * 分割時に全員ぶんを毎回計上すると回数だけ多重請求になってしまう。
 *
 * 端数は先の回から1名ずつ多く受け持ち、残り全部を精算する回では
 * まだ計上していない人数をまとめて引き受ける。
 * これにより全回の合計が一括会計と一致する。
 *
 * @param settlesRemainder この会計で未payの明細を全て精算するか
 */
export function splitRoundGuestCount(
  guestCount: number,
  totalRounds: number,
  roundIndex: number,
  settlesRemainder: boolean,
): number {
  if (totalRounds <= 0) return guestCount
  const perRound = Math.floor(guestCount / totalRounds)
  const remainder = guestCount % totalRounds
  const chargedSoFar = perRound * roundIndex + Math.min(roundIndex, remainder)
  if (settlesRemainder) return Math.max(0, guestCount - chargedSoFar)
  return perRound + (roundIndex < remainder ? 1 : 0)
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
