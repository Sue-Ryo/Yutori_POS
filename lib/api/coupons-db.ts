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

function couponToRow(coupon: Coupon, storeId: number): Record<string, unknown> {
  return {
    id: coupon.id,
    name: coupon.name,
    discount_type: coupon.discountType,
    discount_value: coupon.discountValue,
    is_active: coupon.isActive,
    store_id: storeId,
  }
}

export async function fetchCoupons(storeId: number): Promise<Coupon[]> {
  const { data, error } = await supabase.from("coupons").select("*").eq("store_id", storeId)
  if (error) throw error
  return (data as Record<string, unknown>[]).map(rowToCoupon)
}

export async function syncCoupons(coupons: Coupon[], storeId: number): Promise<void> {
  const newIds = coupons.map((c) => c.id)

  const { data: existing } = await supabase.from("coupons").select("id").eq("store_id", storeId)
  const existingIds = ((existing ?? []) as { id: string }[]).map((r) => String(r.id))
  const toDelete = existingIds.filter((id) => !newIds.includes(id))

  await Promise.all([
    toDelete.length > 0
      ? supabase.from("coupons").delete().in("id", toDelete).then(({ error }) => { if (error) throw error })
      : Promise.resolve(),
    coupons.length > 0
      ? supabase.from("coupons").upsert(coupons.map((c) => couponToRow(c, storeId))).then(({ error }) => { if (error) throw error })
      : Promise.resolve(),
  ])
}
