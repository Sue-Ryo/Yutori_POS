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
    paidItemIds: (row.paid_item_ids as string[]) ?? [],
    couponId: (row.coupon_id as string | null) ?? undefined,
  }
}

function paymentToRow(payment: Payment): Record<string, unknown> {
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
    note: payment.note ?? null,
    canceled_at: payment.canceledAt?.toISOString() ?? null,
    cancel_reason: payment.cancelReason ?? null,
    paid_item_ids: payment.paidItemIds,
    coupon_id: payment.couponId ?? null,
  }
}

export async function fetchPayments(): Promise<Payment[]> {
  const { data, error } = await supabase
    .from("payments")
    .select("*")
    .order("payment_datetime", { ascending: false })
  if (error) throw error
  return (data as Record<string, unknown>[]).map(rowToPayment)
}

export async function upsertPayment(payment: Payment): Promise<void> {
  const { error } = await supabase.from("payments").upsert(paymentToRow(payment))
  if (error) throw error
}
