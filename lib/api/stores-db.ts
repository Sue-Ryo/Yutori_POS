import { supabase } from "@/lib/supabase"
import type { BusinessSettings } from "@/lib/pos-types"

export interface Store {
  id: number
  name: string
  businessDayStartTime: string
  taxRate: number
  checkedOutDisplaySeconds: number
  pinHash: string
}

function rowToStore(row: Record<string, unknown>): Store {
  return {
    id: row.id as number,
    name: row.name as string,
    businessDayStartTime: row.business_day_start_time as string,
    taxRate: (row.tax_rate as number) ?? 10,
    checkedOutDisplaySeconds: (row.checked_out_display_seconds as number) ?? 10,
    pinHash: (row.pin_hash as string) ?? "",
  }
}

export async function fetchStores(): Promise<Store[]> {
  const { data, error } = await supabase
    .from("stores")
    .select("id, name, business_day_start_time, tax_rate, checked_out_display_seconds, pin_hash")
    .order("id")
  if (error) throw error
  return (data as Record<string, unknown>[]).map(rowToStore)
}

export async function fetchStoreSettings(storeId: number): Promise<BusinessSettings | null> {
  const { data, error } = await supabase
    .from("stores")
    .select("name, business_day_start_time, tax_rate, checked_out_display_seconds")
    .eq("id", storeId)
    .single()
  if (error) return null
  const row = data as Record<string, unknown>
  return {
    storeName: row.name as string,
    businessDayStartTime: row.business_day_start_time as string,
    taxRate: (row.tax_rate as number) ?? 10,
    checkedOutDisplaySeconds: (row.checked_out_display_seconds as number) ?? 10,
  }
}

export async function upsertStoreSettings(storeId: number, settings: BusinessSettings): Promise<void> {
  const { error } = await supabase
    .from("stores")
    .update({
      name: settings.storeName,
      business_day_start_time: settings.businessDayStartTime,
      tax_rate: settings.taxRate,
      checked_out_display_seconds: settings.checkedOutDisplaySeconds,
      updated_at: new Date().toISOString(),
    })
    .eq("id", storeId)
  if (error) throw error
}

export async function updatePinHash(storeId: number, pinHash: string): Promise<void> {
  const { error } = await supabase
    .from("stores")
    .update({ pin_hash: pinHash, updated_at: new Date().toISOString() })
    .eq("id", storeId)
  if (error) throw error
}
