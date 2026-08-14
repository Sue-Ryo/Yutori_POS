export const SYSTEM_CATEGORIES = ["system", "システム"]
export const DRINK_CATEGORIES = ["drink", "ドリンク", "alcohol", "softdrink"]
export const HAPPY_HOUR_CATEGORIES = [...SYSTEM_CATEGORIES, ...DRINK_CATEGORIES]
export const HAPPY_HOUR_BASE = 3000
export const DRINK_CAP_PER_PERSON = 600

/**
 * system カテゴリのうち HH 基本料金（¥3,000/人）に含まれる商品名。
 * 店舗ごとに商品マスタが日本語／英語のどちらかなので両方を持つ。
 *
 * 「対象外」を列挙する方式は使わない。表記違い（アイスホース / Ice Hose）や
 * 後から足した system 商品が列挙漏れになると基本料金に飲み込まれ、
 * 請求漏れになるため。対象を列挙して、それ以外は実額請求に倒す。
 */
export const HH_SYSTEM_TARGET_NAMES = ["Shisha", "シーシャ", "Charge", "チャージ"]

/** ナイトチャージ（HH と併用できない）の商品名 */
export const NIGHT_CHARGE_NAMES = ["Night Charge", "ナイトチャージ"]

const normalizeName = (name: string) => name.trim().toLowerCase()
const HH_SYSTEM_TARGET_SET = new Set(HH_SYSTEM_TARGET_NAMES.map(normalizeName))
const NIGHT_CHARGE_SET = new Set(NIGHT_CHARGE_NAMES.map(normalizeName))

/** ナイトチャージの明細か（HH 適用の可否判定に使う） */
export function isNightCharge(name: string): boolean {
  return NIGHT_CHARGE_SET.has(normalizeName(name))
}

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
  const category = resolveCategory(item, categoryMap)
  // system は指定商品（シーシャ・チャージ）だけが基本料金に含まれる。
  // アイスホース・トップ替え・ダークリーフ等は別料金なので実額で請求する
  if (SYSTEM_CATEGORIES.includes(category)) {
    return HH_SYSTEM_TARGET_SET.has(normalizeName(item.name))
  }
  // ドリンクは全て対象。¥600/人の上限を超えた分だけ超過として加算される
  return DRINK_CATEGORIES.includes(category)
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
