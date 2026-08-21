import { supabase } from "@/lib/supabase"
import type { Payment } from "@/lib/pos-types"

export function rowToPayment(row: Record<string, unknown>): Payment {
  return {
    id: row.id as string,
    sessionId: row.session_id as string,
    blockId: row.block_id as string,
    paymentDatetime: new Date(row.payment_datetime as string),
    businessDate: row.business_date as string,
    subtotalAmount: row.subtotal_amount as number,
    discountAmount: row.discount_amount as number,
    taxAmount: row.tax_amount as number,
    totalAmount: row.total_amount as number,
    cashAmount: row.cash_amount as number,
    cashlessAmount: row.cashless_amount as number,
    guestCount: row.guest_count as number,
    note: (row.note as string | null) ?? undefined,
    canceledAt: row.canceled_at ? new Date(row.canceled_at as string) : undefined,
    cancelReason: (row.cancel_reason as string | null) ?? undefined,
    paidItemIds: (row.paid_item_ids as string[] | null) ?? undefined,
    couponId: (row.coupon_id as string | null) ?? undefined,
    customerName: (row.customer_name as string | null) ?? undefined,
    sessionStartedAt: row.session_started_at ? new Date(row.session_started_at as string) : undefined,
    syncedToSheetAt: row.synced_to_sheet_at ? new Date(row.synced_to_sheet_at as string) : undefined,
    squarePaymentId: (row.square_payment_id as string | null) ?? undefined,
    isNewCustomer: (row.is_new_customer as boolean | null) ?? false,
    // 列追加前の会計は NULL。false と区別して伝票側へフォールバックさせる
    happyHour: (row.happy_hour as boolean | null) ?? undefined,
  }
}

function paymentToRow(payment: Payment, storeId: number): Record<string, unknown> {
  return {
    id: payment.id,
    session_id: payment.sessionId,
    block_id: payment.blockId,
    payment_datetime: payment.paymentDatetime.toISOString(),
    business_date: payment.businessDate,
    subtotal_amount: payment.subtotalAmount,
    discount_amount: payment.discountAmount,
    tax_amount: payment.taxAmount,
    total_amount: payment.totalAmount,
    cash_amount: payment.cashAmount,
    cashless_amount: payment.cashlessAmount,
    guest_count: payment.guestCount,
    // 列追加前の会計は undefined。[] に丸めると台帳ガードが
    // 「確定した会計の内容が変わった」と見なして同期状態の更新まで弾くため、
    // 値が無いときは NULL のまま据え置く
    paid_item_ids: payment.paidItemIds ?? null,
    note: payment.note ?? null,
    canceled_at: payment.canceledAt?.toISOString() ?? null,
    cancel_reason: payment.cancelReason ?? null,
    coupon_id: payment.couponId ?? null,
    customer_name: payment.customerName ?? null,
    session_started_at: payment.sessionStartedAt?.toISOString() ?? null,
    synced_to_sheet_at: payment.syncedToSheetAt?.toISOString() ?? null,
    square_payment_id: payment.squarePaymentId ?? null,
    is_new_customer: payment.isNewCustomer ?? false,
    happy_hour: payment.happyHour ?? false,
    store_id: storeId,
  }
}

export async function fetchPayments(storeId: number): Promise<Payment[]> {
  const { data, error } = await supabase
    .from("payments")
    .select("*")
    .eq("store_id", storeId)
    .order("payment_datetime", { ascending: false })
  if (error) throw error
  return (data as Record<string, unknown>[]).map(rowToPayment)
}

export async function upsertPayments(payments: Payment[], storeId: number): Promise<void> {
  if (payments.length === 0) return
  const { error } = await supabase.from("payments").upsert(payments.map((p) => paymentToRow(p, storeId)))
  if (error) throw error
}

/** 会計の取消。台帳保護のため、upsert ではなく取消列だけの更新にする */
export async function cancelPaymentDb(
  id: string,
  canceledAt: Date,
  reason?: string,
): Promise<void> {
  const { error } = await supabase
    .from("payments")
    .update({ canceled_at: canceledAt.toISOString(), cancel_reason: reason ?? null })
    .eq("id", id)
  if (error) throw error
}

/** 取消できる期間。DB 側（payments_guard）と同じ日数にすること */
export const CANCELABLE_DAYS = 7

export function isCancelable(paymentDatetime: Date, now: Date = new Date()): boolean {
  return now.getTime() - paymentDatetime.getTime() <= CANCELABLE_DAYS * 24 * 60 * 60 * 1000
}

export async function markPaymentsSynced(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  const { error } = await supabase
    .from("payments")
    .update({ synced_to_sheet_at: new Date().toISOString() })
    .in("id", ids)
  if (error) throw error
}
