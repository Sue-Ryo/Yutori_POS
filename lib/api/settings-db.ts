import type { BusinessSettings } from "@/lib/pos-types"
import { fetchStoreSettings, upsertStoreSettings } from "@/lib/api/stores-db"

export async function fetchSettings(storeId: number): Promise<BusinessSettings | null> {
  return fetchStoreSettings(storeId)
}

export async function upsertSettings(storeId: number, settings: BusinessSettings): Promise<void> {
  return upsertStoreSettings(storeId, settings)
}
