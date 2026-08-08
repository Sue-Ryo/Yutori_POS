// 個別会計（分割会計）の進捗を localStorage に保持する。
// Square アプリ切替方式では1回の支払いごとにページが再読込されるため、
// 「全何回のうち何回目まで終わったか」をメモリ上に持ち続けられない。
// 会計そのものの保留情報は square-pos-link 側が別途持つ（こちらは分割の進行だけ）。

export interface SplitCheckoutPlan {
  sessionId: string
  blockId: string
  /** 何回に分けて支払うか */
  totalRounds: number
  /** 決済が完了した回数。次に行うのは completedRounds + 1 回目 */
  completedRounds: number
  createdAt: number
}

// 分割会計は1組ずつ順に支払うため長引くことがある。閉店をまたぐほど古いものは破棄する
const PLAN_TTL_MS = 3 * 60 * 60 * 1000

const planKey = (storeId: number) => `pos_split_plan_${storeId}`

export function saveSplitPlan(
  storeId: number,
  plan: Omit<SplitCheckoutPlan, "createdAt">,
): void {
  const stored: SplitCheckoutPlan = { ...plan, createdAt: Date.now() }
  localStorage.setItem(planKey(storeId), JSON.stringify(stored))
}

export function loadSplitPlan(storeId: number): SplitCheckoutPlan | null {
  const raw = localStorage.getItem(planKey(storeId))
  if (!raw) return null
  try {
    const plan = JSON.parse(raw) as SplitCheckoutPlan
    if (Date.now() - plan.createdAt > PLAN_TTL_MS) return null
    if (plan.completedRounds >= plan.totalRounds) return null
    return plan
  } catch {
    return null
  }
}

export function clearSplitPlan(storeId: number): void {
  localStorage.removeItem(planKey(storeId))
}
