import type {
  ServiceBlock,
  BlockSession,
  LayoutElement,
  Payment,
  BusinessSettings,
  Coupon,
} from "./pos-types"

export function storageKeys(storeId: number) {
  return {
    blocks: `pos_blocks_${storeId}`,
    layoutElements: `pos_layout_elements_${storeId}`,
    sessions: `pos_sessions_${storeId}`,
    payments: `pos_payments_${storeId}`,
    settings: `pos_settings_${storeId}`,
    coupons: `pos_coupons_${storeId}`,
  }
}

// Date文字列 → Date オブジェクト
function d(v: unknown): Date | undefined {
  return v ? new Date(v as string) : undefined
}

function reviveBlock(raw: Record<string, unknown>): ServiceBlock {
  return {
    ...(raw as unknown as ServiceBlock),
    startedAt: d(raw.startedAt),
    checkedOutAt: d(raw.checkedOutAt),
  }
}

function reviveSession(raw: Record<string, unknown>): BlockSession {
  return {
    ...(raw as unknown as BlockSession),
    startedAt: new Date(raw.startedAt as string),
    endedAt: d(raw.endedAt),
    orderItems: (raw.orderItems as Record<string, unknown>[]).map((item) => ({
      ...(item as unknown as object),
      orderedAt: new Date(item.orderedAt as string),
      servedAt: d(item.servedAt),
      paidAt: d(item.paidAt),
    })),
  } as BlockSession
}

function revivePayment(raw: Record<string, unknown>): Payment {
  return {
    ...(raw as unknown as Payment),
    paymentDatetime: new Date(raw.paymentDatetime as string),
    canceledAt: d(raw.canceledAt),
  }
}

export function loadList<T>(
  key: string,
  reviver: (raw: Record<string, unknown>) => T,
): T[] | null {
  try {
    const json = localStorage.getItem(key)
    if (!json) return null
    return (JSON.parse(json) as Record<string, unknown>[]).map(reviver)
  } catch {
    return null
  }
}

export function saveList<T>(key: string, data: T[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(data))
  } catch {
    // ストレージ容量不足などを無視
  }
}

export function loadObject<T>(key: string): T | null {
  try {
    const json = localStorage.getItem(key)
    return json ? (JSON.parse(json) as T) : null
  } catch {
    return null
  }
}

export function saveObject<T>(key: string, data: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(data))
  } catch {
    // ignore
  }
}

export const revivers = { reviveBlock, reviveSession, revivePayment }
