import { supabase } from "@/lib/supabase"
import type { Coupon } from "@/lib/pos-types"

function rowToCoupon(row: Record<string, unknown>): Coupon {
  return {
    id: row.id as string,
    name: row.name as string,
    discountType: row.discount_type as Coupon["discountType"],
    discountValue: row.discount_value as number,
    validFrom: (row.valid_from as string | null) ?? undefined,
    validTo: (row.valid_to as string | null) ?? undefined,
    isActive: row.is_active as boolean,
  }
}

function couponToRow(coupon: Coupon): Record<string, unknown> {
  return {
    id: coupon.id,
    name: coupon.name,
    discount_type: coupon.discountType,
    discount_value: coupon.discountValue,
    valid_from: coupon.validFrom ?? null,
    valid_to: coupon.validTo ?? null,
    is_active: coupon.isActive,
  }
}

export async function fetchCoupons(): Promise<Coupon[]> {
  const { data, error } = await supabase.from("coupons").select("*")
  if (error) throw error
  return (data as Record<string, unknown>[]).map(rowToCoupon)
}

export async function upsertCoupons(coupons: Coupon[]): Promise<void> {
  if (coupons.length === 0) return
  const { error } = await supabase.from("coupons").upsert(coupons.map(couponToRow))
  if (error) throw error
}
