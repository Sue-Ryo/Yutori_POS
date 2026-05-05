import { supabase } from "@/lib/supabase"
import type { BusinessSettings } from "@/lib/pos-types"

export async function fetchSettings(): Promise<BusinessSettings | null> {
  const { data, error } = await supabase
    .from("pos_settings")
    .select("*")
    .eq("id", 1)
    .single()
  if (error) return null
  const row = data as Record<string, unknown>
  return {
    storeName: row.store_name as string,
    businessDayStartTime: row.business_day_start_time as string,
    taxRate: row.tax_rate as number,
    checkedOutDisplaySeconds: row.checked_out_display_seconds as number,
  }
}

export async function upsertSettings(settings: BusinessSettings): Promise<void> {
  const { error } = await supabase.from("pos_settings").upsert({
    id: 1,
    store_name: settings.storeName,
    business_day_start_time: settings.businessDayStartTime,
    tax_rate: settings.taxRate,
    checked_out_display_seconds: settings.checkedOutDisplaySeconds,
  })
  if (error) throw error
}
