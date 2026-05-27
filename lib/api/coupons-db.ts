import { supabase } from "@/lib/supabase"
import type { Coupon } from "@/lib/pos-types"

function rowToCoupon(row: Record<string, unknown>): Coupon {
  return {
    id: String(row.id),
    name: row.name as string,
    discountType: (row.discount_type as Coupon["discountType"]) ?? "fixed",
    discountValue: row.discount_value as number,
    validFrom: (row.valid_from as string | null) ?? undefined,
    validTo: (row.valid_to as string | null) ?? undefined,
    isActive: row.is_active as boolean,
  }
}

function isDbId(id: string): boolean {
  return /^\d+$/.test(id)
}

function couponToRow(coupon: Coupon, storeId: number): Record<string, unknown> {
  const row: Record<string, unknown> = {
    name: coupon.name,
    discount_type: coupon.discountType,
    discount_value: coupon.discountValue,
    is_active: coupon.isActive,
    store_id: storeId,
  }
  // ローカル仮IDは省略してDBに自動採番させる
  if (isDbId(coupon.id)) row.id = Number(coupon.id)
  return row
}

export async function fetchCoupons(storeId: number): Promise<Coupon[]> {
  const { data, error } = await supabase.from("coupons").select("*").eq("store_id", storeId)
  if (error) throw error
  return (data as Record<string, unknown>[]).map(rowToCoupon)
}

export async function insertCoupon(coupon: Omit<Coupon, "id">, storeId: number): Promise<Coupon> {
  const { data, error } = await supabase
    .from("coupons")
    .insert({
      name: coupon.name,
      discount_type: coupon.discountType,
      discount_value: coupon.discountValue,
      is_active: coupon.isActive,
      store_id: storeId,
    })
    .select()
    .single()
  if (error) throw error
  return rowToCoupon(data as Record<string, unknown>)
}

export async function updateCouponDb(id: string, coupon: Partial<Omit<Coupon, "id">>, storeId: number): Promise<void> {
  const updates: Record<string, unknown> = {}
  if (coupon.name !== undefined) updates.name = coupon.name
  if (coupon.discountType !== undefined) updates.discount_type = coupon.discountType
  if (coupon.discountValue !== undefined) updates.discount_value = coupon.discountValue
  if (coupon.isActive !== undefined) updates.is_active = coupon.isActive
  const { error } = await supabase.from("coupons").update(updates).eq("id", Number(id)).eq("store_id", storeId)
  if (error) throw error
}

export async function deleteCoupon(id: string, storeId: number): Promise<void> {
  const { error } = await supabase.from("coupons").delete().eq("id", Number(id)).eq("store_id", storeId)
  if (error) throw error
}
